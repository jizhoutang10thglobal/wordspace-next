import { X } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { blocksToMd } from '../lib/markdown'
import './MarkdownSourcePanel.css'

// Markdown 后端文档的「源码」实时栏：显示当前块模型序列化出的 .md（blocksToMd）。
// 在左边块编辑器里改，这里实时更新 → 证明「后端是 Markdown」且块模型 ↔ .md 双向可逆。
export default function MarkdownSourcePanel() {
  const open = useUI((s) => s.mdSourceOpen)
  const setMdSource = useUI((s) => s.setMdSource)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const docs = useStore((s) => s.docs) // 订阅 docs → 编辑块时实时重算源码

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? docs.find((d) => d.id === tab.docId) : undefined
  if (!open || !doc || doc.format !== 'markdown') return null

  const md = blocksToMd(doc.blocks)
  return (
    <aside className="mdsrc" aria-label="Markdown 源码">
      <div className="mdsrc-head">
        <span className="mdsrc-title">
          Markdown 源码 <span className="mdsrc-live">实时</span>
        </span>
        <button className="mdsrc-close" onClick={() => setMdSource(false)} title="关闭">
          <X size={15} />
        </button>
      </div>
      <div className="mdsrc-hint">
        这是当前文档的 Markdown 后端（块模型 → .md）。在左边编辑，这里实时更新——证明块模型 ↔ Markdown 双向可逆。
      </div>
      <pre className="mdsrc-pre">{md}</pre>
    </aside>
  )
}
