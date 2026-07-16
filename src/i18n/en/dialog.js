// dialog namespace (en). Native dialogs + error/toast messages surfaced from main process. AI-drafted, Colin to review.
module.exports = {
  // Crash reload dialog
  reloadBtn: 'Reload',
  crashMessage: 'The editor crashed unexpectedly',
  crashDetail: 'Temporary content not yet saved to disk may have been lost. Saved files are unaffected.',
  // Unsaved-changes guard dialog
  discardClose: 'Discard Changes and Close',
  unsavedMessage: 'The document has unsaved changes',
  unsavedDetail: 'Unsaved changes will be lost after closing.',
  // File/folder/export dialog titles
  exportPdfTitle: 'Export PDF',
  relocateFolderTitle: 'Relocate Folder',
  saveDocTitle: 'Save Document',
  exportBookmarksTitle: 'Export Bookmarks',
  importBookmarksTitle: 'Import Bookmarks',
  // Dialog filter names
  filterAll: 'All Files',
  filterHtml: 'HTML Document',
  filterMd: 'Markdown Document',
  filterImage: 'Images',
  filterHtmlBookmark: 'HTML Bookmarks',
  // Error messages surfaced to the renderer
  errUnknownRoot: 'Unknown workspace root: {id}',
  errRootMissing: 'Workspace folder unreachable: {id}',
  errUnsupportedFile: 'Only .html/.htm/.md files are supported: {path}',
  errNotUtf8: 'This file isn’t UTF-8 encoded; to avoid corrupting content, editing isn’t supported',
  errBadUndoToken: 'Invalid undo token',
  errPdfTmpFail: 'Couldn’t create a temporary file for PDF export in the document’s folder (it may be read-only). Move the document to a writable folder and try again.',
  // Main-process → renderer toast / web tab default title
  noDownload: 'The Wordspace browser doesn’t support downloads',
  webNewTabTitle: 'New tab',
};
