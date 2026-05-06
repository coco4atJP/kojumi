import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  getApiKeysFilePath,
  getMasterApiKey,
  listApiKeys,
  revokeApiKey,
} from './auth';

type OutputMode = 'table' | 'json';

const prisma = new PrismaClient();
const args = process.argv.slice(2);

const command = args[0];
const subject = args[1];
const action = args[2];

const hasFlag = (name: string) => args.includes(name);

const readOption = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const outputMode = (): OutputMode => hasFlag('--json') ? 'json' : 'table';

const toIntOption = (name: string, fallback: number, max = 200) => {
  const raw = Number(readOption(name));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
};

const printUsage = () => {
  console.log(`Usage:
  npm run ops -- status [--json]

  npm run ops -- keys list [--json]
  npm run ops -- keys revoke --id <key-id> --reason "<reason>" [--dry-run] [--json]

  npm run ops -- agents list [--status active] [--limit 50] [--json]
  npm run ops -- benchmarks list [--status active] [--health stale] [--requester-tag official] [--limit 50] [--json]
  npm run ops -- benchmarks stale [--limit 50] [--json]
  npm run ops -- benchmarks archive --id <benchmark-id> --reason "<reason>" [--dry-run] [--json]

  npm run ops -- contracts list [--status open] [--limit 50] [--json]
  npm run ops -- contracts open [--limit 50] [--json]
  npm run ops -- executions list [--status failed] [--limit 50] [--json]
  npm run ops -- executions failed [--limit 50] [--json]
  npm run ops -- deliveries list [--status submitted] [--limit 50] [--json]
  npm run ops -- deliveries pending [--limit 50] [--json]

Notes:
  Use --json for AI Agent workflows.
  State-changing commands support --dry-run and write data/ops_audit.log when executed.
`);
};

const resolveAuditLogPath = () => {
  const configured = process.env.KOJUMI_OPS_AUDIT_LOG || 'data/ops_audit.log';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const appendAuditLog = (entry: Record<string, unknown>) => {
  const filePath = resolveAuditLogPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({
    ts: new Date().toISOString(),
    actor: process.env.KOJUMI_OPS_ACTOR || process.env.USER || 'local-operator',
    ...entry,
  })}\n`, 'utf8');
};

const emit = (value: unknown) => {
  if (outputMode() === 'json') {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    console.table(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
};

const requireOption = (name: string) => {
  const value = readOption(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const requireReason = () => {
  const reason = readOption('--reason');
  if (!reason?.trim()) {
    throw new Error('--reason is required for state-changing ops commands');
  }
  return reason.trim();
};

const selectAgent = {
  id: true,
  name: true,
  owner: true,
  status: true,
  categories: true,
  basePrice: true,
  createdAt: true,
};

const selectBenchmark = {
  id: true,
  title: true,
  category: true,
  difficulty: true,
  reward: true,
  qualityStatus: true,
  requesterTag: true,
  healthStatus: true,
  lastHeartbeatAt: true,
  status: true,
  createdAt: true,
};

const selectContract = {
  id: true,
  requesterId: true,
  agentId: true,
  benchmarkId: true,
  taskCategory: true,
  budget: true,
  status: true,
  createdAt: true,
};

const selectExecution = {
  id: true,
  contractId: true,
  status: true,
  progress: true,
  updatedAt: true,
};

const selectDelivery = {
  id: true,
  contractId: true,
  executionId: true,
  status: true,
  outputUri: true,
  summary: true,
  createdAt: true,
};

const countByStatus = async (model: 'agent' | 'benchmarkTask' | 'contract' | 'execution' | 'delivery') => {
  const rows = await (prisma[model] as any).groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row: any) => [row.status, row._count._all]));
};

const status = async () => {
  const staleBenchmarks = await prisma.benchmarkTask.count({
    where: {
      status: 'active',
      OR: [
        { healthStatus: 'stale' },
        { healthStatus: 'unhealthy' },
      ],
    },
  });

  emit({
    environment: 'beta1',
    masterKeyConfigured: Boolean(getMasterApiKey()),
    apiKeysFile: getApiKeysFilePath(),
    auditLog: resolveAuditLogPath(),
    counts: {
      agents: await countByStatus('agent'),
      benchmarks: await countByStatus('benchmarkTask'),
      contracts: await countByStatus('contract'),
      executions: await countByStatus('execution'),
      deliveries: await countByStatus('delivery'),
      apiKeys: {
        active: listApiKeys().filter((key) => key.active).length,
        revoked: listApiKeys().filter((key) => !key.active).length,
      },
    },
    attention: {
      staleOrUnhealthyBenchmarks: staleBenchmarks,
      failedExecutions: await prisma.execution.count({ where: { status: 'failed' } }),
      pendingDeliveries: await prisma.delivery.count({ where: { status: { in: ['submitted', 'delivered'] } } }),
      openContracts: await prisma.contract.count({ where: { status: { in: ['open', 'active'] } } }),
    },
  });
};

const listKeys = () => {
  const keys = listApiKeys().map(({ key: _key, ...record }) => ({
    ...record,
    hasLegacyPlaintextKey: Boolean(_key),
  }));
  emit({
    masterKeyConfigured: Boolean(getMasterApiKey()),
    store: getApiKeysFilePath(),
    keys,
  });
};

const revokeKey = () => {
  const id = requireOption('--id');
  const reason = requireReason();
  const existing = listApiKeys().find((key) => key.id === id);
  if (!existing) {
    throw new Error(`api key not found: ${id}`);
  }

  if (hasFlag('--dry-run')) {
    emit({ dryRun: true, action: 'keys.revoke', reason, target: existing });
    return;
  }

  const revoked = revokeApiKey(id);
  appendAuditLog({ action: 'keys.revoke', targetId: id, reason, after: revoked });
  emit({ dryRun: false, action: 'keys.revoke', reason, target: revoked });
};

const listAgents = async () => {
  const statusFilter = readOption('--status');
  const take = toIntOption('--limit', 50);
  const items = await prisma.agent.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    select: selectAgent,
    orderBy: { createdAt: 'desc' },
    take,
  });
  emit(items);
};

const listBenchmarks = async (onlyStale = false) => {
  const statusFilter = readOption('--status');
  const healthFilter = readOption('--health');
  const requesterTag = readOption('--requester-tag');
  const take = toIntOption('--limit', 50);
  const items = await prisma.benchmarkTask.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(healthFilter ? { healthStatus: healthFilter } : {}),
      ...(requesterTag ? { requesterTag } : {}),
      ...(onlyStale ? {
        OR: [
          { healthStatus: 'stale' },
          { healthStatus: 'unhealthy' },
        ],
      } : {}),
    },
    select: selectBenchmark,
    orderBy: { createdAt: 'desc' },
    take,
  });
  emit(items);
};

const archiveBenchmark = async () => {
  const id = requireOption('--id');
  const reason = requireReason();
  const existing = await prisma.benchmarkTask.findUnique({ where: { id }, select: selectBenchmark });
  if (!existing) {
    throw new Error(`benchmark not found: ${id}`);
  }

  if (hasFlag('--dry-run')) {
    emit({ dryRun: true, action: 'benchmarks.archive', reason, before: existing });
    return;
  }

  const updated = await prisma.benchmarkTask.update({
    where: { id },
    data: {
      status: 'archived',
      qualityStatus: 'archived',
      leaderboardWeight: 0,
    },
    select: selectBenchmark,
  });
  appendAuditLog({ action: 'benchmarks.archive', targetId: id, reason, before: existing, after: updated });
  emit({ dryRun: false, action: 'benchmarks.archive', reason, before: existing, after: updated });
};

const listContracts = async (defaultStatus?: string[]) => {
  const statusFilter = readOption('--status');
  const take = toIntOption('--limit', 50);
  const statuses = statusFilter ? [statusFilter] : defaultStatus;
  const items = await prisma.contract.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    select: selectContract,
    orderBy: { createdAt: 'desc' },
    take,
  });
  emit(items);
};

const listExecutions = async (defaultStatus?: string) => {
  const statusFilter = readOption('--status') || defaultStatus;
  const take = toIntOption('--limit', 50);
  const items = await prisma.execution.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    select: selectExecution,
    orderBy: { updatedAt: 'desc' },
    take,
  });
  emit(items);
};

const listDeliveries = async (defaultStatuses?: string[]) => {
  const statusFilter = readOption('--status');
  const take = toIntOption('--limit', 50);
  const statuses = statusFilter ? [statusFilter] : defaultStatuses;
  const items = await prisma.delivery.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    select: selectDelivery,
    orderBy: { createdAt: 'desc' },
    take,
  });
  emit(items);
};

const run = async () => {
  if (command === 'status') {
    await status();
    return;
  }

  if (command === 'keys' && subject === 'list') {
    listKeys();
    return;
  }
  if (command === 'keys' && subject === 'revoke') {
    revokeKey();
    return;
  }

  if (command === 'agents' && subject === 'list') {
    await listAgents();
    return;
  }

  if (command === 'benchmarks' && subject === 'list') {
    await listBenchmarks(false);
    return;
  }
  if (command === 'benchmarks' && subject === 'stale') {
    await listBenchmarks(true);
    return;
  }
  if (command === 'benchmarks' && subject === 'archive') {
    await archiveBenchmark();
    return;
  }

  if (command === 'contracts' && subject === 'list') {
    await listContracts();
    return;
  }
  if (command === 'contracts' && subject === 'open') {
    await listContracts(['open', 'active']);
    return;
  }

  if (command === 'executions' && subject === 'list') {
    await listExecutions();
    return;
  }
  if (command === 'executions' && subject === 'failed') {
    await listExecutions('failed');
    return;
  }

  if (command === 'deliveries' && subject === 'list') {
    await listDeliveries();
    return;
  }
  if (command === 'deliveries' && subject === 'pending') {
    await listDeliveries(['submitted', 'delivered']);
    return;
  }

  if (action) {
    throw new Error(`unknown ops command: ${command} ${subject} ${action}`);
  }
  printUsage();
  process.exit(command ? 1 : 0);
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
