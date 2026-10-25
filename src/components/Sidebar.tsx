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
  const visibleScenes = scenes.filter((scene) => `${scene.title} ${scene.chapter}`.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US")))
  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Projects and scenes">
      <div className="sidebar-head">
        <p className="overline">CURRENT PROJECT</p>
        <div className="project-title-row"><h1>{project.title}</h1></div>
        {projects.length > 1 ? <select className="project-switch" aria-label="Select project" disabled={busy} value={project.id} onChange={(event) => onProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select> : null}
        <p>{project.subtitle}</p>
        <span className="stage-badge">{project.stage}</span>
      </div>
      <div className="sidebar-tools">
        <label className="search-box"><Search /><span className="sr-only">Search scenes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scenes" /></label>
        <button className="icon-button inverse mobile-only" type="button" onClick={onClose} aria-label="Close explorer"><PanelLeftClose /></button>
      </div>
      <nav className="scene-list" aria-label="Scene list">
        <div className="scene-list-heading"><span>Manuscript</span><strong>{scenes.length}</strong></div>
        {visibleScenes.map((scene) => (
          <button key={scene.id} className={`scene-item ${selectedId === scene.id ? "active" : ""}`} type="button" onClick={() => onSelect(scene.id)}>
            <span className="scene-index">{String(scenes.findIndex((item) => item.id === scene.id) + 1).padStart(2, "0")}</span>
            <span className="scene-copy"><strong>{scene.title}</strong><small>{scene.chapter} · {scene.status}</small></span>
            {scene.protectedQuotes.length > 0 ? <LockKeyhole aria-label="Contains protected sentences" /> : <BookOpenText />}
          </button>
        ))}
      </nav>
      <button className="new-scene" type="button" onClick={onNewScene}><FilePlus2 /> New scene</button>
      <footer className="sidebar-footer"><span className="avatar">K</span><span><strong>Seoyun Kim</strong><small>Author · Editing access</small></span></footer>
    </aside>
  )
}
