# Part Agent Runtime Contract

NOVAIL's **Agent runs** path freezes selected scenes and plans as read-only context and records model-generated revisions as a V2 change set. The result is only a proposal in `awaiting_decision`; it never changes the canonical manuscript before human review and adoption.

## Versions and source reference

- [`@slop-lab/part` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part/v/0.1.0)
- [`@slop-lab/part-plugins` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part-plugins/v/0.1.0)
- Upstream source for both packages: [`slop-lab/part`](https://github.com/slop-lab/part)
- Node.js `>=24.22.0`; `.node-version` and the Docker image use `24.22.0`.

Because the Part API is experimental, both dependencies are pinned to exactly `0.1.0`. The release-age exceptions for Part apply only to these two package versions and do not relax the general restrictions on new dependencies. Exact package exemptions for QG are documented separately in [`quality-gate.md`](quality-gate.md).

## Execution boundary

1. `POST /api/repair-runs` validates the current branch, base snapshot and workspace hash, selected IDs, instruction, and budgets, then freezes the input workspace on the run.
2. NOVAIL's persistent run/job queue claims the job with a lease. Each claim creates a fresh Part `createAgent` and basic driver in memory; the Part execution stack itself is not restored after restart.
3. The model reads frozen context through the three tools below and returns a strict-JSON revision.
4. The server revalidates the JSON shape, verifies that every selected scene and plan ID appears exactly once, prevents target-ID changes, and checks protected prose.
5. A structurally valid result within the selected scope becomes a V2 change set. Generated results that fail workspace validation, including protection requirements, are preserved for inspection but blocked from adoption. Neither the model nor a tool has adoption authority.

The legacy single-scene V1 Run and direct OpenAI-compatible gateway remain for backward compatibility, but they are not Part paths. This Part contract applies only to `repair_bundle` execution.

## Allowed tools and model input

Tool IDs use these underscore names, not dotted names:

- `novail_read_selected_scenes`: selected scene text and protected prose
- `novail_read_selected_plans`: selected planning items
- `novail_read_readonly_context`: reading order, active constraints, related scenes, and dependencies

All three results are copied from the workspace when the Run is created and then frozen. Manuscript data read by the model is never interpreted as instruction or approval. No shell, arbitrary network, file or workspace write, or approval tool is available. Provider HTTP calls leave only through the model transport configured by the server, not through a tool.

## Model and output contract

With `OPENAI_API_KEY`, NOVAIL uses the default `/chat/completions` or the explicitly selected `/responses` below `OPENAI_BASE_URL`. The request's `model` takes priority; otherwise the optional `OPENAI_MODEL` default is used. The selection is frozen when queued, and a request with neither value is rejected with `MODEL_REQUIRED`. Within one Run, the provider must support:

- SSE streaming for the selected protocol
- Function tool calls followed by another model turn
- Chat Completions `response_format.type=json_schema`, or Responses `text.format`, with `strict: true`
- Per-call `max_completion_tokens` or `max_output_tokens`

Some OpenAI-compatible variants do not support this combination or usage reporting. Connection failures, invalid tool calls, schema-invalid JSON, selected-scope mismatches, and truncated responses fail the Run and are never replaced with a local result.

Without a key, deterministic `local-demo` runs through the Part `fakeModel`. The UI and `/api/runtime-info` label this **Local example (not AI)**. It does not validate real-model quality.

The server and `provider:check` use the same `.env`; the default base URL is `https://api.openai.com/v1`. The server can start with no default model, but it rejects an invalid base URL when a key is configured. `pnpm provider:check` can test authenticated standard `GET /models` catalog access without a default model and makes no claim about generation support. To generate from the CLI, set `OPENAI_MODEL` and explicitly consent to quota use by running `pnpm provider:check --generate`.

Setting `OPENAI_API=responses` uses Part's Responses adapter. It sends SSE requests to `/responses` and uses strict JSON Schema in `text.format` plus `max_output_tokens`. NOVAIL does not automatically retry or switch protocols between Chat Completions and Responses.
The selected protocol is stored with the model in the queue, so changing the server default does not alter existing requests. This applies to Part's `repair_bundle` path; the legacy V1 gateway remains on its Chat Completions-compatible path.

The Part 0.1.0 compatibility layer omits only structurally validated informational `response.metadata` SSE frames. Every other frame reaches the original decoder, and malformed metadata, `response.failed`, or `response.incomplete` is never converted into successful completion.

## Failure diagnostics and logs

New failures record stage, HTTP status, provider code, request ID, retryability, and a stable cause classification in `error.diagnostics`. Users can inspect them under **Failure diagnostics** or copy JSON containing only allowed fields. Server stderr records `worker.generation_failed`, the Run ID, and the same diagnostic fields. Manuscript text, keys, headers, and raw response bodies are never logged.

Historical failures without detailed diagnostics remain unchanged; NOVAIL never invents missing diagnostics. A call with unknown usage or an expired lease displays `Unknown` in the UI and retains its reservation. There is no automatic retry; fix the cause and create a new Run.

## Budgets and usage

A Run has `maxModelCalls`, `maxToolDispatches`, `maxKnownTokens`, `maxOutputTokens`, `maxOutputTokensPerInvocation`, and `deadlineSeconds`. Defaults are `4`, `8`, `64,000`, `16,000`, `4,000`, and `120`. The UI can edit them only within the ranges published by the server.

- Before an external model call, NOVAIL atomically reserves one call and the per-invocation maximum output tokens.
- Part enforces model-call count, tool-dispatch count, per-invocation output limit, and the overall deadline together. Only one operation runs concurrently.
- Provider usage is recorded as `provider-reported`, and input/output values count toward known-token and output budgets.
- The known-token limit is checked after response usage is recorded. An over-limit result never becomes an adoptable proposal, but external cost already incurred cannot be reversed.
- If the provider omits output usage, NOVAIL charges the **entire reserved per-invocation output limit** as `estimated` output. This is a conservative budget value, not claimed actual usage. Without input usage, the public value is `null`.
- If the call result is unknown, the reservation remains held. The provider may already have charged for a call even after cancellation was requested or a response was received.

## Durability, cancellation, and recovery

Runs, Jobs, model-attempt reservations, and public events persist in the NOVAIL store. The local file store is for single-process development; multi-Worker deployments use PostgreSQL. There is no separate SQLite store.

Job leases renew periodically, and lease tokens fence off late results. Cancellation immediately marks a Run cancelled and requests best-effort cancellation from the active Part handle. It does not guarantee that an already-started provider call terminates or is uncharged.

When process termination or lease expiration makes usage unknowable, the Run fails closed with `USAGE_UNKNOWN`. NOVAIL neither releases the reservation nor retries automatically; the user must explicitly create a new Run from the current base. The NOVAIL queue is durable, but the Part agent and model conversation stack are temporary to one lease.

## Public API and events

- `GET /api/runtime-info`: Part `0.1.0`, current server mode and model label, public budget defaults and ranges, and allowed tool IDs
- `GET /api/provider/models`: model IDs and optional default read with the server key; distinguishes key rejection, unsupported catalog, and lookup failure without returning the key or raw provider body
- `POST /api/repair-runs`: create a branch-scoped Part repair Run
- `GET /api/runs?limit=...`: list recent queue-managed Runs on the current branch
- `GET /api/runs/:id`: read a safe Run summary and Job summary
- `POST /api/runs/:id/cancel`: request cancellation
- `GET /api/runs/:id/events`: SSE replay and live stream with `Last-Event-ID`

Mutations are bound to the current branch and idempotency key. Public DTOs contain only state, budgets, aggregate usage, runtime provenance, safe errors, and result references. They exclude lease tokens, frozen input workspaces, source context packs, and provider keys.

SSE first replays stored events, then streams live events, and closes at a terminal state. An unknown `Last-Event-ID` is rejected with `EVENT_CURSOR_EXPIRED`, after which the UI reloads full state and events. Public text deltas are limited to 1,024 characters each; text and gap progress events are limited to 128 events or 64 KiB per Run.
After the limit, progress content is omitted and marked truncated, while model, tool, and terminal events continue to be recorded. This is public result-progress text, not a contract to store or expose private model chain-of-thought.

## Web UI and exclusions

The **Agent runs** tab displays runtime mode, model selection, three tools, the scope and budget composer, the latest 50 Runs, usage, SSE events, cancellation, and result-review handoff. AI revision proposals use the same model selection. No settings UI yet stores keys or base URLs or runs connection tests; keys remain server environment variables.

This integration excludes a separate process bridge, a browser Part runtime, shell/network/write/approval tools, and an automatic semantic Extractor/Evaluator. The next real-provider settings, connection-test, and quality-validation scope is defined in [`roadmap.md`](roadmap.md).
