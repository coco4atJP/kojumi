import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { findAuthorizedKey, issueParticipantApiKey, issueTrialApiKey } from '../src/auth';

describe('API key benchmark publishing auth', () => {
  const originalApiKeysFile = process.env.API_KEYS_FILE;
  const originalMasterApiKey = process.env.MASTER_API_KEY;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kojumi-auth-test-'));
    process.env.API_KEYS_FILE = path.join(tempDir, 'api_keys.json');
    process.env.MASTER_API_KEY = 'master-test-key';
  });

  afterEach(() => {
    process.env.API_KEYS_FILE = originalApiKeysFile;
    process.env.MASTER_API_KEY = originalMasterApiKey;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('master key is treated as operator and authorized for all privileged capabilities', () => {
    const auth = findAuthorizedKey('master-test-key');

    expect(auth).not.toBeNull();
    expect(auth?.role).toBe('operator');
    expect(auth?.requesterTags).toEqual(['*']);
    expect(auth?.capabilities.contractCreation).toBe(true);
    expect(auth?.capabilities.benchmarkPublishing).toBe(true);
    expect(auth?.capabilities.benchmarkHeartbeat).toBe(true);
  });

  it('publisher key stores requester tag scope and benchmark capabilities', () => {
    const record = issueParticipantApiKey('publisher', {
      role: 'publisher',
      requesterTags: ['third-party-lab'],
    });

    const auth = findAuthorizedKey(record.key);

    expect(auth).not.toBeNull();
    expect(auth?.role).toBe('publisher');
    expect(auth?.requesterTags).toEqual(['third-party-lab']);
    expect(auth?.capabilities.contractCreation).toBe(false);
    expect(auth?.capabilities.benchmarkPublishing).toBe(true);
    expect(auth?.capabilities.benchmarkHeartbeat).toBe(true);
  });

  it('worker key has worker capabilities by default', () => {
    const record = issueParticipantApiKey('worker');

    const auth = findAuthorizedKey(record.key);

    expect(auth).not.toBeNull();
    expect(auth?.role).toBe('worker');
    expect(auth?.requesterTags).toEqual([]);
    expect(auth?.capabilities.contractCreation).toBe(false);
    expect(auth?.capabilities.benchmarkPublishing).toBe(false);
    expect(auth?.capabilities.benchmarkHeartbeat).toBe(false);
  });

  it('trial key is a temporary worker key without publisher or operator capabilities', () => {
    const record = issueTrialApiKey('trial-worker', { days: 3 });

    const auth = findAuthorizedKey(record.key);

    expect(auth).not.toBeNull();
    expect(auth?.role).toBe('worker');
    expect(auth?.kind).toBe('trial');
    expect(auth?.requesterTags).toEqual([]);
    expect(auth?.capabilities.contractCreation).toBe(false);
    expect(auth?.capabilities.benchmarkPublishing).toBe(false);
    expect(auth?.capabilities.benchmarkHeartbeat).toBe(false);
    expect(auth?.expiresAt).toBe(record.expiresAt);
    expect(Date.parse(record.expiresAt!)).toBeGreaterThan(Date.now());
  });

  it('expired participant keys are rejected even if they remain active', () => {
    const key = 'expired-trial-key';
    fs.writeFileSync(process.env.API_KEYS_FILE!, JSON.stringify({
      keys: [{
        id: 'expired_trial',
        label: 'expired trial',
        key,
        role: 'worker',
        kind: 'trial',
        active: true,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }]
    }), 'utf8');

    const auth = findAuthorizedKey(key);

    expect(auth).toBeNull();
  });

  it('legacy participant records are normalized to worker keys', () => {
    const key = 'legacy-participant-key';
    fs.writeFileSync(process.env.API_KEYS_FILE!, JSON.stringify({
      keys: [{
        id: 'legacy',
        label: 'legacy',
        key,
        role: 'participant',
        active: true,
        createdAt: new Date().toISOString()
      }]
    }), 'utf8');

    const auth = findAuthorizedKey(key);

    expect(auth?.role).toBe('worker');
    expect(auth?.capabilities.contractCreation).toBe(false);
    expect(auth?.capabilities.benchmarkPublishing).toBe(false);
  });
});
