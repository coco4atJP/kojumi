export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export interface Agent {
  id?: string;
  agentId?: string; // Leaderboard uses agentId
  agentName?: string;
  name?: string;
  categories: string[];
  basePriceCredits?: number;
  basePrice?: number;
  averageScore?: number;
  evaluationsCount?: number;
  description?: string;
  owner?: string | null;
  status?: string;
  sandbox?: boolean;
  detailedScores?: {
    quality: number;
    speed: number;
    cost: number;
    evidence: number;
    reliability: number;
  };
  rankingWeight?: number;
  metrics?: {
    averageScore: number;
    evaluationsCount: number;
    detailedScores: {
      quality: number;
      speed: number;
      cost: number;
      evidence: number;
      reliability: number;
    };
  };
}

interface RawAgent extends Omit<Agent, 'categories'> {
  categories: string[] | string;
}

export interface Benchmark {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  reward: number;
  suggestedReward: number;
  qualityStatus: 'experimental' | 'reviewed' | 'verified' | 'archived';
  leaderboardWeight: number;
  requesterTag: string;
  organizerType: string;
  healthStatus: string;
  hostingUrl: string | null;
  healthcheckUrl: string | null;
  lastHeartbeatAt: string | null;
  benchmarkCup: {
    id: string;
    slug: string;
    title: string;
    requesterTag: string;
  } | null;
  metadataJson: string | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

type RawBenchmark = Partial<Benchmark> & {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty?: string;
  reward?: number | string | null;
  suggestedReward?: number | string | null;
  suggested_reward?: number | string | null;
  qualityStatus?: Benchmark['qualityStatus'];
  quality_status?: Benchmark['qualityStatus'];
  leaderboardWeight?: number | string | null;
  leaderboard_weight?: number | string | null;
  requesterTag?: string;
  requester_tag?: string;
  organizerType?: string;
  organizer_type?: string;
  healthStatus?: string;
  health_status?: string;
  benchmarkCup?: Benchmark['benchmarkCup'];
  benchmark_cup?: Benchmark['benchmarkCup'];
};

export interface BenchmarkAttemptResult {
  contract_id: string;
  message: string;
}

export interface TrialKeyResult {
  id: string;
  label: string;
  role: 'worker';
  kind: 'trial';
  apiKey: string;
  expiresAt: string;
}

export interface Activity {
  id: string;
  type: string;
  agentName: string;
  taskName: string;
  reward: number;
  score: number | null;
  createdAt: string;
}

export interface AgentDetails extends Agent {
  recentDeliveries: {
    taskName: string;
    score: number | null;
    date: string;
  }[];
}

const normalizeCategories = (categories: string[] | string | undefined): string[] => {
  if (Array.isArray(categories)) return categories;
  return (categories || '')
    .split(',')
    .map((category: string) => category.trim())
    .filter(Boolean);
};

export const normalizeAgent = (agent: RawAgent): Agent => {
  const detailedScores = agent.metrics?.detailedScores ?? agent.detailedScores;
  const averageScore = agent.metrics?.averageScore ?? agent.averageScore;
  const evaluationsCount = agent.metrics?.evaluationsCount ?? agent.evaluationsCount;
  const basePrice = agent.basePrice ?? agent.basePriceCredits;
  const id = agent.id ?? agent.agentId;
  const name = agent.name ?? agent.agentName;

  return {
    ...agent,
    id,
    agentId: agent.agentId ?? id,
    name,
    agentName: agent.agentName ?? name,
    categories: normalizeCategories(agent.categories),
    basePrice,
    basePriceCredits: agent.basePriceCredits ?? basePrice,
    averageScore,
    evaluationsCount,
    detailedScores,
    metrics: agent.metrics ?? (
      averageScore !== undefined || evaluationsCount !== undefined || detailedScores
        ? {
            averageScore: averageScore ?? 0,
            evaluationsCount: evaluationsCount ?? 0,
            detailedScores: detailedScores ?? { quality: 0, speed: 0, cost: 0, evidence: 0, reliability: 0 },
          }
        : undefined
    ),
  };
};

const toNumber = (value: number | string | null | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeBenchmark = (benchmark: RawBenchmark): Benchmark => {
  const reward = toNumber(benchmark.reward);
  const qualityStatus = benchmark.qualityStatus ?? benchmark.quality_status ?? 'experimental';
  const leaderboardWeight = toNumber(
    benchmark.leaderboardWeight ?? benchmark.leaderboard_weight,
    qualityStatus === 'verified' ? 1 : qualityStatus === 'reviewed' ? 0.7 : 0.3,
  );

  return {
    id: benchmark.id,
    title: benchmark.title,
    description: benchmark.description ?? '',
    category: benchmark.category ?? 'uncategorized',
    difficulty: benchmark.difficulty ?? 'medium',
    reward,
    suggestedReward: toNumber(benchmark.suggestedReward ?? benchmark.suggested_reward, reward),
    qualityStatus,
    leaderboardWeight,
    requesterTag: benchmark.requesterTag ?? benchmark.requester_tag ?? 'unknown',
    organizerType: benchmark.organizerType ?? benchmark.organizer_type ?? 'requester',
    healthStatus: benchmark.healthStatus ?? benchmark.health_status ?? 'unknown',
    hostingUrl: benchmark.hostingUrl ?? null,
    healthcheckUrl: benchmark.healthcheckUrl ?? null,
    lastHeartbeatAt: benchmark.lastHeartbeatAt ?? null,
    benchmarkCup: benchmark.benchmarkCup ?? benchmark.benchmark_cup ?? null,
    metadataJson: benchmark.metadataJson ?? null,
    status: benchmark.status ?? 'active',
    expiresAt: benchmark.expiresAt ?? null,
    createdAt: benchmark.createdAt ?? '',
  };
};

export const fetchActivities = async (): Promise<Activity[]> => {
  const res = await fetch(`${API_BASE_URL}/v1/activities`);
  if (!res.ok) throw new Error('Failed to fetch activities');
  const data = await res.json();
  return data.items;
};

export const fetchAgentDetails = async (id: string): Promise<AgentDetails> => {
  const res = await fetch(`${API_BASE_URL}/v1/agents/${id}`);
  if (!res.ok) throw new Error('Failed to fetch agent details');
  const data = await res.json();
  return normalizeAgent(data) as AgentDetails;
};

export const fetchLeaderboard = async (category?: string): Promise<Agent[]> => {
  const url = category ? `${API_BASE_URL}/v1/leaderboard?category=${encodeURIComponent(category)}` : `${API_BASE_URL}/v1/leaderboard`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  const data = await res.json();
  return (data.items as RawAgent[]).map(normalizeAgent);
};

export const fetchAgents = async (): Promise<Agent[]> => {
  const res = await fetch(`${API_BASE_URL}/v1/agents`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  const data = await res.json();
  return (data.items as RawAgent[]).map(normalizeAgent);
};

export const issueTrialKey = async (label: string, days = 3, turnstileToken?: string): Promise<TrialKeyResult> => {
  const res = await fetch(`${API_BASE_URL}/v1/trial-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, days, turnstileToken }),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error || 'Failed to issue trial key');
  }
  return res.json();
};

export const createAgent = async (
  apiKey: string,
  payload: {
    name: string;
    description?: string;
    categories?: string[];
    base_price?: number;
    owner?: string;
  },
): Promise<Agent> => {
  const res = await fetch(`${API_BASE_URL}/v1/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error || 'Failed to create agent');
  }
  return normalizeAgent(await res.json() as RawAgent);
};

export const fetchBenchmarks = async (): Promise<Benchmark[]> => {
  const res = await fetch(`${API_BASE_URL}/v1/benchmarks`);
  if (!res.ok) throw new Error('Failed to fetch benchmarks');
  const data = await res.json();
  return (data.items as RawBenchmark[]).map(normalizeBenchmark);
};

export const attemptBenchmark = async (
  benchmarkId: string,
  agentId: string,
  apiKey: string,
): Promise<BenchmarkAttemptResult> => {
  const writeKey = apiKey.trim();
  if (!writeKey) {
    throw new Error('A Beta1 write key is required to start a benchmark attempt.');
  }

  const res = await fetch(`${API_BASE_URL}/v1/benchmarks/${benchmarkId}/attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': writeKey,
    },
    body: JSON.stringify({ agent_id: agentId })
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.error || 'Failed to start benchmark attempt');
  }
  return res.json();
};
