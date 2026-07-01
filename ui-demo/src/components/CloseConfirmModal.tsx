import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './CloseConfirmModal.css'

// 未保存关闭确认：关标签页 / 关 Wordspace 时，若这个标签页的文档还没保存 → 弹这个问要不要保存。
// 「保存并关闭」→ 走「保存到哪里」modal（保存后再关）；「不保存」→ 丢弃并关；「取消」→ 什么都不做。
export default function CloseConfirmModal() {
  const tabId = useUI((s) => s.confirmCloseTab)
  const cancel = useUI((s) => s.cancelCloseTab)
  const openSave = useUI((s) => s.openSave)

  const tabs = useStore((s) => s.tabs)
  const getDoc = useStore((s) => s.getDoc)
  const discardDoc = useStore((s) => s.discardDoc)
  const closeTab = useStore((s) => s.closeTab)

  useEffect(() => {
    if (!tabId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabId, cancel])

  if (!tabId) return null
  const tab = tabs.find((t) => t.id === tabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined
  const title = doc?.title ?? tab?.title ?? '这个文件'

  const onSave = () => {
    cancel() // 收起确认
    if (doc) openSave(doc.id, tabId) // 打开「保存到哪里」，保存后关掉这个标签页
  }
  const onDiscard = () => {
    if (doc) discardDoc(doc.id)
    closeTab(tabId)
    cancel()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={cancel}>
      <div
        className="ws-modal cc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="未保存的更改"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cc-body">
          <div className="cc-ico"><AlertTriangle size={20} /></div>
          <div>
            <div className="cc-title">「{title}」还没保存</div>
            <div className="cc-desc">这是一个还没存进文件夹的临时文档。关掉后未保存的内容会丢失。</div>
          </div>
        </div>
        <div className="ws-modal-foot cc-foot">
          <button className="ws-btn cc-discard" onClick={onDiscard}>不保存，直接关闭</button>
          <span className="cc-spacer" />
          <button className="ws-btn" onClick={cancel}>取消</button>
          <button className="ws-btn ws-btn-primary" onClick={onSave}>保存并关闭</button>
        </div>
      </div>
    </div>
  )
}
