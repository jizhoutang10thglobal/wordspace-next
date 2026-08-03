---
date: 2026-07-20
topic: toggle-list-block
---

# Toggle List Block (Schema #1) — Requirements

## Summary

Add a full, Notion-style collapsible **toggle** block to the Schema #1 block editor: a clickable summary header over a body that holds arbitrary first-class blocks (paragraphs, lists, images, tables, even nested toggles), authored directly in the editor. On disk it is native `<details>/<summary>` with collapse state in the `open` attribute, so a shared file collapses in any browser with zero JS. The work is **editor-side only** — the disk contract, validator, and AI-authoring guide already shipped — and is prototyped in ui-demo first, then ported to the real app.

## Problem Frame

Schema #1 already *accepts* a toggle on disk: `DETAILS` is in the validator's `TOP_BLOCKS`, `validateDetails` enforces its internal shape (exactly one phrasing-only `<summary>` first, body = recursively-validated flow — the one place Schema #1 permits block nesting), the `open` attribute is whitelisted, and the AI-authoring guide teaches it. An AI-authored or hand-written toggle document therefore opens today and collapses natively.

What is missing is **authoring**. In the block editor, a `<details>` classifies as `'other'` and renders as an opaque, gray, non-editable locked block: you cannot create one from the slash menu, cannot edit its summary, cannot place a caret in its body, cannot expand/collapse it, and the keyboard boundary paths are unwired (a stray Enter/Backspace can split a broken `<details>` or delete its `<summary>`, producing non-conform bytes on the next autosave). Both editors are affected: the real app (`src/editor/blockedit.js`) and ui-demo (`ui-demo/src/components/Canvas.tsx`) have no toggle authoring at all. This is the "遗留:Toggle 创作" leftover named in the Schema foundation notes. The cost is real because every editor primitive assumes a flat block model, and a Notion toggle body is the first true nested container.

## Key Decisions

- KD1. **Native `<details>/<summary>`, not div+class+JS.** The product thesis is "the HTML file is the source of truth and opens anywhere." Native collapses with zero JS in any browser and serializes state self-describingly in the `open` attribute — a portable, app-independent persisted collapse that Notion/Craft/Obsidian cannot do (their open state is per-viewer view state lost on export). It is also already validator-legal, so this is confirming an existing decision, not making a new one.

- KD2. **Scope is editor-only.** The validator (`validateDetails`, shipped in commit 35576e7), the head-CSS whitelist, and the AI-authoring guide are already on main. "Add a toggle block" means "add toggle *authoring* to the two editors" — no schema, registry, or validator change.

- KD3. **Full nested container.** The toggle body holds arbitrary first-class blocks, each independently caret-addressable, selectable, slash-insertable, and drag-reorderable — matching Notion and what the validator already permits on disk. This is net-new structural capability: both editors use a strictly flat block model where `blockOf`/`topBlocks` collapse any body element up to the outer `<details>`, so body blocks are currently unreachable. The reachability refactor is the core of this work.

- KD4. **Collapse persists to disk and marks the doc dirty.** Consistent with the editor's "DOM is the model" architecture and zero special-casing: expand/collapse mutates `open`, marks dirty, and autosaves. Accepted cost: casually collapsing sections while reading modifies the file and produces a git diff.

- KD5. **Undo is decoupled from collapse state.** Because undo snapshots the whole body HTML (including `open`), naïvely undoing a text edit would also re-expand toggles the user had collapsed. Fix: the `open` attribute is stripped from undo snapshots; the live fold state is re-applied after every undo/redo restore; expand/collapse is *not* itself an undo step; `open` is still written to disk on save (the strip is only in the snapshot layer). Fold-state identity across the innerHTML-rewrite restore is resolved positionally (DOM order among `<details>`) for v1 — stable for content edits, allowed to drift under structural undo of toggles — and guarded by a dedicated e2e plus a mutation self-check.

- KD6. **Toggle and paged documents fully coexist.** The pagination engine recurses into toggle bodies and treats body child-block boundaries as page-cut points, so an expanded toggle taller than a page splits cleanly at block edges. On PDF/print export, all `<details>` are force-expanded before rendering so collapsed content is never silently dropped (the app owns its Chromium export path).

- KD7. **Small-decision defaults (confirmed).** A newly created toggle starts **open** (so the author can see the first body block); the caret lands in the **summary**; a **custom rotating chevron** consistent with 纸方墨圆 replaces the native UA triangle (killed via both `summary { list-style: none }` and `summary::-webkit-details-marker { display: none }`); collapse is **instant** (no reliance on Chromium-only smooth-height animation for a portable file); **nesting is allowed without a hard depth cap**; and **text↔toggle turn-into** is supported.

## Requirements

**Authoring & creation**

- R1. The slash menu offers a toggle item that inserts a block seeded as `<details open><summary></summary><p></p></details>`, with the caret placed in the summary. (Insertion follows the raw-edit-block precedent — seed content then enter edit — not in-place empty-block replacement.)
- R2. Turn-into is bidirectional. Paragraph→toggle wraps the paragraph's text as the summary with an empty body block. Toggle→text lifts the body blocks out to the top level and converts the summary into a paragraph. No path may drop content.
- R3. The summary is an editable rich phrasing line — caret placement, IME, inline formatting, and links all work — but stays phrasing-only (no block children), matching `validateDetails`. In edit mode, native summary activation (click / Space / Enter toggling the disclosure) is intercepted so typing in the header is distinguished from expanding/collapsing.

**Nested body editing (the core)**

- R4. The toggle body holds arbitrary first-class Schema-#1 blocks — paragraphs, headings, lists, quotes, callouts, images/figures, tables, and nested toggles — each independently caret-addressable, selectable, slash-insertable, block-menu-actionable, and drag-reorderable, exactly like top-level blocks. The `blockOf`/`topBlocks` reachability model is extended (recursion into `<details>` bodies, or scoped sub-roots) to make this true.
- R5. Keyboard boundary behavior is fully defined and never produces a malformed `<details>`. Enter inside a body block splits/adds a body block; Enter at the end of an empty last body block exits the toggle to a new sibling after it; Backspace at the start of the first body block does not merge into or delete the summary (defined as caret-to-summary-end or no-op); Tab / Shift-Tab nest into / outdent out of the toggle; arrow keys traverse the summary↔body and body↔outside boundaries.
- R6. Drag-and-drop can move a block into a toggle body, out of it, and reorder within it, with the drop target resolving to the correct (possibly nested) container.

**Collapse & persistence**

- R7. Expand/collapse is driven by the native `open` attribute; state persists to disk (`<details open>` = expanded, no attribute = collapsed) and round-trips through save→reparse as conform bytes.
- R8. User expand/collapse marks the document dirty and triggers autosave, but is not an undo checkpoint. The native `toggle` event (not `input`) is wired to the dirty path so state changes actually save.
- R9. Undo/redo operate on content only and never disturb current collapse state: undoing a content edit leaves open/closed toggles exactly as the user left them. `open` is excluded from undo snapshots but still serialized on save (per KD5).

**Rendering & portability**

- R10. A baked `<style data-ws-schema-css="toggle">` (injected via the existing `ensureTodoStyle`/`ensureCalloutStyle` pattern, already whitelisted by the validator head rule) gives the toggle a consistent on-disk look: custom rotating chevron, native UA triangle removed via the dual marker recipe, styling driven by classes never inline `style` (block-style rule). The toggle must render correctly with zero JS in any browser opening the raw file.
- R11. Collapse works natively (no app JS) in any browser. In-app find (Electron/Chromium) reveals text inside collapsed toggles via auto-expand; the raw-file-in-Firefox/Safari find caveat is documented, not engineered around.

**Paged documents & export**

- R12. The pagination engine recurses into toggle bodies, treating body child-block boundaries as valid page-cut points, so an expanded toggle taller than one page splits at block edges rather than being stretched across pages and sliced mid-flow.
- R13. On PDF/print export, all `<details>` are force-expanded before rendering so collapsed content is never absent from the output; the pre-export collapse state may be restored afterward.

**Cross-feature integrity**

- R14. Any toggle authored in the editor always serializes to `validateDetails`-conform bytes (exactly one phrasing-only summary first; body = conform flow). All editing chrome (contenteditable, transient ids) carries a `data-ws2-*` marker so it is stripped by the serializer and never leaks to disk.
- R15. Hierarchical ⌘A treats a top-level toggle as atomic; the existing cross-block delete guard that protects a `<details>`'s summary from partial-range cropping is preserved. Whether ⌘A gains a level that descends into a toggle body is resolved in Outstanding Questions.
- R16. Links and images inside a toggle body remain correctly indexed and rewritten (already byte-level and collapse-independent) and become independently selectable/editable once body reachability lands.

**Alignment**

- R17. A new `docs/features/toggle.md` spec is created in the same PR as the editor change on each side, per the CLAUDE.md alignment 铁律. The feature is prototyped in ui-demo first, then ported to the real app via `/align-feature`; the spec enumerates summary editing, nested body editing and its reachability model, the keyboard boundary contract, the persistent-`open` collapse interaction, the undo-decoupling rule, and the paged/export behavior.

## Key Flows

- F1. **Create a toggle.**
  - **Trigger:** User types `/toggle` (or turns a paragraph into a toggle).
  - **Steps:** A seeded `<details open><summary></summary><p></p></details>` is inserted; caret lands in the summary; user types the header, presses Enter to move into the first body block, and authors content.
  - **Outcome:** A conform, editable, expanded toggle with a real summary and body.
  - **Covers:** R1, R2, R3.

- F2. **Build nested content.**
  - **Trigger:** Caret inside a toggle body.
  - **Steps:** User runs the slash menu to insert a list/image/nested toggle inside the body; or drags an existing top-level block into the body; each nested block is independently editable and reorderable.
  - **Outcome:** A toggle whose body is a real flow of first-class blocks, including nested toggles, serializing conform.
  - **Covers:** R4, R6, R14.

- F3. **Collapse, then undo an edit.**
  - **Trigger:** User collapses toggle A (autosaved), edits paragraph P, then presses Cmd+Z.
  - **Steps:** Undo restores P's prior content; the live fold state re-applies so A stays collapsed.
  - **Outcome:** The text edit is reverted; collapse state is untouched.
  - **Covers:** R8, R9 (KD5).

- F4. **Export a paged document containing toggles.**
  - **Trigger:** User exports/prints a paged document with collapsed and tall toggles.
  - **Steps:** Export force-expands all `<details>`; pagination recurses into bodies and cuts at block boundaries.
  - **Outcome:** No collapsed content is dropped; tall toggles paginate cleanly.
  - **Covers:** R12, R13.

## Acceptance Examples

- AE1. **Conform round-trip.** **Given** a toggle authored in the editor (summary + nested body), **when** the document is saved and reparsed, **then** it classifies conform and reopens in the block editor (not the basic editor). **Covers R14.**
- AE2. **Undo does not re-expand.** **Given** toggle A is collapsed and paragraph P was then edited, **when** the user presses Cmd+Z, **then** P reverts and A remains collapsed. **Covers R9.**
- AE3. **No malformed `<details>`.** **Given** the caret at the start of a toggle's first body block, **when** the user presses Backspace (or presses Enter at the end of the summary), **then** the resulting bytes still have exactly one summary as the first child and validate conform. **Covers R5, R14.**
- AE4. **PDF keeps collapsed content.** **Given** a document with a collapsed toggle, **when** it is exported to PDF, **then** the collapsed body appears in the output. **Covers R13.**
- AE5. **Nested toggles.** **Given** a toggle nested inside a toggle inside a toggle, authored in the editor, **when** saved and reopened, **then** all three validate conform and remain independently editable. **Covers R4.**

## Technical Risks

- **Nested-block reachability refactor** is the single biggest lift and the root cause of the image/link/select-all/pagination oddities inside toggles. `blockOf`/`topBlocks` and all keyboard/drag/grip logic assume a flat block tree; extending them to recurse (or to scoped sub-roots) touches the editor core in both apps.
- **Undo fold-state identity** across the innerHTML-snapshot restore (KD5) has no element-identity primitive; positional re-application is the v1 answer and can drift under structural undo of toggles — mitigated by a documented limitation, a dedicated e2e, and a mutation self-check.
- **Summary-authoring vs native activation** is where external editors say all the real cost concentrates: making the header a rich editable line while `<summary>` natively toggles on click/Space/Enter requires careful edit-mode interception.
- **Malformed bytes from unwired keyboard paths** — the current fall-through can delete a `<summary>` or split a broken `<details>`; every boundary path (R5) needs an explicit rule plus e2e, or autosave writes non-conform bytes.
- **Pagination recursion correctness** — teaching `paginateBlocks`/`computeInnerSplits` to recurse and cut inside toggle bodies is a genuine engine change with its own edge cases (collapsed measurement, nested toggles, deep nesting).
- **ui-demo gate is local-only** — CI skips test/e2e on ui-demo-only PRs and the root i18n scan targets the real app, so `cd ui-demo && npm run i18n:scan` must be run by hand or a hardcoded CJK string / missing en key ships silently.

## Scope Boundaries

**Deferred for later**
- `<details name>` exclusive-accordion groups (opening one closes its siblings) — native and free, but not v1.
- Cross-browser smooth-height open/close animation — Chromium-only in 2026; v1 ships instant collapse and accepts that the same file animates in the app but snaps open elsewhere.
- A markdown creation shortcut (e.g. a caret prefix) — optional, not committed.

**Already done (not part of this work)**
- The disk contract (`validateDetails`), the head-CSS whitelist, and the AI-authoring guide — shipped on main; this feature does not touch them.

## Dependencies / Assumptions

- The real-app validator and AI-authoring guide are already on main (verified): `src/lib/schema-validate.js` `TOP_BLOCKS` includes `DETAILS`, `validateDetails` enforces the shape, `open` is whitelisted.
- Implementation happens off `origin/main` in the standing `wordspace-next-ui-demo` worktree (and the real-app worktree), not the current `docs/doc-linking-app-plan` worktree, which is ~500 commits behind and whose files are stale.
- The paged-doc feature is present on both sides (ui-demo `ui-demo/src/lib/page.ts`; the real app's paged path), so KD6's recursion work has a concrete target.
- `src/editor/blockedit.js` is the sole live real-app block editor; `src/editor/blocks.js` and `src/editor/slashmenu.js` are dead canvas-era code and must not be touched.

## Sources / Research

Grounding for the planner (repo-relative):

- `src/lib/schema-validate.js` — disk contract authority. `TOP_BLOCKS` incl. `DETAILS`; `validateDetails` (exactly-one-first-child summary, phrasing-only, recursive-flow body, `open` allowed); block-style rule is the only block attribute rejected besides `on*`; head whitelist accepts any `data-ws-schema-css` style by attribute presence.
- `src/editor/blockedit.js` — the real-app authoring gap. `classify` (no DETAILS case → `'other'`), `SLASH_ITEMS`, flat `topBlocks`/`blockOf`, `newBlock`, `turnInto`, `ensureTodoStyle`/`ensureCalloutStyle` (bake-CSS pattern), `deleteSelection` (already whole-deletes details endpoints to protect the summary), `splitBlock`, `onKeyDown` boundary logic.
- `src/lib/schema-model.js` — `LEAF_TEXT_TAGS` deliberately excludes DETAILS (structure container, never merged as text); `canMerge`/`isLeafTextBlock`.
- `src/editor/serialize.js` — clean-passthrough serializer; `data-ws2-*` markers stripped; details/summary/nested pass untouched.
- `src/editor/undo.js` — body-innerHTML snapshots via `cleanedBodyHtml`; undo/redo rewrite `body.innerHTML` → `reset()` invalidates refs (the KD5 substrate).
- `src/renderer/shell.js` — `routeDoc` reparses disk bytes → conform to block editor; `markDirty`/autosave.
- `src/editor/format.js` — `isTextEditable` returns false for details (why it opens as a locked block today).
- `ui-demo/src/components/Canvas.tsx` — the whole ui-demo block editor: `SLASH_ITEMS`, `isRawEditBlock` (table/code raw-edit family the toggle is closest to), image `<figure>` sub-component template, block-render if/else, `applySlash` routing.
- `ui-demo/src/types.ts` / `ui-demo/src/mock/store.ts` — flat `BlockType` union / `Block` (no children field); `newBlock` default-html map; `cloneDocs` undo (assumes flat blocks).
- `ui-demo/src/lib/schemaCheck.ts` — ui-demo Schema #1 stand-in; `ALLOWED_BLOCK` already permits details/summary; details excluded from `LAYOUT_CONTAINERS` so a nesting top-level `<details>` passes the flatness rule.
- `ui-demo/src/lib/page.ts` — pagination engine; `paginateBlocks` flat/top-level-only, `computeInnerSplits` safe cuts only li/tr/code, no-cut fallback stretches a block across pages (the KD6 target).
- `ui-demo/src/i18n/zh/editor.ts` + `ui-demo/src/i18n/en/editor.ts` + `ui-demo/scripts/i18n-scan.mjs` — new toggle strings go in both dicts; run `npm run i18n:scan` (local-only gate).
- `docs/features/paged-doc.md`, `docs/features/doc-images.md`, `docs/features/doc-linking.md`, `docs/features/editor-select-all.md` — cross-feature contracts.
- `docs/schema-1-draft-v0.md`, `docs/schema-1-ai-authoring.md`, `src/renderer/ai-guide.md` — prior toggle design notes and the shipped disk/AI contract.
