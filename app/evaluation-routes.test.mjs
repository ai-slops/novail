import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createChangeSet } from "../packages/revision/changesets.mjs";
import { workspaceHash } from "../packages/revision/workspace.mjs";
import { branchFixture, command, createBranch, readState, switchBranch } from "./branch-test-support.mjs";

const makeProposal = (state, extra = {}) => ({
  kind: "manual",
  reason: "Opening must show the choice.",
  changes: [{ kind: "scene", artifactId: state.scenes[0].id,
    after: { ...state.scenes[0], text: `${state.scenes[0].text} Choice shown.` } }],
  baseSnapshotId: state.head,
  baseWorkspaceHash: workspaceHash(state),
  feedbackIds: [],
  runId: null,
  candidateId: null,
  parentChangeSetId: null,
  atomic: false,
  merge: null,
  ...extra,
});

async function seededChangeSet(store, extra = {}) {
  return store.transaction((state) => createChangeSet(state, makeProposal(state, extra)));
}

const reportBody = (projection, criteria = projection.defaultCriteria) => ({
  expectedChangeSetHash: projection.binding.changeSetHash,
  expectedHead: projection.binding.currentHead,
  expectedWorkspaceHash: projection.binding.currentWorkspaceHash,
  expectedLatestReportId: projection.latestReportId,
  criteria,
});

test("Given a pending proposal, when evaluation GET and POST run, then a stable report contract is appended without approval mutation", async (t) => {
  const { app, store } = await branchFixture(t);
  const set = await seededChangeSet(store);
  const before = await store.read();
  const getResponse = await app.request(`/api/change-sets/${set.id}/evaluation-reports`);
  const projection = await getResponse.json();
  const postResponse = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection));
  const report = await postResponse.json();
  const after = await store.read();

  assert.equal(getResponse.status, 200);
  assert.equal(postResponse.status, 201);
  assert.equal(report.humanVerdict, "unknown");
  assert.equal(after.evaluationReports.length, 1);
  assert.equal(after.audit.at(-1).type, "evaluation_report.created");
  for (const field of ["head", "scenes", "plans", "dependencies", "feedback", "candidates", "changeSets", "snapshots", "runs"]) {
    assert.deepEqual(after[field], before[field]);
  }
});

test("Given one idempotency key, when the same report request is retried, then only one report and event exist", async (t) => {
  const { app, store } = await branchFixture(t);
  const set = await seededChangeSet(store);
  const projection = await (await app.request(`/api/change-sets/${set.id}/evaluation-reports`)).json();
  const key = randomUUID();
  const first = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection), { key });
  const second = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection), { key });
  const state = await store.read();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await first.json()).id, (await second.json()).id);
  assert.equal(state.evaluationReports.length, 1);
  assert.equal(state.audit.filter(({ type }) => type === "evaluation_report.created").length, 1);
});

test("Given stale CAS and current-state guards, when report creation is attempted, then each conflict is rejected", async (t) => {
  const { app, store } = await branchFixture(t);
  const set = await seededChangeSet(store);
  const projection = await (await app.request(`/api/change-sets/${set.id}/evaluation-reports`)).json();
  const first = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection));
  assert.equal(first.status, 201);
  const cases = [
    { ...reportBody(projection), expectedHead: "wrong-head" },
    { ...reportBody(projection), expectedWorkspaceHash: "b".repeat(64) },
    reportBody(projection),
  ];
  const expected = ["STALE_HEAD", "STALE_WORKSPACE", "EVALUATION_REPORT_CAS_MISMATCH"];
  for (const [index, input] of cases.entries()) {
    const response = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, input);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, expected[index]);
  }
  assert.equal((await store.read()).evaluationReports.length, 1);
});

test("Given a proposal made stale by adoption elsewhere, when evaluated with current guards, then report creation succeeds but binding remains noncurrent", async (t) => {
  const { app, store } = await branchFixture(t);
  const stale = await seededChangeSet(store);
  const adopted = await seededChangeSet(store, { reason: "Another revision",
    changes: [{ kind: "scene", artifactId: "scene-3", after: { ...(await store.read()).scenes[1], text: "Concurrent revision" } }] });
  const commit = await command(app, `/api/change-sets/${adopted.id}/commit`, {
    expectedHead: adopted.baseSnapshotId,
    approvedHash: adopted.hash,
    reviewedKeys: adopted.requiredReviewKeys,
    decision: "accept",
    policyVersion: 2,
  });
  assert.equal(commit.status, 200);
  const projection = await (await app.request(`/api/change-sets/${stale.id}/evaluation-reports`)).json();
  const response = await command(app, `/api/change-sets/${stale.id}/evaluation-reports`, reportBody(projection));

  assert.equal(projection.binding.proposalBaseCurrent, false);
  assert.equal(projection.binding.actionable, true);
  assert.equal(response.status, 201);
});

test("Given branch-local reports, when a fork is created and switched, then reports are not copied and foreign reads are rejected", async (t) => {
  const { app, store } = await branchFixture(t);
  const set = await seededChangeSet(store);
  const projection = await (await app.request(`/api/change-sets/${set.id}/evaluation-reports`)).json();
  await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection));
  const main = await readState(app);
  const { branch } = await createBranch(app, main, "evaluation fork");
  const switched = await switchBranch(app, main, branch.id);
  assert.equal(switched.status, 200);
  const forkState = await store.read();
  const foreign = await app.request(`/api/change-sets/${set.id}/evaluation-reports`, {
    headers: { "X-Novail-Branch-Id": branch.id },
  });

  assert.deepEqual(forkState.evaluationReports, []);
  assert.equal(foreign.status, 404);
});

test("Given a corrupted stored report, when history is read and superseded, then content is enveloped as invalid and cannot be trusted as a parent", async (t) => {
  const { app, store } = await branchFixture(t);
  const set = await seededChangeSet(store);
  const initial = await (await app.request(`/api/change-sets/${set.id}/evaluation-reports`)).json();
  await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(initial));
  await store.transaction((state) => { state.evaluationReports[0].humanVerdict = "fulfilled"; });

  const getResponse = await app.request(`/api/change-sets/${set.id}/evaluation-reports`);
  const projection = await getResponse.json();
  const postResponse = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection));

  assert.equal(getResponse.status, 200);
  assert.deepEqual(projection.history[0], {
    valid: false,
    reportId: projection.latestReportId,
    current: false,
    evidenceValid: false,
    invalidReasons: ["REPORT_HASH_INVALID"],
  });
  assert.equal(projection.binding.actionable, false);
  assert.equal(postResponse.status, 409);
  assert.equal((await postResponse.json()).error.code, "EVALUATION_HISTORY_CORRUPT");
});

test("Given feedback and changed text with meaningful edge whitespace, when defaults are read and exact evidence is posted, then bytes and hashes remain unchanged", async (t) => {
  const { app, store } = await branchFixture(t);
  const exact = " \n😀가\t";
  const set = await store.transaction((state) => {
    state.feedback.push({ id: "feedback-whitespace", sceneId: state.scenes[0].id, text: exact, state: "open" });
    return createChangeSet(state, makeProposal(state, {
      feedbackIds: ["feedback-whitespace"],
      changes: [{ kind: "scene", artifactId: state.scenes[0].id, after: { ...state.scenes[0], text: exact } }],
    }));
  });
  const projection = await (await app.request(`/api/change-sets/${set.id}/evaluation-reports`)).json();
  const criterion = {
    ...projection.defaultCriteria[0],
    verdict: "fulfilled",
    rationale: "원문 전체를 확인했습니다.",
    citations: [{ entryId: set.entries[0].id, side: "after", field: "text",
      sourceHash: createHash("sha256").update(exact).digest("hex"), startCp: 0,
      endCp: Array.from(exact).length, quote: exact }],
  };
  const response = await command(app, `/api/change-sets/${set.id}/evaluation-reports`, reportBody(projection, [criterion]));
  const report = await response.json();

  assert.equal(projection.defaultCriteria[0].text, exact);
  assert.equal(projection.defaultCriteria[0].basisRefs[0].quote, exact);
  assert.equal(response.status, 201);
  assert.equal(report.criteria[0].text, exact);
  assert.equal(report.criteria[0].citations[0].quote, exact);
});
