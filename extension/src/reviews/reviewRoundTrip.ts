import { createHash } from 'crypto';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ReviewSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ReviewAnchor {
  nodeId?: string;
  symbolId?: string;
  file?: string;
  range?: ReviewSourceRange;
  lineHash?: string;
}

export type ReviewStickyStatus =
  | 'active'
  | 'orphan-marker'
  | 'orphan-body'
  | 'merge-conflict'
  | 'anchor-lost';

export interface PersistReviewStickyInput {
  reviewId: string;
  title: string;
  body: string;
  draft?: boolean;
  createdAt?: string;
  anchor?: ReviewAnchor;
}

export interface LoadedReviewSticky {
  reviewId: string;
  title: string;
  body: string;
  draft?: boolean;
  createdAt?: string;
  anchor?: ReviewAnchor;
  status: ReviewStickyStatus;
  source: 'marker' | 'body' | 'both';
  warning?: string;
}

interface MarkerRecord {
  reviewId: string;
  title: string;
  body: string;
  file: string;
  /** Zero-based source line that the marker annotates, not the marker line itself. */
  line: number;
  lineHash?: string;
  hasConflict: boolean;
}

interface MarkerWriteResult {
  lineHash: string;
  range?: ReviewSourceRange;
}

interface LineRange {
  start: number;
  end: number;
}

interface BodyRecord {
  reviewId: string;
  title: string;
  body: string;
  draft?: boolean;
  createdAt?: string;
  anchor?: ReviewAnchor;
  hasConflict: boolean;
}

const REVIEW_BODY_DIR = path.join('.codetrace', 'reviews');
const SUPPORTED_COMMENT_PREFIXES = new Map<string, string>([
  ['.ts', '//'],
  ['.tsx', '//'],
  ['.js', '//'],
  ['.jsx', '//'],
  ['.java', '//'],
  ['.go', '//'],
  ['.py', '#'],
]);

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.codetrace',
  'node_modules',
  'dist',
  'out',
  'coverage',
]);

const MARKER_PATTERN = /^(\s*)(\/\/|#)\s*review:\s+(\S+)(?:\s+(.*))?$/;
const MARKER_BODY_PATTERN = /^(\s*)(\/\/|#)\s*review-body:\s+(\S+)(?:\s?(.*))?$/;
const CONFLICT_PATTERN = /^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m;

export function isSupportedReviewSource(filePath: string): boolean {
  return SUPPORTED_COMMENT_PREFIXES.has(path.extname(filePath));
}

export async function persistReviewSticky(
  workspaceRoot: string,
  input: PersistReviewStickyInput,
): Promise<LoadedReviewSticky> {
  const review = normalizePersistInput(input);
  const createdAt = review.createdAt ?? new Date().toISOString();
  let anchor = await hydrateAnchor(workspaceRoot, review.anchor);

  if (anchor?.file && anchor.range && isSupportedReviewSource(anchor.file)) {
    const marker = await upsertSourceMarker(workspaceRoot, { ...review, createdAt, anchor }, anchor);
    anchor = {
      ...anchor,
      range: marker.range ?? anchor.range,
      lineHash: marker.lineHash,
    };
  }

  const withAnchor: PersistReviewStickyInput = { ...review, createdAt, anchor };
  await writeReviewBody(workspaceRoot, withAnchor);

  return {
    reviewId: withAnchor.reviewId,
    title: withAnchor.title,
    body: withAnchor.body,
    draft: withAnchor.draft,
    createdAt,
    anchor,
    status: 'active',
    source: anchor?.file ? 'both' : 'body',
  };
}

export async function loadReviewStickies(workspaceRoot: string): Promise<LoadedReviewSticky[]> {
  const [bodies, markers] = await Promise.all([
    readReviewBodies(workspaceRoot),
    scanReviewMarkers(workspaceRoot),
  ]);

  const ids = new Set<string>([...bodies.keys(), ...markers.keys()]);
  const reviews: LoadedReviewSticky[] = [];

  for (const reviewId of Array.from(ids).sort()) {
    const body = bodies.get(reviewId);
    const marker = markers.get(reviewId);

    if (body && marker) {
      const anchor = {
        ...body.anchor,
        file: body.anchor?.file ?? marker.file,
        lineHash: body.anchor?.lineHash ?? marker.lineHash,
      };
      const hasConflict = body.hasConflict || marker.hasConflict;
      reviews.push({
        reviewId,
        title: body.title || marker.title,
        body: body.body || marker.body,
        draft: body.draft,
        createdAt: body.createdAt,
        anchor,
        status: hasConflict ? 'merge-conflict' : 'active',
        source: 'both',
        warning: hasConflict ? 'Review contains merge conflict markers.' : undefined,
      });
      continue;
    }

    if (marker) {
      reviews.push({
        reviewId,
        title: marker.title,
        body: marker.body,
        anchor: {
          file: marker.file,
          range: {
            startLine: marker.line + 1,
            startColumn: 0,
            endLine: marker.line + 1,
            endColumn: 0,
          },
          lineHash: marker.lineHash,
        },
        status: marker.hasConflict ? 'merge-conflict' : 'orphan-marker',
        source: 'marker',
        warning: marker.hasConflict
          ? 'Source marker contains merge conflict markers.'
          : 'Source marker has no matching .codetrace review body.',
      });
      continue;
    }

    if (body) {
      reviews.push({
        reviewId,
        title: body.title,
        body: body.body,
        draft: body.draft,
        createdAt: body.createdAt,
        anchor: body.anchor,
        status: body.hasConflict ? 'merge-conflict' : 'orphan-body',
        source: 'body',
        warning: body.hasConflict
          ? 'Review body contains merge conflict markers.'
          : 'Review body has no matching source marker.',
      });
    }
  }

  return reviews;
}

async function hydrateAnchor(
  workspaceRoot: string,
  anchor: ReviewAnchor | undefined,
): Promise<ReviewAnchor | undefined> {
  if (!anchor?.file) return anchor;
  const filePath = resolveWorkspacePath(workspaceRoot, anchor.file);
  let lineHash = anchor.lineHash;

  if (!lineHash && anchor.range) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      lineHash = hashLine(splitLines(content)[sourceLineIndex(anchor.range.startLine)] ?? '');
    } catch {
      lineHash = undefined;
    }
  }

  return {
    ...anchor,
    file: toWorkspaceRelativePath(workspaceRoot, filePath),
    lineHash,
  };
}

async function upsertSourceMarker(
  workspaceRoot: string,
  review: PersistReviewStickyInput,
  anchor: ReviewAnchor,
): Promise<MarkerWriteResult> {
  if (!anchor.file || !anchor.range) {
    return { lineHash: anchor.lineHash ?? '' };
  }

  const filePath = resolveWorkspacePath(workspaceRoot, anchor.file);
  const prefix = SUPPORTED_COMMENT_PREFIXES.get(path.extname(filePath));
  if (!prefix) {
    return { lineHash: anchor.lineHash ?? '' };
  }

  const content = await fs.readFile(filePath, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = content.endsWith('\n');
  const lines = splitLines(content);
  const insertAt = clampLine(sourceLineIndex(anchor.range.startLine), lines.length);
  const indentation = readLineIndentation(lines[insertAt] ?? '');
  const markerBlock = buildMarkerBlock(prefix, indentation, review);
  const markerRange = findMarkerRange(lines, review.reviewId);

  if (markerRange) {
    lines.splice(markerRange.start, markerRange.end - markerRange.start, ...markerBlock);
  } else {
    lines.splice(insertAt, 0, ...markerBlock);
  }

  const markerStart = markerRange?.start ?? insertAt;
  const anchorLineIndex = markerStart + markerBlock.length;
  const anchorLine = lines[anchorLineIndex] ?? lines[markerStart] ?? '';
  const nextStartLine = anchorLineIndex + 1;
  const lineSpan = Math.max(0, anchor.range.endLine - anchor.range.startLine);

  await fs.writeFile(filePath, `${lines.join(eol)}${trailingNewline ? eol : ''}`, 'utf8');

  return {
    lineHash: hashLine(anchorLine),
    range: {
      startLine: nextStartLine,
      startColumn: anchor.range.startColumn,
      endLine: nextStartLine + lineSpan,
      endColumn: anchor.range.endColumn,
    },
  };
}

function buildMarkerBlock(
  prefix: string,
  indentation: string,
  review: PersistReviewStickyInput,
): string[] {
  const title = singleLine(review.title) || 'Review note';
  const lines = [`${indentation}${prefix} review: ${review.reviewId} ${title}`];
  const bodyLines = review.body.split(/\r?\n/);

  if (bodyLines.length <= 5) {
    for (const line of bodyLines) {
      if (line.length === 0) {
        lines.push(`${indentation}${prefix} review-body: ${review.reviewId}`);
      } else {
        lines.push(`${indentation}${prefix} review-body: ${review.reviewId} ${line}`);
      }
    }
  }

  return lines;
}

async function writeReviewBody(
  workspaceRoot: string,
  review: PersistReviewStickyInput,
): Promise<void> {
  const bodyDir = path.join(workspaceRoot, REVIEW_BODY_DIR);
  await fs.mkdir(bodyDir, { recursive: true });
  const bodyPath = path.join(bodyDir, `${safeFileName(review.reviewId)}.md`);
  await fs.writeFile(bodyPath, serializeReviewBody(review), 'utf8');
}

function serializeReviewBody(review: PersistReviewStickyInput): string {
  const anchor = review.anchor ?? {};
  const frontMatter: Record<string, unknown> = {
    id: review.reviewId,
    title: review.title,
    anchorNodeId: anchor.nodeId,
    symbolId: anchor.symbolId,
    file: anchor.file,
    startLine: anchor.range?.startLine,
    startColumn: anchor.range?.startColumn,
    endLine: anchor.range?.endLine,
    endColumn: anchor.range?.endColumn,
    lineHash: anchor.lineHash,
    createdAt: review.createdAt,
    draft: review.draft ?? false,
  };

  const yaml = Object.entries(frontMatter)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${encodeFrontMatterValue(value)}`)
    .join('\n');

  return `---\n${yaml}\n---\n${review.body.replace(/\r\n/g, '\n')}\n`;
}

async function readReviewBodies(workspaceRoot: string): Promise<Map<string, BodyRecord>> {
  const bodyDir = path.join(workspaceRoot, REVIEW_BODY_DIR);
  const records = new Map<string, BodyRecord>();

  let entries: string[];
  try {
    entries = await fs.readdir(bodyDir);
  } catch {
    return records;
  }

  for (const entry of entries) {
    if (path.extname(entry).toLowerCase() !== '.md') continue;
    const filePath = path.join(bodyDir, entry);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseReviewBody(content);
    const reviewId = parsed.reviewId || path.basename(entry, '.md');
    if (!reviewId) continue;
    records.set(reviewId, {
      ...parsed,
      reviewId,
      hasConflict: CONFLICT_PATTERN.test(content),
    });
  }

  return records;
}

async function scanReviewMarkers(workspaceRoot: string): Promise<Map<string, MarkerRecord>> {
  const records = new Map<string, MarkerRecord>();
  const files = await listSourceFiles(workspaceRoot);

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativeFile = toWorkspaceRelativePath(workspaceRoot, filePath);
    const lines = splitLines(content);
    const conflictRanges = findConflictRanges(lines);

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(MARKER_PATTERN);
      if (!match) continue;
      const reviewId = match[3];
      const title = match[4]?.trim() ?? '';
      const bodyLines: string[] = [];
      let cursor = index + 1;

      while (cursor < lines.length) {
        const bodyMatch = lines[cursor].match(MARKER_BODY_PATTERN);
        if (!bodyMatch || bodyMatch[3] !== reviewId) break;
        bodyLines.push(bodyMatch[4] ?? '');
        cursor += 1;
      }

      const anchorLineIndex = cursor < lines.length ? cursor : index;
      records.set(reviewId, {
        reviewId,
        title,
        body: bodyLines.join('\n'),
        file: relativeFile,
        line: anchorLineIndex,
        lineHash: hashLine(lines[anchorLineIndex] ?? lines[index]),
        hasConflict: overlapsAnyRange(index, cursor, conflictRanges),
      });
      index = cursor - 1;
    }
  }

  return records;
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(filePath);
        }
        continue;
      }

      if (entry.isFile() && isSupportedReviewSource(filePath)) {
        files.push(filePath);
      }
    }
  }

  await visit(root);
  return files;
}

function parseReviewBody(content: string): BodyRecord {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontMatter = match ? parseFrontMatter(match[1]) : {};
  const body = match ? trimFinalNewline(match[2]) : trimFinalNewline(normalized);
  const reviewId = stringValue(frontMatter.id);
  const anchor = readAnchor(frontMatter);

  return {
    reviewId: reviewId ?? '',
    title: stringValue(frontMatter.title) ?? '',
    body,
    draft: booleanValue(frontMatter.draft),
    createdAt: stringValue(frontMatter.createdAt),
    anchor,
    hasConflict: CONFLICT_PATTERN.test(content),
  };
}

function parseFrontMatter(value: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of value.split('\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    out[key] = decodeFrontMatterValue(raw);
  }
  return out;
}

function readAnchor(frontMatter: Record<string, unknown>): ReviewAnchor | undefined {
  const nodeId = stringValue(frontMatter.anchorNodeId);
  const symbolId = stringValue(frontMatter.symbolId);
  const file = stringValue(frontMatter.file);
  const startLine = numberValue(frontMatter.startLine);
  const startColumn = numberValue(frontMatter.startColumn);
  const endLine = numberValue(frontMatter.endLine);
  const endColumn = numberValue(frontMatter.endColumn);
  const lineHash = stringValue(frontMatter.lineHash);
  const range =
    startLine === undefined ||
    startColumn === undefined ||
    endLine === undefined ||
    endColumn === undefined
      ? undefined
      : { startLine, startColumn, endLine, endColumn };

  if (!nodeId && !symbolId && !file && !range && !lineHash) return undefined;
  return { nodeId, symbolId, file, range, lineHash };
}

function normalizePersistInput(input: PersistReviewStickyInput): PersistReviewStickyInput {
  const reviewId = singleLine(input.reviewId);
  if (!reviewId) {
    throw new Error('CodeTrace review sticky requires a reviewId.');
  }

  return {
    ...input,
    reviewId,
    title: singleLine(input.title),
    body: input.body.replace(/\r\n/g, '\n'),
  };
}

function resolveWorkspacePath(workspaceRoot: string, file: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Review file is outside the workspace: ${file}`);
  }
  return target;
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}

function findMarkerRange(
  lines: readonly string[],
  reviewId: string,
): { start: number; end: number } | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(MARKER_PATTERN);
    if (!match || match[3] !== reviewId) continue;
    let end = index + 1;
    while (end < lines.length) {
      const bodyMatch = lines[end].match(MARKER_BODY_PATTERN);
      if (!bodyMatch || bodyMatch[3] !== reviewId) break;
      end += 1;
    }
    return { start: index, end };
  }
  return undefined;
}

function findConflictRanges(lines: readonly string[]): LineRange[] {
  const ranges: LineRange[] = [];
  let start: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^<<<<<<<(?:\s|$)/.test(line)) {
      start = index;
      continue;
    }

    if (/^=======(?:\s|$)/.test(line) && start === undefined) {
      ranges.push({ start: index, end: index + 1 });
      continue;
    }

    if (/^>>>>>>>(?:\s|$)/.test(line)) {
      ranges.push({ start: start ?? index, end: index + 1 });
      start = undefined;
    }
  }

  if (start !== undefined) {
    ranges.push({ start, end: lines.length });
  }

  return ranges;
}

function overlapsAnyRange(start: number, end: number, ranges: readonly LineRange[]): boolean {
  const rangeEnd = Math.max(start + 1, end);
  return ranges.some((range) => start < range.end && range.start < rangeEnd);
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function trimFinalNewline(value: string): string {
  return value.replace(/\n$/, '');
}

function readLineIndentation(line: string): string {
  return line.match(/^\s*/)?.[0] ?? '';
}

function clampLine(value: number, lineCount: number): number {
  if (!Number.isFinite(value)) return lineCount;
  return Math.max(0, Math.min(Math.floor(value), lineCount));
}

function sourceLineIndex(line: number): number {
  if (!Number.isFinite(line)) return 0;
  return Math.max(0, Math.floor(line) - 1);
}

function hashLine(line: string): string {
  return createHash('sha256').update(line.trim()).digest('hex').slice(0, 12);
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function encodeFrontMatterValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function decodeFrontMatterValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
