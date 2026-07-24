// editor namespace strings (English).
export default {
  // Block type / slash / turn-into menu labels
  text: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulletedList: 'Bulleted list',
  numberedList: 'Numbered list',
  todoList: 'To-do list',
  quote: 'Quote',
  callout: 'Callout',
  table: 'Table',
  code: 'Code',
  toggle: 'Toggle list',
  image: 'Image',
  divider: 'Divider',
  slashDoclink: '🔗 Link to document',
  slashAi: '✦ AI generate (coming soon)',

  // Image block
  captionPlaceholder: 'Image caption',
  addCaption: 'Add caption',

  // Block row
  textPlaceholder: 'Type text, or press / for commands',
  addRow: '+ Add row',
  deleteRow: 'Delete row',
  blockGripTitle: 'Drag to reorder · click for menu',

  // Toggle block chevron accessibility labels
  toggleCollapse: 'Collapse',
  toggleExpand: 'Expand',

  // Pagination
  pageN: 'Page {n}',

  // Document header
  unsavedDraft: 'Unsaved draft',
  docFallback: 'Document',
  editedBy: '{name} edited {time}',

  // Canvas hints / modals / toasts
  imgTooLarge: 'Image too large: still over the 1.5MB limit after compression',
  imgUnsupported: 'Unsupported image format',
  imgDecodeFail: 'Could not decode image',
  createNamed: 'New "{name}"',
  urlLink: 'Web link…',
  linkAddressPrompt: 'Link address',
  untitledDoc: 'Untitled document',
  createdAndLinked: 'Created "{name}" and linked',
  createdNamed: 'Created "{name}"',
  dropImageOnly: 'Only image files can be dropped in (png / jpg / webp / gif / avif)',
  crossFolderLink: "Cross-folder links aren't supported yet — drop the file into a document in the same folder",
  noTextBlock: 'This document has no text block to hold a link',
  linkGone: 'The link is no longer in this document; could not re-point it',
  repointedTo: 'Re-pointed to {path}',
  emptyDoc: 'Select a document on the left, or create a new one.',
  unsavedNewDoc: 'Unsaved new document · ⌘S (or "Save" at top right) to store it in the current space',
  localHtmlFile: 'This is a local HTML file · {path}',

  // Format toolbar
  turnIntoTitle: 'Change block type',
  turnInto: 'Turn into',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  inlineCode: 'Inline code',
  textColor: 'Text color',
  highlight: 'Highlight',
  link: 'Link',
  askAiTitle: 'Let AI rewrite this block (coming soon)',

  // Link preview / broken-link repair card
  linkTargetMissing: 'Link target not found',
  targetMovedHint: 'The target may have been moved, renamed, or deleted.',
  repointTo: 'Re-point to {path}',
  createInDir: 'Create "{name}" in {dir}',
  rootDir: 'the root folder',
  nonDocFileHint: 'Not a document file; opening hands off to the matching system app.',

  // Find in document
  findInDoc: 'Find in document',
  noResults: 'No results',
  prevMatchTitle: 'Previous (Shift+Enter)',
  prevMatch: 'Previous match',
  nextMatchTitle: 'Next (Enter)',
  nextMatch: 'Next match',
  closeFindTitle: 'Close (Esc)',
  closeFind: 'Close find',

  // Document … menu
  exportPdf: 'Export as PDF',
  exportWord: 'Export as Word (.docx)',
  exportPptx: 'Export as slides (.pptx)',
  pageSetupMenu: 'Page setup…',
  linkCopied: 'Link copied',
  copyLink: 'Copy link',

  // Block action menu
  turnIntoText: 'Turn into Text',
  turnIntoHeading: 'Turn into Heading',
  turnIntoQuote: 'Turn into Quote',
  turnIntoToggle: 'Turn into Toggle list',
  insertBelow: 'Insert below',

  // AI placeholder modal
  aiComingTitle: 'AI is coming soon',
  aiComingDesc: '"Let AI generate / rewrite this block" is coming soon. Stay tuned.',
  gotIt: 'Got it',

  // Mention menu
  linkToDoc: 'Link to document',
  mentionQuerySuffix: ': "{query}"',
  mentionFilterHint: '(type to filter)',
  noMatchingDoc: 'No matching documents',

  // Backlinks
  backlinkCount: '{n} documents link here',

  // Slash menu
  noMatch: 'No matches',

  // Basic editor
  preview: 'Preview',
  nonconformNotice: 'This file does not conform to the Wordspace Schema; only basic editing is supported.',
  deleteBlockTitle: 'Delete block (Delete)',
  deleteBlock: 'Delete block',
  clearFormat: 'Clear formatting',

  // PDF viewer (sample content)
  readonlyPdf: 'PDF · Read-only',
  pdfEyebrow: 'TENTH GLOBAL · Report',
  pdfMeta1: 'June 2026 · Page 1 of 2',
  pdfIntro: 'This is a PDF document. As a browser, Wordspace lets you read it right here in a tab, without switching to another app. PDFs are read-only; open with the default app when you need to edit.',
  pdfOverview: 'Overview',
  pdfOverviewBody: 'Core business stayed on a steady growth track this quarter, with new signings and repeat purchases both rising. Below are the key metrics and a breakdown by business line.',
  pdfChartCap: 'Figure 1 · Quarterly performance by business line',
  pdfBreakdown: 'Breakdown',
  pdfItem1: 'Consulting delivery: stable cash flow, gross margin held above 40%',
  pdfItem2: 'Training & content: methodology keeps accreting, conversion improving',
  pdfItem3: 'AI products: incubated from internal tools, entering validation',
  pdfClosing: 'See the appendix for detailed figures. This page is illustrative content, demonstrating the PDF reading experience in Wordspace.',
  pdfMeta2: 'Page 2 of 2',

  // Image viewer
  readonlyImage: 'Image · Read-only',

  // Markdown source panel
  mdSource: 'Markdown source',
  mdLive: 'Live',
  mdSourceHint: "This is the current document's Markdown backend (block model → .md). Edit on the left and it updates live here — proving the block model ↔ Markdown are reversible.",

  // Find file palette
  findFile: 'Find file',
  findFilePlaceholder: 'Search by file name…',
  noMatchingFile: 'No matching files',

  // Page setup
  pageSetupTitle: 'Page setup',
  pageSetupSub: '"{title}" · Paged display and paper layout for PDF export',
  pagedDoc: 'Paged document',
  pagedDocNote: 'Display paginated by paper like Word; export PDF in the same layout',
  paper: 'Paper',
  orientation: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  margins: 'Margins',
  marginsAria: 'Margin presets',
  custom: 'Custom',
  marginTop: 'Top',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
  marginRight: 'Right',
  pageNumbers: 'PDF footer page numbers',
  pageNumbersNote: 'Like "2 / 5", centered in the footer',

  // Margin presets (page.ts)
  marginNormal: 'Normal',
  marginNarrow: 'Narrow',
  marginWide: 'Wide',

  // Schema validation violations (title + detail)
  vParseTitle: 'Cannot parse as HTML',
  vParseDetail: 'The input is not a parseable HTML document.',
  vScriptTitle: 'Contains <script>',
  vScriptDetail: 'Schema documents do not run document JS (the iframe has no allow-scripts); any <script> is nonconforming.',
  vEmbedTitle: 'Contains <{tag}> embed',
  vEmbedDetail: 'The reduced paradigm does not allow live embeds like iframe/object/embed.',
  vBaseTitle: 'Contains <base>',
  vBaseDetail: 'The skeleton forbids <base> (it rewrites how all relative links resolve).',
  vExternalCssTitle: 'Contains external stylesheet <link>',
  vExternalCssDetail: 'Decorative styles belong to the Template, not the Schema document; external CSS is not allowed.',
  vAuthorStyleTitle: 'Contains author <style>',
  vAuthorStyleDetail: 'Display is native to the .html and decoration is the Template; apart from the editor-managed semantic CSS (data-ws-schema-css), author <style> is outside the Schema.',
  vFormTitle: 'Contains form elements',
  vFormDetail: 'Form controls like <form>/<input>/<button> are not in the Schema #1 block set.',
  vHeadingMaxTitle: 'Contains <{tag}> heading',
  vHeadingMaxDetail: 'Headings cap at h4; h5/h6 do not conform (not silently downgraded to h4 — basic editing is used).',
  vPositioningTitle: 'Uses absolute positioning',
  vPositioningDetail: 'All blocks stay in the document flow and can reflow; never use position:absolute/fixed.',
  vBlockStyleTitle: 'style attribute on a block',
  vBlockStyleDetail: 'Block elements carry no style (color etc. go through a fixed class palette + data-ws-schema-css); inline style does not conform.',
  vInlineHandlerTitle: 'Contains on* event handlers',
  vInlineHandlerDetail: 'No document JS is run: inline event attributes like onclick/onload are not allowed.',
  vMergedCellsTitle: 'Table has merged cells',
  vMergedCellsDetail: 'colspan/rowspan are forbidden (like Notion, tables stay rectangular).',
  vNestedTableTitle: 'Table nested inside a table',
  vNestedTableDetail: 'Cells cannot nest blocks/tables, let alone nested tables.',
  vCellBlockTitle: 'Block content inside a cell',
  vCellBlockDetail: 'Table cells are phrasing-only (plain text + inline marks).',
  vListLiTitle: 'List child is not <li>',
  vListLiDetail: 'The direct children of ul/ol can only be <li>; bare text or other tags directly under a list do not conform.',
  vInlineWrapsBlockTitle: 'Inline element wraps block content',
  vInlineWrapsBlockDetail: 'Inline marks cannot contain block elements (e.g. <a> wrapping <h2>).',
  vDegenerateTitle: 'body is not a flat block list',
  vDegenerateDetail: 'The top level wraps multiple layers in a layout container like <{tag}> (canonical = flat, directly-attached blocks with a single blockRoot); nested containers do not conform.',
  vNoMarkerTitle: 'Missing wordspace-schema marker',
  vNoMarkerDetail: 'The marker is only a quick hint (not authoritative). A valid hand-written document can omit it without affecting conformance.',
  newHeading: 'New heading',
  newListItem: 'List item',
  newQuote: 'Quote',
  newCallout: 'Callout',
  newToggleSummary: 'Toggle heading',
  newToggleBody: 'Toggle body',
  tableColumn: 'Column {n}',
  tableCell: 'Cell',
}
