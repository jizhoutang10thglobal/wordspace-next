# Changelog (English)

> **English mirror of the canonical `CHANGELOG.md`** (Chinese). Both files must be updated
> together on every release — the website build fails if the latest version differs between
> the two (see `docs/releasing.md`, "Changelog 文案规范"). Group names: Added / Improved / Fixed.
> Historical entries (v0.0.1–v0.6.6) were back-written; the full list follows the same style rules.

## v0.11.6 — 2026-07-23

A big polish pass for to-dos and lists, and a cleaner New Document dialog.

### Improved

- **New document**: the New Document dialog is streamlined around Blank for now (the Meeting Notes / Project Proposal / Weekly Plan template set is temporarily retired)
- **To-dos / lists**: tiered Select All inside a list — press once for the current line, twice for the whole list, three times for the whole document
- **To-dos**: pasting plain-text `- [ ] task` from outside now becomes a to-do item automatically

### Fixed

- **To-dos / lists**: a big polish pass — steadier type conversion and round-trips, smoother rendering and keyboard handling for nested lists (indent / outdent), checkbox and selection visuals, and several clipboard-paste fixes
- **Lists**: list and to-do items can now have their text color and highlight changed (they couldn't be selected before)

## v0.11.5 — 2026-07-22

A batch of editor experience fixes, and a smoother sidebar feel.

### Improved

- **Editor**: copy & paste inside the app now keeps formatting (pasting from other apps stays plain text)
- **Editor**: dragging a selection across blocks now highlights whole rows, so you can see exactly which lines are selected
- **Editor**: the "Turn into" menu now includes Heading 4 and highlights the current block type
- **Sidebar**: much easier to summon when collapsed — slide the mouse to the window's left edge, the top-left corner, or push to the top of the screen in full-screen, and the sidebar slides out; the window buttons (close / minimize / full-screen) live right on the floating sidebar card

### Fixed

- **Editor**: clicking a block no longer makes the document jump; empty lines match text-line height, so inserting content no longer jitters neighboring lines
- **To-dos / lists**: deleting items empty no longer leaves an undeletable ghost block or a stray checkbox
- **Lists**: pressing Delete at the start of a line now correctly merges it into the line above (previously nothing happened)
- **Lists**: pasting multi-line text into a list creates one item per line — no more collapsing into one line or losing lines
- **Editor**: the slash menu closes when you click elsewhere — no need to delete the "/" first
- **Editor**: typing right after selecting across blocks now works immediately, instead of doing nothing

## v0.11.0 — 2026-07-21

A collapsible Toggle block in the editor, downloads in the browser, and the sidebar fused with the window frame.

### Added

- **Toggle block**: a new collapsible block in the editor — insert it with `/toggle`, edit the title row, and put anything inside (paragraphs, lists, images, tables, even nested toggles); click the chevron to fold / unfold, and the folded state is saved with the file; Find auto-expands a collapsed toggle when a match is inside; exporting to PDF expands everything so nothing is lost; plain text and toggles convert back and forth
- **Browser downloads**: the built-in browser can download — a toolbar download button with a progress ring and a downloads list, right-click "Save image / Save link as" on web pages, and download history is kept
- **Immersive frame**: a thin window frame now surrounds the content whenever you're not full-screen (not only when the sidebar is collapsed), and you can drag the window by it; the sidebar and frame are fused into one surface

### Improved

- **Basic editor**: deleting a block now uses the more intuitive "select, then Delete" — the separate "Delete this block" button is gone
- **Folders**: very large folders (simplified loading mode) now show their path, just like every other folder
- **File tree**: the highlight follows the currently open tab

### Fixed

- **Context menu**: no longer clipped near the bottom of the window — it flips upward instead
- **Window**: closing a window while in full-screen no longer goes black
- **Updates**: closing the panel while an update is downloading no longer pops it back open
- **Immersive frame**: the top border no longer covers the sidebar's top icon buttons
- **Browser downloads**: a batch of polish (downloads-list width, notifications, an "Open" action once a download finishes)

## v0.10.6 — 2026-07-17

The default screen (no tabs open) is now a start page.

### Added

- **Start page**: the new default screen when no tab is open — a search bar (find recent files, or enter a URL / search terms to open the web), recent files grouped by Today / Yesterday / This week (showing their folder, no more long paths), bookmarks and most-visited sites, plus new/open entries
- **Immersive collapse**: with the sidebar collapsed, a narrow window frame surrounds the content — drag the window by it; the left edge doubles as the sidebar reveal strip (with hover feedback)

### Fixed

- **Tabs**: files opened before any folder was added (including PDFs) now automatically join their folder once you add it
- **Immersive collapse**: revealing the sidebar over a web tab now rests on a page snapshot — no more white flash

## v0.10.5 — 2026-07-17

Two-stage select-all, plus a batch of tab polish.

### Added

- **Select all**: ⌘A works in two stages — first press selects the current block, press again to select the whole document
- **Changelog**: new "Changelog…" menu item and update-panel buttons open wordspace.ai/changelog for full version history

### Fixed

- **Tabs**: after a restart, clicking an open tab no longer flashes "New Tab" before showing its real title
- **Tabs**: when only pinned tabs remain, ⌘W is no longer a dead key — it returns to the start page first, and closes the window on the next press (pins are kept)
- **Bookmarks**: the manage-bookmarks entry in the sidebar is now always visible, consistent with the tabs "+"
- **Sidebar**: section counts in Pinned/Tabs now align with the section labels, with unified spacing

## v0.10.4 — 2026-07-17

PDFs can now open in Wordspace by default.

### Added

- **PDF**: set Wordspace as the default app for PDFs in "Open With" — double-click views them right inside the app (macOS)

### Fixed

- **Updates**: the update prompt no longer blanks the page when a web tab is open
- **Updates**: "Restart and Install" now really restarts and installs (the previous fix was incomplete; takes effect from the update after this version)
- **Tabs**: opening a single file and then adding its folder now files the tab under that folder instead of leaving it marked "outside the workspace" (old mislabeled tabs heal automatically after upgrading)
- **Sidebar**: the English "Bookmarks" section label now matches the all-caps style of other sections

## v0.10.3 — 2026-07-16

Huge folders are now fully usable (simplified mode), and the whole app speaks English and Chinese.

### Added

- **Language**: new "Language" setting — follow system (default) / 中文 / English; takes effect after reload (English copy is a first pass)
- **File tree**: very large folders automatically enter simplified mode (badge on the root) — open in seconds, load folders as you browse, documents open and edit as usual

### Improved

- **File tree**: in simplified mode, disk changes only re-read folders you have browsed; big folders no longer weigh down the background
- **Links**: the @-link menu no longer crawls into dependency folders or .app bundles (faster and more accurate)
- Note: in simplified mode the sidebar filter only searches browsed folders, and Quick Open (⌘P) does not cover these folders yet

## v0.10.2 — 2026-07-16

"Zero-gap" immersive UI, and giant folders no longer freeze the app.

### Added

- **Window**: the system title bar is gone (macOS) — traffic lights move into the sidebar top, content starts from the very first pixel, and the sidebar top area drags the window
- **Sidebar**: slide the mouse to the far left edge to peek the sidebar; it retracts when you move away (⌘\ still works)

### Improved

- **Sidebar**: collapsing leaves no strip or button — content fills the entire window (Windows keeps the regular frame for now)
- **File tree**: picking a giant folder (home directory, root, …) no longer freezes the app — risky paths ask for confirmation first, oversized folders are marked "too large", and a new "Manage folders…" escape hatch removes problem folders even when the tree is stuck

## v0.10.1 — 2026-07-16

Three update-experience fixes in one release.

### Fixed

- **Updates**: "Restart & install" now actually restarts and installs (previously you had to quit the app manually)
- **Updates**: no more password/Touch ID prompt on every update — a one-time fix is offered once, then updates stay password-free
- **Updates**: the download progress panel no longer flickers
- Note: the update that installs this version still uses the old updater; the new experience starts with the next update after it

### Improved

- **Shortcuts**: main buttons show shortcut hints on hover, and new users get a one-time coach bubble
- **Sidebar**: minimum width tightened so the top icon row is never clipped at the narrowest size

## v0.10.0 — 2026-07-15

You can now put images in documents.

### Added

- **Images**: three ways to insert — drag in from Finder, paste a screenshot (⌘V), or the "/image" slash command
- **Captions**: select an image to add a one-line caption below it
- **"View" menu**: ⌘\ focus/toggle sidebar, ⌘R reload web tabs

### Improved

- Inserted images are auto-compressed, orientation-corrected, and stored inline — a document stays a single self-contained file
- Images select as a block and can be deleted or drag-reordered
- When the clipboard holds both text and an image, text is pasted first

## v0.9.1 — 2026-07-15

### Fixed

- **Dark mode**: the sidebar logo now renders in white (it used to disappear into the dark background)

## v0.9.0 — 2026-07-15

Dark mode is here.

### Added

- **Dark mode**: light / dark / follow-system, applied across the whole UI, remembered across restarts
- Smart document darkening: light documents are inverted, images and already-dark documents are left alone; display-only, files on disk never change
- Sites that support dark mode follow automatically; PDF export always keeps the document's original light look

### Improved

- **Sidebar**: folders can be drag-moved too (previously files only); the sticky folder header accepts drops
- **Tabs**: same-named files from different folders show their folder for disambiguation

### Fixed

- Deleting several files in a row can be undone one by one; undo also restores pinned state
- If an open document with unsaved edits is deleted externally, a "save where?" dialog rescues your changes
- After a page fails to load, entering a new address or reloading truly recovers instead of sticking on the error page
- Renaming no longer stacks ".md.html" double suffixes; folder expand/collapse state survives restarts
- Unplugging and re-plugging an external drive (or restoring a folder path) reconnects automatically
- **Address bar**: search terms with colons (like "note:meeting") are no longer intercepted; switching tabs while typing no longer mis-navigates
- **Bookmarks**: duplicate folder names get a suffix; export-then-import no longer doubles entries; document tabs lose their meaningless star

## v0.8.4 — 2026-07-14

Links now work across folder spaces.

### Added

- **Cross-space links**: with several folders open side by side, @-search, drag-to-link, hover preview, and broken-link repair all work across folders; renames/moves update references in other spaces (undoable)

### Fixed

- **Browser**: no more repeated CAPTCHA prompts
- **Large folders**: disk changes only rescan what changed, removing stutters; adding a large folder shows loading feedback
- Clicking a tab to reveal its file no longer scrolls the tree wildly
- Hidden junk files from Windows / cloud sync (.DS_Store and friends) stay out of the file tree
- Basic-edit mode drops the stray blue hover outline

## v0.8.3 — 2026-07-13

Document linking rounds out, and Wordspace can be your default browser on macOS.

### Added

- **Link maintenance**: broken links get a red underline with repair candidates; renames/moves update every reference (undoable); "N documents link here" under the title; deleting a referenced file warns first
- **Default browser**: set Wordspace as the macOS default browser — links from other apps open as tabs

### Improved

- **Sidebar**: bookmarks section restyled to match the other sections

## v0.8.0 — 2026-07-12

### Added

- **Document links**: @-mention to insert, hover preview, drag a file from the sidebar to create a link; links follow renames/moves
- **Paged documents**: Word-style A4 pagination, page setup, PDF export with page numbers

## v0.7.0 — 2026-07-12

Wordspace is now also a browser: web pages and documents share the same sidebar, address bar, and tabs.

### Added

- Type a URL or search straight from the address bar, with autocomplete (open tabs / bookmarks / history)
- **Bookmarks** (import/export with Chrome / Safari / Firefox / Edge), history, and a start page
- Find in page (⌘F), zoom, context menus, session restore, and the full set of tab shortcuts
- Web tabs mix with document tabs — pin them, drag them

### Fixed

- A batch of edge cases, including new tabs flashing back to the previous document while loading

## v0.6.6 — 2026-07-11

### Fixed

- **Opening the Desktop or big folders no longer hangs**: the file tree skips app bundles (.app) and dependency folders (node_modules and friends)

## v0.6.5 — 2026-07-10

### Added

- **Performance diagnostics mode** (in the app menu): when things feel slow, self-check timings and record a CPU profile to send us

## v0.6.4 — 2026-07-09

### Fixed

- **Data safety**: clicking a relative link inside a document could make autosave write to the wrong file — links now open in-app, uniformly
- Closing a tab activates its neighbor (used to jump to the last one), and the file tree no longer scrolls wildly
- Faster rendering for multi-folder workspaces (expand/collapse no longer rebuilds the whole tree)

## v0.6.3 — 2026-07-08

### Added

- **Multi-folder workspaces**: open several folders side by side in the sidebar; nesting merges automatically; disconnected folders gray out and can be relocated
- Files can be drag-moved between folders

## v0.6.2 — 2026-07-06 (release pipeline broke, no installer; changes shipped with v0.6.3)

- The "paper & ink" design language lands in the app; deep folder chains display merged (compact folders); ancestor folders stick to the top while scrolling

## v0.6.1 — 2026-07-05

### Fixed

- **Full bug sweep**: about 40 issues fixed, including two severe ones (strikethrough falling out of the editor, cross-block deletes corrupting tables) and a batch of data-loss edge cases
- .md files can be bound to Wordspace on macOS and opened by double-click
- Background temporary documents with unsaved edits also confirm before closing

### Improved

- Default typography upgraded (heading/paragraph/list spacing at Notion level)

## v0.6.0 — 2026-07-03

### Added

- **Markdown support**: open, edit, and save .md files in the same editor as HTML documents
- **AI access**: copy a prompt or install a skill so your AI can write Wordspace documents

### Improved

- Closing the window on macOS now hides the app (stays in the Dock, reopens instantly with tabs and unsaved content intact)
- Double-clicking a file in Finder expands and reveals it in the file tree

## v0.5.0 — 2026-07-02

### Added

- **Format validation**: files are classified on open — standard format gets the block editor, wild HTML falls back to basic editing with a notice, so editing can no longer corrupt files
- **Temporary documents**: start writing first, pick a location when you save
- True sidebar collapse (⌘\) and Quick Open (⌘P, fuzzy file-name search)

### Improved

- Export converges on a single WYSIWYG PDF button; Save As and a top-right ⋯ menu added

## v0.4.5 — 2026-06-30

### Fixed

- Double-clicking an .html file while the app was closed left the tab missing from the sidebar

## v0.4.4 — 2026-06-30

- Pinned tabs get an × to unpin directly

## v0.4.3 — 2026-06-28

### Added

- Files outside the workspace can open as tabs too (marked ↗, restored on restart)
- The file tree follows the disk live: external renames/moves/deletes sync automatically

## v0.4.2 — 2026-06-26

### Fixed

- A batch of trial feedback: empty pinned-area placeholder, "Open" accepts any file type (images/PDF preview in-app), viewer top bar alignment

## v0.4.1 — 2026-06-26

- Tab and pin polish: drag to reorder/cross sections, restart restore, unsaved dot, and more

## v0.4.0 — 2026-06-25

### Added

- **Local folder workspaces**: open a folder as a workspace — browse/create/rename/move/delete (undoable)/filter in the file tree, with tabs managing open documents

## v0.3.6 — 2026-06-24

### Fixed

- **Document fidelity**: HTML with its own styles renders as-is instead of being forced into our typography

### Added

- Numbered lists / to-do lists with markdown triggers ("1.", "[]", …) and Tab nesting
- The wordspace.ai logo lands; the site adds an Intel Mac download

## v0.3.5 — 2026-06-23

- **Intel Mac support**: installers ship for both Apple Silicon and Intel

## v0.3.4 — 2026-06-23

- "Report an issue / feedback…" entry added to the menu

## v0.3.3 — 2026-06-23

- **PDF export** ships; fixed Enter not adding lines in an empty block

## v0.3.2 — 2026-06-22

### Fixed

- A batch of trial feedback: wrapper containers editable, external changes auto-reload, long file names truncate, cross-block drag selection, minimum window size

### Added

- "✓ Saved" feedback on save; trackpad pinch-to-zoom

## v0.3.1 — 2026-06-18

### Fixed

- Documents wrapped whole in a div couldn't be clicked into for editing
- The slash menu inserted an empty list in an empty block

## v0.3.0 — 2026-06-18

### Added

- **Editor generation change**: a Notion-style block editor (click to edit, Enter for a new block, slash menu, block menu)

## v0.2.0 — 2026-06-17

- New UI ships (sidebar/top-bar layout) with the first-generation canvas editor; the website moves in and goes minimal single-page

## v0.1.3 — 2026-06-14

- **Windows support**: installer plus file association (double-click .html to open)

## v0.1.2 — 2026-06-14

- Internal changes (UI prototyping system enters the repo); nothing user-visible

## v0.1.1 — 2026-06-14

- Installer file names are now stable, so the site's download links stay valid forever

## v0.1.0 — 2026-06-13

- **The first usable editor**: the app goes from a shell to something that edits documents

## v0.0.4 — 2026-06-11

- The repo becomes the official Wordspace Next home; release chain fixed

## v0.0.3 — 2026-06-11

- The earliest text input and basic editing

## v0.0.2 — 2026-06-10

- Release badge in the status bar and an explicit update dialog

## v0.0.1 — 2026-06-09

- Minimal Electron skeleton plus the **macOS signed release / auto-update pipeline**
