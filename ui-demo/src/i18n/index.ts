// i18n React 外壳（ui-demo 独有）：合并命名空间字典、zustand store、useT hook、imperative t、initLang。
// 纯逻辑在 core.ts（可移植进真app）；这里只做 React/DOM/存储的胶水。
import { useMemo } from 'react'
import { create } from 'zustand'
import { normalizeLangPref, effectiveLang, makeT, configureI18n, setActiveLang, getActiveLang, t as coreT } from './core'
import type { LangPref, Lang, Dict, TFunc } from './types'

import zhCommon from './zh/common'
import zhSidebar from './zh/sidebar'
import zhEditor from './zh/editor'
import zhBrowser from './zh/browser'
import zhModals from './zh/modals'
import zhSettings from './zh/settings'
import zhShortcuts from './zh/shortcuts'
import zhMisc from './zh/misc'
import enCommon from './en/common'
import enSidebar from './en/sidebar'
import enEditor from './en/editor'
import enBrowser from './en/browser'
import enModals from './en/modals'
import enSettings from './en/settings'
import enShortcuts from './en/shortcuts'
import enMisc from './en/misc'

export type { LangPref, Lang, TFunc } from './types'
export { normalizeLangPref, effectiveLang } from './core'

const KEY = 'ws-language'
export const LANG_PREFS: LangPref[] = ['system', 'zh', 'en']

// 命名空间前缀：文件里 key 不带前缀，合并时统一加。component 里用 t('sidebar.openFolder')。
function ns(prefix: string, dict: Dict): Dict {
  const out: Dict = {}
  for (const k in dict) out[prefix + '.' + k] = dict[k]
  return out
}
function merge(...parts: Dict[]): Dict {
  return Object.assign({}, ...parts)
}

const ZH: Dict = merge(
  ns('common', zhCommon), ns('sidebar', zhSidebar), ns('editor', zhEditor),
  ns('browser', zhBrowser), ns('modals', zhModals), ns('settings', zhSettings), ns('shortcuts', zhShortcuts),
  ns('misc', zhMisc),
)
const EN: Dict = merge(
  ns('common', enCommon), ns('sidebar', enSidebar), ns('editor', enEditor),
  ns('browser', enBrowser), ns('modals', enModals), ns('settings', enSettings), ns('shortcuts', enShortcuts),
  ns('misc', enMisc),
)

// 供扫描门/一致性检查读（不参与运行时）。
export const DICTS = { zh: ZH, en: EN }

// 把合并好的字典推进 core（模块 init 时一次），让纯模块的 imperative t() 拿得到文案。
configureI18n(ZH, EN)

function systemLocale(): string | null {
  return typeof navigator !== 'undefined' ? navigator.language : null
}
function readPref(): LangPref {
  try {
    return normalizeLangPref(localStorage.getItem(KEY))
  } catch {
    return 'system'
  }
}
function writePref(p: LangPref): void {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* private mode / 无 localStorage：不持久化，本会话仍生效 */
  }
}
// 生效语言挂到 <html lang>（可访问性 + CSS 字体栈按语言分流）。
function applyLang(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

interface LangState {
  pref: LangPref
  lang: Lang
  setPref: (p: LangPref) => void
}

// 注意：系统语言无浏览器事件（不像深浅色的 matchMedia）——只在启动/setPref 时读一次 navigator.language，
// 跟随系统模式下改系统语言要重开页面才生效（真 app 的 app.getLocale() 同理）。这是刻意限制，见 spec。
export const useLang = create<LangState>((set) => {
  const pref = readPref()
  const lang = effectiveLang(pref, systemLocale())
  setActiveLang(lang) // 同步进 core，让 imperative t() 一开始就对
  return {
    pref,
    lang,
    setPref: (p) => {
      writePref(p)
      const l = effectiveLang(p, systemLocale())
      setActiveLang(l)
      applyLang(l)
      set({ pref: p, lang: l })
    },
  }
})

// React 组件用：订阅 lang，切换语言即时重渲染，返回绑定当前语言的 t。
export function useT(): TFunc {
  const lang = useLang((s) => s.lang)
  return useMemo(() => makeT(ZH, EN, lang), [lang])
}

// 非 React 调用方用（store 里的 toast / 磁盘默认名 / lib 函数）：读当前生效语言、即时求值，不订阅。
// 委托给 core 的纯 t（core 的 _lang 由上面 setActiveLang 同步）——纯模块可直接 import from './core' 免 React。
export const t = coreT
export const currentLang = getActiveLang

// 首屏在 render 前调（main.tsx），把 <html lang> 设对 + core 语言就位。
export function initLang(): void {
  const lang = effectiveLang(readPref(), systemLocale())
  setActiveLang(lang)
  applyLang(lang)
}
