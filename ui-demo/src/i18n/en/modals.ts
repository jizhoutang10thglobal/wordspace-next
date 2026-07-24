// modals namespace (English).
export default {
  // Document kind labels
  kindPage: 'Web page',
  kindSlides: 'Slides',
  kindDoc: 'Document',

  // New (CreateModal)
  newDoc: 'New document',
  newTabOrDoc: 'New tab or document',
  searchOrUrl: 'Search or enter address',
  inLocation: 'In {where}',
  docFallback: 'Documents',
  paradigm: 'Paradigm',
  paradigmNotion: 'Notion-like',
  paradigmCurrent: 'Current',
  paradigmNotionDesc: 'Structured block-based documents',
  paradigmPaged: 'Paged document',
  paradigmPagedDesc: 'Laid out in pages, like Word',
  paradigm3: 'Paradigm 3',
  comingSoon: 'Coming soon',
  paradigmRailFoot: 'Each paradigm will have its own editing style and templates',
  paradigmSoon: '{name} · on the way',
  paradigmSoonDesc: 'Each paradigm is its own editing core and document structure. Once it ships, its templates will be listed here.',
  templatesOf: '{name} templates',
  officialTemplates: 'Official templates',
  blankDoc: 'Blank document',
  blankDocDesc: 'Start from scratch',
  blankPagedDoc: 'Blank paged doc',
  blankPagedDocDesc: 'Laid out in pages, like Word',

  // Add folder (AddFolderModal)
  addFolder: 'Add folder',
  addFolderSub: 'Open another folder alongside the current ones; you can remove it anytime, files on disk are untouched.',
  noFolderPicked: 'No folder selected yet',
  pickFolder: 'Choose folder…',
  relSame: 'This folder is already open.',
  // Nesting-relation notice, split into segments; names are wrapped in <b> between segments
  bracketL: '“',
  relChildMid: '” is already inside “',
  relChildEnd: '” — it won’t be opened again. To view it, expand that folder.',
  relParentMid: '” contains the already-open “',
  relParentEnd: '”. Adding it will fold {plural}them into “{name}”, so the same files don’t appear twice.',
  pluralThem: '',
  listSep: ', ',
  alreadyOpen: 'Open: {names}',
  gotIt: 'Got it',
  mergeAndAdd: 'Merge and add',
  add: 'Add',

  // Save where (SaveModal)
  rootDirLabel: '{name} (root)',
  saveWhere: 'Save where',
  saveWhereSub: '“{title}” · Saved to the first open folder by default, or pick another location',
  saveHere: 'Save here',

  // Unsaved-close confirm (CloseConfirmModal)
  thisFile: 'this file',
  unsavedChanges: 'Unsaved changes',
  unsavedTitle: '“{title}” isn’t saved',
  unsavedDesc: 'This is a temporary document not yet saved to a folder. Closing it will lose unsaved changes.',
  discardClose: 'Close without saving',
  saveClose: 'Save and close',

  // Delete referenced document confirm (DeleteLinkedModal)
  deleteLinkedAria: 'Delete a referenced document',
  deleteDirLinked: 'Documents in folder “{name}” are linked by {count} external document(s)',
  deleteFileLinked: '“{name}” is linked by {count} document(s)',
  deleteLinkedDesc: 'After deletion, links pointing to it will break (shown as broken links; you can re-point them or undo the deletion to restore):',
  andMore: '… and {count} more',
  deleteAnyway: 'Delete anyway',

  // Share & publish (PublishDialog)
  shareAndPublish: 'Share & publish',
  inviteEmailPlaceholder: 'Enter an email to invite a collaborator',
  invite: 'Invite',
  deploying: 'Deploying…',
  redeploy: 'Redeploy',
  publish: 'Publish',
  deployNote: 'Deploys to {target} · self-hostable, your data is yours',
  linkCopied: 'Link copied',
}
