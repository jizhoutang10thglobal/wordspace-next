import { useEffect, useState } from 'react'
import { X, FolderOpen, HardDrive } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './AddFolderModal.css'

// 「添加文件夹」（多文件夹空间）：往当前连接空间再挂一个根文件夹，与现有文件夹
// 并排打开——VS Code "Add Folder to Workspace…" 的语义。demo 没有真实文件系统，
// 用几个可信的假路径模拟 OS 文件夹选择框（同 CreateSpaceModal 的做法）。
const SAMPLE_FOLDERS = [
  '~/Desktop/项目归档',
  '~/Documents/合同与票据',
  '~/Projects/官网 2.0',
  '~/Work/客户资料',
]

export default function AddFolderModal() {
  const open = useUI((s) => s.addFolderOpen)
  const close = useUI((s) => s.closeAddFolder)
  const activeSpaceId = useStore((s) => s.activeSpaceId)
  const space = useStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId))
  const addRootToSpace = useStore((s) => s.addRootToSpace)

  const [folder, setFolder] = useState('')
  const [pickIdx, setPickIdx] = useState(0)

  useEffect(() => {
    if (open) {
      setFolder('')
      setPickIdx(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  // Simulate the OS folder picker: cycle believable paths, skipping ones already mounted.
  const mounted = new Set((space?.roots ?? []).map((r) => r.path))
  const pool = SAMPLE_FOLDERS.filter((p) => !mounted.has(p))
  const pickFolder = () => {
    if (!pool.length) return
    setFolder(pool[pickIdx % pool.length])
    setPickIdx((i) => i + 1)
  }

  const submit = () => {
    if (!folder) return
    addRootToSpace(activeSpaceId, folder)
    close()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal afm"
        role="dialog"
        aria-modal="true"
        aria-label="添加文件夹"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">添加文件夹</div>
            <div className="ws-modal-sub">
              把另一个文件夹添加进「{space?.name}」，和现有的文件夹并排打开；随时可以从工作区移除，磁盘文件不受影响。
            </div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <div className="afm-picker">
            <div className={`afm-path ${folder ? '' : 'is-empty'}`}>
              <HardDrive size={14} />
              <span className="ws-truncate">{folder || '还没选择文件夹'}</span>
            </div>
            <button className="ws-btn afm-browse" onClick={pickFolder}>
              <FolderOpen size={14} />
              选择文件夹…
            </button>
          </div>
          {space?.roots?.length ? (
            <div className="afm-current">
              已打开：{space.roots.map((r) => r.name).join('、')}
            </div>
          ) : null}
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={close}>取消</button>
          <button className="ws-btn ws-btn-primary" disabled={!folder} onClick={submit}>
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
