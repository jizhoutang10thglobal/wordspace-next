// sidebar namespace (English).
export default {
  // Tabs
  pin: 'Pin',
  unpin: 'Unpin',
  unsavedTabHint: 'Unsaved (not yet saved to a folder)',
  dragToPinHint: 'Drag a tab here to pin it',
  newTab: 'New tab',
  newTabTitle: 'New tab',

  // File tree / folders
  newDocHere: 'New document in this folder',
  newDoc: 'New document',
  newSubfolder: 'New subfolder',
  emptyFolder: 'Empty folder',
  moveToTop: 'Move to top',
  removeKeepDisk: 'Remove (keep files on disk)',
  noMatchFiles: 'No matching files',
  rootEmpty: 'This folder has no files yet',
  noFolders: 'No folders open yet.',
  addRootTitle: 'Open another folder alongside the current ones',
  addFolderEllipsis: 'Add folder…',
  filterFiles: 'Filter files',

  // Missing root
  rootMissingTitle: '{path} · Missing (folder unreachable)',
  missingTag: 'Missing',
  missingNote: 'Folder unreachable (it may have been moved, deleted, or its disk is disconnected)',
  relocate: 'Relocate',
  relocateEllipsis: 'Relocate…',
  remove: 'Remove',
  rootDragTitle: '{path} · Drag to reorder folders',

  // Top nav / address bar
  expandSidebar: 'Expand sidebar',
  collapseSidebar: 'Collapse sidebar',
  resizeHint: 'Drag to resize sidebar',
  navBack: 'Back',
  navForward: 'Forward',
  reload: 'Reload',
  history: 'History',
  findFileHint: 'Find file {key}',
  searchOrUrl: 'Search or enter address',
  localTag: 'Local',

  // Bookmarks section
  favorites: 'Bookmarks',
  manageBookmarks: 'Manage bookmarks · Import/Export',
  favEmptyHint: 'Click ☆ in the address bar to bookmark a page',
  bookmarkedTitle: 'Bookmarked (⌘D to remove)',
  addBookmarkTitle: 'Add bookmark ⌘D',
  bookmarkAdded: 'Bookmarked',
  bookmarkRemoved: 'Removed from bookmarks',

  // Section labels
  pinnedSection: 'Pinned',
  tabs: 'Tabs',
  documents: 'Documents',
  clear: 'Clear',

  // Doc top-right floating actions (TopActions)
  mdSource: 'Markdown source',
  mdSourceTitle: 'View Markdown source (backend)',
  saveTitle: 'Save (choose folder) (⌘S)',
  share: 'Share',

  // Footer tools
  templates: 'Templates',
  settings: 'Settings',
  aiAccess: 'AI access',
  shortcutsHint: 'Shortcuts {key}',
  accountSettings: '{name} · Account settings',

  // Disk default names (generated in the current language on create; dedupe suffix is numeric)
  untitledDoc: 'Untitled',
  newFolder: 'New Folder',
  aiGeneratedDoc: 'AI-generated document',
  rootDir: 'root',

  // toast — links / create-delete-move
  linksUpdated: 'Updated links in {count} document(s)',
  undoRenameFailed: 'The file changed since then; this link update can’t be undone',
  undoMoveFailed: 'The file changed since then; the move can’t be undone',
  deletedName: 'Deleted “{name}”',
  folderDeleted: 'Deleted folder “{name}”',
  folderDeletedWithCount: 'Deleted folder “{name}” ({count} files)',
  movedTo: 'Moved “{name}” to {dest}',
  movedLinksSuffix: ' · updated links in {count} document(s)',

  // toast — roots / folders
  folderOpened: 'Opened folder “{name}”',
  folderAbsorbed: '“{name}” merged in, including its subfolders',
  rootRemoved: 'Removed “{name}” (files on disk are untouched)',
  rootReconnected: '“{name}” reconnected',

  // toast — save / template / AI / publish / export / reset
  saved: 'Saved',
  savedTo: 'Saved to {where}',
  createdFromTemplate: 'Created from template “{name}”',
  aiDraftCreated: 'AI draft created',
  aiBlockRestyled: 'AI restyled this block',
  deploying: 'Deploying to {target} …',
  published: 'Published, link ready',
  visibilityUpdated: 'Visibility updated',
  exporting: 'Exporting as {format} …',
  exported: 'Exported as {format}',
  resetDone: 'Reset to initial data',

  // toast — document navigation (nav.ts)
  docDeleted: 'This document was deleted',
  fileMovedOrDeleted: 'This file was moved or deleted',

  // External file panel / viewer
  kindHtml: 'HTML document',
  kindWord: 'Word document',
  kindPdf: 'PDF',
  kindImage: 'Image',
  kindSheet: 'Spreadsheet',
  kindSlides: 'Presentation',
  kindOther: 'File',
  browserApp: 'Browser',
  notHtmlNote: 'This isn’t an HTML document, so Wordspace can’t edit it directly. You can open it in the default app.',
  openingWith: 'Opening “{name}” with {app}',
  openWithApp: 'Open with {app}',
}
