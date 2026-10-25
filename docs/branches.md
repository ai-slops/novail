# Working Branch Contract

## Branches and retained scope

A work has one shared list of immutable snapshots and multiple working branches. Each branch points to its own head and list of visible snapshot IDs. Creating a branch neither recreates snapshot content nor switches the current branch.

Each branch workspace preserves:

- Adopted manuscript text, protected prose, plans, dependencies, and context versions
- Saved unadopted drafts, feedback, and revision candidates
- Runs, Jobs, execution events, and usage records

The current branch appears in the existing top-level workspace; inactive workspaces remain stored under their branches. Switching occurs in a short storage transaction. `head` always equals the current branch's `headSnapshotId`.

Published editions are **shared immutable records at the work level**. They remain readable and downloadable after switching branches, and each new edition records `sourceBranchId`. Existing edition manifests and hashes are never rewritten.

## Starting point for a new branch

- Creating from the current head copies the current branch's adopted manuscript, plans, and protection requirements.
- Creating from a past snapshot uses the manuscript and `narrativeContext` recorded at that time. Plans added later are not mixed in.
- Saved drafts, feedback, candidates, Agent runs, and Job records are not copied. They remain on the source branch.
- A human decides separately whether to switch after creating the branch.
- A legacy snapshot without historical planning context is blocked with `SNAPSHOT_CONTEXT_UNAVAILABLE`. The current head can still be branched because its actual working context is known, even when it originated from a legacy version.

The existing **Restore manuscript** operation creates a new commit from the selected snapshot's scene text. It does not claim to restore missing historical planning context. The new snapshot created after restoration records the current branch's actual planning context.

## API

`GET /api/state` returns `currentBranchId`, `branches`, and the current branch's snapshots, drafts, candidates, and Agent runs. Use a snapshot's `canBranch` field to determine whether branching is safe.

### Create

`POST /api/branches` with `Idempotency-Key` and `X-Novail-Branch-Id` headers:

```json
{
  "name": "Alternate Ending",
  "sourceSnapshotId": "<Snapshot read from the current branch>",
  "expectedBranchId": "<current branch id>",
  "expectedHead": "<reviewed head>"
}
```

A `201` response returns the new branch summary. Names must be unique within the work, and the current branch remains unchanged.

### Switch

`POST /api/branches/{target_id}/switch`:

```json
{
  "expectedBranchId": "<branch id before switching>",
  "expectedHead": "<head before switching>"
}
```

The `X-Novail-Branch-Id` header must equal `expectedBranchId`. Success returns the switched workspace. A queued, running, or paused Run blocks switching with `RUN_ACTIVE`. Candidates awaiting approval remain on the source branch and do not block switching.

### Scope of every mutation

New clients send `X-Novail-Branch-Id` on every mutation, including saving a draft, creating or adopting a candidate, starting an Agent run, switching works, and publishing an edition. The server rechecks the work and branch before asynchronous work and again inside the storage transaction.

Even when two branches share the same snapshot/head, a request from another branch is rejected with `BRANCH_MISMATCH`. A snapshot, candidate, or run outside the request's scope cannot be used. Snapshot download links include both `snapshotId` and `branchId`; published edition downloads are scoped to the shared work.

The current service shares one server-side selection for its single user. If different windows select different branches, mutations from the stale window are rejected. The UI preserves input and recovers through an explicit **Reload branch state** action. Per-user sessions and real-time collaborative editing are outside this feature's scope.

## Branch merges

A merge is a two-parent flow with the current branch as target and another branch as source. It never moves the head automatically and separates three stages:

1. Send `sourceBranchId`, the target's `expectedHead`, and `baseWorkspaceHash` to `POST /api/merge-previews`.
2. Review source/target changes and conflicts through `GET /api/merge-previews/{id}`, then send `previewHash` and each conflict resolution to `POST /api/merge-previews/{id}/seal`.
3. Sealing creates an atomic merge change set. Its hash and impact targets must still be reviewed and explicitly adopted before the target head advances.

If the source head, source workspace, target head, or target workspace changes between preview and seal, the request is rejected as stale. Source and target must differ, the source must have no active Run, and a source already included in the target's ancestry cannot be merged again.
A merge is blocked when there is no common ancestor or when multiple best common ancestors exist. When a common ancestor exists but historical context for an item is ambiguous, NOVAIL requires an explicit resolution instead of guessing.

Scene conflicts accept the source, target, or a schema-valid custom value. Plans, dependencies, and layout also require an explicit choice; NOVAIL does not claim automatic semantic merging. Protected prose preserves the union of both sides' requirements. Layout retains only surviving scene IDs and then appends missing scenes deterministically. Sealing never modifies the source.

A merge change set cannot be partially derived. On adoption, source-ancestry information is recorded on the new target snapshot. See `docs/revisions.md` for change-set approval, hash, and partial-derivation contracts.

## Idempotency and legacy clients

New idempotency records store both work ID and branch ID. A retry with the same request, key, and original branch returns the prior result; even if that result is a switch response, it does not perform the switch again. Reusing the key from another branch is rejected.

New requests record the work and branch interpreted by the server even when the header was omitted, so later scope checks still apply. A missing header alone does not make a record legacy. Legacy-compatible replay applies only when the stored record has neither a work ID nor a branch ID.

Headerless legacy requests are accepted when a work has only one branch. With two or more branches, `BRANCH_REQUIRED` requires explicit scope. Historical unscoped idempotency records are replayed only in headerless single-branch compatibility mode. The server never invents an explicit new request's scope and attaches it to a historical record.

## Migration

During store initialization, existing and archived works receive a stable default branch named `Main workspace`. Existing snapshot IDs, candidate IDs and hashes, and editions remain unchanged. Existing candidates and runs without a branch ID are interpreted as belonging to that work's default branch.

Jobs and events shared by earlier implementations are partitioned by the work that owns each run. Records whose owning run cannot be found are retained under `legacyExecution`, not deleted. Migration is repeatable.

Back up production data separately before upgrading. Ordinary execution does not create an automatic backup table.

## Exclusions

Branch rename and deletion, multi-user authorization, and a dedicated branch table or normalized store are future work. The shared snapshot store also remains inside the JSONB aggregate document, so performance is not guaranteed for very large works, many branches, or high concurrency. Merge impact and conflict classification are conservative structural and rule-based judgments, not proof that the work's meaning has been integrated correctly.
