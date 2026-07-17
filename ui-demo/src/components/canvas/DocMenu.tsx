import { useEffect, useRef } from 'react'
import {
  FileText,
  FileType2,
  Presentation,
  Link2,
  PenLine,
  Trash2,
  BookOpen,
  Palette,
} from 'lucide-react'
import { useT } from '../../i18n'
import { useStore } from '../../mock/store'
import { useUI } from '../../mock/ui'
import { usePaged } from '../../mock/paged'
import { computeBacklinks } from '../../lib/links'
import { printPagedDoc } from '../../lib/printExport'
import { checkSchema } from '../../lib/schemaCheck'
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
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const exportDoc = useStore((s) => s.exportDoc)
  const openPageSetup = useUI((s) => s.openPageSetup)
  const pagedCfg = usePaged((s) => s.configs[doc.id])
  const toast = useStore((s) => s.toast)
  const deleteDoc = useStore((s) => s.deleteDoc)
  const openSaveTemplate = useUI((s) => s.openSaveTemplate)

  // 存为模板可用性：非合规文档（走基础编辑）与 .md（头部样式无法持久化）都禁用，分别给因由。
  const nonConform = !!doc.rawHtml && !checkSchema(doc.rawHtml).conform
  const isMd = doc.format === 'markdown'
  const saveDisabled = nonConform || isMd
  const disabledReason = isMd
    ? t('templates.mdUnsupported')
    : t('templates.nonConformUnsupported')

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
        {t('editor.exportPdf')}
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => exportDoc(doc.id, 'docx'))}
      >
        <FileType2 size={15} strokeWidth={1.8} />
        {t('editor.exportWord')}
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => exportDoc(doc.id, 'pptx'))}
      >
        <Presentation size={15} strokeWidth={1.8} />
        {t('editor.exportPptx')}
      </button>
      <div className="ws-docmenu-sep" />
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => openPageSetup(doc.id))}
      >
        <BookOpen size={15} strokeWidth={1.8} />
        {t('editor.pageSetupMenu')}
      </button>
      {saveDisabled ? (
        // 禁用态：原因常驻小字（键盘/读屏可达，不只 title）。
        <div className="ws-docmenu-item is-disabled" role="menuitem" aria-disabled="true">
          <Palette size={15} strokeWidth={1.8} />
          <span className="ws-docmenu-disabled-wrap">
            {t('templates.saveAsTemplate')}
            <span className="ws-docmenu-hint">{disabledReason}</span>
          </span>
        </div>
      ) : (
        <button
          className="ws-docmenu-item"
          role="menuitem"
          onClick={() => run(() => openSaveTemplate(doc.id))}
        >
          <Palette size={15} strokeWidth={1.8} />
          {t('templates.saveDocAsTemplate')}
        </button>
      )}
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(() => toast(t('editor.linkCopied'), 'success'))}
      >
        <Link2 size={15} strokeWidth={1.8} />
        {t('editor.copyLink')}
      </button>
      <button
        className="ws-docmenu-item"
        role="menuitem"
        onClick={() => run(onRename)}
      >
        <PenLine size={15} strokeWidth={1.8} />
        {t('common.rename')}
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
        {t('common.delete')}
      </button>
    </div>
  )
}
