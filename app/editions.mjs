import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../packages/domain/canonical.mjs';
import { DomainError } from './domain.mjs';
import { editionSummary } from './queries.mjs';
import { getBranchSnapshot } from './branch-state.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export function snapshotDocument(state, snapshotId) {
  const snapshot = getBranchSnapshot(state, snapshotId);
  if (!snapshot.sceneManifest) throw new DomainError('INCOMPLETE_SNAPSHOT', 'The snapshot has no manuscript reading order.', 409);
  const scenes = snapshot.sceneManifest.map((scene) => {
    const text = snapshot.sceneTexts[scene.id];
    if (typeof text !== 'string') throw new DomainError('INCOMPLETE_SNAPSHOT', 'Scene text is missing from the snapshot.', 409);
    return { id: scene.id, chapter: scene.chapter, title: scene.title, text };
  });
  return { projectId: state.project.id, title: state.project.title, subtitle: state.project.subtitle, scenes };
}

export function documentManifest(document, snapshotId) {
  if ([document.title, document.subtitle, ...document.scenes.flatMap((scene) => [scene.title, scene.text])].some((text) => !text.isWellFormed())) {
    throw new DomainError('INVALID_UNICODE', 'The manuscript contains invalid Unicode characters. Fix the text before exporting or publishing.', 422);
  }
  const scenes = document.scenes.map(({ text, ...scene }) => ({
    ...scene, textHash: hash(text), characters: Array.from(text).length,
  }));
  const manifest = {
    schemaVersion: 1, projectId: document.projectId, snapshotId,
    title: document.title, subtitle: document.subtitle, scenes,
    sceneCount: scenes.length, characterCount: scenes.reduce((total, scene) => total + scene.characters, 0),
  };
  return { ...manifest, manifestHash: hash(canonicalJson(manifest)) };
}

export function exportPreview(state, snapshotId) {
  const latest = (state.editions ?? []).at(-1);
  return { ...documentManifest(snapshotDocument(state, snapshotId), snapshotId), latestEdition: latest ? editionSummary(latest) : null };
}

export function publishEdition(state, input) {
  if (state.head !== input.expectedHead) throw new DomainError('STALE_HEAD', 'The current version changed after review. Review the publication again.', 409);
  const document = snapshotDocument(state, input.snapshotId);
  const manifest = documentManifest(document, input.snapshotId);
  if (!document.scenes.length) throw new DomainError('EMPTY_MANUSCRIPT', 'A manuscript with no scenes cannot be published.', 409);
  if (input.decision !== 'publish' || input.policyVersion !== 1 || manifest.manifestHash !== input.approvedManifestHash) {
    throw new DomainError('APPROVAL_MISMATCH', 'The reviewed manuscript hash does not match the publication approval.', 409);
  }
  state.editions ??= [];
  const previous = state.editions.at(-1);
  if ((input.revisionOf !== (previous?.id ?? null)) || (input.approvedPreviousManifestHash !== (previous?.manifestHash ?? null))) {
    throw new DomainError('EDITION_APPROVAL_REQUIRED', 'Approval of a new edition after reviewing the latest edition is required. Existing editions remain unchanged.', 409);
  }
  const createdAt = new Date().toISOString();
  const approvalId = randomUUID();
  const edition = {
    id: randomUUID(), title: input.title, snapshotId: input.snapshotId,
    manifestHash: manifest.manifestHash, createdAt, publishedBy: 'local-owner',
    revisionOf: input.revisionOf, sceneCount: manifest.sceneCount, sourceBranchId: state.currentBranchId,
    document: structuredClone(document), manifest: structuredClone(manifest), approvalId,
  };
  state.editions.push(edition);
  const approval = { id: approvalId, type: 'edition.approved', projectId: state.project.id, actor: 'local-owner', createdAt,
    detail: { editionId: edition.id, snapshotId: input.snapshotId, expectedHead: input.expectedHead,
      manifestHash: input.approvedManifestHash, revisionOf: input.revisionOf,
      previousManifestHash: input.approvedPreviousManifestHash, decision: input.decision, policyVersion: input.policyVersion } };
  const published = { id: randomUUID(), type: 'edition.published', projectId: state.project.id, actor: 'local-owner', createdAt,
    detail: { editionId: edition.id, approvalId, manifestHash: manifest.manifestHash } };
  state.audit.push(approval, published);
  state.outbox.push({ ...approval, deliveredAt: null }, { ...published, deliveredAt: null });
  return editionSummary(edition);
}

export function getEdition(state, id) {
  const edition = (state.editions ?? []).find((item) => item.id === id);
  if (!edition) throw new DomainError('NOT_FOUND', 'Edition not found for this project.', 404);
  const actualManifest = documentManifest(edition.document, edition.snapshotId);
  if (actualManifest.manifestHash !== edition.manifestHash || canonicalJson(actualManifest) !== canonicalJson(edition.manifest)) {
    throw new DomainError('EDITION_INTEGRITY_ERROR', 'The preserved edition manuscript hash does not match.', 409);
  }
  return edition;
}
