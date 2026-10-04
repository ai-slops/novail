import { createHash } from "node:crypto";

import { artifactKey } from "./workspace.mjs";

const sorted = (values) => [...values].sort();
const bundleId = (ids) => `bundle-${createHash("sha256").update(sorted(ids).join("\0")).digest("hex").slice(0, 32)}`;

function adjacency(workspaces, mandatoryOnly = false) {
  const graph = new Map();
  for (const workspace of workspaces) for (const edge of workspace.dependencies) {
    if (mandatoryOnly && !edge.mandatory) continue;
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    if (!graph.has(edge.to)) graph.set(edge.to, []);
    graph.get(edge.from).push({ id: edge.to, reason: edge.reason });
    graph.get(edge.to).push({ id: edge.from, reason: edge.reason });
  }
  return graph;
}

function dependencyReasons(graph, starts) {
  const reasons = new Map([...starts].map((id) => [id, new Set(["Changed scene"])]));
  const queue = [...starts];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.get(current) ?? []) {
      if (!reasons.has(edge.id)) {
        reasons.set(edge.id, new Set());
        queue.push(edge.id);
      }
      reasons.get(edge.id).add(edge.reason || `Dependency adjacent to ${current}`);
    }
  }
  return reasons;
}

function addReason(reasons, id, reason) {
  if (!reasons.has(id)) reasons.set(id, new Set());
  reasons.get(id).add(reason);
}

function addLayoutAdjacency(reasons, workspaces, changedIds) {
  for (const [index, workspace] of workspaces.entries()) for (const changedId of changedIds) {
    const position = workspace.layout.indexOf(changedId);
    if (position < 0) continue;
    const label = index === 0 ? "previous" : "proposed";
    for (const id of [workspace.layout[position - 1], workspace.layout[position + 1]].filter(Boolean)) {
      addReason(reasons, id, `Adjacent in ${label} reading order to ${changedId}`);
    }
  }
}

function addEntityReasons(reasons, base, projected, entries) {
  const names = new Set(entries.filter(({ kind }) => kind === "scene")
    .flatMap(({ before, after }) => [...(before?.characters ?? []), ...(after?.characters ?? [])]));
  const scenes = new Map([...base.scenes, ...projected.scenes].map((item) => [item.id, item]));
  for (const current of scenes.values()) for (const name of current.characters) {
    if (names.has(name)) addReason(reasons, current.id, `Shared character: ${name}`);
  }
}

const tokens = (text) => new Set(text.match(/\p{Script=Hangul}{2,}|[\p{L}\p{N}]{3,}/gu) ?? []);

function addPhraseReasons(reasons, base, projected, entries) {
  const phrases = new Set();
  for (const { kind, before, after } of entries) if (kind === "scene") {
    const oldTokens = tokens(before?.text ?? "");
    const newTokens = tokens(after?.text ?? "");
    for (const phrase of oldTokens) if (!newTokens.has(phrase)) phrases.add(phrase);
    for (const phrase of newTokens) if (!oldTokens.has(phrase)) phrases.add(phrase);
  }
  const bounded = sorted(phrases).slice(0, 256);
  const scenes = new Map([...base.scenes, ...projected.scenes].map((item) => [item.id, item]));
  for (const current of scenes.values()) for (const phrase of bounded) {
    if (current.text.includes(phrase)) addReason(reasons, current.id, `Shared changed phrase: ${phrase}`);
  }
  return phrases.size > bounded.length;
}

export function computeImpact(base, projected, entries) {
  const changedKeys = new Set(entries.map(({ kind, artifactId }) => artifactKey(kind, artifactId)));
  const changedScenes = new Set(entries.filter(({ kind }) => kind === "scene").map(({ artifactId }) => artifactId));
  const global = entries.some(({ kind }) => kind !== "scene");
  const reasons = dependencyReasons(adjacency([base, projected]), changedScenes);
  addLayoutAdjacency(reasons, [base, projected], changedScenes);
  addEntityReasons(reasons, base, projected, entries);
  const incomplete = addPhraseReasons(reasons, base, projected, entries);
  if (global) for (const { id } of [...base.scenes, ...projected.scenes]) addReason(reasons, id, "Global plan, graph, or reading-order change");
  const titles = new Map([...base.scenes, ...projected.scenes, ...base.plans, ...projected.plans].map((item) => [item.id, item.title]));
  const reviewKeys = new Set([...reasons.keys()].map((id) => artifactKey("scene", id)));
  for (const entry of entries.filter(({ kind }) => kind !== "scene")) reviewKeys.add(entry.key ?? artifactKey(entry.kind, entry.artifactId));
  const reviewSet = sorted(reviewKeys).map((key) => {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const artifactId = key.slice(separator + 1);
    const changed = changedKeys.has(key);
    const targetReasons = kind === "scene" ? sorted(reasons.get(artifactId) ?? []) : [changed ? "Changed artifact" : "Global context"];
    return { key, kind, artifactId, title: titles.get(artifactId) ?? (kind === "layout" ? "Reading order" : "Dependency graph"),
      reasons: targetReasons, mandatory: true, changed };
  });
  return { reviewSet, rewriteSet: sorted(changedKeys), invalidationSet: sorted(changedKeys), incomplete,
    unexamined: incomplete ? ["changed-phrase-supplement-after-256-phrases"] : [],
    warnings: incomplete ? ["Impact analysis stopped after 256 changed phrases; complete analysis is required before commit."] : [] };
}

export function buildBundles(base, projected, entries, atomic) {
  const ids = entries.map(({ id }) => id).sort();
  if (atomic || entries.some(({ kind }) => kind !== "scene")) return [{ id: bundleId(ids), label: "Atomic workspace update", changeIds: ids }];
  const graph = adjacency([base, projected], true);
  const remaining = new Set(entries.map(({ artifactId }) => artifactId));
  const byScene = new Map(entries.map((entry) => [entry.artifactId, entry.id]));
  const bundles = [];
  while (remaining.size) {
    const start = sorted(remaining)[0];
    const component = sorted(dependencyReasons(graph, new Set([start])).keys()).filter((id) => remaining.has(id));
    for (const id of component) remaining.delete(id);
    const changeIds = component.map((id) => byScene.get(id)).sort();
    bundles.push({ id: bundleId(changeIds), label: `Scene bundle: ${component.join(", ")}`, changeIds });
  }
  return bundles;
}
