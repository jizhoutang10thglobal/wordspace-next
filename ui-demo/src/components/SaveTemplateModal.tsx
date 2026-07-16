import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useT } from '../i18n'
import './SaveTemplateModal.css'

/** 「将当前文档存为模板」——命名 + 是否含内容骨架 + 重名提示（不静默覆盖，创建新条目）。 */
export default function SaveTemplateModal() {
  const t = useT()
  const docId = useUI((s) => s.saveTemplateFor)
  const close = useUI((s) => s.closeSaveTemplate)
  const doc = useStore((s) => (docId ? s.docs.find((d) => d.id === docId) : undefined))
  const templates = useStore((s) => s.templates)
  const saveDocAsTemplate = useStore((s) => s.saveDocAsTemplate)

  const [name, setName] = useState('')
  const [includeSkeleton, setIncludeSkeleton] = useState(true)

  useEffect(() => {
    if (doc) setName(t('templates.defaultName', { title: doc.title }))
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
          <div className="ws-modal-title">{t('templates.saveAsTemplate')}</div>
          <button className="ws-modal-x" onClick={close} aria-label={t('common.close')}>
            <X size={16} strokeWidth={1.9} />
          </button>
        </header>

        <label className="stpl-field">
          <span className="stpl-label">{t('templates.nameLabel')}</span>
          <input
            className="stpl-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()}
          />
        </label>
        {dup && <div className="stpl-hint stpl-warn">{t('templates.dupWarn')}</div>}

        <label className="stpl-check">
          <input type="checkbox" checked={includeSkeleton} onChange={(e) => setIncludeSkeleton(e.target.checked)} />
          <span>{t('templates.includeSkeleton')}</span>
        </label>

        <div className="stpl-hint">
          {hasTheme ? t('templates.saveThemeHint') : t('templates.saveSkeletonHint')}
          {' · '}
          {t('templates.userTemplateHint')}
        </div>

        <div className="stpl-actions">
          <button className="stpl-btn-ghost" onClick={close}>{t('common.cancel')}</button>
          <button className="stpl-btn-primary" onClick={save} disabled={!name.trim()}>{t('templates.saveAsTemplate')}</button>
        </div>
      </div>
    </div>
  )
}
