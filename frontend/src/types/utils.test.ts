import { isNonEmptyString, isRecord } from './utils';

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
});
