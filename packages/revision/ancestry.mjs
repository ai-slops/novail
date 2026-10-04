import { DomainError } from '../../app/errors.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function ancestryCatalog(state) {
  const snapshots = state.snapshots ?? [];
  const byId = new Map();
  for (const snapshot of snapshots) {
    if (byId.has(snapshot.id)) {
      throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', '스냅샷 계보에 중복 식별자가 있습니다.', 409);
    }
    byId.set(snapshot.id, snapshot);
  }
  const explicitStart = snapshots.findIndex((snapshot) => own(snapshot, 'parentSnapshotId'));
  return { snapshots, byId, explicitStart: explicitStart < 0 ? snapshots.length : explicitStart };
}

function parentIds(catalog, snapshot) {
  const index = catalog.snapshots.indexOf(snapshot);
  let primary;
  if (own(snapshot, 'parentSnapshotId')) primary = snapshot.parentSnapshotId;
  else if (index < catalog.explicitStart) primary = index === 0 ? null : catalog.snapshots[index - 1].id;
  else throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', '스냅샷의 부모 계보가 기록되지 않았습니다.', 409);

  const parents = [primary, own(snapshot, 'mergeParentSnapshotId') ? snapshot.mergeParentSnapshotId : null]
    .filter((id) => id !== null);
  if (parents.some((id) => typeof id !== 'string' || !catalog.byId.has(id))) {
    throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', '스냅샷의 부모를 찾을 수 없습니다.', 409);
  }
  return [...new Set(parents)];
}

function ancestorSet(catalog, snapshotId) {
  if (!catalog.byId.has(snapshotId)) {
    throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', '스냅샷을 찾을 수 없습니다.', 409);
  }
  const ancestors = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new DomainError('SNAPSHOT_ANCESTRY_CYCLE', '스냅샷 계보에 순환이 있습니다.', 409);
    if (ancestors.has(id)) return;
    visiting.add(id);
    for (const parentId of parentIds(catalog, catalog.byId.get(id))) visit(parentId);
    visiting.delete(id);
    ancestors.add(id);
  };
  visit(snapshotId);
  return ancestors;
}

export function ancestorIds(state, snapshotId) {
  const catalog = ancestryCatalog(state);
  const ancestors = ancestorSet(catalog, snapshotId);
  return catalog.snapshots.filter((snapshot) => ancestors.has(snapshot.id)).map((snapshot) => snapshot.id);
}

export function findMergeBase(state, sourceHead, targetHead) {
  const catalog = ancestryCatalog(state);
  const sourceAncestors = ancestorSet(catalog, sourceHead);
  const targetAncestors = ancestorSet(catalog, targetHead);
  const common = catalog.snapshots.filter((snapshot) => sourceAncestors.has(snapshot.id) && targetAncestors.has(snapshot.id));
  if (common.length === 0) throw new DomainError('MERGE_BASE_NOT_FOUND', '공통 기준 스냅샷을 찾을 수 없습니다.', 409);

  const ancestryById = new Map(common.map((snapshot) => [snapshot.id, ancestorSet(catalog, snapshot.id)]));
  const maximal = common.filter((candidate) => !common.some((other) => (
    other.id !== candidate.id && ancestryById.get(other.id).has(candidate.id)
  )));
  if (maximal.length !== 1) throw new DomainError('MERGE_BASE_AMBIGUOUS', '병합 기준 스냅샷을 하나로 결정할 수 없습니다.', 409);
  return maximal[0];
}
