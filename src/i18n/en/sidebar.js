// sidebar namespace (en). Sidebar: toasts, context menus, tree empty states, pinned/tabs zones,
// absorb/delete guards, performance-diagnostics panel. Common words reuse common.*.
module.exports = {
  // ---- sidebar chrome ----
  localFiles: 'Local Files',
  noMatchingFiles: 'No matching files',
  addRootTitle: 'Open another folder alongside the current ones',
  addFolder: 'Add folder…',

  // ---- add folder / root management toasts ----
  folderAlreadyOpen: '“{name}” is already open',
  folderIsChild: '“{name}” is already inside “{parent}” — it won’t be opened again; just expand it there',
  folderChildParentStuck: '“{name}” is inside the “{parent}” you opened ({mode}). You can expand it there to find it, or remove it in Manage Folders and open “{name}” on its own',
  folderModeLazy: 'a large folder in simplified mode',
  folderModeLoading: 'still loading',
  folderStateChangedRetry: 'The folder state changed — please try again',
  folderLimit: 'You can have at most {max} folders open at once',
  reconnected: '“{name}” reconnected',
  folderOpened: 'Opened folder “{name}”',

  // ---- merge-and-add confirm ----
  absorbTitle: '“{name}” contains folders you already have open',
  absorbDesc: '“{name}” contains “{children}”, which you already have open. Adding it will merge {it} into “{name}” so the same files don’t show up twice; open tabs will follow along and stay open.',
  absorbConfirm: 'Merge and add',
  absorbChanged: 'The folder state changed — nothing was merged',
  absorbedInto: '“{name}” merged in, including its original subfolders',
  pronounIt: 'it',
  pronounThem: 'them',
  listSep: ', ',

  // ---- remove root ----
  removeDirtyBlock: 'This folder has unsaved changes — deal with them before removing it',
  rootRemoved: 'Removed “{name}” (files on disk are untouched)',
  undoRemoveOverlap: 'Can’t undo: it overlaps a folder that’s currently open',
  undoRemoveLimit: 'Can’t undo: the folder limit is full',
  undoRemoveFailed: 'Can’t undo',

  // ---- root header / disconnected root ----
  rootHeadTitle: '{path} · Drag to reorder folders',
  newDoc: 'New document',
  moveToTop: 'Move to top',
  removeRoot: 'Remove (files stay on disk)',
  readingFolder: 'Reading folder…',
  folderNoFiles: 'This folder has no files yet',
  rootMissingTitle: '{path} · Disconnected (folder unreachable)',
  missingTag: 'Disconnected',
  relocateEllipsis: 'Relocate…',
  missingNote: 'Folder unreachable (it may have been moved or deleted, or its drive isn’t connected)',
  relocate: 'Relocate',
  relocateOverlap: 'That location overlaps a folder that’s already open — pick another',

  // ---- oversized-path confirm modal (picked a whole home dir / disk / volume root) ----
  hugeTitle: '“{name}” is a very large system folder',
  hugeDesc: 'You picked an entire home directory / disk, which usually holds hundreds of thousands of system files and will be very slow to open. Pick a specific work folder inside it instead (for example a project folder or “Documents”).',
  hugePickAnother: 'Pick another folder',
  hugeOpenAnyway: 'Open anyway',

  // ---- simplified (lazy) large root: per-level loading placeholder + level-truncation note + point-of-use degradation hints ----
  readingLevel: 'Reading…',
  dirTruncatedNote: 'This folder has too many direct items — showing only the first portion',
  lazyFilterHint: 'Simplified mode: only searches directories you’ve already browsed',
  lazyFilterHintTitle: 'This folder is large and loaded on demand. Expand more directories before filtering, or use “remove it and open a specific subfolder” for a full search',
  lazyQuickOpenNote: 'Large folders in simplified mode aren’t included in quick-open (expand them level by level in the sidebar)',

  // ---- escape hatch: manage-folders modal ----
  manageRootsTitle: 'Manage Folders',
  manageRootsDesc: 'Removing only closes it in Wordspace; the files on disk are untouched.',
  noOpenFolders: 'No open folders',
  missingSuffix: ' (disconnected)',

  // ---- keyboard-shortcut coach bubbles (taught once after the first mouse action) ----
  coachReload: 'Next time you can use {key} to reload',
  coachNewTab: 'Next time you can use {key} to open a new tab',
  coachCloseTab: 'Next time you can use {key} to close the current tab',
  coachToggleSidebar: 'Next time you can use {key} to collapse / expand the sidebar',

  // ---- rename / move / link rewriting ----
  renameFailed: 'Rename failed: {err}',
  formatKept: 'Renaming doesn’t change the format — use “Save As / Export” to convert to Markdown',
  linksUpdated: 'Updated links in {total} document(s)',
  undoLinkFailed: 'The file changed after this operation — this link update can’t be undone',
  quotedName: '“{name}”',
  nFiles: '{n} files',
  externalRenameDetected: 'Detected {label} renamed/moved — {total} document(s) still link to the old path',
  updateNow: 'Update now',
  moveFailed: 'Move failed: {err}',
  crossDeviceMove: 'These two folders are on different drives — drag-to-move isn’t supported yet. Copy it over in Finder first',

  // ---- delete guard ----
  delGuardTitleDir: 'Documents in folder “{name}” are linked by {n} outside document(s)',
  delGuardTitleFile: '“{name}” is linked by {n} document(s)',
  delGuardDesc: 'After deletion, links pointing to it will break (shown as broken links; you can re-point them or undo the deletion to restore):',
  delGuardMore: '… {n} in total',
  stillDelete: 'Delete anyway',
  deleteFailed: 'Delete failed: {err}',
  deleted: 'Deleted “{name}”',
  newFolderFailed: 'Couldn’t create folder: {err}',

  // ---- tree node context menu ----
  addDocHere: 'New document in this folder',
  newSubfolder: 'New subfolder',
  cantMoveIntoSelf: 'Can’t move a folder into itself',
  emptyFolder: 'Empty folder',
  pin: 'Pin',
  unpin: 'Unpin',

  // ---- close confirm modal ----
  thisFile: 'this file',
  unsavedTitle: '“{name}” isn’t saved yet',
  unsavedDescTemp: 'This is a temporary document that hasn’t been saved to a folder. Closing it will discard the unsaved content.',
  unsavedDescReal: 'This document has unsaved changes that will be lost if you close it.',
  closeWithoutSaving: 'Close without saving',
  saveAndClose: 'Save and close',

  // ---- save-to-where modal ----
  rootDirLabel: '{name} (root)',
  fileName: 'File name',
  browse: 'Browse…',
  browseTitle: 'Use the system save dialog to pick any location (including outside your workspace)',
  docSwitched: 'The document changed — not saved',
  saveFailed: 'Save failed: {err}',
  saveHere: 'Save here',
  saveModalTitle: 'Where to save',
  saveModalSub: '“{name}” · Saves to your workspace root by default; you can pick another folder or “Browse…” to somewhere else',
  saveFailedShort: 'Save failed',
  savedTo: 'Saved to {place}',
  workspace: 'Workspace',

  // ---- tab rows ----
  externalFile: 'File outside the workspace',
  unsavedDotTemp: 'Unsaved (not saved to a folder yet)',
  unsavedDot: 'Unsaved changes',
  removePin: 'Remove from pinned',
  closeTab: 'Close tab ⌘W',
  rootMissingOpen: '“{name}” is disconnected — relocate it before opening',

  // ---- pinned / tabs zones ----
  pinnedZone: 'Pinned',
  pinnedEmptyHint: 'Drag tabs here to pin them',
  tabsZone: 'Tabs',
  newTabTitle: 'New tab ⌘T',
  tabsEmptyHint: 'No open tabs',

  // ---- new document / tab modal ----
  newTab: 'New tab',
  createTabSub: 'Enter a URL to go straight to the web, or create a document below (a temporary document — you choose where to save it later)',
  createDocSub: 'In {location}',
  omniPlaceholder: 'Search, or enter a URL',
  paradigmLabel: 'Paradigm',
  paradigmNotion: 'Notion-like',
  paradigmCurrent: 'Current',
  paradigmNotionDesc: 'Structured block-based documents',
  paradigm2: 'Paradigm 2',
  paradigm3: 'Paradigm 3',
  comingSoon: 'Coming soon',
  paradigmRailFoot: 'Each paradigm will have its own editing style and templates',
  paradigmSoon: '{name} · on the way',
  paradigmSoonDesc: 'Each paradigm is its own editing core and document structure. Once it ships, its templates will be listed here.',

  // ---- command palette ----
  findPlaceholder: 'Find by file name…',
  findHintOpen: '⏎ Open',

  // ---- default web-tab title ----
  newWebTab: 'New Tab',

  // ---- performance diagnostics panel (hidden dev tool, Cmd+Shift+D) ----
  diagTitle: 'Wordspace Performance Diagnostics  v{version}   {date}',
  diagNoRoots: '(No folders opened yet, or no tree has been read)',
  diagRootLine: 'Root {n} “{name}”  {info}',
  diagCloud: '☁ {name} cloud',
  diagLocal: 'Local',
  diagFileStats: '   Files {files} / dirs {dirs}{kb}  ·  readTree last {last}ms / peak {max}ms (full {reads}× / subtree {scoped}× / single-level {dirReads}×)  ·  watcher fired {events}×',
  diagIpcPayload: '  ·  IPC payload ≈{kb}KB',
  diagRenderLine: 'Render: last {last}ms · peak {max}ms · {count} total  ·  current tree DOM rows {rows}',
  diagLongTask: 'Main-thread long tasks (>50ms dropped frames): {count} · total {total}ms · longest {max}ms   ← check this line for scroll/interaction jank',
  diagMem: 'JS memory: {mem}',
  diagCopy: 'Copy diagnostics',
  diagRecord: 'Record 5s profile',
  diagCopied: 'Copied ✓',
  diagCopyFailed: 'Copy failed',
  diagRecording: 'Recording… reproduce the jank now (scroll/switch)',
  diagSaved: 'Saved: {name} (revealed in Finder)',
  diagRecordFailed: 'Recording failed',
  diagRecordFailedPkg: 'Recording failed (only works in a packaged build)',
  diagHint: 'Scroll/switch to reproduce jank and watch “long tasks” climb live · refreshes every 1s',
  resizeHint: 'Drag to resize the sidebar',
  toggleSidebarTitle: 'Collapse sidebar ⌘\\',
  expandSidebarTitle: 'Expand sidebar ⌘\\',
  flClose: 'Close',
  flMinimize: 'Minimize',
  flFullscreen: 'Full screen',
  navBack: 'Back',
  navForward: 'Forward',
  reloadTitle: 'Reload ⌘R',
  findFileTitle: 'Find file ⌘P',
  addBookmarkTitle: 'Bookmark ⌘D',
  favorites: 'Bookmarks',
  manageBookmarks: 'Manage bookmarks',
  filesLabel: 'Files',
  filterFiles: 'Filter files',
  clearFilter: 'Clear',
  emptyNote: 'Open a local folder to use it as your workspace',
  emptyOpenBtn: 'Open folder',
  aiAccessTitle: 'AI access',
  expandSidebarTitle: 'Expand sidebar ⌘\\',
  flClose: 'Close',
  flMinimize: 'Minimize',
  flFullscreen: 'Full screen',
};
