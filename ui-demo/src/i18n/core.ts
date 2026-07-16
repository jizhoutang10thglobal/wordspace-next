// i18n 纯逻辑：偏好归一 / 生效语言 / t() 工厂。**不 import React / zustand / DOM**——
// 这份是要原样搬进真 app 的（真 app 的 vanilla renderer 与 Electron 主进程都直接用它，两处都无 React）。
// DOM 挂载、zustand store、hook 全在 index.ts（ui-demo 独有的 React 外壳）。
import type { LangPref, Lang, Dict, TFunc } from './types'

const PREFS: LangPref[] = ['system', 'zh', 'en']

export function normalizeLangPref(raw: string | null | undefined): LangPref {
  return PREFS.includes(raw as LangPref) ? (raw as LangPref) : 'system'
}

// 跟随系统时把系统 locale 归到二态。区分两种「非中文」：
//  - **无 locale 信息**（null/空，如 node 脚本/测试环境无 navigator）→ zh：源语言、也让现有中文断言的门保绿。
//  - **有 locale 但不是中文**（如浏览器里 en-US / fr-FR）→ en：英文兜底（未来加语言在这扩）。
export function langOfSystem(systemLocale: string | null | undefined): Lang {
  if (typeof systemLocale !== 'string' || !systemLocale) return 'zh'
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function effectiveLang(pref: LangPref, systemLocale: string | null | undefined): Lang {
  if (pref === 'zh') return 'zh'
  if (pref === 'en') return 'en'
  return langOfSystem(systemLocale)
}

// t() 工厂：绑定一个生效语言。en 缺 key → fallback 到 zh（半翻译界面能用，绝不显示裸 key 名）；
// zh 缺 key → 显示 key 名（只会在开发期出现，是「漏建字典」的可见信号）。
export function makeT(zh: Dict, en: Dict, lang: Lang): TFunc {
  return (key, params) => {
    let s = lang === 'en' ? en[key] ?? zh[key] ?? key : zh[key] ?? key
    if (params) {
      for (const k in params) s = s.split('{' + k + '}').join(String(params[k]))
    }
    return s
  }
}

// ---- 模块级当前状态 + 纯 imperative t ----
// index.ts（React 外壳）在启动/切换语言时把 dict 和当前语言推进来；这样**纯逻辑模块**（如 schema 校验器、
// 真 app 的 vanilla renderer / Electron 主进程）能直接 `import { t } from './core'` 拿当前语言翻译，
// 不必 import React 外壳（index.ts 会连带引入 react+zustand）。未 configure 时字典空 → t 回退显示 key 名。
let _zh: Dict = {}
let _en: Dict = {}
let _lang: Lang = 'zh'
export function configureI18n(zh: Dict, en: Dict): void {
  _zh = zh
  _en = en
}
export function setActiveLang(lang: Lang): void {
  _lang = lang
}
export function getActiveLang(): Lang {
  return _lang
}
export function t(key: string, params?: Record<string, string | number>): string {
  return makeT(_zh, _en, _lang)(key, params)
}
