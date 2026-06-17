import { Sparkles, X } from 'lucide-react'

/**
 * AI 入口（气泡里的 Ask AI / 斜杠的 /ai）点击后弹出的占位提示。
 * AI 还没开发，所以这里只告诉用户「即将上线」，不执行任何 AI、不改文档。
 */
export default function AiSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="ws-aisoon-backdrop" onClick={onClose}>
      <div
        className="ws-aisoon"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="ws-aisoon-x"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
        <div className="ws-aisoon-icon">
          <Sparkles size={22} strokeWidth={1.8} />
        </div>
        <div className="ws-aisoon-title">AI 功能开发中</div>
        <div className="ws-aisoon-desc">
          「让 AI 生成 / 重排这一块」即将上线,敬请期待。
        </div>
        <button className="ws-aisoon-btn" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}
