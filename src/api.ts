import ky, { HTTPError } from "ky"
import type { BranchSummary, ExportPreview, PublishEditionInput, WorkspaceState, EditionSummary } from "./types"
import { branchSummarySchema, editionSummarySchema, exportPreviewSchema, workspaceSchema, runCompletionSchema } from "./schema"
import { branchHeaders, snapshotExportUrl } from "./api-contract"

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

export async function waitForRun(id: string, branchId: string): Promise<void> {
  try {
    await client.get(`api/runs/${id}/events`, { timeout: 60_000, retry: 0, headers: branchHeaders(branchId) }).text()
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
  }
  const result = runCompletionSchema.parse(await client.get(`api/runs/${id}`, { headers: branchHeaders(branchId) }).json<unknown>())
  if (result.state !== "awaiting_decision") {
    throw new ApiError(result.error?.code ?? "RUN_PENDING", result.error?.message ?? "작업이 아직 완료되지 않았습니다. 버전 기록에서 실행 상태를 확인하세요.")
  }
}
