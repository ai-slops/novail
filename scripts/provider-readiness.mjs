import ky from 'ky';
import { z } from 'zod';

const modelsSchema = z.strictObject({
  object: z.literal('list').optional(),
  data: z.array(z.looseObject({ id: z.string().min(1) })),
});
export class ProviderCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderCheckError';
    this.code = code;
  }
}

async function getJson(client, path) {
  let response;
  try {
    response = await client.get(path, { throwHttpErrors: false });
  } catch (error) {
    if (error instanceof Error) {
      throw new ProviderCheckError('NETWORK_FAILURE', `The provider is unreachable at the configured base URL (${error.name}).`);
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderCheckError('AUTHENTICATION_FAILED',
      'The provider rejected the API key or proxy key.');
  }
  if (path === 'models' && [404, 405].includes(response.status)) return null;
  if (!response.ok) {
    throw new ProviderCheckError('PROVIDER_HTTP_ERROR', `The provider endpoint returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error) throw new ProviderCheckError('INVALID_JSON_RESPONSE', `${path} did not return valid JSON.`);
    throw error;
  }
}

export async function checkProvider(config) {
  const client = ky.create({
    prefixUrl: `${config.baseUrl.replace(/\/$/, '')}/`,
    headers: { authorization: `Bearer ${config.apiKey}` },
    redirect: 'error',
    retry: 0,
    timeout: config.timeoutMs,
  });
  const rawModels = await getJson(client, 'models');
  if (rawModels === null) return Object.freeze({ modelIds: [], model: config.model,
    catalog: 'unavailable', generation: 'unverified', streaming: 'unverified', tools: 'unverified', strictJsonSchema: 'unverified' });
  const modelsResult = modelsSchema.safeParse(rawModels);
  if (!modelsResult.success) throw new ProviderCheckError('INVALID_MODELS_RESPONSE', '/models returned an unsupported response shape.');
  const modelIds = [...new Set(modelsResult.data.data.map(({ id }) => id))].sort();
  if (!modelIds.includes(config.model)) {
    throw new ProviderCheckError('MODEL_NOT_AVAILABLE',
      `OPENAI_MODEL was not returned by the provider catalog. Available model IDs: ${modelIds.join(', ') || '(none)'}`);
  }
  return Object.freeze({ modelIds, model: config.model, catalog: 'available',
    generation: 'unverified', streaming: 'unverified', tools: 'unverified', strictJsonSchema: 'unverified' });
}
