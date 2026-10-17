import ky from 'ky';
import { z } from 'zod';

const modelsSchema = z.strictObject({
  object: z.literal('list').optional(),
  data: z.array(z.looseObject({ id: z.string().min(1) })),
});
const routeSchema = z.looseObject({
  id: z.string().min(1),
  models: z.array(z.string()),
  protocols: z.array(z.enum(['chat', 'responses'])),
  streaming: z.boolean(),
  tool_representation: z.string(),
});
const capabilitiesSchema = z.strictObject({ routes: z.array(routeSchema) });

export class Router4uCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Router4uCheckError';
    this.code = code;
  }
}

async function getJson(client, path) {
  let response;
  try {
    response = await client.get(path, { throwHttpErrors: false });
  } catch (error) {
    if (error instanceof Error) {
      throw new Router4uCheckError('NETWORK_FAILURE', `Router4U is unreachable at the configured base URL (${error.name}).`);
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new Router4uCheckError('AUTHENTICATION_FAILED',
      'Router4U rejected the project key or it lacks usage:read scope. Issue a project key with default scopes.');
  }
  if (!response.ok) {
    throw new Router4uCheckError('ROUTER4U_HTTP_ERROR', `Router4U readiness endpoint returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error) throw new Router4uCheckError('INVALID_JSON_RESPONSE', `${path} did not return valid JSON.`);
    throw error;
  }
}

export async function checkRouter4u(config) {
  const client = ky.create({
    prefixUrl: `${config.baseUrl.replace(/\/$/, '')}/`,
    headers: { authorization: `Bearer ${config.apiKey}` },
    redirect: 'error',
    retry: 0,
    timeout: config.timeoutMs,
  });
  const [rawModels, rawCapabilities] = await Promise.all([getJson(client, 'models'), getJson(client, 'capabilities')]);
  const modelsResult = modelsSchema.safeParse(rawModels);
  if (!modelsResult.success) throw new Router4uCheckError('INVALID_MODELS_RESPONSE', '/v1/models returned an unsupported response shape.');
  const capabilitiesResult = capabilitiesSchema.safeParse(rawCapabilities);
  if (!capabilitiesResult.success) {
    throw new Router4uCheckError('INVALID_CAPABILITIES_RESPONSE', '/v1/capabilities returned an unsupported response shape.');
  }
  if (capabilitiesResult.data.routes.length > 1) {
    throw new Router4uCheckError('AMBIGUOUS_ROUTE',
      'This project authorizes multiple routes. Configure it to authorize only the intended personal route; NOVAIL does not select X-Router4u-Route.');
  }
  const modelIds = [...new Set(modelsResult.data.data.map(({ id }) => id))].sort();
  if (modelIds.length === 0) {
    throw new Router4uCheckError('NO_ENABLED_ROUTE', 'No models are enabled for this project. Enable one personal route and select its models.');
  }
  if (!modelIds.includes(config.model)) {
    throw new Router4uCheckError('MODEL_NOT_ENABLED',
      `OPENAI_MODEL is not enabled for this project. Available model IDs: ${modelIds.join(', ')}`);
  }
  const routes = capabilitiesResult.data.routes.filter((route) => route.models.includes(config.model));
  const compatible = routes.find((route) => route.protocols.includes('chat') && route.streaming
    && route.tool_representation === 'native_protocol_passthrough');
  if (!compatible) {
    throw new Router4uCheckError('CAPABILITY_MISSING',
      'The selected model has no authorized route advertising chat, streaming, and native tool passthrough.');
  }
  return Object.freeze({ modelIds, model: config.model, routeId: compatible.id,
    chat: 'advertised', streaming: 'advertised', tools: 'advertised', strictJsonSchema: 'unverified' });
}
