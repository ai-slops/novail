import ky, { HTTPError } from "ky"
import type { BranchSummary, ExportPreview, PublishEditionInput, WorkspaceState, EditionSummary } from "./types"
import { branchSummarySchema, editionSummarySchema, exportPreviewSchema, workspaceSchema, runCompletionSchema } from "./schema"
import { branchHeaders } from "./api-contract"
import { changeSetSchema, mergePreviewSchema, revisionContextSchema } from "../packages/revision/contracts.ts"
import type { ChangeSet, MergePreview, RevisionContext } from "../packages/revision/contracts.ts"
import { evaluationReportRequestSchema, evaluationReportSchema, evaluationReportsResponseSchema } from "../packages/revision/evaluation-contracts.ts"
import type { EvaluationReport, EvaluationReportRequest, EvaluationReportsResponse } from "../packages/revision/evaluation-contracts.ts"
import { repairRunSchema } from "../packages/revision/contracts.ts"
import { providerModelsSchema, runtimeInfoSchema, safeRunDetailSchema, safeRunSummarySchema } from "../packages/execution/contracts.ts"
import type { ExecutionBudget, ProviderModels, PublicRuntimeEvent, RuntimeInfo, SafeRunDetail, SafeRunSummary } from "../packages/execution/contracts.ts"
import { decodeRuntimeEventChunk } from "./runtime-events"

export { snapshotExportUrl } from "./api-contract"

const client = ky.create({ timeout: 20_000, retry: { limit: 1, methods: ["get"] } })

export class ApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

const mutationHeaders = (branchId: string): Readonly<Record<string, string>> => ({ "Idempotency-Key": crypto.randomUUID(), ...branchHeaders(branchId) })

const apiError = async (error: HTTPError): Promise<ApiError> => {
  const body: unknown = await error.response.json()
  if (typeof body === "object" && body !== null && "error" in body) {
    const detail = body.error
    if (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string") {
      const code = "code" in detail && typeof detail.code === "string" ? detail.code : "REQUEST_FAILED"
      return new ApiError(code, detail.message)
    }
  }
  return new ApiError("HTTP_ERROR", `요청에 실패했습니다 (${error.response.status}). 다시 시도하세요.`)
}

export const getState = async (branchId?: string): Promise<WorkspaceState> => workspaceSchema.parse(
  await client.get("api/state", branchId === undefined ? {} : { headers: branchHeaders(branchId) }).json<unknown>(),
)

export const mutate = async (path: string, json: Readonly<Record<string, unknown>>, branchId: string): Promise<void> => {
  try {
    await client.post(path, { json, headers: mutationHeaders(branchId) })
  } catch (error: unknown) {
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}

export const mutateJson = async <T>(path: string, json: Readonly<Record<string, unknown>>, branchId: string): Promise<T> => {
  try {
    return await client.post(path, { json, headers: mutationHeaders(branchId) }).json<T>()
  } catch (error: unknown) {
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}

const parseGet = async <T>(path: string, branchId: string, parse: (value: unknown) => T): Promise<T> => {
  try {
    return parse(await client.get(path, { headers: branchHeaders(branchId) }).json<unknown>())
  } catch (error: unknown) {
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}

export const getRevisionContext = (branchId: string): Promise<RevisionContext> => parseGet("api/revision-context", branchId, (value) => revisionContextSchema.parse(value))

export const createChangeSet = async (input: Readonly<Record<string, unknown>>, branchId: string): Promise<ChangeSet> => changeSetSchema.parse(await mutateJson<unknown>("api/change-sets", input, branchId))

export const deriveChangeSet = async (id: string, changeIds: readonly string[], branchId: string): Promise<ChangeSet> => changeSetSchema.parse(await mutateJson<unknown>(`api/change-sets/${encodeURIComponent(id)}/derive`, { changeIds }, branchId))

export const promoteCandidate = async (id: string, expectedHead: string, branchId: string): Promise<ChangeSet> => changeSetSchema.parse(await mutateJson<unknown>(`api/candidates/${encodeURIComponent(id)}/promote`, { expectedHead }, branchId))

export const createMergePreview = async (input: Readonly<Record<string, unknown>>, branchId: string): Promise<MergePreview> => mergePreviewSchema.parse(await mutateJson<unknown>("api/merge-previews", input, branchId))

export const sealMergePreview = async (id: string, input: Readonly<Record<string, unknown>>, branchId: string): Promise<ChangeSet> => changeSetSchema.parse(await mutateJson<unknown>(`api/merge-previews/${encodeURIComponent(id)}/seal`, input, branchId))

export const getEvaluationReports = (changeSetId: string, branchId: string): Promise<EvaluationReportsResponse> => parseGet(
  `api/change-sets/${encodeURIComponent(changeSetId)}/evaluation-reports`,
  branchId,
  (value) => evaluationReportsResponseSchema.parse(value),
)

export const createEvaluationReport = async (changeSetId: string, input: EvaluationReportRequest, branchId: string): Promise<EvaluationReport> => {
  const validated = evaluationReportRequestSchema.safeParse(input)
  if (!validated.success) throw validated.error
  return evaluationReportSchema.parse(await mutateJson<unknown>(`api/change-sets/${encodeURIComponent(changeSetId)}/evaluation-reports`, input, branchId))
}

export const editionExportUrl = (editionId: string, format: "markdown" | "docx" | "manifest") => `/api/editions/${encodeURIComponent(editionId)}/export?format=${format}`

export const getExportPreview = async (snapshotId: string, branchId: string): Promise<ExportPreview> => exportPreviewSchema.parse(
  await client.get("api/export-preview", { searchParams: { snapshotId }, headers: branchHeaders(branchId) }).json<unknown>(),
)

export const publishEdition = async (input: PublishEditionInput, branchId: string): Promise<EditionSummary> => {
  try {
    const response: unknown = await client.post("api/editions", { json: input, headers: mutationHeaders(branchId) }).json<unknown>()
    return editionSummarySchema.parse(response)
  } catch (error: unknown) {
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}

export const createBranch = async (input: Readonly<{ name: string; sourceSnapshotId: string; expectedBranchId: string; expectedHead: string }>): Promise<BranchSummary> => (
  branchSummarySchema.parse(await mutateJson<unknown>("api/branches", input, input.expectedBranchId))
)

export const switchBranch = async (id: string, expectedBranchId: string, expectedHead: string): Promise<WorkspaceState> => (
  workspaceSchema.parse(await mutateJson<unknown>(`api/branches/${encodeURIComponent(id)}/switch`, { expectedBranchId, expectedHead }, expectedBranchId))
)

export async function waitForRun(id: string, branchId: string): Promise<string | undefined> {
  try {
    await client.get(`api/runs/${id}/events`, { timeout: 60_000, retry: 0, headers: branchHeaders(branchId) }).text()
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
  }
  const result = runCompletionSchema.parse(await client.get(`api/runs/${id}`, { headers: branchHeaders(branchId) }).json<unknown>())
  if (result.state === "cancelled") throw new ApiError("RUN_CANCELLED", "작업을 취소했습니다. 이미 진행된 외부 호출 비용은 발생할 수 있습니다.")
  if (result.state !== "awaiting_decision") {
    throw new ApiError(result.error?.code ?? "RUN_PENDING", result.error?.message ?? "작업이 아직 완료되지 않았습니다. 버전 기록에서 실행 상태를 확인하세요.")
  }
  return result.resultRef ?? undefined
}

export type RepairRunInput = Readonly<{
  baseSnapshotId: string
  baseWorkspaceHash: string
  instruction: string
  sceneIds: readonly string[]
  planIds: readonly string[]
  feedbackIds: readonly string[]
  budget: ExecutionBudget
  model?: string
}>

export const getProviderModels = async (): Promise<ProviderModels> => {
  try {
    return providerModelsSchema.parse(await client.get("api/provider/models").json<unknown>())
  } catch (error: unknown) {
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}

export const getRuntimeInfo = async (): Promise<RuntimeInfo> => runtimeInfoSchema.parse(
  await client.get("api/runtime-info").json<unknown>(),
)

export const getRuntimeRuns = (branchId: string): Promise<readonly SafeRunSummary[]> => parseGet(
  "api/runs?limit=50",
  branchId,
  (value) => safeRunSummarySchema.array().parse(value),
)

export const getRuntimeRun = (id: string, branchId: string): Promise<SafeRunDetail> => parseGet(
  `api/runs/${encodeURIComponent(id)}`,
  branchId,
  (value) => safeRunDetailSchema.parse(value),
)

export const createRepairRun = async (input: RepairRunInput, branchId: string): Promise<SafeRunSummary> => {
  const validated = repairRunSchema.parse(input)
  return safeRunSummarySchema.parse(await mutateJson<unknown>("api/repair-runs", validated, branchId))
}

export const cancelRuntimeRun = async (id: string, branchId: string): Promise<SafeRunSummary> => safeRunSummarySchema.parse(
  await mutateJson<unknown>(`api/runs/${encodeURIComponent(id)}/cancel`, {}, branchId),
)

export type RuntimeStreamOptions = Readonly<{
  id: string
  branchId: string
  lastEventId?: string
  signal: AbortSignal
  onEvent: (event: PublicRuntimeEvent) => void
}>

export async function streamRuntimeEvents(options: RuntimeStreamOptions): Promise<void> {
  const headers = options.lastEventId === undefined
    ? branchHeaders(options.branchId)
    : { ...branchHeaders(options.branchId), "Last-Event-ID": options.lastEventId }
  try {
    const response = await client.get(`api/runs/${encodeURIComponent(options.id)}/events`, {
      headers,
      retry: 0,
      signal: options.signal,
      timeout: false,
    })
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError("STREAM_UNAVAILABLE", "이 브라우저에서는 실행 진행 스트림을 열 수 없습니다.")
    const decoder = new TextDecoder()
    let remainder = ""
    while (!options.signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      const decoded = decodeRuntimeEventChunk(remainder, decoder.decode(chunk.value, { stream: true }))
      remainder = decoded.remainder
      for (const event of decoded.events) options.onEvent(event)
    }
  } catch (error: unknown) {
    if (options.signal.aborted && error instanceof Error && error.name === "AbortError") return
    if (error instanceof HTTPError) throw await apiError(error)
    throw error
  }
}
