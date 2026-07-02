import { Share2, Save, FileCode2 } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { isCloudStorage } from '../types'
import './TopActions.css'

// 文档画布右上角的浮动操作。
// - Markdown 后端文档：显示「Markdown 源码」开关（看后端 .md）。
// - 临时文档（从「标签页 +」新建、未保存）：显示「保存」，点它 / ⌘S 才存进当前空间。
// - 已保存的云盘文档：显示「分享」发布（连接的本地文件夹没有发布这一说）。
export default function TopActions() {
  const { tabs, activeTabId, getDoc } = useStore()
  const openPublish = useUI((s) => s.openPublish)
  const openSave = useUI((s) => s.openSave)
  const mdSourceOpen = useUI((s) => s.mdSourceOpen)
  const toggleMdSource = useUI((s) => s.toggleMdSource)
  const isFolderSpace = useStore((s) => {
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId)
    return !!sp && !isCloudStorage(sp.storage)
  })

  const tab = tabs.find((t) => t.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  if (!doc) return null
  const isMd = doc.format === 'markdown'
  const showShare = !doc.unsaved && !isFolderSpace
  // md 文档始终给源码开关；否则「已保存 + 连接文件夹里」没有可显示的操作
  if (!isMd && !doc.unsaved && !showShare) return null

  return (
    <div className="top-actions">
      {isMd && (
        <button
          className={'top-mdsrc' + (mdSourceOpen ? ' is-on' : '')}
          onClick={toggleMdSource}
          title="查看 Markdown 源码（后端）"
        >
          <FileCode2 size={14} />
          Markdown 源码
        </button>
      )}
      {doc.unsaved && (
        <button className="top-save" onClick={() => openSave(doc.id)} title="保存（选文件夹）（⌘S）">
          <Save size={14} />
          保存
        </button>
      )}
      {showShare && (
        <button className="top-share" onClick={() => openPublish(doc.id)}>
          <Share2 size={14} />
          分享
        </button>
      )}
    </div>
  )
}
