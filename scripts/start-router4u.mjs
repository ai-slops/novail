import { assertSupportedNode, router4uConfig } from './router4u-config.mjs';

try {
  assertSupportedNode();
  router4uConfig();
  await import('../app/server.mjs');
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : 'STARTUP_FAILED';
  const message = error instanceof Error ? error.message : 'NOVAIL startup failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
