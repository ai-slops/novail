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
  queued: "Queued", running: "Running", paused: "Paused", awaiting_decision: "Awaiting review",
  completed: "Completed", cancelled: "Cancelled", failed: "Failed",
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
        setError(cause instanceof Error ? cause.message : "Could not load run status.")
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [props.run.id, props.branchId])
  const summary = detail ?? props.run
  const cancel = async () => {
    setCancelling(true); setError(null)
    try { props.onUpdated(await cancelRuntimeRun(summary.id, props.branchId)) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not cancel the run.") }
    finally { setCancelling(false) }
  }
  return <section className="runtime-detail" aria-labelledby="runtime-detail-title">
    <header><div><p className="overline">PUBLIC RUNTIME TRACE</p><h3 id="runtime-detail-title">{stateLabels[summary.state] ?? summary.state}</h3><code>{summary.id}</code>
      {summary.selectedModel ? <small className="runtime-selected-model">Selected model · {summary.selectedModel}</small> : null}
      {summary.runtime ? <small className="runtime-provenance">Run provenance · {summary.runtime.name} {summary.runtime.version} · {summary.runtime.mode} · {summary.runtime.modelLabel}</small> : null}
    </div><span className={`runtime-connection ${connection}`}>
      {connection === "live" ? <><LoaderCircle className="spin" /> Live connection</> : connection === "reconnecting" ? <><RotateCw className="spin" /> Reconnecting</> : <><Clock3 /> Recorded</>}
    </span></header>
    <div className="runtime-usage" aria-label="Run usage">
      <span><small>Reserved calls</small><strong>{summary.usage.reservedModelCalls}</strong></span>
      <span><small>Reserved output</small><strong>{summary.usage.reservedOutputTokens.toLocaleString("en-US")}</strong></span>
      <span><small>Known tokens</small><strong>{summary.usage.known ? summary.usage.actualKnownTokens.toLocaleString("en-US") : "Unknown"}</strong></span>
      <span><small>Output tokens</small><strong>{summary.usage.known ? summary.usage.actualOutputTokens.toLocaleString("en-US") : "Unknown"}</strong></span>
    </div>
    <p className="view-description">{summary.usage.known ? "Includes provider-reported values and conservative estimates." : "The provider did not report usage, so actual token counts are unknown. Reserved limits remain known."}</p>
    <EventLedger events={events} />
    {summary.error ? <RunFailureDiagnostics run={summary} /> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <footer><span>{new Date(summary.createdAt).toLocaleString("en-US")}</span><div>
      {!isTerminalRunState(summary.state) ? <button className="button quiet" type="button" disabled={cancelling} onClick={() => void cancel()}><CircleStop /> {cancelling ? "Requesting cancellation" : "Cancel run"}</button> : null}
      {summary.resultRef ? <button className="button primary" type="button" onClick={() => props.onOpenResult(summary.resultRef ?? "")}><ExternalLink /> Open result review</button> : null}
    </div></footer>
  </section>
}

function EventLedger({ events }: Readonly<{ events: readonly PublicRuntimeEvent[] }>) {
  if (events.length === 0) return <div className="runtime-event-empty"><TerminalSquare /><p>Waiting for public progress events.</p></div>
  return <ol className="runtime-events">{events.map((event) => <li key={event.id}><span className="runtime-event-marker">{event.type === "runtime.tool.completed" ? <Wrench /> : event.type.startsWith("runtime.model") ? <Bot /> : <CheckCircle2 />}</span><EventBody event={event} /><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString("en-US")}</time></li>)}</ol>
}

function EventBody({ event }: Readonly<{ event: PublicRuntimeEvent }>) {
  switch (event.type) {
    case "runtime.started": return <div><strong>Runtime started</strong><p>{event.details.runtime ? `${event.details.runtime.name} ${event.details.runtime.version} · ${event.details.runtime.modelLabel}` : "The selected scope and budget were frozen."}</p></div>
    case "runtime.model.started": return <div><strong>Model step {event.details.ordinal}</strong><p>Response generation started.</p></div>
    case "runtime.model.completed": return <div><strong>Model step {event.details.ordinal} completed</strong><p>Input {event.details.tokenUsage.inputTokens?.toLocaleString("en-US") ?? "Not reported"} · Output {event.details.tokenUsage.outputTokens.toLocaleString("en-US")} · {event.details.tokenUsage.basis === "provider-reported" ? "Provider reported" : "Estimated"}</p></div>
    case "runtime.tool.completed": return <div><strong>Read tool {event.details.outcome}</strong><code>{event.details.toolId}</code></div>
    case "runtime.text.delta": return <div><strong>Public text</strong><pre>{event.details.text}</pre></div>
    case "runtime.progress.gap": return <div><strong>Progress record gap</strong><p>Events {event.details.from}–{event.details.to} cannot be displayed.</p></div>
    case "runtime.progress.truncated": return <div><strong>Public progress limit</strong><p>Events beyond the safe public range were omitted.</p></div>
    default: { const exhaustive: never = event; return exhaustive }
  }
}
