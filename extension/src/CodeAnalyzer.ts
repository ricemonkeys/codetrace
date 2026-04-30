import * as vscode from 'vscode';

export interface CodeSymbol {
    name: string;
    kind: vscode.SymbolKind;
    range: vscode.Range;
    uri: vscode.Uri;
    children?: CodeSymbol[];
}

export interface SymbolRelationship {
    from: vscode.Location;
    to: vscode.Location;
    type: 'call' | 'inheritance' | 'reference';
}

export class CodeAnalyzer {
    /**
     * 특정 문서의 심볼(클래스, 메서드 등)을 계층 구조로 가져옵니다.
     */
    async getDocumentSymbols(uri: vscode.Uri): Promise<CodeSymbol[]> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );
            if (!symbols) return [];
            return this._mapSymbols(symbols, uri);
        } catch (err) {
            console.error(`Failed to get symbols for ${uri.fsPath}: ${err}`);
            return [];
        }
    }

    /**
     * 특정 위치의 심볼에 대한 호출 계층(누가 호출하는지)을 가져옵니다.
     */
    async getIncomingCalls(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyIncomingCall[]> {
        try {
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                uri,
                position
            );

            if (!items || items.length === 0) return [];

            const incomingCalls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                'vscode.provideIncomingCalls',
                items[0]
            );

            return incomingCalls || [];
        } catch (err) {
            // 특정 심볼에 대해 Call Hierarchy가 지원되지 않을 수 있음
            return [];
        }
    }

    /**
     * 특정 위치의 심볼이 무엇을 호출하는지(피호출자)를 가져옵니다.
     */
    async getOutgoingCalls(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyOutgoingCall[]> {
        try {
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                uri,
                position
            );

            if (!items || items.length === 0) return [];

            const outgoingCalls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                'vscode.provideOutgoingCalls',
                items[0]
            );

            return outgoingCalls || [];
        } catch (err) {
            return [];
        }
    }

    /**
     * 특정 위치에서 시작하여 연관된 모든 관계(호출자 및 피호출자)를 탐색하여 그래프를 구성합니다.
     */
    async traceRelationships(uri: vscode.Uri, position: vscode.Position, depth: number = 1): Promise<SymbolRelationship[]> {
        const relationships: SymbolRelationship[] = [];
        const visited = new Set<string>();

        const explore = async (currUri: vscode.Uri, currPos: vscode.Position, currDepth: number) => {
            const key = `${currUri.toString()}:${currPos.line}:${currPos.character}`;
            if (visited.has(key) || currDepth > depth) return;
            visited.add(key);

            const incoming = await this.getIncomingCalls(currUri, currPos);
            for (const call of incoming) {
                relationships.push({
                    from: new vscode.Location(call.from.uri, call.from.range),
                    to: new vscode.Location(currUri, new vscode.Range(currPos, currPos)),
                    type: 'call'
                });
                if (currDepth < depth) {
                    await explore(call.from.uri, call.from.range.start, currDepth + 1);
                }
            }

            const outgoing = await this.getOutgoingCalls(currUri, currPos);
            for (const call of outgoing) {
                relationships.push({
                    from: new vscode.Location(currUri, new vscode.Range(currPos, currPos)),
                    to: new vscode.Location(call.to.uri, call.to.selectionRange),
                    type: 'call'
                });
                if (currDepth < depth) {
                    await explore(call.to.uri, call.to.selectionRange.start, currDepth + 1);
                }
            }
        };

        await explore(uri, position, 0);
        return relationships;
    }

    /**
     * 워크스페이스 내의 특정 범위 또는 모든 소스 파일을 스캔하여 심볼 및 호출 관계를 분석합니다.
     */
    async analyzeWorkspace(scope?: vscode.GlobPattern, onProgress?: (msg: string) => void): Promise<{ symbols: CodeSymbol[], relationships: SymbolRelationship[] }> {
        const allSymbols: CodeSymbol[] = [];
        const allRelationships: SymbolRelationship[] = [];
        
        const files = await vscode.workspace.findFiles(scope || '**/*.{ts,tsx,js,jsx,py,java,go}');
        onProgress?.(`Found ${files.length} source files.`);

        for (const file of files) {
            onProgress?.(`Scanning symbols: ${vscode.workspace.asRelativePath(file)}`);
            const symbols = await this.getDocumentSymbols(file);
            allSymbols.push(...symbols);
        }

        const flatSymbols = this._flattenSymbols(allSymbols);
        onProgress?.(`Analyzing relationships for ${flatSymbols.length} symbols...`);

        // 병렬 처리를 위해 chunk로 나누어 처리하거나 순차 처리 (LSP 부하 고려)
        let count = 0;
        for (const symbol of flatSymbols) {
            const isCallable = symbol.kind === vscode.SymbolKind.Function || 
                               symbol.kind === vscode.SymbolKind.Method || 
                               symbol.kind === vscode.SymbolKind.Constructor;

            if (isCallable) {
                const outgoing = await this.getOutgoingCalls(symbol.uri, symbol.range.start);
                for (const call of outgoing) {
                    allRelationships.push({
                        from: new vscode.Location(symbol.uri, symbol.range),
                        to: new vscode.Location(call.to.uri, call.to.selectionRange),
                        type: 'call'
                    });
                }
            }
            
            count++;
            if (count % 50 === 0) {
                onProgress?.(`Analyzed ${count}/${flatSymbols.length} symbols...`);
            }
        }

        return { symbols: allSymbols, relationships: allRelationships };
    }

    private _flattenSymbols(symbols: CodeSymbol[]): CodeSymbol[] {
        const flat: CodeSymbol[] = [];
        const traverse = (s: CodeSymbol) => {
            flat.push(s);
            s.children?.forEach(traverse);
        };
        symbols.forEach(traverse);
        return flat;
    }

    private _mapSymbols(symbols: vscode.DocumentSymbol[], uri: vscode.Uri): CodeSymbol[] {
        return symbols.map(s => ({
            name: s.name,
            kind: s.kind,
            range: s.range,
            uri: uri,
            children: s.children ? this._mapSymbols(s.children, uri) : undefined
        }));
    }
}
