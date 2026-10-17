# NOVAIL Design System

## 0. Research Log
- Embedded references: shortlisted Claude, Notion, Wired → picked Minimalist UI + Claude because NOVAIL needs editorial gravity, warm paper, and calm high-density controls rather than a generic dashboard.
- Lazyweb: 1 query, 2 shipped screens viewed (Butterdocs collaborative editor and a document-review product) → three-zone 20/55/25 shell, stable manuscript canvas, contextual review on the right, global actions in the header, and one expanded recommendation at a time.
- UI/UX database: attempted the required design-system query; skipped because Python is unavailable in the workspace image. Applied its documented 4px rhythm, 44px targets, semantic state, and accessible form guidance.
- Imagen drafts: skipped — no image-generation tool is available in this runtime.
- Existing UI: greenfield; there were no UI components to audit. API server work is independently owned and not a visual reference.

## 1. Atmosphere & Identity
NOVAIL feels like a private midnight editorial room opening onto a sheet of cream manuscript paper: quiet, precise, and distinctly human. Its signature is the **teal revision thread**—a fine vertical line and seal-like markers that connect feedback, candidate revisions, and immutable history without making AI the author. Dark navy navigation frames an off-white reading surface; adoption is always an explicit human act.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---:|---|
| Navigation | `--nav` | `#101c2c` | Left rail, deep focus surfaces |
| Navigation raised | `--nav-raised` | `#17273a` | Active scenes, hover |
| Navigation text | `--nav-text` | `#dce5e4` | Primary text on navy |
| Navigation muted | `--nav-muted` | `#8fa1aa` | Metadata on navy |
| Canvas | `--canvas` | `#ebe9e1` | Workspace surround |
| Paper | `--paper` | `#fbfaf5` | Manuscript and elevated forms |
| Paper inset | `--paper-inset` | `#f3f1e9` | Secondary blocks |
| Ink | `--ink` | `#182321` | Primary text |
| Ink soft | `--ink-soft` | `#53605d` | Secondary text |
| Ink faint | `--ink-faint` | `#7b8581` | Metadata |
| Rule | `--rule` | `#d9d8cf` | Structural borders |
| Rule strong | `--rule-strong` | `#c5c8be` | Active boundaries |
| Teal | `--teal` | `#176b66` | Primary action, active revision |
| Teal bright | `--teal-bright` | `#2e8a82` | Hover and focus |
| Teal wash | `--teal-wash` | `#deece8` | Selected feedback, tags |
| Amber | `--amber` | `#9a6818` | Review pending |
| Amber wash | `--amber-wash` | `#f4ead3` | Pending state surface |
| Success | `--success` | `#396b4a` | Saved and committed |
| Danger | `--danger` | `#9b413b` | Errors, reject action |
| Focus | `--focus` | `#2c7f9e` | Accessible focus ring |
| Scrim | `--scrim` | `rgb(10 18 25 / 54%)` | Modal isolation |

Rules: color is semantic, never decorative; every colored state also has a label or icon. Teal is reserved for current position and adoptable action. No raw color values outside the token declaration block.

## 3. Typography

Font families: UI uses self-hosted `Noto Sans KR` (400/500/600/700), then system sans; manuscript uses self-hosted `Nanum Myeongjo` (400/700), then `Batang`, serif. Fontsource Unicode subsets ship with the app to avoid missing Korean glyphs on devices without CJK fonts. Third-party font requests are not required.

| Token | Size / line-height | Weight | Usage |
|---|---|---:|---|
| `--type-display` | `2rem / 1.25` | 700 | View title |
| `--type-h1` | `1.5rem / 1.35` | 700 | Scene title |
| `--type-h2` | `1.125rem / 1.4` | 700 | Panel heading |
| `--type-body` | `1rem / 1.6` | 400 | UI body and inputs |
| `--type-manuscript` | `1.125rem / 2` | 400 | Korean prose |
| `--type-small` | `0.875rem / 1.5` | 500 | Metadata and buttons |
| `--type-caption` | `0.75rem / 1.4` | 600 | Labels and badges |

Manuscript measure is 38–42 Korean glyphs per line. Serif is content-only; all controls remain sans. Numeric revision and timing metadata uses tabular numerals.

## 4. Spacing & Layout

Base unit is 4px. Tokens: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`, `--space-10: 40px`, `--space-12: 48px`, `--space-16: 64px`.

Shell: `100dvh`, header fixed in row one, tab bar fixed in row two, workspace in `minmax(0, 1fr)`. Desktop workspace columns are `248px minmax(420px, 1fr) 332px`; only each declared panel body scrolls. Tablet collapses project navigation into a drawer. Below 760px the manuscript is primary, the context panel becomes an overlay sheet, and tabs are horizontally scrollable. Content must reflow at 375px with no primary horizontal overflow.

Content measures: `--measure-ledger: 900px` keeps history readable, `--measure-dialog-wide: 680px` supports manifest inspection, `--measure-dialog-merge: 880px` supports side-by-side branch resolution, `--measure-preview: 240px` bounds proposal rails and long scene lists with an explicit inner scroll owner, and `--measure-runtime-history: 280px` keeps the execution list subordinate to its active detail.

Radii: `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px`. Icons: `--icon-sm: 16px`, `--icon-md: 18px`, `--icon-lg: 22px`. Controls have a minimum 44px hit area.

## 5. Components

### Button
- **Structure**: semantic `button`, Lucide icon, short label.
- **Variants**: primary teal, secondary paper, quiet, danger.
- **Spacing**: 44px minimum height, `--space-2`/`--space-3` gaps.
- **States**: hover tonal shift, active scale, visible focus, disabled opacity, loading text.
- **Accessibility**: icon-only controls require `aria-label`; native disabled semantics.
- **Motion**: micro token; transform/opacity only.

### Navigation item
- **Structure**: button with icon/status marker, label, optional meta.
- **Variants**: global, scene, tab.
- **States**: current includes marker plus contrast, never color alone; hover/focus/disabled.
- **Layout**: cluster; labels wrap or ellipsize deliberately.

### Status badge
- **Structure**: icon/dot plus text.
- **Variants**: saved, draft, pending, committed, protected.
- **Accessibility**: complete state text is always visible or screen-reader labeled.

### Editorial field
- **Structure**: visible label, input/textarea, helper or inline error.
- **States**: default, focus ring, disabled, loading, error.
- **Layout**: stack with `--space-2`; never placeholder-only.

### Feedback/revision item
- **Structure**: state rail marker, scope, prose, metadata, contextual actions.
- **Variants**: feedback, generated candidate, manual candidate, committed/rejected.
- **States**: only selected item expands; loading and empty are explicit.
- **Layout**: stack; the right panel body is its scroll owner.

### Dialog / mobile sheet
- **Structure**: native dialog semantics, title, labeled fields, footer actions.
- **States**: open, submitting, inline error.
- **Accessibility**: Escape closes, focus remains within, close control is explicit.
- **Motion**: standard opacity + transform; reduced-motion removes transform.

### Workspace shell
- **Structure**: global header / mode tabs / three-zone workspace.
- **Layout**: fixed-sidenav shell plus manuscript and contextual aside; each panel declares its own scroll owner.
- **Responsive**: navigation and context become explicit drawers; manuscript never disappears.

### Edition ledger
- **Structure**: two explicit sections—working snapshots and published editions—with immutable metadata, source references, and grouped export actions.
- **Snapshot states**: current, historical, preview loading/error, and approval-ready. Restore remains separate from publication.
- **Edition states**: populated ledger or a bordered empty state; published cards never expose edit, overwrite, or delete controls.
- **Approval dialog**: native dialog with publication title, frozen manifest summary, scene ledger, and a required human approval checkbox. Later editions name the predecessor and require revision approval.
- **Responsive**: cards use a metadata/action split at 1440px, collapse to a single readable column by 768px, and keep every export/publish target at least 44px at 375px.
- **Accessibility**: loading and errors are textual, failed previews and publications keep the dialog context intact, hashes wrap without horizontal scrolling, and every download states its format.

### Branch controls
- **Structure**: a compact current-branch marker in the global header; the Versions ledger owns the branch switcher, explicit refresh action, create-from-snapshot action, and branch lineage metadata.
- **Create semantics**: creation copies the selected snapshot's canonical scenes and plans only. Saved drafts, feedback, candidates, and runs remain on the source branch; creation never switches branches automatically.
- **States**: current, switch-ready, busy-disabled, unavailable legacy snapshot, submitting, stale-scope error, and recoverable external-change warning. Unavailable snapshots explain that recorded narrative context is missing rather than exposing a dead action.
- **Safety**: switching and explicit refresh confirm before leaving dirty editor text, retain dirty text after cancellation or failure, and clear it only after the requested branch is displayed successfully.
- **Accessibility**: every select has a visible label, branch identity remains text-visible in the shell, lineage is not color-only, and errors are announced through the existing status toast.
- **Mobile shell**: prioritize the current branch name over the duplicated tab title in the header; long names ellipsize with their full text retained in a title attribute and the branch selector.
- **Motion**: branch changes use no decorative transition; the selected name changes only after the server confirms the requested scope.

### Revision workspace V2
- **Structure**: proposal rail / selected proposal review / action bar. The rail separates V2 change sets from legacy candidates; legacy items expose promotion or rejection, never direct adoption.
- **Proposal anatomy**: reason and provenance, immutable hash, bundle checkboxes, full before/after artifact values, mechanical validation, human narrative review, impact acknowledgments, and blocked reasons.
- **Partial adoption**: selection is bundle-based. A derived proposal is visibly a fresh review object with a new hash; it never inherits prior acknowledgments.
- **Impact semantics**: `reviewSet` and `rewriteSet` are presented as different concepts. Unchanged affected targets require an explicit checkbox before adoption. Mechanical validation cannot imply narrative approval.
- **Composer**: manual and AI repair modes share the editorial-field primitive. The current scene may be preselected, while every additional scene/plan is an explicit human choice. Destructive removal requires a separate confirmation checkbox. Atomic mode explains that all selected artifacts succeed or fail together.
- **States**: empty, loading, selected, stale, incomplete, issue-blocked, unacknowledged, derived-review-required, accepted, rejected. Blocked actions name every reason in text.
- **Responsive**: the rail stacks above review below 960px; artifact comparisons become one column below 760px; action bars wrap without hiding the decision label.

### Merge preview dialog
- **Structure**: source branch selector in Versions, then a wide dialog with immutable source/target identity, preview hash, per-artifact resolution, and seal action.
- **Resolution**: conflicts require source, target, or custom. Clean changes default to source but remain overridable. Plan and dependency/layout graph differences always require an explicit choice.
- **Custom editing**: scene and plan editors retain all non-edited metadata. Graph/layout custom values use labeled JSON fields with safe parse errors; invalid input stays in place.
- **Safety**: opening captures target branch, head, and workspace hash. Stale errors preserve all choices. Closing or unloading with custom unsaved values requires confirmation. Sealing only creates a V2 proposal; review and adoption remain separate.

### Evidence evaluation workspace
- **Purpose and separation**: an evaluation report is a human-authored, append-only assessment attached to one frozen V2 change set. It never adopts a proposal, changes impact acknowledgements, runs a model, or converts mechanical checks into narrative judgment. The heading and primary action use `사람의 수동 평가` and `평가 보고서 저장`; AI language is prohibited in this surface.
- **Structure**: inside the selected proposal review, a full-width evaluation section follows the immutable artifact diffs and precedes the existing impact/adoption action bar. It contains (1) a prominent source/binding warning, (2) four compact mechanical check rows, (3) editable criterion cards, (4) a separate append-only report history. At desktop, each criterion uses a `minmax(0, 1fr) / 240px` assessment split; at tablet and mobile it becomes one column.
- **Source provenance**: feedback or change-set-reason sources are shown with their exact full text, availability, source kind, and hash state. Missing sources use danger text plus `근거 원문 없음` and disable source-derived actions. Criteria loaded from exact `defaultCriteria` retain `verbatim_source`; editing their text changes formulation to `human_refinement` while retaining every basis reference. Duplicate/refine and split actions retain source basis; a new user criterion is `human_authored` with an empty `basisRefs` array.
- **Criterion states**: each card has formulation provenance, editable formulation text, explicit verdict controls (`충족`, `위반`, `알 수 없음`), rationale, citations, duplicate/refine, split, and remove actions. Known verdicts require non-empty rationale and at least one exact citation; unknown may omit citations. Errors remain adjacent to the affected criterion and saving failure never clears input.
- **Citation picker**: choose one frozen changed entry, `이전` or `제안`, and one available textual field (`text`, `summary`, `storyTime`, `description`). Null, missing, graph, layout, and non-text fields are disabled rather than coerced. The complete immutable source appears in a selectable textarea; `선택 구절 인용` records the exact untrimmed substring using Unicode code-point offsets and WebCrypto SHA-256 of the full source. A `전체 원문 인용` shortcut is available. Every saved citation displays artifact title, side, field, code-point span, full-source hash, and exact quote with a clear remove action.
- **Mechanical checks**: show exactly four translated rows—무결성, 작업 공간 스키마, 보호 문장, 시간 제약—with pass/fail/unknown labels and the backend message/code. Temporal unknown is described as `구조화된 시간 제약 없음`; the UI must not parse prose time or imply a semantic pass.
- **History**: structurally valid reports remain visible as read-only ledger cards even when their evidence can no longer be verified. Each criterion shows its formulation, exact basis source kind, feedback ID or change-set reason quote, source hash, rationale, and citations. `evidenceValid: false` gets a danger integrity notice with every reason; `current: false` gets a separate `현재 기준과 다름` notice. Invalid envelopes alone use the prominent `손상된 보고서 봉투` card and never partially render untrusted content. Binding failures are named as target-binding failures rather than history corruption.
- **CAS, dirty state, and reload**: saving uses the loaded `currentHead`, `currentWorkspaceHash`, and `latestReportId`. A stale/CAS failure keeps all edits and presents `서버 기록이 달라졌습니다`. Criteria changes participate in the shell’s single unsaved-work guard for proposal, tab, project, branch, scene, explicit server reload, and browser unload navigation; cancellation preserves the draft, while dirty state clears only after a successful save or completed navigation. `서버 상태 다시 불러오기` reuses that guard rather than registering a second confirmation path. Drafts reset only when selected proposal or working branch changes. Late responses from a prior proposal/branch are ignored.
- **States**: loading, editable default, editable latest-valid revision, saving, saved, stale proposal, unavailable source, stale CAS, corrupt history, non-actionable binding, and empty history. Source and binding warnings appear before form controls and use icon + text, never color alone.
- **Responsive**: at 1440px criterion editing and verdict controls share a balanced split; at 768px history and forms stack without reducing source readability; at 375px buttons wrap to full-width where needed, provenance/hash strings wrap anywhere, source selection controls become a single column, and no citation quote causes horizontal overflow.
- **Accessibility**: criterion cards are labeled fieldsets; verdicts are native radios; all source, side, and field controls have visible labels; validation and stale errors use `role=alert`; load/save status uses `aria-live=polite`; selected quote remains visible as text; exact hashes and spans are copyable text, not title-only disclosure. Keyboard users can create a citation entirely through textarea selection and buttons.

### Agent runtime monitor
- **Purpose and separation**: `에이전트 실행` is an operational ledger for creating a bounded `repair_bundle`, watching its public progress, and opening the resulting V2 proposal. A completed run never changes the manuscript by itself; the existing `개정 검토` surface remains the only adoption path.
- **Entry and shell**: the existing workspace tab row gains one text-visible entry. The page uses the ledger measure and one `secondary-view` scroll owner. Runtime identity, composer, active detail, and latest-50 history are sections in that order; no modal is required for ordinary monitoring.
- **Runtime identity**: show runtime name, Part version, model label, and current server configuration. `local-demo` must be labeled `AI가 아닌 로컬 예제`; `openai-compatible` is labeled as the current server mode, never as historical run provenance. Read-only tool IDs appear as a compact disclosure, with no approval control.
- **Composer**: reuse editorial fields, native checkboxes, and button primitives. Users choose at least one current scene or plan, write a repair instruction, and may edit all six bounded budget fields. Defaults and min/max constraints come from `/api/runtime-info`; related output-token constraints are explained inline and validated before launch.
- **Active detail**: a teal revision thread connects chronological public events. Text deltas render only as plain text in `pre`; model steps report ordinal and token usage, tool steps expose allowlisted read-only tool IDs and outcomes, and gaps/truncation are explicit. Never label public text as hidden reasoning or chain-of-thought.
- **Usage and cancellation**: reserved model calls, reserved output tokens, actual known tokens, and actual output tokens use tabular figures. Cancel remains available while the run is non-terminal, including reconnecting states, and disappears only after a terminal summary is confirmed.
- **Durability and reconnect**: reload restores the newest 50 branch-scoped summaries. Selecting a non-terminal run reconnects with `Last-Event-ID`; an expired cursor clears local events, reloads detail, and reconnects once from the beginning. Terminal states stop the stream and all retry timers. Branch or run changes abort the old stream and late events are ignored.
- **Result handoff**: `결과 검토 열기` is enabled only when the terminal summary has a `resultRef`. It uses the shell’s existing unsaved-work guard, opens the exact V2 proposal, and preserves the run ledger in history.
- **States**: runtime loading/error, history loading/empty/error, ready composer, launching, queued, running, reconnecting, awaiting decision, completed, cancelled, and failed. Errors remain in context with an explicit retry; no polling or reconnect loop may run without bounded delay.
- **Responsive**: at 1440px active detail and history form a `minmax(0, 1fr) / 280px` list-detail split; at 768px history stacks below detail; at 375px budget fields, scope choices, actions, usage, and event metadata become one column. IDs and model/tool labels wrap anywhere, while event text keeps readable wrapping and never creates horizontal page overflow.
- **Accessibility**: all budget and scope controls have visible labels, event history is an ordered list with `aria-live=polite` only on the newest status summary, reconnect/error messages use textual status, and every icon action has a label. Runtime color is always paired with state text.

## 6. Motion & Interaction
Tokens: `--motion-micro: 120ms ease-out`, `--motion-standard: 220ms cubic-bezier(.2,.8,.2,1)`, `--motion-emphasis: 360ms cubic-bezier(.16,1,.3,1)`. Motion communicates selection, drawer ownership, and completion only. Save/commit confirmation uses a brief opacity transition. Animate only transform and opacity. Under `prefers-reduced-motion: reduce`, all non-essential transitions resolve immediately.

## 7. Depth & Surface
Strategy is mixed but restrained: tonal shifts establish the shell, one-pixel warm rules establish panel anatomy, and elevation is reserved for dialogs/drawers. Tokens: `--shadow-float: 0 16px 48px rgb(12 23 29 / 16%)`, `--shadow-paper: 0 1px 0 rgb(255 255 255 / 70%), 0 8px 28px rgb(20 31 35 / 6%)`. The manuscript resembles stacked paper through a top highlight and whisper shadow; ordinary panels never float.

## 8. Accessibility Constraints & Accepted Debt
Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text and UI boundaries, complete keyboard reachability, 44px targets, visible `:focus-visible`, labeled icon buttons, logical heading order, `aria-live=polite` for mutation status, and no color-only state. Forms keep visible labels and actionable errors. Dialogs have Escape routes. Text zoom to 200% must preserve tasks.

Personas: (1) a novelist writing for hours who needs low visual fatigue and draft confidence; (2) an editor navigating revisions by keyboard; (3) a collaborator on a narrow laptop who needs obvious pane ownership; (4) a low-vision user who needs text labels and strong focus.

Accepted debt: browser visual QA and screen-reader exercise are handed to the integration lead because this member owns frontend source only and the backend/tooling are being integrated concurrently. No known implementation debt is accepted.
