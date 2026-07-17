// i18n 纯逻辑：偏好归一 / 生效语言 / t() 工厂 + 模块级当前状态。
// **无 electron / DOM import** —— 主进程与 renderer(经 preload 注入字典)都直接用这一份，
// 照 src/lib/appearance.js 的「纯逻辑两侧共用」先例。CJS，node:test 可直接 require。
// 逻辑与 ui-demo/src/i18n/core.ts 逐行对齐(那份是 TS 源，本份是真 app 的 CJS 移植)。
'use strict';

const PREFS = ['system', 'zh', 'en'];

// 任意输入 → 合法三态语言偏好；非法/空/null 一律回落 'system'。
function normalizeLangPref(raw) {
  return PREFS.includes(raw) ? raw : 'system';
}

// 跟随系统时把系统 locale 归到二态。区分两种「非中文」：
//  - 无 locale 信息(null/空，如无 app.getLocale 的 node 测试环境)→ zh：源语言、也让现有中文断言的门保绿。
//  - 有 locale 但不是中文(如 en-US / fr-FR)→ en：英文兜底(未来加语言在这扩)。
function langOfSystem(systemLocale) {
  if (typeof systemLocale !== 'string' || !systemLocale) return 'zh';
  return systemLocale.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
}

function effectiveLang(pref, systemLocale) {
  const p = normalizeLangPref(pref);
  if (p === 'zh') return 'zh';
  if (p === 'en') return 'en';
  return langOfSystem(systemLocale);
}

// t() 工厂：绑定一个生效语言。en 缺 key → fallback 到 zh(半翻译界面能用，绝不显示裸 key 名)；
// zh 缺 key → 显示 key 名(只在开发期出现，是「漏建字典」的可见信号)。空串 '' 是合法翻译、不当缺失。
function makeT(zh, en, lang) {
  return function t(key, params) {
    let s;
    if (lang === 'en') s = en[key] != null ? en[key] : zh[key] != null ? zh[key] : key;
    else s = zh[key] != null ? zh[key] : key;
    if (params) {
      for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
    }
    return s;
  };
}

// ---- 模块级当前状态 + 纯 imperative t ----
// 主进程启动 / renderer boot / 切语言时把 dict + 当前语言推进来；纯逻辑模块(schema 校验器、
// 主进程各处、renderer 各模块经 window.wsT)直接调 t() 拿当前语言翻译，不必自己持字典。
// 未 configure 时字典空 → t 回退显示 key 名。
let _zh = {};
let _en = {};
let _lang = 'zh';

function configureI18n(zh, en) {
  _zh = zh || {};
  _en = en || {};
}
function setActiveLang(lang) {
  _lang = lang === 'en' ? 'en' : 'zh';
}
function getActiveLang() {
  return _lang;
}
function t(key, params) {
  return makeT(_zh, _en, _lang)(key, params);
}

module.exports = {
  PREFS,
  normalizeLangPref,
  langOfSystem,
  effectiveLang,
  makeT,
  configureI18n,
  setActiveLang,
  getActiveLang,
  t,
};
