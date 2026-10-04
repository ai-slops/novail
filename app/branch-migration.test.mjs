import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { createApp } from "./api.mjs";
import { reviewImpact } from "./domain.mjs";
import { canonicalJson } from "../packages/domain/canonical.mjs";
import { createSeed } from "./seed.mjs";
import { FileStore } from "./store.mjs";
import { command, createBranch, readState } from "./branch-test-support.mjs";

const withoutBranchModel = (state) => {
  delete state.currentBranchId;
  delete state.branches;
  delete state.branchSchemaVersion;
  delete state.legacyExecution;
  for (const snapshot of state.snapshots) {
    delete snapshot.narrativeContext;
    delete snapshot.schemaVersion;
    delete snapshot.parentSnapshotId;
    snapshot.manifestHash = createHash('sha256').update(JSON.stringify({ sceneTexts: snapshot.sceneTexts, sceneManifest: snapshot.sceneManifest })).digest('hex');
  }
  return state;
};

async function legacyFixture(t, prepare = (state) => state) {
  const directory = await mkdtemp(join(tmpdir(), "novail-branch-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const legacy = prepare(withoutBranchModel(createSeed()));
  await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const store = new FileStore(file);
  await store.initialize();
  return { app: createApp({ store, distRoot: directory }), file, legacy, store };
}

const legacyCandidate = (state, id, runId = null) => {
  const text = state.scenes.find((scene) => scene.id === 'scene-7').text;
  const payload = { sceneId: 'scene-7', baseSnapshotId: state.head, before: text, after: text,
    reviewSet: reviewImpact(state, 'scene-7'), rewriteSet: ['scene-7'], contextHash: 'a'.repeat(64),
    runId, contextVersion: state.contextVersion ?? 0 };
  const candidate = { ...payload, id, feedbackId: null, status: 'pending', reason: 'legacy', createdAt: '2026-09-22T00:00:00.000Z',
    hash: createHash('sha256').update(canonicalJson(payload)).digest('hex') };
  state.candidates.push(candidate);
  return candidate;
};

test("Given an unmigrated file, when FileStore initializes twice, then one deterministic main branch is added idempotently", async (t) => {
  const { file, store } = await legacyFixture(t);
  const first = await store.read();
  await store.close();
  const reopened = new FileStore(file);
  await reopened.initialize();
  const second = await reopened.read();
  t.after(() => reopened.close());

  assert.equal(first.branches.length, 1);
  assert.equal(first.branches[0].name, "주 작업본");
  assert.equal(first.currentBranchId, first.branches[0].id);
  assert.equal(second.currentBranchId, first.currentBranchId);
  assert.deepEqual(second.branches, first.branches);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), second);
});

test("Given a legacy candidate, when migration completes, then its identity and old hash remain valid on main", async (t) => {
  let original;
  const { app, store } = await legacyFixture(t, (state) => {
    original = legacyCandidate(state, "candidate-legacy");
    return state;
  });
  const migrated = await store.read();
  const candidate = migrated.candidates.find((item) => item.id === original.id);
  const response = await command(app, `/api/candidates/${candidate.id}/commit`, {
    expectedHead: migrated.head, hash: original.hash,
  }, { branchId: migrated.currentBranchId });

  assert.equal(candidate.hash, original.hash);
  assert.equal(candidate.branchId, undefined);
  assert.equal(response.status, 200);
});

test("Given active and archived legacy projects, when migrated, then both receive stable default branches without changing artifact IDs", async (t) => {
  let archivedCandidateId;
  const { app, store } = await legacyFixture(t, (state) => {
    const archived = withoutBranchModel(createSeed());
    archived.project = { ...archived.project, id: "project-archived", title: "보관 작품" };
    archivedCandidateId = legacyCandidate(archived, "candidate-archived").id;
    state.workspaces.push({
      project: archived.project, head: archived.head, scenes: archived.scenes, feedback: archived.feedback,
      candidates: archived.candidates, snapshots: archived.snapshots, plans: archived.plans, runs: archived.runs,
      drafts: archived.drafts, dependencies: archived.dependencies, contextVersion: 0, editions: [],
    });
    return state;
  });
  const active = await store.read();
  const archivedWorkspace = active.workspaces.find((workspace) => workspace.project.id === "project-archived");
  const response = await command(app, "/api/projects/project-archived/switch", {});
  const reopened = await store.read();

  assert.equal(archivedWorkspace.branches.length, 1);
  assert.equal(archivedWorkspace.branches[0].name, "주 작업본");
  assert.equal(response.status, 200);
  assert.equal(reopened.candidates.some((candidate) => candidate.id === archivedCandidateId), true);
  assert.equal(reopened.branches.length, 1);
});

test("Given global legacy jobs and events for two projects, when projects are reopened, then each owning workspace retains its queue history", async (t) => {
  const { app, store } = await legacyFixture(t, (state) => {
    const archived = withoutBranchModel(createSeed());
    archived.project = { ...archived.project, id: "project-queue-archive", title: "작업 보관" };
    archived.runs = [{ id: "run-archived", projectId: archived.project.id, state: "completed", queueManaged: true }];
    state.runs = [{ id: "run-active", projectId: state.project.id, state: "completed", queueManaged: true }];
    state.jobs = [
      { id: "job-active", runId: "run-active", state: "succeeded" },
      { id: "job-archived", runId: "run-archived", state: "succeeded" },
    ];
    state.runEvents = [
      { id: "event-active", runId: "run-active", sequence: 1, type: "run.completed" },
      { id: "event-archived", runId: "run-archived", sequence: 1, type: "run.completed" },
    ];
    state.workspaces.push({
      project: archived.project, head: archived.head, scenes: archived.scenes, feedback: [], candidates: [],
      snapshots: archived.snapshots, plans: archived.plans, runs: archived.runs, drafts: {},
      dependencies: archived.dependencies, contextVersion: 0, editions: [],
    });
    return state;
  });
  const active = await store.read();
  assert.deepEqual(active.jobs.map((job) => job.id), ["job-active"]);
  assert.deepEqual(active.runEvents.map((event) => event.id), ["event-active"]);

  await command(app, "/api/projects/project-queue-archive/switch", {});
  const archived = await store.read();
  assert.deepEqual(archived.jobs.map((job) => job.id), ["job-archived"]);
  assert.deepEqual(archived.runEvents.map((event) => event.id), ["event-archived"]);
});

test("Given legacy snapshots without narrative context, when branching, then only the current head is a safe source", async (t) => {
  const { app } = await legacyFixture(t, (state) => {
    const newer = structuredClone(state.snapshots[0]);
    newer.id = "snapshot-legacy-current";
    newer.label = "legacy current";
    state.snapshots.push(newer);
    state.head = newer.id;
    return state;
  });
  const migrated = await readState(app);
  const historical = await createBranch(app, migrated, "unsafe history", "snapshot-initial");
  const current = await createBranch(app, migrated, "safe current", migrated.head);

  assert.equal(historical.response.status, 409);
  assert.equal(historical.branch.error.code, "SNAPSHOT_CONTEXT_UNAVAILABLE");
  assert.equal(current.response.status, 201);
});

test('legacy execution records without a run are retained for audit rather than silently discarded', async (t) => {
  const { store } = await legacyFixture(t, (state) => {
    state.jobs = [{ id: 'orphan-job', runId: 'missing-run', state: 'failed', usageState: 'usage_unknown' }];
    state.runEvents = [{ id: 'orphan-event', runId: 'missing-run', sequence: 1, type: 'run.failed' }];
    return state;
  });
  const migrated = await store.read();
  assert.equal(migrated.legacyExecution.jobs[0].id, 'orphan-job');
  assert.equal(migrated.legacyExecution.runEvents[0].id, 'orphan-event');
  assert.deepEqual(migrated.jobs, []);
});
