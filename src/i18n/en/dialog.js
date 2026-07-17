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
  // Update install authorization explainer (main.js maybeExplainInstallAuth, macOS only).
  // In-app chown repair is dead: macOS App Management (TCC) blocks it even as root (proven 2026-07-17),
  // so we explain honestly + offer the website-reinstall route (drag-replace once = password-free forever).
  updateAuthTitle: 'This installation requires system authorization',
  updateAuthDetail: 'The app files on this Mac are owned by the system administrator (a previous update ran with admin rights). macOS therefore asks for authorization on every update, and system protection prevents fixing this from inside the app. To make future updates password-free: re-download from the website and drag the app into Applications to replace it (you’ll enter your password once).',
  updateAuthContinue: 'Continue Installing (authorization required)',
  updateAuthReinstall: 'Reinstall from Website (password-free afterwards)',
  updateAuthCancel: 'Cancel',
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
