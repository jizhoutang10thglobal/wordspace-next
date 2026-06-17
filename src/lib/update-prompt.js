// 更新弹窗的决策逻辑（S5）。纯模块、不带 require('electron')，vitest 直测（S1 教训）。
// dialog 的「展示」在 src/main/main.js（需要 electron），这里只管「弹什么」和「用户的选择怎么判」。

const RESTART_INDEX = 0;   // 「立即重启」在 update-downloaded 弹窗里的按钮下标
const LATER_INDEX = 1;
const DOWNLOAD_INDEX = 0;  // 「下载并安装」在 update-available（手动）弹窗里的按钮下标

// update-downloaded 后：问要不要立即重启安装（两条路共用：启动自动更新 + 手动更新）。
function buildUpdateDialogOptions(version) {
  const versionLabel = version ? `v${version} ` : '';
  return {
    type: 'info',
    title: '更新已就绪',
    message: `新版本 ${versionLabel}已下载，立即重启更新？`,
    detail: '点「稍后」则在下次退出 app 时自动安装。',
    buttons: ['立即重启', '稍后'],
    defaultId: RESTART_INDEX,
    cancelId: LATER_INDEX,
  };
}

function shouldInstall(responseIndex) {
  return responseIndex === RESTART_INDEX;
}

// 手动检查发现新版本 → 问用户是否现在下载并安装（autoDownload=false，由用户决定下载时机）。
function buildAvailableDialogOptions(version) {
  const versionLabel = version ? `v${version}` : '';
  return {
    type: 'info',
    title: '发现新版本',
    message: `发现新版本 ${versionLabel}`.trim(),
    detail: '是否现在下载并安装？下载完成后会提示你重启。',
    buttons: ['下载并安装', '以后'],
    defaultId: DOWNLOAD_INDEX,
    cancelId: 1,
  };
}

function shouldDownload(responseIndex) {
  return responseIndex === DOWNLOAD_INDEX;
}

// 手动检查发现没有更新 → 告诉用户已是最新。
function buildUpToDateDialogOptions(currentVersion) {
  const versionLabel = currentVersion ? `（当前 v${currentVersion}）` : '';
  return {
    type: 'info',
    title: '检查更新',
    message: '已是最新版本',
    detail: `你正在使用最新版本${versionLabel}。`,
    buttons: ['好'],
    defaultId: 0,
  };
}

// 手动检查出错。
function buildCheckErrorDialogOptions() {
  return {
    type: 'error',
    title: '检查更新',
    message: '检查更新失败',
    detail: '请稍后再试，或检查网络连接。',
    buttons: ['好'],
    defaultId: 0,
  };
}

// dev（未打包）态手动点检查更新：electron-updater 在 dev 不工作，明确告知。
function buildDevDialogOptions() {
  return {
    type: 'info',
    title: '检查更新',
    message: '开发模式无法检查更新',
    detail: '打包后的正式版本才支持检查更新。',
    buttons: ['好'],
    defaultId: 0,
  };
}

module.exports = {
  buildUpdateDialogOptions,
  shouldInstall,
  buildAvailableDialogOptions,
  shouldDownload,
  buildUpToDateDialogOptions,
  buildCheckErrorDialogOptions,
  buildDevDialogOptions,
};
