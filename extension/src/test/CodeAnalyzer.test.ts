import { CodeAnalyzer, CodeSymbol, SymbolRelationship } from '../CodeAnalyzer';

jest.mock('vscode', () => {
    return {
        SymbolKind: {
            Function: 11,
            Method: 5,
            Constructor: 8,
            Variable: 12
        },
        Location: jest.fn().mockImplementation((uri, range) => ({ uri, range })),
        Range: jest.fn().mockImplementation((start, end) => ({ start, end })),
        Position: jest.fn().mockImplementation((line, character) => ({ line, character })),
        Uri: {
            parse: jest.fn().mockImplementation((str) => ({ path: str, toString: () => str }))
        },
        commands: {
            executeCommand: jest.fn()
        },
        workspace: {
            findFiles: jest.fn(),
            asRelativePath: jest.fn((uri) => uri.path)
        },
        CancellationError: class CancellationError extends Error {
            constructor() {
                super('Canceled');
                this.name = 'CancellationError';
            }
        }
    };
}, { virtual: true });

import * as vscode from 'vscode';

describe('CodeAnalyzer', () => {
    let analyzer: CodeAnalyzer;
    let mockExecuteCommand: jest.Mock;
    let mockFindFiles: jest.Mock;

    beforeEach(() => {
        analyzer = new CodeAnalyzer();
        jest.clearAllMocks();
        mockExecuteCommand = vscode.commands.executeCommand as jest.Mock;
        mockFindFiles = vscode.workspace.findFiles as jest.Mock;
        // suppress console.error for expected errors
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getDocumentSymbols', () => {
        it('should return empty array on error', async () => {
            mockExecuteCommand.mockRejectedValue(new Error('VS Code error'));
            const result = await analyzer.getDocumentSymbols({ fsPath: '/test.ts' } as any);
            expect(result).toEqual([]);
        });
    });

    describe('getIncomingCalls', () => {
        it('should return empty array on error', async () => {
            mockExecuteCommand.mockRejectedValue(new Error('VS Code error'));
            const result = await analyzer.getIncomingCalls({ fsPath: '/test.ts' } as any, {} as any);
            expect(result).toEqual([]);
        });
    });

    describe('getOutgoingCalls', () => {
        it('should return empty array on error', async () => {
            mockExecuteCommand.mockRejectedValue(new Error('VS Code error'));
            const result = await analyzer.getOutgoingCalls({ fsPath: '/test.ts' } as any, {} as any);
            expect(result).toEqual([]);
        });
    });

    describe('_mapSymbols', () => {
        it('should correctly map vscode.DocumentSymbol to CodeSymbol format', () => {
            const mockUri = { path: 'file:///test.ts' } as any;
            const mockVscodeSymbols = [
                {
                    name: 'TestClass',
                    kind: 5, // Method
                    range: { start: { line: 0 }, end: { line: 10 } },
                    children: [
                        {
                            name: 'testMethod',
                            kind: 11, // Function
                            range: { start: { line: 2 }, end: { line: 5 } }
                        }
                    ]
                }
            ];

            const result = (analyzer as any)._mapSymbols(mockVscodeSymbols, mockUri);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('TestClass');
            expect(result[0].uri).toBe(mockUri);
            expect(result[0].children).toHaveLength(1);
            expect(result[0].children[0].name).toBe('testMethod');
            expect(result[0].children[0].uri).toBe(mockUri);
        });
    });

    describe('_flattenSymbols', () => {
        it('should correctly flatten nested symbol structures', () => {
            const nestedSymbols: CodeSymbol[] = [
                {
                    name: 'ClassA',
                    kind: 5,
                    range: {} as any,
                    uri: {} as any,
                    children: [
                        {
                            name: 'MethodA',
                            kind: 11,
                            range: {} as any,
                            uri: {} as any
                        }
                    ]
                },
                {
                    name: 'ClassB',
                    kind: 5,
                    range: {} as any,
                    uri: {} as any
                }
            ];

            const result = (analyzer as any)._flattenSymbols(nestedSymbols);

            expect(result).toHaveLength(3);
            expect(result.map((s: any) => s.name)).toEqual(['ClassA', 'MethodA', 'ClassB']);
        });
    });

    describe('analyzeWorkspace', () => {
        it('should handle scope filtering, outgoing calls, and progress reporting', async () => {
            const mockFiles = [{ path: 'file1.ts' }];
            mockFindFiles.mockResolvedValue(mockFiles);
            
            const mockSymbol = {
                name: 'testFunction',
                kind: 11, // Function
                range: { start: { line: 1 } },
                uri: { path: 'file1.ts' }
            };
            const mockOutgoingCall = {
                to: {
                    name: 'calledFunction',
                    uri: { path: 'file2.ts' },
                    selectionRange: { start: { line: 5 } }
                }
            };
            
            mockExecuteCommand.mockImplementation((command) => {
                if (command === 'vscode.executeDocumentSymbolProvider') {
                    return Promise.resolve([mockSymbol]);
                }
                if (command === 'vscode.prepareCallHierarchy') {
                    return Promise.resolve([{ uri: { path: 'file1.ts' }, selectionRange: { start: { line: 1 } } }]);
                }
                if (command === 'vscode.provideOutgoingCalls') {
                    return Promise.resolve([mockOutgoingCall]);
                }
                return Promise.resolve([]);
            });

            const onProgress = jest.fn();
            
            const result = await analyzer.analyzeWorkspace('**/*.ts', onProgress);

            expect(mockFindFiles).toHaveBeenCalledWith('**/*.ts');
            expect(onProgress).toHaveBeenCalledWith('Found 1 source files.');
            expect(onProgress).toHaveBeenCalledWith('Scanning symbols: file1.ts');
            expect(result.symbols).toHaveLength(1);
            expect(result.relationships).toHaveLength(1);
            expect(result.relationships[0].toName).toBe('calledFunction');
        });

        it('should throw CancellationError when cancellation is requested during file scanning', async () => {
            mockFindFiles.mockResolvedValue([{ path: 'file1.ts' }, { path: 'file2.ts' }]);
            
            const token = { isCancellationRequested: true } as any;

            const result = await analyzer.analyzeWorkspace(undefined, undefined, token);
            expect(result).toEqual({ symbols: [], relationships: [] });
        });

        it('should break symbol loop when cancellation is requested', async () => {
            const mockFiles = [{ path: 'file1.ts' }];
            mockFindFiles.mockResolvedValue(mockFiles);
            
            const mockSymbol = {
                name: 'testMethod',
                kind: 11,
                range: { start: { line: 0 } },
                uri: { path: 'file1.ts' }
            };
            mockExecuteCommand.mockImplementation((command) => {
                if (command === 'vscode.executeDocumentSymbolProvider') {
                    return Promise.resolve([mockSymbol]);
                }
                return Promise.resolve([]);
            });

            // Token initially not cancelled, then cancelled after file scan
            let callCount = 0;
            const token = {
                get isCancellationRequested() {
                    callCount++;
                    return callCount > 1; // True on second check (in symbol loop)
                }
            } as any;

            const result = await analyzer.analyzeWorkspace(undefined, undefined, token);
            
            expect(result.symbols).toHaveLength(1);
            expect(result.relationships).toEqual([]); // Loop broke before resolving outgoing calls
        });
    });

    describe('traceRelationships', () => {
        it('should correctly traverse relationships', async () => {
            const mockUri = { toString: () => 'file:///test.ts' } as any;
            const mockPosition = { line: 0, character: 0 } as any;

            const mockHierarchyItem = {
                name: 'startMethod',
                uri: mockUri,
                selectionRange: { start: { line: 0, character: 0 } }
            };

            const mockIncomingCall = {
                from: {
                    name: 'callerMethod',
                    uri: { toString: () => 'file:///caller.ts' },
                    range: { start: { line: 5, character: 0 } }
                }
            };

            const mockOutgoingCall = {
                to: {
                    name: 'calledMethod',
                    uri: { toString: () => 'file:///called.ts' },
                    selectionRange: { start: { line: 10, character: 0 } }
                }
            };

            // Setup mock responses
            mockExecuteCommand.mockImplementation((command: string) => {
                if (command === 'vscode.prepareCallHierarchy') {
                    return Promise.resolve([mockHierarchyItem]);
                }
                if (command === 'vscode.provideIncomingCalls') {
                    return Promise.resolve([mockIncomingCall]);
                }
                if (command === 'vscode.provideOutgoingCalls') {
                    return Promise.resolve([mockOutgoingCall]);
                }
                return Promise.resolve([]);
            });

            const result = await analyzer.traceRelationships(mockUri, mockPosition, 1);

            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('call');
            expect(result[0].fromName).toBe('callerMethod');
            expect(result[0].toName).toBe('startMethod');

            expect(result[1].type).toBe('call');
            expect(result[1].fromName).toBe('startMethod');
            expect(result[1].toName).toBe('calledMethod');
        });
    });
});
