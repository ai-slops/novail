import { ListTodo } from "lucide-react"
import type { BranchSummary, Candidate, EditionSummary, Plan, Run, Scene, Snapshot, WorkspaceTab } from "../types"
import type { ChangeSet } from "../../packages/revision/contracts"
import { Versions } from "./Versions"
import { RevisionWorkspace } from "./RevisionWorkspace"
import { RuntimeMonitor } from "./RuntimeMonitor"

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
  selectedChangeSetId: string | undefined
  onOpenRuntimeResult: (resultRef: string) => void
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
  if (props.tab === "원고") return <main className="secondary-view" id="main-content"><ViewHeader eyebrow="YOUR FIRST SCENE" title="Start your first scene" /><div className="empty-review"><p>There is no manuscript yet. Begin with an opening line or a scene note.</p><button className="button primary" type="button" onClick={props.onNewScene}>Create first scene</button></div></main>
  if (props.tab === "기획 보드") return <PlanningBoard {...props} />
  if (props.tab === "타임라인") return <Timeline {...props} />
  if (props.tab === "개정 검토") return <RevisionWorkspace changeSets={props.changeSets} candidates={props.candidates} branchId={props.currentBranchId} head={props.head} selectedChangeSetId={props.selectedChangeSetId} busy={props.busy} onRefresh={props.onRevisionRefresh} onDirtyChange={props.onDirtyChange} onBeforeDiscard={props.onBeforeDiscard} onScene={props.onScene} />
  if (props.tab === "에이전트 실행") return <RuntimeMonitor branchId={props.currentBranchId} baseSnapshotId={props.head} baseWorkspaceHash={props.workspaceHash} scenes={props.scenes} plans={props.plans} onDirtyChange={props.onDirtyChange} onOpenResult={props.onOpenRuntimeResult} />
  return <Versions snapshots={props.snapshots} editions={props.editions} head={props.head} workspaceHash={props.workspaceHash} busy={props.busy} latestRun={props.runs.at(-1)} branches={props.branches} currentBranchId={props.currentBranchId} onSwitchBranch={props.onSwitchBranch} onCreateBranch={props.onCreateBranch} onRefresh={props.onRefresh} onRevisionRefresh={props.onRevisionRefresh} onRestore={props.onRestore} onPublished={props.onPublished} />
}

function ViewHeader({ eyebrow, title, action }: Readonly<{ eyebrow: string; title: string; action?: React.ReactNode }>) {
  return <header className="view-header"><div><p className="overline">{eyebrow}</p><h2>{title}</h2></div>{action}</header>
}

function PlanningBoard(props: ViewProps) {
  const groups = ["진행 전", "작업 중", "완료"] as const
  const groupLabels: Readonly<Record<(typeof groups)[number], string>> = { "진행 전": "Not started", "작업 중": "In progress", 완료: "Complete" }
  return <main className="secondary-view">
    <ViewHeader
      eyebrow="STORY ARCHITECTURE"
      title="Planning board"
      action={<button className="button primary" type="button" onClick={props.onPlan}><ListTodo /> New plan</button>}
    />
    <div className="board-grid">{groups.map((group) => <section className="board-column" key={group}>
      <h3>{groupLabels[group]}<span>{props.plans.filter((plan) => normalizePlan(plan.status) === group).length}</span></h3>
      {props.plans.filter((plan) => normalizePlan(plan.status) === group).map((plan) => <article key={plan.id}>
        <small>{plan.kind}</small><strong>{plan.title}</strong><p>{plan.description}</p>
      </article>)}
    </section>)}</div>
  </main>
}

function normalizePlan(status: string): "진행 전" | "작업 중" | "완료" {
  if (["done", "completed", "완료"].includes(status)) return "완료"
  if (["active", "running", "작업 중"].includes(status)) return "작업 중"
  return "진행 전"
}

function Timeline(props: ViewProps) {
  return <main className="secondary-view"><ViewHeader eyebrow="NARRATIVE TIME" title="Story timeline" /><div className="timeline-line">{props.scenes.map((scene, index) => <button key={scene.id} type="button" onClick={() => props.onScene(scene.id)}><span className="timeline-node">{index + 1}</span><small>{scene.storyTime}</small><strong>{scene.title}</strong><p>{scene.summary}</p><span className="character-row">{scene.characters.join(" · ")}</span></button>)}</div></main>
}
