import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './SaveTemplateModal.css'

/** 「将当前文档存为模板」——命名 + 是否含内容骨架 + 重名提示（不静默覆盖，创建新条目）。 */
export default function SaveTemplateModal() {
  const docId = useUI((s) => s.saveTemplateFor)
  const close = useUI((s) => s.closeSaveTemplate)
  const doc = useStore((s) => (docId ? s.docs.find((d) => d.id === docId) : undefined))
  const templates = useStore((s) => s.templates)
  const saveDocAsTemplate = useStore((s) => s.saveDocAsTemplate)

  const [name, setName] = useState('')
  const [includeSkeleton, setIncludeSkeleton] = useState(true)

  useEffect(() => {
    if (doc) setName(doc.title + ' 模板')
  }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!docId || !doc) return null

  const dup = templates.some((t) => t.origin === 'user' && t.name === name.trim())
  const hasTheme = !!doc.templateCss
  const save = () => {
    saveDocAsTemplate(doc.id, name, includeSkeleton)
    close()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div className="ws-modal stpl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="ws-modal-head">
          <div className="ws-modal-title">存为模板</div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} strokeWidth={1.9} />
          </button>
        </header>

        <label className="stpl-field">
          <span className="stpl-label">模板名称</span>
          <input
            className="stpl-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()}
          />
        </label>
        {dup && <div className="stpl-hint stpl-warn">已有同名模板，保存会新增一个（不覆盖旧的）。</div>}

        <label className="stpl-check">
          <input type="checkbox" checked={includeSkeleton} onChange={(e) => setIncludeSkeleton(e.target.checked)} />
          <span>包含内容骨架（新建时带上本文档的块结构）</span>
        </label>

        <div className="stpl-hint">
          {hasTheme ? '将保存当前文档的版式主题' : '当前文档为素颜（无版式），存出的是纯骨架模板'}
          {' · '}
          用户模板会出现在「模板」页与画廊的「我的」分组
        </div>

        <div className="stpl-actions">
          <button className="stpl-btn-ghost" onClick={close}>取消</button>
          <button className="stpl-btn-primary" onClick={save} disabled={!name.trim()}>存为模板</button>
        </div>
      </div>
    </div>
  )
}
