import { listProviderModelIds, ProviderCatalogError } from '../app/provider-catalog.mjs';
export class ProviderCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderCheckError';
    this.code = code;
  }
}

export async function checkProvider(config) {
  let modelIds;
  try {
    modelIds = await listProviderModelIds(config);
  } catch (error) {
    if (!(error instanceof ProviderCatalogError)) throw error;
    if (error.code === 'MODEL_CATALOG_UNSUPPORTED') return Object.freeze({ modelIds: [], model: config.model,
      catalog: 'unavailable', generation: 'unverified', streaming: 'unverified', tools: 'unverified', strictJsonSchema: 'unverified' });
    throw new ProviderCheckError(error.code, error.message);
  }
  if (config.model !== null && !modelIds.includes(config.model)) {
    throw new ProviderCheckError('MODEL_NOT_AVAILABLE',
      `OPENAI_MODEL was not returned by the provider catalog. Available model IDs: ${modelIds.join(', ') || '(none)'}`);
  }
  return Object.freeze({ modelIds, model: config.model, catalog: 'available',
    generation: 'unverified', streaming: 'unverified', tools: 'unverified', strictJsonSchema: 'unverified' });
}
