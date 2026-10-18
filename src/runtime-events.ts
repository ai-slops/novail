import { publicRuntimeEventSchema } from "../packages/execution/contracts.ts"
import type { PublicRuntimeEvent } from "../packages/execution/contracts.ts"

export type SseDecodeResult = Readonly<{
  events: readonly PublicRuntimeEvent[]
  remainder: string
  summaryRefreshRequested: boolean
}>

export function decodeRuntimeEventChunk(remainder: string, chunk: string): SseDecodeResult {
  const source = `${remainder}${chunk}`
  const frames = source.split(/\r?\n\r?\n/)
  const nextRemainder = frames.pop() ?? ""
  let summaryRefreshRequested = false
  const events = frames.flatMap((frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
    if (data.length === 0) return []
    const value: unknown = JSON.parse(data)
    if (typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && !value.type.startsWith("runtime.")) {
      if (value.type === "run.failed") summaryRefreshRequested = true
      return []
    }
    return [publicRuntimeEventSchema.parse(value)]
  })
  return { events, remainder: nextRemainder, summaryRefreshRequested }
}

export function mergeRuntimeEvent(events: readonly PublicRuntimeEvent[], event: PublicRuntimeEvent): readonly PublicRuntimeEvent[] {
  if (events.some((current) => current.id === event.id)) return events
  return [...events, event].toSorted((left, right) => left.sequence - right.sequence)
}

export function isTerminalRunState(state: string): boolean {
  return ["awaiting_decision", "completed", "cancelled", "failed"].includes(state)
}

export function shouldStreamRuntimeEvents(replayComplete: boolean, state: string): boolean {
  return !replayComplete || !isTerminalRunState(state)
}
