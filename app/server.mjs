import { serve } from "@hono/node-server";

import { createApp } from "./api.mjs";
import { createApplicationWorker } from "./execution.mjs";
import { createStore } from "./store.mjs";
import { providerConfig } from "./provider-config.mjs";

providerConfig();
const store = createStore();
await store.initialize();

const worker = createApplicationWorker(store);
worker.start();

const server = serve({
  fetch: createApp({ store, worker }).fetch,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
});

const shutdown = async () => {
  worker.stop();
  server.close();
  await store.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
