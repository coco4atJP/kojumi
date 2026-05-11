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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function weightedAverage(
  items: Array<{ score?: number | null; weight: number }>,
  fallback: number = 0.5,
): number {
  const presentItems = items.filter((item): item is { score: number; weight: number } =>
    isFiniteNumber(item.score) && item.weight > 0,
  );

  if (presentItems.length === 0) {
    return fallback;
  }

  const totalWeight = presentItems.reduce((sum, item) => sum + item.weight, 0);
  return clamp(
    presentItems.reduce((sum, item) => sum + clamp(item.score) * item.weight, 0) / totalWeight,
  );
}

function optionalPenalty(rate?: number | null, ref: number = 0.05): number {
  return isFiniteNumber(rate) ? calculatePenalty(clamp(rate), ref) : 1;
}

// --- 28.12 Reliability ---
export interface ReliabilityParams {
  completionRate?: number | null;
  onTimeRate?: number | null;
  nonCancelRate?: number | null;
  lowRetryScore?: number | null;
  evidenceCompletenessRate?: number | null;
  timeoutRate?: number | null;
  logGapRate?: number | null;
  severeIncidentRate?: number | null;
}

export function calculateReliability(p: ReliabilityParams): number {
  const base = weightedAverage([
    { score: p.completionRate, weight: 0.30 },
    { score: p.onTimeRate, weight: 0.25 },
    { score: p.nonCancelRate, weight: 0.15 },
    { score: p.lowRetryScore, weight: 0.15 },
    { score: p.evidenceCompletenessRate, weight: 0.15 },
  ]);
    
  const timeoutPenalty = optionalPenalty(p.timeoutRate, 0.05);
  const logGapPenalty = optionalPenalty(p.logGapRate, 0.05);
  const severeIncidentPenalty = optionalPenalty(p.severeIncidentRate, 0.02);

  return clamp(base * timeoutPenalty * logGapPenalty * severeIncidentPenalty);
}

// --- 28.13 Quality ---
export interface QualityParams {
  acceptanceRate?: number | null;
  firstPassAcceptRate?: number | null;
  lowReworkScore?: number | null;
  benchmarkScore?: number | null;
  repeatHireScore?: number | null;
  confirmedDefectRate?: number | null;
  refundRate?: number | null;
  chargebackRate?: number | null;
}

export function calculateQuality(p: QualityParams): number {
  const base = weightedAverage([
    { score: p.acceptanceRate, weight: 0.35 },
    { score: p.firstPassAcceptRate, weight: 0.20 },
    { score: p.lowReworkScore, weight: 0.15 },
    { score: p.benchmarkScore, weight: 0.20 },
    { score: p.repeatHireScore, weight: 0.10 },
  ]);

  const defectPenalty = optionalPenalty(p.confirmedDefectRate, 0.05);
  const refundPenalty = optionalPenalty(p.refundRate, 0.05);
  const chargebackPenalty = optionalPenalty(p.chargebackRate, 0.02);

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
  return weightedAverage([
    { score: p.durationScore, weight: 0.45 },
    { score: p.successCostScore, weight: 0.35 },
    { score: p.tokenEfficiencyScore, weight: 0.10 },
    { score: p.toolEfficiencyScore, weight: 0.10 },
  ]);
}

// --- 28.15 Autonomy ---
export interface AutonomyParams {
  humanFreeCompletionRate?: number | null;
  lowApprovalRequestScore?: number | null;
  lowManualTakeoverScore?: number | null;
  delegationEffectivenessScore?: number | null;
}

export function calculateAutonomy(p: AutonomyParams): number {
  return weightedAverage([
    { score: p.humanFreeCompletionRate, weight: 0.45 },
    { score: p.lowApprovalRequestScore, weight: 0.20 },
    { score: p.lowManualTakeoverScore, weight: 0.20 },
    { score: p.delegationEffectivenessScore, weight: 0.15 },
  ]);
}

// --- 28.16 TransparencySafety ---
export interface TransparencyParams {
  requiredEvidenceScore?: number | null;
  trustIntegrityScore?: number | null;
  attestedClaimCoverage?: number | null;
  policyIncidentRate?: number | null;
  unauthorizedToolRate?: number | null;
  identityMismatchRate?: number | null;
  runtimeAttestationGapRate?: number | null;
}

export function calculateTransparencySafety(p: TransparencyParams): number {
  const hasPolicyMetrics = isFiniteNumber(p.policyIncidentRate) || isFiniteNumber(p.unauthorizedToolRate);
  const hasIntegrityMetrics = isFiniteNumber(p.identityMismatchRate) || isFiniteNumber(p.runtimeAttestationGapRate);
  const policySafetyScore = hasPolicyMetrics
    ? optionalPenalty(p.policyIncidentRate, 0.02) * optionalPenalty(p.unauthorizedToolRate, 0.01)
    : null;
  const identityRuntimeIntegrityScore = hasIntegrityMetrics
    ? optionalPenalty(p.identityMismatchRate, 0.01) * optionalPenalty(p.runtimeAttestationGapRate, 0.05)
    : null;

  return weightedAverage([
    { score: p.requiredEvidenceScore, weight: 0.25 },
    { score: p.trustIntegrityScore, weight: 0.20 },
    { score: p.attestedClaimCoverage, weight: 0.15 },
    { score: policySafetyScore, weight: 0.25 },
    { score: identityRuntimeIntegrityScore, weight: 0.15 },
  ]);
}

// --- 28.17 Composite ---
export function calculateComposite(r: number, q: number, e: number, a: number, t: number): number {
  return 0.28 * r + 0.28 * q + 0.16 * e + 0.14 * a + 0.14 * t;
}
