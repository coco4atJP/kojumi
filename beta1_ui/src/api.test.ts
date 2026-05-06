import { describe, expect, it } from 'vitest';
import { normalizeAgent, normalizeBenchmark } from './api';

describe('API response normalization', () => {
  it('keeps the latest /v1/agents metrics shape available to listing views', () => {
    const agent = normalizeAgent({
      id: 'agent-1',
      name: 'Metrics Agent',
      description: 'Uses the current API shape',
      categories: ['research_tasks', 'data_engineering'],
      basePrice: 25,
      metrics: {
        averageScore: 0.91,
        evaluationsCount: 7,
        detailedScores: {
          quality: 0.9,
          speed: 0.8,
          cost: 0.7,
          evidence: 0.95,
          reliability: 0.85,
        },
      },
    });

    expect(agent.averageScore).toBe(0.91);
    expect(agent.evaluationsCount).toBe(7);
    expect(agent.detailedScores?.evidence).toBe(0.95);
    expect(agent.metrics?.detailedScores.reliability).toBe(0.85);
  });

  it('normalizes leaderboard aliases into stable id/name/price fields', () => {
    const agent = normalizeAgent({
      agentId: 'leaderboard-agent',
      agentName: 'Leaderboard Agent',
      categories: 'bpo_data_processing, infrastructure_ops',
      basePriceCredits: 12,
      averageScore: 0.76,
      evaluationsCount: 3,
      detailedScores: {
        quality: 0.7,
        speed: 0.8,
        cost: 0.75,
        evidence: 0.72,
        reliability: 0.82,
      },
    });

    expect(agent.id).toBe('leaderboard-agent');
    expect(agent.name).toBe('Leaderboard Agent');
    expect(agent.basePrice).toBe(12);
    expect(agent.categories).toEqual(['bpo_data_processing', 'infrastructure_ops']);
    expect(agent.metrics?.averageScore).toBe(0.76);
  });

  it('fills missing benchmark numeric fields so benchmark cards can render safely', () => {
    const benchmark = normalizeBenchmark({
      id: 'benchmark-1',
      title: 'Legacy benchmark',
      description: 'Created before leaderboard metadata existed',
      category: 'research_tasks',
    });

    expect(benchmark.leaderboardWeight.toFixed(1)).toBe('0.3');
    expect(benchmark.suggestedReward).toBe(0);
    expect(benchmark.reward).toBe(0);
    expect(benchmark.qualityStatus).toBe('experimental');
  });
});
