import { Sparkles, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'

/**
 * AI 入口（气泡里的 Ask AI / 斜杠的 /ai）点击后弹出的占位提示。
 * AI 还没开发，所以这里只告诉用户「即将上线」，不执行任何 AI、不改文档。
 * portal 到 body：深色模式下 Canvas 文档容器施了反色 filter，非根元素 filter 会给
 * fixed 后代创建包含块（劫持 position:fixed）。portal 出去让 backdrop 的 fixed 定位回到视口。
 * 先例：WebContextMenu.tsx。
 */
export default function AiSoonModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  return createPortal(
    <div className="ws-aisoon-backdrop" onClick={onClose}>
      <div
        className="ws-aisoon"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="ws-aisoon-x"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
        <div className="ws-aisoon-icon">
          <Sparkles size={22} strokeWidth={1.8} />
        </div>
        <div className="ws-aisoon-title">{t('editor.aiComingTitle')}</div>
        <div className="ws-aisoon-desc">
          {t('editor.aiComingDesc')}
        </div>
        <button className="ws-aisoon-btn" onClick={onClose}>
          {t('editor.gotIt')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
