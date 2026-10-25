import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../packages/domain/canonical.mjs";
import { publicState } from "./queries.mjs";
import { DomainError } from "./errors.mjs";
import { appendEvent } from "./events.mjs";
import { advanceSnapshot } from "./snapshots.mjs";
import { assertRecordBranch, getBranchSnapshot } from "./branch-state.mjs";
import { candidateHash } from "./candidate-hash.mjs";
export { candidateHash } from "./candidate-hash.mjs";
export { publicState, exportMarkdown } from "./queries.mjs";
export { DomainError } from "./errors.mjs";
export { updateProject, switchProject } from "./projects.mjs";

const now = () => new Date().toISOString();
const requireItem = (items, id, kind) => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new DomainError("NOT_FOUND", `${kind} not found.`, 404);
  return item;
};

export const reviewImpact = (state, sceneId) => {
  const visited = new Set([sceneId]);
  const queue = [sceneId];
  const impact = [];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of state.dependencies.filter((item) => item.from === current)) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push(edge.to);
      const scene = requireItem(state.scenes, edge.to, "Scene");
      impact.push({ sceneId: scene.id, title: scene.title, reason: edge.reason, mandatory: edge.mandatory });
    }
  }
  return impact;
};

export const saveDraft = (state, sceneId, input) => {
  requireItem(state.scenes, sceneId, "Scene");
  getBranchSnapshot(state, input.baseSnapshotId);
  const draft = { sceneId, branchId: state.currentBranchId, text: input.text, baseSnapshotId: input.baseSnapshotId, updatedAt: now() };
  state.drafts[sceneId] = draft;
  appendEvent(state, "draft.saved", { sceneId, baseSnapshotId: input.baseSnapshotId });
  return draft;
};

export const protectQuote = (state, sceneId, input) => {
  const scene = requireItem(state.scenes, sceneId, "Scene");
  if (!scene.text.includes(input.quote)) {
    throw new DomainError("QUOTE_NOT_IN_SCENE", "The protected quote must appear in the current text.", 422);
  }
  if (!scene.protectedQuotes.includes(input.quote)) scene.protectedQuotes.push(input.quote);
  state.contextVersion = (state.contextVersion ?? 0) + 1;
  appendEvent(state, "quote.protected", { sceneId, quote: input.quote });
  return scene;
};

export const addFeedback = (state, input) => {
  requireItem(state.scenes, input.sceneId, "Scene");
  const feedback = { id: `feedback-${randomUUID()}`, ...input, branchId: state.currentBranchId, state: "open", createdAt: now() };
  state.feedback.push(feedback);
  appendEvent(state, "feedback.created", { feedbackId: feedback.id, sceneId: input.sceneId });
  return feedback;
};

export const addCandidate = (state, proposal) => {
  if (proposal.branchId !== undefined) assertRecordBranch(state, proposal);
  const { input, proposedText, adapterLabel } = proposal;
  const scene = requireItem(state.scenes, input.sceneId, "Scene");
  const base = getBranchSnapshot(state, input.baseSnapshotId);
  if (input.feedbackId) requireItem(state.feedback, input.feedbackId, "Feedback");
  const before = base.sceneTexts[scene.id];
  if (typeof before !== "string") throw new DomainError("BASE_SCENE_MISSING", "The base snapshot does not contain the scene.", 409);
  const candidate = {
    id: `candidate-${randomUUID()}`,
    branchId: state.currentBranchId,
    sceneId: scene.id,
    feedbackId: input.feedbackId ?? null,
    baseSnapshotId: base.id,
    before,
    after: proposedText,
    reason: `${input.instruction} (${adapterLabel})`,
    status: "pending",
    reviewSet: reviewImpact(state, scene.id),
    rewriteSet: [scene.id],
    contextHash: proposal.contextHash ?? createHash("sha256").update(JSON.stringify({
      snapshot: base.manifestHash, sceneId: scene.id, before,
    })).digest("hex"),
    runId: proposal.runId ?? null,
    contextVersion: proposal.contextVersion ?? state.contextVersion ?? 0,
    createdAt: now(),
  };
  candidate.hash = candidateHash(candidate);
  state.candidates.push(candidate);
  if (input.feedbackId) requireItem(state.feedback, input.feedbackId, "Feedback").state = "awaiting_decision";
  appendEvent(state, "candidate.created", { candidateId: candidate.id, adapter: adapterLabel });
  return candidate;
};

export const commitCandidate = (state, candidateId, input) => {
  const candidate = requireItem(state.candidates, candidateId, "Candidate");
  assertRecordBranch(state, candidate);
  if (candidate.status !== "pending") throw new DomainError("CANDIDATE_CLOSED", "Only pending candidates can be adopted.", 409);
  if ((candidate.contextVersion ?? 0) !== (state.contextVersion ?? 0)) throw new DomainError("STALE_CONTEXT", "Planning or protection conditions changed. Review a new candidate.", 409);
  const run = candidate.runId ? requireItem(state.runs, candidate.runId, "Agent run") : null;
  if (run) assertRecordBranch(state, run);
  if (run?.state === "cancelled" || run?.cancellationRequested) throw new DomainError("RUN_CANCELLED", "A candidate from a cancelled agent run cannot be adopted.", 409);
  if (run && run.state !== "awaiting_decision") throw new DomainError("RUN_NOT_APPROVABLE", "Only a candidate from an agent run awaiting a decision can be adopted.", 409);
  if (state.head !== input.expectedHead || candidate.baseSnapshotId !== state.head) {
    throw new DomainError("STALE_HEAD", "The base revision differs from the current HEAD.", 409);
  }
  if (candidate.hash !== input.hash || candidateHash(candidate) !== input.hash) {
    throw new DomainError("HASH_MISMATCH", "The candidate hash does not match.", 409);
  }
  const expectedImpact = reviewImpact(state, candidate.sceneId);
  if (canonicalJson(candidate.reviewSet) !== canonicalJson(expectedImpact)) {
    throw new DomainError("INCOMPLETE_IMPACT", "The impact review set is incomplete.", 409);
  }
  const scene = requireItem(state.scenes, candidate.sceneId, "Scene");
  const missingQuote = scene.protectedQuotes.find((quote) => !candidate.after.includes(quote));
  if (missingQuote) throw new DomainError("PROTECTED_QUOTE", `A protected quote was not preserved: ${missingQuote}`, 409);
  scene.text = candidate.after;
  if (state.drafts[scene.id]?.text === candidate.after) delete state.drafts[scene.id];
  candidate.status = "committed";
  if (run) run.state = "completed";
  for (const feedback of state.feedback.filter((item) => item.id === candidate.feedbackId)) {
    feedback.state = "applied";
  }
  const snapshot = advanceSnapshot(state, `Adopted candidate: ${scene.title}`);
  appendEvent(state, "candidate.committed", { candidateId, snapshotId: snapshot.id, humanRequested: true });
  return { head: state.head, candidate, snapshot };
};

export const rejectCandidate = (state, candidateId) => {
  const candidate = requireItem(state.candidates, candidateId, "Candidate");
  assertRecordBranch(state, candidate);
  if (candidate.status !== "pending") throw new DomainError("CANDIDATE_CLOSED", "Only pending candidates can be rejected.", 409);
  const run = candidate.runId ? requireItem(state.runs, candidate.runId, "Agent run") : null;
  if (run?.state === "cancelled" || run?.cancellationRequested) throw new DomainError("RUN_CANCELLED", "A candidate from a cancelled agent run cannot be rejected.", 409);
  candidate.status = "rejected";
  if (run) run.state = "completed";
  for (const feedback of state.feedback.filter((item) => item.id === candidate.feedbackId)) {
    feedback.state = "open";
  }
  appendEvent(state, "candidate.rejected", { candidateId, humanRequested: true });
  return candidate;
};

export const restoreSnapshot = (state, input) => {
  if (state.head !== input.expectedHead) throw new DomainError("STALE_HEAD", "The current HEAD differs from the request.", 409);
  const source = getBranchSnapshot(state, input.snapshotId);
  if (!Array.isArray(source.sceneManifest)) {
    throw new DomainError("SNAPSHOT_MANIFEST_MISSING", "This snapshot has no scene manifest for an exact restore.", 409);
  }
  state.scenes = source.sceneManifest.map((metadata) => ({
    ...structuredClone(metadata),
    text: source.sceneTexts[metadata.id] ?? "",
  }));
  const restored = advanceSnapshot(state, `Restored: ${source.label}`);
  appendEvent(state, "snapshot.restored", { sourceSnapshotId: source.id, snapshotId: restored.id, humanRequested: true });
  return publicState(state);
};

export const addPlan = (state, input) => {
  const plan = { id: `plan-${randomUUID()}`, ...input, status: "active" };
  state.plans.push(plan);
  state.contextVersion = (state.contextVersion ?? 0) + 1;
  appendEvent(state, "plan.created", { planId: plan.id });
  return plan;
};

export const addScene = (state, input) => {
  const chapter = Math.max(0, ...state.scenes.map((scene) => scene.chapter)) + 1;
  const scene = { id: `scene-${randomUUID()}`, title: input.title, chapter, status: "canon", text: input.text, summary: "", storyTime: "Unspecified", characters: [], protectedQuotes: [] };
  state.scenes.push(scene);
  const snapshot = advanceSnapshot(state, `Scene added: ${scene.title}`);
  appendEvent(state, "scene.created", { sceneId: scene.id, snapshotId: snapshot.id, humanRequested: true });
  return { scene, head: state.head };
};
