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
        throw new DomainError('PROVIDER_KEY_REJECTED', '제공자가 서버 API 키를 거부했습니다. 키를 다시 확인하세요.', 502);
      }
      if (error.code === 'MODEL_CATALOG_UNSUPPORTED') {
        throw new DomainError('MODEL_CATALOG_UNSUPPORTED', '제공자가 모델 목록을 지원하지 않습니다. 모델 ID를 직접 입력하세요.', 502);
      }
      throw new DomainError('MODEL_CATALOG_FAILED', '제공자 모델 목록을 안전하게 불러오지 못했습니다.', 502);
    }
  });
}
