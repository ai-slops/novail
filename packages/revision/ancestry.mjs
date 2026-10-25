import { DomainError } from '../../app/errors.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function ancestryCatalog(state) {
  const snapshots = state.snapshots ?? [];
  const byId = new Map();
  for (const snapshot of snapshots) {
    if (byId.has(snapshot.id)) {
      throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', 'The snapshot lineage contains duplicate IDs.', 409);
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
  else throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', 'The snapshot parent lineage was not recorded.', 409);

  const parents = [primary, own(snapshot, 'mergeParentSnapshotId') ? snapshot.mergeParentSnapshotId : null]
    .filter((id) => id !== null);
  if (parents.some((id) => typeof id !== 'string' || !catalog.byId.has(id))) {
    throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', 'A snapshot parent was not found.', 409);
  }
  return [...new Set(parents)];
}

function ancestorSet(catalog, snapshotId) {
  if (!catalog.byId.has(snapshotId)) {
    throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', 'Snapshot not found.', 409);
  }
  const ancestors = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new DomainError('SNAPSHOT_ANCESTRY_CYCLE', 'The snapshot lineage contains a cycle.', 409);
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
  if (common.length === 0) throw new DomainError('MERGE_BASE_NOT_FOUND', 'No common base snapshot was found.', 409);

  const ancestryById = new Map(common.map((snapshot) => [snapshot.id, ancestorSet(catalog, snapshot.id)]));
  const maximal = common.filter((candidate) => !common.some((other) => (
    other.id !== candidate.id && ancestryById.get(other.id).has(candidate.id)
  )));
  if (maximal.length !== 1) throw new DomainError('MERGE_BASE_AMBIGUOUS', 'A single merge base snapshot could not be determined.', 409);
  return maximal[0];
}
