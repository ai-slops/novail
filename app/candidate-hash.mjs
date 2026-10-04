import { createHash } from 'node:crypto';
import { canonicalJson } from '../packages/domain/canonical.mjs';

export const candidateHash = (candidate) => createHash('sha256').update(canonicalJson({
  sceneId: candidate.sceneId, baseSnapshotId: candidate.baseSnapshotId,
  before: candidate.before, after: candidate.after, reviewSet: candidate.reviewSet,
  rewriteSet: candidate.rewriteSet, contextHash: candidate.contextHash,
  runId: candidate.runId, contextVersion: candidate.contextVersion, branchId: candidate.branchId,
})).digest('hex');
