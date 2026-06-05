---
title: "feat: Add dark/light theme toggle (S2 demo)"
status: completed
date: 2026-06-04
origin: specs/f46-theme-demo.md
---

# feat: Add dark/light theme toggle (S2 demo)

## Summary

Add a bottom status bar to the S1 Electron skeleton with a dark/light toggle switch. Toggling changes only the app shell (body background + status bar); the document paper area is colour-isolated. Pure theme logic lives in `src/lib/theme-manager.js` — a plain Node.js module with no Electron/DOM imports, directly testable by Vitest. A Playwright E2E test running in CI (xvfb) asserts both shell change and document colour preservation.

---

## Problem Frame

S1 delivered an Electron window that renders a built-in HTML document inside `#doc-container`. S2 adds one user-visible control: a dark/light toggle switch in a new bottom status bar. The hard correctness constraint is that switching the shell theme must not bleed into the document's colours — the document controls its own appearance at all times. Per established test discipline (S3), Vitest is the unit gate and Playwright E2E in CI is the integration gate. The two together close the "vitest-green but app-broken" gap.

---

## Requirements

Sourced from `specs/f46-theme-demo.md`:

| ID | Requirement |
|----|-------------|
| R1 | Status bar with a dark/light toggle button is visible at the bottom of the window |
| R2 | Clicking the toggle immediately switches shell appearance (body background, status bar colours) |
| R3 | Document paper area colours are unchanged by any number of toggle clicks |
| R4 | Theme logic (state machine, shell-style mapping, doc-style constant) is in a pure module testable by Vitest without Electron or DOM |
| R5 | Playwright E2E test in CI asserts shell class changed and doc computed colour unchanged after toggle |
| R6 | No `test.skip(!DISPLAY)` guards — E2E fails loudly in any environment lacking a display |

---

## Key Technical Decisions

**Theme state lives entirely in the renderer** — no IPC, no main process involvement. The preload exposes pure functions; the renderer holds current theme in a local variable. This keeps the feature simple and avoids unnecessary round-trips.

**Shell isolation via CSS class on `<body>`** — applying `.light-theme` / `.dark-theme` to `<body>` controls shell-area colours (body background, status bar). `#doc-container` gets an explicit opaque `background: #ffffff` that overrides any cascading shell colour, enforcing the doc-isolation invariant at the CSS layer.

**`sandbox: false` in `webPreferences`** — required so the preload can `require('../lib/theme-manager')` (S3 lesson, empirically confirmed). `contextIsolation: true` and `nodeIntegration: false` remain, preserving the security boundary appropriate for this local-only demo.

**No IPC** — theme state never needs to reach the main process; omitting IPC keeps the change surface minimal.

---

## High-Level Technical Design

```
┌─────────────────────────────────────────────────────────────────┐
│  BrowserWindow  (sandbox: false, contextIsolation: true)        │
│                                                                 │
│  preload.js                                                     │
│    require('../lib/theme-manager')  ──────────────────────────► │
│    contextBridge.exposeInMainWorld('api', {                     │
│      theme: { toggleTheme, getShellClass, getDocStyle,          │
│               DEFAULT_THEME }                                   │
│    })                                                           │
│                                                                 │
│  renderer (index.html + renderer.js)                            │
│    window.api.theme.toggleTheme(current)  ◄── #theme-toggle    │
│    apply getShellClass(theme) to document.body                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  body.light-theme / body.dark-theme                      │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │  #doc-container  (background: #ffffff — isolated) │   │  │
│  │  │  (built-in HTML doc; its own colours untouched)   │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │  #status-bar  (theming via body class cascades)   │   │  │
│  │  │  [Dark / Light ⬛]                                │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

src/lib/theme-manager.js  (pure Node.js — no Electron, no DOM)
  ├── DEFAULT_THEME = 'light'
  ├── toggleTheme(current) → 'dark' | 'light'
  ├── getShellClass(theme) → 'light-theme' | 'dark-theme'
  └── getDocStyle(theme)   → constant {} regardless of theme
                             (proves doc style is not derived from theme)

Vitest (npm test)          ─── unit gate: pure logic only
Playwright E2E (CI xvfb)   ─── integration gate: real app launch + toggle
```

---

## Output Structure

New and modified files for this feature:

```
src/
  lib/
    theme-manager.js            (new — pure module)
    __tests__/
      theme-manager.test.js     (new — Vitest unit tests)
  renderer/
    index.html                  (modify — add status bar, body class, CSS)
    preload.js                  (modify — expose window.api.theme.*)
    renderer.js                 (modify — click handler, apply shell class)
  lib/
    window-config.js            (modify — add sandbox: false)
e2e/
  app.spec.js                   (modify — add toggle E2E test)
```

---

## Implementation Units

### U1. Pure theme-manager module + Vitest tests

**Goal:** Create `src/lib/theme-manager.js` as a pure Node.js module (no Electron, no DOM) implementing the theme state machine and style mappings. Create `src/lib/__tests__/theme-manager.test.js` covering all spec §5.2 acceptance criteria.

**Requirements:** R4

**Dependencies:** none

**Files:**
- `src/lib/theme-manager.js` (create)
- `src/lib/__tests__/theme-manager.test.js` (create)

**Approach:**
- Exports: `DEFAULT_THEME` (string constant `'light'`), `toggleTheme(current)` (returns opposite theme string), `getShellClass(theme)` (returns a CSS class name string), `getDocStyle(theme)` (returns an identical constant object for every theme value — this is the proof that document style is not derived from the theme)
- Zero top-level `require('electron')`, no `window`, no `document`, no `process.env` — plain pure function exports with no side effects
- CommonJS format (`module.exports = { ... }`) consistent with existing `src/lib/` modules

**Execution note:** Implement module and tests together; run `npm test` after each scenario until all pass.

**Test scenarios:**
- Given `DEFAULT_THEME`, it equals `'light'`
- Given `toggleTheme('light')`, result is `'dark'`
- Given `toggleTheme('dark')`, result is `'light'`
- Given toggle applied N times (even N ≥ 2), final theme equals starting theme
- Given toggle applied N times (odd N ≥ 1), final theme differs from starting theme
- Given `getShellClass('light')`, result is a non-empty string
- Given `getShellClass('dark')`, result differs from `getShellClass('light')`
- Given `getDocStyle('light')` and `getDocStyle('dark')`, both return deeply-equal objects (doc style is theme-invariant — covers spec §5.2 "文档纸面解耦" AC)

**Patterns to follow:** `src/lib/doc-loader.js`, `src/lib/window-config.js` — same CJS structure, same placement in `src/lib/__tests__/`

**Verification:** `npm test` exits 0; all theme-manager test cases pass; no Electron imports detected in `theme-manager.js`.

---

### U2. Preload exposure + window-config sandbox

**Goal:** Expose theme-manager functions to the renderer via `contextBridge` as `window.api.theme.*`. Set `sandbox: false` in `webPreferences` so the preload can `require` the local module.

**Requirements:** R2, R3 (integration path from pure logic to renderer)

**Dependencies:** U1

**Files:**
- `src/renderer/preload.js` (modify)
- `src/lib/window-config.js` (modify)

**Approach:**
- In `preload.js`: add `const themeManager = require('../lib/theme-manager')` near the top; extend the existing `contextBridge.exposeInMainWorld` `api` object with a `theme` key exposing `{ toggleTheme, getShellClass, getDocStyle, DEFAULT_THEME }`
- In `window-config.js`: add `sandbox: false` to the `webPreferences` object alongside the existing `contextIsolation: true, nodeIntegration: false` — do not remove those existing settings
- No changes to `src/main.js` (no IPC needed)

**Patterns to follow:** Existing `contextBridge.exposeInMainWorld` call in `src/renderer/preload.js`; S3 lesson (sandbox: false is required for preload to require local modules)

**Test scenarios:**
- Test expectation: none — preload layer is not reachable by Vitest; correctness is the E2E gate (U4)

**Verification:** When the app launches (verified by E2E in U4), `window.api.theme` is defined and all four exported values are accessible.

---

### U3. Status bar HTML, CSS, and renderer click handler

**Goal:** Add a visible status bar at the bottom of the window with a dark/light toggle button. Apply the shell class to `<body>` on click. Ensure `#doc-container` background is isolated so it never picks up shell colours.

**Requirements:** R1, R2, R3

**Dependencies:** U2

**Files:**
- `src/renderer/index.html` (modify)
- `src/renderer/renderer.js` (modify)

**Approach:**

*Layout:* `body` becomes `display: flex; flex-direction: column; height: 100vh`. `#doc-container` gets `flex: 1; overflow-y: auto`. New `#status-bar` is a flex child below the document container (approximately 36px tall).

*Shell theming classes on `body`:*
- `.light-theme` — light body background (e.g. `#f0f0f0`), light status bar (e.g. `#e0e0e0`), dark text
- `.dark-theme` — dark body background (e.g. `#1a1a1a`), dark status bar (e.g. `#2a2a2a`), light text

*Default state:* `<body class="light-theme">` in the HTML; renderer initialises `currentTheme = window.api.theme.DEFAULT_THEME`.

*Document isolation:* `#doc-container` gets an explicit `background: #ffffff; color: inherit` — this breaks the cascade so the doc area stays white regardless of body class. This is the CSS counterpart to the `getDocStyle` constant proof in the pure module.

*Toggle button `#theme-toggle`:* inside `#status-bar`; a plain `<button>` is sufficient. Label can be static text (e.g. "🌙 / ☀️") or a simple string.

*renderer.js click handler:* on click, call `window.api.theme.toggleTheme(currentTheme)` to get next theme; call `window.api.theme.getShellClass(nextTheme)` to get class name; replace the current body class with the new class name; update `currentTheme`.

**Test scenarios:**
- Test expectation: none — DOM manipulation is not tested by Vitest; verified by E2E in U4 and by human macOS run

**Verification:** `npm start` on macOS shows a status bar at the bottom; clicking the toggle visibly darkens/lightens the shell; document text and background colours do not change.

---

### U4. E2E test — shell class change + doc colour isolation

**Goal:** Add a Playwright Electron E2E test that clicks `#theme-toggle` and asserts the body class changed AND an element's computed colour inside `#doc-container` is identical before and after.

**Requirements:** R5, R6

**Dependencies:** U1, U2, U3

**Files:**
- `e2e/app.spec.js` (modify — add one new `test` block)

**Approach:**
- Add `test('theme toggle changes shell class but preserves doc colour', ...)` alongside the existing test; no `test.skip` guards of any kind
- Steps: launch app → capture `document.body.className` and a computed colour from an element inside `#doc-container` → click `#theme-toggle` → assert body class has changed (contains `'dark-theme'`) → assert the captured computed colour is identical after the click
- Use `page.evaluate()` or Playwright element handles for DOM inspection; use `getComputedStyle` for colour capture
- `electron.launch` args keep the existing `--no-sandbox` flag (CI runner constraint — do not confuse with `webPreferences.sandbox: false`)

**Test scenarios:**
- Given app at default state (light-theme on body), when `#theme-toggle` clicked, then `document.body.className` contains `'dark-theme'` and no longer contains `'light-theme'`
- Given a text element inside `#doc-container`, its computed `color` value is identical before and after a toggle click
- Given two toggle clicks from the default state, body class returns to `'light-theme'`
- (CI integration gate: if preload/contextBridge is broken, `window.api` is undefined, renderer crashes, E2E fails with a real error — no `test.skip` lets it through)

**Verification:** CI `e2e` job (ubuntu-22.04, xvfb, real Electron binary) exits 0; `xvfb-run npm run test:e2e` green.

---

## Scope Boundaries

**In scope:** `theme-manager.js` pure module, preload bridge, status bar + toggle UI, E2E test.

**Out of scope (from spec):** theme persistence across restarts, multi-theme / colour palette, colour inversion preview, cross-platform consistency, large-document performance.

**Deferred to follow-up work:** None for this spec.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `sandbox: false` weakens Chromium process isolation | Accepted for this local-content demo; `contextIsolation: true` + `nodeIntegration: false` remain in force (S3 lesson) |
| CSS cascade from body class bleeds into `#doc-container` | Mitigated by explicit `background: #ffffff` on `#doc-container`; E2E computed-colour assertion is the authoritative check |
| CI e2e job accidentally set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | CI config already separates the two jobs; only the `test` job sets the skip env; do not add it to the `e2e` job |
| `getDocStyle` constant is trivially correct but doesn't prove CSS isolation | The model-level proof (pure function returning constant) pairs with the renderer-level proof (E2E computed-style check); both are required by the spec |

---

## Sources & Research

- `specs/f46-theme-demo.md` — primary requirements source
- `CLAUDE.md` S1 + S3 lessons — architecture patterns, sandbox: false requirement, E2E CI setup, no-test.skip rule
- `docs/plans/2026-06-05-001-fix-test-blindspot-rerun-spec2-plan.md` — corroborating E2E gate rationale
- Existing `src/renderer/preload.js`, `src/lib/window-config.js` — patterns to extend
