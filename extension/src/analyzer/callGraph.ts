import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { CallEdge, CallGraph, FunctionKind, FunctionNode, SourceRange } from './types';

export const DEFAULT_ANALYZER_IGNORED_DIRECTORIES = [
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
] as const;

export interface ExtractWorkspaceCallGraphOptions {
  compilerOptions?: ts.CompilerOptions;
  ignoredDirectories?: readonly string[];
  searchParentTsconfig?: boolean;
  tsconfigPath?: string;
}

/**
 * Extracts a syntax-only graph for a single file. This preserves the original
 * fast path, but cannot resolve imported symbols or typed receiver calls.
 */
export function extractCallGraph(filePath: string): CallGraph {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  const nodes: FunctionNode[] = [];
  const nodeIdByDecl = new Map<ts.Node, string>();
  const edges: CallEdge[] = [];

  // First pass: collect every function-like declaration with a stable name.
  const collectScope = (parentName: string | undefined) => (node: ts.Node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const className = node.name?.text ?? parentName ?? 'anonymous';
      ts.forEachChild(node, collectScope(className));
      return;
    }

    const declared = describeFunction(node, parentName);
    if (declared) {
      const id = makeId(filePath, declared.name, declared.range);
      nodes.push({ id, name: declared.name, kind: declared.kind, file: filePath, range: declared.range });
      nodeIdByDecl.set(declared.declNode, id);
    }
    ts.forEachChild(node, collectScope(parentName));
  };
  ts.forEachChild(sourceFile, collectScope(undefined));

  // Second pass: for each call expression, attribute it to the enclosing function node.
  const visitCall = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callerId = enclosingFunctionId(node, nodeIdByDecl);
      const callee = resolveCallee(node.expression, nodes, callerId);
      if (callerId && callee) {
        edges.push({ from: callerId, to: callee.id });
      }
    }
    ts.forEachChild(node, visitCall);
  };
  ts.forEachChild(sourceFile, visitCall);

  return { nodes, edges };
}

/**
 * Extracts a typed graph for a workspace root using tsconfig.json when it is
 * present directly in that root, then falls back to scanning TypeScript files.
 */
export function extractWorkspaceCallGraph(
  workspaceRoot: string,
  options: ExtractWorkspaceCallGraphOptions = {},
): CallGraph {
  const root = path.resolve(workspaceRoot);
  const searchRoot = fs.statSync(root).isDirectory() ? root : path.dirname(root);
  const configPath = resolveTsConfigPath(searchRoot, options);

  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
      throw new Error(formatDiagnostic(config.error));
    }

    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map(formatDiagnostic).join('\n'));
    }

    return extractProgramCallGraph(ts.createProgram(parsed.fileNames, parsed.options));
  }

  return extractCallGraphFromFiles(
    findTypeScriptFiles(searchRoot, options.ignoredDirectories),
    options.compilerOptions,
  );
}

/**
 * Extracts a typed graph from an explicit file list. Useful for callers that
 * already own workspace discovery and want Program/Checker resolution.
 */
export function extractCallGraphFromFiles(
  filePaths: readonly string[],
  compilerOptions: ts.CompilerOptions = {},
): CallGraph {
  return extractProgramCallGraph(
    ts.createProgram(
      filePaths.map(filePath => path.resolve(filePath)),
      {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        skipLibCheck: true,
        ...compilerOptions,
      },
    ),
  );
}

function extractProgramCallGraph(program: ts.Program): CallGraph {
  const checker = program.getTypeChecker();
  const nodes: FunctionNode[] = [];
  const nodeIdByDecl = new Map<ts.Node, string>();
  const nodeIdBySymbol = new Map<ts.Symbol, string>();
  const edges: CallEdge[] = [];
  const edgeKeys = new Set<string>();
  const sourceFiles = program.getSourceFiles().filter(sourceFile => {
    return !sourceFile.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sourceFile);
  });

  for (const sourceFile of sourceFiles) {
    const collectScope = (parentName: string | undefined) => (node: ts.Node) => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const className = node.name?.text ?? parentName ?? 'anonymous';
        ts.forEachChild(node, collectScope(className));
        return;
      }

      const declared = describeFunction(node, parentName);
      if (declared) {
        const file = path.normalize(sourceFile.fileName);
        const id = makeId(file, declared.name, declared.range);
        nodes.push({ id, name: declared.name, kind: declared.kind, file, range: declared.range });
        nodeIdByDecl.set(declared.declNode, id);

        const symbol = getFunctionSymbol(declared.declNode, checker);
        if (symbol) {
          nodeIdBySymbol.set(resolveAliasedSymbol(symbol, checker), id);
        }
      }

      ts.forEachChild(node, collectScope(parentName));
    };

    ts.forEachChild(sourceFile, collectScope(undefined));
  }

  for (const sourceFile of sourceFiles) {
    const visitCall = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callerId = enclosingFunctionId(node, nodeIdByDecl);
        const calleeId = resolveTypedCalleeId(node.expression, checker, nodeIdBySymbol);
        if (callerId && calleeId) {
          const key = `${callerId}->${calleeId}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({ from: callerId, to: calleeId });
          }
        }
      }

      ts.forEachChild(node, visitCall);
    };

    ts.forEachChild(sourceFile, visitCall);
  }

  return { nodes, edges };
}

interface FunctionDescriptor {
  name: string;
  kind: FunctionKind;
  range: SourceRange;
  declNode: ts.Node;
}

function describeFunction(node: ts.Node, parentName: string | undefined): FunctionDescriptor | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'function',
      range: rangeOf(node),
      declNode: node,
    };
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    const owner = parentName ?? 'anonymous';
    return {
      name: `${owner}.${node.name.text}`,
      kind: 'method',
      range: rangeOf(node),
      declNode: node,
    };
  }

  if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
    const init = node.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return {
        name: node.name.text,
        kind: ts.isArrowFunction(init) ? 'arrow' : 'function',
        range: rangeOf(init),
        declNode: init,
      };
    }
  }

  return undefined;
}

function rangeOf(node: ts.Node): SourceRange {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function makeId(filePath: string, name: string, range: SourceRange): string {
  return `${filePath}#${name}@${range.startLine}:${range.startColumn}`;
}

function enclosingFunctionId(node: ts.Node, nodeIdByDecl: Map<ts.Node, string>): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const id = nodeIdByDecl.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function resolveCallee(
  expression: ts.Expression,
  nodes: FunctionNode[],
  callerId: string | undefined,
): FunctionNode | undefined {
  if (ts.isIdentifier(expression)) {
    return nodes.find(n => n.name === expression.text);
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const methodName = expression.name.text;

    // `this.method()` — resolve within the same class as the caller.
    if (expression.expression.kind === ts.SyntaxKind.ThisKeyword && callerId) {
      const caller = nodes.find(n => n.id === callerId);
      const className = caller?.kind === 'method' ? caller.name.split('.')[0] : undefined;
      if (className) {
        const qualified = `${className}.${methodName}`;
        const exact = nodes.find(n => n.name === qualified);
        if (exact) return exact;
      }
    }

    // `Class.method()` — qualified match against the receiver identifier.
    if (ts.isIdentifier(expression.expression)) {
      const qualified = `${expression.expression.text}.${methodName}`;
      return nodes.find(n => n.name === qualified);
    }

    // Receivers we can't statically attribute (parameters, returns, calls, etc.)
    // are intentionally not matched: a name-only fallback would create
    // false-positive edges to unrelated methods that happen to share a name.
    // Cross-file/typed resolution will land in #53.
    return undefined;
  }

  return undefined;
}

function getFunctionSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return checker.getSymbolAtLocation(node.name);
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return checker.getSymbolAtLocation(node.name);
  }

  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return checker.getSymbolAtLocation(node.parent.name);
  }

  return undefined;
}

function resolveTypedCalleeId(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  nodeIdBySymbol: Map<ts.Symbol, string>,
): string | undefined {
  const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  const symbol = checker.getSymbolAtLocation(symbolNode);
  if (!symbol) return undefined;

  const resolved = resolveAliasedSymbol(symbol, checker);
  return nodeIdBySymbol.get(resolved) ?? nodeIdBySymbol.get(symbol);
}

function resolveAliasedSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;

  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
}

function resolveTsConfigPath(
  searchRoot: string,
  options: ExtractWorkspaceCallGraphOptions,
): string | undefined {
  if (options.tsconfigPath) {
    return path.resolve(options.tsconfigPath);
  }

  const localConfigPath = path.join(searchRoot, 'tsconfig.json');
  if (fs.existsSync(localConfigPath)) {
    return localConfigPath;
  }

  if (options.searchParentTsconfig) {
    return ts.findConfigFile(searchRoot, ts.sys.fileExists, 'tsconfig.json');
  }

  return undefined;
}

function findTypeScriptFiles(
  root: string,
  ignoredDirectories: readonly string[] = DEFAULT_ANALYZER_IGNORED_DIRECTORIES,
): string[] {
  const files: string[] = [];
  const ignoredDirectoryNames = new Set(ignoredDirectories);

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  };

  visit(root);
  return files;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) return message;

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`;
}
