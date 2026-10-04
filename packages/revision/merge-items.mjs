import { canonicalJson } from '../domain/canonical.mjs';
import { DomainError } from '../../app/errors.mjs';
import { changeInputSchema } from './contracts.ts';
import { artifactKey, artifactValue, canonicalWorkspace } from './workspace.mjs';

const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sceneComparable = (value) => value === null ? null : { ...value, protectedQuotes: [] };
const sceneIds = (workspace) => workspace.scenes.map(({ id }) => id);

function itemTitle(kind, artifactId, source, target, base) {
  if (kind === 'scene' || kind === 'plan') return source?.title ?? target?.title ?? base?.title ?? artifactId;
  if (kind === 'dependencies') return '의존성 그래프';
  return '읽기 순서';
}

function sceneItem(artifactId, baseWorkspace, sourceWorkspace, targetWorkspace, baseKnown) {
  const base = baseKnown ? artifactValue(baseWorkspace, 'scene', artifactId) : null;
  const source = artifactValue(sourceWorkspace, 'scene', artifactId);
  const target = artifactValue(targetWorkspace, 'scene', artifactId);
  const sourceChanged = !baseKnown || !equal(sceneComparable(source), sceneComparable(base));
  const targetChanged = !baseKnown || !equal(sceneComparable(target), sceneComparable(base));
  const semanticEqual = equal(sceneComparable(source), sceneComparable(target));
  const protections = [...new Set([...(base?.protectedQuotes ?? []), ...(source?.protectedQuotes ?? []), ...(target?.protectedQuotes ?? [])])].sort();
  const protectionIncoming = !protections.every((quote) => target?.protectedQuotes?.includes(quote));
  if (semanticEqual && !protectionIncoming) return null;
  if (baseKnown && !sourceChanged && targetChanged && !protectionIncoming) return null;
  const conflict = !baseKnown || (sourceChanged && targetChanged && !semanticEqual);
  return {
    key: artifactKey('scene', artifactId), kind: 'scene', artifactId,
    title: itemTitle('scene', artifactId, source, target, base), baseKnown, base, source, target,
    conflict, reason: conflict ? (baseKnown ? 'both-changed' : 'base-context-unknown') : 'source-changed',
    protectionRequirements: protections,
  };
}

function explicitContextItem(kind, artifactId, baseWorkspace, sourceWorkspace, targetWorkspace, baseKnown) {
  const base = baseKnown ? artifactValue(baseWorkspace, kind, artifactId) : null;
  const source = artifactValue(sourceWorkspace, kind, artifactId);
  const target = artifactValue(targetWorkspace, kind, artifactId);
  if (equal(source, target)) return null;
  return {
    key: artifactKey(kind, artifactId), kind, artifactId,
    title: itemTitle(kind, artifactId, source, target, base), baseKnown, base, source, target,
    conflict: true, reason: baseKnown ? 'explicit-context-resolution' : 'base-context-unknown',
  };
}

export function buildMergeItems(baseWorkspace, sourceWorkspace, targetWorkspace, contextKnown) {
  const items = [];
  const sceneIdSet = new Set([...sceneIds(baseWorkspace), ...sceneIds(sourceWorkspace), ...sceneIds(targetWorkspace)]);
  for (const artifactId of [...sceneIdSet].sort()) {
    const item = sceneItem(artifactId, baseWorkspace, sourceWorkspace, targetWorkspace, true);
    if (item) items.push(item);
  }
  const planIds = new Set([...baseWorkspace.plans, ...sourceWorkspace.plans, ...targetWorkspace.plans].map(({ id }) => id));
  for (const artifactId of [...planIds].sort()) {
    const item = explicitContextItem('plan', artifactId, baseWorkspace, sourceWorkspace, targetWorkspace, contextKnown);
    if (item) items.push(item);
  }
  const dependencies = explicitContextItem('dependencies', 'dependency-graph', baseWorkspace, sourceWorkspace, targetWorkspace, contextKnown);
  if (dependencies) items.push(dependencies);
  const scenesChanged = !equal(sceneIds(sourceWorkspace), sceneIds(targetWorkspace));
  if (scenesChanged || !equal(sourceWorkspace.layout, targetWorkspace.layout)) {
    const layout = explicitContextItem('layout', 'reading-order', baseWorkspace, sourceWorkspace, targetWorkspace, true);
    if (layout) items.push(layout);
    else items.push({
      key: artifactKey('layout', 'reading-order'), kind: 'layout', artifactId: 'reading-order', title: '읽기 순서',
      baseKnown: true, base: structuredClone(baseWorkspace.layout),
      source: structuredClone(sourceWorkspace.layout), target: structuredClone(targetWorkspace.layout),
      conflict: true, reason: 'explicit-layout-resolution',
    });
  }
  return items;
}

function chosenChange(item, resolution) {
  if (!resolution || resolution.choice === 'source') return { kind: item.kind, artifactId: item.artifactId, after: structuredClone(item.source) };
  if (resolution.choice === 'target') return { kind: item.kind, artifactId: item.artifactId, after: structuredClone(item.target) };
  const parsed = changeInputSchema.safeParse(resolution.change);
  if (!parsed.success) throw new DomainError('MERGE_RESOLUTION_INVALID', '사용자 병합 결과 형식이 유효하지 않습니다.', 422);
  const change = parsed.data;
  if (change.kind !== item.kind || change.artifactId !== item.artifactId) {
    throw new DomainError('MERGE_RESOLUTION_INVALID', '사용자 병합 결과가 대상 항목과 일치하지 않습니다.', 422);
  }
  if ((change.kind === 'scene' || change.kind === 'plan') && change.after !== null && change.after.id !== item.artifactId) {
    throw new DomainError('MERGE_RESOLUTION_INVALID', '사용자 병합 결과의 내부 식별자가 대상과 일치하지 않습니다.', 422);
  }
  return structuredClone(change);
}

function normalizeProtections(item, change) {
  if (item.kind !== 'scene') return change;
  const requirements = item.protectionRequirements ?? [];
  if (change.after === null) {
    if (requirements.length > 0) throw new DomainError('MERGE_PROTECTION_VIOLATION', '보호 문장을 삭제하거나 변경할 수 없습니다.', 422);
    return change;
  }
  const protections = [...new Set([...requirements, ...change.after.protectedQuotes])].sort(ordinal);
  if (protections.some((quote) => !change.after.text.includes(quote))) {
    throw new DomainError('MERGE_PROTECTION_VIOLATION', '보호 문장은 병합 결과 본문에 있어야 합니다.', 422);
  }
  return { ...change, after: { ...change.after, protectedQuotes: protections } };
}

export function resolveMergeItems(targetWorkspace, items, resolutions) {
  const byKey = new Map();
  for (const resolution of resolutions) {
    if (byKey.has(resolution.key)) throw new DomainError('MERGE_RESOLUTION_DUPLICATE', '같은 병합 항목을 두 번 해결할 수 없습니다.', 422);
    byKey.set(resolution.key, resolution);
  }
  const itemKeys = new Set(items.map(({ key }) => key));
  if ([...byKey.keys()].some((key) => !itemKeys.has(key))) throw new DomainError('MERGE_RESOLUTION_EXTRA', '미리보기에 없는 병합 결과가 포함되었습니다.', 422);

  const changes = [];
  let layoutChange = null;
  for (const item of items) {
    const resolution = byKey.get(item.key);
    if (item.conflict && !resolution) throw new DomainError('MERGE_RESOLUTION_REQUIRED', '충돌한 모든 항목의 결과를 선택해야 합니다.', 422);
    const change = normalizeProtections(item, chosenChange(item, resolution));
    if (item.kind === 'layout') layoutChange = change;
    else changes.push(change);
  }
  const workspace = canonicalWorkspace(targetWorkspace);
  for (const change of changes) {
    const collection = change.kind === 'scene' ? workspace.scenes : change.kind === 'plan' ? workspace.plans : null;
    if (collection) {
      const index = collection.findIndex(({ id }) => id === change.artifactId);
      if (change.after === null && index >= 0) collection.splice(index, 1);
      else if (change.after !== null && index >= 0) collection[index] = structuredClone(change.after);
      else if (change.after !== null) collection.push(structuredClone(change.after));
      collection.sort((left, right) => ordinal(left.id, right.id));
    } else if (change.kind === 'dependencies') workspace.dependencies = structuredClone(change.after);
  }
  const surviving = new Set(workspace.scenes.map(({ id }) => id));
  const priority = layoutChange?.after ?? workspace.layout;
  const layout = [...new Set(priority.filter((id) => surviving.has(id)))];
  for (const id of [...surviving].sort()) if (!layout.includes(id)) layout.push(id);
  workspace.layout = layout;
  changes.push({ kind: 'layout', artifactId: 'reading-order', after: structuredClone(layout) });
  return { workspace, changes };
}
