import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompatibleOpenAIResponsesAdapter } from './openai-responses-compat.mjs';

const metadata = { type: 'response.metadata', sequence_number: 1, response_id: 'response-1',
  metadata: { openai_verification_recommendation: [] } };

function decoder() {
  const created = createCompatibleOpenAIResponsesAdapter().createDecoder({
    status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
  assert.equal(created.ok, true);
  return created.value;
}

test('Responses compatibility ignores an exact informational metadata frame across chunks', () => {
  const stream = `event: response.metadata\ndata: ${JSON.stringify(metadata)}\n\n`
    + `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', sequence_number: 2,
      response: { id: 'response-1', object: 'response', status: 'completed', error: null,
        incomplete_details: null, output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\n`
    + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(stream);
  const created = decoder();

  for (let offset = 0; offset < bytes.length; offset += 7) {
    assert.equal(created.push(bytes.subarray(offset, offset + 7)).ok, true);
  }
  const result = created.finish();

  assert.equal(result.ok, true);
  assert.equal(result.value.finish.normalized, 'stop');
});

test('Responses compatibility preserves failed and incomplete terminal events', () => {
  for (const type of ['response.failed', 'response.incomplete']) {
    const created = decoder();
    assert.equal(created.push(new TextEncoder().encode(
      `event: response.metadata\ndata: ${JSON.stringify(metadata)}\n\n`,
    )).ok, true);

    const result = created.push(new TextEncoder().encode(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: 2,
        response: { id: 'response-1', status: type.slice('response.'.length) } })}\n\n`,
    ));

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'part.openai-responses.failed');
  }
});

test('Responses compatibility does not ignore malformed metadata events', () => {
  const created = decoder();
  const malformed = { ...metadata };
  delete malformed.response_id;

  const result = created.push(new TextEncoder().encode(
    `event: response.metadata\ndata: ${JSON.stringify(malformed)}\n\n`,
  ));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'part.openai-responses.event');
});
