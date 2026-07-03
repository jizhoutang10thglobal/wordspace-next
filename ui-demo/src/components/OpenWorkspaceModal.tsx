import { useEffect } from 'react'
import { X, Layers, HardDrive, Check } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './OpenWorkspaceModal.css'

// 「打开工作区」：列出磁盘上的 .wsworkspace 文件（demo mock），选一个把整组文件夹
// 一次性挂载打开——「打包成工作区」的另一半。已作为空间开着的显示「已打开」，
// 选它 = 切过去（VS Code 聚焦已开窗口的语义）。真 app 里还可以直接双击文件打开。
export default function OpenWorkspaceModal() {
  const open = useUI((s) => s.openWorkspaceOpen)
  const close = useUI((s) => s.closeOpenWorkspace)
  const workspaceFiles = useStore((s) => s.workspaceFiles)
  const spaces = useStore((s) => s.spaces)
  const openWorkspaceFile = useStore((s) => s.openWorkspaceFile)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  const files = [...workspaceFiles].sort((a, b) => b.savedAt - a.savedAt)

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal owm"
        role="dialog"
        aria-modal="true"
        aria-label="打开工作区"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">打开工作区</div>
            <div className="ws-modal-sub">
              选一个 .wsworkspace 文件，把它打包的整组文件夹一次打开（真 app 里双击文件同效）
            </div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="owm-list">
          {files.length ? (
            files.map((wf) => {
              const opened = !!wf.spaceId && spaces.some((sp) => sp.id === wf.spaceId)
              return (
                <button
                  key={wf.id}
                  className="owm-row"
                  onClick={() => {
                    openWorkspaceFile(wf.id)
                    close()
                  }}
                >
                  <span className="owm-ico">
                    <Layers size={16} />
                  </span>
                  <span className="owm-text">
                    <span className="owm-name">
                      {wf.name}
                      {opened && (
                        <span className="owm-opened">
                          <Check size={11} />
                          已打开
                        </span>
                      )}
                    </span>
                    <span className="owm-file ws-truncate">{wf.path}</span>
                    <span className="owm-folders">
                      {wf.folders.map((f, i) => (
                        <span key={i} className="owm-folder">
                          <HardDrive size={10} />
                          {f.name}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              )
            })
          ) : (
            <div className="owm-empty">
              还没有工作区文件——同时打开多个文件夹后，点树顶提示条的「保存…」就会生成一个。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
