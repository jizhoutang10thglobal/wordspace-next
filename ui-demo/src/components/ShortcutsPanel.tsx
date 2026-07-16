import { useEffect, useMemo } from 'react'
import { X, Keyboard, ExternalLink } from 'lucide-react'
import { useUI } from '../mock/ui'
import { shortcutGroupsForPlatform, renderKey } from '../lib/shortcutList'
import { IS_MAC } from '../lib/platform'
import { useT } from '../i18n'
import './ShortcutsPanel.css'

// 快捷键速查面板（Cmd+/ 或左下角 ⌨ 打开）——只列 demo 里真的能用的键位。
// 完整的调研 / 五项裁决 / UseCase / 与真 app 对照，见写死在 demo 里的
// public/shortcuts.html（底部链接新开页查看，Wendi review 以那份为准）。
export default function ShortcutsPanel() {
  const t = useT()
  const open = useUI((s) => s.shortcutsOpen)
  const close = useUI((s) => s.closeShortcuts)

  // 只管 Esc；Cmd+/ 的 toggle 收在 ArcSidebar 全局 handler（见那边注释：面板自己监听
  // Cmd+/ 会被同一个 trusted 事件「开了秒关」）。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // 依赖 t：切换语言时 useT 返回新函数 → 重建分组文案。
  const groups = useMemo(() => shortcutGroupsForPlatform(), [t])

  if (!open) return null

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal skp"
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.panelTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">
              <Keyboard size={16} className="skp-title-ico" />
              {t('shortcuts.panelTitle')}
              <span className="skp-platform">{IS_MAC ? 'macOS' : 'Windows'}</span>
            </div>
            <div className="ws-modal-sub">{t('shortcuts.subtitle')}</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="skp-body">
          {groups.map((g) => (
            <section key={g.title} className="skp-group">
              <h3 className="skp-group-title">{g.title}</h3>
              {g.hint && <div className="skp-group-hint">{g.hint}</div>}
              <div className="skp-items">
                {g.items.map((it, i) => (
                  <div key={i} className="skp-item">
                    <span className="skp-label ws-truncate">{it.label}</span>
                    <span className="skp-keys">
                      {it.keys.map((k, j) => (
                        <kbd key={j}>{renderKey(k)}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="ws-modal-foot skp-foot">
          <a className="skp-doc-link" href="/shortcuts.html" target="_blank" rel="noreferrer">
            <ExternalLink size={13} />
            {t('shortcuts.docLink')}
          </a>
          <button className="ws-btn" onClick={close}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
