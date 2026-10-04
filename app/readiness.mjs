import { createHash } from "node:crypto";

import { DomainError, reviewImpact } from "./domain.mjs";
import { getBranchSnapshot } from "./branch-state.mjs";

export const buildGenerationContext = (state, input) => {
  const snapshot = getBranchSnapshot(state, input.baseSnapshotId);
  const metadata = snapshot.sceneManifest?.find((item) => item.id === input.sceneId);
  const baseText = snapshot.sceneTexts[input.sceneId];
  if (!metadata || typeof baseText !== "string") {
    throw new DomainError("BASE_SCENE_MISSING", "기준 스냅샷에 장면이 없습니다.", 409);
  }
  const plans = state.plans.filter((plan) => plan.status === "active")
    .map(({ title, kind, description }) => ({ title, kind, description }));
  const reviewExcerpts = reviewImpact(state, input.sceneId).map((impact) => {
    const text = snapshot.sceneTexts[impact.sceneId];
    return { ...impact, excerpt: typeof text === "string" ? text.slice(0, 1_200) : "" };
  });
  const requiredTokens = Math.ceil((baseText.length + input.instruction.length + JSON.stringify({ plans, reviewExcerpts }).length) / 3);
  if (requiredTokens > 100_000) {
    throw new DomainError("BLOCKED_CONTEXT_BUDGET", "장면과 검토 문맥이 생성 컨텍스트 예산을 초과합니다.", 422);
  }
  const scene = { ...metadata, text: baseText };
  const contextHash = createHash("sha256").update(JSON.stringify({
    baseSnapshotId: snapshot.id,
    branchId: state.currentBranchId,
    manifestHash: snapshot.manifestHash,
    scene,
    instruction: input.instruction,
    plans,
    reviewExcerpts,
  })).digest("hex");
  return { scene, plans, reviewExcerpts, snapshot, contextHash };
};
