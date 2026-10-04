import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFixture, readState } from './branch-test-support.mjs';

test('provider status reflects current server configuration without exposing credentials', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const { app } = await branchFixture(t);
  process.env.OPENAI_API_KEY = 'test-runtime-only-credential';
  const configured = await readState(app);
  assert.equal(configured.settings.providerConfigured, true);
  assert.equal(JSON.stringify(configured).includes(process.env.OPENAI_API_KEY), false);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await readState(app)).settings.providerConfigured, false);
});
