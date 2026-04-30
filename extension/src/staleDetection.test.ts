import { describe, expect, it } from '@jest/globals';
import { getStaleStatusesForPath, parseCanvasCodeCards } from './staleDetection';

const card = {
  id: 'card-1',
  file: {
    path: 'src/example.ts',
  },
  range: {
    startLine: 2,
    endLine: 3,
  },
  snapshot: 'const value = 1;\nconsole.log(value);',
};

describe('staleDetection', () => {
  it('parses code cards from a canvas document', () => {
    expect(
      parseCanvasCodeCards(
        JSON.stringify({
          version: 1,
          elements: [],
          cards: [card, { id: 'invalid' }],
        }),
      ),
    ).toEqual([card]);
  });

  it('returns an empty card list for invalid canvas content', () => {
    expect(parseCanvasCodeCards('not json')).toEqual([]);
    expect(parseCanvasCodeCards(JSON.stringify({ version: 1, cards: 'nope' }))).toEqual([]);
  });

  it('marks a card fresh when the current file lines match the snapshot', () => {
    expect(
      getStaleStatusesForPath([card], 'src/example.ts', [
        'import value from "./value";',
        'const value = 1;',
        'console.log(value);',
      ]),
    ).toEqual([{ cardId: 'card-1', stale: false }]);
  });

  it('marks a card stale when the current file lines differ', () => {
    expect(
      getStaleStatusesForPath([card], 'src/example.ts', [
        'import value from "./value";',
        'const value = 2;',
        'console.log(value);',
      ]),
    ).toEqual([{ cardId: 'card-1', stale: true }]);
  });

  it('marks a card stale when the tracked range is outside the current file', () => {
    expect(getStaleStatusesForPath([card], 'src/example.ts', ['const value = 1;'])).toEqual([
      { cardId: 'card-1', stale: true },
    ]);
  });

  it('ignores cards for other files', () => {
    expect(
      getStaleStatusesForPath([card], 'src/other.ts', [
        'import value from "./value";',
        'const value = 1;',
        'console.log(value);',
      ]),
    ).toEqual([]);
  });
});
