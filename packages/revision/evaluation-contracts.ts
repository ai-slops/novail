import { z } from 'zod';

import { hashSchema, idSchema } from './contracts.ts';

const exactMeaningfulTextSchema = z.string().min(1).max(200_000)
  .refine((value) => value.trim().length > 0, { message: 'Evidence text must contain non-whitespace content.' });
const intentTextSchema = z.string().trim().min(1).max(200_000);
const spanFields = {
  sourceHash: hashSchema,
  startCp: z.number().int().nonnegative(),
  endCp: z.number().int().positive(),
  quote: exactMeaningfulTextSchema,
} as const;

export const evaluationVerdictSchema = z.enum(['fulfilled', 'violated', 'unknown']);
export const evaluationBasisRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('feedback'), feedbackId: idSchema, ...spanFields }),
  z.strictObject({ kind: z.literal('change_set_reason'), ...spanFields }),
]);
export const evaluationCitationSchema = z.strictObject({
  entryId: idSchema,
  side: z.enum(['before', 'after']),
  field: z.enum(['text', 'summary', 'storyTime', 'description']),
  ...spanFields,
});

export const evaluationCriterionSchema = z.strictObject({
  id: idSchema,
  text: exactMeaningfulTextSchema,
  formulation: z.enum(['verbatim_source', 'human_refinement', 'human_authored']),
  basisRefs: z.array(evaluationBasisRefSchema).max(100),
  verdict: evaluationVerdictSchema,
  rationale: intentTextSchema,
  citations: z.array(evaluationCitationSchema).max(250),
}).superRefine((criterion, context) => {
  if (criterion.verdict !== 'unknown' && criterion.citations.length === 0) {
    context.addIssue({ code: 'custom', path: ['citations'], message: 'Known judgments require evidence.' });
  }
  switch (criterion.formulation) {
    case 'verbatim_source':
      if (criterion.basisRefs.length !== 1 || criterion.text !== criterion.basisRefs[0]?.quote) {
        context.addIssue({ code: 'custom', path: ['basisRefs'], message: 'Verbatim criteria require one exact source.' });
      }
      break;
    case 'human_refinement':
      if (criterion.basisRefs.length === 0) {
        context.addIssue({ code: 'custom', path: ['basisRefs'], message: 'Refined criteria require source evidence.' });
      }
      break;
    case 'human_authored':
      if (criterion.basisRefs.length !== 0) {
        context.addIssue({ code: 'custom', path: ['basisRefs'], message: 'Human-authored criteria cannot claim source evidence.' });
      }
      break;
  }
});
const evaluationCriteriaSchema = z.array(evaluationCriterionSchema).max(250).superRefine((criteria, context) => {
  const ids = new Set<string>();
  criteria.forEach((criterion, index) => {
    if (ids.has(criterion.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Criterion IDs must be unique.' });
    }
    ids.add(criterion.id);
  });
});

export const mechanicalCheckSchema = z.strictObject({
  id: z.enum(['integrity', 'workspace_schema', 'protected_content', 'temporal']),
  verdict: z.enum(['pass', 'fail', 'unknown']),
  code: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  keys: z.array(z.string().min(1).max(500)).max(2500),
});
const reportCore = {
  schemaVersion: z.literal(1),
  id: idSchema,
  revision: z.number().int().positive(),
  supersedes: z.strictObject({ id: idSchema, hash: hashSchema }).nullable(),
  projectId: idSchema,
  branchId: idSchema,
  changeSetId: idSchema,
  changeSetHash: hashSchema,
  observedHead: idSchema,
  observedWorkspaceHash: hashSchema,
  author: z.strictObject({ kind: z.literal('human'), actor: z.literal('local-owner') }),
  criteria: evaluationCriteriaSchema,
  mechanicalChecks: z.array(mechanicalCheckSchema).length(4),
  humanVerdict: evaluationVerdictSchema,
  createdAt: z.iso.datetime(),
} as const;
export const evaluationReportSchema = z.strictObject({ ...reportCore, hash: hashSchema });

export const evaluationReportRequestSchema = z.strictObject({
  expectedChangeSetHash: hashSchema,
  expectedHead: idSchema,
  expectedWorkspaceHash: hashSchema,
  expectedLatestReportId: idSchema.nullable(),
  criteria: evaluationCriteriaSchema.refine((criteria) => criteria.length > 0, {
    message: 'At least one criterion is required to create a report.',
  }),
});

export const requiredEvaluationSourceSchema = z.strictObject({
  key: z.string().min(1),
  kind: z.enum(['feedback', 'change_set_reason']),
  feedbackId: idSchema.nullable(),
  sourceHash: hashSchema.nullable(),
  text: z.string().nullable(),
  available: z.boolean(),
  warning: z.string().nullable(),
});
export const evaluationBindingSchema = z.strictObject({
  projectId: idSchema,
  branchId: idSchema,
  changeSetId: idSchema,
  changeSetHash: hashSchema,
  changeSetStatus: z.string().min(1),
  bindingValid: z.boolean(),
  proposalBaseCurrent: z.boolean(),
  actionable: z.boolean(),
  staleReasons: z.array(z.string()),
  observedHead: idSchema,
  currentHead: idSchema,
  observedWorkspaceHash: hashSchema,
  currentWorkspaceHash: hashSchema,
});
export const projectedEvaluationReportSchema = z.discriminatedUnion('valid', [
  z.strictObject({
    valid: z.literal(true),
    report: evaluationReportSchema,
    current: z.boolean(),
    evidenceValid: z.boolean(),
    invalidReasons: z.array(z.string()),
  }),
  z.strictObject({
    valid: z.literal(false),
    reportId: idSchema.nullable(),
    current: z.literal(false),
    evidenceValid: z.literal(false),
    invalidReasons: z.array(z.string()).min(1),
  }),
]);
export const evaluationReportsResponseSchema = z.strictObject({
  binding: evaluationBindingSchema,
  requiredSources: z.array(requiredEvaluationSourceSchema),
  defaultCriteria: evaluationCriteriaSchema,
  mechanicalPreview: z.array(mechanicalCheckSchema).length(4),
  latestReportId: idSchema.nullable(),
  history: z.array(projectedEvaluationReportSchema),
});

export type EvaluationBasisRef = z.infer<typeof evaluationBasisRefSchema>;
export type EvaluationCitation = z.infer<typeof evaluationCitationSchema>;
export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type EvaluationReportRequest = z.infer<typeof evaluationReportRequestSchema>;
export type EvaluationReportsResponse = z.infer<typeof evaluationReportsResponseSchema>;
