import { BookOpenText, FilePlus2, LockKeyhole, PanelLeftClose, Search } from "lucide-react"
import { useState } from "react"
import type { Project, Scene } from "../types"

type SidebarProps = Readonly<{
  project: Project
  busy: boolean
  projects: readonly Project[]
  onProject: (id: string) => void
  scenes: readonly Scene[]
  selectedId: string
  open: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onNewScene: () => void
}>

export function Sidebar({ project, busy, projects, onProject, scenes, selectedId, open, onClose, onSelect, onNewScene }: SidebarProps) {
  const [query, setQuery] = useState("")
  const visibleScenes = scenes.filter((scene) => `${scene.title} ${scene.chapter}`.toLocaleLowerCase("ko-KR").includes(query.toLocaleLowerCase("ko-KR")))
  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="프로젝트와 장면">
      <div className="sidebar-head">
        <p className="overline">현재 프로젝트</p>
        <div className="project-title-row"><h1>{project.title}</h1></div>
        {projects.length > 1 ? <select className="project-switch" aria-label="작품 선택" disabled={busy} value={project.id} onChange={(event) => onProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}
        <p>{project.subtitle}</p>
        <span className="stage-badge">{project.stage}</span>
      </div>
      <div className="sidebar-tools">
        <label className="search-box"><Search /><span className="sr-only">장면 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="장면 검색" /></label>
        <button className="icon-button inverse mobile-only" type="button" onClick={onClose} aria-label="탐색 닫기"><PanelLeftClose /></button>
      </div>
      <nav className="scene-list" aria-label="장면 목록">
        <div className="scene-list-heading"><span>원고</span><strong>{scenes.length}</strong></div>
        {visibleScenes.map((scene) => (
          <button key={scene.id} className={`scene-item ${selectedId === scene.id ? "active" : ""}`} type="button" onClick={() => onSelect(scene.id)}>
            <span className="scene-index">{String(scenes.findIndex((item) => item.id === scene.id) + 1).padStart(2, "0")}</span>
            <span className="scene-copy"><strong>{scene.title}</strong><small>{scene.chapter} · {scene.status}</small></span>
            {scene.protectedQuotes.length > 0 ? <LockKeyhole aria-label="보호 문장 있음" /> : <BookOpenText />}
          </button>
        ))}
      </nav>
      <button className="new-scene" type="button" onClick={onNewScene}><FilePlus2 /> 새 장면</button>
      <footer className="sidebar-footer"><span className="avatar">김</span><span><strong>김서윤</strong><small>작가 · 편집 권한</small></span></footer>
    </aside>
  )
}
