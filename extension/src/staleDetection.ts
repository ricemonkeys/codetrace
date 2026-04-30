export type CodeCardSnapshot = {
  id: string;
  file: {
    path: string;
  };
  range: {
    startLine: number;
    endLine: number;
  };
  snapshot: string;
};

export type CodeCardStaleStatus = {
  cardId: string;
  stale: boolean;
};

export function parseCanvasCodeCards(content: string): CodeCardSnapshot[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.cards)) return [];
  return parsed.cards.filter(isCodeCardSnapshot);
}

export function getStaleStatusesForPath(
  cards: readonly CodeCardSnapshot[],
  filePath: string,
  currentLines: readonly string[],
): CodeCardStaleStatus[] {
  return cards
    .filter(card => card.file.path === filePath)
    .map(card => ({
      cardId: card.id,
      stale: readSnapshot(currentLines, card.range.startLine, card.range.endLine) !== card.snapshot,
    }));
}

function readSnapshot(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): string | undefined {
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return undefined;
  return lines.slice(startLine - 1, endLine).join('\n');
}

function isCodeCardSnapshot(value: unknown): value is CodeCardSnapshot {
  if (!isRecord(value)) return false;

  const file = value.file;
  const range = value.range;

  return (
    typeof value.id === 'string' &&
    isRecord(file) &&
    typeof file.path === 'string' &&
    isRecord(range) &&
    Number.isInteger(range.startLine) &&
    Number.isInteger(range.endLine) &&
    typeof value.snapshot === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
