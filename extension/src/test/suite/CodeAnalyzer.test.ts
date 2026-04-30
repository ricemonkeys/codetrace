import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodeAnalyzer, CodeSymbol, SymbolRelationship } from '../../CodeAnalyzer';

suite('CodeAnalyzer Test Suite', () => {
    let analyzer: CodeAnalyzer;

    // Save original VS Code API methods to restore them later
    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalFindFiles = vscode.workspace.findFiles;
    const originalAsRelativePath = vscode.workspace.asRelativePath;

    // State for manual mocks
    let mockExecuteCommandImpl: (...args: any[]) => Promise<any> = async () => [];
    let mockFindFilesImpl: (...args: any[]) => Promise<any> = async () => [];
    
    // Track calls for assertions
    let executeCommandCalls: { command: string, args: any[] }[] = [];
    let findFilesCalls: any[][] = [];

    setup(() => {
        analyzer = new CodeAnalyzer();
        executeCommandCalls = [];
        findFilesCalls = [];
        mockExecuteCommandImpl = async () => [];
        mockFindFilesImpl = async () => [];

        // Override VS Code APIs
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            executeCommandCalls.push({ command, args });
            if (command.startsWith('vscode.prepareCallHierarchy') || command.startsWith('vscode.provide') || command === 'vscode.executeDocumentSymbolProvider') {
                return mockExecuteCommandImpl(command, ...args);
            }
            return originalExecuteCommand(command, ...args);
        };

        (vscode.workspace as any).findFiles = async (...args: any[]) => {
            findFilesCalls.push(args);
            return mockFindFilesImpl(...args);
        };

        (vscode.workspace as any).asRelativePath = (uri: vscode.Uri) => {
            return uri.path;
        };
    });

    teardown(() => {
        // Restore original APIs
        (vscode.commands as any).executeCommand = originalExecuteCommand;
        (vscode.workspace as any).findFiles = originalFindFiles;
        (vscode.workspace as any).asRelativePath = originalAsRelativePath;
    });

    suite('getDocumentSymbols', () => {
        test('should return empty array on error', async () => {
            mockExecuteCommandImpl = async () => { throw new Error('VS Code error'); };
            const result = await analyzer.getDocumentSymbols(vscode.Uri.file('/test.ts'));
            assert.deepStrictEqual(result, []);
        });
    });

    suite('getIncomingCalls', () => {
        test('should return empty array on error', async () => {
            mockExecuteCommandImpl = async () => { throw new Error('VS Code error'); };
            const result = await analyzer.getIncomingCalls(vscode.Uri.file('/test.ts'), new vscode.Position(0, 0));
            assert.deepStrictEqual(result, []);
        });
    });

    suite('getOutgoingCalls', () => {
        test('should return empty array on error', async () => {
            mockExecuteCommandImpl = async () => { throw new Error('VS Code error'); };
            const result = await analyzer.getOutgoingCalls(vscode.Uri.file('/test.ts'), new vscode.Position(0, 0));
            assert.deepStrictEqual(result, []);
        });
    });

    suite('_mapSymbols', () => {
        test('should correctly map vscode.DocumentSymbol to CodeSymbol format', () => {
            const mockUri = vscode.Uri.file('/test.ts');
            const mockVscodeSymbols: any[] = [
                {
                    name: 'TestClass',
                    kind: vscode.SymbolKind.Method,
                    range: new vscode.Range(0, 0, 10, 0),
                    children: [
                        {
                            name: 'testMethod',
                            kind: vscode.SymbolKind.Function,
                            range: new vscode.Range(2, 0, 5, 0)
                        }
                    ]
                }
            ];

            const result = (analyzer as any)._mapSymbols(mockVscodeSymbols, mockUri);

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'TestClass');
            assert.strictEqual(result[0].uri, mockUri);
            assert.strictEqual(result[0].children.length, 1);
            assert.strictEqual(result[0].children[0].name, 'testMethod');
            assert.strictEqual(result[0].children[0].uri, mockUri);
        });
    });

    suite('_flattenSymbols', () => {
        test('should correctly flatten nested symbol structures', () => {
            const nestedSymbols: CodeSymbol[] = [
                {
                    name: 'ClassA',
                    kind: vscode.SymbolKind.Method,
                    range: {} as any,
                    uri: {} as any,
                    children: [
                        {
                            name: 'MethodA',
                            kind: vscode.SymbolKind.Function,
                            range: {} as any,
                            uri: {} as any
                        }
                    ]
                },
                {
                    name: 'ClassB',
                    kind: vscode.SymbolKind.Method,
                    range: {} as any,
                    uri: {} as any
                }
            ];

            const result = (analyzer as any)._flattenSymbols(nestedSymbols);

            assert.strictEqual(result.length, 3);
            assert.deepStrictEqual(result.map((s: any) => s.name), ['ClassA', 'MethodA', 'ClassB']);
        });
    });

    suite('analyzeWorkspace', () => {
        test('should handle scope filtering, outgoing calls, and progress reporting', async () => {
            const mockFiles = [vscode.Uri.file('file1.ts')];
            mockFindFilesImpl = async () => mockFiles;
            
            const mockSymbol = {
                name: 'testFunction',
                kind: vscode.SymbolKind.Function,
                range: new vscode.Range(1, 0, 1, 0),
                uri: vscode.Uri.file('file1.ts')
            };

            const mockOutgoingCall = {
                to: {
                    name: 'calledFunction',
                    uri: vscode.Uri.file('file2.ts'),
                    selectionRange: new vscode.Range(5, 0, 5, 0)
                }
            };
            
            mockExecuteCommandImpl = async (command: string) => {
                if (command === 'vscode.executeDocumentSymbolProvider') {
                    return [mockSymbol];
                }
                if (command === 'vscode.prepareCallHierarchy') {
                    return [{ uri: vscode.Uri.file('file1.ts'), selectionRange: new vscode.Range(1, 0, 1, 0) }];
                }
                if (command === 'vscode.provideOutgoingCalls') {
                    return [mockOutgoingCall];
                }
                return [];
            };

            const progressMsgs: string[] = [];
            const onProgress = (msg: string) => progressMsgs.push(msg);
            
            const result = await analyzer.analyzeWorkspace('**/*.ts', onProgress);

            assert.strictEqual(findFilesCalls.length, 1);
            assert.strictEqual(findFilesCalls[0][0], '**/*.ts');
            assert.ok(progressMsgs.includes('Found 1 source files.'));
            assert.strictEqual(result.symbols.length, 1);
            assert.strictEqual(result.relationships.length, 1);
            assert.strictEqual(result.relationships[0].toName, 'calledFunction');
        });

        test('should throw CancellationError when cancellation is requested during file scanning', async () => {
            mockFindFilesImpl = async () => [vscode.Uri.file('file1.ts'), vscode.Uri.file('file2.ts')];
            
            const token = { isCancellationRequested: true } as any;

            await assert.rejects(
                async () => {
                    await analyzer.analyzeWorkspace(undefined, undefined, token);
                },
                (err: any) => err instanceof vscode.CancellationError || err.name === 'Canceled'
            );
        });

        test('should throw CancellationError when cancellation is requested in symbol loop', async () => {
            const mockFiles = [vscode.Uri.file('file1.ts')];
            mockFindFilesImpl = async () => mockFiles;
            
            const mockSymbol = {
                name: 'testMethod',
                kind: vscode.SymbolKind.Function,
                range: new vscode.Range(0, 0, 0, 0),
                uri: vscode.Uri.file('file1.ts')
            };

            mockExecuteCommandImpl = async (command: string) => {
                if (command === 'vscode.executeDocumentSymbolProvider') {
                    return [mockSymbol];
                }
                return [];
            };

            let callCount = 0;
            const token = {
                get isCancellationRequested() {
                    callCount++;
                    // False during file scanning, True during symbol loop
                    return callCount > 1; 
                }
            } as any;

            await assert.rejects(
                async () => {
                    await analyzer.analyzeWorkspace(undefined, undefined, token);
                },
                (err: any) => err instanceof vscode.CancellationError || err.name === 'Canceled'
            );
        });
    });

    suite('traceRelationships', () => {
        test('should correctly traverse relationships', async () => {
            const mockUri = vscode.Uri.file('/test.ts');
            const mockPosition = new vscode.Position(0, 0);

            const mockHierarchyItem = {
                name: 'startMethod',
                uri: mockUri,
                selectionRange: new vscode.Range(0, 0, 0, 0)
            };

            const mockIncomingCall = {
                from: {
                    name: 'callerMethod',
                    uri: vscode.Uri.file('/caller.ts'),
                    range: new vscode.Range(5, 0, 5, 0),
                    selectionRange: new vscode.Range(5, 0, 5, 0)
                }
            };

            const mockOutgoingCall = {
                to: {
                    name: 'calledMethod',
                    uri: vscode.Uri.file('/called.ts'),
                    selectionRange: new vscode.Range(10, 0, 10, 0)
                }
            };

            mockExecuteCommandImpl = async (command: string) => {
                if (command === 'vscode.prepareCallHierarchy') {
                    return [mockHierarchyItem];
                }
                if (command === 'vscode.provideIncomingCalls') {
                    return [mockIncomingCall];
                }
                if (command === 'vscode.provideOutgoingCalls') {
                    return [mockOutgoingCall];
                }
                return [];
            };

            const result = await analyzer.traceRelationships(mockUri, mockPosition, 1);

            // Should call prepareCallHierarchy ONLY ONCE at the root
            const prepareCalls = executeCommandCalls.filter(call => 
                call.command === 'vscode.prepareCallHierarchy' && 
                call.args[0] === mockUri
            );
            assert.strictEqual(prepareCalls.length, 1);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].type, 'call');
            assert.strictEqual(result[0].fromName, 'callerMethod');
            assert.strictEqual(result[0].toName, 'startMethod');

            assert.strictEqual(result[1].type, 'call');
            assert.strictEqual(result[1].fromName, 'startMethod');
            assert.strictEqual(result[1].toName, 'calledMethod');
        });
    });
});
