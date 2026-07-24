import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useT } from '../i18n'
import { useStore } from './../mock/store'
import { useUI } from '../mock/ui'
import { usePaged } from '../mock/paged'
import { useDocTypography, useTypography, useCustomPresets } from '../mock/typography'
import {
  MARGIN_PRESETS,
  PAPERS,
  type Orientation,
  type PageConfig,
  type PageMargin,
  type PaperSize,
} from '../lib/page'
import { CN_FONT_IDS, mmToInch, inchToMm, type HeadingStyle } from '../lib/typography'
import './PageSetupModal.css'

type HKey = 'h1' | 'h2' | 'h3' | 'h4'

// 「页面设置」——⋯菜单 / 排版工具栏 ⚙ 打开。三分区（页面 / 排版 / 标题），改动即时生效、弹窗背后所见即所得。
// 页面级(纸张/方向/边距双单位/页码)走 usePaged；排版/标题走 useTypography(分层，KTD1)。
export default function PageSetupModal() {
  const t = useT()
  const docId = useUI((s) => s.pageSetupFor)
  const close = useUI((s) => s.closePageSetup)
  const getDoc = useStore((s) => s.getDoc)
  const cfg = usePaged((s) => (docId ? s.configs[docId] : undefined))
  const setConfig = usePaged((s) => s.setConfig)
  const typoDoc = useDocTypography(docId)
  const customPresets = useCustomPresets((s) => s.presets)

  const [unit, setUnit] = useState<'mm' | 'inch'>('mm')
  const [presetName, setPresetName] = useState('')
  const [saveErr, setSaveErr] = useState<'' | 'empty' | 'duplicate'>('')

  const effective: PageConfig = useMemo(
    () => cfg ?? { on: false, size: 'A4', orientation: 'portrait', margin: MARGIN_PRESETS[0].margin, pageNumbers: false },
    [cfg],
  )

  if (!docId) return null
  const doc = getDoc(docId)
  if (!doc) return null

  const patch = (p: Partial<PageConfig>) => setConfig(docId, { ...effective, ...p })
  const setMargin = (m: Partial<PageMargin>) => patch({ margin: { ...effective.margin, ...m } })
  const body = typoDoc.config.body
  const setBody = (p: Partial<typeof body>) =>
    useTypography.getState().setConfig(docId, { ...typoDoc.config, body: { ...body, ...p } })
  const setHeading = (lv: HKey, p: Partial<HeadingStyle>) =>
    useTypography.getState().setConfig(docId, {
      ...typoDoc.config,
      headings: { ...typoDoc.config.headings, [lv]: { ...typoDoc.config.headings[lv], ...p } },
    })

  const presetKey =
    MARGIN_PRESETS.find(
      (p) =>
        p.margin.top === effective.margin.top &&
        p.margin.right === effective.margin.right &&
        p.margin.bottom === effective.margin.bottom &&
        p.margin.left === effective.margin.left,
    )?.key ?? 'custom'
  const off = !effective.on

  // 边距显示：存储恒 mm，只在显示/输入层换算（KTD3）
  const dispMargin = (mm: number) => (unit === 'mm' ? mm : Number(mmToInch(mm).toFixed(2)))
  const toMm = (v: number) => (unit === 'mm' ? v : inchToMm(v))

  const doSave = () => {
    const r = useCustomPresets.getState().saveAs(
      presetName,
      { size: effective.size, orientation: effective.orientation, margin: effective.margin },
      typoDoc.config,
    )
    if (r.ok) { setPresetName(''); setSaveErr('') } else setSaveErr(r.reason ?? 'empty')
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="ws-modal pg-modal" role="dialog" aria-modal="true" aria-label={t('editor.pageSetupTitle')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">{t('editor.pageSetupTitle')}</div>
            <div className="ws-modal-sub">{t('editor.pageSetupSub', { title: doc.title })}</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="pg-body">
          {/* 分页文档总开关 */}
          <div className="pg-row pg-row-master">
            <div className="pg-row-text">
              <div className="pg-row-label">{t('editor.pagedDoc')}</div>
              <div className="pg-row-note">{t('editor.pagedDocNote')}</div>
            </div>
            <Switch on={effective.on} onToggle={() => patch({ on: !effective.on })} />
          </div>

          <div className={'pg-settings' + (off ? ' is-off' : '')}>
            {/* ===== 页面 ===== */}
            <div className="pg-sec-title">{t('editor.secPage')}</div>

            <div className="pg-field">
              <div className="pg-field-label">{t('editor.paper')}</div>
              <div className="pg-seg" role="radiogroup" aria-label={t('editor.paper')}>
                {(Object.keys(PAPERS) as PaperSize[]).map((k) => (
                  <button key={k} role="radio" aria-checked={effective.size === k} disabled={off} className={'pg-seg-item' + (effective.size === k ? ' is-on' : '')} onClick={() => patch({ size: k })}>
                    {PAPERS[k].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pg-field">
              <div className="pg-field-label">{t('editor.orientation')}</div>
              <div className="pg-seg" role="radiogroup" aria-label={t('editor.orientation')}>
                {([['portrait', t('editor.portrait')], ['landscape', t('editor.landscape')]] as [Orientation, string][]).map(([k, label]) => (
                  <button key={k} role="radio" aria-checked={effective.orientation === k} disabled={off} className={'pg-seg-item' + (effective.orientation === k ? ' is-on' : '')} onClick={() => patch({ orientation: k })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 边距 + mm/inch 单位切换 */}
            <div className="pg-field">
              <div className="pg-field-label pg-field-label-row">
                <span>{t('editor.margins')}</span>
                <div className="pg-seg pg-seg-sm" role="radiogroup" aria-label={t('editor.unitAria')}>
                  {(['mm', 'inch'] as const).map((u) => (
                    <button key={u} role="radio" aria-checked={unit === u} disabled={off} className={'pg-seg-item' + (unit === u ? ' is-on' : '')} onClick={() => setUnit(u)}>
                      {u === 'mm' ? t('editor.unitMm') : t('editor.unitInch')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pg-seg" role="radiogroup" aria-label={t('editor.marginsAria')}>
                {MARGIN_PRESETS.map((p) => (
                  <button key={p.key} role="radio" aria-checked={presetKey === p.key} disabled={off} className={'pg-seg-item' + (presetKey === p.key ? ' is-on' : '')} onClick={() => patch({ margin: p.margin })}>
                    {t(p.label)}
                  </button>
                ))}
                <span className={'pg-seg-item pg-seg-ghost' + (presetKey === 'custom' ? ' is-on' : '')}>{t('editor.custom')}</span>
              </div>
              <div className="pg-margins">
                {([['top', t('editor.marginTop')], ['bottom', t('editor.marginBottom')], ['left', t('editor.marginLeft')], ['right', t('editor.marginRight')]] as [keyof PageMargin, string][]).map(([k, label]) => (
                  <label key={k} className="pg-mm">
                    <span>{label}</span>
                    <input
                      className="ws-input pg-mm-input"
                      type="number"
                      min={0}
                      max={unit === 'mm' ? 80 : 3}
                      step={unit === 'mm' ? 0.1 : 0.01}
                      disabled={off}
                      value={dispMargin(effective.margin[k])}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) setMargin({ [k]: Math.min(80, Math.max(0, toMm(v))) })
                      }}
                    />
                    <span className="pg-mm-unit">{unit}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pg-row">
              <div className="pg-row-text">
                <div className="pg-row-label">{t('editor.pageNumbers')}</div>
                <div className="pg-row-note">{t('editor.pageNumbersNote')}</div>
              </div>
              <Switch on={effective.pageNumbers} disabled={off} onToggle={() => patch({ pageNumbers: !effective.pageNumbers })} />
            </div>

            {/* ===== 排版（工具栏没有的：首行缩进 / 段间距）===== */}
            <div className="pg-sec-title">{t('editor.secTypography')}</div>
            <div className="pg-typo-grid">
              <label className="pg-num">
                <span>{t('editor.firstIndent')}</span>
                <input className="ws-input" type="number" min={0} max={8} step={0.5} disabled={off} value={body.firstIndentEm} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setBody({ firstIndentEm: Math.min(8, Math.max(0, v)) }) }} />
                <span className="pg-mm-unit">{t('editor.emUnit')}</span>
              </label>
              <label className="pg-num">
                <span>{t('editor.spaceBefore')}</span>
                <input className="ws-input" type="number" min={0} max={48} step={1} disabled={off} value={body.spaceBeforePt} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setBody({ spaceBeforePt: Math.min(48, Math.max(0, v)) }) }} />
                <span className="pg-mm-unit">pt</span>
              </label>
              <label className="pg-num">
                <span>{t('editor.spaceAfter')}</span>
                <input className="ws-input" type="number" min={0} max={48} step={1} disabled={off} value={body.spaceAfterPt} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setBody({ spaceAfterPt: Math.min(48, Math.max(0, v)) }) }} />
                <span className="pg-mm-unit">pt</span>
              </label>
            </div>

            {/* ===== 标题各级 H1–H4 ===== */}
            <div className="pg-sec-title">{t('editor.secHeadings')}</div>
            {(['h1', 'h2', 'h3', 'h4'] as HKey[]).map((lv, i) => {
              const h = typoDoc.config.headings[lv]
              return (
                <div key={lv} className="pg-head-row">
                  <span className="pg-head-lv">{t('editor.heading' + (i + 1))}</span>
                  <select className="pg-head-sel" disabled={off} value={h.cnFont} aria-label={t('editor.cnFontAria')} onChange={(e) => setHeading(lv, { cnFont: e.target.value })}>
                    {CN_FONT_IDS.map((id) => (<option key={id} value={id}>{t('editor.font_' + id)}</option>))}
                  </select>
                  <input className="ws-input pg-head-size" type="number" min={5} max={72} step={0.5} disabled={off} value={h.sizePt} aria-label={t('editor.sizeAria')} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setHeading(lv, { sizePt: Math.min(72, Math.max(5, v)) }) }} />
                  <button type="button" disabled={off} className={'pg-head-bold' + (h.bold ? ' is-on' : '')} aria-pressed={h.bold} aria-label={t('editor.bold')} onClick={() => setHeading(lv, { bold: !h.bold })}>B</button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="ws-modal-foot pg-foot">
          <div className="pg-saveas">
            <input
              className="ws-input pg-saveas-input"
              placeholder={t('editor.presetNamePlaceholder')}
              value={presetName}
              disabled={off}
              onChange={(e) => { setPresetName(e.target.value); setSaveErr('') }}
            />
            <button className="ws-btn" disabled={off} onClick={doSave}>{t('editor.saveAsPreset')}</button>
            {saveErr && <span className="pg-saveas-err">{t(saveErr === 'duplicate' ? 'editor.presetDupError' : 'editor.presetEmptyError')}</span>}
            {customPresets.length > 0 && !saveErr && <span className="pg-saveas-note">{t('editor.customPresetCount', { n: customPresets.length })}</span>}
          </div>
          <button className="ws-btn ws-btn-primary" onClick={close}>{t('common.done')}</button>
        </div>
      </div>
    </div>
  )
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button className={'pg-switch' + (on ? ' is-on' : '')} role="switch" aria-checked={on} disabled={disabled} onClick={onToggle}>
      <span className="pg-switch-knob" />
    </button>
  )
}
