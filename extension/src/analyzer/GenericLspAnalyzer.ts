import * as vscode from 'vscode';
import type { Analyzer, AnalyzerOptions, CallGraph, FunctionNode, PrecisionTier } from './types';

export class GenericLspAnalyzer implements Analyzer {
  getName(): string {
    return 'VS Code LSP Adapter';
  }

  getPrecision(): PrecisionTier {
    return 'standard';
  }

  canAnalyze(filePaths: string[]): boolean {
    return filePaths.length > 0;
  }

  async analyze(workspaceRoot: string, filePaths: string[], options: AnalyzerOptions = {}): Promise<CallGraph> {
    const nodes: FunctionNode[] = [];
    const edges: { from: string; to: string }[] = [];
    const nodeMap = new Map<string, FunctionNode>();

    for (const filePath of filePaths) {
      const uri = vscode.Uri.file(filePath);
      try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          uri
        );

        if (symbols) {
          const flatSymbols = this._flattenSymbols(symbols, uri);
          for (const symbol of flatSymbols) {
            const isCallable = symbol.kind === vscode.SymbolKind.Function || 
                               symbol.kind === vscode.SymbolKind.Method || 
                               symbol.kind === vscode.SymbolKind.Constructor;

            if (isCallable) {
              const id = `${uri.fsPath}#${symbol.name}@${symbol.range.start.line + 1}:${symbol.range.start.character + 1}`;
              const node: FunctionNode = {
                id,
                name: symbol.name,
                kind: this._mapKind(symbol.kind),
                file: uri.fsPath,
                range: {
                  startLine: symbol.range.start.line + 1,
                  startColumn: symbol.range.start.character + 1,
                  endLine: symbol.range.end.line + 1,
                  endColumn: symbol.range.end.character + 1
                }
              };
              nodes.push(node);
              nodeMap.set(id, node);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to analyze ${filePath}: ${err}`);
      }
    }

    // Second pass for edges
    for (const node of nodes) {
      try {
        const uri = vscode.Uri.file(node.file);
        const pos = new vscode.Position(node.range.startLine - 1, node.range.startColumn - 1);
        
        const callItems = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
          'vscode.prepareCallHierarchy',
          uri,
          pos
        );

        if (callItems && callItems.length > 0) {
          const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
            'vscode.provideOutgoingCalls',
            callItems[0]
          );

          if (outgoing) {
            for (const call of outgoing) {
              const toId = `${call.to.uri.fsPath}#${call.to.name}@${call.to.selectionRange.start.line + 1}:${call.to.selectionRange.start.character + 1}`;
              edges.push({ from: node.id, to: toId });
              
              if (!nodeMap.has(toId)) {
                const newNode: FunctionNode = {
                  id: toId,
                  name: call.to.name,
                  kind: this._mapKind(call.to.kind),
                  file: call.to.uri.fsPath,
                  range: {
                    startLine: call.to.selectionRange.start.line + 1,
                    startColumn: call.to.selectionRange.start.character + 1,
                    endLine: call.to.selectionRange.end.line + 1,
                    endColumn: call.to.selectionRange.end.character + 1
                  }
                };
                nodes.push(newNode);
                nodeMap.set(toId, newNode);
              }
            }
          }
        }
      } catch (err) {
        // Some symbols might not support call hierarchy
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        engine: this.getName(),
        language: 'Generic (LSP)',
        precision: this.getPrecision(),
      }
    };
  }

  private _flattenSymbols(symbols: vscode.DocumentSymbol[], uri: vscode.Uri): vscode.DocumentSymbol[] {
    const flat: vscode.DocumentSymbol[] = [];
    const traverse = (s: vscode.DocumentSymbol) => {
      flat.push(s);
      s.children?.forEach(traverse);
    };
    symbols.forEach(traverse);
    return flat;
  }

  private _mapKind(kind: vscode.SymbolKind): 'function' | 'method' | 'arrow' {
    if (kind === vscode.SymbolKind.Method) return 'method';
    return 'function'; // Default for LSP
  }
}
