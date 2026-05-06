import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'codetrace.codetrace';

async function waitFor<T>(
  predicate: () => Promise<T | undefined> | T | undefined,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

suite('Extension E2E Suite', function () {
  this.timeout(120000);

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
    await ext!.activate();
  });

  test('analyzeWorkspace command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('codetrace.analyzeWorkspace'),
      'codetrace.analyzeWorkspace must be registered after activation',
    );
  });

  test('analyzeWorkspace produces analysis_cache.json with nodes', async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'test workspace must be open');
    const root = folders[0].uri;

    const cacheUri = vscode.Uri.joinPath(root, '.codetrace', 'analysis_cache.json');
    try {
      await vscode.workspace.fs.delete(cacheUri);
    } catch {
      // first run — file does not exist yet
    }

    await vscode.commands.executeCommand('codetrace.analyzeWorkspace');

    const bytes = await waitFor(async () => {
      try {
        return await vscode.workspace.fs.readFile(cacheUri);
      } catch {
        return undefined;
      }
    }, 60000);

    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    assert.ok(Array.isArray(parsed.nodes), 'cache must contain a nodes array');
    assert.ok(parsed.nodes.length > 0, 'analysis must produce at least one node');
    const names: string[] = parsed.nodes.map((n: { name: string }) => n.name);
    assert.ok(
      names.some(name => name === 'greet' || name === 'formatGreeting' || name === 'main'),
      `expected sample.ts symbols in nodes, got: ${names.join(', ')}`,
    );
  });

  test('opening a .codetrace file activates the custom editor', async () => {
    const folders = vscode.workspace.workspaceFolders!;
    const root = folders[0].uri;

    const canvasDir = vscode.Uri.joinPath(root, '.codetrace', 'canvases');
    await vscode.workspace.fs.createDirectory(canvasDir);
    const canvasFile = vscode.Uri.joinPath(canvasDir, 'e2e.codetrace');
    const initial = JSON.stringify(
      { version: 2, elements: [], appState: { collaborators: {} } },
      null,
      2,
    );
    await vscode.workspace.fs.writeFile(canvasFile, new TextEncoder().encode(initial));

    await vscode.commands.executeCommand('vscode.openWith', canvasFile, 'codetrace.canvasEditor');

    const tab = await waitFor(() => {
      for (const group of vscode.window.tabGroups.all) {
        for (const t of group.tabs) {
          if (
            t.input instanceof vscode.TabInputCustom &&
            t.input.viewType === 'codetrace.canvasEditor' &&
            path.basename(t.input.uri.fsPath) === 'e2e.codetrace'
          ) {
            return t;
          }
        }
      }
      return undefined;
    }, 15000);

    assert.ok(tab, 'custom editor tab must be open');
  });
});
