import * as assert from 'assert';
import * as vscode from 'vscode';
import { generateUlid } from '../../ulid';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('codetrace.codetrace');
    if (ext) {
      await ext.activate();
    } else {
      throw new Error('Extension not found');
    }
  });

  test('generateUlid returns a valid format', () => {
    const id = generateUlid();
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(id.length, 26, 'ULID should be 26 characters');
    assert.ok(/^[0-9A-HJKMNP-TV-Z]+$/.test(id), 'ULID should use Crockford Base32 characters');
  });

  test('generateUlid returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUlid()));
    assert.strictEqual(ids.size, 100, 'All generated ULIDs should be unique');
  });
});
