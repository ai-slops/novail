# V2 Change set and Merge Contract

## Core principles

NOVAIL V2 separates **proposal generation**, **review**, and **canonical adoption**. A direct proposal, feedback-repair run, legacy V1 candidate promotion, or sealed branch merge only creates a change set for review. The canonical workspace and branch head change only after explicit human adoption.

A change set can contain scenes (`scene`), plans (`plan`), dependencies (`dependencies`), and layout (`layout`) together. Changes in one atomic bundle cannot be separated during partial selection.

The impact list is a conservative **review-assistance heuristic** calculated from dependencies, identifiers, and implementation rules. Inclusion never rewrites a target automatically, and reviewing the full list does not prove the work's semantic consistency.

## HTTP routes

The current contract uses UI-oriented `/api` routes and camelCase.

| Route | Role |
| --- | --- |
| `GET /api/revision-context` | Read the current `projectId`, `branchId`, `baseSnapshotId`, `workspaceHash`, and workspace |
| `GET /api/change-sets/{id}` | Read a Change set, state, and review requirements |
| `POST /api/change-sets` | Create a human-authored V2 Change set proposal |
| `POST /api/change-sets/{id}/derive` | Derive a child from selected changes in a root Change set |
| `POST /api/change-sets/{id}/commit` | Submit review evidence and a hash for explicit adoption |
| `POST /api/change-sets/{id}/reject` | Reject a proposal |
| `POST /api/candidates/{id}/promote` | Promote a legacy V1 candidate to a V2 Change set |
| `POST /api/feedback/{id}/resolve` | Close, defer, or reopen feedback |
| `POST /api/repair-runs` | Start a repair Run against selected scenes and plans |
| `POST /api/merge-previews` | Create a two-parent merge preview with the current branch as target |
| `GET /api/merge-previews/{id}` | Read a merge preview and its conflicts |
| `POST /api/merge-previews/{id}/seal` | Verify the preview hash and resolutions, then create an atomic merge Change set |

### Direct proposal

`POST /api/change-sets` accepts a strict schema and rejects unknown fields. A request can contain at most 50 changes.

```json
{
  "baseSnapshotId": "<reviewed current Snapshot>",
  "baseWorkspaceHash": "<reviewed workspace hash>",
  "reason": "Reason for the change",
  "changes": [
    {
      "kind": "scene",
      "artifactId": "scene-1",
      "after": {
        "id": "scene-1",
        "title": "First Scene",
        "chapter": 1,
        "status": "canon",
        "text": "Revised manuscript text",
        "summary": "Scene summary",
        "storyTime": "First night",
        "characters": [],
        "protectedQuotes": []
      }
    }
  ],
  "feedbackIds": [],
  "atomic": true
}
```

An input change has `kind`, `artifactId`, and `after`; `before` exists only on the response entry created by the server. `after` must satisfy the kind-specific Zod contract and can be `null` for kinds that support deletion. Artifact identity, such as a scene ID, cannot be changed within the entry, and protected prose must remain in the resulting text. `atomic` is optional and defaults to `false`. A successful request alone never advances the head.

## Review and explicit adoption

`POST /api/change-sets/{id}/commit` accepts an approval request of this form:

```json
{
  "expectedHead": "<head at review time>",
  "approvedHash": "<Change set hash>",
  "reviewedKeys": ["<reviewed unchanged affected target key>"],
  "decision": "accept",
  "policyVersion": 2
}
```

Immediately before adoption, the server rechecks that:

- The change set belongs to the current work and branch, is `pending`, and uses schema/policy version 2.
- `approvedHash` equals both the stored hash and the SHA-256 recalculated from the immutable payload.
- `expectedHead`, the proposal's base Snapshot, and its base workspace hash match current values.
- Impact calculation is complete and there are no validation issues.
- There are no unknown review keys and every required unchanged affected target has been reviewed.
- No Run is queued, running, or paused, and the origin Run was not cancelled.
- Parent and source bindings for a derivation or merge remain valid.
- The resulting workspace satisfies kind-specific schemas, identity rules, and protection requirements.

Any difference rejects the request instead of reusing stale approval. On success, NOVAIL creates a new snapshot and advances the branch head. Creating a change set, completing a run, creating a merge preview, or sealing a merge never substitutes for this operation.

The Change set hash covers its base, change entries, bundles, impacts, issues, review requirements, linked feedback/Run/candidate, parent information, and merge bindings. The workspace hash is calculated from canonical workspace JSON and does not depend on PostgreSQL JSONB key order.

## Root-only partial derivation

`POST /api/change-sets/{id}/derive` receives `changeIds` belonging to the root Change set.

```json
{
  "changeIds": ["<selected change id>"]
}
```

Partial derivation follows these rules:

- The parent must be a hash-valid, `pending`, root V2 Change set.
- A derived child cannot produce another child. Recursive derivation is rejected with `RECURSIVE_DERIVATION_FORBIDDEN`.
- A merge Change set cannot be partially derived.
- Every selected ID must belong to the parent, and an atomic bundle cannot be split.
- The child stores the parent ID, parent hash, and selected parent change IDs.
- Excluded parent changes remain required **unchanged** impact targets in the child's review.
- Child Adopt rechecks the parent hash, selection, bundles, policy, and origin Run.
- Adopting the child marks the parent `partially_applied`; the full parent cannot then be Adopted separately as a duplicate.

This feature lets a human structurally select independent bundles. It does not prove or infer a semantically safe minimum revision set.

## Feedback and Runs

Creating a Change set linked to feedback moves open feedback to `awaiting_decision`. Full Adopt links it as `applied`; partial child Adopt links it as `partially_applied`. Rejection reopens feedback that was awaiting that proposal.

An explicit feedback decision submits the current head, a decision of `close`, `defer`, or `reopen`, and a note. Cancellation never overwrites feedback already closed or deferred. Feedback shared by another live candidate or Change set is not treated as orphaned.

Output that arrives after cancellation was requested is never accepted as a candidate or Change set. Provider-reported known usage is still recorded once. Missing usage is distinguished as estimated; if usage is unknown after lease expiration, reservations remain held and an explicit new Run is required. NOVAIL does not claim to eliminate possible duplicate external charges when failure occurs after a model response but before persistence.

## Two-parent branch merges

`POST /api/merge-previews` requires this target context:

```json
{
  "sourceBranchId": "<branch to merge>",
  "expectedHead": "<current target head>",
  "baseWorkspaceHash": "<current target workspace hash>"
}
```

Source and target must differ, and the source must have no active Run. The target must match the submitted head and hash. A source already included in the target's ancestry cannot be merged again. The server calculates a three-way preview from the common Snapshot ancestor.

- An Artifact changed only on the source is brought in; content changed only on the target is retained.
- If both sides changed the same scene differently, it is a `both-changed` conflict. Resolve it with `source`, `target`, or a schema-valid `custom` value.
- Plan, dependency, and layout conflicts also require explicit resolution rather than automatic semantic integration.
- An unknown historical base is never guessed from a current value; it is treated as a conflict requiring an explicit choice.
- Resolution keys cannot be duplicated or unknown, and every conflict must be resolved.
- Protection requirements preserve the union of base, source, and target. Layout keeps surviving scenes and appends missing scenes deterministically.

The seal request submits the server-issued `previewHash` and per-conflict `resolutions`. The server recalculates the preview hash and verifies that neither source nor target head/workspace has changed since the preview. Success creates an atomic merge Change set bound to source, target, common base, resolutions, and protection requirements; it does not modify the source branch.

The sealed Change set still follows the explicit Adopt procedure above. After Adopt, the new target Snapshot records source ancestry. A merge Change set cannot be partially derived.

## V1 compatibility and limitations

Legacy V1 candidate create, commit, and reject routes remain for existing API consumers and stored-data compatibility. The new UI never Adopts a V1 candidate directly. It promotes the candidate through `POST /api/candidates/{id}/promote`, then performs V2 review. Promotion verifies the legacy candidate hash and base context; stale proposals remain unavailable for Adopt. V1 commit retains its original approval policy and is not equivalent to the V2 `reviewedKeys` policy.

Current implementation boundaries are:

- This is the UI-oriented `/api` and camelCase contract, not the specification's complete `/v1/projects/{project_id}` and snake_case resource API.
- This is a single-user workspace without authentication, role-based ACLs, or real-time collaboration.
- PostgreSQL stores a JSONB aggregate document rather than normalized Artifact/Revision/Graph tables.
- Impact analysis and conflict classification are conservative structural checks, not a formal proof of narrative meaning.
- NOVAIL does not claim completion of every M0-M3 milestone or passage of all AT-01-28 acceptance tests.
- Real paid models and full concurrency or performance stress have not been verified.
