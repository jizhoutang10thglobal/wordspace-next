import { useEffect, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Settings2 } from 'lucide-react'
import { useT } from '../i18n'
import { useUI } from '../mock/ui'
import { usePageConfig } from '../mock/paged'
import { useDocTypography, applyPreset, useCustomPresets } from '../mock/typography'
import { PRESETS, ALL_FONT_IDS, ZIHAO_PT, fontStack, ptToPx, getPreset, deriveActivePreset, type TextAlign } from '../lib/typography'
import './TypographyToolbar.css'

// 顶部排版工具栏（Word ribbon 口径）：预设 = 设文档默认（样式集）；字体/字号/加粗/对齐 = 应用到**选区**
// （没选区就作用于选中的整块，走 Canvas 的 applyCmd）。工具栏反映当前选区的格式。仅分页文档、非内嵌显示。
// 控件用原生 <select>/<input>——天然带 ARIA/键盘。中西文分设是「文档默认」的高级项，挪进 ⚙ 弹窗。

const ALIGNS: { v: TextAlign; cmd: string; Icon: typeof AlignLeft; key: string }[] = [
  { v: 'left', cmd: 'justifyLeft', Icon: AlignLeft, key: 'editor.alignLeft' },
  { v: 'center', cmd: 'justifyCenter', Icon: AlignCenter, key: 'editor.alignCenter' },
  { v: 'right', cmd: 'justifyRight', Icon: AlignRight, key: 'editor.alignRight' },
  { v: 'justify', cmd: 'justifyFull', Icon: AlignJustify, key: 'editor.alignJustify' },
]

interface SelFmt {
  fontId: string | null
  sizePt: number | null
  bold: boolean
  align: string
}

export default function TypographyToolbar({ docId, onCmd }: { docId: string; onCmd: (command: string, value?: string) => void }) {
  const t = useT()
  const typoDoc = useDocTypography(docId)
  const pageCfg = usePageConfig(docId)
  const openPageSetup = useUI((s) => s.openPageSetup)
  const custom = useCustomPresets((s) => s.presets)
  const cfg = typoDoc.config
  const active = deriveActivePreset(pageCfg, cfg, typoDoc.lastPresetId)

  // 反映当前选区的格式（Word：工具栏显示光标/选中处的格式）。选区变 → 读 computed。
  const [sel, setSel] = useState<SelFmt | null>(null)
  useEffect(() => {
    const read = () => {
      const s = window.getSelection()
      const node = s?.anchorNode
      const el = (node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null)) ?? null
      if (!el || !el.closest?.('.ws-doc-paged')) { setSel(null); return }
      const cs = getComputedStyle(el)
      const sizePt = Math.round((parseFloat(cs.fontSize) * 72) / 96 * 2) / 2
      const bold = parseInt(cs.fontWeight, 10) >= 600
      const first = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
      const fontId = ALL_FONT_IDS.find((id) => fontStack(id).split(',')[0].replace(/["']/g, '').trim().toLowerCase() === first) ?? null
      setSel({ fontId, sizePt, bold, align: cs.textAlign })
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])

  // 显示值：优先选区，回退文档默认
  const shownFont = sel?.fontId ?? cfg.body.cnFont
  const shownSize = sel?.sizePt ?? cfg.body.sizePt
  const shownAlign = sel?.align ?? cfg.body.align
  const shownBold = sel?.bold ?? false

  const presetLabel = (id: string): string => {
    const b = getPreset(id)
    if (b?.nameKey) return t(b.nameKey)
    return custom.find((p) => p.id === id)?.name ?? id
  }
  const presetVal = active.isCustom ? '__custom' : active.presetId ?? ''

  return (
    <div className="ws-typo-bar" role="toolbar" aria-label={t('editor.typoBarAria')}>
      {/* 预设（= 设文档默认样式集） */}
      <select
        className="ws-typo-sel ws-typo-preset"
        value={presetVal}
        aria-label={t('editor.presetAria')}
        onChange={(e) => { if (e.target.value !== '__custom') applyPreset(docId, e.target.value) }}
      >
        {active.isCustom && (
          <option value="__custom">
            {active.basedOn ? t('editor.presetCustomBasedOn', { name: presetLabel(active.basedOn) }) : t('editor.presetCustom')}
          </option>
        )}
        <optgroup label={t('editor.presetsBuiltin')}>
          {PRESETS.map((p) => (<option key={p.id} value={p.id}>{t(p.nameKey!)}</option>))}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label={t('editor.presetsCustom')}>
            {custom.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </optgroup>
        )}
      </select>

      <span className="ws-typo-div" aria-hidden="true" />

      {/* 字体（一个下拉，中西混列）→ 应用到选区 */}
      <select
        className="ws-typo-sel"
        value={shownFont}
        aria-label={t('editor.fontAria')}
        onChange={(e) => onCmd('fontName', fontStack(e.target.value))}
      >
        {ALL_FONT_IDS.map((id) => (<option key={id} value={id}>{t('editor.font_' + id)}</option>))}
      </select>

      {/* 字号（可自由输入 pt；datalist 显示 号）→ 应用到选区 */}
      <input
        className="ws-typo-size"
        type="number"
        min={5}
        max={72}
        step={0.5}
        list="ws-zihao-list"
        value={shownSize}
        aria-label={t('editor.sizeAria')}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onCmd('__fontsize__', `${ptToPx(Math.min(72, Math.max(5, v)))}px`)
        }}
      />
      <datalist id="ws-zihao-list">
        {ZIHAO_PT.map((z) => (<option key={z.id} value={z.pt} label={`${t('editor.zihao_' + z.id)} (${z.pt}pt)`} />))}
      </datalist>

      {/* 加粗 → 应用到选区 */}
      <button
        type="button"
        className={'ws-typo-bold' + (shownBold ? ' is-on' : '')}
        aria-pressed={shownBold}
        aria-label={t('editor.bold')}
        title={t('editor.bold')}
        onClick={() => onCmd('bold')}
      >
        <Bold size={15} />
      </button>

      <span className="ws-typo-div" aria-hidden="true" />

      {/* 对齐 → 应用到选中段落 */}
      <div className="ws-typo-align" role="radiogroup" aria-label={t('editor.alignAria')}>
        {ALIGNS.map(({ v, cmd, Icon, key }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={shownAlign === v}
            aria-label={t(key)}
            className={'ws-typo-align-btn' + (shownAlign === v ? ' is-on' : '')}
            onClick={() => onCmd(cmd)}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <span className="ws-typo-div" aria-hidden="true" />

      <button className="ws-typo-gear" type="button" aria-label={t('editor.pageSetupMenu')} title={t('editor.pageSetupMenu')} onClick={() => openPageSetup(docId)}>
        <Settings2 size={16} />
      </button>
    </div>
  )
}
