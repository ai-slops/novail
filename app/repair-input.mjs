import { DomainError, GenerationError } from './errors.mjs';
import { canonicalWorkspace, workspaceHash } from '../packages/revision/workspace.mjs';

export function buildRepairPack(run) {
  const workspace = run.inputWorkspace;
  const selected = new Set(run.sceneIds);
  const required = new Set(selected);
  const queue = [...selected];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of workspace.dependencies) {
      if (!edge.mandatory) continue;
      const related = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (related && !required.has(related)) { required.add(related); queue.push(related); }
    }
  }
  for (const id of selected) {
    const index = workspace.layout.indexOf(id);
    for (const adjacent of [workspace.layout[index - 1], workspace.layout[index + 1]]) if (adjacent) required.add(adjacent);
  }
  if ([...required].some((id) => !workspace.scenes.some((scene) => scene.id === id))) {
    throw new GenerationError('CONTEXT_REFERENCE_MISSING', '필수 의존성에 해당하는 장면 원문이 없습니다.', { status: 409, outputTokens: 0, invocationStarted: false });
  }
  const pack = {
    instruction: run.instruction,
    readingOrder: workspace.layout.filter((id) => required.has(id)),
    scenes: workspace.scenes.filter((scene) => selected.has(scene.id)).sort((left, right) => workspace.layout.indexOf(left.id) - workspace.layout.indexOf(right.id)),
    plans: workspace.plans.filter((plan) => run.planIds.includes(plan.id)),
    constraints: workspace.plans.filter((plan) => plan.status === 'active'),
    relatedScenes: workspace.scenes.filter((scene) => required.has(scene.id) && !selected.has(scene.id)),
    dependencies: workspace.dependencies.filter((edge) => required.has(edge.from) || required.has(edge.to)),
  };
  if (JSON.stringify(pack).length > 240_000) {
    throw new GenerationError('BLOCKED_CONTEXT_BUDGET', '필수 맥락이 입력 문자 예산을 초과합니다. 수정 범위를 나누세요.', { status: 422, outputTokens: 0, invocationStarted: false });
  }
  return pack;
}

export function prepareRepairInput(state, input) {
  const sceneIds = input.sceneIds ?? [];
  const planIds = input.planIds ?? [];
  const feedbackIds = input.feedbackIds ?? [];
  if (!sceneIds.length && !planIds.length) throw new DomainError('SCHEMA_INVALID', '수정할 장면 또는 기획을 선택하세요.', 422);
  for (const ids of [sceneIds, planIds, feedbackIds]) {
    if (new Set(ids).size !== ids.length) throw new DomainError('SCHEMA_INVALID', '수정 범위에 중복된 ID가 있습니다.', 422);
  }
  if (sceneIds.some((id) => !state.scenes.some((scene) => scene.id === id))
    || planIds.some((id) => !state.plans.some((plan) => plan.id === id))
    || feedbackIds.some((id) => !state.feedback.some((feedback) => feedback.id === id))) {
    throw new DomainError('NOT_FOUND', '현재 분기의 수정 대상 또는 피드백을 찾을 수 없습니다.', 404);
  }
  const inputWorkspace = canonicalWorkspace(state);
  if (workspaceHash(inputWorkspace) !== input.baseWorkspaceHash) {
    throw new DomainError('STALE_WORKSPACE', '원고 또는 기획 맥락이 바뀌었습니다. 범위를 다시 확인하세요.', 409);
  }
  const details = { sceneIds, planIds, feedbackIds, inputWorkspace, baseWorkspaceHash: input.baseWorkspaceHash,
    promptVersion: 'repair-v2', policyVersion: 2 };
  buildRepairPack({ ...input, ...details });
  return details;
}
