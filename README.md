# NOVAIL: A Novel Workspace Built for Human Collaboration

NOVAIL is a web application for working with long-form manuscripts, plans, feedback, revision candidates, and versions. **Generating a candidate and adopting it into the official manuscript are separate actions**; saving a direct edit does not change the official working copy.

> Implementation scope: this single-user implementation supports the first end-to-end collaboration flow in the provided `novail.md` specification. It does not claim completion of all M0-M3 milestones or passage of all AT-01-28 acceptance tests. See the scope and limitations below.

## Getting started

NOVAIL requires Node.js **24.22.0 or later** and pnpm **12.5.1**. The repository pins
`.node-version` to `24.22.0` and `packageManager` to `pnpm@12.5.1`, matching the Docker build.
Apply the Node version with your version manager and install the pinned package manager:

```sh
npm install --global pnpm@12.5.1
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://localhost:3000`. The initial work, **Night of the Blue Seal**, includes a harbor blockade, protected prose, an early clue, and its payoff in chapter 18.

### Run with PostgreSQL

```sh
docker compose up --build
```

Open `http://localhost:8080`. PostgreSQL 18 data persists in a Docker volume. Do not expose the default development database password, and change it for any real deployment.

To run only the Node server, create `.env` from `.env.example` and set `DATABASE_URL`. Without `DATABASE_URL`, state is written atomically to `app/data/local-state.json`. File mode is for single-process development; use PostgreSQL with multiple workers.

### Connect a real model

```dotenv
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API=chat-completions
# Optional default; otherwise select a model in the web UI.
OPENAI_MODEL=
```

The Agent runs path requires an OpenAI-compatible Chat Completions API that supports SSE streaming, function tool calls, and strict JSON Schema output together. Not every provider or model advertised as "OpenAI-compatible" supports this combination. NOVAIL validates the final JSON again against its local schema, every selected ID, and protected-prose requirements.
The key stays on the server and is never included in browser responses. Without a key, the UI clearly identifies **Local example (not AI)** mode. Provider failures are never hidden behind example responses. NOVAIL does not guarantee a real model's literary quality or a provider's data-retention policy.

The key and base URL are read from `.env` when the server starts. Select the execution model in the web UI under **Agent runs** or **AI revision proposal**; `OPENAI_MODEL` is only an optional default. The chosen model is frozen on the run, so later default changes do not affect it. For compatible servers without a model-list endpoint, you can enter a model ID directly. The browser receives only the model catalog and execution status, never the secret key.

After configuration, you can check the standard model catalog and, only with explicit consent, exercise a real Part tool loop.

```sh
pnpm provider:check
pnpm provider:check --generate # Requires OPENAI_MODEL in the CLI; may make a real call and consume quota.
pnpm start
```

The default check uses only an authenticated `GET /models`. A compatible proxy without a model-list API is reported honestly as `MODEL_CATALOG UNAVAILABLE`; NOVAIL does not infer generation, streaming, tool, or strict-schema support. Only `--generate` creates an isolated NOVAIL Part run to verify real SSE, the read-only tool loop, and the strict JSON result path.
To connect a personal Codex account through Router4U, follow the gateway installation, sign-in, and project-key procedure in [`docs/router4u.md`](docs/router4u.md), while using the same `.env` and ordinary NOVAIL commands.

The default API protocol is `OPENAI_API=chat-completions`. Set `OPENAI_API=responses` for Responses-only models or Codex routes. The Part Responses adapter then handles `/responses`, `text.format`, `max_output_tokens`, and tool history. The model and protocol are frozen when a run is registered.
If a run fails, open **Agent runs -> Failure diagnostics** to inspect the stage, HTTP status, cause code, and request ID, and to copy a safe log. Diagnostic logs exclude keys, manuscript input, and raw provider error bodies.

### Continue in another environment

On Node 24.22.0 or later, run `pnpm install --frozen-lockfile` and `pnpm build`, prepare that environment's private `.env`, and start with `pnpm start`. Keys, OAuth credentials, and manuscript state files are not committed to Git. To continue an existing manuscript, separately back up and migrate the PostgreSQL database or `NOVAIL_DATA_FILE` that is actually in use.
When moving Router4U too, preserve both volumes as described in the [gateway guide](docs/router4u.md), and do not run the old and new installations simultaneously with the same OAuth credentials. Recreate any former DIM URL and `/tmp` file path in the new environment.

### Development

```sh
pnpm dev:api
# In another terminal
pnpm dev
```

Vite uses port 5173 and the API uses port 3000. Set `PORT` to change the API port. In production builds, the API server serves `dist/` directly.

### Agent runs

In the web UI's **Agent runs** tab, choose scenes, plans, and execution budgets; inspect recent run history and SSE progress events; cancel a run; or open its generated Change set in **Revision review**. Generated results are always proposals awaiting review and are never adopted automatically.

This path pins the experimental [`@slop-lab/part` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part/v/0.1.0) and [`@slop-lab/part-plugins` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part-plugins/v/0.1.0) packages to exact versions. Their source reference is [`slop-lab/part`](https://github.com/slop-lab/part). See [`docs/runtime.md`](docs/runtime.md) for allowed tools, budget and usage semantics, queue recovery, public APIs, and limitations.

## Workflow

1. Select a scene from the left list to inspect its text and related context.
2. After editing directly, use **Save draft** to preserve work that has not been adopted.
3. Enter feedback or use the directly edited manuscript to create a revision candidate.
4. Compare the candidate's before and after text and inspect affected review targets. Inclusion in the review set does not automatically rewrite another scene.
5. **Adopt** checks the hash, current head, and protected prose, then creates a new snapshot. Generating a candidate alone does not move the head.
6. Restore earlier content or export a Markdown manuscript from Versions. A restore creates new history too.
7. Under **Versions -> Working-copy snapshots**, download Markdown, DOCX, and a manifest for the selected version. Unadopted drafts are excluded.
8. Under **Publish edition**, inspect the scene list, length, and manifest hash, then approve an immutable edition inside the workspace. This does not publish to an external bookstore or platform.
9. The next edition is recorded as an explicitly approved revision of the latest edition. Editing or restoring the working manuscript never changes earlier edition content or downloads.
10. Under **Versions -> Working branches**, create a new branch from the current working copy or a past snapshot with recorded context. Creation does not switch branches, and drafts, candidates, and feedback remain on the source branch.
11. Switching branches reloads that branch's manuscript, plans, drafts, candidates, and Agent runs. Complete or cancel active work before switching.
12. A feedback repair or direct proposal can group multiple scenes and plans into one change set. Review changed and unchanged affected targets, then have a human explicitly adopt it.
13. To adopt only part of a root change set, choose independent atomic bundles and create a child change set. A child cannot be derived again, and a merge proposal cannot be partially adopted.
14. To merge another branch, first create a two-parent preview, choose source, target, or a custom value for every conflict, and seal it. A sealed merge remains a separate change set; the canonical manuscript changes only after another review and explicit adoption.
15. In a change set's **Human evaluation**, use the feedback or proposal reason as evaluation criteria and quote exact passages from the before and after text to record `fulfilled`, `violated`, or `unknown`. Evaluation only appends history; it neither performs nor replaces adoption.

## Implemented foundations

- React 19 / TypeScript / Vite English writing UI with planning, timeline, Revision review, and Versions views
- Hono API, Zod input validation, idempotency keys, and conflict detection
- PostgreSQL transactions and row locks, with file storage as an alternative
- Separation of candidates from the official manuscript, head-race checks, SHA-256 candidate hashes, and protected-prose checks
- Snapshot retention and restore, audit records, and outbox records
- Cycle-safe traversal of semantic dependencies and long-range review-target marking
- Unicode code-point span validation and browser UTF-16 offset conversion
- Readiness checks for required context budgets, unresolved decisions, disclosure policies, and boundary conditions
- Contradiction detection for relative time constraints, preserving insufficient evidence as `unknown`
- Durable run/job queue, atomic call reservations, lease fencing, and rejection of late results after cancellation
- Persistent run events and SSE reconnection through `Last-Event-ID`
- Part `createAgent` model loop, three frozen read-only tools, call/tool/token/per-invocation-output/deadline budgets, and cancellation
- Agent runs scope and budget composer, recent history, public SSE progress, usage, and result-review handoff
- Per-snapshot Markdown, DOCX, and manifest exports that preserve Korean text, special characters, and line breaks
- Edition approval bound to a content hash and the head observed during review, separate revision approval, and immutable edition, approval, audit, and outbox history
- Working-branch creation and switching from a shared snapshot, per-branch isolation of drafts, plans, candidates, and Agent runs, and rejection of writes from another branch even when heads match
- Migration of existing works to a default branch while preserving existing snapshot and candidate hashes and editions
- V2 change sets covering scenes, plans, dependencies, and layout; indivisible atomic bundles; and root-only partial selection and derivation
- Review that distinguishes changed targets from unchanged affected targets, with explicit human approval bound to the change set hash, base workspace hash, and current head
- Two-parent branch merge previews, explicit resolution of scene/plan/dependencies/layout conflicts, separate adoption after sealing, and merge-ancestor recording
- Feedback links for awaiting-decision, partially-applied, applied, and reopened states; preservation of known usage from cancelled jobs; and rejection of late results
- Human-authored evaluations bound to a frozen change set and exact source quotations, with hash-linked append-only history and preservation of historical reports that no longer match the current baseline

## Remaining specification scope

- The current API uses UI-oriented `/api` routes and camelCase contracts. It is not fully compatible with the complete `/v1/projects/{project_id}` resource and snake_case contract in section 18 of the specification.
- The storage model is a JSONB aggregate document. The normalized Artifact/Revision/Graph tables, composite foreign keys, and individual Revision queries from section 16 are not yet implemented.
- This is a single-user workspace. Multi-user sign-in, role-based ACLs, blind Reviewer access, and per-project model-transmission policies must be added before a full deployment.
- Global P0-P6 planning automation, separate Extractor/Evaluator services, evidence-based state projection, semantic diffs, and full-manuscript completion searches do not yet reach the complete specification.
- Atomic bundles spanning multiple artifacts, partial adoption at independent bundle boundaries, and two-parent branch merges are implemented. However, impact analysis is a conservative heuristic based on dependencies, identifiers, and rules; it does not prove semantic correctness. Merging plans, dependencies, and layout also requires explicit choices rather than claiming automatic semantic integration.
- Branch rename and deletion and external publishing-service integration are excluded. Partial derivation of merge change sets and recursive derivation of child change sets are intentionally forbidden.
- Snapshots created before branch support may not contain planning context. Branching from such a snapshot is blocked; start from the current baseline or a newer snapshot with recorded context. NOVAIL does not invent missing historical settings from current settings.
- A run executes one candidate unit of work. General multi-job DAGs, iterative revision policies, and provider-specific monetary accounting remain incomplete. If usage is unknown after lease expiration, reservations remain held and the run fails, requiring an explicit new run.
- If the provider does not report model usage, NOVAIL conservatively charges the entire reserved per-invocation output limit; this is not a claim about actual consumed tokens. NOVAIL does not claim to eliminate possible provider charges when failure or cancellation occurs after a response but before persistence.
- The Part path has no shell, network, write, or approval tools; separate process bridge; browser Part runtime; or automatic semantic evaluator. The existing single-scene V1 direct-gateway compatibility path is not considered a Part execution.
- Authentication, access control, backup and restore, and load validation are required before exposing the service publicly. The default mode is for a trusted personal development environment.

## Verification

```sh
pnpm check          # Full working-tree QG rules, typecheck, tests, and production build
pnpm hooks:install  # Install the local pre-commit hook once per clone
pnpm check:staged   # Reproduce the complete staged pre-commit gate
```

QG **0.1.0** and its optional JS rules are pinned exactly. See
[the quality-gate guide](docs/quality-gate.md) for scan semantics, CI, rule selection,
and the existing directory-size warning. Individual `pnpm typecheck`, `pnpm test`,
and `pnpm build` commands remain available for focused development.

Tests avoid pinning generated prose. They check source preservation, approval boundaries, stale bases, protected prose, idempotency, time constraints, spans, cancellation, leases, budget reservations, SSE recovery, V2 Change sets, partial derivation, and merges. Real paid-provider calls must be checked separately in an environment with an API key.

See [`docs/runtime.md`](docs/runtime.md) for the runtime and public-progress contract, [`docs/router4u.md`](docs/router4u.md) for connecting a personal Codex account through Router4U, and [`docs/branches.md`](docs/branches.md) for branch APIs and compatibility.
See [`docs/revisions.md`](docs/revisions.md) for V2 change-set, partial-derivation, and merge contracts, [`docs/editions.md`](docs/editions.md) for edition APIs and preservation contracts, and [`docs/evaluations.md`](docs/evaluations.md) for the human-evaluation contract. Unimplemented priorities and completion criteria are tracked in [`docs/roadmap.md`](docs/roadmap.md).

## Code structure

```text
src/                    English editing UI and API client
app/                    API, persistent storage, candidate/version domain, model gateway
packages/domain/        Readiness, Unicode spans, and time-constraint checks
packages/execution/     Run/job leases, reservations, worker, and SSE
packages/revision/      Change sets, impact review, partial derivation, and merge lineage
DESIGN.md               Design tokens, screens, and accessibility rules
docs/                   Runtime, Router4U, branch, revision, edition, evaluation, and roadmap contracts
compose.yml             PostgreSQL and application runtime configuration
```

Obsolete DIM lifecycle configuration has been removed. An ordinary workspace does not need a `.dim` directory.
