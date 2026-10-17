import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createSeed } from './seed.mjs';

const node = process.execPath;
const script = new URL('../scripts/check-router4u.mjs', import.meta.url);

async function runCli(arguments_, environment = {}) {
  const child = spawn(node, [script.pathname, ...arguments_], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '', ...environment },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

test('prints help without configured environment', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /--generate/);
  assert.equal(result.stderr, '');
});

test('rejects unknown arguments before making a request', async () => {
  const result = await runCli(['--unknown']);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /INVALID_ARGUMENT/);
  assert.equal(result.stdout, '');
});

test('requires an explicit project key and selected model', async () => {
  const result = await runCli([]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /CONFIGURATION_MISSING/);
  assert.doesNotMatch(result.stderr, /Bearer/);
});

test('Router4U start wrapper fails closed before importing the server', async () => {
  const startScript = new URL('../scripts/start-router4u.mjs', import.meta.url);
  const child = spawn(node, [startScript.pathname], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_BASE_URL: 'http://127.0.0.1:9470/v1' },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');

  assert.notEqual(code, 0);
  assert.match(stderr, /CONFIGURATION_MISSING/);
  assert.doesNotMatch(stderr, /listening|local-demo/);
});

test('runs the real Part tool loop only with explicit generate opt-in', async (t) => {
  let chatCalls = 0;
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', request.method === 'POST' ? 'text/event-stream' : 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'codex-model' }] }));
      return;
    }
    if (request.url === '/v1/capabilities') {
      response.end(JSON.stringify({ routes: [{ id: 'personal', models: ['codex-model'], protocols: ['chat'], streaming: true,
        tool_representation: 'native_protocol_passthrough' }] }));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    chatCalls++;
    if (chatCalls === 1) {
      const calls = body.tools.map((tool, index) => ({ index, id: `call-${index}`, type: 'function',
        function: { name: tool.function.name, arguments: '{}' } }));
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: calls }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const scope = JSON.parse(body.messages.find((message) => message.role === 'user').content);
    const names = new Map(body.messages.flatMap((message) => message.tool_calls ?? [])
      .map((call) => [call.id, call.function.name]));
    const tools = new Map(body.messages.filter((message) => message.role === 'tool')
      .map((message) => [names.get(message.tool_call_id), JSON.parse(message.content)]));
    const patches = {
      scenes: tools.get('novail_read_selected_scenes').map((scene) => ({ id: scene.id, text: scene.text })),
      plans: tools.get('novail_read_selected_plans').map((plan) => ({ id: plan.id, description: plan.description })),
    };
    assert.deepEqual(patches.scenes.map((item) => item.id), scope.sceneIds);
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(patches) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await runCli(['--generate'], {
    OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OPENAI_API_KEY: 'project-secret', OPENAI_MODEL: 'codex-model',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /READINESS PASS/);
  assert.match(result.stdout, /PART_INTEGRATION PASS/);
  assert.match(result.stdout, /TOOLS exercised=3/);
  assert.match(result.stdout, /HEAD unchanged/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /project-secret|Bearer|푸른 인장의 밤/);
  assert.equal(chatCalls, 2);
});

test('does not claim tool compatibility when the provider skips tool calls', async (t) => {
  const seed = createSeed();
  const patches = {
    scenes: [{ id: 'scene-1', text: seed.scenes.find(({ id }) => id === 'scene-1').text }],
    plans: [{ id: 'plan-plot', description: seed.plans.find(({ id }) => id === 'plan-plot').description }],
  };
  const server = createServer((_request, response) => {
    response.setHeader('content-type', _request.method === 'POST' ? 'text/event-stream' : 'application/json');
    if (_request.url === '/v1/models') {
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'codex-model' }] }));
      return;
    }
    if (_request.url === '/v1/capabilities') {
      response.end(JSON.stringify({ routes: [{ id: 'personal', models: ['codex-model'], protocols: ['chat'], streaming: true,
        tool_representation: 'native_protocol_passthrough' }] }));
      return;
    }
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(patches) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await runCli(['--generate'], {
    OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OPENAI_API_KEY: 'project-secret', OPENAI_MODEL: 'codex-model',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /TOOLS_NOT_EXERCISED/);
  assert.match(result.stderr, /compatibility is unverified/);
  assert.doesNotMatch(result.stdout, /PART_INTEGRATION PASS/);
});
