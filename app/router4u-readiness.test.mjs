import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { checkRouter4u, Router4uCheckError } from '../scripts/router4u-readiness.mjs';

async function routerFixture(t, handler) {
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

test('reports readiness when the configured model has chat, streaming, and native tools', async (t) => {
  const baseUrl = await routerFixture(t, (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer project-secret');
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'codex-model', object: 'model' }] }));
      return;
    }
    response.end(JSON.stringify({ routes: [{ id: 'personal', models: ['codex-model'], protocols: ['chat'], streaming: true,
      tool_representation: 'native_protocol_passthrough' }] }));
  });

  const result = await checkRouter4u(config(baseUrl));

  assert.deepEqual(result.modelIds, ['codex-model']);
  assert.equal(result.model, 'codex-model');
  assert.equal(result.chat, 'advertised');
  assert.equal(result.streaming, 'advertised');
  assert.equal(result.tools, 'advertised');
  assert.equal(result.strictJsonSchema, 'unverified');
});

test('classifies unauthorized responses without exposing the key or response body', async (t) => {
  const baseUrl = await routerFixture(t, (_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'project-secret upstream-private-detail' } }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'AUTHENTICATION_FAILED');
    assert.doesNotMatch(error.message, /project-secret|upstream-private-detail/);
    return true;
  });
});

test('rejects malformed capabilities as a protocol error', async (t) => {
  const baseUrl = await routerFixture(t, (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(request.url === '/v1/models'
      ? JSON.stringify({ object: 'list', data: [{ id: 'codex-model' }] })
      : JSON.stringify({ status: 'missing-routes' }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'INVALID_CAPABILITIES_RESPONSE');
    return true;
  });
});

test('rejects a configured model that is not enabled', async (t) => {
  const baseUrl = await routerFixture(t, (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(request.url === '/v1/models'
      ? JSON.stringify({ object: 'list', data: [{ id: 'other-model' }] })
      : JSON.stringify({ routes: [{ id: 'personal', models: ['other-model'], protocols: ['chat'], streaming: true,
        tool_representation: 'native_protocol_passthrough' }] }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'MODEL_NOT_ENABLED');
    assert.match(error.message, /other-model/);
    return true;
  });
});

test('rejects a route that does not advertise all NOVAIL requirements', async (t) => {
  const baseUrl = await routerFixture(t, (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(request.url === '/v1/models'
      ? JSON.stringify({ object: 'list', data: [{ id: 'codex-model' }] })
      : JSON.stringify({ routes: [{ id: 'personal', models: ['codex-model'], protocols: ['responses'], streaming: true,
        tool_representation: 'native_protocol_passthrough' }] }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'CAPABILITY_MISSING');
    return true;
  });
});

test('rejects multiple authorized routes because NOVAIL does not select a route header', async (t) => {
  const baseUrl = await routerFixture(t, (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(request.url === '/v1/models'
      ? JSON.stringify({ object: 'list', data: [{ id: 'codex-model' }] })
      : JSON.stringify({ routes: [
        { id: 'personal', models: ['codex-model'], protocols: ['chat'], streaming: true,
          tool_representation: 'native_protocol_passthrough' },
        { id: 'other', models: ['other-model'], protocols: ['chat'], streaming: true,
          tool_representation: 'native_protocol_passthrough' },
      ] }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'AMBIGUOUS_ROUTE');
    assert.match(error.message, /only the intended personal route/);
    return true;
  });
});

test('refuses endpoint redirects without forwarding the project key', async (t) => {
  let redirectedRequests = 0;
  const baseUrl = await routerFixture(t, (request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(302, { location: '/credential-sink' });
      response.end();
      return;
    }
    if (request.url === '/credential-sink') redirectedRequests++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ routes: [{ id: 'personal', models: ['codex-model'], protocols: ['chat'], streaming: true,
      tool_representation: 'native_protocol_passthrough' }] }));
  });

  await assert.rejects(checkRouter4u(config(baseUrl)), (error) => {
    assert.ok(error instanceof Router4uCheckError);
    assert.equal(error.code, 'NETWORK_FAILURE');
    assert.doesNotMatch(error.message, /project-secret/);
    return true;
  });
  assert.equal(redirectedRequests, 0);
});
