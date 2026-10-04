import { Check, Download, GitBranch, Menu, MessageSquareText, Plus, Settings2 } from "lucide-react"
import { snapshotExportUrl } from "../api"
import type { Project, WorkspaceTab } from "../types"

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
      <button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="프로젝트 탐색 열기"><Menu /></button>
      <div className="brand-lockup" aria-label="NOVAIL">
        <span className="brand-seal">N</span>
        <span className="brand-name">NOVAIL</span>
      </div>
      <div className="breadcrumb" aria-label="현재 위치">
        <span>{project.title}</span><i>/</i><span className="header-branch" title={`현재 분기: ${branchName}`}><GitBranch /> {branchName}</span><i>/</i><strong>{activeTab}</strong>
      </div>
      <div className="topbar-actions">
        <span className="saved-state"><Check /> {dirty ? "저장 전" : "저장됨"}</span>
        <span className="revision-label">{versionLabel}</span>
        <button className="button quiet compact" type="button" onClick={onFeedback}><MessageSquareText /> 피드백</button>
        <a className="button quiet compact" href={snapshotExportUrl(head, "markdown", branchId)} download="novail-export.md" aria-disabled={!branchId}><Download /> 내보내기</a>
        <button className="icon-button" type="button" onClick={onSettings} aria-label="제공자 설정 상태 보기"><Settings2 /></button>
        <button className="button primary compact" type="button" disabled={busy} onClick={onNewProject}><Plus /> 새 프로젝트</button>
      </div>
    </header>
  )
}
