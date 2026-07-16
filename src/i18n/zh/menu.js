// menu 命名空间(zh)：应用菜单栏。切语言时 applyLanguage 先 setActiveLang 再 buildMenu，菜单随之重建。
// 通用词(退出/保存/撤销/重做/剪切/拷贝/粘贴/全选/外观三态)复用 common.*。
// 注：'Wordspace Next'(app 名)、role:'about'/'windowMenu' 子项(Electron 自带本地化)不在这里。
module.exports = {
  // Wordspace Next 菜单
  checkUpdates: '检查更新…',
  settings: '设置…',
  reportIssue: '报告问题 / 反馈…',
  aiAccess: 'AI 接入…',
  appearance: '外观',
  perfDiag: '性能诊断…',
  // 文件菜单
  file: '文件',
  newTab: '新建标签页',
  openFile: '打开文件…',
  openFolder: '打开文件夹…',
  quickOpen: '快速打开…',
  closeTab: '关闭标签页',
  reopenTab: '重新打开关闭的标签页',
  exportPdf: '导出 PDF…',
  // 编辑菜单
  edit: '编辑',
  findInDoc: '在文档中查找…',
  findInFiles: '在文件名中查找…',
  // 视图菜单
  view: '视图',
  toggleSidebar: '切换侧栏',
  reload: '刷新',
  // 窗口菜单顶级 label（子项由 Electron 按系统语言填）
  window: '窗口',
};
