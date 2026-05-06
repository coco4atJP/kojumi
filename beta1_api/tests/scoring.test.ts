import { describe, expect, it } from '@jest/globals';
import { calculateEfficiency } from '../src/scoring';

describe('calculateEfficiency', () => {
  it('renormalizes weights when optional metrics are missing', () => {
    const score = calculateEfficiency({
      durationScore: 1,
      successCostScore: 0,
    });

    expect(score).toBeCloseTo(0.45 / (0.45 + 0.35));
  });

  it('returns a neutral fallback when no efficiency metrics are present', () => {
    expect(calculateEfficiency({})).toBe(0.5);
  });

  it('clamps component scores before averaging', () => {
    expect(calculateEfficiency({ durationScore: 2, successCostScore: -1 })).toBeCloseTo(0.45 / (0.45 + 0.35));
  });
});
