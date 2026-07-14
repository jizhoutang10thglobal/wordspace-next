import { useEffect } from 'react'
import { X, Eraser, Check } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import type { Template } from '../types'
import './TemplateGalleryModal.css'

/**
 * 换装画廊——贴边侧挂面板（右侧滑入，无全屏暗幕，文档主列在预览时完整可见）。
 * hover / 键盘聚焦某模板卡 → previewCss 临时喂给 Canvas（真实内容实时套，未落章）；
 * 点击 → applyTemplate 盖章 + toast 撤销。分组 = 官方 / 我的（Template.origin 驱动）。
 */
export default function TemplateGalleryModal() {
  const docId = useUI((s) => s.templateGalleryFor)
  const close = useUI((s) => s.closeTemplateGallery)
  const setPreview = useUI((s) => s.setPreviewCss)
  const templates = useStore((s) => s.templates)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const doc = useStore((s) => (docId ? s.docs.find((d) => d.id === docId) : undefined))

  // Esc 关闭（画廊已进 anyOverlayOpen，壳快捷键不穿透）。
  useEffect(() => {
    if (!docId) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [docId, close])

  if (!docId || !doc) return null

  const official = templates.filter((t) => t.origin === 'official')
  const mine = templates.filter((t) => t.origin === 'user')
  const apply = (id: string | null) => {
    applyTemplate(doc.id, id)
    close()
  }

  const Card = ({ tpl }: { tpl: Template }) => {
    const active = doc.templateId === tpl.id
    return (
      <button
        className={'ws-tplgal-card' + (active ? ' is-active' : '')}
        // hover 与键盘聚焦等价触发预览（origin 拍的键盘平权）；离开/失焦清预览。
        onMouseEnter={() => setPreview(tpl.css ?? '')}
        onFocus={() => setPreview(tpl.css ?? '')}
        onMouseLeave={() => setPreview(null)}
        onBlur={() => setPreview(null)}
        onClick={() => apply(tpl.id)}
      >
        <span className="ws-tplgal-swatch" style={{ background: tpl.accent }} />
        <span className="ws-tplgal-meta">
          <span className="ws-tplgal-name">{tpl.name}</span>
          <span className="ws-tplgal-tag">{tpl.css ? '版式' : '骨架'}</span>
        </span>
        {active && <Check size={15} strokeWidth={2.2} className="ws-tplgal-check" />}
      </button>
    )
  }

  return (
    <>
      {/* 透明背板：接住面板外点击关闭，但不 dim 文档（预览要看得见真实内容）。 */}
      <div className="ws-tplgal-backdrop" onMouseDown={close} />
      <aside className="ws-tplgal" role="dialog" aria-label="更换版式模板">
        <header className="ws-tplgal-head">
          <span className="ws-tplgal-title">更换版式</span>
          <button className="ws-tplgal-x" aria-label="关闭" onClick={close}>
            <X size={16} strokeWidth={1.9} />
          </button>
        </header>
        <div className="ws-tplgal-body">
          {/* 素颜（移除模板）：仅当文档已有模板时出现。hover 预览无主题态。 */}
          {doc.templateId && (
            <button
              className="ws-tplgal-card ws-tplgal-bare"
              onMouseEnter={() => setPreview('')}
              onFocus={() => setPreview('')}
              onMouseLeave={() => setPreview(null)}
              onBlur={() => setPreview(null)}
              onClick={() => apply(null)}
            >
              <span className="ws-tplgal-swatch is-bare">
                <Eraser size={14} strokeWidth={1.8} />
              </span>
              <span className="ws-tplgal-meta">
                <span className="ws-tplgal-name">素颜（移除模板）</span>
                <span className="ws-tplgal-tag">回到 baseline</span>
              </span>
            </button>
          )}

          <div className="ws-tplgal-group-label">官方</div>
          {official.map((t) => (
            <Card key={t.id} tpl={t} />
          ))}

          {mine.length > 0 && (
            <>
              <div className="ws-tplgal-group-label">我的</div>
              {mine.map((t) => (
                <Card key={t.id} tpl={t} />
              ))}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
