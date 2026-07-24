import { create } from 'zustand'
import { usePaged } from './paged'
import { DEFAULT_TYPOGRAPHY, getPreset, type Preset, type TypographyConfig } from '../lib/typography'

// ============================================================================
// 分页文档「排版层」分层存储（KTD1）：与 usePaged（纯 @page）并列，独立按 doc id 存 localStorage。
// 语义对齐真 app 的「排版入盘」——demo 里 localStorage 就是那份盘（真 app align 时才入 data-ws-schema-css）。
//   ws-typography-docs    每文档 { config, lastPresetId }（lastPresetId 必须落盘，reload 后「自定义·基于X」要复原）
//   ws-typography-presets 用户自定义预设库（全局）
// ============================================================================

const LS_DOCS = 'ws-typography-docs'
const LS_PRESETS = 'ws-typography-presets'

export interface DocTypography {
  config: TypographyConfig
  lastPresetId: string | null // 最近一次套的预设 id（内置或自定义）；脱离后 basedOn 靠它
}

function loadDocs(): Record<string, DocTypography> {
  try {
    const raw = localStorage.getItem(LS_DOCS)
    return raw ? (JSON.parse(raw) as Record<string, DocTypography>) : {}
  } catch {
    return {}
  }
}
function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS)
    return raw ? (JSON.parse(raw) as Preset[]) : []
  } catch {
    return []
  }
}

interface TypographyState {
  docs: Record<string, DocTypography>
  getDoc: (docId: string | undefined) => DocTypography
  /** 改配置。lastPresetId 缺省 = 保留原值（改单个控件后 basedOn 不丢）；显式传 = 覆盖（applyPreset 用）。 */
  setConfig: (docId: string, config: TypographyConfig, lastPresetId?: string | null) => void
  /** 删文档时清本文档的排版条目（避免孤儿累积；U7 的 deleteDoc 接它）。 */
  prune: (docId: string) => void
}

export const useTypography = create<TypographyState>()((set, get) => ({
  docs: loadDocs(),
  getDoc: (docId) => (docId && get().docs[docId]) || { config: DEFAULT_TYPOGRAPHY, lastPresetId: null },
  setConfig: (docId, config, lastPresetId) => {
    const prev = get().docs[docId]
    const doc: DocTypography = {
      config,
      lastPresetId: lastPresetId !== undefined ? lastPresetId : prev?.lastPresetId ?? null,
    }
    const docs = { ...get().docs, [docId]: doc }
    set({ docs })
    try {
      localStorage.setItem(LS_DOCS, JSON.stringify(docs))
    } catch {
      // localStorage 满/禁用：静默，配置退化为会话内有效（与 paged store 同口径）
    }
  },
  prune: (docId) => {
    if (!(docId in get().docs)) return
    const docs = { ...get().docs }
    delete docs[docId]
    set({ docs })
    try {
      localStorage.setItem(LS_DOCS, JSON.stringify(docs))
    } catch {
      // 同上
    }
  },
}))

interface CustomPresetsState {
  presets: Preset[]
  /** 另存当前配置为具名自定义预设。重名拒绝（不静默覆盖——防 A1 存公司标准的数据丢失）。 */
  saveAs: (name: string, page: Preset['page'], type: TypographyConfig) => { ok: boolean; reason?: 'empty' | 'duplicate' }
  remove: (id: string) => void
}

export const useCustomPresets = create<CustomPresetsState>()((set, get) => ({
  presets: loadPresets(),
  saveAs: (name, page, type) => {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: 'empty' }
    if (get().presets.some((p) => p.name === trimmed)) return { ok: false, reason: 'duplicate' }
    const preset: Preset = { id: 'custom-' + Date.now().toString(36), name: trimmed, page, type }
    const presets = [...get().presets, preset]
    set({ presets })
    try {
      localStorage.setItem(LS_PRESETS, JSON.stringify(presets))
    } catch {
      // 同上
    }
    return { ok: true }
  },
  remove: (id) => {
    const presets = get().presets.filter((p) => p.id !== id)
    set({ presets })
    try {
      localStorage.setItem(LS_PRESETS, JSON.stringify(presets))
    } catch {
      // 同上
    }
  },
}))

/**
 * 套用预设（内置或自定义）：一键设 page（合并 @page 几何）+ type（排版）+ lastPresetId。
 * 内存两写经各自 store 的 setConfig（React18 自动批量 → 单次 re-render/重排，避免双重分页/闪烁）。
 * 持久化半失败（quota 卡在两 setItem 之间）是 FYI 级罕见退化，与 paged store 既有 swallow 口径一致，
 * 原型接受；真 app align 时排版入盘是原子文件写，无此问题。
 */
export function applyPreset(docId: string, presetId: string): void {
  const preset = getPreset(presetId) ?? useCustomPresets.getState().presets.find((p) => p.id === presetId)
  if (!preset) return
  const paged = usePaged.getState()
  const prevPage = paged.getConfig(docId)
  paged.setConfig(docId, { ...prevPage, ...preset.page }) // 只覆盖预设声明的 size/orientation/margin，保留 on/pageNumbers
  useTypography.getState().setConfig(docId, preset.type, presetId)
}
