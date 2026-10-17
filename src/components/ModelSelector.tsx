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
        setMessage("이 제공자는 모델 목록을 지원하지 않습니다. 사용할 모델 ID를 직접 입력하세요.")
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
      {state.kind === "manual" ? <label className="field-label" id="model-selector-label">실행할 모델 ID
        <input value={value} onChange={(event) => choose(event.target.value)} disabled={disabled} maxLength={200} autoComplete="off" />
      </label> : <label className="field-label" id="model-selector-label">실행할 모델 선택
        <select value={state.kind === "demo" ? "" : value} onChange={(event) => choose(event.target.value)} disabled={disabled || state.kind !== "catalog"}>
          <option value="">{state.kind === "demo" ? "AI가 아닌 로컬 예제" : state.kind === "loading" ? "모델 목록을 불러오는 중" : "모델을 선택하세요"}</option>
          {state.kind === "catalog" ? state.modelIds.map((id) => <option key={id} value={id}>{id}</option>) : null}
        </select>
      </label>}
      {!localDemo ? <button className="button quiet compact" type="button" disabled={disabled || state.kind === "loading"} onClick={() => void load()}><RefreshCw className={state.kind === "loading" ? "spin" : ""} /> 목록 다시 불러오기</button> : null}
    </div>
    {state.kind === "loading" ? <p className="model-selector-status" role="status"><LoaderCircle className="spin" /> 제공자 모델 목록을 확인하고 있습니다.</p> : null}
    {message ? <p className={state.kind === "manual" ? "model-selector-status" : "dialog-error"} role={state.kind === "manual" ? "status" : "alert"}><AlertTriangle /> {message}</p> : null}
    {state.kind === "catalog" && state.modelIds.length === 0 ? <p className="dialog-error" role="alert">사용 가능한 모델이 없습니다. 제공자 설정을 확인한 뒤 다시 불러오세요.</p> : null}
    {state.kind === "catalog" || state.kind === "manual" ? <p className="model-capability-warning"><AlertTriangle /> 목록에는 이미지 전용 모델이 포함될 수 있습니다. 도구 호출, SSE 스트리밍, strict JSON Schema를 지원하는 언어 모델을 선택하세요.</p> : null}
  </section>
}
