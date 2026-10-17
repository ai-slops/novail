import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { checkProvider, ProviderCheckError } from '../scripts/provider-readiness.mjs';

async function providerFixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}/v1`;
}

const config = (baseUrl, apiKey = 'project-secret', model = 'codex-model') => ({
  baseUrl, apiKey, model, timeoutMs: 2_000,
});

test('reports catalog access without claiming untested generation capabilities', async (t) => {
  let requests = 0;
  const baseUrl = await providerFixture(t, (request, response) => {
    requests++;
    assert.equal(request.headers.authorization, 'Bearer project-secret');
    response.setHeader('content-type', 'application/json');
    assert.equal(request.url, '/v1/models');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'codex-model', object: 'model' }] }));
  });

  const result = await checkProvider(config(baseUrl));

  assert.deepEqual(result.modelIds, ['codex-model']);
  assert.equal(result.model, 'codex-model');
  assert.equal(result.catalog, 'available');
  assert.equal(result.generation, 'unverified');
  assert.equal(result.streaming, 'unverified');
  assert.equal(result.tools, 'unverified');
  assert.equal(requests, 1);
});

test('classifies unauthorized responses without exposing the key or response body', async (t) => {
  const baseUrl = await providerFixture(t, (_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'project-secret upstream-private-detail' } }));
  });

  await assert.rejects(checkProvider(config(baseUrl)), (error) => {
    assert.ok(error instanceof ProviderCheckError);
    assert.equal(error.code, 'AUTHENTICATION_FAILED');
    assert.doesNotMatch(error.message, /project-secret|upstream-private-detail/);
    return true;
  });
});

test('rejects malformed model catalogs as a protocol error', async (t) => {
  const baseUrl = await providerFixture(t, (_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'missing-models' }));
  });

  await assert.rejects(checkProvider(config(baseUrl)), (error) => {
    assert.ok(error instanceof ProviderCheckError);
    assert.equal(error.code, 'INVALID_MODELS_RESPONSE');
    return true;
  });
});

test('rejects a configured model that is not enabled', async (t) => {
  const baseUrl = await providerFixture(t, (_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'other-model' }] }));
  });

  await assert.rejects(checkProvider(config(baseUrl)), (error) => {
    assert.ok(error instanceof ProviderCheckError);
    assert.equal(error.code, 'MODEL_NOT_AVAILABLE');
    assert.match(error.message, /other-model/);
    return true;
  });
});

test('reports an unsupported model catalog without inventing capabilities', async (t) => {
  const baseUrl = await providerFixture(t, (_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'catalog unsupported' } }));
  });

  const result = await checkProvider(config(baseUrl));

  assert.equal(result.catalog, 'unavailable');
  assert.deepEqual(result.modelIds, []);
  assert.equal(result.generation, 'unverified');
});

test('refuses endpoint redirects without forwarding the API key', async (t) => {
  let redirectedRequests = 0;
  const baseUrl = await providerFixture(t, (request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(302, { location: '/credential-sink' });
      response.end();
      return;
    }
    if (request.url === '/credential-sink') redirectedRequests++;
    response.end();
  });

  await assert.rejects(checkProvider(config(baseUrl)), (error) => {
    assert.ok(error instanceof ProviderCheckError);
    assert.equal(error.code, 'NETWORK_FAILURE');
    assert.doesNotMatch(error.message, /project-secret/);
    return true;
  });
  assert.equal(redirectedRequests, 0);
});
