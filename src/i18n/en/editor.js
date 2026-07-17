// editor namespace (en). Block editor / toolbar / insert panel / slash menu / basic-edit bar / pagination.
module.exports = {
  // Block-type labels (shared by slash menu, turn-into menu, toolbar "Turn into")
  blockText: 'Text',
  blockH1: 'Heading 1',
  blockH2: 'Heading 2',
  blockH3: 'Heading 3',
  blockH4: 'Heading 4',
  blockBulletList: 'Bulleted list',
  blockNumberedList: 'Numbered list',
  blockOrderedList: 'Ordered list',
  blockTodoList: 'To-do list',
  blockQuote: 'Quote',
  blockCallout: 'Callout',
  blockImage: 'Image',
  blockDivider: 'Divider',
  aiGenerate: '✦ AI generate (coming soon)',

  // Drag handle / hints
  gripTip: 'Drag to reorder · click to open menu',
  dragHandleTip: 'Drag to reorder, click to open menu',
  blockNotEditable: 'This block can’t be edited yet',

  // Default content for new / inserted blocks (saved into the user's document)
  listItem: 'List item',
  calloutContent: 'Callout text',
  quoteContent: 'Quote',
  newHeading: 'New heading',
  defaultTextParagraph: 'Text paragraph',
  heading: 'Heading',
  button: 'Button',
  linkText: 'Link text',

  // "+ Insert" panel element types
  elContainer: 'Container',
  elText: 'Text',
  elTable: 'Table',
  elList: 'List',
  insertBtn: '+ Insert',
  insertElement: 'Insert element',

  // Format bubble / toolbar: inline formatting
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  boldCmd: 'Bold  Cmd+B',
  italicCmd: 'Italic  Cmd+I',
  underlineCmd: 'Underline  Cmd+U',
  inlineCode: 'Inline code',
  textColorShort: 'Text color',
  textColor: 'Text color',
  highlightShort: 'Highlight',
  highlightBg: 'Highlight',
  clear: 'Clear',
  clearFormat: 'Clear formatting',
  link: 'Link',
  apply: 'Apply',
  applyLink: 'Apply link',
  removeLink: 'Remove link',
  turnInto: 'Turn into',
  turnType: 'Change type',
  alignLeft: 'Align left',
  alignCenter: 'Center',
  alignRight: 'Align right',
  duplicate: 'Duplicate',
  duplicateBlock: 'Duplicate block',
  deleteBlock: 'Delete block',
  radius: 'Corner radius',
  shadow: 'Shadow',
  opacity: 'Opacity',

  // Font / size dropdowns
  fontDefault: 'Default font',
  fontSans: 'Sans-serif',
  fontSerif: 'Serif',
  fontMono: 'Monospace',
  fontSystem: 'System',
  sizeDefault: 'Default size',

  // Block menu
  turnToText: 'Turn into Text',
  turnToHeading: 'Turn into Heading',
  turnToQuote: 'Turn into Quote',
  addCaption: 'Add caption',
  insertBelow: 'Insert below',
  noMatch: 'No matches',

  // Basic editor
  deleteThisBlock: 'Delete this block',
  deleteThisBlockKey: 'Delete this block (Delete)',
  deleteAlmostWholeDoc: 'This block is almost the entire document. Delete it?',

  // Image / link / mention toasts
  imageTooLarge: 'Image too large: still over the 1.5 MB limit after compression',
  imageUnsupported: 'Unsupported image format',
  imageDecodeFailed: 'Couldn’t decode the image',
  imagePickerUnavailable: 'Image picker unavailable',
  dropImagesOnly: 'Only image files can be dropped (png / jpg / webp / gif / avif)',
  linkUrlPrompt: 'Link URL',
  linkNotAllowed: 'That link address isn’t allowed',
  linkUnsupportedTempDoc: 'Temporary / out-of-workspace documents don’t support dropping links yet',
  linkSelfNotAllowed: 'A document can’t link to itself',
  noTextBlockForLink: 'This document has no text block to place the link in',
  crossVolumeUnsupported: 'These two folders are on different disk volumes; linking isn’t supported yet',
  crossRootLinkFailed: 'Couldn’t create the cross-folder link',
  mentionUnsupportedTempDoc: 'Temporary / out-of-workspace documents don’t support doc linking yet',

  // In-editor placeholder text (empty block / image caption)
  emptyBlockPlaceholder: 'Type text, or press / for commands',
  figcaptionPlaceholder: 'Image caption',

  // Pagination page-number chip
  pageNumber: 'Page {page}',
};
