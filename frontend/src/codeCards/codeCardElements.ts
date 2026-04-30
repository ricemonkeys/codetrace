import type { ExcalidrawElementStub } from '../types/CanvasDocument';
import type { CodeCard } from '../types/CodeCard';

export const CODE_CARD_WIDTH = 520;

const CARD_PADDING = 18;
const HEADER_HEIGHT = 50;
const CODE_PADDING = 14;
const CODE_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 17;
const META_FONT_SIZE = 12;
const MARKER_FONT_SIZE = 11;
const TEXT_LINE_HEIGHT = 1.25;
const MAX_CODE_LINES = 14;
const MAX_CODE_COLUMNS = 74;
const MIN_CODE_HEIGHT = 80;
const FONT_FAMILY_CASCADIA = 3;
const ROUNDNESS_ADAPTIVE_RADIUS = 3;
const MAX_VERSION_NONCE = 0x7fffffff;
const TITLE_OFFSET_Y = 14;
const METADATA_OFFSET_Y = 37;
const STALE_TITLE_WIDTH_RESERVE = 82;
const STALE_MARKER_WIDTH = 60;
const STALE_MARKER_HEIGHT = 22;
const STALE_MARKER_OFFSET_Y = 16;
const STALE_MARKER_LABEL_OFFSET_X = 12;
const STALE_MARKER_LABEL_OFFSET_Y = 4;
const STALE_MARKER_LABEL_WIDTH = 42;

const COLORS = {
  cardBackground: '#ffffff',
  cardBorder: '#2f5f9f',
  staleBorder: '#d23f31',
  codeBackground: '#f5f7fb',
  codeBorder: '#d5deea',
  title: '#172033',
  meta: '#59677c',
  code: '#172033',
  staleFill: '#fff0ed',
  staleText: '#9b241b',
};

type CodeCardElementRole =
  | 'container'
  | 'codeBlock'
  | 'title'
  | 'metadata'
  | 'snapshot'
  | 'staleMarkerBackground'
  | 'staleMarkerLabel';

export type CreateCodeCardElementsOptions = {
  x?: number;
  y?: number;
  updated?: number;
};

export function createCodeCardElements(
  card: CodeCard,
  options: CreateCodeCardElementsOptions = {},
): ExcalidrawElementStub[] {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const updated = options.updated ?? Date.now();
  const stale = isCodeCardStale(card);
  const groupId = getCodeCardGroupId(card.id);
  const codeText = formatSnapshot(card);
  const codeTextHeight = getTextHeight(codeText, CODE_FONT_SIZE);
  const codeHeight = Math.max(MIN_CODE_HEIGHT, codeTextHeight + CODE_PADDING * 2);
  const height = HEADER_HEIGHT + codeHeight + CARD_PADDING * 2;
  const codeBlockY = y + CARD_PADDING + HEADER_HEIGHT;
  const elements: ExcalidrawElementStub[] = [
    createRectangleElement(card, 'container', groupId, updated, {
      x,
      y,
      width: CODE_CARD_WIDTH,
      height,
      strokeColor: stale ? COLORS.staleBorder : COLORS.cardBorder,
      backgroundColor: COLORS.cardBackground,
      strokeWidth: stale ? 3 : 2,
      roughness: 0,
    }),
    createRectangleElement(card, 'codeBlock', groupId, updated, {
      x: x + CARD_PADDING,
      y: codeBlockY,
      width: CODE_CARD_WIDTH - CARD_PADDING * 2,
      height: codeHeight,
      strokeColor: COLORS.codeBorder,
      backgroundColor: COLORS.codeBackground,
      strokeWidth: 1,
      roughness: 0,
    }),
    createTextElement(card, 'title', groupId, updated, {
      x: x + CARD_PADDING,
      y: y + TITLE_OFFSET_Y,
      width: CODE_CARD_WIDTH - CARD_PADDING * 2 - (stale ? STALE_TITLE_WIDTH_RESERVE : 0),
      height: getTextHeight(formatTitle(card), TITLE_FONT_SIZE),
      text: formatTitle(card),
      fontSize: TITLE_FONT_SIZE,
      strokeColor: COLORS.title,
    }),
    createTextElement(card, 'metadata', groupId, updated, {
      x: x + CARD_PADDING,
      y: y + METADATA_OFFSET_Y,
      width: CODE_CARD_WIDTH - CARD_PADDING * 2,
      height: getTextHeight(formatMetadata(card), META_FONT_SIZE),
      text: formatMetadata(card),
      fontSize: META_FONT_SIZE,
      strokeColor: COLORS.meta,
    }),
    createTextElement(card, 'snapshot', groupId, updated, {
      x: x + CARD_PADDING + CODE_PADDING,
      y: codeBlockY + CODE_PADDING,
      width: CODE_CARD_WIDTH - CARD_PADDING * 2 - CODE_PADDING * 2,
      height: codeTextHeight,
      text: codeText,
      fontSize: CODE_FONT_SIZE,
      strokeColor: COLORS.code,
    }),
  ];

  if (stale) {
    elements.push(
      createRectangleElement(card, 'staleMarkerBackground', groupId, updated, {
        x: x + CODE_CARD_WIDTH - CARD_PADDING - STALE_MARKER_WIDTH,
        y: y + STALE_MARKER_OFFSET_Y,
        width: STALE_MARKER_WIDTH,
        height: STALE_MARKER_HEIGHT,
        strokeColor: COLORS.staleBorder,
        backgroundColor: COLORS.staleFill,
        strokeWidth: 1,
        roughness: 0,
      }),
      createTextElement(card, 'staleMarkerLabel', groupId, updated, {
        x: x + CODE_CARD_WIDTH - CARD_PADDING - STALE_MARKER_WIDTH + STALE_MARKER_LABEL_OFFSET_X,
        y: y + STALE_MARKER_OFFSET_Y + STALE_MARKER_LABEL_OFFSET_Y,
        width: STALE_MARKER_LABEL_WIDTH,
        height: getTextHeight('STALE', MARKER_FONT_SIZE),
        text: 'STALE',
        fontSize: MARKER_FONT_SIZE,
        strokeColor: COLORS.staleText,
      }),
    );
  }

  return elements;
}

export function isCodeCardStale(card: CodeCard): boolean {
  return (
    card.customData.stale === true ||
    card.customData.isStale === true ||
    card.customData.status === 'stale' ||
    readNestedBoolean(card.customData, 'codetrace', 'stale')
  );
}

export function getCodeCardGroupId(cardId: string): string {
  return `codetrace-card-${cardId}`;
}

function createRectangleElement(
  card: CodeCard,
  role: CodeCardElementRole,
  groupId: string,
  updated: number,
  overrides: Partial<ExcalidrawElementStub>,
): ExcalidrawElementStub {
  return {
    ...createBaseElement(card, role, groupId, updated),
    type: 'rectangle',
    fillStyle: 'solid',
    strokeStyle: 'solid',
    roundness: {
      type: ROUNDNESS_ADAPTIVE_RADIUS,
    },
    ...overrides,
  };
}

function createTextElement(
  card: CodeCard,
  role: CodeCardElementRole,
  groupId: string,
  updated: number,
  overrides: Partial<ExcalidrawElementStub> & { text: string; fontSize: number },
): ExcalidrawElementStub {
  const height = overrides.height ?? getTextHeight(overrides.text, overrides.fontSize);

  return {
    ...createBaseElement(card, role, groupId, updated),
    type: 'text',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    roundness: null,
    fontFamily: FONT_FAMILY_CASCADIA,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    originalText: overrides.text,
    baseline: Math.round(Number(height) * 0.84),
    lineHeight: TEXT_LINE_HEIGHT,
    ...overrides,
    height,
  };
}

function createBaseElement(
  card: CodeCard,
  role: CodeCardElementRole,
  groupId: string,
  updated: number,
): ExcalidrawElementStub {
  return {
    id: getElementId(card.id, role),
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardBackground,
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: hashToPositiveInteger(`${card.id}:${role}:seed`),
    version: 1,
    versionNonce: createVersionNonce(),
    isDeleted: false,
    groupIds: [groupId],
    frameId: null,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    customData: {
      codetrace: {
        kind: 'codeCard',
        cardId: card.id,
        role,
        filePath: card.file.path,
        range: card.range,
        stale: isCodeCardStale(card),
      },
    },
  };
}

function getElementId(cardId: string, role: CodeCardElementRole): string {
  return `${getCodeCardGroupId(cardId)}-${role}`;
}

function formatTitle(card: CodeCard): string {
  const range =
    card.range.startLine === card.range.endLine
      ? `${card.range.startLine}`
      : `${card.range.startLine}-${card.range.endLine}`;

  return truncateMiddle(`${card.file.path}:${range}`, 58);
}

function formatMetadata(card: CodeCard): string {
  const commit = card.file.gitCommit ? ` | ${card.file.gitCommit.slice(0, 7)}` : '';
  return truncateEnd(`${card.language}${commit}`, 70);
}

function formatSnapshot(card: CodeCard): string {
  const sourceLines = card.snapshot.split(/\r?\n/);
  const visibleLines = sourceLines.slice(0, MAX_CODE_LINES);
  const lineNumberWidth = String(card.range.endLine).length;
  const formattedLines = visibleLines.map((line, index) => {
    const lineNumber = String(card.range.startLine + index).padStart(lineNumberWidth, ' ');
    return `${lineNumber} | ${truncateEnd(normalizeCodeLine(line), MAX_CODE_COLUMNS)}`;
  });

  if (sourceLines.length > MAX_CODE_LINES) {
    formattedLines.push(`${' '.repeat(lineNumberWidth)} | ...`);
  }

  return formattedLines.join('\n');
}

function normalizeCodeLine(line: string): string {
  return line.replace(/\t/g, '  ');
}

function getTextHeight(text: string, fontSize: number): number {
  const lines = Math.max(1, text.split('\n').length);
  return Math.ceil(lines * fontSize * TEXT_LINE_HEIGHT);
}

function truncateEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  const leftLength = Math.ceil((maxLength - 3) / 2);
  const rightLength = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, leftLength)}...${value.slice(value.length - rightLength)}`;
}

function readNestedBoolean(
  record: Record<string, unknown>,
  key: string,
  nestedKey: string,
): boolean {
  const nested = record[key];
  return isObjectRecord(nested) && nested[nestedKey] === true;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashToPositiveInteger(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) + 1;
}

function createVersionNonce(): number {
  return Math.floor(Math.random() * MAX_VERSION_NONCE) + 1;
}
