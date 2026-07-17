import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, RotateCw, FolderOpen, Trash2, FileText, FileImage, FileArchive, File as FileIcon } from 'lucide-react'
import { useDownloads, type DownloadEntry } from '../mock/downloads'
import { useUI } from '../mock/ui'
import { useStore } from '../mock/store'
import { truncateMiddle, formatBytes, isTerminal, canRetry, canReveal, canRemove } from '../lib/downloads'
import { useT } from '../i18n'
import './DownloadsPopover.css'

// 下载列表 popover（Chrome 式气泡，锚在侧栏工具栏的下载入口；KTD：不做 /downloads 整页路由）。
// 关闭必须走 veil 层：popover 盖到网页区时 iframe 会吞 click，document 级 click-outside 收不到
// （HistoryPage 清除菜单同款先例）。portal 到 body：侧栏 peek 态用 visibility 隐藏自身，
// 不portal 的话 popover 会被一起藏掉。

function extIconOf(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (/^(png|jpe?g|gif|webp|svg|heic)$/.test(ext)) return FileImage
  if (/^(zip|dmg|exe|gz|tar|7z|rar)$/.test(ext)) return FileArchive
  if (/^(pdf|docx?|html?|md|txt)$/.test(ext)) return FileText
  return FileIcon
}

// 锚定位：开合那刻查工具栏按钮的真实 rect（停靠/peek 两态都适用），越界钳到窗口内；
// 按钮不存在（沉浸收起、toast「显示」路径）→ 回落左上角固定位。
function anchorPos(): { left: number; top: number } {
  const el = document.querySelector('[data-dl-anchor]')
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.bottom > 0) {
      return {
        left: Math.max(10, Math.min(r.left - 8, window.innerWidth - 356)),
        top: Math.min(r.bottom + 8, window.innerHeight - 120),
      }
    }
  }
  return { left: 12, top: 52 }
}

function Row({ e }: { e: DownloadEntry }) {
  const t = useT()
  const cancelDownload = useDownloads((s) => s.cancelDownload)
  const retryDownload = useDownloads((s) => s.retryDownload)
  const removeOne = useDownloads((s) => s.removeOne)
  const toast = useStore((s) => s.toast)
  const Ico = extIconOf(e.filename)
  const pct = e.sizeBytes > 0 ? Math.floor((e.receivedBytes / e.sizeBytes) * 100) : 0

  const status =
    e.state === 'downloading'
      ? t('browser.dlProgress', { done: formatBytes(e.receivedBytes), total: formatBytes(e.sizeBytes), pct })
      : e.state === 'completed'
        ? `${t('browser.dlStateCompleted')} · ${formatBytes(e.sizeBytes)}`
        : e.state === 'failed'
          ? t('browser.dlStateFailed')
          : e.state === 'canceled'
            ? t('browser.dlStateCanceled')
            : e.state === 'interrupted'
              ? t('browser.dlStateInterrupted')
              : t('browser.dlStateFileMissing')

  // 「在访达中显示」演示语义（mock 边界）：只 toast 告知定位，绝无打开文件的语义（AE3/R11）。
  const reveal = () => toast(t('browser.dlRevealToast', { name: e.filename }), 'neutral')

  return (
    <div className={`dl-row${e.state === 'fileMissing' ? ' is-missing' : ''}`} data-state={e.state}>
      <Ico size={16} className="dl-row-ico" />
      <div className="dl-row-main">
        <span className="dl-name" title={e.filename}>{truncateMiddle(e.filename)}</span>
        <span className={`dl-status${e.state === 'failed' ? ' is-danger' : ''}`}>{status}</span>
        {e.state === 'downloading' && (
          <span className="dl-bar"><span className="dl-bar-fill" style={{ width: `${pct}%` }} /></span>
        )}
      </div>
      <div className="dl-acts">
        {e.state === 'downloading' && (
          <button className="dl-act is-danger" title={t('browser.dlCancel')} onClick={() => cancelDownload(e.id)}><X size={14} /></button>
        )}
        {canReveal(e.state) && (
          <button className="dl-act" title={t('browser.dlReveal')} onClick={reveal}><FolderOpen size={14} /></button>
        )}
        {canRetry(e.state) && (
          <button className="dl-act" title={t('browser.dlRetry')} onClick={() => retryDownload(e.id)}><RotateCw size={13} /></button>
        )}
        {canRemove(e.state) && (
          <button className="dl-act is-danger" title={t('browser.dlRemove')} onClick={() => removeOne(e.id)}><X size={14} /></button>
        )}
      </div>
    </div>
  )
}

export default function DownloadsPopover() {
  const t = useT()
  const open = useUI((s) => s.downloadsOpen)
  const closeDownloads = useUI((s) => s.closeDownloads)
  const entries = useDownloads((s) => s.entries)
  const clearRecords = useDownloads((s) => s.clearRecords)

  // 开合那刻定一次位；开着期间不追随布局变化（veil 一点即关，追随不值得）。
  const pos = useMemo(() => (open ? anchorPos() : null), [open])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeDownloads()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDownloads])

  if (!open || !pos) return null
  const hasTerminal = entries.some((e) => isTerminal(e.state))

  return createPortal(
    <>
      <div className="dlp-veil" onClick={closeDownloads} />
      <div className="dlp" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={t('browser.dlTitle')}>
        <header className="dlp-head">
          <span className="dlp-title">{t('browser.dlTitle')}</span>
          {hasTerminal && (
            <button className="dlp-clear" onClick={clearRecords}>
              <Trash2 size={12} /> {t('browser.dlClear')}
            </button>
          )}
        </header>
        {entries.length === 0 ? (
          <div className="dlp-empty">
            <Download size={20} className="dlp-empty-ico" />
            <div className="dlp-empty-text">{t('browser.dlEmpty')}</div>
            <div className="dlp-empty-hint">{t('browser.dlEmptyHint')}</div>
          </div>
        ) : (
          <div className="dlp-list">
            {entries.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
