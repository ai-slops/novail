import { fail, ok } from '@slop-lab/part/contracts/index.js';
import { createOpenAIResponsesAdapter } from '@slop-lab/part-plugins/providers/openai-responses/index.js';

const metadataKeys = ['metadata', 'response_id', 'sequence_number', 'type'];

function isInformationalMetadataFrame(frame) {
  const eventNames = frame.split(/\r?\n|\r/u)
    .filter((line) => line.startsWith('event:'))
    .map((line) => line.slice(6).trim());
  const data = frame.split(/\r?\n|\r/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /u, ''))
    .join('\n');
  if (eventNames.length !== 1 || eventNames[0] !== 'response.metadata' || !data) return false;
  try {
    const value = JSON.parse(data);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === metadataKeys.join(',')
      && value.type === 'response.metadata'
      && Number.isSafeInteger(value.sequence_number) && value.sequence_number >= 0
      && typeof value.response_id === 'string' && value.response_id.length > 0
      && value.metadata !== null && typeof value.metadata === 'object' && !Array.isArray(value.metadata);
  } catch {
    return false;
  }
}

export function createCompatibleOpenAIResponsesAdapter() {
  const adapter = createOpenAIResponsesAdapter();
  return {
    ...adapter,
    createDecoder(response) {
      const created = adapter.createDecoder(response);
      const mediaType = Object.entries(response.headers)
        .find(([name]) => name.toLowerCase() === 'content-type')?.[1].toLowerCase();
      if (!created.ok || !mediaType?.startsWith('text/event-stream')) return created;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const encoder = new TextEncoder();
      let buffer = '';
      return ok({
        push(chunk) {
          try {
            buffer += decoder.decode(chunk, { stream: true });
          } catch {
            return fail('openai-responses.utf8', 'Invalid UTF-8');
          }
          const events = [];
          while (true) {
            const boundary = buffer.match(/\r\n\r\n|\n\n|\r\r/u);
            if (!boundary || boundary.index === undefined) break;
            const end = boundary.index + boundary[0].length;
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(end);
            if (isInformationalMetadataFrame(frame)) continue;
            const pushed = created.value.push(encoder.encode(`${frame}\n\n`));
            if (!pushed.ok) return pushed;
            events.push(...pushed.value);
          }
          return ok(events);
        },
        finish() {
          try {
            buffer += decoder.decode();
          } catch {
            return fail('openai-responses.utf8', 'Invalid UTF-8');
          }
          if (buffer) {
            const pushed = created.value.push(encoder.encode(buffer));
            if (!pushed.ok) return pushed;
          }
          return created.value.finish();
        },
      });
    },
  };
}
