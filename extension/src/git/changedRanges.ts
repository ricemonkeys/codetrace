import * as path from 'path';
import type { FunctionNode, SourceRange } from '../analyzer/types';

export interface ChangedLineRange {
  startLine: number;
  endLine: number;
}

export type ChangedLineRangeMap = Map<string, ChangedLineRange[]>;

export function parseUnifiedDiffChangedRanges(
  diff: string,
  workspaceRoot: string,
): ChangedLineRangeMap {
  const ranges: ChangedLineRangeMap = new Map();
  let currentFile: string | undefined;
  let newLine = 0;
  let inHunk = false;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      currentFile = normalizeDiffPath(line.slice(4), workspaceRoot);
      inHunk = false;
      continue;
    }

    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      addChangedLine(ranges, currentFile, newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      addChangedLine(ranges, currentFile, Math.max(1, newLine));
      continue;
    }

    if (line.startsWith(' ') || line === '') {
      newLine += 1;
    }
  }

  return ranges;
}

export function markChangedFunctions(
  nodes: readonly FunctionNode[],
  changedRanges: ChangedLineRangeMap,
): FunctionNode[] {
  return nodes.map((node) => ({
    ...node,
    changedSinceBase: isFunctionChanged(node, changedRanges),
  }));
}

export function isFunctionChanged(
  node: FunctionNode,
  changedRanges: ChangedLineRangeMap,
): boolean {
  const ranges = changedRanges.get(normalizeFilePath(node.file));
  if (!ranges || ranges.length === 0) return false;
  return ranges.some((range) => rangesIntersect(node.range, range));
}

function addChangedLine(
  ranges: ChangedLineRangeMap,
  filePath: string,
  line: number,
): void {
  const existing = ranges.get(filePath) ?? [];
  const previous = existing[existing.length - 1];
  if (previous && previous.endLine + 1 >= line) {
    previous.endLine = Math.max(previous.endLine, line);
  } else {
    existing.push({ startLine: line, endLine: line });
  }
  ranges.set(filePath, existing);
}

function normalizeDiffPath(rawPath: string, workspaceRoot: string): string | undefined {
  const diffPath = unquoteDiffPath(rawPath.trim());
  if (!diffPath || diffPath === '/dev/null') return undefined;

  const withoutPrefix = diffPath.replace(/^[ab]\//, '');
  return normalizeFilePath(
    path.isAbsolute(withoutPrefix)
      ? withoutPrefix
      : path.resolve(workspaceRoot, withoutPrefix),
  );
}

function unquoteDiffPath(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

function normalizeFilePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

function rangesIntersect(left: SourceRange, right: ChangedLineRange): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}
