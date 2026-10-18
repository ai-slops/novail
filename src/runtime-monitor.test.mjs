import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceTabs } from './types.ts';
import { decodeRuntimeEventChunk, isTerminalRunState, mergeRuntimeEvent, shouldStreamRuntimeEvents } from './runtime-events.ts';

test('agent execution is a durable workspace destination', () => {
  // Given: the top-level workspace destinations
  // When: the user looks for the runtime ledger after a reload
  // Then: agent execution remains directly addressable in the existing tab shell
  assert.equal(workspaceTabs.includes('에이전트 실행'), true);
});

test('SSE decoder preserves split frames and emits a typed public event once complete', () => {
  // Given: one public event split across network chunks
  const event = { id: 'event-1', runId: 'run-1', sequence: 1, createdAt: '2026-10-17T00:00:00.000Z', type: 'runtime.text.delta', details: { text: '첫 문장' } };
  const encoded = `id: event-1\nevent: runtime.text.delta\ndata: ${JSON.stringify(event)}\n\n`;

  // When: the decoder receives the partial and final chunks
  const partial = decodeRuntimeEventChunk('', encoded.slice(0, 24));
  const complete = decodeRuntimeEventChunk(partial.remainder, encoded.slice(24));

  // Then: no partial event escapes and the completed event is parsed exactly once
  assert.deepEqual(partial.events, []);
  assert.deepEqual(complete.events, [event]);
  assert.equal(complete.remainder, '');
});

test('SSE decoder skips private lifecycle frames before public runtime history', () => {
  // Given: the server replay contains private run and decision frames followed by a public runtime frame
  const privateFrames = 'event: run.started\ndata: {"type":"run.started","details":{}}\n\nevent: decision.required\ndata: {"type":"decision.required","details":{}}\n\n';
  const event = { id: 'event-1', runId: 'run-1', sequence: 2, createdAt: '2026-10-17T00:00:00.000Z', type: 'runtime.model.started', details: { ordinal: 1 } };
  const publicFrame = `event: runtime.model.started\ndata: ${JSON.stringify(event)}\n\n`;

  // When: both persisted frames are decoded together
  const decoded = decodeRuntimeEventChunk('', `${privateFrames}${publicFrame}`);

  // Then: only the public runtime event reaches the UI ledger
  assert.deepEqual(decoded.events, [event]);
  assert.equal(decoded.summaryRefreshRequested, false);
});

test('private failed lifecycle frame requests a durable summary refresh without exposing its body', () => {
  // Given: a private provider failure frame containing details that must not enter the public ledger
  const frame = 'event: run.failed\ndata: {"type":"run.failed","details":{"rawProviderBody":"secret"}}\n\n';

  // When: the browser decodes the lifecycle frame
  const decoded = decodeRuntimeEventChunk('', frame);

  // Then: no private payload escapes and the caller is told to reload the safe run summary
  assert.deepEqual(decoded.events, []);
  assert.equal(decoded.summaryRefreshRequested, true);
});

test('event merge rejects replayed IDs while preserving sequence order', () => {
  // Given: a later event already rendered and an earlier replay arrives
  const later = { id: 'event-2', runId: 'run-1', sequence: 2, createdAt: '2026-10-17T00:00:01.000Z', type: 'runtime.model.started', details: { ordinal: 1 } };
  const earlier = { id: 'event-1', runId: 'run-1', sequence: 1, createdAt: '2026-10-17T00:00:00.000Z', type: 'runtime.started', details: {} };

  // When: replay and duplicate events are merged
  const ordered = mergeRuntimeEvent(mergeRuntimeEvent([later], earlier), later);

  // Then: each event appears once in server sequence order
  assert.deepEqual(ordered.map(({ id }) => id), ['event-1', 'event-2']);
});

test('terminal state detection stops streams only after durable terminal summaries', () => {
  // Given / When / Then: active and terminal public states remain distinct
  assert.equal(isTerminalRunState('running'), false);
  assert.equal(isTerminalRunState('awaiting_decision'), true);
  assert.equal(isTerminalRunState('completed'), true);
  assert.equal(isTerminalRunState('cancelled'), true);
  assert.equal(isTerminalRunState('failed'), true);
});

test('selected runs replay once before reconnect decisions use durable state', () => {
  // Given: a selected run whose persisted history has not been replayed
  // When / Then: every state opens its first SSE request
  assert.equal(shouldStreamRuntimeEvents(false, 'awaiting_decision'), true);
  assert.equal(shouldStreamRuntimeEvents(false, 'failed'), true);
  assert.equal(shouldStreamRuntimeEvents(false, 'cancelled'), true);

  // Given: persisted history has already replayed
  // When / Then: only active runs reconnect
  assert.equal(shouldStreamRuntimeEvents(true, 'running'), true);
  assert.equal(shouldStreamRuntimeEvents(true, 'failed'), false);
});
