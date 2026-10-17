import { test } from "node:test"
import assert from "node:assert/strict"
import { catalogDefault, modelCatalogErrorMessage, modelSelectionReady } from "./model-selection.ts"

test("catalog default is selected only when available and untouched", () => {
  // Given: a returned default and two catalog entries
  const catalog = { configured: true, defaultModel: "text-model", models: [{ id: "image-model" }, { id: "text-model" }] }

  // When / Then: an untouched empty field adopts it, while a user choice is preserved
  assert.equal(catalogDefault("", false, catalog), "text-model")
  assert.equal(catalogDefault("chosen-model", true, catalog), "chosen-model")
})

test("catalog never guesses the first model or an unavailable default", () => {
  // Given: catalogs without a usable default
  const firstOnly = { configured: true, defaultModel: null, models: [{ id: "first-model" }] }
  const missingDefault = { configured: true, defaultModel: "missing-model", models: [{ id: "other-model" }] }

  // When / Then: selection stays empty
  assert.equal(catalogDefault("", false, firstOnly), "")
  assert.equal(catalogDefault("", false, missingDefault), "")
})

test("configured launch requires a selected model and a usable catalog state", () => {
  // Given / When / Then: loading, failed, empty, and unselected catalogs remain blocked
  assert.equal(modelSelectionReady({ kind: "loading" }, ""), false)
  assert.equal(modelSelectionReady({ kind: "blocked" }, "chosen-model"), false)
  assert.equal(modelSelectionReady({ kind: "catalog", modelIds: [] }, "chosen-model"), false)
  assert.equal(modelSelectionReady({ kind: "catalog", modelIds: ["chosen-model"] }, ""), false)
  assert.equal(modelSelectionReady({ kind: "catalog", modelIds: ["chosen-model"] }, "chosen-model"), true)
})

test("unsupported catalogs permit only an explicit manual model while demo needs none", () => {
  // Given / When / Then: manual fallback and local demo have distinct validity rules
  assert.equal(modelSelectionReady({ kind: "manual" }, ""), false)
  assert.equal(modelSelectionReady({ kind: "manual" }, "manual-model"), true)
  assert.equal(modelSelectionReady({ kind: "demo" }, ""), true)
})

test("catalog failures map to sanitized Korean guidance", () => {
  // Given / When: public error codes are mapped at the UI boundary
  // Then: key failures are actionable and unknown provider text is not reflected
  assert.match(modelCatalogErrorMessage("PROVIDER_KEY_REJECTED"), /키.*확인/u)
  assert.match(modelCatalogErrorMessage("MODEL_CATALOG_FAILED"), /모델 목록/u)
  assert.doesNotMatch(modelCatalogErrorMessage("secret provider response"), /secret provider response/u)
})
