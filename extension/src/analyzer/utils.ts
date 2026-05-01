import * as ts from 'typescript';
import type { FunctionKind, SourceRange } from './types';

export function describeFunction(node: ts.Node, parentName: string | undefined): { name: string; kind: FunctionKind; range: SourceRange; declNode: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: 'function',
      range: rangeOf(node),
      declNode: node,
    };
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    const owner = parentName ?? 'anonymous';
    return {
      name: `${owner}.${node.name.text}`,
      kind: 'method',
      range: rangeOf(node),
      declNode: node,
    };
  }

  if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
    const init = node.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return {
        name: node.name.text,
        kind: ts.isArrowFunction(init) ? 'arrow' : 'function',
        range: rangeOf(init),
        declNode: init,
      };
    }
  }

  return undefined;
}

export function rangeOf(node: ts.Node): SourceRange {
  const sourceFile = node.getSourceFile();
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function makeId(filePath: string, name: string, range: SourceRange): string {
  return `${filePath}#${name}@${range.startLine}:${range.startColumn}`;
}

export function enclosingFunctionId(node: ts.Node, nodeIdByDecl: Map<ts.Node, string>): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const id = nodeIdByDecl.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}
