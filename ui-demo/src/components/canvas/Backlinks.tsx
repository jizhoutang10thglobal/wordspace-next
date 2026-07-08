import { useMemo, useState } from 'react'
import { ChevronRight, CornerUpLeft, FileText } from 'lucide-react'
import { useStore } from '../../mock/store'
import { computeBacklinks } from '../../lib/links'

/**
 * 反向链接面板（标题区下方，Notion 式折叠计数 → 展开成带上下文的列表）。
 * 这是 **app chrome，不是文档内容**——反链绝不写进文档字节（文件字节 = 单一真相源；
 * Craft 把反链写进文档底部的做法与此冲突，不抄）。数据 = 现算（真 app 是可丢弃索引缓存）。
 */
export default function Backlinks({ rootId, path }: { rootId: string; path: string }) {
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const openFileTab = useStore((s) => s.openFileTab)
  const [open, setOpen] = useState(false)

  const entries = useMemo(
    () => computeBacklinks(files, docs, rootId, path),
    [files, docs, rootId, path],
  )

  if (!entries.length) return null // 没有反链就整个隐藏（Craft 同款），不占版面

  return (
    <div className="ws-backlinks">
      <button className="ws-backlinks-head" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={12} className={`ws-backlinks-caret${open ? ' is-open' : ''}`} />
        <CornerUpLeft size={13} />
        <span>{entries.length} 篇文档链接到这里</span>
      </button>
      {open && (
        <div className="ws-backlinks-list">
          {entries.map((e) => (
            <button
              key={`${e.file.rootId}:${e.file.path}`}
              className="ws-backlinks-item"
              onClick={() => openFileTab(e.file)}
              title={e.file.path}
            >
              <FileText size={13} />
              <span className="ws-backlinks-title ws-truncate">{e.doc.title}</span>
              <span className="ws-backlinks-snippet ws-truncate">{e.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
