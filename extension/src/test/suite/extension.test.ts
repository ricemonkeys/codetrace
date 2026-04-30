import * as assert from 'assert';
import * as vscode from 'vscode';
import { generateUlid } from '../../ulid';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  suiteSetup(async () => {
    // Activate the extension before running tests
    const ext = vscode.extensions.getExtension('codetrace.codetrace');
    if (ext) {
      await ext.activate();
    } else {
      throw new Error('Extension not found');
    }
  });

  test('Command codetrace.addSelectionToCanvas is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('codetrace.addSelectionToCanvas'), 'Command should be registered');
  });

  test('generateUlid returns a valid format', () => {
    const id = generateUlid();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 0, 'ULID should not be empty');
    assert.ok(/^[0-9a-zA-Z]+$/.test(id), 'ULID should contain alphanumeric characters');
  });

  test('CanvasEditorProvider getActivePanel behavior', () => {
    const { CanvasEditorProvider } = require('../../CanvasEditorProvider');
    assert.ok(CanvasEditorProvider, 'CanvasEditorProvider should be exportable');
    assert.strictEqual(typeof CanvasEditorProvider.getActivePanel, 'function', 'getActivePanel should be a function');
    const activePanel = CanvasEditorProvider.getActivePanel();
    assert.strictEqual(activePanel, undefined, 'Initially active panel should be undefined');
  });
});
