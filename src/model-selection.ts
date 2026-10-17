import type { ProviderModels } from "../packages/execution/contracts.ts"

export type ModelCatalogState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "demo" }>
  | Readonly<{ kind: "catalog"; modelIds: readonly string[] }>
  | Readonly<{ kind: "manual" }>
  | Readonly<{ kind: "blocked" }>

export function catalogDefault(current: string, dirty: boolean, catalog: ProviderModels): string {
  if (dirty || current || catalog.defaultModel === null) return current
  return catalog.models.some(({ id }) => id === catalog.defaultModel) ? catalog.defaultModel : current
}

export function modelSelectionReady(state: ModelCatalogState, model: string): boolean {
  switch (state.kind) {
    case "demo": return true
    case "manual": return model.trim().length > 0
    case "catalog": return state.modelIds.length > 0 && state.modelIds.includes(model)
    case "loading":
    case "blocked": return false
    default: { const exhaustive: never = state; return exhaustive }
  }
}

export function modelCatalogErrorMessage(code: string): string {
  return code === "PROVIDER_KEY_REJECTED"
    ? "서버 API 키가 거부되었습니다. 키 설정을 확인한 뒤 다시 불러오세요."
    : "모델 목록을 불러오지 못했습니다. 서버 연결을 확인하고 다시 시도하세요."
}
