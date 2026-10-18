import { Bot, CheckCircle2, CircleStop, Clock3, ExternalLink, LoaderCircle, RotateCw, TerminalSquare, Wrench } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { PublicRuntimeEvent, SafeRunDetail, SafeRunSummary } from "../../packages/execution/contracts.ts"
import { ApiError, cancelRuntimeRun, getRuntimeRun, streamRuntimeEvents } from "../api"
import { isTerminalRunState, mergeRuntimeEvent, shouldStreamRuntimeEvents } from "../runtime-events"
import { RunFailureDiagnostics } from "./RunFailureDiagnostics"

type Props = Readonly<{
  run: SafeRunSummary
  branchId: string
  onUpdated: (run: SafeRunSummary) => void
  onOpenResult: (resultRef: string) => void
}>

const stateLabels: Readonly<Record<string, string>> = {
  queued: "대기 중", running: "실행 중", paused: "일시 정지", awaiting_decision: "검토 대기",
  completed: "완료", cancelled: "취소됨", failed: "실패",
}

export function RuntimeRunDetail(props: Props) {
  const [detail, setDetail] = useState<SafeRunDetail | null>(null)
  const [events, setEvents] = useState<readonly PublicRuntimeEvent[]>([])
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting")
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    let retries = 0
    let replayComplete = false
    setDetail(null); setEvents([]); setError(null); setConnection("connecting"); cursorRef.current = undefined
    const load = async () => {
      try {
        let summary = await getRuntimeRun(props.run.id, props.branchId)
        if (!current) return
        setDetail(summary)
        props.onUpdated(summary)
        while (current && shouldStreamRuntimeEvents(replayComplete, summary.state)) {
          setConnection(retries === 0 ? "live" : "reconnecting")
          try {
            await streamRuntimeEvents({ id: props.run.id, branchId: props.branchId, ...(cursorRef.current === undefined ? {} : { lastEventId: cursorRef.current }), signal: controller.signal, onEvent: (event) => {
              if (!current) return
              cursorRef.current = event.id
              setEvents((existing) => mergeRuntimeEvent(existing, event))
            } })
            replayComplete = true
          } catch (cause: unknown) {
            if (!current) return
            if (cause instanceof ApiError && cause.code === "EVENT_CURSOR_EXPIRED" && cursorRef.current !== undefined) {
              cursorRef.current = undefined
              setEvents([])
              retries = 0
              replayComplete = false
            } else if (retries < 2) {
              retries += 1
              setConnection("reconnecting")
              await new Promise((resolve) => window.setTimeout(resolve, 1200 * retries))
            } else {
              throw cause
            }
          }
          summary = await getRuntimeRun(props.run.id, props.branchId)
          if (!current) return
          setDetail(summary)
          props.onUpdated(summary)
        }
        if (current) setConnection("closed")
      } catch (cause: unknown) {
        if (!current) return
        setConnection("closed")
        setError(cause instanceof Error ? cause.message : "실행 상태를 불러오지 못했습니다.")
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [props.run.id, props.branchId])
  const summary = detail ?? props.run
  const cancel = async () => {
    setCancelling(true); setError(null)
    try { props.onUpdated(await cancelRuntimeRun(summary.id, props.branchId)) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "실행을 취소하지 못했습니다.") }
    finally { setCancelling(false) }
  }
  return <section className="runtime-detail" aria-labelledby="runtime-detail-title">
    <header><div><p className="overline">PUBLIC RUNTIME TRACE</p><h3 id="runtime-detail-title">{stateLabels[summary.state] ?? summary.state}</h3><code>{summary.id}</code>{summary.selectedModel ? <small className="runtime-selected-model">선택 모델 · {summary.selectedModel}</small> : null}{summary.runtime ? <small className="runtime-provenance">실행 출처 · {summary.runtime.name} {summary.runtime.version} · {summary.runtime.mode} · {summary.runtime.modelLabel}</small> : null}</div><span className={`runtime-connection ${connection}`}>{connection === "live" ? <><LoaderCircle className="spin" /> 실시간 연결</> : connection === "reconnecting" ? <><RotateCw className="spin" /> 다시 연결 중</> : <><Clock3 /> 기록됨</>}</span></header>
    <div className="runtime-usage" aria-label="실행 사용량"><span><small>예약 호출</small><strong>{summary.usage.reservedModelCalls}</strong></span><span><small>예약 출력</small><strong>{summary.usage.reservedOutputTokens.toLocaleString("ko-KR")}</strong></span><span><small>입출력 집계</small><strong>{summary.usage.known ? summary.usage.actualKnownTokens.toLocaleString("ko-KR") : "알 수 없음"}</strong></span><span><small>출력 집계</small><strong>{summary.usage.known ? summary.usage.actualOutputTokens.toLocaleString("ko-KR") : "알 수 없음"}</strong></span></div>
    <p className="view-description">{summary.usage.known ? "제공자 보고값과 보수적 추정치를 포함합니다." : "제공자가 사용량을 보고하지 않아 실제 토큰 수를 알 수 없습니다. 예약 한도는 알려진 값으로 유지됩니다."}</p>
    <EventLedger events={events} />
    {summary.error ? <RunFailureDiagnostics run={summary} /> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <footer><span>{new Date(summary.createdAt).toLocaleString("ko-KR")}</span><div>{!isTerminalRunState(summary.state) ? <button className="button quiet" type="button" disabled={cancelling} onClick={() => void cancel()}><CircleStop /> {cancelling ? "취소 요청 중" : "실행 취소"}</button> : null}{summary.resultRef ? <button className="button primary" type="button" onClick={() => props.onOpenResult(summary.resultRef ?? "")}><ExternalLink /> 결과 검토 열기</button> : null}</div></footer>
  </section>
}

function EventLedger({ events }: Readonly<{ events: readonly PublicRuntimeEvent[] }>) {
  if (events.length === 0) return <div className="runtime-event-empty"><TerminalSquare /><p>공개 진행 이벤트를 기다리고 있습니다.</p></div>
  return <ol className="runtime-events">{events.map((event) => <li key={event.id}><span className="runtime-event-marker">{event.type === "runtime.tool.completed" ? <Wrench /> : event.type.startsWith("runtime.model") ? <Bot /> : <CheckCircle2 />}</span><EventBody event={event} /><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString("ko-KR")}</time></li>)}</ol>
}

function EventBody({ event }: Readonly<{ event: PublicRuntimeEvent }>) {
  switch (event.type) {
    case "runtime.started": return <div><strong>런타임 시작</strong><p>{event.details.runtime ? `${event.details.runtime.name} ${event.details.runtime.version} · ${event.details.runtime.modelLabel}` : "선택한 범위와 예산을 고정했습니다."}</p></div>
    case "runtime.model.started": return <div><strong>모델 단계 {event.details.ordinal}</strong><p>응답 생성을 시작했습니다.</p></div>
    case "runtime.model.completed": return <div><strong>모델 단계 {event.details.ordinal} 완료</strong><p>입력 {event.details.tokenUsage.inputTokens?.toLocaleString("ko-KR") ?? "미보고"} · 출력 {event.details.tokenUsage.outputTokens.toLocaleString("ko-KR")} · {event.details.tokenUsage.basis === "provider-reported" ? "제공자 보고" : "추정"}</p></div>
    case "runtime.tool.completed": return <div><strong>읽기 도구 {event.details.outcome}</strong><code>{event.details.toolId}</code></div>
    case "runtime.text.delta": return <div><strong>공개 텍스트</strong><pre>{event.details.text}</pre></div>
    case "runtime.progress.gap": return <div><strong>진행 기록 간격</strong><p>{event.details.from}–{event.details.to} 구간을 표시할 수 없습니다.</p></div>
    case "runtime.progress.truncated": return <div><strong>공개 진행 기록 제한</strong><p>안전한 공개 범위를 넘어선 이벤트는 생략했습니다.</p></div>
    default: { const exhaustive: never = event; return exhaustive }
  }
}
