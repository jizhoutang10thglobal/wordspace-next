// 外观模式纯逻辑（三态：system/light/dark）。无 electron/DOM import，node/vitest 可直接 require。
// 两侧共用一份：ui-demo 的 appearance.ts import 它、真 app 的 appearance-store/main 也用它。
// 这里只管「偏好归一化 + 有效主题计算」；DOM 挂载(ui-demo)与 nativeTheme(真 app)在各自壳里。
'use strict';

const PREFS = ['system', 'light', 'dark'];

// 任意输入 → 合法三态偏好；非法/空/null 一律回落 'system'。
function normalizePref(raw) {
  return PREFS.includes(raw) ? raw : 'system';
}

// 偏好 + 系统是否暗 → 有效主题('light'|'dark')。显式两态无视系统；system 跟随。
function effectiveTheme(pref, systemDark) {
  const p = normalizePref(pref);
  if (p === 'light') return 'light';
  if (p === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

module.exports = { PREFS, normalizePref, effectiveTheme };
