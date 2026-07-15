export default {
  // Panel shell
  panelTitle: 'Shortcuts',
  subtitle: 'The same key means different things by context: overlay > editor > global shell; Esc backs out one layer at a time',
  docLink: 'Full keymap doc (research · decisions · use cases · vs. real app)',

  // Group titles
  grpAppShell: 'App shell · Global',
  grpFindSelect: 'Editor · Find & select',
  grpTextMode: 'Editor · Text mode (cursor in block)',
  grpBlockOps: 'Editor · Block actions (text or block-selected)',
  grpNav: 'Cursor navigation · OS native',
  grpMarkdown: 'Markdown triggers (line start + space)',

  // Group hints
  hintTextMode: 'Formatting keys act on the selection; passthrough when nothing is selected',
  hintNav: 'Provided directly by the OS; the editor does not intercept',

  // App shell · Global
  newTab: 'New tab (new document)',
  closeTab: 'Close current tab',
  nextTab: 'Next tab (+Shift for previous)',
  jumpTab: 'Jump to tab N',
  lastTab: 'Last tab',
  save: 'Save (temp docs prompt where to save)',
  saveAs: 'Save as…',
  quickOpen: 'Quick open (search file names)',
  focusFilter: 'Focus the file filter',
  toggleSidebar: 'Collapse / expand sidebar',
  settings: 'Settings',
  thisPanel: 'This panel',

  // Editor · Find & select
  findInDoc: 'Find in document (Enter for next · Shift+Enter for previous)',
  selectAll: 'Select all text in the block; press again to select the block',

  // Editor · Text mode
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  highlight: 'Highlight',
  inlineCode: 'Inline code',
  insertLink: 'Insert link',
  pastePlain: 'Paste as plain text',
  undoMac: 'Undo (+Shift to redo)',
  undoWin: 'Undo (+Shift or Ctrl+Y to redo)',
  slashMenu: 'Slash insert menu',
  newBlock: 'New block (Shift+Enter for a line break)',
  listIndent: 'Indent list (Shift+Tab to outdent)',
  escToBlock: 'Back to block-selected state',

  // Editor · Block actions
  duplicateBlock: 'Duplicate current block',
  deleteBlock: 'Delete current block',
  moveBlock: 'Move block up / down',
  toText: 'Turn into text',
  toHeading: 'Turn into heading 1 / 2 / 3',
  toList: 'Turn into to-do / bulleted / numbered list',
  bulletedList: 'Bulleted list',
  numberedList: 'Numbered list',
  toggleTodo: 'Check / uncheck to-do',
  blockMove: 'Block-selected: move selection',
  blockEnter: 'Block-selected: enter editing',
  blockDelete: 'Block-selected: delete block',

  // Cursor navigation · OS native
  deleteWord: 'Delete by word',
  moveWord: 'Move by word (+Shift to extend selection)',
  lineEnds: 'To line start / end',
  docEnds: 'Jump to document start / end',

  // Markdown triggers
  mdHeading: 'Heading 1 / 2 / 3',
  mdTodo: 'To-do',
  mdQuote: 'Quote',
}
