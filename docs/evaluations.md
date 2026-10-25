# Evidence-Based Human Evaluation Contract

## Purpose and boundary

An evaluation report is a human-authored, append-only judgment attached to one frozen V2 change set. The evaluation surface does not run a model, approve impact review, adopt a change set, or move the branch head. **Evaluation and adoption are separate decisions.**

The current author is fixed as `human / local-owner` in this single-user workspace. No separate automatic LLM Evaluator is implemented. `fulfilled`, `violated`, and `unknown` are report states calculated from the values a human selects for each criterion, not automatic model judgments.

## Evaluation basis and exact quotations

When feedback is linked, the full text of every linked feedback item is a required source. Without linked feedback, the change set's proposal reason is the required source. Default criteria use each source verbatim and preserve the following provenance:

- Source kind: `feedback` or `change_set_reason`
- `feedbackId` for a feedback source
- SHA-256 `sourceHash` of the complete source
- Unicode code-point `startCp` and `endCp`
- The `quote` that exactly matches that range
- Criterion formulation: `verbatim_source`, `human_refinement`, or `human_authored`

A `verbatim_source` criterion must equal exactly one source. A human-edited criterion based on a source becomes `human_refinement` while retaining its original basis. A newly written `human_authored` criterion does not claim a source basis, so its `basisRefs` must be empty. If linked source text has disappeared, NOVAIL marks the source unavailable rather than reconstructing it.

Judgment citations can be created only from a frozen changed entry's `before` or `after` value. Citable fields are `text`, `summary`, `storyTime`, and `description`; the report stores the full field hash, code-point range, and exact source text. The server recalculates source hashes and ranges when saving. A known judgment, `fulfilled` or `violated`, requires a non-empty rationale and at least one exact citation. `unknown` also records a rationale but may omit citations.

## Aggregating human judgments

A report's `humanVerdict` is determined in this order:

1. If any criterion is `violated`, the overall verdict is `violated`.
2. If every criterion is `fulfilled`, every required source is available, and every source is represented as the basis of at least one criterion, the overall verdict is `fulfilled`.
3. Otherwise, it is `unknown`.

The system therefore never infers a pass merely because a source is missing or a criterion has not yet been evaluated.

## Mechanical checks

Each report preserves four mechanical checks as they existed when the report was saved.

| Check | Meaning |
| --- | --- |
| `integrity` | Change-set schema, policy version, immutable hash, and base-binding checks |
| `workspace_schema` | Resulting workspace schema and identity checks |
| `protected_content` | Protected-prose and merge-protection preservation checks |
| `temporal` | Structured time-constraint checks |

Each result has a status of `pass`, `fail`, or `unknown`, plus a stable code, description, and related keys. Current change sets have no structured time-constraint mapping, so `temporal` is `unknown` with `NO_STRUCTURED_TEMPORAL_CONSTRAINTS`. NOVAIL does not parse time expressions in prose and turn them into a pass. Mechanical checks do not replace narrative-quality judgment or human evaluation.

## Append-only history and currency

Creating a report compares the change-set hash, observed head, workspace hash, and latest report ID. Each report references the prior report's ID and hash through `supersedes`, has its own hash, and never edits or deletes an existing report. Editing a historical report creates a new revision based on it.

A report whose head, workspace, or change-set binding no longer matches remains in history with `current: false`. If its current sources and citations can no longer be verified, it shows `evidenceValid: false` and the reasons while preserving the original content. An envelope with a damaged schema, self-hash, or linkage chain never partially renders untrusted content. The existence of an evaluation record does not approve the change set for adoption.

## API

- `GET /api/change-sets/{id}/evaluation-reports`: read the binding, required sources, default criteria, mechanical-check preview, and full history.
- `POST /api/change-sets/{id}/evaluation-reports`: submit `expectedChangeSetHash`, `expectedHead`, `expectedWorkspaceHash`, `expectedLatestReportId`, and `criteria` to append a report.

If the change-set hash, head, workspace hash, or latest report ID differs, saving from the stale screen is rejected and the user must review the current state.
