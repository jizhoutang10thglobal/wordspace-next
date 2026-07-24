import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Settings2 } from 'lucide-react'
import { useT } from '../i18n'
import { useUI } from '../mock/ui'
import { usePageConfig } from '../mock/paged'
import { useDocTypography, useTypography, applyPreset, useCustomPresets } from '../mock/typography'
import {
  PRESETS,
  CN_FONT_IDS,
  LATIN_FONT_IDS,
  ZIHAO_PT,
  getPreset,
  deriveActivePreset,
  type TextAlign,
} from '../lib/typography'
import './TypographyToolbar.css'

// 顶部排版工具栏（U5）：仅分页文档显示（Canvas 里 {paged && ...} 门控）。常用控件在栏、重的进 ⚙ 弹窗（KTD4）。
// 控件用原生 <select>/<input list=datalist>——天然带 ARIA/键盘（解 design-lens「自定义组件丢 a11y」），
// 字号 input 支持自由输入任意 pt（R11），datalist 显示「号 (pt)」双标。
const ALIGNS: { v: TextAlign; Icon: typeof AlignLeft; key: string }[] = [
  { v: 'left', Icon: AlignLeft, key: 'editor.alignLeft' },
  { v: 'center', Icon: AlignCenter, key: 'editor.alignCenter' },
  { v: 'right', Icon: AlignRight, key: 'editor.alignRight' },
  { v: 'justify', Icon: AlignJustify, key: 'editor.alignJustify' },
]

export default function TypographyToolbar({ docId }: { docId: string }) {
  const t = useT()
  const typoDoc = useDocTypography(docId)
  const pageCfg = usePageConfig(docId)
  const openPageSetup = useUI((s) => s.openPageSetup)
  const custom = useCustomPresets((s) => s.presets)
  const cfg = typoDoc.config
  const active = deriveActivePreset(pageCfg, cfg, typoDoc.lastPresetId)

  const setBody = (patch: Partial<typeof cfg.body>) =>
    useTypography.getState().setConfig(docId, { ...cfg, body: { ...cfg.body, ...patch } })

  const presetLabel = (id: string): string => {
    const b = getPreset(id)
    if (b?.nameKey) return t(b.nameKey)
    const c = custom.find((p) => p.id === id)
    return c?.name ?? id
  }
  const presetVal = active.isCustom ? '__custom' : active.presetId ?? ''

  const lhMode = cfg.body.lineHeight.mode
  const lhVal = lhMode === 'fixedPt' ? '__fixed' : String(cfg.body.lineHeight.value)

  return (
    <div className="ws-typo-bar" role="toolbar" aria-label={t('editor.typoBarAria')}>
      {/* 预设 */}
      <select
        className="ws-typo-sel ws-typo-preset"
        value={presetVal}
        aria-label={t('editor.presetAria')}
        onChange={(e) => {
          if (e.target.value !== '__custom') applyPreset(docId, e.target.value)
        }}
      >
        {active.isCustom && (
          <option value="__custom">
            {active.basedOn
              ? t('editor.presetCustomBasedOn', { name: presetLabel(active.basedOn) })
              : t('editor.presetCustom')}
          </option>
        )}
        <optgroup label={t('editor.presetsBuiltin')}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.nameKey!)}
            </option>
          ))}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label={t('editor.presetsCustom')}>
            {custom.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <span className="ws-typo-div" aria-hidden="true" />

      {/* 中文字体 */}
      <select className="ws-typo-sel" value={cfg.body.cnFont} aria-label={t('editor.cnFontAria')} onChange={(e) => setBody({ cnFont: e.target.value })}>
        {CN_FONT_IDS.map((id) => (
          <option key={id} value={id}>{t('editor.font_' + id)}</option>
        ))}
      </select>
      {/* 西文字体 */}
      <select className="ws-typo-sel" value={cfg.body.latinFont} aria-label={t('editor.latinFontAria')} onChange={(e) => setBody({ latinFont: e.target.value })}>
        {LATIN_FONT_IDS.map((id) => (
          <option key={id} value={id}>{t('editor.font_' + id)}</option>
        ))}
      </select>

      {/* 字号（可自由输入 pt；datalist 显示 号(pt)） */}
      <input
        className="ws-typo-size"
        type="number"
        min={5}
        max={72}
        step={0.5}
        list="ws-zihao-list"
        value={cfg.body.sizePt}
        aria-label={t('editor.sizeAria')}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) setBody({ sizePt: Math.min(72, Math.max(5, v)) })
        }}
      />
      <datalist id="ws-zihao-list">
        {ZIHAO_PT.map((z) => (
          <option key={z.id} value={z.pt} label={`${t('editor.zihao_' + z.id)} (${z.pt}pt)`} />
        ))}
      </datalist>

      {/* 行距 */}
      <select
        className="ws-typo-sel ws-typo-lh"
        value={lhVal}
        aria-label={t('editor.lineHeightAria')}
        onChange={(e) => {
          if (e.target.value !== '__fixed') setBody({ lineHeight: { mode: 'multiple', value: Number(e.target.value) } })
        }}
      >
        {lhMode === 'fixedPt' && (
          <option value="__fixed">{t('editor.lineHeightFixed', { pt: cfg.body.lineHeight.value })}</option>
        )}
        <option value="1">{t('editor.lineHeightSingle')}</option>
        <option value="1.5">1.5</option>
        <option value="2">{t('editor.lineHeightDouble')}</option>
      </select>

      <span className="ws-typo-div" aria-hidden="true" />

      {/* 对齐 */}
      <div className="ws-typo-align" role="radiogroup" aria-label={t('editor.alignAria')}>
        {ALIGNS.map(({ v, Icon, key }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={cfg.body.align === v}
            aria-label={t(key)}
            className={'ws-typo-align-btn' + (cfg.body.align === v ? ' is-on' : '')}
            onClick={() => setBody({ align: v })}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <button className="ws-typo-gear" type="button" aria-label={t('editor.pageSetupMenu')} title={t('editor.pageSetupMenu')} onClick={() => openPageSetup(docId)}>
        <Settings2 size={16} />
      </button>
    </div>
  )
}
