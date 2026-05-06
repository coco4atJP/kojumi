import { z } from "zod";

export const ContractStatusSchema = z.enum(["created", "accepted", "rejected", "canceled"]);
export const ExecutionStatusSchema = z.enum(["running", "completed", "failed"]);
export const DeliveryStatusSchema = z.enum(["submitted", "accepted", "rejected"]);
export const EvidenceTypeSchema = z.enum(["artifact", "telemetry", "log", "metric"]);

export const ContractSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  agentId: z.string(),
  taskCategory: z.string(),
  brief: z.string(),
  budget: z.number(),
  status: ContractStatusSchema,
  createdAt: z.string(),
});

export const ExecutionSchema = z.object({
  id: z.string(),
  contractId: z.string(),
  status: ExecutionStatusSchema,
  progress: z.number().int().default(0),
  updatedAt: z.string(),
});

export const DeliverySchema = z.object({
  id: z.string(),
  contractId: z.string(),
  executionId: z.string(),
  outputUri: z.string(),
  summary: z.string().default(""),
  status: DeliveryStatusSchema,
  createdAt: z.string(),
});

export const EvidenceRecordSchema = z.object({
  contract_id: z.string().optional(),
  execution_id: z.string().optional(),
  source: z.string().default("worker_sdk"),
  evidence_type: EvidenceTypeSchema.default("artifact"),
  payload: z.record(z.any()).default({}),
  quality_score: z.number().default(0),
});

export const EvaluationScoreSchema = z.object({
  quality_score: z.number().min(0).max(1),
  speed_score: z.number().min(0).max(1),
  cost_score: z.number().min(0).max(1),
  evidence_score: z.number().min(0).max(1),
  reliability_score: z.number().min(0).max(1),
});

export const BenchmarkCupSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  requesterTag: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const BenchmarkSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  difficulty: z.string(),
  reward: z.number(),
  suggestedReward: z.number().optional(),
  qualityStatus: z.enum(["experimental", "reviewed", "verified", "archived"]).default("experimental"),
  leaderboardWeight: z.number().min(0).max(1).default(0.3),
  requesterTag: z.string(),
  organizerType: z.string(),
  benchmarkCupId: z.string().nullable().optional(),
  metadataJson: z.string().nullable().optional(),
  hostingUrl: z.string().nullable().optional(),
  healthcheckUrl: z.string().nullable().optional(),
  healthStatus: z.string(),
  lastHeartbeatAt: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  benchmarkCup: BenchmarkCupSchema.nullable().optional(),
});

export const CreateBenchmarkCupInputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  requester_tag: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
});

export const CreateBenchmarkInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  requester_tag: z.string(),
  difficulty: z.string().optional(),
  reward: z.number().optional(),
  quality_status: z.enum(["experimental", "reviewed", "verified", "archived"]).optional(),
  leaderboard_weight: z.number().min(0).max(1).optional(),
  evaluation_tier: z.enum(["light", "standard", "high", "frontier"]).optional(),
  organizer_type: z.string().optional(),
  benchmark_cup_id: z.string().optional(),
  benchmark_cup_slug: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  metadata_json: z.string().optional(),
  hosting_url: z.string().optional(),
  healthcheck_url: z.string().optional(),
  health_status: z.string().optional(),
  status: z.string().optional(),
});

export const BenchmarkHeartbeatSchema = z.object({
  id: z.string(),
  requesterTag: z.string(),
  healthStatus: z.string(),
  lastHeartbeatAt: z.string().nullable(),
  benchmarkCup: BenchmarkCupSchema.nullable().optional(),
});

export type ContractStatus = z.infer<typeof ContractStatusSchema>;
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type EvaluationScore = z.infer<typeof EvaluationScoreSchema>;
export type BenchmarkCup = z.infer<typeof BenchmarkCupSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type CreateBenchmarkCupInput = z.infer<typeof CreateBenchmarkCupInputSchema>;
export type CreateBenchmarkInput = z.infer<typeof CreateBenchmarkInputSchema>;
export type BenchmarkHeartbeat = z.infer<typeof BenchmarkHeartbeatSchema>;
