import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { branchFixture } from './branch-test-support.mjs';
import { providerModelsSchema } from '../packages/execution/contracts.ts';

function preserveProviderEnvironment(t) {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  t.after(() => {
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previous.model;
  });
}

test('model discovery reports unconfigured demo mode without external requests', async (t) => {
  preserveProviderEnvironment(t);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  const { app } = await branchFixture(t);

  const response = await app.request('/api/provider/models');
  const body = providerModelsSchema.parse(await response.json());

  assert.equal(response.status, 200);
  assert.deepEqual(body, { configured: false, defaultModel: null, models: [] });
});

test('model discovery returns only validated model ids and the optional default', async (t) => {
  preserveProviderEnvironment(t);
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer catalog-secret');
    assert.equal(request.url, '/v1/models');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'z-model' }, { id: 'a-model' }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.OPENAI_API_KEY = 'catalog-secret';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OPENAI_MODEL = 'a-model';
  const { app } = await branchFixture(t);

  const response = await app.request('/api/provider/models');
  const body = providerModelsSchema.parse(await response.json());

  assert.equal(response.status, 200);
  assert.deepEqual(body, { configured: true, defaultModel: 'a-model', models: [{ id: 'a-model' }, { id: 'z-model' }] });
  assert.equal(JSON.stringify(body).includes('catalog-secret'), false);
});

test('model discovery maps rejected keys without exposing credentials or response bodies', async (t) => {
  preserveProviderEnvironment(t);
  const server = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'catalog-secret private-upstream-body' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.OPENAI_API_KEY = 'catalog-secret';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const { app } = await branchFixture(t);

  const response = await app.request('/api/provider/models');
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'PROVIDER_KEY_REJECTED');
  assert.doesNotMatch(JSON.stringify(body), /catalog-secret|private-upstream-body/);
});

test('model discovery reports an unsupported catalog as an actionable endpoint error', async (t) => {
  preserveProviderEnvironment(t);
  const server = createServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  process.env.OPENAI_API_KEY = 'catalog-secret';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  const { app } = await branchFixture(t);

  const response = await app.request('/api/provider/models');
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'MODEL_CATALOG_UNSUPPORTED');
  assert.match(body.error.message, /Enter a model ID directly/);
});
