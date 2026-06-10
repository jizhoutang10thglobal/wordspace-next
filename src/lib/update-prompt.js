// 显式更新弹窗的决策逻辑（S5）。纯模块、不带 require('electron')，vitest 直测（S1 教训）。
// dialog 的「展示」在 src/main.js（需要 electron），这里只管「弹什么」和「用户的选择怎么判」。

const RESTART_INDEX = 0;
const LATER_INDEX = 1;

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

module.exports = { buildUpdateDialogOptions, shouldInstall };
