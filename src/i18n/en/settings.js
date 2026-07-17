// settings namespace (en). Language section (U4) first; appearance/browser sections filled during browser.js extraction.
module.exports = {
  // Language section
  language: 'Language',
  uiLanguage: 'Interface language',
  languageDesc: 'When set to Follow system, uses the OS language; you can also lock Chinese or English. Switching reloads the window.',
  langSystem: 'Follow system',
  langZh: '中文', // endonyms — a language picker shows each language in its own name, constant across UI language
  langEn: 'English',
  // Page title
  pageTitle: 'Settings',
  // Appearance section
  appearance: 'Appearance',
  theme: 'Theme',
  themeDesc: 'When set to Follow system, it tracks the OS light/dark switch in real time',
  // Browser section
  browser: 'Browser',
  defaultSearchEngine: 'Default search engine',
  defaultSearchEngineDesc: 'Used to search when you type a phrase (not a URL) in the address bar',
  defaultBrowser: 'Default browser',
  defaultBrowserDesc: 'Open web links clicked anywhere in the system with Wordspace',
  setDefaultBrowser: 'Set as default browser',
  isDefaultBrowser: 'Already the default browser',
  installedOnly: 'Installed version only',
  confirmInSystemDialog: 'Confirm in the system dialog',
  setDefaultFailed: 'Failed to set',
};
