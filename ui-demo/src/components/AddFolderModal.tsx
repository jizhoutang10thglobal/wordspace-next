import { useEffect, useState } from 'react'
import { X, FolderOpen, HardDrive, CornerDownRight, GitMerge, Info } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { classifyRoot, canonPath } from '../lib/tree'
import './AddFolderModal.css'

// 「添加文件夹」：往侧栏再打开一个根文件夹，和现有的并排。demo 没有真实文件系统，
// 用可信的假路径模拟 OS 文件夹选择框。
// 嵌套裁决（调研）：加根前判定新根与已有根的关系——相同/子目录/父目录/无关，各自智能处理，
// 不硬报错。SAMPLE_FOLDERS 特意含一个子目录（品牌升级/视觉规范）和一个父目录（~/Projects）来演示。
const SAMPLE_FOLDERS = [
  '~/Projects/品牌升级/视觉规范', // 子目录：是已打开的「品牌升级」的下一级 → 不重复开
  '~/Projects', // 父目录：包住了已打开的「品牌升级」 → 提议并入
  '~/Desktop/项目归档', // 无关：正常加
  '~/Documents/合同与票据', // 无关：正常加
]
const leafOf = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

export default function AddFolderModal() {
  const open = useUI((s) => s.addFolderOpen)
  const close = useUI((s) => s.closeAddFolder)
  const activeSpaceId = useStore((s) => s.activeSpaceId)
  const space = useStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId))
  const addRootToSpace = useStore((s) => s.addRootToSpace)
  const absorbRootIntoSpace = useStore((s) => s.absorbRootIntoSpace)

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

  // 模拟 OS 文件夹选择框：轮流给可信假路径，跳过完全相同的已挂载路径（嵌套的仍给，用来演示分类）。
  const roots = space?.roots ?? []
  const mounted = new Set(roots.map((r) => canonPath(r.path)))
  const pool = SAMPLE_FOLDERS.filter((p) => !mounted.has(canonPath(p)))
  const pickFolder = () => {
    if (!pool.length) return
    setFolder(pool[pickIdx % pool.length])
    setPickIdx((i) => i + 1)
  }

  // 加根前的嵌套关系（纯函数，每次渲染算，便宜）。
  const relation = folder ? classifyRoot(folder, roots.map((r) => r.path)) : null
  const childRootIds =
    relation?.rel === 'parent'
      ? roots.filter((r) => relation.children.some((c) => canonPath(c) === canonPath(r.path))).map((r) => r.id)
      : []
  const canAdd = relation?.rel === 'independent' || relation?.rel === 'parent'

  const submit = () => {
    if (!folder || !relation) return
    if (relation.rel === 'independent') addRootToSpace(activeSpaceId, folder)
    else if (relation.rel === 'parent') absorbRootIntoSpace(activeSpaceId, folder, childRootIds)
    // same / child：不新增（提示已解释原因），点主按钮=知道了
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
          {relation && relation.rel !== 'independent' && (
            <div className={`afm-notice afm-notice-${relation.rel === 'parent' ? 'warn' : 'info'}`}>
              <span className="afm-notice-ico">
                {relation.rel === 'parent' ? <GitMerge size={15} /> : relation.rel === 'child' ? <CornerDownRight size={15} /> : <Info size={15} />}
              </span>
              <span className="afm-notice-text">
                {relation.rel === 'same' && '这个文件夹已经打开了。'}
                {relation.rel === 'child' && (
                  <>「<b>{leafOf(folder)}</b>」已经在「<b>{relation.parent.replace(/\/+$/, '').split('/').pop()}</b>」里了——不会重复打开它。想去看它，在那个文件夹里展开即可。</>
                )}
                {relation.rel === 'parent' && (
                  <>「<b>{leafOf(folder)}</b>」包含了已打开的「<b>{relation.children.map((c) => c.replace(/\/+$/, '').split('/').pop()).join('、')}</b>」。添加后会把它{relation.children.length > 1 ? '们' : ''}并入「{leafOf(folder)}」，避免同一批文件出现两次。</>
                )}
              </span>
            </div>
          )}
          {space?.roots?.length ? (
            <div className="afm-current">
              已打开：{space.roots.map((r) => r.name).join('、')}
            </div>
          ) : null}
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={close}>取消</button>
          <button className="ws-btn ws-btn-primary" disabled={!folder} onClick={submit}>
            {relation && !canAdd ? '知道了' : relation?.rel === 'parent' ? '并入并添加' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
