import {
  getApiKeysFilePath,
  getMasterApiKey,
  type ApiKeyRole,
  issueParticipantApiKey,
  issueTrialApiKey,
  listApiKeys,
  revokeApiKey,
} from './auth';

const printUsage = () => {
  console.log(`Usage:
  npm run api-key:issue -- --label "<worker-name>"
  npm run api-key:trial -- --label "<trial-name>" [--days 7]
  npm run api-key:issue -- --label "<publisher-name>" --role publisher --requester-tags "third-party-lab"
  npm run api-key:issue -- --label "<operator-name>" --role operator --contract-creation
  npm run api-key:list
  npm run api-key:revoke -- --id <key-id>

Environment:
  MASTER_API_KEY or API_KEY should be configured for operator use.
  API_KEYS_FILE defaults to data/api_keys.json
`);
};

const args = process.argv.slice(2);
const command = args[0];

const readOption = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const hasFlag = (name: string) => args.includes(name);

const readNumberOption = (name: string) => {
  const raw = readOption(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
};

const printIssuedKey = (record: ReturnType<typeof issueParticipantApiKey>) => {
  console.log(`Issued ${record.kind === 'trial' ? 'trial ' : ''}${record.role} API key`);
  console.log(`id: ${record.id}`);
  console.log(`label: ${record.label}`);
  console.log(`role: ${record.role}`);
  console.log(`kind: ${record.kind || 'participant'}`);
  console.log(`requesterTags: ${(record.requesterTags || []).join(',') || '(none)'}`);
  console.log(`contractCreation: ${record.capabilities?.contractCreation ? 'yes' : 'no'}`);
  console.log(`benchmarkPublishing: ${record.capabilities?.benchmarkPublishing ? 'yes' : 'no'}`);
  console.log(`benchmarkHeartbeat: ${record.capabilities?.benchmarkHeartbeat ? 'yes' : 'no'}`);
  console.log(`createdAt: ${record.createdAt}`);
  console.log(`expiresAt: ${record.expiresAt || '(none)'}`);
  console.log(`apiKey: ${record.key}`);
  console.log(`store: ${getApiKeysFilePath()}`);
};

try {
  switch (command) {
    case 'issue': {
      const label = readOption('--label');
      if (!label) {
        throw new Error('--label is required');
      }

      const requesterTags = (readOption('--requester-tags') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const benchmarkPublisher = hasFlag('--benchmark-publisher');
      const benchmarkHeartbeatOnly = hasFlag('--benchmark-heartbeat');
      const contractCreation = hasFlag('--contract-creation');
      const requestedRole = readOption('--role') as ApiKeyRole | undefined;
      if (requestedRole && !['worker', 'publisher', 'operator'].includes(requestedRole)) {
        throw new Error('--role must be one of: worker, publisher, operator');
      }

      const record = issueParticipantApiKey(label, {
        role: requestedRole,
        requesterTags,
        capabilities: {
          ...(contractCreation ? { contractCreation: true } : {}),
          ...(benchmarkPublisher ? { benchmarkPublishing: true, benchmarkHeartbeat: true } : {}),
          ...(benchmarkHeartbeatOnly ? { benchmarkHeartbeat: true } : {}),
        }
      });
      printIssuedKey(record);
      break;
    }

    case 'trial': {
      const label = readOption('--label');
      if (!label) {
        throw new Error('--label is required');
      }

      const record = issueTrialApiKey(label, {
        days: readNumberOption('--days'),
      });
      printIssuedKey(record);
      break;
    }

    case 'list': {
      console.log(`masterKeyConfigured: ${getMasterApiKey() ? 'yes' : 'no'}`);
      console.log(`store: ${getApiKeysFilePath()}`);
      console.log(JSON.stringify(listApiKeys(), null, 2));
      break;
    }

    case 'revoke': {
      const id = readOption('--id');
      if (!id) {
        throw new Error('--id is required');
      }

      console.log(JSON.stringify(revokeApiKey(id), null, 2));
      break;
    }

    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
