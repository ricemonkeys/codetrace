import * as vscode from 'vscode';
import { CanvasPanel } from './canvasPanel';

export function activate(context: vscode.ExtensionContext) {
  const openCanvas = vscode.commands.registerCommand('codetrace.openCanvas', () => {
    CanvasPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(openCanvas);
}

export function deactivate() {}
