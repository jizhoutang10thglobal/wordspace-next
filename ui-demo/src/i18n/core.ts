// i18n 纯逻辑：偏好归一 / 生效语言 / t() 工厂。**不 import React / zustand / DOM**——
// 这份是要原样搬进真 app 的（真 app 的 vanilla renderer 与 Electron 主进程都直接用它，两处都无 React）。
// DOM 挂载、zustand store、hook 全在 index.ts（ui-demo 独有的 React 外壳）。
import type { LangPref, Lang, Dict, TFunc } from './types'

const PREFS: LangPref[] = ['system', 'zh', 'en']

export function normalizeLangPref(raw: string | null | undefined): LangPref {
  return PREFS.includes(raw as LangPref) ? (raw as LangPref) : 'system'
}

// 跟随系统时，把系统 locale 归到我们支持的二态：以 zh 开头 → zh，其余 → en（英文兜底，未来加语言在这扩）。
export function langOfSystem(systemLocale: string | null | undefined): Lang {
  return typeof systemLocale === 'string' && systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
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
