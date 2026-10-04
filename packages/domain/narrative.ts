import { z } from 'zod';

export const readinessSchema = z.strictObject({
  generationKind: z.enum(['draft', 'exploration']),
  baseSnapshotId: z.string().min(1),
  openDecisions: z.array(z.strictObject({ id: z.string(), affectsBlock: z.boolean() })),
  conditions: z.array(z.strictObject({
    id: z.string(),
    kind: z.enum(['boundary', 'context', 'disclosure', 'permission', 'preservation']),
    status: z.enum(['pass', 'fail', 'unknown']),
  })),
  requiredTokens: z.number().int().nonnegative(),
  tokenBudget: z.number().int().positive(),
});

type Readiness = z.infer<typeof readinessSchema>;
type Blocker = { readonly code: string; readonly ref: string; readonly returnStage: string };

/** Unknown conditions are never silently treated as proven. */
export function checkReadiness(input: Readiness) {
  const blockers: Blocker[] = [];
  if (input.requiredTokens > input.tokenBudget) {
    blockers.push({ code: 'BLOCKED_CONTEXT_BUDGET', ref: 'context', returnStage: 'P4' });
  }
  for (const decision of input.openDecisions) {
    if (decision.affectsBlock && input.generationKind === 'draft') {
      blockers.push({ code: 'OPEN_DECISION', ref: decision.id, returnStage: 'P3' });
    }
  }
  for (const condition of input.conditions) {
    if (condition.status === 'pass') continue;
    // Exploration can relax narrative completeness, never permission or preservation.
    if (input.generationKind === 'exploration' &&
      (condition.kind === 'boundary' || condition.kind === 'context')) continue;
    blockers.push({
      code: condition.status === 'unknown' ? 'CONDITION_UNKNOWN' : 'CONSTRAINT_CONFLICT',
      ref: condition.id,
      returnStage: condition.kind === 'boundary' ? 'P3' : 'P4',
    });
  }
  return { ready: blockers.length === 0, blockers, generationKind: input.generationKind };
}

export const spanSchema = z.strictObject({
  text: z.string(),
  startCp: z.number().int().nonnegative(),
  endCp: z.number().int().nonnegative(),
  quote: z.string(),
});

export function validateSpan(input: z.infer<typeof spanSchema>) {
  const points = Array.from(input.text);
  const valid = input.endCp >= input.startCp && input.endCp <= points.length &&
    points.slice(input.startCp, input.endCp).join('') === input.quote;
  return { valid, code: valid ? null : 'ANCHOR_UNRESOLVED' };
}

/** Browser selections use UTF-16 offsets; storage uses Unicode code points. */
export function toCodePointOffset(text: string, utf16Offset: number) {
  if (!Number.isInteger(utf16Offset) || utf16Offset < 0 || utf16Offset > text.length) {
    return { valid: false as const, code: 'SCHEMA_INVALID' as const };
  }
  const prefix = text.slice(0, utf16Offset);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    return { valid: false as const, code: 'ANCHOR_UNRESOLVED' as const };
  }
  return { valid: true as const, offset: Array.from(prefix).length };
}

export const temporalEdgeSchema = z.strictObject({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(['before', 'after', 'min_elapsed', 'overlaps']),
  minElapsed: z.number().nonnegative().default(0),
});

type TemporalEdge = z.infer<typeof temporalEdgeSchema>;
type Inequality = { readonly id: string; readonly from: string; readonly to: string; readonly gap: number };

/** Difference constraints only. No invented dates or common-sense travel estimates. */
export function checkTemporalConstraints(edges: readonly TemporalEdge[]) {
  const inequalities: Inequality[] = [];
  const unknown: string[] = [];
  for (const edge of edges) {
    switch (edge.relation) {
      case 'before':
        inequalities.push({ ...edge, gap: 1 });
        break;
      case 'after':
        inequalities.push({ id: edge.id, from: edge.to, to: edge.from, gap: 1 });
        break;
      case 'min_elapsed':
        inequalities.push({ ...edge, gap: edge.minElapsed });
        break;
      case 'overlaps':
        unknown.push(edge.id);
        break;
      default: {
        const exhaustive: never = edge.relation;
        return exhaustive;
      }
    }
  }
  const vertices = new Set(inequalities.flatMap((edge) => [edge.from, edge.to]));
  const distances = new Map([...vertices].map((id) => [id, 0]));
  const predecessor = new Map<string, Inequality>();
  let lastChanged: string | undefined;
  for (let round = 0; round < vertices.size; round++) {
    lastChanged = undefined;
    for (const edge of inequalities) {
      const value = (distances.get(edge.from) ?? 0) + edge.gap;
      if (value > (distances.get(edge.to) ?? 0)) {
        distances.set(edge.to, value);
        predecessor.set(edge.to, edge);
        lastChanged = edge.to;
      }
    }
    if (lastChanged === undefined) break;
  }
  if (lastChanged !== undefined) {
    let cursor = lastChanged;
    for (let step = 0; step < vertices.size; step++) {
      cursor = predecessor.get(cursor)?.from ?? cursor;
    }
    const seen = new Set<string>();
    const conflicts: string[] = [];
    while (!seen.has(cursor)) {
      seen.add(cursor);
      const edge = predecessor.get(cursor);
      if (!edge) break;
      conflicts.push(edge.id);
      cursor = edge.from;
    }
    return { verdict: 'fail' as const, conflicts, unknown };
  }
  return { verdict: unknown.length || edges.length === 0 ? 'unknown' as const : 'pass' as const, conflicts: [], unknown };
}
