import * as fs from 'fs';
import * as ts from 'typescript';
import type { CallEdge, CallGraph, FunctionKind, FunctionNode, SourceRange } from './types';

export function extractCallGraph(filePath: string): CallGraph {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  const nodes: FunctionNode[] = [];
  const nodeIdByDecl = new Map<ts.Node, string>();
  const edges: CallEdge[] = [];

  // First pass: collect every function-like declaration with a stable name.
  const collectScope = (parentName: string | undefined) => (node: ts.Node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const className = node.name?.text ?? parentName ?? 'anonymous';
      ts.forEachChild(node, collectScope(className));
      return;
    }

    const declared = describeFunction(node, parentName);
    if (declared) {
      const id = makeId(filePath, declared.name, declared.range);
      nodes.push({ id, name: declared.name, kind: declared.kind, file: filePath, range: declared.range });
      nodeIdByDecl.set(declared.declNode, id);
    }
    ts.forEachChild(node, collectScope(parentName));
  };
  ts.forEachChild(sourceFile, collectScope(undefined));

  // Second pass: for each call expression, attribute it to the enclosing function node.
  const visitCall = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callerId = enclosingFunctionId(node, nodeIdByDecl);
      const callee = resolveCallee(node.expression, nodes, callerId);
      if (callerId && callee) {
        edges.push({ from: callerId, to: callee.id });
      }
    }
    ts.forEachChild(node, visitCall);
  };
  ts.forEachChild(sourceFile, visitCall);

  return { nodes, edges };
}

interface FunctionDescriptor {
  name: string;
  kind: FunctionKind;
  range: SourceRange;
  declNode: ts.Node;
}

function describeFunction(node: ts.Node, parentName: string | undefined): FunctionDescriptor | undefined {
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

function rangeOf(node: ts.Node): SourceRange {
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

function makeId(filePath: string, name: string, range: SourceRange): string {
  return `${filePath}#${name}@${range.startLine}:${range.startColumn}`;
}

function enclosingFunctionId(node: ts.Node, nodeIdByDecl: Map<ts.Node, string>): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const id = nodeIdByDecl.get(current);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function resolveCallee(
  expression: ts.Expression,
  nodes: FunctionNode[],
  callerId: string | undefined,
): FunctionNode | undefined {
  if (ts.isIdentifier(expression)) {
    return nodes.find(n => n.name === expression.text);
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const methodName = expression.name.text;

    // `this.method()` — resolve within the same class as the caller.
    if (expression.expression.kind === ts.SyntaxKind.ThisKeyword && callerId) {
      const caller = nodes.find(n => n.id === callerId);
      const className = caller?.kind === 'method' ? caller.name.split('.')[0] : undefined;
      if (className) {
        const qualified = `${className}.${methodName}`;
        const exact = nodes.find(n => n.name === qualified);
        if (exact) return exact;
      }
    }

    // `Class.method()` — qualified match against the receiver identifier.
    if (ts.isIdentifier(expression.expression)) {
      const qualified = `${expression.expression.text}.${methodName}`;
      return nodes.find(n => n.name === qualified);
    }

    // Receivers we can't statically attribute (parameters, returns, calls, etc.)
    // are intentionally not matched: a name-only fallback would create
    // false-positive edges to unrelated methods that happen to share a name.
    // Cross-file/typed resolution will land in #53.
    return undefined;
  }

  return undefined;
}
