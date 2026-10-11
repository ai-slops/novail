import { ListTodo } from "lucide-react"
import type { BranchSummary, Candidate, EditionSummary, Plan, Run, Scene, Snapshot, WorkspaceTab } from "../types"
import type { ChangeSet } from "../../packages/revision/contracts"
import { Versions } from "./Versions"
import { RevisionWorkspace } from "./RevisionWorkspace"

type ViewProps = Readonly<{
  tab: WorkspaceTab
  scenes: readonly Scene[]
  plans: readonly Plan[]
  runs: readonly Run[]
  candidates: readonly Candidate[]
  changeSets: readonly ChangeSet[]
  workspaceHash: string
  snapshots: readonly Snapshot[]
  editions: readonly EditionSummary[]
  head: string
  busy: boolean
  branches: readonly BranchSummary[]
  currentBranchId: string
  onPlan: () => void
  onNewScene: () => void
  onRestore: (snapshot: Snapshot) => Promise<void>
  onPublished: (edition: EditionSummary, branchId: string) => void
  onSwitchBranch: (id: string) => Promise<void>
  onCreateBranch: (name: string, sourceSnapshotId: string) => Promise<boolean>
  onRefresh: () => Promise<void>
  onRevisionRefresh: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onBeforeDiscard: () => boolean
  onScene: (id: string) => void
}>

export function WorkspaceViews(props: ViewProps) {
  if (props.tab === "원고") return <main className="secondary-view" id="main-content"><ViewHeader eyebrow="YOUR FIRST SCENE" title="첫 장면을 시작하세요" /><div className="empty-review"><p>아직 원고가 없습니다. 첫 문장이나 장면 메모로 이야기를 시작할 수 있습니다.</p><button className="button primary" type="button" onClick={props.onNewScene}>첫 장면 만들기</button></div></main>
  if (props.tab === "기획 보드") return <PlanningBoard {...props} />
  if (props.tab === "타임라인") return <Timeline {...props} />
  if (props.tab === "개정 검토") return <RevisionWorkspace changeSets={props.changeSets} candidates={props.candidates} branchId={props.currentBranchId} head={props.head} busy={props.busy} onRefresh={props.onRevisionRefresh} onDirtyChange={props.onDirtyChange} onBeforeDiscard={props.onBeforeDiscard} onScene={props.onScene} />
  return <Versions snapshots={props.snapshots} editions={props.editions} head={props.head} workspaceHash={props.workspaceHash} busy={props.busy} latestRun={props.runs.at(-1)} branches={props.branches} currentBranchId={props.currentBranchId} onSwitchBranch={props.onSwitchBranch} onCreateBranch={props.onCreateBranch} onRefresh={props.onRefresh} onRevisionRefresh={props.onRevisionRefresh} onRestore={props.onRestore} onPublished={props.onPublished} />
}

function ViewHeader({ eyebrow, title, action }: Readonly<{ eyebrow: string; title: string; action?: React.ReactNode }>) {
  return <header className="view-header"><div><p className="overline">{eyebrow}</p><h2>{title}</h2></div>{action}</header>
}

function PlanningBoard(props: ViewProps) {
  const groups = ["진행 전", "작업 중", "완료"] as const
  return <main className="secondary-view"><ViewHeader eyebrow="STORY ARCHITECTURE" title="기획 보드" action={<button className="button primary" type="button" onClick={props.onPlan}><ListTodo /> 새 기획</button>} /><div className="board-grid">{groups.map((group) => <section className="board-column" key={group}><h3>{group}<span>{props.plans.filter((plan) => normalizePlan(plan.status) === group).length}</span></h3>{props.plans.filter((plan) => normalizePlan(plan.status) === group).map((plan) => <article key={plan.id}><small>{plan.kind}</small><strong>{plan.title}</strong><p>{plan.description}</p></article>)}</section>)}</div></main>
}

function normalizePlan(status: string): "진행 전" | "작업 중" | "완료" {
  if (["done", "completed", "완료"].includes(status)) return "완료"
  if (["active", "running", "작업 중"].includes(status)) return "작업 중"
  return "진행 전"
}

function Timeline(props: ViewProps) {
  return <main className="secondary-view"><ViewHeader eyebrow="NARRATIVE TIME" title="이야기 타임라인" /><div className="timeline-line">{props.scenes.map((scene, index) => <button key={scene.id} type="button" onClick={() => props.onScene(scene.id)}><span className="timeline-node">{index + 1}</span><small>{scene.storyTime}</small><strong>{scene.title}</strong><p>{scene.summary}</p><span className="character-row">{scene.characters.join(" · ")}</span></button>)}</div></main>
}
