import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { branchFixture, command, readState } from './branch-test-support.mjs';
import { createApplicationWorker } from './execution.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

export const TOOL_IDS = [
  'novail_read_selected_scenes',
  'novail_read_selected_plans',
  'novail_read_readonly_context',
];

export async function providerFixture(t, transform, options = {}) {
  let runtimeWorker;
  const fixture = await branchFixture(t, { worker: { cancel(id) { runtimeWorker?.cancel(id); } } });
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (options.httpFailure) {
      response.writeHead(options.httpFailure.status, {
        'content-type': 'application/json',
        'x-request-id': options.httpFailure.requestId,
      });
      response.end(JSON.stringify({ error: {
        code: options.httpFailure.code,
        type: options.httpFailure.type,
        message: options.httpFailure.privateMessage,
      } }));
      return;
    }
    if (options.api === 'responses') {
      const calls = new Map(body.input.filter((item) => item.type === 'function_call')
        .map((call) => [call.call_id, call.name]));
      const values = Object.fromEntries(body.input.filter((item) => item.type === 'function_call_output')
        .map((item) => [calls.get(item.call_id), JSON.parse(item.output)]));
      const requestScope = JSON.parse(body.input.find((item) => item.role === 'user').content);
      const hasToolResults = Object.keys(values).length > 0;
      const output = hasToolResults
        ? [{ id: `message-${requests.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{
          type: 'output_text', text: JSON.stringify(await transform({ ...values.novail_read_readonly_context,
            scenes: values.novail_read_selected_scenes, plans: values.novail_read_selected_plans,
            instruction: requestScope.instruction })), annotations: [], logprobs: [],
        }] }]
        : TOOL_IDS.map((name, index) => ({ id: `function-${index}`, type: 'function_call', status: 'completed',
          call_id: `call-${index}`, name, arguments: '{}' }));
      const completionTokens = hasToolResults ? options.finalCompletionTokens ?? 40 : options.firstCompletionTokens ?? 0;
      const promptTokens = hasToolResults ? options.finalPromptTokens ?? 30 : 10;
      const envelope = { id: `response-${requests.length}`, object: 'response', status: 'completed', error: null,
        incomplete_details: null, output, usage: { input_tokens: promptTokens, output_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens } };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const metadata = options.responseMetadata
        ? `event: response.metadata\ndata: ${JSON.stringify({ type: 'response.metadata', sequence_number: 0,
          response_id: envelope.id, metadata: { openai_verification_recommendation: [] } })}\n\n`
        : '';
      response.end(`${metadata}event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed',
        sequence_number: options.responseMetadata ? 1 : 0, response: envelope })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const invalidTool = body.tools?.find((tool) => !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.function.name));
    const responseSchema = JSON.stringify(body.response_format?.json_schema?.schema);
    if (invalidTool || responseSchema.includes('prefixItems') || responseSchema.includes('"items":false')) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'unsupported OpenAI request contract' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (requests.length <= (options.toolTurns ?? 1)) {
      const names = options.toolTurns ? [TOOL_IDS[(requests.length - 1) % TOOL_IDS.length]] : TOOL_IDS;
      const toolCalls = names.map((name, index) => ({ index, id: `call-${requests.length}-${index}`,
        type: 'function', function: { name, arguments: '{}' } }));
      const completionTokens = options.firstCompletionTokens ?? 0;
      const usage = options.omitToolUsage ? {} : { usage: { prompt_tokens: 10, completion_tokens: completionTokens,
        total_tokens: 10 + completionTokens } };
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: 'tool_calls' }], ...usage })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const calls = new Map(body.messages.flatMap((message) => message.tool_calls ?? [])
      .map((call) => [call.id, call.function.name]));
    const values = Object.fromEntries(body.messages.filter((message) => message.role === 'tool')
      .map((message) => [calls.get(message.tool_call_id), JSON.parse(message.content)]));
    const requestScope = JSON.parse(body.messages.find((message) => message.role === 'user').content);
    const input = { ...values.novail_read_readonly_context, scenes: values.novail_read_selected_scenes,
      plans: values.novail_read_selected_plans, instruction: requestScope.instruction };
    const patches = await transform(input);
    const completionTokens = options.finalCompletionTokens ?? 40;
    const promptTokens = options.finalPromptTokens ?? 30;
    const frames = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(patches) }, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } })}\n\ndata: [DONE]\n\n`;
    const bytes = Buffer.from(frames);
    for (let offset = 0; offset < bytes.length; offset += 7) response.write(bytes.subarray(offset, offset + 7));
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const oldKey = process.env.OPENAI_API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  const oldModel = process.env.OPENAI_MODEL;
  const oldApi = process.env.OPENAI_API;
  process.env.OPENAI_API_KEY = 'isolated-test-provider';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.OPENAI_MODEL = 'environment-default';
  if (options.api === undefined) delete process.env.OPENAI_API; else process.env.OPENAI_API = options.api;
  t.after(() => {
    server.close();
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldBase;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
    if (oldApi === undefined) delete process.env.OPENAI_API; else process.env.OPENAI_API = oldApi;
  });
  const state = await readState(fixture.app);
  const input = { baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(await fixture.store.read()),
    instruction: '선택과 결과를 함께 보강', model: options.model ?? 'selected-model', sceneIds: options.sceneIds ?? ['scene-1', 'scene-7'],
    planIds: options.planIds ?? ['plan-plot'], feedbackIds: [],
    budget: options.budget ?? { maxModelCalls: 2, maxOutputTokens: 2048 } };
  runtimeWorker = createApplicationWorker(fixture.store);
  return { ...fixture, state, input, requests, worker: runtimeWorker };
}

export const completePatches = (input) => ({
  scenes: input.scenes.map((scene) => ({ id: scene.id, text: `${scene.text}\n새로운 결심이 남았다.` })),
  plans: input.plans.map((plan) => ({ id: plan.id, description: `${plan.description}\n선택의 결과를 확인한다.` })),
});

export async function runRepair(fixture) {
  const response = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  assert.equal(response.status, 202);
  const run = await response.json();
  await fixture.worker.tick();
  const state = await fixture.store.read();
  return { state, run: state.runs.find((item) => item.id === run.id) };
}
