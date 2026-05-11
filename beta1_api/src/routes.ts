import express, { Express, NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from './index';
import { issueTrialApiKey } from './auth';
import { calculateReliability, calculateQuality, calculateEfficiency, calculateAutonomy, calculateTransparencySafety, calculateComposite, scoreLowBetter, clamp } from './scoring';
import { logger } from './logger';

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
const RATE_LIMIT_MAX_READ = parseInt(process.env.RATE_LIMIT_MAX_READ || '100');
const RATE_LIMIT_MAX_WRITE = parseInt(process.env.RATE_LIMIT_MAX_WRITE || '30');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const readLimitStore = new Map<string, RateLimitEntry>();
const writeLimitStore = new Map<string, RateLimitEntry>();
const trialIssueLimitStore = new Map<string, RateLimitEntry>();

interface EvaluationFeatures {
  f_completed?: boolean;
  f_on_time?: boolean;
  f_canceled?: boolean;
  f_retry_count?: number;
  f_timeout_count?: number;
  f_missing_required_evidence_count?: number;
  f_required_evidence_count?: number;
  f_log_gap_flag?: boolean;
  f_security_incident_count?: number;
  f_accepted?: boolean;
  f_first_pass_accept?: boolean;
  f_rework_count?: number;
  f_confirmed_defect_count?: number;
  f_benchmark_score?: number;
  f_refund_flag?: boolean;
  f_chargeback_flag?: boolean;
  f_duration_ms?: number;
  f_success_cost?: number;
  f_token_count?: number;
  f_tool_calls?: number;
  f_human_interventions?: number;
  f_approval_requests?: number;
  f_manual_takeovers?: number;
  f_subagent_delegations?: number;
  f_attested_claim_count?: number;
  f_policy_incident_count?: number;
  f_unauthorized_tool_count?: number;
  f_identity_mismatch_count?: number;
  f_runtime_attestation_gap_count?: number;
}

interface EvaluationJwsPayload {
  contract_id?: string;
  delivery_id?: string;
  features?: EvaluationFeatures;
}

interface VerifiedEvaluationJwsPayload {
  contract_id: string;
  delivery_id: string;
  features: EvaluationFeatures;
}

const DEFAULT_BASELINE_DURATION_MS = Number(process.env.KOJUMI_BASELINE_DURATION_MS || 30000);
const DEFAULT_BASELINE_SUCCESS_COST = Number(process.env.KOJUMI_BASELINE_SUCCESS_COST || 1.5);
const DEFAULT_BASELINE_TOKEN_COUNT = Number(process.env.KOJUMI_BASELINE_TOKEN_COUNT || 8000);
const DEFAULT_BASELINE_TOOL_CALLS = Number(process.env.KOJUMI_BASELINE_TOOL_CALLS || 20);

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const optionalBoolScore = (value: boolean | undefined, trueScore = 1, falseScore = 0): number | null =>
  typeof value === 'boolean' ? (value ? trueScore : falseScore) : null;

const optionalInverseBoolScore = (value: boolean | undefined): number | null =>
  typeof value === 'boolean' ? (value ? 0 : 1) : null;

const optionalPresenceRate = (value: boolean | undefined): number | null =>
  typeof value === 'boolean' ? (value ? 1 : 0) : null;

const optionalCountRate = (value: number | undefined): number | null =>
  finiteNumber(value) ? (value > 0 ? 1 : 0) : null;

const lowCountScore = (value: number | undefined): number | null => {
  if (!finiteNumber(value)) return null;
  if (value <= 0) return 1;
  return clamp(1 / (1 + value));
};

const evidenceCompletenessScore = (missingCount?: number, requiredCount?: number): number | null => {
  if (!finiteNumber(missingCount)) return null;
  if (finiteNumber(requiredCount) && requiredCount > 0) {
    return clamp((requiredCount - missingCount) / requiredCount);
  }
  return missingCount <= 0 ? 1 : 0.5;
};

const coverageScore = (coveredCount?: number, requiredCount?: number): number | null => {
  if (!finiteNumber(coveredCount) || !finiteNumber(requiredCount) || requiredCount <= 0) return null;
  return clamp(coveredCount / requiredCount);
};

const scoreLowBetterOptional = (value?: number, baseline?: number): number | null => {
  if (!finiteNumber(value) || !finiteNumber(baseline) || baseline <= 0 || value <= 0) return null;
  return scoreLowBetter(value, baseline);
};

const metadataNumber = (metadata: any, keys: string[]): number | undefined => {
  for (const key of keys) {
    const segments = key.split('.');
    let current = metadata;
    for (const segment of segments) {
      current = current?.[segment];
    }
    if (finiteNumber(current)) return current;
  }
  return undefined;
};

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of readLimitStore.entries()) {
    if (now > entry.resetAt) readLimitStore.delete(key);
  }
  for (const [key, entry] of writeLimitStore.entries()) {
    if (now > entry.resetAt) writeLimitStore.delete(key);
  }
  for (const [key, entry] of trialIssueLimitStore.entries()) {
    if (now > entry.resetAt) trialIssueLimitStore.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitCleanupTimer.unref();

const getIdentifier = (req: Request): string => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string') {
    return `key:${apiKey}`;
  }
  return `ip:${req.ip}`;
};

const getRouteParam = (req: Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value || '';
};

const readLimiter = (req: Request, res: Response, next: NextFunction) => {
  const key = getIdentifier(req);
  const now = Date.now();
  const entry = readLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    readLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX_READ) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    });
  }

  entry.count++;
  next();
};

const writeLimiter = (req: Request, res: Response, next: NextFunction) => {
  const key = getIdentifier(req);
  const now = Date.now();
  const entry = writeLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    writeLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX_WRITE) {
    return res.status(429).json({
      error: 'Too many write requests',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    });
  }

  entry.count++;
  next();
};

const TRIAL_ISSUE_WINDOW_MS = parseInt(process.env.TRIAL_ISSUE_WINDOW_MS || `${24 * 60 * 60 * 1000}`);
const TRIAL_ISSUE_MAX_PER_WINDOW = parseInt(process.env.TRIAL_ISSUE_MAX_PER_WINDOW || '2');
const TRIAL_SELF_SERVE_DEFAULT_DAYS = parseInt(process.env.TRIAL_SELF_SERVE_DEFAULT_DAYS || '3');
const TRIAL_SELF_SERVE_MAX_DAYS = parseInt(process.env.TRIAL_SELF_SERVE_MAX_DAYS || '7');
const TRIAL_ABUSE_PROTECTION_VALUES = new Set(['cloudflare-rate-limit', 'turnstile', 'external']);
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const isProduction = () => process.env.NODE_ENV === 'production';

const isTrialSelfServeEnabled = () =>
  process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED !== 'false'
  && (!isProduction() || process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED === 'true');

const hasExternalTrialAbuseProtection = () =>
  TRIAL_ABUSE_PROTECTION_VALUES.has(String(process.env.KOJUMI_TRIAL_ABUSE_PROTECTION || '').trim().toLowerCase());

const usesTurnstileForTrialAbuseProtection = () =>
  String(process.env.KOJUMI_TRIAL_ABUSE_PROTECTION || '').trim().toLowerCase() === 'turnstile';

const guardTrialSelfServe = (_req: Request, res: Response, next: NextFunction) => {
  if (!isTrialSelfServeEnabled()) {
    return res.status(503).json({
      error: 'Self-serve trial key issuance is disabled on this API.'
    });
  }

  if (isProduction() && !hasExternalTrialAbuseProtection()) {
    return res.status(503).json({
      error: 'Self-serve trial key issuance requires configured external abuse protection in production.'
    });
  }

  if (usesTurnstileForTrialAbuseProtection() && !process.env.KOJUMI_TURNSTILE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Self-serve trial key issuance requires Turnstile to be configured.'
    });
  }

  next();
};

const trialIssueLimiter = (req: Request, res: Response, next: NextFunction) => {
  const key = getIdentifier(req);
  const now = Date.now();
  const entry = trialIssueLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    trialIssueLimitStore.set(key, { count: 1, resetAt: now + TRIAL_ISSUE_WINDOW_MS });
    return next();
  }

  if (entry.count >= TRIAL_ISSUE_MAX_PER_WINDOW) {
    return res.status(429).json({
      error: 'Too many trial keys requested',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    });
  }

  entry.count++;
  next();
};

const verifyTrialTurnstile = async (req: Request, res: Response, next: NextFunction) => {
  if (!usesTurnstileForTrialAbuseProtection()) {
    return next();
  }

  const secret = process.env.KOJUMI_TURNSTILE_SECRET_KEY;
  const token = typeof req.body?.turnstileToken === 'string'
    ? req.body.turnstileToken.trim()
    : '';

  if (!secret || !token) {
    return res.status(400).json({ error: 'Turnstile verification is required.' });
  }

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (req.ip) form.set('remoteip', req.ip);

    const verifyRes = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      body: form,
    });
    const body = await verifyRes.json().catch(() => null) as { success?: boolean; 'error-codes'?: string[] } | null;

    if (!verifyRes.ok || !body?.success) {
      logger.warn({ status: verifyRes.status, errors: body?.['error-codes'] }, 'Turnstile verification failed for trial key issuance');
      return res.status(400).json({ error: 'Turnstile verification failed.' });
    }

    next();
  } catch (error) {
    logger.warn({ error }, 'Turnstile verification errored for trial key issuance');
    return res.status(503).json({ error: 'Turnstile verification is temporarily unavailable.' });
  }
};

const BENCHMARK_QUALITY_WEIGHTS: Record<string, number> = {
  experimental: 0.3,
  reviewed: 0.7,
  verified: 1.0,
  archived: 0,
};

const DIRECT_CONTRACT_LEADERBOARD_WEIGHT = 0.2;
const EVALUATION_TIERS = new Set(['light', 'standard', 'high', 'frontier']);
const HIDDEN_BENCHMARK_METADATA_KEYS = new Set([
  'evaluation_tier',
  'evaluationTier',
  'evaluation_routing_tier',
  'evaluationRoutingTier',
]);

const normalizeBenchmarkQualityStatus = (status?: string): string => {
  const normalized = (status || 'experimental').toLowerCase();
  return Object.prototype.hasOwnProperty.call(BENCHMARK_QUALITY_WEIGHTS, normalized)
    ? normalized
    : 'experimental';
};

const resolveBenchmarkLeaderboardWeight = (qualityStatus?: string, requestedWeight?: unknown): number => {
  const fallback = BENCHMARK_QUALITY_WEIGHTS[normalizeBenchmarkQualityStatus(qualityStatus)];
  const numericWeight = Number(requestedWeight);
  if (!Number.isFinite(numericWeight)) return fallback;
  return Math.min(1, Math.max(0, numericWeight));
};

const resolveBenchmarkDifficulty = (leaderboardWeight: number): string => {
  if (leaderboardWeight >= 0.8) return 'hard';
  if (leaderboardWeight >= 0.4) return 'medium';
  return 'easy';
};

const parseBenchmarkMetadata = (metadataJson?: string | null) => {
  if (!metadataJson) return null;
  try {
    return JSON.parse(metadataJson);
  } catch {
    return null;
  }
};

const serializePublicBenchmarkMetadata = (metadata: any) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? null;
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !HIDDEN_BENCHMARK_METADATA_KEYS.has(key))
  );
};

const resolveEvaluationTierInput = (body: any, metadata: any): string | undefined => {
  const rawTier = String(
    body.evaluation_tier
    ?? body.evaluationTier
    ?? body.evaluation_routing_tier
    ?? body.evaluationRoutingTier
    ?? metadata?.evaluation_tier
    ?? metadata?.evaluationTier
    ?? metadata?.evaluation_routing_tier
    ?? metadata?.evaluationRoutingTier
    ?? ''
  ).trim().toLowerCase();

  if (!rawTier) return undefined;
  if (!EVALUATION_TIERS.has(rawTier)) {
    throw new Error('evaluation_tier must be one of light, standard, high, frontier');
  }
  return rawTier;
};

const buildBenchmarkMetadataJson = (body: any): string | null => {
  const metadata = body.metadata
    ? { ...body.metadata }
    : parseBenchmarkMetadata(body.metadata_json) ?? {};
  const evaluationTier = resolveEvaluationTierInput(body, metadata);
  if (evaluationTier) {
    metadata.evaluation_tier = evaluationTier;
    delete metadata.evaluationTier;
    delete metadata.evaluation_routing_tier;
    delete metadata.evaluationRoutingTier;
  }
  return Object.keys(metadata).length ? JSON.stringify(metadata) : null;
};

const resolveSuggestedReward = (reward: number, difficulty: string, qualityStatus: string): number => {
  const difficultyMultiplier: Record<string, number> = {
    low: 0.85,
    easy: 0.85,
    medium: 1,
    hard: 1.25,
  };
  const qualityMultiplier: Record<string, number> = {
    experimental: 0.9,
    reviewed: 1.1,
    verified: 1.25,
    archived: 0,
  };
  const suggested = reward
    * (difficultyMultiplier[difficulty.toLowerCase()] ?? 1)
    * (qualityMultiplier[qualityStatus] ?? 0.9);
  return Math.round(suggested * 100) / 100;
};

const serializeBenchmarkTask = (task: any) => {
  const qualityStatus = normalizeBenchmarkQualityStatus(task.qualityStatus);
  const leaderboardWeight = resolveBenchmarkLeaderboardWeight(qualityStatus, task.leaderboardWeight);
  const reward = Number(task.reward || 0);
  const difficulty = resolveBenchmarkDifficulty(leaderboardWeight);
  const publicMetadata = serializePublicBenchmarkMetadata(parseBenchmarkMetadata(task.metadataJson));

  return {
    ...task,
    difficulty,
    qualityStatus,
    leaderboardWeight,
    suggestedReward: resolveSuggestedReward(reward, difficulty, qualityStatus),
    metadataJson: publicMetadata ? JSON.stringify(publicMetadata) : null,
    healthStatus: resolveBenchmarkHealthStatus(task.healthStatus, task.lastHeartbeatAt),
  };
};

let sseConnectionCount = 0;
const SSE_MAX_CONNECTIONS = parseInt(process.env.SSE_MAX_CONNECTIONS || '50');
const GDPVAL_DATASET = process.env.GDPVAL_DATASET || 'openai/gdpval';
const GDPVAL_SPLIT = process.env.GDPVAL_SPLIT || 'train';
const GDPVAL_ROWS_URL = process.env.GDPVAL_ROWS_URL || 'https://datasets-server.huggingface.co/rows';

const getEvaluationVerifySecret = () => {
  const configuredSecret = process.env.KOJUMI_EVAL_VERIFY_SECRET || process.env.KOJUMI_EVAL_PUBLIC_KEY;
  if (configuredSecret) return configuredSecret;
  if (isProduction()) {
    throw new Error('KOJUMI_EVAL_VERIFY_SECRET or KOJUMI_EVAL_PUBLIC_KEY must be configured in production.');
  }
  return 'mock-secret-key';
};

const isEvaluationJwsPayload = (payload: string | jwt.JwtPayload): payload is VerifiedEvaluationJwsPayload => {
  if (typeof payload === 'string' || !payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as EvaluationJwsPayload;
  return Boolean(candidate.contract_id && candidate.delivery_id && candidate.features);
};

const isGdpvalBenchmark = (metadata: any) => {
  const suite = String(metadata?.benchmark_suite || metadata?.benchmarkSuite || '').toLowerCase();
  return suite === 'gdp val' || suite === 'gdpval';
};

const getGdpvalOffset = (requested: any) => {
  const parsed = Number.parseInt(String(requested ?? ''), 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 220) return parsed;
  return Math.floor(Math.random() * 220);
};

const fetchGdpvalCase = async (offset: number) => {
  const url = new URL(GDPVAL_ROWS_URL);
  url.searchParams.set('dataset', GDPVAL_DATASET);
  url.searchParams.set('split', GDPVAL_SPLIT);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', '1');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GDP Val dataset fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload: any = await response.json();
  const row = payload?.rows?.[0]?.row;
  if (!row?.task_id || !row?.prompt) {
    throw new Error('GDP Val dataset response did not include a task row');
  }
  return {
    offset,
    taskId: row.task_id,
    sector: row.sector,
    occupation: row.occupation,
    prompt: row.prompt,
    referenceFiles: row.reference_files || [],
    referenceFileUrls: row.reference_file_urls || [],
    referenceFileHfUris: row.reference_file_hf_uris || [],
    rubricPretty: row.rubric_pretty,
    rubricJson: row.rubric_json
  };
};

const sseConnectionLimiter = (req: any, res: any, next: any) => {
  if (sseConnectionCount >= SSE_MAX_CONNECTIONS) {
    res.status(429).json({
      error: 'Too many SSE connections',
      maxConnections: SSE_MAX_CONNECTIONS
    });
    return;
  }
  sseConnectionCount++;
  res.on('close', () => {
    sseConnectionCount--;
  });
  next();
};

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.KOJUMI_UPLOAD_DIR || 'uploads');
const MAX_UPLOAD_BYTES = Number(process.env.KOJUMI_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const ALLOWED_UPLOAD_MIME_TYPES = new Set(
  (process.env.KOJUMI_ALLOWED_UPLOAD_MIME_TYPES || 'application/json,text/plain,text/markdown,application/pdf,image/png,image/jpeg')
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
);

// ファイルアップロード用の設定
const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// SSE用のクライアントを保持する配列
interface SSEClient {
  res: express.Response;
  agentId?: string;
}
const clients: SSEClient[] = [];
const HEARTBEAT_STALE_MS = parseInt(process.env.BENCHMARK_HEARTBEAT_STALE_MS || `${10 * 60 * 1000}`);
const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS || '30000');
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

const parsePagination = (req: express.Request) => {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const take = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const skip = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { take, skip };
};

const pagedResponse = <T>(items: T[], take: number, skip: number) => ({
  items,
  pagination: {
    limit: take,
    offset: skip,
    hasMore: items.length === take,
  }
});

const parseCategories = (value: string) =>
  value
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);

const parseAuthorizedRequesterTags = (req: express.Request) =>
  String(req.headers['x-auth-requester-tags'] || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const hasCapability = (req: express.Request, headerName: string) =>
  String(req.headers[headerName] || 'false') === 'true';

const isTrialAuth = (req: express.Request) =>
  String(req.headers['x-auth-key-kind'] || '') === 'trial';

const hasAuthenticatedApiKey = (req: express.Request) =>
  Boolean(req.headers['x-auth-role']);

const TRIAL_AGENT_STATUS = 'trial';

const isRequesterTagAuthorized = (req: express.Request, requesterTag: string) => {
  const role = String(req.headers['x-auth-role'] || '');
  if (role === 'operator') {
    return true;
  }

  const allowedTags = parseAuthorizedRequesterTags(req);
  return allowedTags.includes('*') || allowedTags.includes(requesterTag);
};

const resolveBenchmarkHealthStatus = (status: string, lastHeartbeatAt: Date | null): string => {
  if (!lastHeartbeatAt) {
    return status || 'unknown';
  }

  if (Date.now() - lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS) {
    return 'stale';
  }

  return status || 'healthy';
};

const removeSseClient = (client: SSEClient) => {
  const index = clients.indexOf(client);
  if (index !== -1) {
    clients.splice(index, 1);
  }
};

const serializeContractForEvent = (contract: any) => ({
  id: contract.id,
  requesterId: contract.requesterId,
  agentId: contract.agentId,
  benchmarkId: contract.benchmarkId,
  taskCategory: contract.taskCategory,
  brief: contract.brief,
  budget: contract.budget,
  status: contract.status,
  createdAt: contract.createdAt,
});

// 全クライアントまたは特定の対象エージェントへタスクイベントを送信
const broadcastContractEvent = (eventData: any, targetAgentId?: string) => {
  const dataString = `data: ${JSON.stringify(eventData)}\n\n`;
  setImmediate(() => {
    clients.slice().forEach(client => {
      // クライアントがagentIdを指定していない（全受信）、またはターゲットと一致する場合のみ送信
      if (!targetAgentId || !client.agentId || client.agentId === targetAgentId) {
        try {
          client.res.write(dataString);
        } catch (error) {
          logger.warn({ error, agent_id: client.agentId }, 'Failed to write SSE contract event');
          removeSseClient(client);
        }
      }
    });
  });
};

export function setupRoutes(app: Express) {

  // ----------------------------------------------------------------------
  // SELF-SERVE TRIAL KEYS
  // ----------------------------------------------------------------------
  app.post('/v1/trial-keys', guardTrialSelfServe, trialIssueLimiter, verifyTrialTurnstile, (req, res) => {
    try {
      const rawLabel = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const label = rawLabel || `trial-${new Date().toISOString().slice(0, 10)}`;
      const requestedDays = Number(req.body?.days);
      const days = Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(Math.ceil(requestedDays), TRIAL_SELF_SERVE_MAX_DAYS)
        : TRIAL_SELF_SERVE_DEFAULT_DAYS;

      const record = issueTrialApiKey(label.slice(0, 80), { days });
      logger.info({ key_id: record.id, label: record.label, expires_at: record.expiresAt }, 'Self-serve trial key issued');

      res.status(201).json({
        id: record.id,
        label: record.label,
        role: record.role,
        kind: record.kind,
        apiKey: record.key,
        expiresAt: record.expiresAt,
        capabilities: record.capabilities,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------------------------------------------------
  // SKILL DEFINITION (OpenClaw用)
  // ----------------------------------------------------------------------
  app.get('/v1/skill', readLimiter, (req, res) => {
    try {
      const skillPath = path.resolve(__dirname, './SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      res.type('text/markdown');
      res.send(content);
    } catch (e: any) {
      res.status(500).json({ error: "SKILL.md not found or cannot be read." });
    }
  });

  // ----------------------------------------------------------------------
  // LEADERBOARD
  // ----------------------------------------------------------------------
  app.get('/v1/leaderboard', readLimiter, async (req, res) => {
    try {
      const category = req.query.category as string;
      const { take, skip } = parsePagination(req);
      const agents = await prisma.agent.findMany({
        where: { status: { not: TRIAL_AGENT_STATUS } },
        select: { id: true, name: true, categories: true, basePrice: true, owner: true },
      });
      
      const statsArray = category 
        ? await prisma.$queryRaw<any[]>`
            SELECT 
              c.agentId as agentId, 
              COUNT(e.id) as count, 
              SUM(CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as weightTotal,
              SUM(e.totalScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as total, 
              SUM(e.qualityScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as q,
              SUM(e.speedScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as s,
              SUM(e.costScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as c,
              SUM(e.evidenceScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as e,
              SUM(e.reliabilityScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as r
            FROM Evaluation e
            JOIN Delivery d ON e.deliveryId = d.id
            JOIN Contract c ON d.contractId = c.id
            JOIN Agent a ON c.agentId = a.id
            LEFT JOIN BenchmarkTask bt ON c.benchmarkId = bt.id
            WHERE c.taskCategory = ${category}
              AND a.status != ${TRIAL_AGENT_STATUS}
            GROUP BY c.agentId
          `
        : await prisma.$queryRaw<any[]>`
            SELECT 
              c.agentId as agentId, 
              COUNT(e.id) as count, 
              SUM(CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as weightTotal,
              SUM(e.totalScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as total, 
              SUM(e.qualityScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as q,
              SUM(e.speedScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as s,
              SUM(e.costScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as c,
              SUM(e.evidenceScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as e,
              SUM(e.reliabilityScore * CASE WHEN c.benchmarkId IS NULL THEN ${DIRECT_CONTRACT_LEADERBOARD_WEIGHT} ELSE COALESCE(bt.leaderboardWeight, 0.3) END) as r
            FROM Evaluation e
            JOIN Delivery d ON e.deliveryId = d.id
            JOIN Contract c ON d.contractId = c.id
            JOIN Agent a ON c.agentId = a.id
            LEFT JOIN BenchmarkTask bt ON c.benchmarkId = bt.id
            WHERE a.status != ${TRIAL_AGENT_STATUS}
            GROUP BY c.agentId
          `;

      const scores: Record<string, any> = {};
      statsArray.forEach((row: any) => {
        scores[row.agentId] = {
          count: Number(row.count),
          weightTotal: Number(row.weightTotal),
          total: Number(row.total),
          q: Number(row.q),
          s: Number(row.s),
          c: Number(row.c),
          e: Number(row.e),
          r: Number(row.r)
        };
      });
      
      const leaderboard = agents.map(a => {
        const stats = scores[a.id];
        const evaluationsCount = stats ? stats.count : 0;
        const weightTotal = stats ? stats.weightTotal : 0;
        return {
          agentId: a.id,
          agentName: a.name,
          owner: a.owner,
          categories: a.categories.split(','),
          basePriceCredits: a.basePrice,
          averageScore: stats && weightTotal > 0 ? parseFloat((stats.total / weightTotal).toFixed(2)) : 0,
          evaluationsCount,
          rankingWeight: parseFloat(weightTotal.toFixed(2)),
          detailedScores: stats && weightTotal > 0 ? {
            quality: parseFloat((stats.q / weightTotal).toFixed(2)),
            speed: parseFloat((stats.s / weightTotal).toFixed(2)),
            cost: parseFloat((stats.c / weightTotal).toFixed(2)),
            evidence: parseFloat((stats.e / weightTotal).toFixed(2)),
            reliability: parseFloat((stats.r / weightTotal).toFixed(2)),
          } : { quality: 0, speed: 0, cost: 0, evidence: 0, reliability: 0 }
        };
      }).filter(a => category ? a.evaluationsCount > 0 : true)
        .sort((a, b) => b.averageScore - a.averageScore);
      
      const pageItems = leaderboard.slice(skip, skip + take);
      res.json(pagedResponse(pageItems, take, skip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // RECENT ACTIVITIES
  // ----------------------------------------------------------------------
  app.get('/v1/activities', readLimiter, async (req, res) => {
    try {
      const includeTrial = req.query.include_trial === 'true' && hasAuthenticatedApiKey(req);
      const evaluations = await prisma.evaluation.findMany({
        take: 20,
        where: includeTrial ? undefined : {
          delivery: {
            contract: {
              agent: { status: { not: TRIAL_AGENT_STATUS } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        include: {
          delivery: {
            include: {
              contract: {
                include: { agent: true, benchmark: true }
              }
            }
          }
        }
      });

      const activities = evaluations.map(ev => ({
        id: ev.id,
        type: 'evaluation',
        agentName: ev.delivery.contract.agent.name,
        taskName: ev.delivery.contract.benchmark?.title || ev.delivery.contract.brief,
        reward: ev.delivery.contract.budget,
        score: ev.totalScore,
        createdAt: ev.createdAt
      }));

      res.json({ items: activities });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // BENCHMARK TASKS
  // ----------------------------------------------------------------------
  app.get('/v1/benchmarks', readLimiter, async (req, res) => {
    try {
      const { take, skip } = parsePagination(req);
      const category = req.query.category as string;
      const requesterTag = req.query.requester_tag as string;
      const cupSlug = req.query.cup as string;
      const where = {
        status: 'active',
        ...(category ? { category } : {}),
        ...(requesterTag ? { requesterTag } : {}),
        ...(cupSlug ? { benchmarkCup: { slug: cupSlug } } : {}),
      };
      const tasks = await prisma.benchmarkTask.findMany({
        where,
        include: { benchmarkCup: true },
        take,
        skip,
        orderBy: [{ requesterTag: 'asc' }, { createdAt: 'desc' }]
      });

      res.json(pagedResponse(
        tasks.map(serializeBenchmarkTask),
        take,
        skip
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/benchmark-cups', readLimiter, async (_req, res) => {
    try {
      const cups = await prisma.benchmarkCup.findMany({
        where: { status: 'active' },
        include: { _count: { select: { benchmarks: { where: { status: 'active' } } } } },
        orderBy: { createdAt: 'asc' }
      });

      res.json({
        items: cups.map((cup) => ({
          ...cup,
          benchmarkCount: cup._count.benchmarks,
          _count: undefined,
        }))
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/benchmark-cups', writeLimiter, async (req, res) => {
    try {
      if (!req.body.slug || !req.body.title || !req.body.requester_tag) {
        return res.status(400).json({ error: "slug, title, and requester_tag are required" });
      }
      if (!hasCapability(req, 'x-auth-benchmark-publishing')) {
        return res.status(403).json({ error: "This API key is not allowed to publish benchmarks" });
      }
      if (!isRequesterTagAuthorized(req, req.body.requester_tag)) {
        return res.status(403).json({ error: "This API key is not allowed to manage the requested requester_tag" });
      }

      const cup = await prisma.benchmarkCup.create({
        data: {
          slug: req.body.slug,
          title: req.body.title,
          description: req.body.description || '',
          requesterTag: req.body.requester_tag,
          status: req.body.status || 'active'
        }
      });

      res.status(201).json(cup);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/benchmarks', writeLimiter, async (req, res) => {
    try {
      if (!req.body.title || !req.body.description || !req.body.category || !req.body.requester_tag) {
        return res.status(400).json({ error: "title, description, category, and requester_tag are required" });
      }
      if (!hasCapability(req, 'x-auth-benchmark-publishing')) {
        return res.status(403).json({ error: "This API key is not allowed to publish benchmarks" });
      }
      if (!isRequesterTagAuthorized(req, req.body.requester_tag)) {
        return res.status(403).json({ error: "This API key is not allowed to manage the requested requester_tag" });
      }

      let benchmarkCupId: string | undefined;

      if (req.body.benchmark_cup_id) {
        const cup = await prisma.benchmarkCup.findUnique({ where: { id: req.body.benchmark_cup_id } });
        if (!cup) {
          return res.status(404).json({ error: "Benchmark cup not found" });
        }
        if (cup.requesterTag !== req.body.requester_tag) {
          return res.status(400).json({ error: "benchmark cup requester_tag must match benchmark requester_tag" });
        }
        benchmarkCupId = cup.id;
      } else if (req.body.benchmark_cup_slug) {
        const cup = await prisma.benchmarkCup.findUnique({ where: { slug: req.body.benchmark_cup_slug } });
        if (!cup) {
          return res.status(404).json({ error: "Benchmark cup not found" });
        }
        if (cup.requesterTag !== req.body.requester_tag) {
          return res.status(400).json({ error: "benchmark cup requester_tag must match benchmark requester_tag" });
        }
        benchmarkCupId = cup.id;
      }

      const qualityStatus = normalizeBenchmarkQualityStatus(req.body.quality_status || req.body.qualityStatus);
      const leaderboardWeight = resolveBenchmarkLeaderboardWeight(qualityStatus, req.body.leaderboard_weight ?? req.body.leaderboardWeight);
      const difficulty = resolveBenchmarkDifficulty(leaderboardWeight);
      let metadataJson: string | null;
      try {
        metadataJson = buildBenchmarkMetadataJson(req.body);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
      const benchmark = await prisma.benchmarkTask.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          category: req.body.category,
          difficulty,
          reward: Number(req.body.reward) || 0,
          qualityStatus,
          leaderboardWeight,
          requesterTag: req.body.requester_tag,
          organizerType: req.body.organizer_type || 'requester',
          benchmarkCupId,
          metadataJson,
          hostingUrl: req.body.hosting_url || null,
          healthcheckUrl: req.body.healthcheck_url || null,
          healthStatus: req.body.health_status || 'unknown',
          status: req.body.status || 'active',
          expiresAt: req.body.expires_at ? new Date(req.body.expires_at) : null
        },
        include: { benchmarkCup: true }
      });

      res.status(201).json(serializeBenchmarkTask(benchmark));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/benchmarks/:id/heartbeat', writeLimiter, async (req, res) => {
    try {
      if (!hasCapability(req, 'x-auth-benchmark-heartbeat')) {
        return res.status(403).json({ error: "This API key is not allowed to send benchmark heartbeats" });
      }
      const benchmarkId = getRouteParam(req, 'id');
      const benchmark = await prisma.benchmarkTask.findUnique({
        where: { id: benchmarkId }
      });
      if (!benchmark) {
        return res.status(404).json({ error: "Benchmark task not found" });
      }
      if (!isRequesterTagAuthorized(req, benchmark.requesterTag)) {
        return res.status(403).json({ error: "This API key is not allowed to manage the requested requester_tag" });
      }

      const reportedStatus = typeof req.body.status === 'string' ? req.body.status : 'healthy';
      const now = new Date();
      const updated = await prisma.benchmarkTask.update({
        where: { id: benchmark.id },
        data: {
          lastHeartbeatAt: now,
          healthStatus: reportedStatus
        },
        include: { benchmarkCup: true }
      });

      res.json({
        id: updated.id,
        requesterTag: updated.requesterTag,
        healthStatus: resolveBenchmarkHealthStatus(updated.healthStatus, updated.lastHeartbeatAt),
        lastHeartbeatAt: updated.lastHeartbeatAt,
        benchmarkCup: updated.benchmarkCup
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/benchmarks/:id/attempt', writeLimiter, async (req, res) => {
    try {
      if (!req.body.agent_id) return res.status(400).json({ error: "agent_id is required" });
      const benchmarkId = getRouteParam(req, 'id');

      const benchmark = await prisma.benchmarkTask.findUnique({
        where: { id: benchmarkId },
        include: { benchmarkCup: true }
      });
      if (!benchmark) {
        return res.status(404).json({ error: "Benchmark task not found" });
      }
      if (benchmark.expiresAt && benchmark.expiresAt < new Date()) {
        return res.status(400).json({ error: "This bounty has expired and can no longer be accepted." });
      }

      const agent = await prisma.agent.findUnique({
        where: { id: req.body.agent_id },
        select: { id: true, status: true }
      });
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }
      if (isTrialAuth(req) && agent.status !== TRIAL_AGENT_STATUS) {
        return res.status(403).json({ error: "Trial keys can only start benchmark attempts for trial agents." });
      }

      const benchmarkMetadata = parseBenchmarkMetadata(benchmark.metadataJson);
      const publicBenchmarkMetadata = serializePublicBenchmarkMetadata(benchmarkMetadata);
      const gdpvalCase = isGdpvalBenchmark(benchmarkMetadata)
        ? await fetchGdpvalCase(getGdpvalOffset(req.body.gdpval_offset ?? req.body.gdpvalOffset))
        : null;
      const benchmarkBrief = gdpvalCase
        ? [
            benchmark.description,
            '',
            'GDP Val task context:',
            `Task ID: ${gdpvalCase.taskId}`,
            `Sector: ${gdpvalCase.sector}`,
            `Occupation: ${gdpvalCase.occupation}`,
            '',
            gdpvalCase.prompt,
            '',
            'Reference files:',
            ...(gdpvalCase.referenceFiles.length
              ? gdpvalCase.referenceFiles.map((file: string, index: number) => `- ${file}: ${gdpvalCase.referenceFileUrls[index] || gdpvalCase.referenceFileHfUris[index] || 'provided in benchmark metadata'}`)
              : ['- None']),
            '',
            'Submit the requested work product in the format implied by the task prompt. Include a concise rationale and cite any reference files or sources used.'
          ].join('\n')
        : benchmark.description;

      const contract = await prisma.contract.create({
        data: {
          requesterId: isTrialAuth(req)
            ? `trial_benchmark_runner:${String(req.headers['x-auth-key-id'] || 'unknown')}:${benchmark.requesterTag}`
            : `benchmark_runner:${benchmark.requesterTag}`,
          agentId: req.body.agent_id,
          benchmarkId: benchmark.id,
          taskCategory: benchmark.category,
          brief: benchmarkBrief,
          budget: benchmark.reward,
          status: 'created'
        }
      });
      
      broadcastContractEvent({
        event: 'contract_created',
        type: 'benchmark',
        contract: serializeContractForEvent(contract)
      }, contract.agentId);

      logger.info({ contract_id: contract.id, agent_id: req.body.agent_id, benchmark_id: benchmark.id, type: 'benchmark' }, 'Benchmark attempt started');

      const benchmarkWithCup = benchmark as typeof benchmark & {
        benchmarkCup?: { slug: string; title: string } | null;
      };

      res.status(201).json({
        message: "Benchmark attempt started. Use contract_id to proceed.",
        contract_id: contract.id,
        benchmark: {
          title: benchmark.title,
          requesterTag: benchmark.requesterTag,
          organizerType: benchmark.organizerType,
          qualityStatus: normalizeBenchmarkQualityStatus(benchmark.qualityStatus),
          leaderboardWeight: resolveBenchmarkLeaderboardWeight(benchmark.qualityStatus, benchmark.leaderboardWeight),
          difficulty: resolveBenchmarkDifficulty(resolveBenchmarkLeaderboardWeight(benchmark.qualityStatus, benchmark.leaderboardWeight)),
          suggestedReward: resolveSuggestedReward(
            Number(benchmark.reward || 0),
            resolveBenchmarkDifficulty(resolveBenchmarkLeaderboardWeight(benchmark.qualityStatus, benchmark.leaderboardWeight)),
            normalizeBenchmarkQualityStatus(benchmark.qualityStatus)
          ),
          healthStatus: resolveBenchmarkHealthStatus(benchmark.healthStatus, benchmark.lastHeartbeatAt),
          cup: benchmarkWithCup.benchmarkCup ? {
            slug: benchmarkWithCup.benchmarkCup.slug,
            title: benchmarkWithCup.benchmarkCup.title
          } : null,
          metadata: gdpvalCase
            ? {
                ...publicBenchmarkMetadata,
                assigned_case: gdpvalCase
              }
            : publicBenchmarkMetadata
        }
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // AGENTS
  // ----------------------------------------------------------------------
  app.get('/v1/agents', readLimiter, async (req, res) => {
    try {
      const category = req.query.category as string;
      const includeTrial = req.query.include_trial === 'true' && hasAuthenticatedApiKey(req);
      const { take, skip } = parsePagination(req);
      const agents = category 
        ? includeTrial
          ? await prisma.$queryRaw<any[]>`SELECT * FROM Agent WHERE ',' || categories || ',' LIKE '%,' || ${category} || ',%' ORDER BY createdAt DESC LIMIT ${take} OFFSET ${skip}`
          : await prisma.$queryRaw<any[]>`SELECT * FROM Agent WHERE status != ${TRIAL_AGENT_STATUS} AND ',' || categories || ',' LIKE '%,' || ${category} || ',%' ORDER BY createdAt DESC LIMIT ${take} OFFSET ${skip}`
        : await prisma.agent.findMany({
            where: includeTrial ? undefined : { status: { not: TRIAL_AGENT_STATUS } },
            take,
            skip,
            orderBy: { createdAt: 'desc' }
          });

      const statsArray = await prisma.$queryRaw<any[]>`
        SELECT 
          c.agentId as agentId, 
          COUNT(e.id) as count, 
          SUM(e.totalScore) as total, 
          SUM(e.qualityScore) as q,
          SUM(e.speedScore) as s,
          SUM(e.costScore) as c,
          SUM(e.evidenceScore) as e,
          SUM(e.reliabilityScore) as r
        FROM Evaluation e
        JOIN Delivery d ON e.deliveryId = d.id
        JOIN Contract c ON d.contractId = c.id
        JOIN Agent a ON c.agentId = a.id
        WHERE ${includeTrial} OR a.status != ${TRIAL_AGENT_STATUS}
        GROUP BY c.agentId
      `;
      
      const scores: Record<string, any> = {};
      statsArray.forEach((row: any) => {
        scores[row.agentId] = {
          count: Number(row.count),
          total: Number(row.total),
          q: Number(row.q),
          s: Number(row.s),
          c: Number(row.c),
          e: Number(row.e),
          r: Number(row.r)
        };
      });

      res.json(pagedResponse(
        agents.map((agent: any) => {
          const stats = scores[agent.id];
          const evaluationsCount = stats ? stats.count : 0;
          return {
            ...agent,
            categories: parseCategories(agent.categories),
            sandbox: agent.status === TRIAL_AGENT_STATUS,
            metrics: {
              averageScore: stats ? parseFloat((stats.total / stats.count).toFixed(2)) : 0,
              evaluationsCount,
              detailedScores: stats ? {
                quality: parseFloat((stats.q / evaluationsCount).toFixed(2)),
                speed: parseFloat((stats.s / evaluationsCount).toFixed(2)),
                cost: parseFloat((stats.c / evaluationsCount).toFixed(2)),
                evidence: parseFloat((stats.e / evaluationsCount).toFixed(2)),
                reliability: parseFloat((stats.r / evaluationsCount).toFixed(2)),
              } : { quality: 0, speed: 0, cost: 0, evidence: 0, reliability: 0 }
            }
          };
        }),
        take,
        skip
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/agents/:id', readLimiter, async (req, res) => {
    try {
      const agent = await prisma.agent.findUnique({ where: { id: getRouteParam(req, 'id') } });
      if (!agent) return res.status(404).json({ error: "Agent not found" });
      if (agent.status === TRIAL_AGENT_STATUS && !hasAuthenticatedApiKey(req)) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const [scoreStats] = await prisma.$queryRaw<any[]>`
        SELECT 
          COUNT(e.id) as count,
          SUM(e.totalScore) as total,
          SUM(e.qualityScore) as q,
          SUM(e.speedScore) as s,
          SUM(e.costScore) as c,
          SUM(e.evidenceScore) as ev,
          SUM(e.reliabilityScore) as r
        FROM Evaluation e
        JOIN Delivery d ON e.deliveryId = d.id
        JOIN Contract c ON d.contractId = c.id
        WHERE c.agentId = ${agent.id}
      `;

      const recentEvaluations = await prisma.evaluation.findMany({
        where: { delivery: { contract: { agentId: agent.id } } },
        include: { delivery: { include: { contract: { include: { benchmark: true } } } } },
        take: 10,
        orderBy: { createdAt: 'desc' }
      });
      
      let averageScore = 0;
      let evaluationsCount = Number(scoreStats?.count || 0);
      let detailedScores = { quality: 0, speed: 0, cost: 0, evidence: 0, reliability: 0 };
      
      if (evaluationsCount > 0) {
        const total = Number(scoreStats.total || 0);
        const q = Number(scoreStats.q || 0);
        const s = Number(scoreStats.s || 0);
        const c = Number(scoreStats.c || 0);
        const e = Number(scoreStats.ev || 0);
        const r = Number(scoreStats.r || 0);
        averageScore = parseFloat((total / evaluationsCount).toFixed(2));
        detailedScores = {
          quality: parseFloat((q / evaluationsCount).toFixed(2)),
          speed: parseFloat((s / evaluationsCount).toFixed(2)),
          cost: parseFloat((c / evaluationsCount).toFixed(2)),
          evidence: parseFloat((e / evaluationsCount).toFixed(2)),
          reliability: parseFloat((r / evaluationsCount).toFixed(2)),
        };
      }

      const recentDeliveries = recentEvaluations.map(ev => ({
        taskName: ev.delivery.contract.benchmark?.title || ev.delivery.contract.brief,
        score: ev.totalScore,
        date: ev.createdAt,
        status: ev.delivery.status
      }));

      res.json({
        ...agent,
        categories: parseCategories(agent.categories),
        sandbox: agent.status === TRIAL_AGENT_STATUS,
        metrics: {
          averageScore,
          evaluationsCount,
          detailedScores
        },
        recentDeliveries
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  
  app.post('/v1/agents', writeLimiter, async (req, res) => {
    try {
      if (!req.body.name) return res.status(400).json({ error: "name is required" });

      const agent = await prisma.agent.create({
        data: {
          name: req.body.name,
          description: req.body.description || '',
          categories: (req.body.categories || []).join(','),
          basePrice: Number(req.body.base_price) || 0,
          owner: req.body.owner || null,
          status: isTrialAuth(req) ? TRIAL_AGENT_STATUS : 'active'
        }
      });
      logger.info({ agent_id: agent.id, name: agent.name }, 'Agent registered');
      res.status(201).json(agent);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // CONTRACTS
  // ----------------------------------------------------------------------
  app.get('/v1/contracts', readLimiter, async (req, res) => {
    try {
      const { take, skip } = parsePagination(req);
      const agentId = req.query.agent_id as string;
      const contracts = agentId 
        ? await prisma.contract.findMany({ where: { agentId }, take, skip, orderBy: { createdAt: 'desc' } })
        : await prisma.contract.findMany({ take, skip, orderBy: { createdAt: 'desc' } });
      res.json(pagedResponse(contracts, take, skip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // SSE: タスク依頼のストリーム購読
  app.get('/v1/contracts/stream', sseConnectionLimiter, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const agentId = req.query.agent_id as string;
    const clientObj = { res, agentId };
    clients.push(clientObj);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch (error) {
        logger.warn({ error, agent_id: agentId }, 'Failed to write SSE heartbeat');
        clearInterval(heartbeat);
        removeSseClient(clientObj);
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();

    res.write(`data: ${JSON.stringify({ message: "Connected to Kojumi Contract Stream", filterAgentId: agentId || "none (all)" })}\n\n`);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeSseClient(clientObj);
    });
  });

  app.get('/v1/contracts/:id', readLimiter, async (req, res) => {
    try {
      const contract = await prisma.contract.findUnique({ 
        where: { id: getRouteParam(req, 'id') },
        include: { agent: true, benchmark: true }
      });
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/contracts', writeLimiter, async (req, res) => {
    try {
      if (!hasCapability(req, 'x-auth-contract-creation')) {
        return res.status(403).json({ error: "This API key is not allowed to create direct-hire contracts" });
      }
      if (!req.body.requester_id || !req.body.agent_id || !req.body.task_category || !req.body.brief) {
        return res.status(400).json({ error: "requester_id, agent_id, task_category, and brief are required" });
      }

      const contract = await prisma.contract.create({
        data: {
          requesterId: req.body.requester_id,
          agentId: req.body.agent_id,
          taskCategory: req.body.task_category,
          brief: req.body.brief,
          budget: Number(req.body.budget) || 0,
          status: 'created'
        }
      });
      
      broadcastContractEvent({
        event: 'contract_created',
        type: 'direct_hire',
        contract: serializeContractForEvent(contract)
      }, contract.agentId);

      logger.info({ contract_id: contract.id, requester_id: req.body.requester_id, agent_id: req.body.agent_id, task_category: req.body.task_category }, 'Contract created');

      res.status(201).json(contract);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  
  app.post('/v1/contracts/:id/accept', writeLimiter, async (req, res) => {
    try {
      const contract = await prisma.contract.update({
        where: { id: getRouteParam(req, 'id') },
        data: { status: 'accepted' }
      });
      logger.info({ contract_id: contract.id }, 'Contract accepted');
      res.json({ id: contract.id, status: contract.status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // EXECUTIONS & EVENTS
  // ----------------------------------------------------------------------
  app.get('/v1/executions', readLimiter, async (req, res) => {
    try {
      const { take, skip } = parsePagination(req);
      const contractId = req.query.contract_id as string;
      const executions = contractId
        ? await prisma.execution.findMany({ where: { contractId }, take, skip, orderBy: { updatedAt: 'desc' } })
        : await prisma.execution.findMany({ take, skip, orderBy: { updatedAt: 'desc' } });
      res.json(pagedResponse(executions, take, skip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/executions/:id', readLimiter, async (req, res) => {
    try {
      const ex = await prisma.execution.findUnique({ where: { id: getRouteParam(req, 'id') } });
      if (!ex) return res.status(404).json({ error: "Execution not found" });
      res.json(ex);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/executions/:id/events', readLimiter, async (req, res) => {
    try {
      const { take, skip } = parsePagination(req);
      const events = await prisma.executionEvent.findMany({ 
        where: { executionId: getRouteParam(req, 'id') },
        take,
        skip,
        orderBy: { createdAt: 'asc' }
      });
      res.json(pagedResponse(events, take, skip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/executions', writeLimiter, async (req, res) => {
    try {
      if (!req.body.contract_id) return res.status(400).json({ error: "contract_id is required" });

      const ex = await prisma.execution.create({
        data: {
          contractId: req.body.contract_id,
          status: 'running',
          progress: Number(req.body.progress) || 0
        }
      });
      res.status(201).json(ex);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  
  app.post('/v1/executions/:id/events', writeLimiter, async (req, res) => {
    try {
      const ev = await prisma.executionEvent.create({
        data: {
          executionId: getRouteParam(req, 'id'),
          eventType: req.body.event_type || 'log',
          message: req.body.message || ''
        }
      });
      res.status(201).json(ev);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  
  app.post('/v1/executions/:id/complete', writeLimiter, async (req, res) => {
    try {
      const ex = await prisma.execution.update({
        where: { id: getRouteParam(req, 'id') },
        data: { status: 'completed', progress: 100 }
      });
      res.json({ id: ex.id, status: ex.status, progress: ex.progress });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // DELIVERIES
  // ----------------------------------------------------------------------
    app.get('/v1/deliveries', readLimiter, async (req, res) => {
      try {
        const { take, skip } = parsePagination(req);
        const contractId = req.query.contract_id as string;
        const status = req.query.status as string;
        
        const whereClause: any = {};
        if (contractId) whereClause.contractId = contractId;
        if (status) whereClause.status = status;

        const deliveries = await prisma.delivery.findMany({ 
          where: whereClause, 
          take,
          skip,
          orderBy: { createdAt: 'desc' },
          include: { contract: { include: { agent: true, benchmark: true } } }
        });
        res.json(pagedResponse(deliveries, take, skip));
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/v1/deliveries/:id/file', readLimiter, async (req, res) => {
      try {
        const del = await prisma.delivery.findUnique({ where: { id: getRouteParam(req, 'id') } });
        if (!del) return res.status(404).json({ error: "Delivery not found" });
        if (!del.outputUri.startsWith('local://')) {
          return res.status(400).json({ error: "Delivery does not reference a local file" });
        }

        const filePath = del.outputUri.replace('local://', '');
        const fullPath = path.resolve(filePath);
        if (!fullPath.startsWith(`${UPLOAD_DIR}${path.sep}`)) {
          return res.status(400).json({ error: "Delivery file path is outside the upload directory" });
        }

        res.sendFile(fullPath);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.get('/v1/deliveries/:id', readLimiter, async (req, res) => {
      try {
        const del = await prisma.delivery.findUnique({ where: { id: getRouteParam(req, 'id') } });
        if (!del) return res.status(404).json({ error: "Delivery not found" });
        res.json(del);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    app.post('/v1/deliveries', writeLimiter, (req, res, next) => {
      upload.single('file')(req, res, (error) => {
        if (error instanceof multer.MulterError) {
          return res.status(413).json({ error: error.message });
        }
        if (error) {
          return res.status(415).json({ error: error.message });
        }
        next();
      });
    }, async (req, res) => {
      try {
        if (!req.body.contract_id || !req.body.execution_id) {
          return res.status(400).json({ error: "contract_id and execution_id are required" });
        }

        let outputUri = req.body.outputUri || req.body.output_uri || '';

        if (req.file) {
          outputUri = `local://${req.file.path}`;
        }

        const del = await prisma.delivery.create({
          data: {
            contractId: req.body.contract_id,
            executionId: req.body.execution_id,
            outputUri: outputUri,
            summary: req.body.summary || '',
            status: 'submitted'
          }
        });

        res.status(201).json(del);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });  
  app.post('/v1/deliveries/:id/accept', writeLimiter, async (req, res) => {
    try {
      const del = await prisma.delivery.update({
        where: { id: getRouteParam(req, 'id') },
        data: { status: 'accepted' }
      });
      res.json({ id: del.id, status: del.status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/deliveries/:id/reject', writeLimiter, async (req, res) => {
    try {
      const del = await prisma.delivery.update({
        where: { id: getRouteParam(req, 'id') },
        data: { status: 'rejected' }
      });
      res.json({ id: del.id, status: del.status });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/v1/deliveries/:id', writeLimiter, async (req, res) => {
    try {
      const deliveryId = getRouteParam(req, 'id');
      const del = await prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!del) return res.status(404).json({ error: "Delivery not found" });

      if (del.outputUri.startsWith('local://')) {
        const filePath = del.outputUri.replace('local://', '');
        const fullPath = path.resolve(filePath);
        if (!fullPath.startsWith(`${UPLOAD_DIR}${path.sep}`)) {
          return res.status(400).json({ error: "Delivery file path is outside the upload directory" });
        }
        try {
          await fs.promises.unlink(fullPath);
          logger.info(`Deleted file: ${fullPath}`);
        } catch (error: any) {
          if (error?.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      const updatedDel = await prisma.delivery.update({
        where: { id: deliveryId },
        data: { outputUri: 'deleted://' }
      });

      res.json({ id: updatedDel.id, status: "file_deleted" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // EVIDENCE
  // ----------------------------------------------------------------------
  app.post('/v1/evidence', writeLimiter, async (req, res) => {
    try {
      const ev = await prisma.evidence.create({
        data: {
          contractId: req.body.contract_id,
          executionId: req.body.execution_id,
          source: req.body.source || 'manual',
          evidenceType: req.body.evidence_type || 'artifact',
          payloadJson: JSON.stringify(req.body.payload || {}),
          qualityScore: Number(req.body.quality_score) || 0
        }
      });
      res.status(201).json(ev);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // EVALUATIONS
  // ----------------------------------------------------------------------
  app.get('/v1/evaluations', readLimiter, async (req, res) => {
    try {
      const { take, skip } = parsePagination(req);
      const contractId = req.query.contract_id as string;
      const evaluations = contractId
        ? await prisma.evaluation.findMany({ where: { contractId }, take, skip, orderBy: { createdAt: 'desc' } })
        : await prisma.evaluation.findMany({ take, skip, orderBy: { createdAt: 'desc' } });
      res.json(pagedResponse(evaluations, take, skip));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/v1/evaluations/:id', readLimiter, async (req, res) => {
    try {
      const evalItem = await prisma.evaluation.findUnique({ where: { id: getRouteParam(req, 'id') } });
      if (!evalItem) return res.status(404).json({ error: "Evaluation not found" });
      res.json(evalItem);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/v1/evaluations', writeLimiter, async (req, res) => {
    try {
      const { jws } = req.body;
      if (!jws) {
        return res.status(400).json({ error: "Missing 'jws' payload in request body" });
      }

      let verifySecret: string;
      try {
        verifySecret = getEvaluationVerifySecret();
      } catch (error: any) {
        logger.error({ error: error.message }, 'Evaluation verification is not configured');
        return res.status(503).json({ error: 'Evaluation verification is not configured on this server.' });
      }

      let payload: VerifiedEvaluationJwsPayload;
      try {
        const verifiedPayload = jwt.verify(jws, verifySecret);
        if (!isEvaluationJwsPayload(verifiedPayload)) {
          return res.status(400).json({ error: "JWS payload must include contract_id, delivery_id, and features" });
        }
        payload = verifiedPayload;
      } catch (err) {
        return res.status(401).json({ error: "Invalid or tampered JWS signature" });
      }

      const { contract_id, delivery_id, features } = payload;

      const existingEvaluation = await prisma.evaluation.findUnique({
        where: { deliveryId: delivery_id }
      });
      if (existingEvaluation) {
        logger.info({ evaluation_id: existingEvaluation.id, delivery_id }, 'Evaluation already exists for delivery');
        return res.status(200).json(existingEvaluation);
      }

      const contract = await prisma.contract.findUnique({
        where: { id: contract_id },
        include: { benchmark: true },
      });
      const benchmarkMetadata = parseJsonObject(contract?.benchmark?.metadataJson);
      const durationBaseline =
        metadataNumber(benchmarkMetadata, [
          'scoring_baselines.duration_ms',
          'performance_targets.duration_ms',
          'performance_targets.target_duration_ms',
          'target_duration_ms',
        ]) ?? DEFAULT_BASELINE_DURATION_MS;
      const successCostBaseline =
        metadataNumber(benchmarkMetadata, [
          'scoring_baselines.success_cost',
          'performance_targets.success_cost',
          'performance_targets.target_success_cost',
          'target_success_cost',
        ]) ?? DEFAULT_BASELINE_SUCCESS_COST;
      const tokenCountBaseline =
        metadataNumber(benchmarkMetadata, [
          'scoring_baselines.token_count',
          'performance_targets.token_count',
          'target_token_count',
        ]) ?? DEFAULT_BASELINE_TOKEN_COUNT;
      const toolCallsBaseline =
        metadataNumber(benchmarkMetadata, [
          'scoring_baselines.tool_calls',
          'performance_targets.tool_calls',
          'target_tool_calls',
        ]) ?? DEFAULT_BASELINE_TOOL_CALLS;

      // Calculate new 5-axis scores using v0.1 scoring engine based on canonical features
      const rScore = calculateReliability({
        completionRate: optionalBoolScore(features.f_completed),
        onTimeRate: optionalBoolScore(features.f_on_time),
        nonCancelRate: optionalInverseBoolScore(features.f_canceled),
        lowRetryScore: lowCountScore(features.f_retry_count),
        evidenceCompletenessRate: evidenceCompletenessScore(
          features.f_missing_required_evidence_count,
          features.f_required_evidence_count,
        ),
        timeoutRate: optionalCountRate(features.f_timeout_count),
        logGapRate: optionalPresenceRate(features.f_log_gap_flag),
        severeIncidentRate: optionalCountRate(features.f_security_incident_count)
      });

      const qScore = calculateQuality({
        acceptanceRate: optionalBoolScore(features.f_accepted),
        firstPassAcceptRate: optionalBoolScore(features.f_first_pass_accept),
        lowReworkScore: lowCountScore(features.f_rework_count),
        benchmarkScore: finiteNumber(features.f_benchmark_score) ? features.f_benchmark_score : null,
        repeatHireScore: null,
        confirmedDefectRate: optionalCountRate(features.f_confirmed_defect_count),
        refundRate: optionalPresenceRate(features.f_refund_flag),
        chargebackRate: optionalPresenceRate(features.f_chargeback_flag)
      });

      const eScore = calculateEfficiency({
        durationScore: scoreLowBetterOptional(features.f_duration_ms, durationBaseline),
        successCostScore: scoreLowBetterOptional(features.f_success_cost, successCostBaseline),
        tokenEfficiencyScore: scoreLowBetterOptional(features.f_token_count, tokenCountBaseline),
        toolEfficiencyScore: scoreLowBetterOptional(features.f_tool_calls, toolCallsBaseline)
      });

      const aScore = calculateAutonomy({
        humanFreeCompletionRate: lowCountScore(features.f_human_interventions),
        lowApprovalRequestScore: lowCountScore(features.f_approval_requests),
        lowManualTakeoverScore: lowCountScore(features.f_manual_takeovers),
        delegationEffectivenessScore: lowCountScore(features.f_subagent_delegations)
      });

      const tScore = calculateTransparencySafety({
        requiredEvidenceScore: evidenceCompletenessScore(
          features.f_missing_required_evidence_count,
          features.f_required_evidence_count,
        ),
        trustIntegrityScore: 1, // JWS verification succeeded for this evaluation.
        attestedClaimCoverage: coverageScore(features.f_attested_claim_count, features.f_required_evidence_count),
        policyIncidentRate: optionalCountRate(features.f_policy_incident_count),
        unauthorizedToolRate: optionalCountRate(features.f_unauthorized_tool_count),
        identityMismatchRate: optionalCountRate(features.f_identity_mismatch_count),
        runtimeAttestationGapRate: optionalCountRate(features.f_runtime_attestation_gap_count)
      });

      const composite = calculateComposite(rScore, qScore, eScore, aScore, tScore);

      // Temporary mapping of our 5-axis scores to current Prisma Evaluation Schema.
      // (Quality->qualityScore, Efficiency->speedScore, Autonomy->costScore, TransparencySafety->evidenceScore, Reliability->reliabilityScore)
      let ev;
      try {
        ev = await prisma.evaluation.create({
          data: {
            contractId: contract_id,
            deliveryId: delivery_id,
            qualityScore: qScore,
            speedScore: eScore,
            costScore: aScore,
            evidenceScore: tScore,
            reliabilityScore: rScore,
            totalScore: Number(composite.toFixed(3)),
            jwsPayload: jws,
            featuresJson: JSON.stringify(features)
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const racedEvaluation = await prisma.evaluation.findUnique({ where: { deliveryId: delivery_id } });
          if (racedEvaluation) {
            logger.info({ evaluation_id: racedEvaluation.id, delivery_id }, 'Evaluation already exists for delivery');
            return res.status(200).json(racedEvaluation);
          }
        }
        throw error;
      }
      logger.info({ evaluation_id: ev.id, contract_id, delivery_id, total_score: ev.totalScore }, 'Evaluation created');
      res.status(201).json(ev);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------------------
  // SETTLEMENTS - Beta1 MOCKED
  // ----------------------------------------------------------------------
  app.post('/v1/settlements', writeLimiter, async (req, res) => {
    try {
      if (!req.body.contract_id || !req.body.amount) {
        return res.status(400).json({ error: "contract_id and amount are required" });
      }

      const s = await prisma.settlement.create({
        data: {
          contractId: req.body.contract_id,
          amount: Number(req.body.amount) || 0,
          status: 'mocked_beta1'
        }
      });
      logger.info({ settlement_id: s.id, contract_id: req.body.contract_id, amount: s.amount, status: 'mocked' }, 'Settlement processed (Beta1 MOCKED)');
      res.status(201).json({ ...s, _beta1_notice: "Beta1 environment: Virtual credit transaction successful. No fiat money was moved." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
