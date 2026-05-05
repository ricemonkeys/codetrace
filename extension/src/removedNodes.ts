import * as fs from 'fs/promises';
import * as path from 'path';

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface DeletionGraphNode {
  id: string;
  name: string;
  kind?: string;
  file: string;
  range: SourceRange;
}

export type DeletionImpactCase =
  | 'simple-call'
  | 'value-used-call'
  | 'named-import'
  | 'unknown';

export interface DeletionImpact {
  caseType: DeletionImpactCase;
  callerId?: string;
  callerName?: string;
  file: string;
  range: SourceRange;
  preview: string;
}

export interface DeletionImpactRequest {
  requestId: string;
  node: DeletionGraphNode;
  callers: DeletionGraphNode[];
}

export interface DeletionImpactResponse {
  requestId: string;
  node: DeletionGraphNode;
  impacts: DeletionImpact[];
}

export interface RemovedNodeLogEntry {
  timestamp?: string;
  node: DeletionGraphNode;
  callerCount: number;
  stickyCount: number;
  stickyReviewIds?: string[];
  decision: 'confirmed';
  impacts: DeletionImpact[];
}

export interface GraphLike<TNode extends { id: string }, TEdge extends { from: string; to: string }> {
  nodes: TNode[];
  edges: TEdge[];
}

const REMOVED_LOG_PATH = path.join('.codetrace', 'removed.log');

export async function analyzeNodeDeletionImpact(
  workspaceRoot: string,
  request: DeletionImpactRequest,
): Promise<DeletionImpactResponse> {
  const impacts: DeletionImpact[] = [];
  const seenImportFiles = new Set<string>();

  for (const caller of uniqueCallers(request.callers)) {
    const filePath = resolveWorkspacePath(workspaceRoot, caller.file);
    let content: string;

    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      impacts.push(unknownImpact(caller));
      continue;
    }

    const importImpact = findNamedImportImpact(content, caller, request.node);
    if (importImpact && !seenImportFiles.has(importImpact.file)) {
      impacts.push(importImpact);
      seenImportFiles.add(importImpact.file);
    }

    impacts.push(classifyCallerImpact(content, caller, request.node));
  }

  return {
    requestId: request.requestId,
    node: request.node,
    impacts,
  };
}

export async function appendRemovedNodeLog(
  workspaceRoot: string,
  entry: RemovedNodeLogEntry,
): Promise<void> {
  const logPath = path.join(workspaceRoot, REMOVED_LOG_PATH);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const payload = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export async function readRemovedNodeIds(workspaceRoot: string): Promise<Set<string>> {
  const logPath = path.join(workspaceRoot, REMOVED_LOG_PATH);
  const ids = new Set<string>();
  let content: string;

  try {
    content = await fs.readFile(logPath, 'utf8');
  } catch {
    return ids;
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<RemovedNodeLogEntry>;
      if (parsed.decision === 'confirmed' && parsed.node?.id) {
        ids.add(parsed.node.id);
      }
    } catch {
      // Keep old or hand-edited log lines from breaking analysis.
    }
  }

  return ids;
}

export function filterRemovedNodes<
  TNode extends { id: string },
  TEdge extends { from: string; to: string },
  TGraph extends GraphLike<TNode, TEdge>,
>(graph: TGraph, removedNodeIds: ReadonlySet<string>): TGraph {
  if (removedNodeIds.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !removedNodeIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to),
    ),
  };
}

function classifyCallerImpact(
  content: string,
  caller: DeletionGraphNode,
  target: DeletionGraphNode,
): DeletionImpact {
  const lines = splitLines(content);
  const names = candidateNames(target);
  const start = lineIndex(caller.range.startLine);
  const end = Math.min(lines.length, Math.max(start + 1, lineIndex(caller.range.endLine) + 1));

  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? '';
    const match = findCallMatch(line, names);
    if (!match) continue;

    const range = {
      startLine: index + 1,
      startColumn: match.index + 1,
      endLine: index + 1,
      endColumn: line.length + 1,
    };
    return {
      caseType: isSimpleCallStatement(line, match.index, match.name)
        ? 'simple-call'
        : 'value-used-call',
      callerId: caller.id,
      callerName: caller.name,
      file: caller.file,
      range,
      preview: line.trim(),
    };
  }

  return unknownImpact(caller);
}

function findNamedImportImpact(
  content: string,
  caller: DeletionGraphNode,
  target: DeletionGraphNode,
): DeletionImpact | undefined {
  const name = simpleName(target.name);
  const pattern = new RegExp(
    `\\bimport\\s*\\{[^}]*\\b${escapeRegExp(name)}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]\\s*;?`,
  );
  const match = content.match(pattern);
  if (!match || match.index === undefined) return undefined;

  return {
    caseType: 'named-import',
    callerId: caller.id,
    callerName: caller.name,
    file: caller.file,
    range: rangeFromOffsets(content, match.index, match.index + match[0].length),
    preview: compactPreview(match[0]),
  };
}

function unknownImpact(caller: DeletionGraphNode): DeletionImpact {
  return {
    caseType: 'unknown',
    callerId: caller.id,
    callerName: caller.name,
    file: caller.file,
    range: caller.range,
    preview: `${caller.name} (${caller.range.startLine}:${caller.range.startColumn})`,
  };
}

function uniqueCallers(callers: readonly DeletionGraphNode[]): DeletionGraphNode[] {
  const seen = new Set<string>();
  const out: DeletionGraphNode[] = [];
  for (const caller of callers) {
    if (seen.has(caller.id)) continue;
    seen.add(caller.id);
    out.push(caller);
  }
  return out;
}

function candidateNames(target: DeletionGraphNode): string[] {
  const names = [target.name, simpleName(target.name)];
  const symbolPart = target.id.split('#')[1]?.split('@')[0];
  if (symbolPart) {
    names.push(symbolPart, simpleName(symbolPart));
  }
  return Array.from(new Set(names.filter(Boolean)));
}

function simpleName(name: string): string {
  return name.split('.').pop() ?? name;
}

function findCallMatch(
  line: string,
  names: readonly string[],
): { index: number; name: string } | undefined {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const pattern = new RegExp(`(?:\\b|\\.)${escaped}\\s*\\(`);
    const match = line.match(pattern);
    if (!match || match.index === undefined) continue;
    const offset = match[0].startsWith('.') ? 1 : 0;
    return { index: match.index + offset, name };
  }
  return undefined;
}

function isSimpleCallStatement(line: string, _matchIndex: number, name: string): boolean {
  const trimmed = line.trim().replace(/;$/, '').trim();
  const receiver = String.raw`(?:[A-Za-z_$][\w$]*\.)*`;
  const pattern = new RegExp(`^(?:await\\s+)?${receiver}${escapeRegExp(name)}\\s*\\([\\s\\S]*\\)$`);
  return pattern.test(trimmed);
}

function resolveWorkspacePath(workspaceRoot: string, file: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Removed node file is outside the workspace: ${file}`);
  }
  return target;
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split('\n');
}

function compactPreview(content: string): string {
  return splitLines(content)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function rangeFromOffsets(content: string, startOffset: number, endOffset: number): SourceRange {
  const start = positionFromOffset(content, startOffset);
  const end = positionFromOffset(content, endOffset);
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function positionFromOffset(content: string, offset: number): { line: number; column: number } {
  const before = content.slice(0, offset).replace(/\r\n/g, '\n');
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return {
    line,
    column: before.length - lastNewline,
  };
}

function lineIndex(line: number): number {
  if (!Number.isFinite(line)) return 0;
  return Math.max(0, Math.floor(line) - 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
