import { useEffect, useState } from 'react'
import { X, HardDrive, Layers } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './SaveWorkspaceModal.css'

// 「保存工作区」：把当前同时打开的一组文件夹命名固化——之后从空间切换器一键
// 整组打开（VS Code "Save Workspace As…" 的语义）。真 app 里对应落一个
// workspace 文件；demo 里工作区就是这个空间本身：命名 + 打上已保存徽标。
export default function SaveWorkspaceModal() {
  const open = useUI((s) => s.saveWorkspaceOpen)
  const close = useUI((s) => s.closeSaveWorkspace)
  const space = useStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId))
  const saveWorkspaceAs = useStore((s) => s.saveWorkspaceAs)

  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName(space?.name ?? '')
  }, [open, space?.name])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || !space) return null
  const roots = space.roots ?? []

  const submit = () => {
    if (!name.trim()) return
    saveWorkspaceAs(space.id, name)
    close()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal swm"
        role="dialog"
        aria-modal="true"
        aria-label="保存工作区"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">保存工作区</div>
            <div className="ws-modal-sub">
              把当前打开的 {roots.length} 个文件夹打包成一个工作区，以后从空间切换器一键整组打开。
            </div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <label className="swm-field">
            <span className="swm-label">工作区名字</span>
            <input
              className="ws-input swm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="比如 品牌项目、2026 官网改版"
              autoFocus
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {name.trim() && (
              <span className="swm-filepath">
                将保存为 ~/Documents/{name.trim()}.wsworkspace——之后从「打开工作区…」一键整组打开，也可以把文件发给别人
              </span>
            )}
          </label>
          <div className="swm-roots">
            <div className="swm-roots-label">
              <Layers size={13} />
              包含的文件夹
            </div>
            {roots.map((r) => (
              <div key={r.id} className="swm-root">
                <HardDrive size={13} />
                <span className="swm-root-name">{r.name}</span>
                <span className="swm-root-path ws-truncate">{r.path}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={close}>取消</button>
          <button className="ws-btn ws-btn-primary" disabled={!name.trim()} onClick={submit}>
            保存工作区
          </button>
        </div>
      </div>
    </div>
  )
}
