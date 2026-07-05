import { useEffect, useState } from 'react'
import { Cloud, HardDrive, X, Check, FolderOpen } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { STORAGE_META, type StorageKind } from '../types'
import './CreateSpaceModal.css'

// A space is a work scenario; here you pick where its files live. Two choices:
// the Wordspace cloud, or a folder on this device.
const ORDER: StorageKind[] = ['cloud', 'local']

// Stand-ins for the OS folder picker (the demo has no real filesystem).
const SAMPLE_FOLDERS = ['~/Documents', '~/Desktop/项目', '~/Projects/新空间', '~/Work/客户资料']

export default function CreateSpaceModal() {
  const open = useUI((s) => s.spaceModalOpen)
  const close = useUI((s) => s.closeSpaceModal)
  const createSpace = useStore((s) => s.createSpace)

  const [name, setName] = useState('')
  const [storage, setStorage] = useState<StorageKind>('cloud')
  const [folder, setFolder] = useState('')
  const [pickIdx, setPickIdx] = useState(0)

  useEffect(() => {
    if (open) {
      setName('')
      setStorage('cloud')
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

  // Simulate the OS folder picker by cycling through a few believable paths.
  const pickFolder = () => {
    setFolder(SAMPLE_FOLDERS[pickIdx % SAMPLE_FOLDERS.length])
    setPickIdx((i) => i + 1)
  }

  const needsFolder = storage === 'local' && !folder
  const submit = () => {
    if (needsFolder) return
    createSpace(name, storage, storage === 'local' ? folder : undefined)
    close()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal csm"
        role="dialog"
        aria-modal="true"
        aria-label="新建空间"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">新建空间</div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <label className="csm-field">
            <span className="csm-label">名字</span>
            <input
              className="ws-input csm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="比如 我的公司、某个项目、个人"
              autoFocus
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </label>

          <div className="csm-field">
            <span className="csm-label">存在哪</span>
            <div className="csm-options">
              {ORDER.map((k) => {
                const meta = STORAGE_META[k]
                const Icon = k === 'local' ? HardDrive : Cloud
                const sel = storage === k
                return (
                  <button
                    key={k}
                    className={`csm-option st-${k}${sel ? ' is-sel' : ''}`}
                    onClick={() => setStorage(k)}
                  >
                    <span className="csm-option-ico">
                      <Icon size={16} />
                    </span>
                    <span className="csm-option-text">
                      <span className="csm-option-name">
                        {meta.label}
                        {meta.collab && <span className="csm-tag">协作 · Agent</span>}
                      </span>
                      <span className="csm-option-desc">{meta.desc}</span>
                    </span>
                    {sel && <Check size={15} className="csm-option-check" />}
                  </button>
                )
              })}
            </div>

            {storage === 'local' && (
              <div className="csm-picker">
                {folder ? (
                  <div className="csm-picked">
                    <FolderOpen size={15} className="csm-picked-ico" />
                    <span className="csm-picked-path ws-truncate">{folder}</span>
                    <button className="csm-repick" onClick={pickFolder}>
                      重新选择
                    </button>
                  </div>
                ) : (
                  <button className="csm-pickbtn" onClick={pickFolder}>
                    <FolderOpen size={15} />
                    选择本地文件夹…
                  </button>
                )}
                <p className="csm-hint">演示环境:选定后会载入一组示例文件,可直接在树里浏览、打开 .html 编辑。</p>
              </div>
            )}
          </div>
        </div>

        <footer className="csm-foot">
          <button className="ws-btn" onClick={close}>
            取消
          </button>
          <button className="ws-btn ws-btn-primary" onClick={submit} disabled={needsFolder}>
            创建空间
          </button>
        </footer>
      </div>
    </div>
  )
}
