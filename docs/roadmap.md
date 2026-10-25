# Model-Use Roadmap

This document defines priorities and completion criteria for future work; it is not a completion report. The current **Agent runs** tab includes scope and budget composition, run history, SSE progress, cancellation, and result-review handoff, and providers are connected through the server's ordinary `.env`. Human evaluation and adoption are also separated from generation.
A standard `provider:check` and an explicit generation probe exist; the personal Codex sign-in and project-key procedure for Router4U is documented separately as a gateway guide in [`router4u.md`](router4u.md). That connection procedure does not validate actual user-Run quality or complete the provider-settings UI below.

## P1. Safe provider configuration and real-model quality

### Scope

- Add a server-owned provider-profile API and settings screen. Display configuration state in redacted form and manage the model and base URL, while storing and using the API key only in the server's secret store.
- Make connection tests distinguish support for SSE, a function tool loop, strict JSON Schema, and usage responses required by the current Part path, rather than reporting only HTTP success.
- With a real OpenAI-compatible model, verify selected-scope reading, multiple turns, a schema-valid full replacement, protected prose, cancellation, and failure boundaries. Do not use the current local fake model or local SSE fixture as evidence of real-model quality.
- Improve instructions, context selection, and result quality with representative manuscripts and human-evaluation criteria. Never use evaluation as a signal that automatically performs adoption.
- Preserve the current rule that a configured real-provider failure or invalid response is never replaced with a Local example (not AI) result.

### Completion criteria

- Without redeploying the server, a user can inspect configuration state, model, and base URL and run a capability connection test.
- Secret keys never appear in browser storage, safe DTOs, events, logs, or error bodies; later reads expose only whether a value is configured.
- In the browser, complete Run creation -> read-only tool loop -> result review -> Human evaluation -> explicit Adopt or rejection against a real compatible provider.
- Authentication failure, insufficient capabilities, schema-invalid output, timeout, and user cancellation remain distinct states and never silently lose frozen input or review results.
- Provider-reported usage, conservative estimates, and unknown usage remain distinct, and cancellation or failure is never displayed as success or no charge.
- Record results that meet defined evaluation criteria in real manuscript use, along with recurring failure types, to guide later prompt and context policy. Do not present this as a general guarantee of literary quality.

## P2. Traceability, cost, and evaluation experience

### Scope

- Link every run to the actual instruction, selected scene/plan/review excerpts, model settings, and resulting change set. Exclude secrets from tracing.
- Show input/output tokens, known/estimated status, and the basis of provider-specific cost estimates at Run and work level.
- Make missing required sources, criteria still marked `unknown`, insufficient exact citations, and historical reports that differ from the current baseline easier to distinguish and revise.
- Use real users' evaluation and adoption outcomes to inform later instruction improvements, never as an automatic adoption signal.

### Completion criteria

- From one change set, users can navigate in both directions among the originating feedback, model input context, run, usage, output, human evaluation, and final adoption outcome.
- The cost view never mixes reported and estimated values and exposes both calculation basis and missing-data state.
- Users can append evaluation Revisions without losing source hashes or exact citations, and stale reports remain readable.
- Real usage sessions can measure result quality, cancellations, errors, and adoption rate without presenting those metrics as an automatic quality guarantee.

## Required before public deployment

- Implement sign-in, per-user sessions, project-role ACLs, Reviewer visibility boundaries, and model-transmission policies before internet exposure.
- Establish secret storage, rotation, and audit policies, plus request rate limits.
- Automate PostgreSQL backup and restore and pass a restoration exercise in a separate environment.
- Under load, verify concurrent changes from multiple users, windows, and Workers; leases; idempotency; SSE reconnection; and provider failures.

Completion requires user and project isolation without authorization bypass, verified snapshot/change-set/evaluation hash history after restore, and no duplicate adoption or silent result loss within defined concurrency limits.

## Long-term scope

- A full-manuscript semantic Extractor/Evaluator and semantic diff are not currently implemented. Design them separately after collecting sufficient real usage and evaluation criteria.
- Mapping prose time expressions into structured constraints remains future work. Until then, temporal mechanical checks never infer `pass` without evidence.
- Introduce a semantic graph and normalized Artifact/Revision/Graph store only when the JSONB aggregate fails real scale, query, or concurrency requirements. This is not an immediate migration target.
- Reassess the complete `/v1/projects/{project_id}` resource API, global P0-P6 automation, and full-manuscript completion search after real consumers and operational requirements are known.
