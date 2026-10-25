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
    throw new GenerationError('CONTEXT_REFERENCE_MISSING', 'Scene text is missing for a required dependency.', { status: 409, outputTokens: 0, invocationStarted: false });
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
    throw new GenerationError('BLOCKED_CONTEXT_BUDGET', 'Required context exceeds the input character budget. Split the revision scope.', { status: 422, outputTokens: 0, invocationStarted: false });
  }
  return pack;
}

export function prepareRepairInput(state, input) {
  const sceneIds = input.sceneIds ?? [];
  const planIds = input.planIds ?? [];
  const feedbackIds = input.feedbackIds ?? [];
  if (!sceneIds.length && !planIds.length) throw new DomainError('SCHEMA_INVALID', 'Select at least one scene or plan to revise.', 422);
  for (const ids of [sceneIds, planIds, feedbackIds]) {
    if (new Set(ids).size !== ids.length) throw new DomainError('SCHEMA_INVALID', 'The revision scope contains duplicate IDs.', 422);
  }
  if (sceneIds.some((id) => !state.scenes.some((scene) => scene.id === id))
    || planIds.some((id) => !state.plans.some((plan) => plan.id === id))
    || feedbackIds.some((id) => !state.feedback.some((feedback) => feedback.id === id))) {
    throw new DomainError('NOT_FOUND', 'A revision target or feedback item was not found in the current branch.', 404);
  }
  const inputWorkspace = canonicalWorkspace(state);
  if (workspaceHash(inputWorkspace) !== input.baseWorkspaceHash) {
    throw new DomainError('STALE_WORKSPACE', 'The manuscript or planning context changed. Review the scope again.', 409);
  }
  const details = { sceneIds, planIds, feedbackIds, inputWorkspace, baseWorkspaceHash: input.baseWorkspaceHash,
    promptVersion: 'repair-v2', policyVersion: 2 };
  buildRepairPack({ ...input, ...details });
  return details;
}
