import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical.mjs";
import { artifactKey, artifactValue, projectEntries } from "./workspace.mjs";

const titleFor = (kind, after, before) => after?.title ?? before?.title
  ?? (kind === "layout" ? "Reading order" : "Dependency graph");
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const invalid = (code, message, keys = []) => Object.assign(new Error(message), { code, status: 422, keys });

function changeId(change, before) {
  return `change-${createHash("sha256").update(canonicalJson({ key: artifactKey(change.kind, change.artifactId), before, after: change.after })).digest("hex").slice(0, 20)}`;
}

function structuralChanges(base, changes) {
  const supplied = new Set(changes.map(({ kind }) => kind));
  const sceneChanges = changes.filter(({ kind }) => kind === "scene");
  if (!sceneChanges.some((change) => change.after === null || artifactValue(base, "scene", change.artifactId) === null)) return changes;
  let result = [...changes];
  if (!supplied.has("layout")) {
    const removed = new Set(sceneChanges.filter(({ after }) => after === null).map(({ artifactId }) => artifactId));
    const added = sceneChanges.filter((change) => change.after !== null && artifactValue(base, "scene", change.artifactId) === null).map(({ artifactId }) => artifactId);
    result.push({ kind: "layout", artifactId: "reading-order", after: [...base.layout.filter((id) => !removed.has(id)), ...added] });
  }
  if (!supplied.has("dependencies") && sceneChanges.some(({ after }) => after === null)) {
    const removed = new Set(sceneChanges.filter(({ after }) => after === null).map(({ artifactId }) => artifactId));
    result.push({ kind: "dependencies", artifactId: "dependency-graph",
      after: base.dependencies.filter(({ from, to }) => !removed.has(from) && !removed.has(to)) });
  }
  return result;
}

export function makeEntries(base, changes) {
  const keys = new Set();
  return structuralChanges(base, changes).map((change) => {
    const key = artifactKey(change.kind, change.artifactId);
    if (keys.has(key)) throw Object.assign(new Error("Duplicate artifact change"), { code: "DUPLICATE_CHANGE", status: 422 });
    keys.add(key);
    const before = artifactValue(base, change.kind, change.artifactId);
    return { id: changeId(change, before), key, kind: change.kind, artifactId: change.artifactId,
      title: titleFor(change.kind, change.after, before), before, after: structuredClone(change.after) };
  }).filter(({ before, after }) => !equal(before, after));
}

export function validateWorkspace(base, entries, protectionRequirements = {}) {
  for (const entry of entries) if ((entry.kind === "scene" || entry.kind === "plan")
    && entry.after !== null && entry.after.id !== entry.artifactId) {
    throw invalid("INVALID_ARTIFACT_ID", "Artifact payload ID must match its target.", [entry.key ?? artifactKey(entry.kind, entry.artifactId)]);
  }
  const projected = projectEntries(base, entries);
  const sceneIds = projected.scenes.map(({ id }) => id);
  const planIds = projected.plans.map(({ id }) => id);
  if (new Set(sceneIds).size !== sceneIds.length || new Set(planIds).size !== planIds.length) throw invalid("DUPLICATE_ARTIFACT", "Artifact IDs must be unique");
  if (new Set(projected.layout).size !== projected.layout.length || projected.layout.length !== sceneIds.length
    || projected.layout.some((id) => !sceneIds.includes(id))) throw invalid("INVALID_LAYOUT", "Layout must be an exact scene permutation", ["layout:reading-order"]);
  if (projected.dependencies.some(({ from, to }) => !sceneIds.includes(from) || !sceneIds.includes(to))) throw invalid("INVALID_REFERENCE", "Dependency endpoint is missing", ["dependencies:dependency-graph"]);
  for (const oldScene of base.scenes) {
    const next = projected.scenes.find(({ id }) => id === oldScene.id);
    if (!next && oldScene.protectedQuotes.length) throw invalid("PROTECTED_SCENE", "Protected scenes cannot be deleted", [artifactKey("scene", oldScene.id)]);
    const removed = oldScene.protectedQuotes.find((quote) => !next?.protectedQuotes.includes(quote));
    if (removed) throw invalid("PROTECTED_QUOTE_METADATA", `Protected quote metadata is missing: ${removed}`, [artifactKey("scene", oldScene.id)]);
    const missing = oldScene.protectedQuotes.find((quote) => !next?.text.includes(quote));
    if (missing) throw invalid("PROTECTED_QUOTE", `Protected quote is missing: ${missing}`, [artifactKey("scene", oldScene.id)]);
  }
  for (const scene of projected.scenes) {
    const missing = scene.protectedQuotes.find((quote) => !scene.text.includes(quote));
    if (missing) throw invalid("PROTECTED_QUOTE", `Declared protected quote is missing: ${missing}`, [artifactKey("scene", scene.id)]);
  }
  for (const [key, quotes] of Object.entries(protectionRequirements)) {
    const scene = projected.scenes.find(({ id }) => key === artifactKey("scene", id));
    if (quotes.some((quote) => !scene?.protectedQuotes.includes(quote) || !scene.text.includes(quote))) {
      throw invalid("MERGE_PROTECTION_VIOLATION", "Merge protection requirements are not preserved.", [key]);
    }
  }
  return projected;
}
