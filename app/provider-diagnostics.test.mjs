import assert from 'node:assert/strict';
import test from 'node:test';
import { providerHttpDiagnostics } from './provider-diagnostics.mjs';

test('provider HTTP statuses map to stable actionable failure reasons', () => {
  assert.deepEqual([
    providerHttpDiagnostics(401).reasonCode,
    providerHttpDiagnostics(403).reasonCode,
    providerHttpDiagnostics(400, 'unsupported_capability').reasonCode,
    providerHttpDiagnostics(400, 'invalid_parameter').reasonCode,
    providerHttpDiagnostics(429).reasonCode,
    providerHttpDiagnostics(503).reasonCode,
  ], ['authentication_failed', 'policy_denied', 'unsupported_capability', 'unsupported_parameter',
    'quota_exceeded', 'upstream_unavailable']);
  assert.equal(providerHttpDiagnostics(429).retryable, true);
  assert.equal(providerHttpDiagnostics(503).retryable, true);
  assert.equal(providerHttpDiagnostics(400).retryable, false);
});
