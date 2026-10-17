export class Router4uConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Router4uConfigError';
    this.code = code;
  }
}

export function router4uConfig(environment = process.env) {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
  const model = environment.OPENAI_MODEL?.trim() ?? '';
  const rawBaseUrl = environment.OPENAI_BASE_URL?.trim() ?? '';
  if (!apiKey || !model || !rawBaseUrl) {
    throw new Router4uConfigError('CONFIGURATION_MISSING',
      'Set OPENAI_BASE_URL, OPENAI_API_KEY, and an OPENAI_MODEL selected in Router4U.');
  }
  let base;
  try {
    base = new URL(rawBaseUrl);
  } catch {
    throw new Router4uConfigError('CONFIGURATION_INVALID', 'OPENAI_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Router4uConfigError('CONFIGURATION_INVALID',
      'OPENAI_BASE_URL must be an HTTP(S) URL without credentials, query parameters, or fragments.');
  }
  base.pathname = base.pathname.replace(/\/$/, '');
  return Object.freeze({ baseUrl: base.toString().replace(/\/$/, ''), apiKey, model, timeoutMs: 10_000 });
}

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major !== 24 || minor < 22) {
    throw new Router4uConfigError('NODE_VERSION_UNSUPPORTED', 'Router4U setup requires Node.js 24.22.x or newer in the 24.x series.');
  }
}
