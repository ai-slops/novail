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

Content measures: `--measure-ledger: 900px` keeps history readable, `--measure-dialog-wide: 680px` supports manifest inspection, and `--measure-preview: 240px` bounds long scene lists with an explicit inner scroll owner.

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

## 6. Motion & Interaction
Tokens: `--motion-micro: 120ms ease-out`, `--motion-standard: 220ms cubic-bezier(.2,.8,.2,1)`, `--motion-emphasis: 360ms cubic-bezier(.16,1,.3,1)`. Motion communicates selection, drawer ownership, and completion only. Save/commit confirmation uses a brief opacity transition. Animate only transform and opacity. Under `prefers-reduced-motion: reduce`, all non-essential transitions resolve immediately.

## 7. Depth & Surface
Strategy is mixed but restrained: tonal shifts establish the shell, one-pixel warm rules establish panel anatomy, and elevation is reserved for dialogs/drawers. Tokens: `--shadow-float: 0 16px 48px rgb(12 23 29 / 16%)`, `--shadow-paper: 0 1px 0 rgb(255 255 255 / 70%), 0 8px 28px rgb(20 31 35 / 6%)`. The manuscript resembles stacked paper through a top highlight and whisper shadow; ordinary panels never float.

## 8. Accessibility Constraints & Accepted Debt
Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text and UI boundaries, complete keyboard reachability, 44px targets, visible `:focus-visible`, labeled icon buttons, logical heading order, `aria-live=polite` for mutation status, and no color-only state. Forms keep visible labels and actionable errors. Dialogs have Escape routes. Text zoom to 200% must preserve tasks.

Personas: (1) a novelist writing for hours who needs low visual fatigue and draft confidence; (2) an editor navigating revisions by keyboard; (3) a collaborator on a narrow laptop who needs obvious pane ownership; (4) a low-vision user who needs text labels and strong focus.

Accepted debt: browser visual QA and screen-reader exercise are handed to the integration lead because this member owns frontend source only and the backend/tooling are being integrated concurrently. No known implementation debt is accepted.
