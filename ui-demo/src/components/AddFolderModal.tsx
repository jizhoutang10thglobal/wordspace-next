import { useEffect, useState } from 'react'
import { X, FolderOpen, HardDrive, CornerDownRight, GitMerge, Info } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useT } from '../i18n'
import { classifyRoot, canonPath } from '../lib/tree'
import './AddFolderModal.css'

// 「添加文件夹」：往侧栏再打开一个根文件夹，和现有的并排。demo 没有真实文件系统，
// 用可信的假路径模拟 OS 文件夹选择框。
// 嵌套裁决（调研）：加根前判定新根与已有根的关系——相同/子目录/父目录/无关，各自智能处理，
// 不硬报错。SAMPLE_FOLDERS 特意含一个子目录（品牌升级/视觉规范）和一个父目录（~/Projects）来演示。
const SAMPLE_FOLDERS = [
  '~/Projects/品牌升级/视觉规范', // i18n-exempt 演示假路径 · 子目录：是已打开的「品牌升级」的下一级 → 不重复开
  '~/Projects', // 父目录：包住了已打开的「品牌升级」 → 提议并入
  '~/Desktop/项目归档', // i18n-exempt 演示假路径 · 无关：正常加
  '~/Documents/合同与票据', // i18n-exempt 演示假路径 · 无关：正常加
]
const leafOf = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

export default function AddFolderModal() {
  const t = useT()
  const open = useUI((s) => s.addFolderOpen)
  const close = useUI((s) => s.closeAddFolder)
  const allRoots = useStore((s) => s.roots)
  const addRoot = useStore((s) => s.addRoot)
  const absorbRoot = useStore((s) => s.absorbRoot)

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

  // 嵌套分类只看可达的根（失联根不参与）。
  const roots = allRoots.filter((r) => !r.missing)
  // 模拟 OS 文件夹选择框：轮流给可信假路径，跳过完全相同的已挂载路径（嵌套的仍给，用来演示分类）。
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
    if (relation.rel === 'independent') addRoot(folder)
    else if (relation.rel === 'parent') absorbRoot(folder, childRootIds)
    // same / child：不新增（提示已解释原因），点主按钮=知道了
    close()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={close}>
      <div
        className="ws-modal afm"
        role="dialog"
        aria-modal="true"
        aria-label={t('modals.addFolder')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">{t('modals.addFolder')}</div>
            <div className="ws-modal-sub">
              {t('modals.addFolderSub')}
            </div>
          </div>
          <button className="ws-modal-x" onClick={close} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="ws-modal-body">
          <div className="afm-picker">
            <div className={`afm-path ${folder ? '' : 'is-empty'}`}>
              <HardDrive size={14} />
              <span className="ws-truncate">{folder || t('modals.noFolderPicked')}</span>
            </div>
            <button className="ws-btn afm-browse" onClick={pickFolder}>
              <FolderOpen size={14} />
              {t('modals.pickFolder')}
            </button>
          </div>
          {relation && relation.rel !== 'independent' && (
            <div className={`afm-notice afm-notice-${relation.rel === 'parent' ? 'warn' : 'info'}`}>
              <span className="afm-notice-ico">
                {relation.rel === 'parent' ? <GitMerge size={15} /> : relation.rel === 'child' ? <CornerDownRight size={15} /> : <Info size={15} />}
              </span>
              <span className="afm-notice-text">
                {relation.rel === 'same' && t('modals.relSame')}
                {relation.rel === 'child' && (
                  <>{t('modals.bracketL')}<b>{leafOf(folder)}</b>{t('modals.relChildMid')}<b>{relation.parent.replace(/\/+$/, '').split('/').pop()}</b>{t('modals.relChildEnd')}</>
                )}
                {relation.rel === 'parent' && (
                  <>{t('modals.bracketL')}<b>{leafOf(folder)}</b>{t('modals.relParentMid')}<b>{relation.children.map((c) => c.replace(/\/+$/, '').split('/').pop()).join(t('modals.listSep'))}</b>{t('modals.relParentEnd', { plural: relation.children.length > 1 ? t('modals.pluralThem') : '', name: leafOf(folder) })}</>
                )}
              </span>
            </div>
          )}
          {roots.length ? (
            <div className="afm-current">{t('modals.alreadyOpen', { names: roots.map((r) => r.name).join(t('modals.listSep')) })}</div>
          ) : null}
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={close}>{t('common.cancel')}</button>
          <button className="ws-btn ws-btn-primary" disabled={!folder} onClick={submit}>
            {relation && !canAdd ? t('modals.gotIt') : relation?.rel === 'parent' ? t('modals.mergeAndAdd') : t('modals.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
