// English glossary for the user-template feature (#205). AI-drafted — Wendi to review.
// Generic words (cancel/close/delete/back/undo/rename) reuse common.*, not duplicated here.
export default {
  // Templates page (TemplatesPage)
  title: 'Templates',
  subtitle: 'Click a template to start a new document from it. Save a document you like via its ⋯ menu → “Save as template”, and it shows up under “Mine” below.',
  official: 'Official',
  mine: 'Mine',
  newFromThis: 'New document from this template',
  emptyMine: 'No templates of your own yet. In any document’s ⋯ menu choose “Save as template” and it will appear here for one-click reuse.',

  // Save-as-template modal (SaveTemplateModal)
  saveAsTemplate: 'Save as template',
  nameLabel: 'Template name',
  defaultName: '{title} template',
  dupWarn: 'A template with this name already exists; saving adds a new one (it won’t overwrite the old).',
  includeSkeleton: 'Include content skeleton (carry this document’s block structure into new documents)',
  saveThemeHint: 'Will save this document’s layout theme',
  saveSkeletonHint: 'This document is bare (no theme); the saved template is skeleton-only',
  userTemplateHint: 'Your templates appear on the Templates page and in the gallery’s “Mine” group',

  // Document ⋯ menu (DocMenu)
  saveDocAsTemplate: 'Save current document as template…',
  mdUnsupported: 'Markdown documents don’t support templates yet (head styles aren’t persisted to disk)',
  nonConformUnsupported: 'This file doesn’t conform to the Schema and uses basic editing; templates apply to conforming documents only',

  // New-document modal template cards (CreateModal)
  kindStyled: 'Styled',
  kindSkeleton: 'Skeleton',
  myTemplates: 'My templates',

  // store template toasts / derived fields
  untitledTemplate: 'Untitled template',
  descHasTheme: 'With theme',
  descSkeletonOnly: 'Skeleton only',
  descWithSkeleton: 'With content skeleton',
  savedToast: 'Saved as template “{name}”',
  deletedToast: 'Deleted template “{name}”',

  // Template CSS safety-gate violation messages (templateCheck)
  cssNoExternalUrl: 'Template CSS may only reference inline resources url(data:font/*) / url(data:image/*) (svg rejected); external requests (tracking beacons / outside dependencies) are forbidden.',
  cssNoImport: '@import is forbidden (it pulls an external stylesheet — an outbound channel).',
  cssNoExpression: 'CSS expression() is forbidden (executes JS in old IE).',
  cssNoBinding: '-moz-binding is forbidden (can bind executable XBL/XML).',
  cssNoBehavior: 'The behavior: property is forbidden (IE HTC behavior binding, executable).',
  cssNoPositioning: 'position:fixed/sticky/absolute is forbidden (the document area shares one DOM with the app UI; absolute positioning can cover the UI / hijack clicks).',
  cssNoImportant: '!important is forbidden (it overrides the user’s inline tweaks, breaking “keep manual tweaks across re-skinning”).',
  cssNoHideDisplay: 'display:none is forbidden (a template must not hide body content — the hide-a-clause kind of visual deception).',
  cssNoHideVisibility: 'visibility:hidden is forbidden (a template must not hide body content).',
  cssBadAtRule: '@{name} is forbidden (templates only allow @font-face / @keyframes / @media / @supports).',
  cssOverBudget: 'Template size {size}KB exceeds the {max}KB limit (demo is bound by the localStorage quota).',
}
