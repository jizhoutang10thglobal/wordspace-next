import { Share2 } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './TopActions.css'

// 文档画布右上角的浮动操作：分享 / 发布。
// 协作者在线状态等「协作 UX」本阶段不展示——只做本地编辑区。
export default function TopActions() {
  const { tabs, activeTabId, getDoc } = useStore()
  const openPublish = useUI((s) => s.openPublish)

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  if (!doc) return null

  return (
    <div className="top-actions">
      <button className="top-share" onClick={() => openPublish(doc.id)}>
        <Share2 size={14} />
        分享
      </button>
    </div>
  )
}
