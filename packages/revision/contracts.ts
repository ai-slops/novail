import { z } from 'zod';

export const idSchema = z.string().min(1).max(200);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const sceneValueSchema = z.strictObject({
  id: idSchema, title: z.string().min(1).max(500), chapter: z.number().int().positive(),
  status: z.string(), text: z.string().max(200_000), summary: z.string(), storyTime: z.string(),
  characters: z.array(z.string()), protectedQuotes: z.array(z.string().min(1)),
});
export const planValueSchema = z.strictObject({
  id: idSchema, title: z.string().min(1).max(500), kind: z.string().min(1),
  description: z.string().max(100_000), status: z.string(),
});
export const dependencySchema = z.strictObject({
  from: idSchema, to: idSchema, type: z.string().min(1), reason: z.string(), mandatory: z.boolean(),
});
export const dependenciesSchema = z.array(dependencySchema).max(5000);
export const layoutSchema = z.array(idSchema).max(2000);
export const artifactKinds = ['scene', 'plan', 'dependencies', 'layout'] as const;

export const changeInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scene'), artifactId: idSchema, after: sceneValueSchema.nullable() }),
  z.strictObject({ kind: z.literal('plan'), artifactId: idSchema, after: planValueSchema.nullable() }),
  z.strictObject({ kind: z.literal('dependencies'), artifactId: z.literal('dependency-graph'), after: dependenciesSchema }),
  z.strictObject({ kind: z.literal('layout'), artifactId: z.literal('reading-order'), after: layoutSchema }),
]);
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({ id: idSchema, key: z.string(), kind: z.literal('scene'), artifactId: idSchema, title: z.string(), before: sceneValueSchema.nullable(), after: sceneValueSchema.nullable() }),
  z.object({ id: idSchema, key: z.string(), kind: z.literal('plan'), artifactId: idSchema, title: z.string(), before: planValueSchema.nullable(), after: planValueSchema.nullable() }),
  z.object({ id: idSchema, key: z.string(), kind: z.literal('dependencies'), artifactId: z.string(), title: z.string(), before: dependenciesSchema, after: dependenciesSchema }),
  z.object({ id: idSchema, key: z.string(), kind: z.literal('layout'), artifactId: z.string(), title: z.string(), before: layoutSchema, after: layoutSchema }),
]);
export const canonicalSchema = z.object({
  layout: layoutSchema, scenes: z.array(sceneValueSchema), plans: z.array(planValueSchema), dependencies: dependenciesSchema,
});
export const revisionContextSchema = z.object({
  projectId: idSchema, branchId: idSchema, baseSnapshotId: idSchema, workspaceHash: hashSchema, workspace: canonicalSchema,
});
export const reviewTargetSchema = z.object({
  key: z.string(), kind: z.enum(artifactKinds), artifactId: idSchema, title: z.string(), reasons: z.array(z.string()), mandatory: z.boolean(), changed: z.boolean(),
});
export const impactSchema = z.object({
  reviewSet: z.array(reviewTargetSchema), rewriteSet: z.array(z.string()), invalidationSet: z.array(z.string()),
  incomplete: z.boolean(), unexamined: z.array(z.string()), warnings: z.array(z.string()),
});
export const issueSchema = z.object({ code: z.string(), message: z.string(), keys: z.array(z.string()) });
export const bundleSchema = z.object({ id: idSchema, label: z.string(), changeIds: z.array(idSchema) });
export const mergeBindingSchema = z.object({
  previewId: idSchema, previewHash: hashSchema, sourceBranchId: idSchema, sourceHead: idSchema,
  sourceWorkspaceHash: hashSchema, targetWorkspaceHash: hashSchema, baseSnapshotId: idSchema,
});
export const changeSetSchema = z.object({
  id: idSchema, projectId: idSchema, branchId: idSchema, schemaVersion: z.literal(2), policyVersion: z.literal(2),
  kind: z.enum(['manual', 'repair', 'merge', 'candidate']), reason: z.string(), baseSnapshotId: idSchema,
  baseWorkspaceHash: hashSchema, baseContextVersion: z.number().int().nonnegative(),
  entries: z.array(entrySchema), bundles: z.array(bundleSchema), impact: impactSchema, issues: z.array(issueSchema),
  feedbackIds: z.array(idSchema), runId: idSchema.nullable(), candidateId: idSchema.nullable(),
  parentChangeSetId: idSchema.nullable(), merge: mergeBindingSchema.nullable(),
  hash: hashSchema, createdAt: z.string(), status: z.string(), canCommit: z.boolean(), blockedReasons: z.array(z.string()),
  requiredReviewKeys: z.array(z.string()),
});
export const manualChangeSetSchema = z.strictObject({
  baseSnapshotId: idSchema, baseWorkspaceHash: hashSchema, reason: z.string().trim().min(1).max(20_000),
  changes: z.array(changeInputSchema).min(1).max(50), feedbackIds: z.array(idSchema).max(50).default([]), atomic: z.boolean().default(false),
});
export const commitChangeSetSchema = z.strictObject({
  expectedHead: idSchema, approvedHash: hashSchema, reviewedKeys: z.array(z.string()).max(2500),
  decision: z.literal('accept'), policyVersion: z.literal(2),
});
export const deriveSchema = z.strictObject({ changeIds: z.array(idSchema).min(1).max(50) });
export const repairRunSchema = z.strictObject({
  baseSnapshotId: idSchema, baseWorkspaceHash: hashSchema, instruction: z.string().trim().min(1).max(20_000),
  sceneIds: z.array(idSchema).max(8), planIds: z.array(idSchema).max(8), feedbackIds: z.array(idSchema).max(50).default([]),
  budget: z.strictObject({ maxModelCalls: z.number().int().min(1).max(12).default(12), maxOutputTokens: z.number().int().min(1).max(30000).default(16000) }).default({ maxModelCalls: 12, maxOutputTokens: 16000 }),
});
export const mergeResolutionSchema = z.discriminatedUnion('choice', [
  z.strictObject({ key: z.string(), choice: z.literal('source') }),
  z.strictObject({ key: z.string(), choice: z.literal('target') }),
  z.strictObject({ key: z.string(), choice: z.literal('custom'), change: changeInputSchema }),
]);
export const mergeItemSchema = z.object({
  key: z.string(), kind: z.enum(artifactKinds), artifactId: idSchema, title: z.string(),
  baseKnown: z.boolean(), base: z.json(), source: z.json(), target: z.json(),
  conflict: z.boolean(), reason: z.string(),
});
export const mergePreviewSchema = z.object({
  id: idSchema, projectId: idSchema, targetBranchId: idSchema, targetHead: idSchema, targetWorkspaceHash: hashSchema,
  sourceBranchId: idSchema, sourceHead: idSchema, sourceWorkspaceHash: hashSchema, baseSnapshotId: idSchema,
  sourceName: z.string(), targetName: z.string(), items: z.array(mergeItemSchema), hash: hashSchema, createdAt: z.string(),
});
export const sealMergeSchema = z.strictObject({ previewHash: hashSchema, resolutions: z.array(mergeResolutionSchema).max(2500) });

export type CanonicalWorkspace = z.infer<typeof canonicalSchema>;
export type ChangeInput = z.infer<typeof changeInputSchema>;
export type ChangeEntry = z.infer<typeof entrySchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
export type RevisionContext = z.infer<typeof revisionContextSchema>;
export type MergePreview = z.infer<typeof mergePreviewSchema>;
export type MergeResolution = z.infer<typeof mergeResolutionSchema>;
export type SceneValue = z.infer<typeof sceneValueSchema>;
export type PlanValue = z.infer<typeof planValueSchema>;
