import { useEffect, useRef } from 'react'
import {
  FileText,
  FileType2,
  Presentation,
  Link2,
  PenLine,
  Trash2,
} from 'lucide-react'
import { useStore } from '../../mock/store'
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
        onClick={() => run(() => exportDoc(doc.id, 'pdf'))}
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
        onClick={() => run(() => deleteDoc(doc.id))}
      >
        <Trash2 size={15} strokeWidth={1.8} />
        删除
      </button>
    </div>
  )
}
