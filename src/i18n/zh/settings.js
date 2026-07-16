// settings 命名空间(zh)：设置页各段。语言段(U4)先填；外观/浏览器段随 browser.js 提取补。
module.exports = {
  // 语言段
  language: '语言',
  uiLanguage: '界面语言',
  languageDesc: '跟随系统时用操作系统的语言；也可锁定中文或 English。切换后会重新加载窗口。',
  langSystem: '跟随系统',
  langZh: '中文', // 语言选择器按惯例显示各语言的母语名(endonym)，恒定不随界面语言变
  langEn: 'English',
  // 页标题
  pageTitle: '设置',
  // 外观段
  appearance: '外观',
  theme: '主题',
  themeDesc: '跟随系统时，系统切换深浅色会实时跟随',
  // 浏览器段
  browser: '浏览器',
  defaultSearchEngine: '默认搜索引擎',
  defaultSearchEngineDesc: '在地址栏打一句话（不是网址）时用它搜索',
  defaultBrowser: '默认浏览器',
  defaultBrowserDesc: '系统里点开的网页链接都用 Wordspace 打开',
  setDefaultBrowser: '设为默认浏览器',
  isDefaultBrowser: '已是默认浏览器',
  installedOnly: '仅安装版可设',
  confirmInSystemDialog: '请在系统弹窗里确认',
  setDefaultFailed: '设置失败',
};
