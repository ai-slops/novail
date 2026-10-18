import { Bot, Box, Braces, Cpu, RefreshCw, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import type { RuntimeInfo, SafeRunSummary } from "../../packages/execution/contracts.ts"
import { getRuntimeInfo, getRuntimeRuns } from "../api"
import type { Plan, Scene } from "../types"
import { RuntimeComposer } from "./RuntimeComposer"
import { RuntimeRunDetail } from "./RuntimeRunDetail"

type Props = Readonly<{
  branchId: string
  baseSnapshotId: string
  baseWorkspaceHash: string
  scenes: readonly Scene[]
  plans: readonly Plan[]
  onDirtyChange: (dirty: boolean) => void
  onOpenResult: (resultRef: string) => void
}>

const stateLabels: Readonly<Record<string, string>> = { queued: "대기 중", running: "실행 중", paused: "일시 정지", awaiting_decision: "검토 대기", completed: "완료", cancelled: "취소됨", failed: "실패" }

export function RuntimeMonitor(props: Props) {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runs, setRuns] = useState<readonly SafeRunSummary[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [info, history] = await Promise.all([getRuntimeInfo(), getRuntimeRuns(props.branchId)])
      setRuntime(info); setRuns(history); setSelectedId((current) => history.some((run) => run.id === current) ? current : (history[0]?.id ?? ""))
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "런타임 기록을 불러오지 못했습니다.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [props.branchId])
  const updateRun = (run: SafeRunSummary) => setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50))
  const selected = runs.find((run) => run.id === selectedId)
  return <main className="secondary-view runtime-view" id="main-content">
    <header className="view-header"><div><p className="overline">BOUNDED AGENT RUNTIME</p><h2>에이전트 실행</h2><p className="view-description">읽기 전용 맥락으로 수리 제안을 만들고, 공개된 실행 기록을 확인한 뒤 사람이 채택을 결정합니다.</p></div><button className="icon-button" type="button" disabled={loading} onClick={() => void load()} aria-label="런타임과 실행 기록 다시 불러오기"><RefreshCw className={loading ? "spin" : ""} /></button></header>
    {error ? <div className="runtime-load-error" role="alert"><p>{error}</p><button className="button quiet" type="button" onClick={() => void load()}>다시 연결</button></div> : null}
    {runtime ? <>
      <RuntimeIdentity runtime={runtime} />
      <RuntimeComposer runtime={runtime} branchId={props.branchId} baseSnapshotId={props.baseSnapshotId} baseWorkspaceHash={props.baseWorkspaceHash} scenes={props.scenes} plans={props.plans} onDirtyChange={props.onDirtyChange} onCreated={(run) => { updateRun(run); setSelectedId(run.id) }} />
      <div className="runtime-ledger-layout">
        <section className="runtime-history" aria-labelledby="runtime-history-title"><header><div><p className="overline">LATEST 50</p><h3 id="runtime-history-title">실행 기록</h3></div><span>{runs.length.toLocaleString("ko-KR")}</span></header>{runs.length === 0 ? <div className="empty-review"><ShieldCheck /><strong>아직 실행 기록이 없습니다</strong><p>범위와 예산을 정해 첫 수리 제안을 시작하세요.</p></div> : <nav aria-label="최근 에이전트 실행">{runs.map((run) => <button type="button" key={run.id} className={run.id === selectedId ? "active" : ""} onClick={() => setSelectedId(run.id)}><span className={`runtime-state ${run.state}`}>{stateLabels[run.state] ?? run.state}</span><strong>{new Date(run.createdAt).toLocaleString("ko-KR")}</strong><small>호출 {run.usage.reservedModelCalls} · 출력 {run.usage.known ? run.usage.actualOutputTokens.toLocaleString("ko-KR") : "알 수 없음"}</small></button>)}</nav>}</section>
        {selected ? <RuntimeRunDetail key={`${props.branchId}:${selected.id}`} run={selected} branchId={props.branchId} onUpdated={updateRun} onOpenResult={props.onOpenResult} /> : <section className="runtime-detail runtime-detail-empty"><Bot /><h3>실행을 선택하세요</h3><p>이곳에서 공개 텍스트, 모델·도구 단계와 사용량을 확인할 수 있습니다.</p></section>}
      </div>
    </> : loading ? <div className="preview-state" role="status">런타임 정보를 불러오는 중입니다.</div> : null}
  </main>
}

function RuntimeIdentity({ runtime }: Readonly<{ runtime: RuntimeInfo }>) {
  return <section className="runtime-identity" aria-labelledby="runtime-identity-title"><div><p className="overline">CURRENT SERVER CONFIG</p><h3 id="runtime-identity-title"><Cpu /> {runtime.model.label}</h3><p>현재 서버 설정이며 과거 실행의 모델 출처를 뜻하지 않습니다.</p></div><dl><div><dt><Box /> 런타임</dt><dd>{runtime.runtime} {runtime.partVersion}</dd></div><div><dt><Bot /> 모드</dt><dd>{runtime.nonAI ? "AI가 아닌 로컬 예제" : "OpenAI 호환 연결"}</dd></div><div><dt><Braces /> 읽기 도구</dt><dd><details><summary>{runtime.readOnlyToolIds.length}개 허용</summary>{runtime.readOnlyToolIds.map((id) => <code key={id}>{id}</code>)}</details></dd></div></dl></section>
}
