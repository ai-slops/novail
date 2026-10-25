import { Check, Download, GitBranch, Menu, MessageSquareText, Plus, Settings2 } from "lucide-react"
import { snapshotExportUrl } from "../api"
import type { Project, WorkspaceTab } from "../types"
import { workspaceTabLabels } from "../types"

type HeaderProps = Readonly<{
  project: Project
  busy: boolean
  versionLabel: string
  dirty: boolean
  activeTab: WorkspaceTab
  branchName: string
  branchId: string
  head: string
  onMenu: () => void
  onNewProject: () => void
  onFeedback: () => void
  onSettings: () => void
}>

export function Header({ project, busy, versionLabel, dirty, activeTab, branchName, branchId, head, onMenu, onNewProject, onFeedback, onSettings }: HeaderProps) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="Open project explorer"><Menu /></button>
      <div className="brand-lockup" aria-label="NOVAIL">
        <span className="brand-seal">N</span>
        <span className="brand-name">NOVAIL</span>
      </div>
      <div className="breadcrumb" aria-label="Current location">
        <span>{project.title}</span><i>/</i><span className="header-branch" title={`Current branch: ${branchName}`}><GitBranch /> {branchName}</span><i>/</i><strong>{workspaceTabLabels[activeTab]}</strong>
      </div>
      <div className="topbar-actions">
        <span className="saved-state"><Check /> {dirty ? "Unsaved" : "Saved"}</span>
        <span className="revision-label">{versionLabel}</span>
        <button className="button quiet compact" type="button" onClick={onFeedback}><MessageSquareText /> Feedback</button>
        <a className="button quiet compact" href={snapshotExportUrl(head, "markdown", branchId)} download="novail-export.md" aria-disabled={!branchId}><Download /> Export</a>
        <button className="icon-button" type="button" onClick={onSettings} aria-label="View provider configuration status"><Settings2 /></button>
        <button className="button primary compact" type="button" disabled={busy} onClick={onNewProject}><Plus /> New project</button>
      </div>
    </header>
  )
}
