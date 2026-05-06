import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type ApiKeyRole = 'operator' | 'worker' | 'publisher';
export type ApiKeyKind = 'participant' | 'trial';

export interface ApiKeyCapabilities {
  contractCreation: boolean;
  benchmarkPublishing: boolean;
  benchmarkHeartbeat: boolean;
}

export interface StoredApiKeyRecord {
  id: string;
  label: string;
  key?: string;
  keyHash?: string;
  role: ApiKeyRole;
  kind?: ApiKeyKind;
  requesterTags?: string[];
  capabilities?: Partial<ApiKeyCapabilities>;
  active: boolean;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

interface ApiKeyStore {
  keys: StoredApiKeyRecord[];
}

export interface AuthMatch {
  id: string;
  label: string;
  role: ApiKeyRole;
  kind: ApiKeyKind;
  requesterTags: string[];
  capabilities: ApiKeyCapabilities;
  expiresAt?: string;
}

const DEFAULT_KEYS_FILE = 'data/api_keys.json';
let cachedStore: { filePath: string; mtimeMs: number; store: ApiKeyStore } | null = null;

const trimQuotes = (value?: string) => value?.replace(/^["']|["']$/g, '').trim();

export const getMasterApiKey = () =>
  trimQuotes(process.env.MASTER_API_KEY)
  ?? trimQuotes(process.env.API_KEY)
  ?? (process.env.NODE_ENV === 'test' ? 'test-api-key' : undefined);

export const getApiKeysFilePath = () => {
  const configuredPath = trimQuotes(process.env.API_KEYS_FILE) || DEFAULT_KEYS_FILE;
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
};

const ensureStoreDir = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const readStore = (filePath: string): ApiKeyStore => {
  if (!fs.existsSync(filePath)) {
    cachedStore = { filePath, mtimeMs: 0, store: { keys: [] } };
    return { keys: [] };
  }

  const stat = fs.statSync(filePath);
  if (cachedStore && cachedStore.filePath === filePath && cachedStore.mtimeMs === stat.mtimeMs) {
    return cachedStore.store;
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    const emptyStore = { keys: [] };
    cachedStore = { filePath, mtimeMs: stat.mtimeMs, store: emptyStore };
    return emptyStore;
  }

  const parsed = JSON.parse(raw) as Partial<ApiKeyStore>;
  const store = { keys: Array.isArray(parsed.keys) ? parsed.keys : [] };
  cachedStore = { filePath, mtimeMs: stat.mtimeMs, store };
  return store;
};

const writeStore = (filePath: string, store: ApiKeyStore) => {
  ensureStoreDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  const stat = fs.statSync(filePath);
  cachedStore = { filePath, mtimeMs: stat.mtimeMs, store };
};

const hashApiKey = (key: string) =>
  crypto.createHash('sha256').update(key).digest('hex');

const normalizeRole = (role?: string): ApiKeyRole => {
  if (role === 'operator' || role === 'master') return 'operator';
  if (role === 'publisher') return 'publisher';
  return 'worker';
};

const normalizeKind = (kind?: string): ApiKeyKind => {
  if (kind === 'trial') return 'trial';
  return 'participant';
};

const isExpired = (expiresAt?: string) => {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
};

const defaultCapabilitiesForRole = (role: ApiKeyRole): ApiKeyCapabilities => ({
  contractCreation: role === 'operator',
  benchmarkPublishing: role === 'operator' || role === 'publisher',
  benchmarkHeartbeat: role === 'operator' || role === 'publisher',
});

const mergeCapabilities = (role: ApiKeyRole, capabilities?: Partial<ApiKeyCapabilities>): ApiKeyCapabilities => ({
  ...defaultCapabilitiesForRole(role),
  ...capabilities,
});

export const findAuthorizedKey = (providedKey?: string): AuthMatch | null => {
  const normalizedKey = providedKey?.trim();
  if (!normalizedKey) {
    return null;
  }

  const masterKey = getMasterApiKey();
  if (masterKey && normalizedKey === masterKey) {
    return {
      id: 'master',
      label: 'master',
      role: 'operator',
      kind: 'participant',
      requesterTags: ['*'],
      capabilities: defaultCapabilitiesForRole('operator')
    };
  }

  const store = readStore(getApiKeysFilePath());
  const normalizedHash = hashApiKey(normalizedKey);
  const record = store.keys.find((candidate) =>
    candidate.active
    && !isExpired(candidate.expiresAt)
    && (candidate.keyHash === normalizedHash || candidate.key === normalizedKey)
  );
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    label: record.label,
    role: normalizeRole(record.role),
    kind: normalizeKind(record.kind),
    requesterTags: Array.isArray(record.requesterTags) ? record.requesterTags : [],
    capabilities: mergeCapabilities(normalizeRole(record.role), record.capabilities),
    expiresAt: record.expiresAt,
  };
};

const generateToken = (length: number) => {
  while (true) {
    const token = crypto.randomBytes(length).toString('base64url');
    if (token.length >= length) {
      return token.slice(0, length);
    }
  }
};

export const issueParticipantApiKey = (
  label: string,
  options?: {
    role?: ApiKeyRole;
    kind?: ApiKeyKind;
    requesterTags?: string[];
    capabilities?: Partial<ApiKeyCapabilities>;
    expiresAt?: string;
  }
) => {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error('label is required');
  }

  const filePath = getApiKeysFilePath();
  const store = readStore(filePath);
  const key = `kjm_b1_${generateToken(32)}`;
  const role = options?.role ?? (
    options?.capabilities?.benchmarkPublishing || options?.capabilities?.benchmarkHeartbeat
      ? 'publisher'
      : 'worker'
  );
  const record: StoredApiKeyRecord = {
    id: `pk_${generateToken(10)}`,
    label: trimmedLabel,
    key,
    keyHash: hashApiKey(key),
    role,
    kind: options?.kind ?? 'participant',
    requesterTags: options?.requesterTags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
    capabilities: mergeCapabilities(role, options?.capabilities),
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: options?.expiresAt,
  };

  const storedRecord: StoredApiKeyRecord = { ...record };
  delete storedRecord.key;
  store.keys.push(storedRecord);
  writeStore(filePath, store);
  return record;
};

const TRIAL_DEFAULT_DAYS = 7;
const TRIAL_MAX_DAYS = 14;

export const issueTrialApiKey = (
  label: string,
  options?: {
    days?: number;
  }
) => {
  const requestedDays = Number(options?.days);
  const days = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.min(Math.ceil(requestedDays), TRIAL_MAX_DAYS)
    : TRIAL_DEFAULT_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  return issueParticipantApiKey(label, {
    role: 'worker',
    kind: 'trial',
    requesterTags: [],
    capabilities: {
      contractCreation: false,
      benchmarkPublishing: false,
      benchmarkHeartbeat: false,
    },
    expiresAt,
  });
};

export const listApiKeys = () => readStore(getApiKeysFilePath()).keys;

export const revokeApiKey = (id: string) => {
  const filePath = getApiKeysFilePath();
  const store = readStore(filePath);
  const record = store.keys.find((candidate) => candidate.id === id);
  if (!record) {
    throw new Error(`api key not found: ${id}`);
  }
  if (!record.active) {
    return record;
  }

  record.active = false;
  record.revokedAt = new Date().toISOString();
  writeStore(filePath, store);
  return record;
};
