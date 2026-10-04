import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical.mjs";

const ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const byId = (left, right) => ordinal(left.id, right.id);
const edgeKey = (edge) => `${edge.from}\0${edge.to}\0${edge.type}\0${edge.reason}\0${edge.mandatory}`;

export function canonicalWorkspace(state) {
  const scenes = structuredClone(state.scenes ?? []).sort(byId);
  const plans = structuredClone(state.plans ?? []).sort(byId);
  const dependencies = structuredClone(state.dependencies ?? []).sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
  const layout = structuredClone(state.layout ?? (state.scenes ?? []).map(({ id }) => id));
  return { layout, scenes, plans, dependencies };
}

export const workspaceHash = (state) => createHash("sha256")
  .update(canonicalJson(canonicalWorkspace(state)))
  .digest("hex");

export const artifactKey = (kind, id) => `${kind}:${id}`;

export function artifactValue(workspace, kind, id) {
  if (kind === "scene") return structuredClone(workspace.scenes.find((item) => item.id === id) ?? null);
  if (kind === "plan") return structuredClone(workspace.plans.find((item) => item.id === id) ?? null);
  if (kind === "dependencies") return structuredClone(workspace.dependencies);
  if (kind === "layout") return structuredClone(workspace.layout);
  return null;
}

export function projectEntries(base, entries) {
  const workspace = canonicalWorkspace(base);
  for (const entry of entries) {
    if (entry.kind === "scene" || entry.kind === "plan") {
      const collection = entry.kind === "scene" ? workspace.scenes : workspace.plans;
      const index = collection.findIndex(({ id }) => id === entry.artifactId);
      if (entry.after === null && index >= 0) collection.splice(index, 1);
      else if (entry.after !== null && index >= 0) collection[index] = structuredClone(entry.after);
      else if (entry.after !== null) collection.push(structuredClone(entry.after));
      collection.sort(byId);
    } else if (entry.kind === "dependencies") workspace.dependencies = structuredClone(entry.after).sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
    else if (entry.kind === "layout") workspace.layout = structuredClone(entry.after);
  }
  return workspace;
}

export function installWorkspace(state, workspace) {
  const scenes = new Map(workspace.scenes.map((scene) => [scene.id, structuredClone(scene)]));
  state.scenes = workspace.layout.map((id) => scenes.get(id));
  state.plans = structuredClone(workspace.plans);
  state.dependencies = structuredClone(workspace.dependencies);
  state.contextVersion = (state.contextVersion ?? 0) + 1;
}

export function workspaceFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot.sceneManifest)) {
    throw Object.assign(new Error("Snapshot scene manifest is missing"), { code: "SNAPSHOT_MANIFEST_MISSING", status: 409 });
  }
  const contextKnown = snapshot.narrativeContext !== undefined;
  const scenes = snapshot.sceneManifest.map((metadata) => {
    if (typeof snapshot.sceneTexts?.[metadata.id] !== "string") {
      throw Object.assign(new Error(`Snapshot scene text is missing: ${metadata.id}`), { code: "SNAPSHOT_SCENE_MISSING", status: 409 });
    }
    return { ...structuredClone(metadata), text: snapshot.sceneTexts[metadata.id] };
  });
  return {
    workspace: canonicalWorkspace({
      scenes,
      plans: snapshot.narrativeContext?.plans ?? [],
      dependencies: snapshot.narrativeContext?.dependencies ?? [],
      layout: scenes.map(({ id }) => id),
    }),
    contextKnown,
  };
}
