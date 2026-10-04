import assert from "node:assert/strict";
import test from "node:test";

import { buildBundles, computeImpact } from "../packages/revision/impact.mjs";
import { canonicalWorkspace, projectEntries } from "../packages/revision/workspace.mjs";
import { createSeed } from "./seed.mjs";

const scene = (id, text, characters = []) => ({ id, title: id, chapter: 1, status: "canon", text,
  summary: "", storyTime: "", characters, protectedQuotes: [] });
const entry = (before, after = { ...before, text: `${before.text} revised` }) => ({ id: `change-${before.id}`,
  key: `scene:${before.id}`, kind: "scene", artifactId: before.id, title: before.title, before, after });

test("Given many atomic changes, when bundled, then deterministic ID stays within the shared schema bound", () => {
  const base = canonicalWorkspace(createSeed());
  const entries = Array.from({ length: 12 }, (_, index) => ({ id: `change-${"x".repeat(30)}-${index}`,
    kind: "scene", artifactId: `scene-${index}`, before: null, after: null }));
  const first = buildBundles(base, base, entries, true)[0].id;
  const second = buildBundles(base, base, [...entries].reverse(), true)[0].id;
  assert.equal(first, second);
  assert.ok(first.length <= 200);
});

test("Given a removed two-character Korean clue used remotely, when impact is computed, then the old usage is reviewed", () => {
  const before = scene("scene-origin", "달빛 단서");
  const remote = scene("scene-remote", "먼 결말에서 달빛이 다시 보였다");
  const base = canonicalWorkspace({ scenes: [before, remote], plans: [], dependencies: [], layout: [before.id, remote.id] });
  const entries = [entry(before, { ...before, text: "단서가 사라졌다" })];
  const impact = computeImpact(base, projectEntries(base, entries), entries);
  const target = impact.reviewSet.find(({ artifactId }) => artifactId === remote.id);
  assert.ok(target);
  assert.ok(target.reasons.some((reason) => reason.includes("달빛")));
});

test("Given a changed scene, when layout neighbors differ before and after, then both adjacency sets are reviewed", () => {
  const scenes = [scene("a", "A"), scene("b", "B"), scene("c", "C"), scene("d", "D")];
  const base = canonicalWorkspace({ scenes, plans: [], dependencies: [], layout: ["a", "b", "c", "d"] });
  const entries = [entry(scenes[1]), { id: "layout-change", key: "layout:reading-order", kind: "layout",
    artifactId: "reading-order", title: "order", before: base.layout, after: ["c", "b", "d", "a"] }];
  const impact = computeImpact(base, projectEntries(base, entries), entries);
  for (const id of ["a", "c", "d"]) assert.ok(impact.reviewSet.some(({ artifactId }) => artifactId === id));
  assert.ok(impact.reviewSet.find(({ artifactId }) => artifactId === "d").reasons.some((reason) => reason.includes("Adjacent")));
});

test("Given only a soft dependency between changed scenes, when bundled, then it does not force atomic adoption", () => {
  const state = createSeed();
  const base = canonicalWorkspace(state);
  const entries = [entry(base.scenes.find(({ id }) => id === "scene-3")), entry(base.scenes.find(({ id }) => id === "scene-7"))];
  const bundles = buildBundles(base, projectEntries(base, entries), entries, false);
  assert.equal(bundles.length, 2);
});

test("Given an artifact ID containing a colon, when impact is projected, then the full ID is preserved", () => {
  const original = scene("scene:part:1", "original");
  const base = canonicalWorkspace({ scenes: [original], plans: [], dependencies: [], layout: [original.id] });
  const impact = computeImpact(base, projectEntries(base, [entry(original)]), [entry(original)]);
  assert.equal(impact.reviewSet[0].artifactId, original.id);
});
