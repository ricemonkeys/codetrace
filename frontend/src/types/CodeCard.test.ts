import { isCodeCard, isUlid, isWorkspaceRelativePosixPath, parseCodeCard } from './CodeCard';

const validCard = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  file: {
    path: 'frontend/src/App.tsx',
    gitCommit: 'e66b616',
  },
  range: {
    startLine: 1,
    endLine: 8,
  },
  snapshot: 'export default function App() {}',
  language: 'typescriptreact',
  customData: {
    color: 'blue',
  },
};

describe('CodeCard', () => {
  it('accepts a valid code card', () => {
    expect(isCodeCard(validCard)).toBe(true);
    expect(parseCodeCard(validCard)).toEqual(validCard);
  });

  it('requires a workspace-relative POSIX path', () => {
    expect(isWorkspaceRelativePosixPath('src/App.tsx')).toBe(true);
    expect(isWorkspaceRelativePosixPath('/src/App.tsx')).toBe(false);
    expect(isWorkspaceRelativePosixPath('src\\App.tsx')).toBe(false);
    expect(isWorkspaceRelativePosixPath('../App.tsx')).toBe(false);
  });

  it('requires a ULID id', () => {
    expect(isUlid(validCard.id)).toBe(true);
    expect(isCodeCard({ ...validCard, id: 'card-1' })).toBe(false);
  });

  it('requires a non-empty snapshot', () => {
    expect(isCodeCard({ ...validCard, snapshot: '' })).toBe(false);
  });

  it('rejects invalid ranges', () => {
    expect(
      isCodeCard({
        ...validCard,
        range: { startLine: 10, endLine: 4 },
      }),
    ).toBe(false);
  });
});
