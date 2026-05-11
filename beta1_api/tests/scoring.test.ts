import { describe, expect, it } from '@jest/globals';
import { calculateAutonomy, calculateEfficiency, calculateReliability, calculateTransparencySafety } from '../src/scoring';

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

describe('optional metric scoring', () => {
  it('does not treat missing reliability metrics as failures', () => {
    expect(calculateReliability({ completionRate: 1 })).toBe(1);
  });

  it('keeps explicit reliability failures meaningful', () => {
    expect(calculateReliability({ completionRate: 0 })).toBe(0);
  });

  it('renormalizes autonomy when only approval requests are observed', () => {
    expect(calculateAutonomy({ lowApprovalRequestScore: 1 })).toBe(1);
  });

  it('falls back to neutral autonomy when no autonomy signals are observed', () => {
    expect(calculateAutonomy({})).toBe(0.5);
  });

  it('uses JWS trust without assuming all transparency evidence is complete', () => {
    expect(calculateTransparencySafety({ trustIntegrityScore: 1 })).toBe(1);
  });

  it('penalizes explicit policy incidents', () => {
    expect(calculateTransparencySafety({ trustIntegrityScore: 1, policyIncidentRate: 1 })).toBeLessThan(0.5);
  });
});
