import { create } from 'zustand'

// 三态外观模式（浅色/深色/跟随系统）。ui-demo 侧无 nativeTheme，用 data-theme 属性 + matchMedia。
// 纯逻辑（normalizePref/effectiveTheme）与真 app 的 src/lib/appearance.js 同款——那份是 CI 门覆盖的
// canonical，这里因 ui-demo 是独立 Vite 包故重写一份（改逻辑两处一起改）。DOM 挂载/监听是 ui-demo 独有。

export type AppearancePref = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

const KEY = 'ws-appearance'
const PREFS: AppearancePref[] = ['system', 'light', 'dark']

export function normalizePref(raw: string | null | undefined): AppearancePref {
  return PREFS.includes(raw as AppearancePref) ? (raw as AppearancePref) : 'system'
}

export function effectiveTheme(pref: AppearancePref, systemDark: boolean): EffectiveTheme {
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

function readPref(): AppearancePref {
  try {
    return normalizePref(localStorage.getItem(KEY))
  } catch {
    return 'system'
  }
}

function writePref(pref: AppearancePref): void {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* private mode / 无 localStorage：不持久化，本会话仍生效 */
  }
}

const mql =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function systemDark(): boolean {
  return mql?.matches ?? false
}

// 挂/摘 data-theme：暗态挂 [data-theme="dark"]，浅色不挂属性（= 默认 :root）。
// 切换时短暂加 data-theme-switching 让 token 过渡（§4，reduced-motion 下 CSS 自动关）。
function apply(effective: EffectiveTheme, animate: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (animate) {
    root.setAttribute('data-theme-switching', '')
    window.setTimeout(() => root.removeAttribute('data-theme-switching'), 200)
  }
  if (effective === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
}

interface AppearanceState {
  pref: AppearancePref
  effective: EffectiveTheme
  setPref: (p: AppearancePref) => void
}

export const useAppearance = create<AppearanceState>((set, get) => {
  const pref = readPref()
  const effective = effectiveTheme(pref, systemDark())
  // 跟随系统：OS 主题变化只在 pref==='system' 时生效。
  mql?.addEventListener('change', (e) => {
    if (get().pref !== 'system') return
    const eff = effectiveTheme('system', e.matches)
    apply(eff, true)
    set({ effective: eff })
  })
  return {
    pref,
    effective,
    setPref: (p) => {
      writePref(p)
      const eff = effectiveTheme(p, systemDark())
      apply(eff, true)
      set({ pref: p, effective: eff })
    },
  }
})

// 首屏同步应用一次（在 render 前调，防 FOUC）。不加过渡（首帧不该动）。
export function initAppearance(): void {
  const pref = readPref()
  apply(effectiveTheme(pref, systemDark()), false)
}

export const APPEARANCE_LABELS: Record<AppearancePref, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
}
