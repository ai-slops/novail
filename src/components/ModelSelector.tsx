import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ApiError, getProviderModels } from "../api"
import { catalogDefault, modelCatalogErrorMessage, modelSelectionReady } from "../model-selection"
import type { ModelCatalogState } from "../model-selection"

type Props = Readonly<{
  value: string
  disabled: boolean
  localDemo?: boolean
  onChange: (value: string, userInitiated: boolean) => void
  onReadyChange: (ready: boolean) => void
}>

export function ModelSelector({ value, disabled, localDemo = false, onChange, onReadyChange }: Props) {
  const [state, setState] = useState<ModelCatalogState>(localDemo ? { kind: "demo" } : { kind: "loading" })
  const [message, setMessage] = useState<string | null>(null)
  const dirty = useRef(false)
  const request = useRef(0)

  const load = async () => {
    if (localDemo) return
    const currentRequest = ++request.current
    setState({ kind: "loading" })
    setMessage(null)
    try {
      const catalog = await getProviderModels()
      if (currentRequest !== request.current) return
      if (!catalog.configured) {
        setState({ kind: "demo" })
        return
      }
      const modelIds = catalog.models.map(({ id }) => id)
      setState({ kind: "catalog", modelIds })
      const next = catalogDefault(value, dirty.current, catalog)
      if (next !== value) onChange(next, false)
    } catch (cause: unknown) {
      if (currentRequest !== request.current) return
      if (cause instanceof ApiError && cause.code === "MODEL_CATALOG_UNSUPPORTED") {
        setState({ kind: "manual" })
        setMessage("This provider does not support a model catalog. Enter the model ID directly.")
        return
      }
      setState({ kind: "blocked" })
      setMessage(modelCatalogErrorMessage(cause instanceof ApiError ? cause.code : "REQUEST_FAILED"))
    }
  }

  useEffect(() => { void load(); return () => { request.current += 1 } }, [localDemo])
  useEffect(() => onReadyChange(modelSelectionReady(state, value)), [state, value, onReadyChange])

  const choose = (next: string) => {
    dirty.current = true
    onChange(next, true)
  }

  return <section className="model-selector" aria-labelledby="model-selector-label">
    <div className="model-selector-row">
      {state.kind === "manual" ? <label className="field-label" id="model-selector-label">Model ID to run
        <input value={value} onChange={(event) => choose(event.target.value)} disabled={disabled} maxLength={200} autoComplete="off" />
      </label> : <label className="field-label" id="model-selector-label">Select model to run
        <select value={state.kind === "demo" ? "" : value} onChange={(event) => choose(event.target.value)} disabled={disabled || state.kind !== "catalog"}>
          <option value="">{state.kind === "demo" ? "Local example (not AI)" : state.kind === "loading" ? "Loading model catalog" : "Select a model"}</option>
          {state.kind === "catalog" ? state.modelIds.map((id) => <option key={id} value={id}>{id}</option>) : null}
        </select>
      </label>}
      {!localDemo ? <button className="button quiet compact" type="button" disabled={disabled || state.kind === "loading"} onClick={() => void load()}><RefreshCw className={state.kind === "loading" ? "spin" : ""} /> Reload catalog</button> : null}
    </div>
    {state.kind === "loading" ? <p className="model-selector-status" role="status"><LoaderCircle className="spin" /> Checking the provider model catalog.</p> : null}
    {message ? <p className={state.kind === "manual" ? "model-selector-status" : "dialog-error"} role={state.kind === "manual" ? "status" : "alert"}><AlertTriangle /> {message}</p> : null}
    {state.kind === "catalog" && state.modelIds.length === 0 ? <p className="dialog-error" role="alert">No models are available. Check the provider configuration, then reload.</p> : null}
    {state.kind === "catalog" || state.kind === "manual" ? <p className="model-capability-warning"><AlertTriangle /> The catalog may include image-only models. Choose a language model that supports tool calls, SSE streaming, and strict JSON Schema.</p> : null}
  </section>
}
