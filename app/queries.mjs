export const editionSummary = (edition) => ({
  id: edition.id, title: edition.title, snapshotId: edition.snapshotId,
  manifestHash: edition.manifestHash, createdAt: edition.createdAt,
  publishedBy: edition.publishedBy, revisionOf: edition.revisionOf, sceneCount: edition.sceneCount,
  sourceBranchId: edition.sourceBranchId ?? null,
});

export const publicState = (state) => ({
  project: state.project,
  head: state.head,
  workspaceHash: workspaceHash(state),
  currentBranchId: state.currentBranchId,
  branches: state.branches.map((branch) => branchSummary(state, branch)),
  scenes: state.scenes,
  feedback: state.feedback,
  candidates: state.candidates,
  changeSets: projectChangeSets(state),
  snapshots: visibleSnapshots(state).map((snapshot) => ({ ...snapshot, canBranch: snapshot.id === state.head || Boolean(snapshot.narrativeContext) })),
  plans: state.plans,
  runs: state.runs.map(safeRunSummary),
  settings: { ...state.settings, providerConfigured: Boolean(process.env.OPENAI_API_KEY),
    mode: process.env.OPENAI_API_KEY ? 'openai-compatible' : 'local-demo' },
  drafts: state.drafts,
  editions: (state.editions ?? []).map(editionSummary),
  projects: [...state.workspaces.map((workspace) => workspace.project), state.project],
});

export const exportMarkdown = (state) => [
  `# ${state.project.title}`,
  state.project.subtitle ? `_${state.project.subtitle}_` : '',
  ...state.scenes.flatMap((scene) => [`## ${scene.chapter}장. ${scene.title}`, scene.text]),
].filter(Boolean).join('\n\n');
import { projectChangeSets } from '../packages/revision/changesets.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';
import { branchSummary, visibleSnapshots } from './branch-state.mjs';
import { safeRunSummary } from '../packages/execution/public-contract.mjs';
