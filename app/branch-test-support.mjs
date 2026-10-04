import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./api.mjs";
import { FileStore } from "./store.mjs";

export async function branchFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "novail-branches-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const store = new FileStore(file);
  await store.initialize();
  const worker = options.worker ?? { cancel() {} };
  return { app: createApp({ store, worker, distRoot: directory }), directory, file, store };
}

export const readState = (app) => app.request("/api/state").then((response) => response.json());

export const command = (app, path, body, options = {}) => app.request(path, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "idempotency-key": options.key ?? randomUUID(),
    ...(options.branchId ? { "X-Novail-Branch-Id": options.branchId } : {}),
  },
  body: JSON.stringify(body),
});

export async function createBranch(app, state, name = "alternate", sourceSnapshotId = state.head) {
  const response = await command(app, "/api/branches", {
    name, sourceSnapshotId, expectedBranchId: state.currentBranchId, expectedHead: state.head,
  }, { branchId: state.currentBranchId });
  return { response, branch: await response.json() };
}

export async function switchBranch(app, state, branchId, options = {}) {
  return command(app, `/api/branches/${branchId}/switch`, {
    expectedBranchId: state.currentBranchId,
    expectedHead: state.head,
  }, { branchId: state.currentBranchId, ...options });
}
