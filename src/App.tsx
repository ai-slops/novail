import { BookOpenText, Bot, Columns3, History, ListTree, RefreshCw, ScanSearch } from "lucide-react"
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
import { workspaceTabLabels, workspaceTabs } from "./types"

const tabIcons = [BookOpenText, Columns3, ListTree, ScanSearch, Bot, History] as const

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
  const [reviewTargetId, setReviewTargetId] = useState<string | undefined>(undefined)
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
  const canLeave = () => !(dirty || feedbackDirty) || window.confirm("You have unsaved manuscript, feedback, or evaluation changes. Leave without saving?")
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
    if (expectedBranchId !== undefined && next.currentBranchId !== expectedBranchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "The branch that started this request differs from the server's current branch. Reload state to recover safely.")
    installState(next)
    return true
  }
  useEffect(() => { refresh().catch(showError) }, [])

  const showError = (error: unknown) => {
    const text = error instanceof ApiError ? error.message : "Could not load the workspace. Try again shortly."
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
  const openRuntimeResult = async (resultRef: string) => {
    if (!canLeave()) return
    try {
      await refreshRevision(state.currentBranchId)
      if (!stateRef.current?.changeSets.some((changeSet) => changeSet.id === resultRef)) throw new ApiError("RESULT_NOT_FOUND", "The run result was not found in this branch's V2 review list.")
      setDirty(false); setReviewTargetId(resultRef); setTab("개정 검토"); closeDrawers()
    } catch (error: unknown) { showError(error) }
  }
  const submitFeedback = async (text: string, scope: string): Promise<boolean> => {
    if (!scene) return false
    const branchId = state.currentBranchId
    let feedbackId = ""
    const saved = await run(async () => {
      feedbackId = createdIdSchema.parse(await mutateJson<unknown>("api/feedback", { sceneId: scene.id, text, scope }, branchId)).id
    }, "Feedback saved. Select the actual revision scope.", branchId)
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
          if (next.project.id !== created.id || next.currentBranchId !== created.currentBranchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "The project was created, but the working copy changed in another window. Reload the workspace.")
          return next
        }, "New project created.")
        break
      case "scene":
        saved = await run(() => mutate("api/scenes", { title: primary, text: secondary }, branchId), "New item saved.", branchId)
        break
      case "plan":
        saved = await run(() => mutate("api/plans", { title: primary, kind: "story", description: secondary }, branchId), "New item saved.", branchId)
        break
      case null: return
      default: { const exhaustive: never = modal; return exhaustive }
    }
    if (saved) setModal(null)
  }
  const editionPublished = (edition: EditionSummary, branchId: string) => {
    if (stateRef.current?.currentBranchId !== branchId || stateRef.current.project.id !== state.project.id) return
    setState((current) => current?.currentBranchId === branchId ? { ...current, editions: current.editions.some((item) => item.id === edition.id) ? current.editions : [...current.editions, edition] } : current)
    setNotice({ tone: "success", text: `Published edition “${edition.title}.” Previous editions and the source snapshot remain unchanged.` })
    void refresh(branchId).catch(showError)
  }

  const switchWorkingBranch = async (id: string) => {
    if (busy || id === state.currentBranchId) return
    if (!canLeave()) return
    const expectedBranchId = state.currentBranchId
    const expectedHead = state.head
    await transitionWorkspace(async () => {
      const next = await switchBranch(id, expectedBranchId, expectedHead)
      if (next.currentBranchId !== id) throw new ApiError("BRANCH_SWITCH_MISMATCH", "The server returned a different branch from the one requested. Reload the workspace.")
      return next
    }, "Working branch switched.")
  }

  const switchWorkingProject = async (id: string) => {
    if (busy || id === state.project.id || !canLeave()) return
    const branchId = state.currentBranchId
    await transitionWorkspace(async () => {
      const next = workspaceSchema.parse(await mutateJson<unknown>(`api/projects/${encodeURIComponent(id)}/switch`, {}, branchId))
      if (next.project.id !== id) throw new ApiError("PROJECT_SCOPE_CHANGED", "The requested project does not match the response. Reload the workspace.")
      return next
    }, "Project switched.")
  }

  const createWorkingBranch = async (name: string, sourceSnapshotId: string): Promise<boolean> => {
    const expectedBranchId = state.currentBranchId
    const expectedHead = state.head
    return run(async () => { await createBranch({ name, sourceSnapshotId, expectedBranchId, expectedHead }) }, "New branch created. The current branch remains active.", expectedBranchId)
  }

  const reloadWorkspace = async () => {
    if (!canLeave()) return
    setBusy(true); setNotice(null)
    try {
      const applied = await refresh()
      if (applied) { setEditorEpoch((epoch) => epoch + 1); setDirty(false); setNotice({ tone: "success", text: "Reloaded the server's current branch state." }) }
    } catch (error: unknown) { showError(error) } finally { setBusy(false) }
  }
  const refreshRevision = async (branchId: string): Promise<void> => {
    if (stateRef.current?.currentBranchId !== branchId) return
    const sequence = ++requestSequence.current
    const next = await getState(branchId)
    if (sequence !== requestSequence.current || stateRef.current?.currentBranchId !== branchId) return
    if (next.currentBranchId !== branchId) throw new ApiError("BRANCH_SCOPE_CHANGED", "The response branch differs from the branch where the revision started.")
    installState(next)
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to manuscript</a>
    <Header
      project={state.project}
      busy={busy}
      dirty={dirty}
      versionLabel={`Canonical v${state.snapshots.length}`}
      activeTab={tab}
      branchName={state.branches.find((branch) => branch.id === state.currentBranchId)?.name ?? "Branch unavailable"}
      branchId={state.currentBranchId}
      head={state.head}
      onMenu={() => openDrawer("nav")}
      onNewProject={() => { if (canLeave()) setModal("project") }}
      onFeedback={() => { if (canLeave()) openDrawer("context") }}
      onSettings={() => { if (canLeave()) openDrawer("context") }}
    />
    <nav className="mode-tabs" aria-label="Workspace">
      {workspaceTabs.map((item, index) => { const Icon = tabIcons[index]; return <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => { if (item !== tab && canLeave()) { setDirty(false); setTab(item) } }}>{Icon ? <Icon /> : null}<span>{workspaceTabLabels[item]}</span>{item === "개정 검토" && (state.candidates.some((candidate) => candidate.status === "pending") || state.changeSets.some((changeSet) => changeSet.status === "pending")) ? <i /> : null}</button> })}
    </nav>
    <div key={editorEpoch} className="workspace" inert={transitioning} aria-busy={transitioning}>
      <Sidebar project={state.project} busy={busy} projects={state.projects} onProject={(id) => { void switchWorkingProject(id) }} scenes={state.scenes} selectedId={selectedId} open={navOpen} onClose={closeDrawers} onSelect={selectScene} onNewScene={() => setModal("scene")} />
      {tab === "원고" && scene ? <>
        <Editor
          key={`${state.currentBranchId}:${scene.id}`}
          scene={scene}
          draftText={draft?.text}
          draftStale={draftStale}
          onRebase={(text) => run(
            () => mutate(`api/scenes/${scene.id}/draft`, { text, baseSnapshotId }, state.currentBranchId),
            "Draft explicitly linked to the current canonical text.",
            state.currentBranchId,
          ).then(() => undefined)}
          onDirtyChange={setDirty}
          busy={busy}
          onDraft={(text) => run(
            () => mutate(`api/scenes/${scene.id}/draft`, { text, baseSnapshotId: draftBase }, state.currentBranchId),
            "Working draft saved. The canonical text was not changed.",
            state.currentBranchId,
          ).then(() => undefined)}
          onCandidate={(text) => {
            const branchId = state.currentBranchId
            const capturedDraftBase = draftBase
            const capturedWorkspaceHash = state.workspaceHash
            return run(async () => {
              const context = await getRevisionContext(branchId)
              if (context.baseSnapshotId !== capturedDraftBase || context.workspaceHash !== capturedWorkspaceHash) {
                throw new ApiError("STALE_WORKSPACE", "The canonical text changed after editing began. Your input is preserved. Review the current canonical text.")
              }
              const rawScene = context.workspace.scenes.find((item) => item.id === scene.id)
              if (!rawScene) throw new ApiError("SCENE_MISSING", "The scene was not found in the current canonical text.")
              await createChangeSet({
                baseSnapshotId: context.baseSnapshotId,
                baseWorkspaceHash: context.workspaceHash,
                reason: "Direct edit",
                changes: [{ kind: "scene", artifactId: rawScene.id, after: { ...rawScene, text } }],
                feedbackIds: [],
                atomic: false,
              }, branchId)
            }, "Direct edit added to the V2 review queue.", branchId).then(() => undefined)
          }}
          onProtect={(quote) => run(
            () => mutate(`api/scenes/${scene.id}/protect`, { quote }, state.currentBranchId),
            "Selected sentence protected.",
            state.currentBranchId,
          ).then(() => undefined)}
        />
        <ContextPanel key={`${state.currentBranchId}:${scene.id}`} scene={scene} feedback={sceneFeedback} candidates={sceneCandidates}
          changeSets={state.changeSets.filter((changeSet) => changeSet.entries.some((entry) => entry.kind === "scene" && entry.artifactId === scene.id) || changeSet.feedbackIds.some((id) => sceneFeedback.some((feedback) => feedback.id === id)))}
          settings={state.settings} busy={busy} open={contextOpen} onClose={closeDrawers} onDirtyChange={setFeedbackDirty}
          onOpenReview={openRevisionReview} onSubmit={submitFeedback} onCommit={async () => { openRevisionReview() }}
          onRepair={(feedback) => setRepairRequest({ branchId: state.currentBranchId, sceneId: feedback.sceneId, feedbackId: feedback.id, instruction: feedback.text })}
          onReject={(candidate) => run(() => mutate(`api/candidates/${candidate.id}/reject`, {}, state.currentBranchId), "Legacy edit rejected.", state.currentBranchId).then(() => undefined)}
          onResolve={(feedback, decision, note) => run(() => mutate(`api/feedback/${feedback.id}/resolve`, { expectedHead: state.head, decision, note }, state.currentBranchId), "Feedback status recorded.", state.currentBranchId).then(() => undefined)} />
      </> : <WorkspaceViews
        key={`${state.currentBranchId}:${scene?.id ?? "none"}`}
        tab={tab}
        scenes={state.scenes}
        plans={state.plans}
        runs={state.runs}
        candidates={state.candidates}
        changeSets={state.changeSets}
        workspaceHash={state.workspaceHash}
        snapshots={state.snapshots}
        editions={state.editions}
        head={state.head}
        busy={busy}
        branches={state.branches}
        currentBranchId={state.currentBranchId}
        selectedChangeSetId={reviewTargetId}
        onOpenRuntimeResult={openRuntimeResult}
        onSwitchBranch={switchWorkingBranch}
        onCreateBranch={createWorkingBranch}
        onRefresh={reloadWorkspace}
        onRevisionRefresh={() => refreshRevision(state.currentBranchId)}
        onDirtyChange={setDirty}
        onBeforeDiscard={canLeave}
        onPlan={() => setModal("plan")}
        onNewScene={() => setModal("scene")}
        onRestore={(snapshot: Snapshot) => run(
          () => mutate("api/restore", { snapshotId: snapshot.id, expectedHead: state.head }, state.currentBranchId),
          "Selected version restored as the new canonical text.",
          state.currentBranchId,
        ).then(() => undefined)}
        onPublished={editionPublished}
        onScene={selectScene}
      />}
    </div>
    {notice ? <div className={`toast ${notice.tone}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Close notification">×</button></div> : null}
    {modal ? <EntityDialog kind={modal} busy={busy} onClose={() => setModal(null)} onSubmit={dialogSubmit} /> : null}
    {repairRequest ? <RevisionComposer key={`${repairRequest.branchId}:${repairRequest.feedbackId}`} mode="repair" branchId={repairRequest.branchId}
      initialSceneId={repairRequest.sceneId} initialInstruction={repairRequest.instruction} feedbackIds={[repairRequest.feedbackId]}
      onClose={() => setRepairRequest(null)} onCreated={async () => { await refreshRevision(repairRequest.branchId) }} /> : null}
  </div>
}

function LoadingScreen({ notice, onRetry }: Readonly<{ notice: Notice | null; onRetry: () => void }>) {
  return <main className="loading-screen"><span className="brand-seal large">N</span><p className="overline">NOVAIL EDITORIAL WORKSPACE</p><h1>{notice ? "Could not connect to the writing room" : "Opening the writing room"}</h1><p>{notice?.text ?? "Loading scenes and canonical text safely."}</p>{notice ? <button className="button primary" type="button" onClick={onRetry}><RefreshCw /> Reconnect</button> : <span className="loading-rule" />}</main>
}
