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
  if (!item) throw new DomainError("NOT_FOUND", `${kind}을(를) 찾을 수 없습니다.`, 404);
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
      const scene = requireItem(state.scenes, edge.to, "장면");
      impact.push({ sceneId: scene.id, title: scene.title, reason: edge.reason, mandatory: edge.mandatory });
    }
  }
  return impact;
};

export const saveDraft = (state, sceneId, input) => {
  requireItem(state.scenes, sceneId, "장면");
  getBranchSnapshot(state, input.baseSnapshotId);
  const draft = { sceneId, branchId: state.currentBranchId, text: input.text, baseSnapshotId: input.baseSnapshotId, updatedAt: now() };
  state.drafts[sceneId] = draft;
  appendEvent(state, "draft.saved", { sceneId, baseSnapshotId: input.baseSnapshotId });
  return draft;
};

export const protectQuote = (state, sceneId, input) => {
  const scene = requireItem(state.scenes, sceneId, "장면");
  if (!scene.text.includes(input.quote)) {
    throw new DomainError("QUOTE_NOT_IN_SCENE", "보호 문장은 현재 정본에 있어야 합니다.", 422);
  }
  if (!scene.protectedQuotes.includes(input.quote)) scene.protectedQuotes.push(input.quote);
  state.contextVersion = (state.contextVersion ?? 0) + 1;
  appendEvent(state, "quote.protected", { sceneId, quote: input.quote });
  return scene;
};

export const addFeedback = (state, input) => {
  requireItem(state.scenes, input.sceneId, "장면");
  const feedback = { id: `feedback-${randomUUID()}`, ...input, branchId: state.currentBranchId, state: "open", createdAt: now() };
  state.feedback.push(feedback);
  appendEvent(state, "feedback.created", { feedbackId: feedback.id, sceneId: input.sceneId });
  return feedback;
};

export const addCandidate = (state, proposal) => {
  if (proposal.branchId !== undefined) assertRecordBranch(state, proposal);
  const { input, proposedText, adapterLabel } = proposal;
  const scene = requireItem(state.scenes, input.sceneId, "장면");
  const base = getBranchSnapshot(state, input.baseSnapshotId);
  if (input.feedbackId) requireItem(state.feedback, input.feedbackId, "피드백");
  const before = base.sceneTexts[scene.id];
  if (typeof before !== "string") throw new DomainError("BASE_SCENE_MISSING", "기준 스냅샷에 장면이 없습니다.", 409);
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
  if (input.feedbackId) requireItem(state.feedback, input.feedbackId, "피드백").state = "awaiting_decision";
  appendEvent(state, "candidate.created", { candidateId: candidate.id, adapter: adapterLabel });
  return candidate;
};

export const commitCandidate = (state, candidateId, input) => {
  const candidate = requireItem(state.candidates, candidateId, "후보");
  assertRecordBranch(state, candidate);
  if (candidate.status !== "pending") throw new DomainError("CANDIDATE_CLOSED", "대기 중인 후보만 승인할 수 있습니다.", 409);
  if ((candidate.contextVersion ?? 0) !== (state.contextVersion ?? 0)) throw new DomainError("STALE_CONTEXT", "기획 또는 보호 조건이 변경되었습니다. 새 후보를 검토하세요.", 409);
  const run = candidate.runId ? requireItem(state.runs, candidate.runId, "실행") : null;
  if (run) assertRecordBranch(state, run);
  if (run?.state === "cancelled" || run?.cancellationRequested) throw new DomainError("RUN_CANCELLED", "취소된 실행의 후보는 승인할 수 없습니다.", 409);
  if (run && run.state !== "awaiting_decision") throw new DomainError("RUN_NOT_APPROVABLE", "결정을 기다리는 실행의 후보만 승인할 수 있습니다.", 409);
  if (state.head !== input.expectedHead || candidate.baseSnapshotId !== state.head) {
    throw new DomainError("STALE_HEAD", "기준 리비전이 현재 HEAD와 다릅니다.", 409);
  }
  if (candidate.hash !== input.hash || candidateHash(candidate) !== input.hash) {
    throw new DomainError("HASH_MISMATCH", "후보 해시가 일치하지 않습니다.", 409);
  }
  const expectedImpact = reviewImpact(state, candidate.sceneId);
  if (canonicalJson(candidate.reviewSet) !== canonicalJson(expectedImpact)) {
    throw new DomainError("INCOMPLETE_IMPACT", "영향 검토 집합이 완전하지 않습니다.", 409);
  }
  const scene = requireItem(state.scenes, candidate.sceneId, "장면");
  const missingQuote = scene.protectedQuotes.find((quote) => !candidate.after.includes(quote));
  if (missingQuote) throw new DomainError("PROTECTED_QUOTE", `보호 문장이 유지되지 않았습니다: ${missingQuote}`, 409);
  scene.text = candidate.after;
  if (state.drafts[scene.id]?.text === candidate.after) delete state.drafts[scene.id];
  candidate.status = "committed";
  if (run) run.state = "completed";
  for (const feedback of state.feedback.filter((item) => item.id === candidate.feedbackId)) {
    feedback.state = "applied";
  }
  const snapshot = advanceSnapshot(state, `후보 승인: ${scene.title}`);
  appendEvent(state, "candidate.committed", { candidateId, snapshotId: snapshot.id, humanRequested: true });
  return { head: state.head, candidate, snapshot };
};

export const rejectCandidate = (state, candidateId) => {
  const candidate = requireItem(state.candidates, candidateId, "후보");
  assertRecordBranch(state, candidate);
  if (candidate.status !== "pending") throw new DomainError("CANDIDATE_CLOSED", "대기 중인 후보만 거절할 수 있습니다.", 409);
  const run = candidate.runId ? requireItem(state.runs, candidate.runId, "실행") : null;
  if (run?.state === "cancelled" || run?.cancellationRequested) throw new DomainError("RUN_CANCELLED", "취소된 실행의 후보는 거절 처리할 수 없습니다.", 409);
  candidate.status = "rejected";
  if (run) run.state = "completed";
  for (const feedback of state.feedback.filter((item) => item.id === candidate.feedbackId)) {
    feedback.state = "open";
  }
  appendEvent(state, "candidate.rejected", { candidateId, humanRequested: true });
  return candidate;
};

export const restoreSnapshot = (state, input) => {
  if (state.head !== input.expectedHead) throw new DomainError("STALE_HEAD", "현재 HEAD가 요청과 다릅니다.", 409);
  const source = getBranchSnapshot(state, input.snapshotId);
  if (!Array.isArray(source.sceneManifest)) {
    throw new DomainError("SNAPSHOT_MANIFEST_MISSING", "이 스냅샷에는 정확 복원용 장면 목록이 없습니다.", 409);
  }
  state.scenes = source.sceneManifest.map((metadata) => ({
    ...structuredClone(metadata),
    text: source.sceneTexts[metadata.id] ?? "",
  }));
  const restored = advanceSnapshot(state, `복원: ${source.label}`);
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
  const scene = { id: `scene-${randomUUID()}`, title: input.title, chapter, status: "canon", text: input.text, summary: "", storyTime: "미정", characters: [], protectedQuotes: [] };
  state.scenes.push(scene);
  const snapshot = advanceSnapshot(state, `장면 추가: ${scene.title}`);
  appendEvent(state, "scene.created", { sceneId: scene.id, snapshotId: snapshot.id, humanRequested: true });
  return { scene, head: state.head };
};
