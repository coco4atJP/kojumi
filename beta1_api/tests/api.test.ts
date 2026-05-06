import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { prisma } from '../src/index';
import { issueTrialApiKey } from '../src/auth';

describe('Beta1 API Core Tests', () => {
  const apiKey = process.env.API_KEY || 'beta1-secret-key';
  let createdAgentId: string;

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /v1/agents requires API key', async () => {
    const res = await request(app)
      .post('/v1/agents')
      .send({ name: 'Test Agent' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Unauthorized');
  });

  it('POST /v1/agents creates an agent with API key', async () => {
    const res = await request(app)
      .post('/v1/agents')
      .set('x-api-key', apiKey)
      .send({
        name: 'Test Agent',
        description: 'Test description',
        categories: ['test'],
        base_price: 100
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Agent');
    createdAgentId = res.body.id;
  });

  it('GET /v1/leaderboard returns data without authentication', async () => {
    const res = await request(app).get('/v1/leaderboard');
    if (res.status !== 200) console.error(res.body);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('only emits CORS headers for approved browser origins', async () => {
    const allowed = await request(app)
      .get('/v1/leaderboard')
      .set('Origin', 'https://kojumi.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://kojumi.com');

    const denied = await request(app)
      .get('/v1/leaderboard')
      .set('Origin', 'https://attacker.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requires API keys for raw operational GET endpoints', async () => {
    const endpoints = [
      '/v1/contracts',
      '/v1/executions',
      '/v1/deliveries',
      '/v1/deliveries/delivery-unknown/file',
      '/v1/evaluations',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    }
  });
});

describe('Trial sandbox behavior', () => {
  const originalApiKeysFile = process.env.API_KEYS_FILE;
  const benchmarkId = 'trial-sandbox-benchmark';
  let tempDir: string;
  let trialKey: string;
  let trialAgentId: string;
  let activeAgentId: string;
  let trialContractId: string | null = null;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kojumi-api-trial-test-'));
    process.env.API_KEYS_FILE = path.join(tempDir, 'api_keys.json');
    trialKey = issueTrialApiKey('trial-api-test', { days: 1 }).key!;

    const activeAgent = await prisma.agent.create({
      data: {
        name: 'Active Market Agent',
        description: 'real market agent',
        categories: 'test',
        basePrice: 100,
        status: 'active'
      }
    });
    activeAgentId = activeAgent.id;

    await prisma.benchmarkTask.create({
      data: {
        id: benchmarkId,
        title: 'Trial sandbox benchmark',
        description: 'Trial attempt target',
        category: 'test',
        difficulty: 'medium',
        reward: 1,
        requesterTag: 'official',
        organizerType: 'platform'
      }
    });
  });

  afterAll(async () => {
    if (trialContractId) {
      await prisma.contract.deleteMany({ where: { id: trialContractId } });
    }
    if (trialAgentId) {
      await prisma.agent.deleteMany({ where: { id: trialAgentId } });
    }
    await prisma.agent.deleteMany({ where: { id: activeAgentId } });
    await prisma.benchmarkTask.deleteMany({ where: { id: benchmarkId } });
    process.env.API_KEYS_FILE = originalApiKeysFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('marks agents created with trial keys as sandbox and hides them from default public listings', async () => {
    const createRes = await request(app)
      .post('/v1/agents')
      .set('x-api-key', trialKey)
      .send({
        name: 'Trial Sandbox Agent',
        description: 'temporary trial agent',
        categories: ['test'],
        base_price: 0
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('trial');
    trialAgentId = createRes.body.id;

    const defaultList = await request(app).get('/v1/agents');
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.items.some((agent: any) => agent.id === trialAgentId)).toBe(false);

    const unauthenticatedSandboxList = await request(app).get('/v1/agents?include_trial=true');
    expect(unauthenticatedSandboxList.status).toBe(401);

    const sandboxList = await request(app)
      .get('/v1/agents?include_trial=true')
      .set('x-api-key', trialKey);
    expect(sandboxList.status).toBe(200);
    const trialAgent = sandboxList.body.items.find((agent: any) => agent.id === trialAgentId);
    expect(trialAgent).toBeTruthy();
    expect(trialAgent.sandbox).toBe(true);
  });

  it('issues self-serve trial keys without an existing API key', async () => {
    const res = await request(app)
      .post('/v1/trial-keys')
      .send({ label: 'self-serve-trial-test', days: 2 });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('trial');
    expect(res.body.role).toBe('worker');
    expect(res.body.apiKey).toMatch(/^kjm_b1_/);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());

    const createAgentRes = await request(app)
      .post('/v1/agents')
      .set('x-api-key', res.body.apiKey)
      .send({
        name: 'Self Serve Trial Agent',
        categories: ['trial'],
        base_price: 0
      });

    expect(createAgentRes.status).toBe(201);
    expect(createAgentRes.body.status).toBe('trial');
    await prisma.agent.deleteMany({ where: { id: createAgentRes.body.id } });
  });

  it('fails closed for self-serve trial keys in production without external abuse protection', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSelfServe = process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
    const originalProtection = process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
    try {
      process.env.NODE_ENV = 'production';
      process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = 'true';
      delete process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;

      const res = await request(app)
        .post('/v1/trial-keys')
        .send({ label: 'unsafe-production-trial-test', days: 2 });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('external abuse protection');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSelfServe === undefined) delete process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
      else process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = originalSelfServe;
      if (originalProtection === undefined) delete process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
      else process.env.KOJUMI_TRIAL_ABUSE_PROTECTION = originalProtection;
    }
  });

  it('requires a Turnstile secret when trial self-serve is protected by Turnstile', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSelfServe = process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
    const originalProtection = process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
    const originalSecret = process.env.KOJUMI_TURNSTILE_SECRET_KEY;
    try {
      process.env.NODE_ENV = 'production';
      process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = 'true';
      process.env.KOJUMI_TRIAL_ABUSE_PROTECTION = 'turnstile';
      delete process.env.KOJUMI_TURNSTILE_SECRET_KEY;

      const res = await request(app)
        .post('/v1/trial-keys')
        .send({ label: 'missing-turnstile-secret-test', days: 2, turnstileToken: 'token' });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('Turnstile');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSelfServe === undefined) delete process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
      else process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = originalSelfServe;
      if (originalProtection === undefined) delete process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
      else process.env.KOJUMI_TRIAL_ABUSE_PROTECTION = originalProtection;
      if (originalSecret === undefined) delete process.env.KOJUMI_TURNSTILE_SECRET_KEY;
      else process.env.KOJUMI_TURNSTILE_SECRET_KEY = originalSecret;
    }
  });

  it('verifies Turnstile before issuing production self-serve trial keys', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSelfServe = process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
    const originalProtection = process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
    const originalSecret = process.env.KOJUMI_TURNSTILE_SECRET_KEY;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);
    try {
      process.env.NODE_ENV = 'production';
      process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = 'true';
      process.env.KOJUMI_TRIAL_ABUSE_PROTECTION = 'turnstile';
      process.env.KOJUMI_TURNSTILE_SECRET_KEY = 'turnstile-secret-test';

      const res = await request(app)
        .post('/v1/trial-keys')
        .send({ label: 'turnstile-production-trial-test', days: 2, turnstileToken: 'turnstile-token-test' });

      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('trial');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        expect.objectContaining({ method: 'POST' })
      );
      const [, verifyOptions] = fetchMock.mock.calls[0];
      expect((verifyOptions as RequestInit).body).toBeInstanceOf(URLSearchParams);
      expect(((verifyOptions as RequestInit).body as URLSearchParams).get('response')).toBe('turnstile-token-test');
    } finally {
      fetchMock.mockRestore();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSelfServe === undefined) delete process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED;
      else process.env.KOJUMI_TRIAL_SELF_SERVE_ENABLED = originalSelfServe;
      if (originalProtection === undefined) delete process.env.KOJUMI_TRIAL_ABUSE_PROTECTION;
      else process.env.KOJUMI_TRIAL_ABUSE_PROTECTION = originalProtection;
      if (originalSecret === undefined) delete process.env.KOJUMI_TURNSTILE_SECRET_KEY;
      else process.env.KOJUMI_TURNSTILE_SECRET_KEY = originalSecret;
    }
  });

  it('prevents trial keys from creating benchmark attempts for active market agents', async () => {
    const res = await request(app)
      .post(`/v1/benchmarks/${benchmarkId}/attempt`)
      .set('x-api-key', trialKey)
      .send({ agent_id: activeAgentId });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Trial keys can only start benchmark attempts for trial agents');
  });

  it('allows trial keys to attempt benchmarks with trial agents under a trial requester id', async () => {
    const res = await request(app)
      .post(`/v1/benchmarks/${benchmarkId}/attempt`)
      .set('x-api-key', trialKey)
      .send({ agent_id: trialAgentId });

    expect(res.status).toBe(201);
    trialContractId = res.body.contract_id;

    const contract = await prisma.contract.findUnique({ where: { id: trialContractId! } });
    expect(contract?.requesterId).toContain('trial_benchmark_runner:');
  });

  it('keeps trial agents out of the default leaderboard', async () => {
    const res = await request(app).get('/v1/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body.items.some((agent: any) => agent.agentId === trialAgentId)).toBe(false);
  });
});

describe('GDP Val benchmark attempts', () => {
  const apiKey = process.env.API_KEY || 'beta1-secret-key';
  const benchmarkId = 'gdpval-test-benchmark';
  let agentId: string;
  let contractId: string | null = null;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        rows: [{
          row: {
            task_id: 'gdpval-task-1',
            sector: 'Information',
            occupation: 'Editors',
            prompt: 'Create an edited article package from the provided context.',
            reference_files: ['editorial_brief.pdf'],
            reference_file_urls: ['https://example.com/editorial_brief.pdf'],
            reference_file_hf_uris: ['hf://datasets/openai/gdpval/editorial_brief.pdf'],
            deliverable_files: ['expert_deliverable.pdf'],
            deliverable_file_urls: ['https://example.com/expert_deliverable.pdf'],
            deliverable_file_hf_uris: ['hf://datasets/openai/gdpval/expert_deliverable.pdf'],
            rubric_pretty: 'Grade accuracy, completeness, formatting, and editorial judgment.',
            rubric_json: '{"criteria":[]}'
          }
        }]
      })
    } as Response));

    const agent = await prisma.agent.create({
      data: {
        name: 'GDP Val Test Agent',
        description: 'GDP Val test agent',
        categories: 'economic_reasoning',
        basePrice: 100,
        status: 'active'
      }
    });
    agentId = agent.id;

    await prisma.benchmarkTask.create({
      data: {
        id: benchmarkId,
        title: 'GDP Val test benchmark',
        description: 'Run GDP Val through Kojumi.',
        category: 'economic_reasoning',
        difficulty: 'hard',
        reward: 180,
        requesterTag: 'official',
        organizerType: 'platform',
        metadataJson: JSON.stringify({
          benchmark_suite: 'GDP Val',
          execution_mode: 'kojumi_hosted',
          evaluation_strategy: { type: 'gdpval_rubric_llm_judge' }
        })
      }
    });
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (contractId) {
      await prisma.contract.deleteMany({ where: { id: contractId } });
    }
    await prisma.benchmarkTask.deleteMany({ where: { id: benchmarkId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
  });

  it('attaches a GDP Val gold-set case to the benchmark attempt', async () => {
    const res = await request(app)
      .post(`/v1/benchmarks/${benchmarkId}/attempt`)
      .set('x-api-key', apiKey)
      .send({ agent_id: agentId, gdpval_offset: 0 });

    expect(res.status).toBe(201);
    contractId = res.body.contract_id;
    expect(res.body.benchmark.metadata.assigned_case.taskId).toBe('gdpval-task-1');
    expect(res.body.benchmark.metadata.assigned_case.rubricPretty).toContain('editorial judgment');
    expect(res.body.benchmark.metadata.assigned_case.deliverableFiles).toBeUndefined();
    expect(res.body.benchmark.metadata.assigned_case.deliverableFileUrls).toBeUndefined();

    const contract = await prisma.contract.findUnique({ where: { id: contractId! } });
    expect(contract?.brief).toContain('Task ID: gdpval-task-1');
    expect(contract?.brief).toContain('Create an edited article package');
    expect(contract?.brief).toContain('editorial_brief.pdf');
  });
});

describe('Evaluation API (JWS Attestation)', () => {
  const VERIFY_SECRET = process.env.KOJUMI_EVAL_PUBLIC_KEY || "mock-secret-key";
  const apiKey = process.env.API_KEY || 'beta1-secret-key';

  let validContractId = "contract-12345";
  let validDeliveryId = "delivery-67890";
  let validExecutionId = "execution-11111";
  let rejectedDeliveryId = "delivery-rejected";

  beforeAll(async () => {
    // Create dummy records to satisfy foreign key constraints
    await prisma.agent.upsert({
      where: { id: "agent-dummy" },
      update: {},
      create: { id: "agent-dummy", name: "dummy", description: "dummy", categories: "dummy", basePrice: 100 }
    });
    await prisma.contract.upsert({
      where: { id: validContractId },
      update: {},
      create: { id: validContractId, agentId: "agent-dummy", requesterId: "req-dummy", status: "active", taskCategory: "dummy", brief: "dummy", budget: 100 }
    });
    await prisma.execution.upsert({
      where: { id: validExecutionId },
      update: {},
      create: { id: validExecutionId, contractId: validContractId, status: "completed" }
    });
    await prisma.delivery.upsert({
      where: { id: validDeliveryId },
      update: {},
      create: { id: validDeliveryId, contractId: validContractId, executionId: validExecutionId, outputUri: "s3://dummy", summary: "dummy", status: "delivered" }
    });
    await prisma.delivery.upsert({
      where: { id: rejectedDeliveryId },
      update: {},
      create: { id: rejectedDeliveryId, contractId: validContractId, executionId: validExecutionId, outputUri: "s3://dummy-rejected", summary: "dummy", status: "submitted" }
    });
  });

  afterAll(async () => {
    // Clean up
    await prisma.evaluation.deleteMany({ where: { deliveryId: validDeliveryId } });
    await prisma.delivery.deleteMany({ where: { id: rejectedDeliveryId } });
    await prisma.delivery.deleteMany({ where: { id: validDeliveryId } });
    await prisma.execution.deleteMany({ where: { id: validExecutionId } });
    await prisma.contract.deleteMany({ where: { id: validContractId } });
    await prisma.agent.deleteMany({ where: { id: "agent-dummy" } });
  });

  it('POST /v1/deliveries/:id/reject marks the delivery as rejected', async () => {
    const res = await request(app)
      .post(`/v1/deliveries/${rejectedDeliveryId}/reject`)
      .set('x-api-key', apiKey)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    const updated = await prisma.delivery.findUnique({ where: { id: rejectedDeliveryId } });
    expect(updated?.status).toBe('rejected');
  });

  it('POST /v1/evaluations rejects missing JWS payload', async () => {
    const res = await request(app)
      .post('/v1/evaluations')
      .set('x-api-key', apiKey)
      .send({ contract_id: "test-contract" }); // missing jws
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing \'jws\' payload');
  });

  it('POST /v1/evaluations rejects tampered JWS payload', async () => {
    const fakePayload = {
      contract_id: "test-contract",
      delivery_id: "test-delivery",
      features: { f_accepted: true }
    };
    const invalidJws = jwt.sign(fakePayload, "wrong-secret");
    
    const res = await request(app)
      .post('/v1/evaluations')
      .set('x-api-key', apiKey)
      .send({ jws: invalidJws });
      
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or tampered');
  });

  it('POST /v1/evaluations fails closed in production when verification secret is unset', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.API_KEY;
    const originalVerifySecret = process.env.KOJUMI_EVAL_VERIFY_SECRET;
    const originalPublicKey = process.env.KOJUMI_EVAL_PUBLIC_KEY;
    try {
      process.env.NODE_ENV = 'production';
      process.env.API_KEY = apiKey;
      delete process.env.KOJUMI_EVAL_VERIFY_SECRET;
      delete process.env.KOJUMI_EVAL_PUBLIC_KEY;

      const validJws = jwt.sign({
        contract_id: validContractId,
        delivery_id: validDeliveryId,
        features: { f_accepted: true }
      }, 'mock-secret-key');

      const res = await request(app)
        .post('/v1/evaluations')
        .set('x-api-key', apiKey)
        .send({ jws: validJws });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('Evaluation verification is not configured');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalApiKey === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = originalApiKey;
      if (originalVerifySecret === undefined) delete process.env.KOJUMI_EVAL_VERIFY_SECRET;
      else process.env.KOJUMI_EVAL_VERIFY_SECRET = originalVerifySecret;
      if (originalPublicKey === undefined) delete process.env.KOJUMI_EVAL_PUBLIC_KEY;
      else process.env.KOJUMI_EVAL_PUBLIC_KEY = originalPublicKey;
    }
  });

  it('POST /v1/evaluations processes valid JWS and calculates scores', async () => {
    // 完全に理想的な状態（一発合格、ペナルティなし、高速）の生データ
    const validPayload = {
      contract_id: validContractId,
      delivery_id: validDeliveryId,
      features: {
        f_completed: true,
        f_on_time: true,
        f_canceled: false,
        f_retry_count: 0,
        f_missing_required_evidence_count: 0,
        f_log_gap_flag: false,
        f_security_incident_count: 0,
        f_accepted: true,
        f_first_pass_accept: true,
        f_rework_count: 0,
        f_benchmark_score: 0.95,
        f_refund_flag: false,
        f_chargeback_flag: false,
        f_duration_ms: 10000, // 10秒
        f_success_cost: 0.5,  // 0.5ドル
        f_human_interventions: 0,
        f_approval_requests: 0,
        f_manual_takeovers: 0,
        f_policy_incident_count: 0
      }
    };
    const validJws = jwt.sign(validPayload, VERIFY_SECRET);
    
    const res = await request(app)
      .post('/v1/evaluations')
      .set('x-api-key', apiKey)
      .send({ jws: validJws });
      
    if (res.status !== 201) console.error(res.body);
    expect(res.status).toBe(201);
    expect(res.body.contractId).toBe(validContractId);
    expect(res.body.jwsPayload).toBe(validJws);
    expect(res.body.featuresJson).toContain("f_completed\":true");
    
    // 各軸のスコアが正常に計算されていることを確認 (1に近い高得点になるはず)
    expect(res.body.qualityScore).toBeGreaterThan(0.8);
    expect(res.body.speedScore).toBeGreaterThan(0.8); // cost->autonomy mapping
    expect(res.body.costScore).toBeGreaterThan(0.8);
    expect(res.body.evidenceScore).toBeGreaterThan(0.8);
    expect(res.body.reliabilityScore).toBeGreaterThan(0.8);
    expect(res.body.totalScore).toBeGreaterThan(0.8);
  });

  it('POST /v1/evaluations is idempotent per delivery', async () => {
    const validPayload = {
      contract_id: validContractId,
      delivery_id: validDeliveryId,
      features: {
        f_completed: true,
        f_accepted: true,
        f_benchmark_score: 0.95
      }
    };
    const validJws = jwt.sign(validPayload, VERIFY_SECRET);

    const res = await request(app)
      .post('/v1/evaluations')
      .set('x-api-key', apiKey)
      .send({ jws: validJws });

    expect(res.status).toBe(200);

    const evaluations = await prisma.evaluation.findMany({ where: { deliveryId: validDeliveryId } });
    expect(evaluations).toHaveLength(1);
    expect(res.body.id).toBe(evaluations[0].id);
  });
});

describe('Benchmark Metadata and Heartbeat', () => {
  const apiKey = process.env.API_KEY || 'beta1-secret-key';
  const cupId = 'cup-oo';
  const benchmarkId = 'benchmark-oo-1';
  const standaloneBenchmarkIds: string[] = [];

  beforeAll(async () => {
    await prisma.benchmarkCup.upsert({
      where: { slug: 'oo-cup-test' },
      update: {},
      create: {
        id: cupId,
        slug: 'oo-cup-test',
        title: 'OO Cup Test',
        description: 'Third-party cup scaffold',
        requesterTag: 'oo-cup'
      }
    });

    await prisma.benchmarkTask.upsert({
      where: { id: benchmarkId },
      update: {},
      create: {
        id: benchmarkId,
        title: 'Third-party benchmark',
        description: 'Hosted externally',
        category: 'test',
        difficulty: 'medium',
        reward: 42,
        requesterTag: 'oo-cup',
        organizerType: 'community',
        benchmarkCupId: cupId,
        healthStatus: 'unknown'
      }
    });
  });

  afterAll(async () => {
    if (standaloneBenchmarkIds.length) {
      await prisma.benchmarkTask.deleteMany({ where: { id: { in: standaloneBenchmarkIds } } });
    }
    await prisma.benchmarkTask.deleteMany({ where: { id: benchmarkId } });
    await prisma.benchmarkCup.deleteMany({ where: { id: cupId } });
  });

  it('GET /v1/benchmarks exposes requester tags and cup metadata', async () => {
    const res = await request(app).get('/v1/benchmarks?requester_tag=oo-cup');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.some((item: any) => item.id === benchmarkId)).toBe(true);

    const benchmark = res.body.items.find((item: any) => item.id === benchmarkId);
    expect(benchmark.requesterTag).toBe('oo-cup');
    expect(benchmark.benchmarkCup?.slug).toBe('oo-cup-test');
    expect(benchmark.qualityStatus).toBe('experimental');
    expect(benchmark.leaderboardWeight).toBe(0.3);
    expect(benchmark.difficulty).toBe('easy');
    expect(typeof benchmark.suggestedReward).toBe('number');
  });

  it('POST /v1/benchmarks/:id/heartbeat updates health status', async () => {
    const res = await request(app)
      .post(`/v1/benchmarks/${benchmarkId}/heartbeat`)
      .set('x-api-key', apiKey)
      .send({ status: 'healthy' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(benchmarkId);
    expect(res.body.requesterTag).toBe('oo-cup');
    expect(res.body.healthStatus).toBe('healthy');
    expect(res.body.lastHeartbeatAt).toBeTruthy();
  });

  it('POST /v1/benchmarks creates a standalone benchmark without a cup', async () => {
    const res = await request(app)
      .post('/v1/benchmarks')
      .set('x-api-key', apiKey)
      .send({
        title: 'Standalone benchmark',
        description: 'No cup attached',
        category: 'research',
        requester_tag: 'third-party-lab',
        organizer_type: 'requester',
        quality_status: 'reviewed',
        leaderboard_weight: 0.7,
        reward: 12,
        metadata: { mode: 'hosted' }
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Standalone benchmark');
    expect(res.body.requesterTag).toBe('third-party-lab');
    expect(res.body.benchmarkCupId).toBeNull();
    expect(res.body.qualityStatus).toBe('reviewed');
    expect(res.body.leaderboardWeight).toBe(0.7);
    expect(res.body.difficulty).toBe('medium');
    expect(res.body.suggestedReward).toBe(13.2);
    standaloneBenchmarkIds.push(res.body.id);
  });

  it('ties public difficulty to leaderboard weight and hides evaluation routing tier', async () => {
    const res = await request(app)
      .post('/v1/benchmarks')
      .set('x-api-key', apiKey)
      .send({
        title: 'Hidden routing tier benchmark',
        description: 'Uses private evaluator routing metadata',
        category: 'research',
        requester_tag: 'third-party-lab',
        leaderboard_weight: 1,
        reward: 20,
        difficulty: 'easy',
        evaluation_tier: 'frontier',
        metadata: { mode: 'hosted', evaluationTier: 'high' }
      });

    expect(res.status).toBe(201);
    expect(res.body.difficulty).toBe('hard');
    expect(res.body.metadataJson).not.toContain('evaluation_tier');
    expect(res.body.metadataJson).not.toContain('evaluationTier');
    standaloneBenchmarkIds.push(res.body.id);

    const stored = await prisma.benchmarkTask.findUnique({ where: { id: res.body.id } });
    expect(stored?.difficulty).toBe('hard');
    expect(stored?.metadataJson).toContain('"evaluation_tier":"frontier"');
  });
});
