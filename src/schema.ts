import { z } from "zod"
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

const projectSchema = z.object({ id: z.string(), title: z.string(), subtitle: z.string(), stage: z.string() })
const sceneSchema = z.object({
  id: z.string(), title: z.string(), chapter: z.number().int().positive().transform((value) => `${value}장`), status: z.string(), text: z.string(), summary: z.string(), storyTime: z.string(), characters: z.array(z.string()), protectedQuotes: z.array(z.string()),
})
const feedbackSchema = z.object({ id: z.string(), sceneId: z.string(), text: z.string(), scope: z.string(), state: z.string(), createdAt: z.string() })
const candidateSchema = z.object({
  id: z.string(), sceneId: z.string(), baseSnapshotId: z.string(), before: z.string(), after: z.string(), reason: z.string(), status: z.string(),
  reviewSet: z.array(z.object({ sceneId: z.string(), title: z.string(), reason: z.string(), mandatory: z.boolean() })),
  rewriteSet: z.array(z.string()), hash: z.string(), createdAt: z.string(),
})
const snapshotSchema = z.object({ id: z.string(), label: z.string(), createdAt: z.string(), sceneTexts: z.record(z.string(), z.string()), canBranch: z.boolean().default(false) })
export const branchSummarySchema = z.object({
  id: z.string(), name: z.string(), headSnapshotId: z.string(), sourceSnapshotId: z.string(),
  sourceBranchId: z.string().nullable(), createdAt: z.string(), isCurrent: z.boolean(), snapshotCount: z.number().int().nonnegative(),
})
export const editionSummarySchema = z.object({
  id: z.string(), title: z.string(), snapshotId: z.string(), manifestHash: sha256Schema, createdAt: z.string(),
  publishedBy: z.string(), revisionOf: z.string().nullable(), sceneCount: z.number().int().nonnegative(), sourceBranchId: z.string().nullable().default(null),
})
export const exportPreviewSchema = z.object({
  projectId: z.string(), snapshotId: z.string(), manifestHash: sha256Schema, sceneCount: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(), title: z.string(), subtitle: z.string(),
  scenes: z.array(z.object({ id: z.string(), chapter: z.number().int().positive(), title: z.string(), textHash: sha256Schema, characters: z.number().int().nonnegative() })),
  latestEdition: editionSummarySchema.nullable(),
})
const planSchema = z.object({ id: z.string(), title: z.string(), kind: z.string(), description: z.string(), status: z.string() })
const runSchema = z.object({ id: z.string(), state: z.string(), purpose: z.string(), createdAt: z.string() })

export const workspaceSchema = z.object({
  project: projectSchema,
  projects: z.array(projectSchema),
  head: z.string(),
  currentBranchId: z.string().default(""),
  branches: z.array(branchSummarySchema).default([]),
  scenes: z.array(sceneSchema),
  feedback: z.array(feedbackSchema),
  candidates: z.array(candidateSchema),
  snapshots: z.array(snapshotSchema),
  editions: z.array(editionSummarySchema).default([]),
  plans: z.array(planSchema),
  runs: z.array(runSchema),
  settings: z.object({ providerConfigured: z.boolean(), mode: z.string() }),
  drafts: z.record(z.string(), z.object({ sceneId: z.string(), text: z.string(), baseSnapshotId: z.string(), updatedAt: z.string() })).default({}),
})

export const createdIdSchema = z.object({ id: z.string() })
export const createdProjectSchema = z.object({ id: z.string(), currentBranchId: z.string() })
export const runCompletionSchema = z.object({ state: z.string(), error: z.object({ code: z.string(), message: z.string() }).optional() })
