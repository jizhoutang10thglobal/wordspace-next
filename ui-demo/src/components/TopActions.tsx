import { Share2 } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { isCloudStorage } from '../types'
import './TopActions.css'

// 文档画布右上角的浮动操作：分享 / 发布。只在 Wordspace 网盘空间里有意义；
// 连接的文件夹（本地 / Drive）没有发布与可见范围这一说，所以不显示。
export default function TopActions() {
  const { tabs, activeTabId, getDoc } = useStore()
  const openPublish = useUI((s) => s.openPublish)
  const isFolderSpace = useStore((s) => {
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId)
    return !!sp && !isCloudStorage(sp.storage)
  })

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  if (!doc || isFolderSpace) return null

  return (
    <div className="top-actions">
      <button className="top-share" onClick={() => openPublish(doc.id)}>
        <Share2 size={14} />
        分享
      </button>
    </div>
  )
}
