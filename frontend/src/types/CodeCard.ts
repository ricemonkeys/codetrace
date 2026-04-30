import { isNonEmptyString, isRecord } from './utils';

export type CodeCard = {
  id: string;
  file: {
    path: string;
    gitCommit?: string;
  };
  range: {
    startLine: number;
    endLine: number;
  };
  snapshot: string;
  language: string;
  customData: Record<string, unknown>;
};

export function isCodeCard(value: unknown): value is CodeCard {
  if (!isRecord(value)) return false;

  const file = value.file;
  const range = value.range;

  return (
    isUlid(value.id) &&
    isRecord(file) &&
    isWorkspaceRelativePosixPath(file.path) &&
    (file.gitCommit === undefined || isNonEmptyString(file.gitCommit)) &&
    isRecord(range) &&
    isPositiveInteger(range.startLine) &&
    isPositiveInteger(range.endLine) &&
    range.endLine >= range.startLine &&
    isNonEmptyString(value.snapshot) &&
    isNonEmptyString(value.language) &&
    isRecord(value.customData)
  );
}

export function parseCodeCard(value: unknown): CodeCard {
  if (!isCodeCard(value)) {
    throw new Error('Invalid CodeCard');
  }

  return value;
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function isWorkspaceRelativePosixPath(path: unknown): path is string {
  if (!isNonEmptyString(path)) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;

  const segments = path.split('/');
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
