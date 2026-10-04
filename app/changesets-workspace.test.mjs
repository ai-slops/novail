import assert from "node:assert/strict";
import test from "node:test";

import { createSeed } from "./seed.mjs";
import { exportMarkdown } from "./queries.mjs";
import { buildBundles, computeImpact } from "../packages/revision/impact.mjs";
import { canonicalWorkspace, projectEntries, workspaceFromSnapshot, workspaceHash } from "../packages/revision/workspace.mjs";

test("Given unordered records, when workspace is hashed, then semantic order is stable and layout remains significant", () => {
  const state = createSeed();
  const canonical = canonicalWorkspace(state);
  const reordered = { ...canonical, scenes: [...canonical.scenes].reverse(), plans: [...canonical.plans].reverse(), dependencies: [...canonical.dependencies].reverse() };
  assert.equal(workspaceHash(canonical), workspaceHash(reordered));
  assert.notEqual(workspaceHash(canonical), workspaceHash({ ...canonical, layout: [...canonical.layout].reverse() }));
  assert.deepEqual(canonical.layout, state.scenes.map(({ id }) => id));
  assert.deepEqual(canonical.scenes.map(({ id }) => id), [...canonical.layout].sort());
});

test("Given a structural scene deletion, when entries are projected, then layout and graph changes are explicit", () => {
  const base = canonicalWorkspace(createSeed());
  const entries = [
    { kind: "scene", artifactId: "scene-7", after: null },
    { kind: "layout", artifactId: "reading-order", after: base.layout.filter((id) => id !== "scene-7") },
    { kind: "dependencies", artifactId: "dependency-graph", after: base.dependencies.filter((edge) => edge.from !== "scene-7" && edge.to !== "scene-7") },
  ];
  const projected = projectEntries(base, entries);
  assert.equal(projected.scenes.some(({ id }) => id === "scene-7"), false);
  assert.equal(projected.dependencies.some(({ from, to }) => from === "scene-7" || to === "scene-7"), false);
});

test("Given scene changes in connected components, when impact is computed, then bundles and transitive review are deterministic", () => {
  const base = canonicalWorkspace(createSeed());
  const entries = ["scene-7", "scene-9"].map((id) => ({ id: `change-${id}`, kind: "scene", artifactId: id,
    before: base.scenes.find((scene) => scene.id === id), after: { ...base.scenes.find((scene) => scene.id === id), text: `${id} revised` } }));
  const projected = projectEntries(base, entries);
  const bundles = buildBundles(base, projected, entries, false);
  const impact = computeImpact(base, projected, entries);
  assert.deepEqual(bundles.map((bundle) => bundle.changeIds), [["change-scene-7", "change-scene-9"]]);
  assert.ok(impact.reviewSet.some(({ key }) => key === "scene:scene-18"));
  assert.deepEqual(impact.rewriteSet, ["scene:scene-7", "scene:scene-9"]);
});

test("Given Unicode artifact IDs, when canonicalized, then ordering uses locale-independent ordinal comparison", () => {
  const scene = (id) => ({ id, title: id, chapter: 1, status: "canon", text: id, summary: "", storyTime: "",
    characters: [], protectedQuotes: [] });
  const workspace = canonicalWorkspace({ scenes: [scene("ä"), scene("z")], plans: [], dependencies: [], layout: ["ä", "z"] });
  assert.deepEqual(workspace.scenes.map(({ id }) => id), ["z", "ä"]);
});

test("Given snapshot metadata without matching text, when reconstructed, then corruption is rejected rather than invented", () => {
  const snapshot = createSeed().snapshots[0];
  delete snapshot.sceneTexts["scene-7"];
  assert.throws(() => workspaceFromSnapshot(snapshot), ({ code }) => code === "SNAPSHOT_SCENE_MISSING");
});

test("Given a snapshot without a scene manifest, when reconstructed, then missing membership is rejected", () => {
  const snapshot = createSeed().snapshots[0];
  delete snapshot.sceneManifest;
  assert.throws(() => workspaceFromSnapshot(snapshot), ({ code }) => code === "SNAPSHOT_MANIFEST_MISSING");
});

test("Given display chapters that differ from layout, when exported, then layout order is authoritative", () => {
  const state = createSeed();
  state.scenes = [state.scenes[1], state.scenes[0], ...state.scenes.slice(2)];
  const markdown = exportMarkdown(state);
  assert.ok(markdown.indexOf("## 3장.") < markdown.indexOf("## 1장."));
});
