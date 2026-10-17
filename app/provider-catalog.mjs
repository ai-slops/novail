import ky from 'ky';
import { z } from 'zod';

const modelsResponseSchema = z.strictObject({
  object: z.literal('list').optional(),
  data: z.array(z.looseObject({ id: z.string().trim().min(1).max(200) })),
});

export class ProviderCatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderCatalogError';
    this.code = code;
  }
}

export async function listProviderModelIds(config) {
  const client = ky.create({
    prefixUrl: `${config.baseUrl.replace(/\/$/, '')}/`,
    headers: { authorization: `Bearer ${config.apiKey}` },
    redirect: 'error',
    retry: 0,
    timeout: config.timeoutMs,
  });
  let response;
  try {
    response = await client.get('models', { throwHttpErrors: false });
  } catch (error) {
    if (error instanceof Error) {
      throw new ProviderCatalogError('NETWORK_FAILURE', `The provider model catalog is unreachable (${error.name}).`);
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderCatalogError('AUTHENTICATION_FAILED', 'The provider rejected the API key or proxy key.');
  }
  if (response.status === 404 || response.status === 405) {
    throw new ProviderCatalogError('MODEL_CATALOG_UNSUPPORTED', 'The provider does not expose a compatible model catalog.');
  }
  if (!response.ok) {
    throw new ProviderCatalogError('PROVIDER_HTTP_ERROR', `The provider model catalog returned HTTP ${response.status}.`);
  }
  let raw;
  try {
    raw = await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new ProviderCatalogError('INVALID_JSON_RESPONSE', 'The provider model catalog did not return valid JSON.');
    }
    throw error;
  }
  const parsed = modelsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderCatalogError('INVALID_MODELS_RESPONSE', 'The provider model catalog returned an unsupported response shape.');
  }
  return [...new Set(parsed.data.data.map(({ id }) => id))].sort();
}
