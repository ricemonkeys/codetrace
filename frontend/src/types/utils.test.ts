import {
  isNonEmptyString,
  isRecord,
  isUlid,
  isWorkspaceRelativePosixPath,
} from './utils';

describe('type utils', () => {
  it('detects plain records', () => {
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it('detects non-empty strings', () => {
    expect(isNonEmptyString('code')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('detects ULID strings', () => {
    expect(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(isUlid('card-1')).toBe(false);
  });

  it('detects workspace-relative POSIX paths', () => {
    expect(isWorkspaceRelativePosixPath('src/App.tsx')).toBe(true);
    expect(isWorkspaceRelativePosixPath('/src/App.tsx')).toBe(false);
    expect(isWorkspaceRelativePosixPath('src\\App.tsx')).toBe(false);
    expect(isWorkspaceRelativePosixPath('../App.tsx')).toBe(false);
  });
});
