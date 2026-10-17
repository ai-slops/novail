import type { ChangeSet } from "../packages/revision/contracts"

export type Project = Readonly<{ id: string; title: string; subtitle: string; stage: string }>
export type Scene = Readonly<{
  id: string
  title: string
  chapter: string
  status: string
  text: string
  summary: string
  storyTime: string
  characters: readonly string[]
  protectedQuotes: readonly string[]
}>
export type Feedback = Readonly<{
  id: string
  sceneId: string
  text: string
  scope: string
  state: string
  createdAt: string
}>
export type ReviewItem = Readonly<{ sceneId: string; title: string; reason: string; mandatory: boolean }>
export type Candidate = Readonly<{
  id: string
  sceneId: string
  baseSnapshotId: string
  before: string
  after: string
  reason: string
  status: string
  reviewSet: readonly ReviewItem[]
  rewriteSet: readonly string[]
  hash: string
  createdAt: string
}>
export type Snapshot = Readonly<{
  id: string
  label: string
  createdAt: string
  sceneTexts: Readonly<Record<string, string>>
  canBranch: boolean
}>
export type BranchSummary = Readonly<{
  id: string
  name: string
  headSnapshotId: string
  sourceSnapshotId: string
  sourceBranchId: string | null
  createdAt: string
  isCurrent: boolean
  snapshotCount: number
}>
export type EditionSummary = Readonly<{
  id: string
  title: string
  snapshotId: string
  manifestHash: string
  createdAt: string
  publishedBy: string
  revisionOf: string | null
  sceneCount: number
  sourceBranchId: string | null
}>
export type ExportPreviewScene = Readonly<{
  id: string
  chapter: number
  title: string
  textHash: string
  characters: number
}>
export type ExportPreview = Readonly<{
  projectId: string
  snapshotId: string
  manifestHash: string
  sceneCount: number
  characterCount: number
  title: string
  subtitle: string
  scenes: readonly ExportPreviewScene[]
  latestEdition: EditionSummary | null
}>
export type PublishEditionInput = Readonly<{
  title: string
  snapshotId: string
  expectedHead: string
  approvedManifestHash: string
  revisionOf: string | null
  approvedPreviousManifestHash: string | null
  decision: "publish"
  policyVersion: 1
}>
export type Plan = Readonly<{ id: string; title: string; kind: string; description: string; status: string }>
export type Run = Readonly<{ id: string; state: string; purpose: string; createdAt: string }>
export type Settings = Readonly<{ providerConfigured: boolean; mode: string }>
export type Draft = Readonly<{ sceneId: string; text: string; baseSnapshotId: string; updatedAt: string }>
export type WorkspaceState = Readonly<{
  project: Project
  projects: readonly Project[]
  head: string
  workspaceHash: string
  currentBranchId: string
  branches: readonly BranchSummary[]
  scenes: readonly Scene[]
  feedback: readonly Feedback[]
  candidates: readonly Candidate[]
  snapshots: readonly Snapshot[]
  editions: readonly EditionSummary[]
  plans: readonly Plan[]
  runs: readonly Run[]
  settings: Settings
  drafts: Readonly<Record<string, Draft>>
  changeSets: readonly ChangeSet[]
}>

export const workspaceTabs = ["원고", "기획 보드", "타임라인", "개정 검토", "에이전트 실행", "버전 기록"] as const
export type WorkspaceTab = (typeof workspaceTabs)[number]
export type ModalKind = "project" | "scene" | "plan" | null
export type Notice = Readonly<{ tone: "success" | "error"; text: string }>
