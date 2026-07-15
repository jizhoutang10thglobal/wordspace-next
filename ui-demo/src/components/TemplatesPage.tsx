import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Pencil, Trash2, Check } from 'lucide-react'
import { useStore } from '../mock/store'
import { scopeTemplateCss } from '../lib/templateScope'
import type { Block, Template } from '../types'
import './TemplatesPage.css'

// 模板缩略图：把模板的前几块渲染成真实元素 + 作用域化的模板 CSS，缩放进卡片——
// 给用户看「长什么样」，不给 CSS（用户不在乎代码）。
function blockOuter(b: Block): string {
  const inner = b.html || ''
  switch (b.type) {
    case 'heading':
      return `<h${b.level || 1}>${inner}</h${b.level || 1}>`
    case 'text':
      return `<p>${inner}</p>`
    case 'list':
      return `<${b.listStyle === 'numbered' ? 'ol' : 'ul'}>${inner}</${b.listStyle === 'numbered' ? 'ol' : 'ul'}>`
    case 'quote':
      return `<blockquote>${inner}</blockquote>`
    case 'callout':
      return `<div class="ws-callout">${inner}</div>`
    case 'table':
      return inner
    case 'divider':
      return '<hr>'
    default:
      return inner ? `<div>${inner}</div>` : ''
  }
}

function TemplatePreview({ t }: { t: Template }) {
  const scope = 'tplp-prev-' + t.id
  const html = t.blocks.slice(0, 6).map(blockOuter).join('\n')
  return (
    <div className={'tplp-prev ' + scope}>
      {t.css && <style>{scopeTemplateCss(t.css, '.' + scope)}</style>}
      <div className="tplp-prev-page" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/** 「模板」页：官方 / 我的两组卡片（缩略图预览 + 名字）。点卡片 = 从它新建文档；我的可改名 / 删除。 */
export default function TemplatesPage() {
  const navigate = useNavigate()
  const templates = useStore((s) => s.templates)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const renameTemplate = useStore((s) => s.renameTemplate)
  const deleteTemplateWithUndo = useStore((s) => s.deleteTemplateWithUndo)

  const official = templates.filter((t) => t.origin === 'official')
  const mine = templates.filter((t) => t.origin === 'user')
  const [editing, setEditing] = useState<string>('') // 正在改名的模板 id

  const use = (t: Template) => {
    createFromTemplate(t.id, '')
    navigate('/docs')
  }

  const Card = ({ t }: { t: Template }) => {
    const isEditing = editing === t.id
    return (
      <div className="tplp-card">
        <button className="tplp-card-thumb" onClick={() => use(t)} title="从此模板新建文档">
          <TemplatePreview t={t} />
        </button>
        <div className="tplp-card-foot">
          {isEditing ? (
            <input
              className="tplp-card-rename"
              defaultValue={t.name}
              autoFocus
              onBlur={(e) => {
                renameTemplate(t.id, e.target.value)
                setEditing('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing('')
              }}
            />
          ) : (
            <span className="tplp-card-name" title={t.name}>{t.name}</span>
          )}
          {t.origin === 'user' && !isEditing && (
            <span className="tplp-card-ops">
              <button title="改名" onClick={() => setEditing(t.id)}>
                <Pencil size={13} strokeWidth={1.9} />
              </button>
              <button title="删除" onClick={() => deleteTemplateWithUndo(t.id)}>
                <Trash2 size={13} strokeWidth={1.9} />
              </button>
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="tplp-page">
      <header className="tplp-top">
        <button className="tplp-back" onClick={() => navigate('/docs')} title="返回">
          <ChevronLeft size={18} />
        </button>
        <h1>模板</h1>
        <span className="tplp-sub">点模板从它新建文档；把喜欢的文档在其 ⋯ 菜单里「存为模板」，就出现在下面「我的」。</span>
      </header>

      <div className="tplp-body">
        <div className="tplp-group-label">官方</div>
        <div className="tplp-grid">
          {official.map((t) => (
            <Card key={t.id} t={t} />
          ))}
        </div>

        <div className="tplp-group-label">我的</div>
        {mine.length === 0 ? (
          <div className="tplp-empty">
            <Check size={15} strokeWidth={1.8} />
            还没有自己的模板。在任意文档的 ⋯ 菜单里选「存为模板」，它就会出现在这里，以后一键复用。
          </div>
        ) : (
          <div className="tplp-grid">
            {mine.map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
