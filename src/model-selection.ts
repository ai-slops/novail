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
    ? "The server API key was rejected. Check the key configuration, then reload."
    : "Could not load the model catalog. Check the server connection and try again."
}
