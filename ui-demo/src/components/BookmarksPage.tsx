import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Upload, Download, FolderPlus, Trash2, Globe2, ExternalLink } from 'lucide-react'
import { useBookmarks, BM_BAR } from '../mock/bookmarks'
import { useStore } from '../mock/store'
import { useHistory } from '../mock/history'
import './BookmarksPage.css'

export default function BookmarksPage() {
  const navigate = useNavigate()
  const folders = useBookmarks((s) => s.folders)
  const bookmarks = useBookmarks((s) => s.bookmarks)
  const bm = useBookmarks.getState()
  const openWebTab = useStore((s) => s.openWebTab)
  const toast = useStore((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  // 打开书签：已开着该网址的网页标签就聚焦，否则新标签打开 + 记历史（与侧栏收藏区同语义，拍板 2026-07-10）。
  const open = (url: string, title: string) => {
    const st = useStore.getState()
    const existing = st.tabs.find((t) => t.kind === 'web' && t.url === url)
    if (existing) st.setActiveTab(existing.id)
    else { openWebTab(url, title); useHistory.getState().record(url, title) }
    navigate('/docs')
  }

  const doExport = () => {
    const html = bm.exportHtml()
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'bookmarks.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast('已导出为 bookmarks.html（Chrome/Safari/Firefox 都能导入）', 'success')
  }
  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then((txt) => {
      const n = useBookmarks.getState().importHtml(txt)
      toast(n ? `已导入 ${n} 个书签` : '没识别到书签（需要浏览器导出的 HTML 书签文件）', n ? 'success' : 'neutral')
    })
    e.target.value = ''
  }

  return (
    <div className="bmp-page">
      <input ref={fileRef} type="file" accept=".html,text/html" hidden onChange={onImportFile} />
      <header className="bmp-top">
        <button className="bmp-back" onClick={() => navigate('/docs')} title="返回"><ChevronLeft size={18} /></button>
        <h1>收藏夹</h1>
        <div className="bmp-actions">
          <button className="bmp-btn" onClick={() => bm.addFolder('新文件夹')}><FolderPlus size={14} /> 新文件夹</button>
          <button className="bmp-btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入</button>
          <button className="bmp-btn" onClick={doExport}><Download size={14} /> 导出</button>
        </div>
      </header>
      <p className="bmp-hint">导入 / 导出用的是浏览器通用的 HTML 书签格式（Netscape），可以和 Chrome、Safari、Firefox、Edge 互相搬。</p>

      <div className="bmp-body">
        {folders.map((f) => {
          const items = bookmarks.filter((b) => b.folderId === f.id)
          return (
            <section key={f.id} className="bmp-folder">
              <div className="bmp-folder-head">
                <input
                  className="bmp-folder-name"
                  defaultValue={f.name}
                  onBlur={(e) => bm.renameFolder(f.id, e.target.value.trim() || f.name)}
                  disabled={f.id === BM_BAR}
                  title={f.id === BM_BAR ? '书签栏（固定）' : '重命名文件夹'}
                />
                <span className="bmp-folder-count">{items.length}</span>
                {f.id !== BM_BAR && (
                  <button className="bmp-folder-del" title="删除文件夹（含其中书签）" onClick={() => bm.removeFolder(f.id)}><Trash2 size={14} /></button>
                )}
              </div>
              {items.length === 0 && <div className="bmp-empty">空</div>}
              {items.map((b) => (
                <div key={b.id} className="bmp-row">
                  <Globe2 size={14} className="bmp-row-ico" />
                  <input className="bmp-row-title" defaultValue={b.title} onBlur={(e) => bm.update(b.id, { title: e.target.value.trim() || b.url })} />
                  <span className="bmp-row-url" title={b.url}>{b.url.replace(/^https?:\/\//, '')}</span>
                  <select className="bmp-row-folder" value={b.folderId} onChange={(e) => bm.update(b.id, { folderId: e.target.value })}>
                    {folders.map((ff) => <option key={ff.id} value={ff.id}>{ff.name}</option>)}
                  </select>
                  <button className="bmp-row-open" title="打开" onClick={() => open(b.url, b.title)}><ExternalLink size={13} /></button>
                  <button className="bmp-row-del" title="删除" onClick={() => bm.removeOne(b.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
