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
    case 'authentication_failed': return '제공자 인증을 확인하세요.';
    case 'policy_denied': return '프로젝트 키 권한과 제공자 정책을 확인하세요.';
    case 'unsupported_capability': return '선택한 모델이 이 요청 기능을 지원하지 않습니다. API 방식과 모델 기능을 확인하세요.';
    case 'unsupported_parameter': return '제공자가 요청 매개변수를 지원하지 않습니다. API 방식과 모델 설정을 확인하세요.';
    case 'quota_exceeded': return '제공자 사용량 한도 또는 결제 상태를 확인한 뒤 다시 시도하세요.';
    case 'upstream_unavailable': return '제공자 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하세요.';
    case 'network_failure': return '제공자에 연결할 수 없습니다. 네트워크와 제공자 주소를 확인하세요.';
    case 'invalid_json': return '제공자 출력이 유효한 JSON이 아닙니다.';
    case 'invalid_shape': return '제공자 출력 형식이 필요한 개정안 구조와 다릅니다.';
    case 'scope_mismatch': return '제공자 출력의 수정 대상이 승인된 실행 범위와 다릅니다.';
    case 'output_truncated': return '출력 한도에서 잘린 개정안은 사용할 수 없습니다. 출력 한도를 늘리세요.';
    default: return '제공자 요청에 실패했습니다. 실행 진단을 확인하세요.';
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
