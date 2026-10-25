import { createFetchTransport } from '@slop-lab/part/model/index.js';

const providerCodePattern = /^[a-zA-Z0-9._-]{1,100}$/u;
const requestIdPattern = /^[a-zA-Z0-9._:/-]{1,200}$/u;

const reasonFor = (status, providerCode) => {
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'policy_denied';
  if (status === 429) return 'quota_exceeded';
  if (status >= 500) return 'upstream_unavailable';
  if (status === 400 && providerCode === 'unsupported_capability') return 'unsupported_capability';
  if (status === 400) return 'unsupported_parameter';
  return 'provider_http_error';
};

export const providerHttpDiagnostics = (status, providerCode, requestId) => ({
  stage: 'provider_http', providerStatus: status,
  ...(providerCode ? { providerCode } : {}), ...(requestId ? { requestId } : {}),
  retryable: status === 429 || status >= 500,
  reasonCode: reasonFor(status, providerCode),
});

export const diagnosticMessage = (reasonCode) => {
  switch (reasonCode) {
    case 'authentication_failed': return 'Check provider authentication.';
    case 'policy_denied': return 'Check project key permissions and provider policy.';
    case 'unsupported_capability': return 'The selected model does not support this request. Check the API mode and model capabilities.';
    case 'unsupported_parameter': return 'The provider does not support a request parameter. Check the API mode and model settings.';
    case 'quota_exceeded': return 'Check the provider usage limit or billing status, then try again.';
    case 'upstream_unavailable': return 'The provider service is temporarily unavailable. Try again shortly.';
    case 'network_failure': return 'Could not connect to the provider. Check the network and provider URL.';
    case 'invalid_json': return 'The provider output is not valid JSON.';
    case 'invalid_shape': return 'The provider output does not match the required revision structure.';
    case 'scope_mismatch': return 'The provider output targets differ from the approved run scope.';
    case 'output_truncated': return 'A revision truncated at the output limit cannot be used. Increase the output limit.';
    default: return 'The provider request failed. Review the run diagnostics.';
  }
};

function providerCodeFrom(bytes) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const code = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
      ? parsed.error.code : undefined;
    return typeof code === 'string' && providerCodePattern.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function requestIdFrom(headers) {
  for (const name of ['x-request-id', 'request-id', 'openai-request-id']) {
    const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    if (typeof value === 'string' && requestIdPattern.test(value)) return value;
  }
  return undefined;
}

export function createDiagnosticTransport({ allowedOrigins, diagnostics }) {
  const transport = createFetchTransport({ allowedOrigins });
  return {
    id: transport.id,
    async send(request, profile, auth, context) {
      const sent = await transport.send(request, profile, auth, context);
      if (!sent.ok) {
        diagnostics.current = { stage: 'provider_transport', retryable: true, reasonCode: 'network_failure' };
        return sent;
      }
      if (sent.value.status === undefined || (sent.value.status >= 200 && sent.value.status < 300)) return sent;
      const chunks = [];
      let size = 0;
      for await (const chunk of sent.value.body) {
        if (size < 16_384) chunks.push(chunk.subarray(0, 16_384 - size));
        size += chunk.byteLength;
        if (size >= 16_384) break;
      }
      const providerCode = providerCodeFrom(Buffer.concat(chunks));
      const requestId = requestIdFrom(sent.value.headers);
      diagnostics.current = providerHttpDiagnostics(sent.value.status, providerCode, requestId);
      return { ok: true, value: { ...sent.value, body: (async function* () {})() } };
    },
  };
}
