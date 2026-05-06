/**
 * Kojumi Evaluation Scoring Engine v0.1
 * Based on marketplace_v0_docs/06_scoring_spec_v0_1.md
 */

// --- 28.10 Penalty Functions ---
export function calculatePenalty(rate: number, ref: number): number {
  return Math.exp((-Math.LN2 * rate) / ref);
}

// --- 28.9 Continuous Value Normalization ---
export function scoreLowBetter(v: number, b: number, k: number = 2.0): number {
  if (v <= 0 || b <= 0) return 0.5; // fallback
  return 1 / (1 + Math.exp(k * Math.log(v / b)));
}

export function scoreHighBetter(v: number, b: number, k: number = 2.0): number {
  if (v <= 0 || b <= 0) return 0.5; // fallback
  return 1 / (1 + Math.exp(-k * Math.log(v / b)));
}

// clamp to [0, 1]
export function clamp(val: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, val));
}

// --- 28.12 Reliability ---
export interface ReliabilityParams {
  completionRate: number;
  onTimeRate: number;
  nonCancelRate: number;
  lowRetryScore: number;
  evidenceCompletenessRate: number;
  timeoutRate: number;
  logGapRate: number;
  severeIncidentRate: number;
}

export function calculateReliability(p: ReliabilityParams): number {
  const base = 
    0.30 * p.completionRate + 
    0.25 * p.onTimeRate + 
    0.15 * p.nonCancelRate + 
    0.15 * p.lowRetryScore + 
    0.15 * p.evidenceCompletenessRate;
    
  const timeoutPenalty = calculatePenalty(p.timeoutRate, 0.05);
  const logGapPenalty = calculatePenalty(p.logGapRate, 0.05);
  const severeIncidentPenalty = calculatePenalty(p.severeIncidentRate, 0.02);

  return clamp(base * timeoutPenalty * logGapPenalty * severeIncidentPenalty);
}

// --- 28.13 Quality ---
export interface QualityParams {
  acceptanceRate: number;
  firstPassAcceptRate: number;
  lowReworkScore: number;
  benchmarkScore: number;
  repeatHireScore: number;
  confirmedDefectRate: number;
  refundRate: number;
  chargebackRate: number;
}

export function calculateQuality(p: QualityParams): number {
  const base = 
    0.35 * p.acceptanceRate + 
    0.20 * p.firstPassAcceptRate + 
    0.15 * p.lowReworkScore + 
    0.20 * p.benchmarkScore + 
    0.10 * p.repeatHireScore;

  const defectPenalty = calculatePenalty(p.confirmedDefectRate, 0.05);
  const refundPenalty = calculatePenalty(p.refundRate, 0.05);
  const chargebackPenalty = calculatePenalty(p.chargebackRate, 0.02);

  return clamp(base * defectPenalty * refundPenalty * chargebackPenalty);
}

// --- 28.14 Efficiency ---
export interface EfficiencyParams {
  durationScore?: number | null;
  successCostScore?: number | null;
  tokenEfficiencyScore?: number | null;
  toolEfficiencyScore?: number | null;
}

export function calculateEfficiency(p: EfficiencyParams): number {
  const weightedScores = [
    { score: p.durationScore, weight: 0.45 },
    { score: p.successCostScore, weight: 0.35 },
    { score: p.tokenEfficiencyScore, weight: 0.10 },
    { score: p.toolEfficiencyScore, weight: 0.10 },
  ].filter((item): item is { score: number; weight: number } =>
    typeof item.score === 'number' && Number.isFinite(item.score)
  );

  if (weightedScores.length === 0) {
    return 0.5;
  }

  const totalWeight = weightedScores.reduce((sum, item) => sum + item.weight, 0);
  const normalizedScore = weightedScores.reduce(
    (sum, item) => sum + clamp(item.score) * item.weight,
    0,
  ) / totalWeight;

  return clamp(normalizedScore);
}

// --- 28.15 Autonomy ---
export interface AutonomyParams {
  humanFreeCompletionRate: number;
  lowApprovalRequestScore: number;
  lowManualTakeoverScore: number;
  delegationEffectivenessScore: number;
}

export function calculateAutonomy(p: AutonomyParams): number {
  return 0.45 * p.humanFreeCompletionRate +
         0.20 * p.lowApprovalRequestScore +
         0.20 * p.lowManualTakeoverScore +
         0.15 * p.delegationEffectivenessScore;
}

// --- 28.16 TransparencySafety ---
export interface TransparencyParams {
  requiredEvidenceScore: number;
  trustIntegrityScore: number;
  attestedClaimCoverage: number;
  policyIncidentRate: number;
  unauthorizedToolRate: number;
  identityMismatchRate: number;
  runtimeAttestationGapRate: number;
}

export function calculateTransparencySafety(p: TransparencyParams): number {
  const policySafetyScore = calculatePenalty(p.policyIncidentRate, 0.02) * calculatePenalty(p.unauthorizedToolRate, 0.01);
  const identityRuntimeIntegrityScore = calculatePenalty(p.identityMismatchRate, 0.01) * calculatePenalty(p.runtimeAttestationGapRate, 0.05);

  return 0.25 * p.requiredEvidenceScore +
         0.20 * p.trustIntegrityScore +
         0.15 * p.attestedClaimCoverage +
         0.25 * policySafetyScore +
         0.15 * identityRuntimeIntegrityScore;
}

// --- 28.17 Composite ---
export function calculateComposite(r: number, q: number, e: number, a: number, t: number): number {
  return 0.28 * r + 0.28 * q + 0.16 * e + 0.14 * a + 0.14 * t;
}
