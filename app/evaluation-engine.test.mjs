import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { commitChangeSet, createChangeSet } from "../packages/revision/changesets.mjs";
import { changeSetHash } from "../packages/revision/change-set-hash.mjs";
import { workspaceHash } from "../packages/revision/workspace.mjs";
import { buildEvaluationSources, validateEvaluationCriteria } from "./evaluation-evidence.mjs";
import { createEvaluationReport, projectEvaluationHistory } from "./evaluation-reports.mjs";
import { mechanicalChecks } from "./evaluation-mechanical.mjs";
import { createSeed } from "./seed.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const proposal = (state, feedbackIds = []) => ({
  kind: "manual",
  reason: "😀가 바뀐 결과를 확인한다",
  changes: [{ kind: "scene", artifactId: state.scenes[0].id, after: { ...state.scenes[0], text: "😀가 revised" } }],
  baseSnapshotId: state.head,
  baseWorkspaceHash: workspaceHash(state),
  feedbackIds,
  runId: null,
  candidateId: null,
  parentChangeSetId: null,
  atomic: false,
  merge: null,
});

test("Given linked feedback, when evaluation sources are built, then full texts become verbatim unknown defaults", () => {
  const state = createSeed();
  state.feedback.push({ id: "feedback-1", sceneId: "scene-1", text: "😀가 고쳐 주세요", state: "open" });
  const changeSet = createChangeSet(state, proposal(state, ["feedback-1"]));

  const result = buildEvaluationSources(state, changeSet);

  assert.equal(result.requiredSources.length, 1);
  assert.equal(result.defaultCriteria[0].text, "😀가 고쳐 주세요");
  assert.equal(result.defaultCriteria[0].basisRefs[0].endCp, 9);
  assert.equal(result.defaultCriteria[0].verdict, "unknown");
});

test("Given a missing linked feedback, when defaults are built, then a warning is returned without fabricated criteria", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state, ["missing-feedback"]));

  const result = buildEvaluationSources(state, changeSet);

  assert.equal(result.defaultCriteria.length, 0);
  assert.equal(result.requiredSources[0].available, false);
  assert.match(result.requiredSources[0].warning, /missing-feedback/);
});

test("Given no linked feedback, when defaults are built, then the immutable change-set reason is the fallback source", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));

  const result = buildEvaluationSources(state, changeSet);

  assert.equal(result.requiredSources[0].kind, "change_set_reason");
  assert.equal(result.defaultCriteria[0].text, changeSet.reason);
});

test("Given an exact Unicode citation and a shifted citation, when evidence is validated, then only the exact code-point span passes", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));
  const sources = buildEvaluationSources(state, changeSet);
  const basis = sources.defaultCriteria[0].basisRefs[0];
  const valid = [{ ...sources.defaultCriteria[0], verdict: "fulfilled", rationale: "직접 확인했습니다.", citations: [{
    entryId: changeSet.entries[0].id,
    side: "after",
    field: "text",
    sourceHash: sha("😀가 revised"),
    startCp: 0,
    endCp: 2,
    quote: "😀가",
  }] }];

  assert.equal(validateEvaluationCriteria(changeSet, sources.requiredSources, valid).humanVerdict, "fulfilled");
  assert.throws(() => validateEvaluationCriteria(changeSet, sources.requiredSources, [{ ...valid[0], citations: [{ ...valid[0].citations[0], startCp: 1 }] }]),
    ({ code }) => code === "EVIDENCE_INVALID");
  assert.equal(basis.sourceHash, sha(changeSet.reason));
});

test("Given a frozen base containing protected content, when a report is created after live state drifts, then checks use the frozen base and append an immutable chain", () => {
  const state = createSeed();
  const protectedScene = state.scenes.find(({ id }) => id === "scene-7");
  const changeSet = createChangeSet(state, { ...proposal(state), changes: [{ kind: "scene", artifactId: protectedScene.id,
    after: { ...protectedScene, text: `${protectedScene.text}\n검토됨` } }] });
  state.scenes.find(({ id }) => id === "scene-7").protectedQuotes = [];
  const source = buildEvaluationSources(state, changeSet);
  const guards = { expectedChangeSetHash: changeSet.hash, expectedHead: state.head,
    expectedWorkspaceHash: workspaceHash(state), expectedLatestReportId: null };
  const first = createEvaluationReport(state, changeSet, { ...guards, criteria: source.defaultCriteria });
  const second = createEvaluationReport(state, changeSet, { ...guards, expectedLatestReportId: first.id, criteria: source.defaultCriteria });

  assert.equal(first.mechanicalChecks.find(({ id }) => id === "protected_content").verdict, "pass");
  assert.deepEqual(second.supersedes, { id: first.id, hash: first.hash });
  assert.equal(projectEvaluationHistory(state, changeSet).history.length, 2);
});

test("Given a report whose frozen base is later corrupted, when history and append are evaluated, then it is noncurrent and append is blocked", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));
  const source = buildEvaluationSources(state, changeSet);
  const guards = {
    expectedChangeSetHash: changeSet.hash,
    expectedHead: state.head,
    expectedWorkspaceHash: workspaceHash(state),
    expectedLatestReportId: null,
    criteria: source.defaultCriteria,
  };
  const report = createEvaluationReport(state, changeSet, guards);
  changeSet._baseWorkspace.scenes[0].text = "corrupted";

  const projected = projectEvaluationHistory(state, changeSet).history[0];

  assert.equal(projected.valid, true);
  assert.equal(projected.current, false);
  assert.ok(projected.invalidReasons.includes("BASE_WORKSPACE_CORRUPT"));
  assert.throws(() => createEvaluationReport(state, changeSet, { ...guards, expectedLatestReportId: report.id }),
    ({ code }) => code === "BASE_WORKSPACE_CORRUPT");
  assert.equal(state.evaluationReports.length, 1);
});

test("Given mixed human judgments or an unrepresented required source, when summary is computed, then violation dominates and incomplete proof stays unknown", () => {
  const state = createSeed();
  state.feedback.push({ id: "feedback-1", sceneId: "scene-1", text: "First requirement", state: "open" });
  state.feedback.push({ id: "feedback-2", sceneId: "scene-1", text: "Second requirement", state: "open" });
  const changeSet = createChangeSet(state, proposal(state, ["feedback-1", "feedback-2"]));
  const sources = buildEvaluationSources(state, changeSet);
  const cited = { entryId: changeSet.entries[0].id, side: "after", field: "text",
    sourceHash: sha("😀가 revised"), startCp: 0, endCp: 2, quote: "😀가" };
  const fulfilledOne = [{ ...sources.defaultCriteria[0], verdict: "fulfilled", rationale: "확인", citations: [cited] }];
  const violated = [...fulfilledOne, { ...sources.defaultCriteria[1], verdict: "violated", rationale: "불충족", citations: [cited] }];

  assert.equal(validateEvaluationCriteria(changeSet, sources.requiredSources, fulfilledOne).humanVerdict, "unknown");
  assert.equal(validateEvaluationCriteria(changeSet, sources.requiredSources, violated).humanVerdict, "violated");
});

test("Given a bad source hash, missing entry, or graph citation, when evidence is validated, then each bad reference is rejected", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));
  const sources = buildEvaluationSources(state, changeSet);
  const criterion = sources.defaultCriteria[0];
  const cases = [
    { ...criterion, basisRefs: [{ ...criterion.basisRefs[0], sourceHash: "b".repeat(64) }] },
    { ...criterion, verdict: "fulfilled", rationale: "확인", citations: [{ entryId: "missing", side: "after", field: "text",
      sourceHash: sha("😀가 revised"), startCp: 0, endCp: 2, quote: "😀가" }] },
    { ...criterion, verdict: "fulfilled", rationale: "확인", citations: [{ entryId: changeSet.entries[0].id, side: "before", field: "description",
      sourceHash: sha("x"), startCp: 0, endCp: 1, quote: "x" }] },
  ];

  for (const candidate of cases) {
    assert.throws(() => validateEvaluationCriteria(changeSet, sources.requiredSources, [candidate]),
      ({ code }) => code === "EVIDENCE_INVALID");
  }
});

test("Given no frozen base or an invalid projected layout, when mechanical checks run, then unavailable and skipped checks are not reported as passes", () => {
  const state = createSeed();
  const noBase = createChangeSet(state, proposal(state));
  delete noBase._baseWorkspace;
  const unavailable = mechanicalChecks(noBase);
  const invalid = createChangeSet(state, { ...proposal(state), reason: "Invalid synthetic layout" });
  invalid.entries = [{ id: "change-layout", key: "layout:reading-order", kind: "layout", artifactId: "reading-order",
    title: "Reading order", before: invalid._baseWorkspace.scenes.map(({ id }) => id), after: ["missing-scene"] }];
  invalid.hash = changeSetHash(invalid);
  const checked = mechanicalChecks(invalid);

  assert.equal(unavailable.find(({ id }) => id === "workspace_schema").verdict, "unknown");
  assert.equal(checked.find(({ id }) => id === "workspace_schema").verdict, "fail");
  assert.equal(checked.find(({ id }) => id === "protected_content").code, "CHECK_SKIPPED_SCHEMA_FAILURE");
});

test("Given equivalent proposals with and without a report, when both are adopted, then adoption behavior and installed workspaces are unchanged", () => {
  const withReport = createSeed();
  const withoutReport = createSeed();
  const reportedSet = createChangeSet(withReport, proposal(withReport));
  const plainSet = createChangeSet(withoutReport, proposal(withoutReport));
  const sources = buildEvaluationSources(withReport, reportedSet);
  createEvaluationReport(withReport, reportedSet, {
    expectedChangeSetHash: reportedSet.hash,
    expectedHead: withReport.head,
    expectedWorkspaceHash: workspaceHash(withReport),
    expectedLatestReportId: null,
    criteria: sources.defaultCriteria,
  });

  const reportedCommit = commitChangeSet(withReport, reportedSet.id, { expectedHead: withReport.head,
    approvedHash: reportedSet.hash, reviewedKeys: reportedSet.requiredReviewKeys, decision: "accept", policyVersion: 2 });
  const plainCommit = commitChangeSet(withoutReport, plainSet.id, { expectedHead: withoutReport.head,
    approvedHash: plainSet.hash, reviewedKeys: plainSet.requiredReviewKeys, decision: "accept", policyVersion: 2 });

  assert.equal(reportedCommit.changeSet.status, plainCommit.changeSet.status);
  assert.equal(workspaceHash(withReport), workspaceHash(withoutReport));
  assert.equal(withReport.evaluationReports.length, 1);
});

test("Given a hash-consistent proposal whose projected scene violates the canonical schema, when checks run, then schema fails and protection is unknown", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));
  changeSet.entries[0].after.chapter = 0;
  changeSet.hash = changeSetHash(changeSet);

  const checks = mechanicalChecks(changeSet);

  assert.equal(checks.find(({ id }) => id === "integrity").verdict, "fail");
  assert.equal(checks.find(({ id }) => id === "workspace_schema").verdict, "fail");
  assert.equal(checks.find(({ id }) => id === "protected_content").verdict, "unknown");
});

test("Given a report whose proposal immutable payload is later mutated without rehashing, when history is projected, then the envelope stays valid but is noncurrent", () => {
  const state = createSeed();
  const changeSet = createChangeSet(state, proposal(state));
  const sources = buildEvaluationSources(state, changeSet);
  createEvaluationReport(state, changeSet, { expectedChangeSetHash: changeSet.hash, expectedHead: state.head,
    expectedWorkspaceHash: workspaceHash(state), expectedLatestReportId: null, criteria: sources.defaultCriteria });
  changeSet.impact.warnings.push("tampered immutable warning");

  const projected = projectEvaluationHistory(state, changeSet).history[0];

  assert.equal(projected.valid, true);
  assert.equal(projected.current, false);
  assert.equal(projected.evidenceValid, true);
  assert.ok(projected.invalidReasons.includes("CHANGESET_HASH_MISMATCH"));
});

test("Given an immutable report whose linked feedback later disappears, when history is projected, then the report remains visible with unresolved evidence", () => {
  const state = createSeed();
  state.feedback.push({ id: "feedback-history", sceneId: "scene-1", text: "Keep this requirement", state: "open" });
  const changeSet = createChangeSet(state, proposal(state, ["feedback-history"]));
  const sources = buildEvaluationSources(state, changeSet);
  const report = createEvaluationReport(state, changeSet, { expectedChangeSetHash: changeSet.hash, expectedHead: state.head,
    expectedWorkspaceHash: workspaceHash(state), expectedLatestReportId: null, criteria: sources.defaultCriteria });
  state.feedback = [];

  const projected = projectEvaluationHistory(state, changeSet).history[0];

  assert.equal(projected.valid, true);
  assert.equal(projected.report.id, report.id);
  assert.equal(projected.evidenceValid, false);
  assert.equal(projected.current, false);
  assert.ok(projected.invalidReasons.includes("REPORT_EVIDENCE_INVALID"));

  state.feedback = [{ id: "feedback-history", sceneId: "scene-1", text: "Changed requirement", state: "open" }];
  const changed = projectEvaluationHistory(state, changeSet).history[0];
  assert.equal(changed.valid, true);
  assert.equal(changed.evidenceValid, false);
  assert.equal(changed.current, false);
});
