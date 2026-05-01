import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { Analyzer, CallEdge, CallGraph, FunctionNode, PrecisionTier } from './types';
import { describeFunction, enclosingFunctionId, makeId } from './utils';

export class TypeScriptAnalyzer implements Analyzer {
  getName(): string {
    return 'TypeScript Compiler API';
  }

  getPrecision(): PrecisionTier {
    return 'premium';
  }

  canAnalyze(filePaths: string[]): boolean {
    return filePaths.some(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'));
  }

  async analyze(workspaceRoot: string, filePaths: string[], options: any = {}): Promise<CallGraph> {
    const root = path.resolve(workspaceRoot);
    const configPath = this.resolveTsConfigPath(root, options);
    
    let program: ts.Program;
    if (configPath) {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
      program = ts.createProgram(parsed.fileNames, parsed.options);
    } else {
      program = ts.createProgram(
        filePaths.map(filePath => path.resolve(filePath)),
        {
          target: ts.ScriptTarget.Latest,
          module: ts.ModuleKind.CommonJS,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
          skipLibCheck: true,
        },
      );
    }

    const checker = program.getTypeChecker();
    const nodes: FunctionNode[] = [];
    const nodeIdByDecl = new Map<ts.Node, string>();
    const nodeIdBySymbol = new Map<ts.Symbol, string>();
    const edges: CallEdge[] = [];
    const edgeKeys = new Set<string>();
    
    const requestedPaths = new Set(filePaths.map(p => path.normalize(path.resolve(p))));

    const allSourceFiles = program.getSourceFiles().filter(sourceFile => {
      return !sourceFile.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sourceFile);
    });

    // First pass: Collect nodes only for requested files
    for (const sourceFile of allSourceFiles) {
      const normalizedSourcePath = path.normalize(sourceFile.fileName);
      const isRequested = requestedPaths.has(normalizedSourcePath);

      const collectScope = (parentName: string | undefined) => (node: ts.Node) => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          const className = node.name?.text ?? parentName ?? 'anonymous';
          ts.forEachChild(node, collectScope(className));
          return;
        }

        const declared = describeFunction(node, parentName);
        if (declared) {
          const file = normalizedSourcePath;
          const id = makeId(file, declared.name, declared.range);
          
          if (isRequested) {
            nodes.push({ id, name: declared.name, kind: declared.kind, file, range: declared.range });
            nodeIdByDecl.set(declared.declNode, id);
          }

          const symbol = this.getFunctionSymbol(declared.declNode, checker);
          if (symbol) {
            nodeIdBySymbol.set(this.resolveAliasedSymbol(symbol, checker), id);
          }
        }

        ts.forEachChild(node, collectScope(parentName));
      };

      ts.forEachChild(sourceFile, collectScope(undefined));
    }

    // Second pass: Collect edges and ensure callee nodes exist
    const nodeIds = new Set(nodes.map(n => n.id));
    
    for (const sourceFile of allSourceFiles) {
      if (!requestedPaths.has(path.normalize(sourceFile.fileName))) continue;

      const visitCall = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callerId = enclosingFunctionId(node, nodeIdByDecl);
          const calleeId = this.resolveTypedCalleeId(node.expression, checker, nodeIdBySymbol);
          
          if (callerId && calleeId) {
            const key = `${callerId}->${calleeId}`;
            if (!edgeKeys.has(key)) {
              edgeKeys.add(key);
              edges.push({ from: callerId, to: calleeId });
              
              // If the callee is in another file, it might not be in our nodes list.
              // We need to find its info and add a "referenced" node.
              if (!nodeIds.has(calleeId)) {
                const calleeSymbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
                const resolvedSymbol = calleeSymbol ? this.resolveAliasedSymbol(calleeSymbol, checker) : undefined;
                const decl = resolvedSymbol?.declarations?.[0];
                
                if (decl) {
                  const calleeFile = path.normalize(decl.getSourceFile().fileName);
                  const desc = describeFunction(decl, undefined); // We might lose parent class name here but id is accurate
                  if (desc) {
                    nodes.push({
                      id: calleeId,
                      name: desc.name,
                      kind: desc.kind,
                      file: calleeFile,
                      range: desc.range
                    });
                    nodeIds.add(calleeId);
                  }
                }
              }
            }
          }
        }

        ts.forEachChild(node, visitCall);
      };

      ts.forEachChild(sourceFile, visitCall);
    }

    return {
      nodes,
      edges,
      metadata: {
        engine: this.getName(),
        language: 'TypeScript/JavaScript',
        precision: this.getPrecision(),
      },
    };
  }

  private resolveTsConfigPath(searchRoot: string, options: any): string | undefined {
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

  private getFunctionSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
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

  private resolveTypedCalleeId(
    expression: ts.Expression,
    checker: ts.TypeChecker,
    nodeIdBySymbol: Map<ts.Symbol, string>,
  ): string | undefined {
    const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
    const symbol = checker.getSymbolAtLocation(symbolNode);
    if (!symbol) return undefined;

    const resolved = this.resolveAliasedSymbol(symbol, checker);
    return nodeIdBySymbol.get(resolved) ?? nodeIdBySymbol.get(symbol);
  }

  private resolveAliasedSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;

    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
}
