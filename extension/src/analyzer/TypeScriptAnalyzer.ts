import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { Analyzer, AnalyzerOptions, CallEdge, CallGraph, FunctionNode, PrecisionTier } from './types';
import { describeFunction, enclosingFunctionId, getOwnerName, makeId } from './utils';

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

  async analyze(workspaceRoot: string, filePaths: string[], options: AnalyzerOptions = {}): Promise<CallGraph> {
    const root = path.resolve(workspaceRoot);
    const configPath = this.resolveTsConfigPath(root, options);
    
    let program: ts.Program;
    try {
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
    } catch (err) {
      throw new Error(`Failed to create TypeScript program: ${err}`);
    }

    const checker = program.getTypeChecker();
    const nodes: FunctionNode[] = [];
    const nodeIdByDecl = new Map<ts.Node, string>();
    const nodeIdBySymbol = new Map<ts.Symbol, string>();
    const edges: CallEdge[] = [];
    const edgeKeys = new Set<string>();
    
    const requestedPaths = new Set(filePaths.map(p => path.normalize(path.resolve(p))));
    const limitPaths = options.limitToFiles 
      ? new Set(options.limitToFiles.map(p => path.normalize(path.resolve(p))))
      : undefined;

    const allSourceFiles = program.getSourceFiles().filter(sourceFile => {
      return !sourceFile.isDeclarationFile && !program.isSourceFileFromExternalLibrary(sourceFile);
    });

    // First pass: Collect nodes from requested files
    for (const sourceFile of allSourceFiles) {
      const normalizedSourcePath = path.normalize(sourceFile.fileName);
      const canBePrimaryNode = limitPaths 
        ? limitPaths.has(normalizedSourcePath)
        : requestedPaths.has(normalizedSourcePath);

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
          
          if (canBePrimaryNode) {
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

    // Second pass: Collect edges and ensure referenced nodes exist
    const nodeIds = new Set(nodes.map(n => n.id));
    
    for (const sourceFile of allSourceFiles) {
      const normalizedSourcePath = path.normalize(sourceFile.fileName);
      const canBeSource = limitPaths 
        ? limitPaths.has(normalizedSourcePath)
        : requestedPaths.has(normalizedSourcePath);

      if (!canBeSource) continue;

      const visitCall = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callerId = enclosingFunctionId(node, nodeIdByDecl);
          const calleeId = this.resolveTypedCalleeId(node.expression, checker, nodeIdBySymbol);
          
          if (callerId) {
            const key = `${callerId}->${calleeId || 'unresolved'}`;
            if (calleeId) {
              if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                edges.push({ from: callerId, to: calleeId });
                
                if (!nodeIds.has(calleeId)) {
                  const calleeSymbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
                  const resolvedSymbol = calleeSymbol ? this.resolveAliasedSymbol(calleeSymbol, checker) : undefined;
                  const decl = resolvedSymbol?.declarations?.[0];
                  
                  if (decl) {
                    const calleeFile = path.normalize(decl.getSourceFile().fileName);
                    const ownerName = getOwnerName(decl);
                    const desc = describeFunction(decl, ownerName);
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
            } else if (!edgeKeys.has(key)) {
              edgeKeys.add(key);
              // In v2.1, we signal unresolved calls
              edges.push({ from: callerId, to: 'unresolved', unresolved: true });
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

  private resolveTsConfigPath(searchRoot: string, options: AnalyzerOptions): string | undefined {
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
