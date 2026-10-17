const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class ProviderConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
  }
}

export function providerConfig(environment = process.env, options = {}) {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? '';
  if (options.requireApiKey && !apiKey) {
    throw new ProviderConfigError('CONFIGURATION_MISSING',
      'Set OPENAI_API_KEY before checking an OpenAI-compatible provider.');
  }
  if (!apiKey) return Object.freeze({
    mode: 'local-demo',
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: null,
    timeoutMs: 10_000,
  });

  const configuredBaseUrl = environment.OPENAI_BASE_URL;
  const rawBaseUrl = configuredBaseUrl === undefined ? DEFAULT_BASE_URL : configuredBaseUrl.trim();
  const configuredModel = environment.OPENAI_MODEL;
  const model = configuredModel?.trim() || null;
  if (!rawBaseUrl || (model !== null && (model.length > 200 || /[\u0000-\u001f\u007f]/u.test(model)))) {
    throw new ProviderConfigError('CONFIGURATION_INVALID',
      'Configured OPENAI_BASE_URL must be non-empty and OPENAI_MODEL must not contain control characters.');
  }

  let base;
  try {
    base = new URL(rawBaseUrl || DEFAULT_BASE_URL);
  } catch {
    throw new ProviderConfigError('CONFIGURATION_INVALID', 'OPENAI_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new ProviderConfigError('CONFIGURATION_INVALID',
      'OPENAI_BASE_URL must be an HTTP(S) URL without credentials, query parameters, or fragments.');
  }
  base.pathname = base.pathname.replace(/\/$/u, '');
  return Object.freeze({
    mode: 'openai-compatible',
    apiKey,
    baseUrl: base.toString().replace(/\/$/u, ''),
    model,
    timeoutMs: 10_000,
  });
}
