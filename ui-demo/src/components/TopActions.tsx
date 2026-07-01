import { Share2, Save } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { isCloudStorage } from '../types'
import './TopActions.css'

// 文档画布右上角的浮动操作。
// - 临时文档（从「标签页 +」新建、未保存）：显示「保存」，点它 / ⌘S 才存进当前空间。
// - 已保存的云盘文档：显示「分享」发布（连接的本地文件夹没有发布这一说）。
export default function TopActions() {
  const { tabs, activeTabId, getDoc, saveActiveDoc } = useStore()
  const openPublish = useUI((s) => s.openPublish)
  const isFolderSpace = useStore((s) => {
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId)
    return !!sp && !isCloudStorage(sp.storage)
  })

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  if (!doc) return null
  // 已保存的文档、且在连接的文件夹里 → 没有可显示的操作
  if (!doc.unsaved && isFolderSpace) return null

  return (
    <div className="top-actions">
      {doc.unsaved && (
        <button className="top-save" onClick={() => saveActiveDoc()} title="保存到当前空间（⌘S）">
          <Save size={14} />
          保存
        </button>
      )}
      {!doc.unsaved && !isFolderSpace && (
        <button className="top-share" onClick={() => openPublish(doc.id)}>
          <Share2 size={14} />
          分享
        </button>
      )}
    </div>
  )
}
