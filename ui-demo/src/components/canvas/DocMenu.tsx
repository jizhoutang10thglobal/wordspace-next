import { useEffect, useRef } from 'react'
import {
  FileText,
  FileType2,
  Presentation,
  Link2,
  PenLine,
  Trash2,
  BookOpen,
} from 'lucide-react'
import { useStore } from '../../mock/store'
import { useUI } from '../../mock/ui'
import { usePaged } from '../../mock/paged'
import { computeBacklinks } from '../../lib/links'
import { printPagedDoc } from '../../lib/printExport'
import type { Doc } from '../../types'

/**
 * The document "…" dropdown in the header: export targets, copy link, rename,
 * delete. Rename flips the header title into an inline editor via onRename.
 */
export default function DocMenu({
  doc,
  onClose,
  onRename,
}: {
  doc: Doc
  onClose: () => void
  onRename: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const exportDoc = useStore((s) => s.exportDoc)
  const openPageSetup = useUI((s) => s.openPageSetup)
  const pagedCfg = usePaged((s) => s.configs[doc.id])
  const toast = useStore((s) => s.toast)
  const deleteDoc = useStore((s) => s.deleteDoc)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const run = (fn: () => void) => {
    fn()
    onClose()
  }

  return (
    <div className="ws-docmenu" ref={ref} role="menu">
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() =>
          run(() => {
            // 分页文档：走浏览器打印做真分页导出（@page 纸张/边距/页码，打印预览即所见分页）；
            // 普通文档维持原 mock 导出。
            if (pagedCfg?.on) printPagedDoc(doc, pagedCfg)
            else exportDoc(doc.id, 'pdf')
          })
        }
      >
        <FileText size={15} strokeWidth={1.8} />
        导出为 PDF
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => exportDoc(doc.id, 'docx'))}
      >
        <FileType2 size={15} strokeWidth={1.8} />
        导出为 Word(.docx)
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => exportDoc(doc.id, 'pptx'))}
      >
        <Presentation size={15} strokeWidth={1.8} />
        导出为演示文稿(.pptx)
      </button>
      <div className="ws-docmenu-sep" />
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => openPageSetup(doc.id))}
      >
        <BookOpen size={15} strokeWidth={1.8} />
        页面设置…
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => toast('链接已复制', 'success'))}
      >
        <Link2 size={15} strokeWidth={1.8} />
        复制链接
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(onRename)}
      >
        <PenLine size={15} strokeWidth={1.8} />
        重命名
      </button>
      <div className="ws-docmenu-sep" />
      <button
        className="ws-docmenu-item ws-docmenu-danger"
        role="menuitem"
        onClick={() =>
          run(() => {
            // 文件文档走与侧栏同一条删除路：互链守卫 + deleteFileWithUndo 的可撤销删除。
            // 直接 deleteDoc 会绕过守卫、且按 docId 级联删掉共享此 doc 的所有文件（对抗审查抓到的旁路）。
            const s = useStore.getState()
            const file = s.files.find((f) => f.docId === doc.id)
            if (file) {
              const n = computeBacklinks(s.files, s.docs, file.rootId, file.path).length
              if (n > 0) useUI.getState().askDeleteFile('file', file.rootId, file.path, n)
              else s.deleteFileWithUndo(file)
            } else {
              deleteDoc(doc.id) // 非文件文档（未保存草稿等）维持原语义
            }
          })
        }
      >
        <Trash2 size={15} strokeWidth={1.8} />
        删除
      </button>
    </div>
  )
}
