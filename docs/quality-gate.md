# Quality gate and developer checks

## Toolchain and commands

Use Node 24.22.0 or later and pnpm 12.5.1, matching `.node-version`, the package
manifest, and the Docker build. Install dependencies with `pnpm install --frozen-lockfile`.
The published `@slop-lab/qg` and `@slop-lab/qg-rules-js` dependencies are pinned to
0.1.0; both require Node 24 or later.

```sh
pnpm check                         # Full working-tree rules plus all shared checks
pnpm exec qg check --full --rules-only  # Rules only; not the complete gate
pnpm hooks:install                 # Once per clone; does not download a hook-time CLI
pnpm check:staged                  # Complete pre-commit path, including shared checks
pnpm exec qg rules                 # Inspect loaded rules and their default metadata
pnpm typecheck                     # TypeScript frontend and shared contracts
pnpm test                          # Existing Node behavior and integration tests
pnpm build                         # TypeScript check plus production Vite assets
```

Without an installed global pnpm, prefix commands with `npx --yes pnpm@12.5.1`.
The pinned package manager must also be available on PATH for external QG checks.
Do not use an older pnpm to regenerate this lockfile: pnpm 12 records its package
manager in an additional lockfile document.

## Full versus staged inputs

`pnpm check` explicitly runs `qg check --full`, inspecting the full working tree,
not just a staged subset. The GitHub Actions workflow runs this command after a
frozen dependency install on pull requests and pushes to `main`.

Plain `pnpm exec qg check` defaults to staged paths and Git index contents. It is
not a substitute for a full scan. The installed pre-commit hook and
`pnpm check:staged` always select staged rule inputs, even if a default scan mode
changes later. Shared typecheck, tests, and build checks run against the working
tree in both modes. QG does not stash partial changes. Stage complete, tested
changes deliberately; a green working-tree check cannot prove an arbitrary
partially staged snapshot compiles.

Hook installation remains explicit (`installation: check`): QG warns when a hook
is missing or outdated rather than overwriting another hook. Do not force-replace
a custom hook without first migrating its checks. CI does not need a Git hook.

## Rule selection

The recommended language-independent rules remain enabled, including local-file
tracking prevention, file size/line limits, README and LF attributes, local
Markdown references, ASCII Markdown characters, and reasoned suppressions.
No source, documentation, example, or UI tree is excluded. Generated artifacts
such as the lockfile use QG's built-in generated-file classification. Ignored
browser captures under `.playwright-mcp/` and test-runner output under
`test-results/` are explicitly classified as generated artifacts as well;
they are not maintained examples or source files.

The optional `js-test-fixtures` preset explicitly activates the syntax-aware
directory-fixture-copy rule at error severity. `scripts/qg-rules.mjs` loads the
published `packageManagerRules` collection from the same optional package:
`package-manager/no-npm-lock-with-pnpm` rejects a competing npm lockfile, and
`pnpm/lockfile-is-current` resolves an isolated snapshot with install scripts
disabled to detect a stale lockfile. Installing a package alone does not enable
its rules.

The broader `js` / `js-directives` presets are not selected: this project checks
TypeScript through its existing compiler but does not typecheck its `.mjs`
backend. Adding `@ts-check` banners without actually checking that backend would
not establish a useful new quality boundary. Backend behavior is covered by the
existing Node suite. There is no invented lint or coverage target and no new
formatter dependency.

The existing `app/` directory has more than QG's default 50-file warning threshold
but fewer than its 100-file error limit. The warning remains visible; moving
modules solely to hide it would make this language-conversion change harder to
review. No limit is raised and no rule is suppressed for it.

The exact-package `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`
retain the repository's existing policy for the Part packages and admit the
reviewed QG 0.1.0 packages and their first-party runtime components. They do not
allow all future versions or disable release-age checks globally.

## English content and user data

Maintained documentation, product messages, and the bundled new-workspace
example are English. Stored manuscripts, names, quotations, and feedback are
never translated on load, render, migration, or export. Unicode test fixtures and
self-hosted Korean fonts intentionally remain to protect multilingual writing.
Internal enum values, IDs, API keys, and JSON formats retain their contracts.

## DIM configuration

An ordinary public-Git workspace requires no `.dim` directory. The removed files
were obsolete agent/Docker lifecycle scripts, including credential forwarding;
current DIM does not discover them as lifecycle hooks. Application `Dockerfile`
and `compose.yml` remain the supported local container recipes.

No `.dim/repos.yml` is added: Native Git repository import and policy selection
are explicit operator actions, not implied by this checkout. No host plugins,
reviewer identities, protected-branch policy, or GitHub publication permissions
are assumed. If an operator later adopts Native Git, prepare a reviewed manifest
against the current DIM reference and explicitly import or apply it. Removing
these files does not stop containers, delete volumes, change host policy, or
publish this branch.

## Upstream references

- [Official QG documentation](https://github.com/slop-lab/quality-gate)
- [CLI, hooks, and shared checks](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
- [Optional JS rules](https://github.com/slop-lab/quality-gate/tree/main/packages/rules-js)
- [Current DIM repository configuration](https://github.com/slop-lab/dev-infra-manager/blob/main/docs/guides/repository-configuration.md)
