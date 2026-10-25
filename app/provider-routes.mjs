import { providerModelsSchema } from '../packages/execution/contracts.ts';
import { DomainError } from './errors.mjs';
import { listProviderModelIds, ProviderCatalogError } from './provider-catalog.mjs';
import { providerConfig } from './provider-config.mjs';

export function mountProviderRoutes(app) {
  app.get('/api/provider/models', async (context) => {
    const config = providerConfig();
    if (config.mode === 'local-demo') {
      return context.json(providerModelsSchema.parse({ configured: false, defaultModel: null, models: [] }));
    }
    try {
      const modelIds = await listProviderModelIds(config);
      return context.json(providerModelsSchema.parse({
        configured: true,
        defaultModel: config.model,
        models: modelIds.map((id) => ({ id })),
      }));
    } catch (error) {
      if (!(error instanceof ProviderCatalogError)) throw error;
      if (error.code === 'AUTHENTICATION_FAILED') {
        throw new DomainError('PROVIDER_KEY_REJECTED', 'The provider rejected the server API key. Check the key again.', 502);
      }
      if (error.code === 'MODEL_CATALOG_UNSUPPORTED') {
        throw new DomainError('MODEL_CATALOG_UNSUPPORTED', 'The provider does not support model listing. Enter a model ID directly.', 502);
      }
      throw new DomainError('MODEL_CATALOG_FAILED', 'Could not load the provider model list safely.', 502);
    }
  });
}
