import { BookOpenText, Columns3, History, ListTree, RefreshCw, ScanSearch } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ApiError, createBranch, createChangeSet, getRevisionContext, getState, mutate, mutateJson, switchBranch } from "./api"
import { createdIdSchema, createdProjectSchema, workspaceSchema } from "./schema"
import { ContextPanel } from "./components/ContextPanel"
import { Editor } from "./components/Editor"
import { EntityDialog } from "./components/EntityDialog"
import { Header } from "./components/Header"
import { Sidebar } from "./components/Sidebar"
import { WorkspaceViews } from "./components/WorkspaceViews"
import { RevisionComposer } from "./components/RevisionComposer"
import type { EditionSummary, ModalKind, Notice, Snapshot, WorkspaceState, WorkspaceTab } from "./types"
import { workspaceTabs } from "./types"

const tabIcons = [BookOpenText, Columns3, ListTree, ScanSearch, History] as const

export function App() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [tab, setTab] = useState<WorkspaceTab>("원고")
  const [modal, setModal] = useState<ModalKind>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dirty, setDirty] = useState(false)
  const [feedbackDirty, setFeedbackDirty] = useState(false)
  const [repairRequest, setRepairRequest] = useState<Readonly<{ branchId: string; sceneId: string; feedbackId: string; instruction: string }> | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const previousFocus = useRef<HTMLElement | null>(null)
  const stateRef = useRef<WorkspaceState | null>(null)
  const requestSequence = useRef(0)
  const openDrawer = (side: "nav" | "context") => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (side === "nav") { setContextOpen(false); setNavOpen(true) }
    else { setNavOpen(false); setTab("원고"); setContextOpen(true) }
  }
  const closeDrawers = () => { setNavOpen(false); setContextOpen(false); previousFocus.current?.focus() }
  useEffect(() => {
    if ((!navOpen && !contextOpen) || !window.matchMedia("(max-width: 960px)").matches) return
    const drawer = document.querySelector(navOpen ? ".sidebar" : ".context-panel")
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href]') ?? [])
    focusable()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeDrawers() }
      if (event.key === "Tab") {
        const controls = focusable()
        const first = controls[0]; const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener("keydown", trap)
    return () => document.removeEventListener("keydown", trap)
  }, [navOpen, contextOpen])
  const canLeave = () => !(dirty || feedbackDirty) || window.confirm("저장하지 않은 원고 또는 피드백이 있습니다. 저장하지 않고 이동할까요?")
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || feedbackDirty) event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, feedbackDirty])

  const installState = (next: WorkspaceState) => {
    stateRef.current = next
    setState(next)
    setSelectedId((current) => current && next.scenes.some((scene) => scene.id === current) ? current : (next.scenes.find((scene) => scene.chapter.includes("7"))?.id ?? next.scenes[0]?.id ?? ""))
  }
  const refresh = async (expectedBranchId?: string): Promise<boolean> => {
    const sequence = ++requestSequence.current
    const next = await getState(expectedBranchId)
    if (sequence !== requestSequence.current) return false
    if (expectedBranchId !== undefined && next.currentBranchId !== expectedBranchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "요청을 시작한 분기와 서버의 현재 분기가 다릅니다. 상태 다시 불러오기로 안전하게 복구하세요.")
    installState(next)
    return true
  }
  useEffect(() => { refresh().catch(showError) }, [])

  const showError = (error: unknown) => {
    const text = error instanceof ApiError ? error.message : "상태를 불러오지 못했습니다. 잠시 후 다시 시도하세요."
    setNotice({ tone: "error", text })
  }
  const run = async (action: () => Promise<void>, success: string, branchId: string): Promise<boolean> => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      const applied = await refresh(branchId)
      if (!applied) return false
      setNotice({ tone: "success", text: success })
      return true
    } catch (error: unknown) {
      showError(error)
      return false
    } finally {
      setBusy(false)
    }
  }

  const transitionWorkspace = async (action: () => Promise<WorkspaceState>, message: string): Promise<boolean> => {
    if (busy) return false
    const sequence = ++requestSequence.current
    setBusy(true); setTransitioning(true); setNotice(null)
    try {
      const next = await action()
      if (sequence !== requestSequence.current) return false
      installState(next); setEditorEpoch((epoch) => epoch + 1); setDirty(false); setNotice({ tone: "success", text: message })
      return true
    } catch (error: unknown) {
      if (sequence === requestSequence.current) showError(error)
      return false
    } finally {
      if (sequence === requestSequence.current) { setBusy(false); setTransitioning(false) }
    }
  }

  if (!state) return <LoadingScreen notice={notice} onRetry={() => refresh().catch(showError)} />
  const scene = state.scenes.find((item) => item.id === selectedId) ?? state.scenes[0]
  const baseSnapshotId = state.head
  const draft = scene ? state.drafts[scene.id] : undefined
  const draftBase = draft?.baseSnapshotId ?? state.head
  const draftStale = draft !== undefined && draft.baseSnapshotId !== state.head
  const selectScene = (id: string) => { if (id === selectedId && tab === "원고") { setNavOpen(false); return } if (!canLeave()) return; setDirty(false); setSelectedId(id); setTab("원고"); setNavOpen(false) }
  const sceneFeedback = state.feedback.filter((item) => item.sceneId === scene?.id)
  const sceneCandidates = state.candidates.filter((item) => item.sceneId === scene?.id)
  const openRevisionReview = () => { if (canLeave()) { setDirty(false); setTab("개정 검토"); closeDrawers() } }
  const submitFeedback = async (text: string, scope: string): Promise<boolean> => {
    if (!scene) return false
    const branchId = state.currentBranchId
    let feedbackId = ""
    const saved = await run(async () => {
      feedbackId = createdIdSchema.parse(await mutateJson<unknown>("api/feedback", { sceneId: scene.id, text, scope }, branchId)).id
    }, "피드백을 저장했습니다. 실제 수정 범위를 선택하세요.", branchId)
    if (saved) setRepairRequest({ branchId, sceneId: scene.id, feedbackId, instruction: text })
    return saved
  }

  const dialogSubmit = async (primary: string, secondary: string) => {
    const branchId = state.currentBranchId
    let saved = false
    switch (modal) {
      case "project":
        saved = await transitionWorkspace(async () => {
          const created = createdProjectSchema.parse(await mutateJson<unknown>("api/projects", { title: primary, direction: secondary }, branchId))
          const next = await getState()
          if (next.project.id !== created.id || next.currentBranchId !== created.currentBranchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "새 작품을 만들었지만 다른 창에서 작업본이 바뀌었습니다. 상태를 다시 불러오세요.")
          return next
        }, "새 작품을 만들었습니다.")
        break
      case "scene":
        saved = await run(() => mutate("api/scenes", { title: primary, text: secondary }, branchId), "새 항목을 저장했습니다.", branchId)
        break
      case "plan":
        saved = await run(() => mutate("api/plans", { title: primary, kind: "story", description: secondary }, branchId), "새 항목을 저장했습니다.", branchId)
        break
      case null: return
      default: { const exhaustive: never = modal; return exhaustive }
    }
    if (saved) setModal(null)
  }
  const editionPublished = (edition: EditionSummary, branchId: string) => {
    if (stateRef.current?.currentBranchId !== branchId || stateRef.current.project.id !== state.project.id) return
    setState((current) => current?.currentBranchId === branchId ? { ...current, editions: current.editions.some((item) => item.id === edition.id) ? current.editions : [...current.editions, edition] } : current)
    setNotice({ tone: "success", text: `‘${edition.title}’ 판본을 발행했습니다. 이전 판본과 원본 스냅샷은 그대로 보존됩니다.` })
    void refresh(branchId).catch(showError)
  }

  const switchWorkingBranch = async (id: string) => {
    if (busy || id === state.currentBranchId) return
    if (!canLeave()) return
    const expectedBranchId = state.currentBranchId
    const expectedHead = state.head
    await transitionWorkspace(async () => {
      const next = await switchBranch(id, expectedBranchId, expectedHead)
      if (next.currentBranchId !== id) throw new ApiError("BRANCH_SWITCH_MISMATCH", "서버가 요청한 분기가 아닌 다른 분기를 반환했습니다. 상태를 다시 불러오세요.")
      return next
    }, "작업 분기를 전환했습니다.")
  }

  const switchWorkingProject = async (id: string) => {
    if (busy || id === state.project.id || !canLeave()) return
    const branchId = state.currentBranchId
    await transitionWorkspace(async () => {
      const next = workspaceSchema.parse(await mutateJson<unknown>(`api/projects/${encodeURIComponent(id)}/switch`, {}, branchId))
      if (next.project.id !== id) throw new ApiError("PROJECT_SCOPE_CHANGED", "요청한 작품과 응답이 일치하지 않습니다. 상태를 다시 불러오세요.")
      return next
    }, "작품을 전환했습니다.")
  }

  const createWorkingBranch = async (name: string, sourceSnapshotId: string): Promise<boolean> => {
    const expectedBranchId = state.currentBranchId
    const expectedHead = state.head
    return run(async () => { await createBranch({ name, sourceSnapshotId, expectedBranchId, expectedHead }) }, "새 분기를 만들었습니다. 현재 분기는 그대로 유지됩니다.", expectedBranchId)
  }

  const reloadWorkspace = async () => {
    if (!canLeave()) return
    setBusy(true); setNotice(null)
    try {
      const applied = await refresh()
      if (applied) { setEditorEpoch((epoch) => epoch + 1); setDirty(false); setNotice({ tone: "success", text: "서버의 현재 분기 상태를 다시 불러왔습니다." }) }
    } catch (error: unknown) { showError(error) } finally { setBusy(false) }
  }
  const refreshRevision = async (branchId: string): Promise<void> => {
    if (stateRef.current?.currentBranchId !== branchId) return
    const sequence = ++requestSequence.current
    const next = await getState(branchId)
    if (sequence !== requestSequence.current || stateRef.current?.currentBranchId !== branchId) return
    if (next.currentBranchId !== branchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "수정 작업을 시작한 분기와 응답 분기가 다릅니다.")
    installState(next)
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">원고로 건너뛰기</a>
    <Header project={state.project} busy={busy} dirty={dirty} versionLabel={`기준본 v${state.snapshots.length}`} activeTab={tab} branchName={state.branches.find((branch) => branch.id === state.currentBranchId)?.name ?? "분기 정보 없음"} branchId={state.currentBranchId} head={state.head} onMenu={() => openDrawer("nav")} onNewProject={() => { if (canLeave()) setModal("project") }} onFeedback={() => { if (canLeave()) openDrawer("context") }} onSettings={() => { if (canLeave()) openDrawer("context") }} />
    <nav className="mode-tabs" aria-label="작업 공간">
      {workspaceTabs.map((item, index) => { const Icon = tabIcons[index]; return <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => { if (item !== tab && canLeave()) { setDirty(false); setTab(item) } }}>{Icon ? <Icon /> : null}<span>{item}</span>{item === "개정 검토" && (state.candidates.some((candidate) => candidate.status === "pending") || state.changeSets.some((changeSet) => changeSet.status === "pending")) ? <i /> : null}</button> })}
    </nav>
    <div key={editorEpoch} className="workspace" inert={transitioning} aria-busy={transitioning}>
      <Sidebar project={state.project} busy={busy} projects={state.projects} onProject={(id) => { void switchWorkingProject(id) }} scenes={state.scenes} selectedId={selectedId} open={navOpen} onClose={closeDrawers} onSelect={selectScene} onNewScene={() => setModal("scene")} />
      {tab === "원고" && scene ? <>
        <Editor key={`${state.currentBranchId}:${scene.id}`} scene={scene} draftText={draft?.text} draftStale={draftStale} onRebase={(text) => run(() => mutate(`api/scenes/${scene.id}/draft`, { text, baseSnapshotId }, state.currentBranchId), "초안을 현재 기준본에 명시적으로 연결했습니다.", state.currentBranchId).then(() => undefined)} onDirtyChange={setDirty} busy={busy} onDraft={(text) => run(() => mutate(`api/scenes/${scene.id}/draft`, { text, baseSnapshotId: draftBase }, state.currentBranchId), "작업 초안을 저장했습니다. 기준본은 바뀌지 않았습니다.", state.currentBranchId).then(() => undefined)} onCandidate={(text) => { const branchId = state.currentBranchId; const capturedDraftBase = draftBase; const capturedWorkspaceHash = state.workspaceHash; return run(async () => { const context = await getRevisionContext(branchId); if (context.baseSnapshotId !== capturedDraftBase || context.workspaceHash !== capturedWorkspaceHash) throw new ApiError("STALE_WORKSPACE", "편집을 시작한 기준본이 바뀌었습니다. 입력은 유지됩니다. 현재 기준본을 다시 확인하세요."); const rawScene = context.workspace.scenes.find((item) => item.id === scene.id); if (!rawScene) throw new ApiError("SCENE_MISSING", "현재 기준본에서 장면을 찾을 수 없습니다."); await createChangeSet({ baseSnapshotId: context.baseSnapshotId, baseWorkspaceHash: context.workspaceHash, reason: "직접 편집", changes: [{ kind: "scene", artifactId: rawScene.id, after: { ...rawScene, text } }], feedbackIds: [], atomic: false }, branchId) }, "직접 편집안을 V2 검토 대기열에 추가했습니다.", branchId).then(() => undefined) }} onProtect={(quote) => run(() => mutate(`api/scenes/${scene.id}/protect`, { quote }, state.currentBranchId), "선택한 문장을 보호했습니다.", state.currentBranchId).then(() => undefined)} />
        <ContextPanel key={`${state.currentBranchId}:${scene.id}`} scene={scene} feedback={sceneFeedback} candidates={sceneCandidates}
          changeSets={state.changeSets.filter((changeSet) => changeSet.entries.some((entry) => entry.kind === "scene" && entry.artifactId === scene.id) || changeSet.feedbackIds.some((id) => sceneFeedback.some((feedback) => feedback.id === id)))}
          settings={state.settings} busy={busy} open={contextOpen} onClose={closeDrawers} onDirtyChange={setFeedbackDirty}
          onOpenReview={openRevisionReview} onSubmit={submitFeedback} onCommit={async () => { openRevisionReview() }}
          onRepair={(feedback) => setRepairRequest({ branchId: state.currentBranchId, sceneId: feedback.sceneId, feedbackId: feedback.id, instruction: feedback.text })}
          onReject={(candidate) => run(() => mutate(`api/candidates/${candidate.id}/reject`, {}, state.currentBranchId), "이전 형식 편집안을 거절했습니다.", state.currentBranchId).then(() => undefined)}
          onResolve={(feedback, decision, note) => run(() => mutate(`api/feedback/${feedback.id}/resolve`, { expectedHead: state.head, decision, note }, state.currentBranchId), "피드백 상태를 기록했습니다.", state.currentBranchId).then(() => undefined)} />
      </> : <WorkspaceViews key={`${state.currentBranchId}:${scene?.id ?? "none"}`} tab={tab} scenes={state.scenes} plans={state.plans} runs={state.runs} candidates={state.candidates} changeSets={state.changeSets} workspaceHash={state.workspaceHash} snapshots={state.snapshots} editions={state.editions} head={state.head} busy={busy} branches={state.branches} currentBranchId={state.currentBranchId} onSwitchBranch={switchWorkingBranch} onCreateBranch={createWorkingBranch} onRefresh={reloadWorkspace} onRevisionRefresh={() => refreshRevision(state.currentBranchId)} onPlan={() => setModal("plan")} onNewScene={() => setModal("scene")} onRestore={(snapshot: Snapshot) => run(() => mutate("api/restore", { snapshotId: snapshot.id, expectedHead: state.head }, state.currentBranchId), "선택한 버전을 새 기준본으로 복원했습니다.", state.currentBranchId).then(() => undefined)} onPublished={editionPublished} onScene={selectScene} />}
    </div>
    {notice ? <div className={`toast ${notice.tone}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="알림 닫기">×</button></div> : null}
    {modal ? <EntityDialog kind={modal} busy={busy} onClose={() => setModal(null)} onSubmit={dialogSubmit} /> : null}
    {repairRequest ? <RevisionComposer key={`${repairRequest.branchId}:${repairRequest.feedbackId}`} mode="repair" branchId={repairRequest.branchId}
      initialSceneId={repairRequest.sceneId} initialInstruction={repairRequest.instruction} feedbackIds={[repairRequest.feedbackId]}
      onClose={() => setRepairRequest(null)} onCreated={async () => { await refreshRevision(repairRequest.branchId) }} /> : null}
  </div>
}

function LoadingScreen({ notice, onRetry }: Readonly<{ notice: Notice | null; onRetry: () => void }>) {
  return <main className="loading-screen"><span className="brand-seal large">N</span><p className="overline">NOVAIL EDITORIAL WORKSPACE</p><h1>{notice ? "원고실에 연결할 수 없습니다" : "원고실을 여는 중입니다"}</h1><p>{notice?.text ?? "장면과 기준본을 안전하게 불러오고 있습니다."}</p>{notice ? <button className="button primary" type="button" onClick={onRetry}><RefreshCw /> 다시 연결</button> : <span className="loading-rule" />}</main>
}
