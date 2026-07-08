import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useStore } from './../mock/store'
import { useUI } from '../mock/ui'
import { usePaged } from '../mock/paged'
import {
  MARGIN_PRESETS,
  PAPERS,
  type Orientation,
  type PageConfig,
  type PageMargin,
  type PaperSize,
} from '../lib/page'
import './PageSetupModal.css'

// 「页面设置」——文档右上 ⋯ 菜单打开。分页文档开关 + 纸张/方向/边距/导出页码。
// 所有改动即时生效（关掉弹窗就是「完成」），分页视图在弹窗背后实时变，所见即所得。
export default function PageSetupModal() {
  const docId = useUI((s) => s.pageSetupFor)
  const close = useUI((s) => s.closePageSetup)
  const getDoc = useStore((s) => s.getDoc)
  const cfg = usePaged((s) => (docId ? s.configs[docId] : undefined))
  const setConfig = usePaged((s) => s.setConfig)

  // 当前生效配置（未配置过 = 默认关闭）
  const effective: PageConfig = useMemo(
    () =>
      cfg ?? {
        on: false,
        size: 'A4',
        orientation: 'portrait',
        margin: MARGIN_PRESETS[0].margin,
        pageNumbers: false,
      },
    [cfg],
  )

  if (!docId) return null
  const doc = getDoc(docId)
  if (!doc) return null

  const patch = (p: Partial<PageConfig>) => setConfig(docId, { ...effective, ...p })
  const setMargin = (m: Partial<PageMargin>) =>
    patch({ margin: { ...effective.margin, ...m } })

  const presetKey =
    MARGIN_PRESETS.find(
      (p) =>
        p.margin.top === effective.margin.top &&
        p.margin.right === effective.margin.right &&
        p.margin.bottom === effective.margin.bottom &&
        p.margin.left === effective.margin.left,
    )?.key ?? 'custom'

  const off = !effective.on

  return (
    <div
      className="ws-modal-overlay"
      onMouseDown={close}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div
        className="ws-modal pg-modal"
        role="dialog"
        aria-modal="true"
        aria-label="页面设置"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">页面设置</div>
            <div className="ws-modal-sub">「{doc.title}」· 分页显示与导出 PDF 的纸张版式</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="pg-body">
          {/* 分页文档总开关 */}
          <div className="pg-row pg-row-master">
            <div className="pg-row-text">
              <div className="pg-row-label">分页文档</div>
              <div className="pg-row-note">像 Word 那样按纸张分页显示，导出 PDF 同版式</div>
            </div>
            <Switch on={effective.on} onToggle={() => patch({ on: !effective.on })} />
          </div>

          <div className={'pg-settings' + (off ? ' is-off' : '')}>
            {/* 纸张 */}
            <div className="pg-field">
              <div className="pg-field-label">纸张</div>
              <div className="pg-seg" role="radiogroup" aria-label="纸张">
                {(Object.keys(PAPERS) as PaperSize[]).map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={effective.size === k}
                    disabled={off}
                    className={'pg-seg-item' + (effective.size === k ? ' is-on' : '')}
                    onClick={() => patch({ size: k })}
                  >
                    {PAPERS[k].label}
                  </button>
                ))}
              </div>
            </div>

            {/* 方向 */}
            <div className="pg-field">
              <div className="pg-field-label">方向</div>
              <div className="pg-seg" role="radiogroup" aria-label="方向">
                {(
                  [
                    ['portrait', '纵向'],
                    ['landscape', '横向'],
                  ] as [Orientation, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={effective.orientation === k}
                    disabled={off}
                    className={'pg-seg-item' + (effective.orientation === k ? ' is-on' : '')}
                    onClick={() => patch({ orientation: k })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 边距 */}
            <div className="pg-field">
              <div className="pg-field-label">边距</div>
              <div className="pg-seg" role="radiogroup" aria-label="边距预设">
                {MARGIN_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    role="radio"
                    aria-checked={presetKey === p.key}
                    disabled={off}
                    className={'pg-seg-item' + (presetKey === p.key ? ' is-on' : '')}
                    onClick={() => patch({ margin: p.margin })}
                  >
                    {p.label}
                  </button>
                ))}
                <span
                  className={'pg-seg-item pg-seg-ghost' + (presetKey === 'custom' ? ' is-on' : '')}
                >
                  自定义
                </span>
              </div>
              <div className="pg-margins">
                {(
                  [
                    ['top', '上'],
                    ['bottom', '下'],
                    ['left', '左'],
                    ['right', '右'],
                  ] as [keyof PageMargin, string][]
                ).map(([k, label]) => (
                  <label key={k} className="pg-mm">
                    <span>{label}</span>
                    <input
                      className="ws-input pg-mm-input"
                      type="number"
                      min={0}
                      max={80}
                      step={0.1}
                      disabled={off}
                      value={effective.margin[k]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (Number.isFinite(v)) setMargin({ [k]: Math.min(80, Math.max(0, v)) })
                      }}
                    />
                    <span className="pg-mm-unit">mm</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 导出页码 */}
            <div className="pg-row">
              <div className="pg-row-text">
                <div className="pg-row-label">导出 PDF 页脚页码</div>
                <div className="pg-row-note">形如「2 / 5」，居中页脚</div>
              </div>
              <Switch
                on={effective.pageNumbers}
                disabled={off}
                onToggle={() => patch({ pageNumbers: !effective.pageNumbers })}
              />
            </div>
          </div>
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn ws-btn-primary" onClick={close}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

// 墨圆 switch（style.md §5：track 圆丸、on=墨底、滑块 spring）
function Switch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      className={'pg-switch' + (on ? ' is-on' : '')}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="pg-switch-knob" />
    </button>
  )
}
