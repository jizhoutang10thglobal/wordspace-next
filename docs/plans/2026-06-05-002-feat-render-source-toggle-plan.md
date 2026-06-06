---
title: "feat: Add render/source toggle to document viewer (S3 / F14)"
type: feat
spec: f14-render-source-toggle
status: completed
date: 2026-06-05
origin: specs/f14-render-source-toggle.md
---

# feat: Add render/source toggle to document viewer (S3 / F14)

## Summary

Adds a `#view-toggle` button to the status bar that switches `#doc-container` between a rendered HTML view and a read-only raw HTML source text view. The toggle is purely synchronous (no IPC on click — raw HTML is cached at startup). View state logic lives in a new pure module (`src/lib/view-mode.js`) so Vitest can unit-test it without Electron. The VA gate (`specs/f14-render-source-toggle.va.json`) already exists and is CODEOWNERS-locked — the implementation must not modify it.

---

## Problem Frame

Spec S3 (F14 narrowed) adds a one-click toggle so users can inspect the underlying HTML of the displayed document. The rendered view (default) shows formatted content via `innerHTML`; the source view shows the raw HTML string via `textContent` so the browser treats angle-bracket tags as literal text rather than markup. The spec depends on S1 (document loading/rendering in `#doc-container`) and S2 (status bar `#status-bar` with `#theme-toggle`).

**Scope boundary:** source view is read-only, no syntax highlight, no per-document state persistence, single built-in document only (see `specs/f14-render-source-toggle.md` for the complete Out of Scope list).

---

## Requirements

From `specs/f14-render-source-toggle.md`:

- **R1** Status bar toggle button with `id="view-toggle"` in `#status-bar`.
- **R2** Rendered view: `#doc-container.innerHTML = docHtml` (formatted headings/paragraphs).
- **R3** Source view: `#doc-container.textContent = rawHtml` (literal `<h1>…</h1>` visible as text, no XSS risk because `textContent` escapes tags).
- **R4** Toggle is purely synchronous — raw HTML cached at DOMContentLoaded, no IPC re-invoke on click.
- **R5** View state machine and display-mode decision extracted into `src/lib/view-mode.js` (no `require('electron')`, Vitest-testable).
- **R6** Preload `require`s view-mode + exposes via `contextBridge` as `window.api.view.*`; renderer uses `window.api.view.*` (no `require` in renderer — S3 lesson).
- **R7** `sandbox: false` already set in window-config — no change needed.
- **R8** VA file `specs/f14-render-source-toggle.va.json` already exists and must not be modified.
- **R9** `va-coverage.test.js` gate: because `requires_va: true` is already set and VA JSON exists, this gate already passes — confirm it stays green.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| View state representation | Two named strings: `'rendered'` / `'source'` | Matches the spec's vocabulary, explicit, easy to read in tests |
| `getDisplayMode()` return values | `'html'` vs `'text'` (not boolean) | Renderer switch is clearer; leaves room for a third mode without breaking callers |
| Raw HTML ownership | Cached as local `let rawHtml` in renderer.js DOMContentLoaded closure | view-mode.js is a pure module with no DOM/IPC access; the renderer already owns the IPC call and the DOM |
| Toggle sync constraint | No IPC on click; use cached `rawHtml` | Spec mandate; async re-fetch would make e2e flaky (VA snapshots taken immediately after click) |
| `#view-toggle` button placement | Inside existing `#status-bar`, alongside `#theme-toggle` | Spec mandates id and container; mirrors the theme toggle pattern already there |
| CSS for `#view-toggle` | Add selector to `theme.css` (external file) | CSP `default-src 'self'` blocks inline `<style>` — S4 lesson; never use inline styles |
| No change to window-config.js | `sandbox: false` already set from S3 | Preload can already `require('../lib/...')` custom modules |
| VA JSON | Already authored by human, CODEOWNERS-locked | Spec mandates `requires_va: true`; implementation AI must not write or modify it |

---

## High-Level Technical Design

Data flow at startup and on toggle:

```mermaid
sequenceDiagram
    participant Renderer as renderer.js
    participant API as window.api (preload/contextBridge)
    participant ViewMode as src/lib/view-mode.js
    participant DOM as #doc-container

    Note over Renderer: DOMContentLoaded
    Renderer->>API: getDocContent()
    API-->>Renderer: rawHtml (IPC, async, once)
    Renderer->>DOM: innerHTML = rawHtml  (initial render)
    Renderer->>Renderer: cache rawHtml; currentView = DEFAULT_VIEW

    Note over Renderer: User clicks #view-toggle
    Renderer->>API: view.toggleView(currentView)
    API->>ViewMode: toggleView(currentView)
    ViewMode-->>API: nextView
    API-->>Renderer: nextView
    Renderer->>API: view.getDisplayMode(nextView)
    API->>ViewMode: getDisplayMode(nextView)
    ViewMode-->>Renderer: 'html' | 'text'
    alt mode === 'html'
        Renderer->>DOM: innerHTML = rawHtml
    else mode === 'text'
        Renderer->>DOM: textContent = rawHtml
    end
    Renderer->>Renderer: currentView = nextView
```

Pure-module / preload / renderer layering:

```
src/lib/view-mode.js   ← pure Node.js, no electron, Vitest-testable
       ↑ require
src/renderer/preload.js ← require('../lib/view-mode'), contextBridge → window.api.view.*
       ↑ window.api.view.*
src/renderer/renderer.js ← caches rawHtml, wires #view-toggle, reads window.api.view.*
```

---

## Implementation Units

### U1. Pure view-mode state machine

**Goal:** Implement the view state machine and display-mode decision as a plain Node.js module with no Electron dependency.

**Requirements:** R5

**Dependencies:** none

**Files:**
- `src/lib/view-mode.js` (new)

**Approach:**
- Export `DEFAULT_VIEW = 'rendered'`
- Export `toggleView(current)` → returns `'source'` when current is `'rendered'`, otherwise `'rendered'`
- Export `getDisplayMode(view)` → returns `'html'` when view is `'rendered'`, `'text'` when view is `'source'`
- No `require('electron')`, no DOM access, no IPC — stays pure

**Test scenarios:**
See U2.

**Verification:** `node -e "const v = require('./src/lib/view-mode'); console.log(v.DEFAULT_VIEW, v.toggleView('rendered'), v.getDisplayMode('source'))"` prints `rendered source text`.

---

### U2. Vitest unit tests for view-mode

**Goal:** Cover the state machine with container-runnable unit tests that match the spec's Vitest acceptance criteria.

**Requirements:** R5, spec section 5.2

**Dependencies:** U1

**Files:**
- `src/lib/__tests__/view-mode.test.js` (new)

**Approach:** CJS globals (`describe` / `it` / `expect`) via `globals: true` in vitest.config — no imports needed (S1 lesson). Mirror the pattern in `theme-manager.test.js`.

**Test scenarios:**

- **[Happy path] Default view is 'rendered':** `DEFAULT_VIEW === 'rendered'`.
- **[Happy path] Single toggle from rendered returns 'source':** `toggleView('rendered') === 'source'`.
- **[Happy path] Single toggle from source returns 'rendered':** `toggleView('source') === 'rendered'`.
- **[Parity — even N] After 0, 2, 4 toggles starting from DEFAULT_VIEW, result equals DEFAULT_VIEW.** (Covers spec AC: "最终视图与 N 的奇偶一致".)
- **[Parity — odd N] After 1, 3 toggles from DEFAULT_VIEW, result differs from DEFAULT_VIEW.**
- **[Display mode distinctness] `getDisplayMode('rendered') !== getDisplayMode('source')`** (spec AC: "两者不同").
- **[Display mode — rendered] `getDisplayMode('rendered') === 'html'`.**
- **[Display mode — source] `getDisplayMode('source') === 'text'`.**

**Verification:** `npm test` exits 0, all view-mode tests listed in vitest output.

---

### U3. Preload: expose view-mode via contextBridge

**Goal:** Wire view-mode into `window.api.view.*` following the established preload pattern.

**Requirements:** R6

**Dependencies:** U1

**Files:**
- `src/renderer/preload.js` (modify)

**Approach:** Add `require('../lib/view-mode')` and extend the `contextBridge.exposeInMainWorld` call to include a `view` namespace:
```
view: {
  DEFAULT_VIEW: viewMode.DEFAULT_VIEW,
  toggleView: viewMode.toggleView,
  getDisplayMode: viewMode.getDisplayMode,
}
```
No change to `sandbox: false` in window-config — already set (R7).

**Patterns to follow:** Existing `theme` namespace in `preload.js`.

**Test expectation:** none — preload wiring is integration-only, verified by e2e/VA gate in CI.

**Verification:** After renderer wiring (U5), `npm start` shows toggle working; VA gate in CI passes.

---

### U4. UI: add `#view-toggle` button and styles

**Goal:** Add the toggle button to the status bar and give it baseline styling consistent with `#theme-toggle`.

**Requirements:** R1

**Dependencies:** none

**Files:**
- `src/renderer/index.html` (modify — add `<button id="view-toggle">` inside `#status-bar`)
- `src/renderer/theme.css` (modify — add styles for `#view-toggle`)

**Approach:**
- In `index.html`, append `<button id="view-toggle">Render / Source</button>` inside `#status-bar`, after the existing `#theme-toggle` button.
- In `theme.css`, style `#view-toggle` to match `#theme-toggle` (same margin, cursor, etc.). No inline `<style>` — CSP blocks them (S4 lesson).

**Test expectation:** none — visual layout, verified by human on host and by VA runner (button must exist for the `{ "click": "#view-toggle" }` step).

**Verification:** `#view-toggle` visible in status bar when `npm start` is run on host.

---

### U5. Renderer: cache raw HTML and wire toggle

**Goal:** Cache the raw HTML string from `getDocContent()` at startup and wire the `#view-toggle` click to apply `innerHTML` or `textContent` synchronously based on `window.api.view.getDisplayMode`.

**Requirements:** R2, R3, R4, R6

**Dependencies:** U2, U3, U4

**Files:**
- `src/renderer/renderer.js` (modify)

**Approach:**
- Inside the `.then((html) => { ... })` callback of `getDocContent()`, save `html` to a closure-scoped variable (e.g., `rawHtml`). Set `document.getElementById('doc-container').innerHTML = rawHtml` for the initial render.
- Initialize `let currentView = window.api.view.DEFAULT_VIEW` alongside the existing `currentTheme` declaration.
- Wire `document.getElementById('view-toggle').addEventListener('click', () => { ... })`:
  - `currentView = window.api.view.toggleView(currentView)`
  - `const mode = window.api.view.getDisplayMode(currentView)`
  - If `mode === 'html'`: `docContainer.innerHTML = rawHtml`
  - Else (`mode === 'text'`): `docContainer.textContent = rawHtml`
- Keep the existing `theme-toggle` wiring untouched.

**Constraint:** No IPC inside the click handler. `rawHtml` must come from the cached variable, never from a new `getDocContent()` call. (R4 — S3 lesson: async re-fetch causes e2e flakiness.)

**Test expectation:** none for unit tests — renderer.js touches the DOM and window.api and is not testable in Vitest node environment. Covered by VA / e2e gate in CI.

**Verification:** Manual on host — `npm start`, click `#view-toggle`, `#doc-container` shows raw HTML with visible `<h1>` tags; click again, formatted document returns. CI e2e with xvfb: `va-runner` passes all four `textContent` checks; `va-selftest` mutation probe passes (gate has teeth).

---

## Scope Boundaries

### In Scope
- Pure state machine module with Vitest unit tests
- Preload contextBridge wiring for `window.api.view.*`
- `#view-toggle` button in `#status-bar`
- Renderer: cache raw HTML, wire synchronous toggle
- CSS styling for `#view-toggle` in external `theme.css`

### Deferred to Follow-Up Work
- Editable source view (F14 full — depends on F40/F42)
- Syntax highlighting
- Per-document view state isolation (multi-document)
- Split render/source pane

### Outside This Product's Identity
- Large-document performance, cross-platform parity, concurrent external AI file changes, transition animations — all explicitly out of scope per spec.

---

## Open Questions

| Question | Status | Owner |
|---|---|---|
| Does `builtin-doc.html` contain `<h1>` and text "Welcome to Wordspace"? (VA depends on it) | **Resolved** — `src/assets/builtin-doc.html` contains `<h1>Wordspace</h1>` (line 8) and `<p>Welcome to Wordspace — your minimal document viewer skeleton.</p>` (line 9). VA `contains: "Welcome to Wordspace"` is satisfied by the paragraph; `contains: "<h1"` is satisfied in source mode; `notContains: "<h1"` passes in rendered mode because `innerHTML` parses the tag as a DOM element. No changes needed to the document. | Resolved (feasibility review) |

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Renderer caches stale `rawHtml` if `getDocContent()` fails | Error path already in renderer.js shows message in `textContent` — leave that path untouched; cached var stays `undefined`, toggle won't corrupt DOM |
| VA `waitFor` selector `#doc-container h1, #doc-container p` waits for rendered children — source-view click happens after this waits, so timing is safe | Already encoded in VA steps order; no change needed |
| Accidental use of `innerHTML` for source view would re-render the HTML | `getDisplayMode` returning explicit `'text'` vs `'html'` string makes the branch unambiguous in code review |

---

## Sources & Research

- `specs/f14-render-source-toggle.md` — primary requirements
- `specs/f14-render-source-toggle.va.json` — existing human-authored VA config (CODEOWNERS-locked)
- `CLAUDE.md` S1/S3/S4 lessons — preload + contextBridge pattern, Vitest globals, VA textContent assertions, CSP external-stylesheet rule
- `src/renderer/preload.js`, `src/renderer/renderer.js`, `src/renderer/index.html` — existing patterns to follow
- `src/lib/theme-manager.js`, `src/lib/__tests__/theme-manager.test.js` — module + test templates
