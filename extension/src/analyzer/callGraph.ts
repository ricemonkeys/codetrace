import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { GenericLspAnalyzer } from './GenericLspAnalyzer';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import type { CallEdge, CallGraph, FunctionNode, Analyzer } from './types';
import { describeFunction, enclosingFunctionId, makeId, rangeOf } from './utils';

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

const ANALYZERS: Analyzer[] = [
  new TypeScriptAnalyzer(),
  new GenericLspAnalyzer(),
];

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
 * Extracts a typed graph for a workspace root using the best available analyzer.
 */
export async function extractWorkspaceCallGraph(
  workspaceRoot: string,
  options: ExtractWorkspaceCallGraphOptions = {},
): Promise<CallGraph> {
  const root = path.resolve(workspaceRoot);
  const isDirectory = fs.statSync(root).isDirectory();
  const searchRoot = isDirectory ? root : path.dirname(root);
  
  const filePaths = isDirectory 
    ? findTypeScriptFiles(searchRoot, options.ignoredDirectories)
    : [root];

  const analyzer = selectBestAnalyzer(filePaths);
  return analyzer.analyze(searchRoot, filePaths, options);
}

/**
 * Extracts a typed graph from an explicit file list using the best available analyzer.
 */
export async function extractCallGraphFromFiles(
  filePaths: readonly string[],
): Promise<CallGraph> {
  const paths = filePaths.map(p => path.resolve(p));
  const analyzer = selectBestAnalyzer(paths);
  return analyzer.analyze(path.dirname(paths[0] || '.'), paths);
}

function selectBestAnalyzer(filePaths: string[]): Analyzer {
  // Sort analyzers by precision (premium first)
  const sorted = [...ANALYZERS].sort((a, b) => {
    if (a.getPrecision() === 'premium' && b.getPrecision() !== 'premium') return -1;
    if (a.getPrecision() !== 'premium' && b.getPrecision() === 'premium') return 1;
    return 0;
  });

  for (const analyzer of sorted) {
    if (analyzer.canAnalyze(filePaths)) {
      return analyzer;
    }
  }

  return ANALYZERS[ANALYZERS.length - 1]; // Fallback to last one (Generic LSP)
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

    return undefined;
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

      // Collect all files, the analyzer will decide which ones to process
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  visit(root);
  return files;
}
