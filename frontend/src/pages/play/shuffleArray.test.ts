import { describe, it, expect } from 'vitest';
import { shuffleArray } from './utils';

describe('shuffleArray', () => {
  it('returns the same array reference', () => {
    const arr = [1, 2, 3];
    expect(shuffleArray(arr)).toBe(arr);
  });

  it('preserves all elements', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray([...original]);
    expect(shuffled.sort((a, b) => a - b)).toEqual(original);
  });

  it('handles empty array', () => {
    expect(shuffleArray([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(shuffleArray(['only'])).toEqual(['only']);
  });

  it('produces at least one ordering different from the original over many runs', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    let sawDifferent = false;
    for (let i = 0; i < 50; i++) {
      const result = shuffleArray([...original]);
      if (result.some((v, idx) => v !== original[idx])) {
        sawDifferent = true;
        break;
      }
    }
    expect(sawDifferent).toBe(true);
  });
});
