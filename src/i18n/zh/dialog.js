// dialog 命名空间(zh)：主进程弹给用户的原生对话框 + 抛给 renderer 显示的错误/提示消息。
// 主进程各文件 require('../lib/i18n').t 在触发时调，故随当前语言(切语言=重启/重载后生效)。
module.exports = {
  // 崩溃重载对话框(main.js render-process-gone)
  reloadBtn: '重新加载',
  crashMessage: '编辑器意外崩溃',
  crashDetail: '未保存到磁盘的临时内容可能已丢失。已保存的文件不受影响。',
  // 未保存守卫对话框(main.js close)
  discardClose: '放弃修改并关闭',
  unsavedMessage: '文档有未保存的修改',
  unsavedDetail: '关闭后未保存的修改将丢失。',
  // 更新安装授权说明对话框(main.js maybeExplainInstallAuth，仅 mac)。
  // 应用内 chown 修复已被 macOS App Management(TCC)证死——root 执行都被拦(2026-07-17 实锤)，
  // 故只说明白 + 给「官网重装」直达（拖入替换一次即可永久免密）。
  updateAuthTitle: '本次安装需要系统授权',
  updateAuthDetail: '这台 Mac 上的应用文件归属于系统管理员（此前某次更新以管理员身份完成），macOS 因此每次更新都会要求授权，且系统保护使应用内无法自动修复。想以后更新永久免密：从官网重新下载一次，把 app 拖进「应用程序」替换（输一次密码即可）。',
  updateAuthContinue: '继续安装（需授权）',
  updateAuthReinstall: '去官网重装（以后免密）',
  updateAuthCancel: '取消',
  // 文件/文件夹/导出对话框 title
  exportPdfTitle: '导出 PDF',
  relocateFolderTitle: '重新定位文件夹',
  saveDocTitle: '保存文档',
  exportBookmarksTitle: '导出书签',
  importBookmarksTitle: '导入书签',
  // 对话框 filter name(扩展名过滤器的显示名)
  filterAll: '所有文件',
  filterHtml: 'HTML 文档',
  filterMd: 'Markdown 文档',
  filterImage: '图片',
  filterHtmlBookmark: 'HTML 书签',
  // 抛给 renderer 显示的错误消息
  errUnknownRoot: '未知的工作区根: {id}',
  errRootMissing: '工作区文件夹失联: {id}',
  errUnsupportedFile: '只支持 .html/.htm/.md 文件：{path}',
  errNotUtf8: '此文件不是 UTF-8 编码，为避免损坏内容，暂不支持编辑',
  errBadUndoToken: '非法的撤销令牌',
  errPdfTmpFail: '无法在文档所在文件夹创建临时文件导出 PDF（可能是只读目录）。请把文档移到有写入权限的文件夹后再试。',
  // 主进程 → renderer toast / 网页标签默认标题
  noDownload: 'Wordspace 浏览器不支持下载',
  webNewTabTitle: '新标签页',
};
