import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { providerConfig, ProviderConfigError } from './provider-config.mjs';

test('uses provider defaults while keeping an empty key in explicit demo mode', () => {
  const config = providerConfig({});

  assert.deepEqual(config, {
    mode: 'local-demo',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    timeoutMs: 10_000,
  });
});

test('ignores unused provider values while the API key is empty', () => {
  const config = providerConfig({ OPENAI_API_KEY: '', OPENAI_BASE_URL: 'not-a-url', OPENAI_MODEL: ' ' });

  assert.equal(config.mode, 'local-demo');
  assert.equal(config.baseUrl, 'https://api.openai.com/v1');
  assert.equal(config.model, 'gpt-4.1-mini');
});

test('rejects a configured base URL containing credentials without exposing them', () => {
  const secret = 'provider-secret';

  assert.throws(() => providerConfig({
    OPENAI_API_KEY: secret,
    OPENAI_BASE_URL: 'https://user:password@example.invalid/v1',
  }), (error) => {
    assert.ok(error instanceof ProviderConfigError);
    assert.equal(error.code, 'CONFIGURATION_INVALID');
    assert.doesNotMatch(error.message, /provider-secret|password/);
    return true;
  });
});

test('rejects an explicitly blank model when an API key is configured', () => {
  assert.throws(() => providerConfig({ OPENAI_API_KEY: 'provider-secret', OPENAI_MODEL: ' ' }), (error) => {
    assert.ok(error instanceof ProviderConfigError);
    assert.equal(error.code, 'CONFIGURATION_INVALID');
    assert.doesNotMatch(error.message, /provider-secret/);
    return true;
  });
});

test('requires a key only for an explicit provider check', () => {
  assert.throws(() => providerConfig({}, { requireApiKey: true }), (error) => {
    assert.ok(error instanceof ProviderConfigError);
    assert.equal(error.code, 'CONFIGURATION_MISSING');
    return true;
  });
});

test('normal start loads .env and rejects malformed configured provider values before binding', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'novail-provider-start-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environmentFile = join(directory, 'startup.env');
  await writeFile(environmentFile, [
    'OPENAI_API_KEY=startup-secret',
    'OPENAI_BASE_URL=https://user:password@example.invalid/v1',
    'OPENAI_MODEL=test-model',
    `NOVAIL_DATA_FILE=${join(directory, 'state.json')}`,
  ].join('\n'), { mode: 0o600 });
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.start, 'node --env-file-if-exists=.env app/server.mjs');
  const safeEnvironment = { ...process.env };
  delete safeEnvironment.OPENAI_API_KEY;
  delete safeEnvironment.OPENAI_BASE_URL;
  delete safeEnvironment.OPENAI_MODEL;

  const child = spawn(process.execPath, [`--env-file=${environmentFile}`, 'app/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: safeEnvironment,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');

  assert.notEqual(code, 0);
  assert.match(stderr, /CONFIGURATION_INVALID|ProviderConfigError/);
  assert.doesNotMatch(stderr, /startup-secret|password/);
});
