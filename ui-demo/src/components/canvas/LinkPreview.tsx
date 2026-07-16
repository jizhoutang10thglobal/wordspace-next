import { createPortal } from 'react-dom'
import { FileText, Unlink, CornerUpRight, FilePlus2 } from 'lucide-react'
import { useT } from '../../i18n'
import { useStore } from '../../mock/store'
import { snippetOf, repairCandidates, dirOf, baseOf } from '../../lib/links'
import type { FileEntry } from '../../types'

/**
 * 链接悬停预览卡 / 断链修复卡（同一浮层的两副面孔）：
 * - 目标存在 → 标题 + 前几块内容摘要 + 路径，点「打开」跳过去（Obsidian page preview 的轻量版）。
 * - 目标不存在 → 断链说明 + 修复动作（重新绑定到同名候选 / 新建该文件）——断链修复做成一等 UI
 *   是全行业空白（Obsidian 全靠第三方插件），这是我们的差异化点。
 * 浮层自身 hover 时保持打开（onKeep/onLeave 由 Canvas 管定时器）。
 */
export default function LinkPreview({
  state,
  onKeep,
  onLeave,
  onClose,
  onRebind,
  onCreate,
}: {
  state: {
    rect: { top: number; left: number; bottom: number }
    href: string
    target: string | null // 解析出的根内路径；null = 外链等（不弹卡，Canvas 已滤掉）
    rootId: string
    broken: boolean
  }
  onKeep: () => void
  onLeave: () => void
  onClose: () => void
  onRebind: (candidate: FileEntry) => void
  onCreate: () => void
}) {
  const t = useT()
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const openFileTab = useStore((s) => s.openFileTab)

  const file = state.target
    ? files.find((f) => f.rootId === state.rootId && f.path === state.target)
    : undefined
  const doc = file?.docId ? docs.find((d) => d.id === file.docId) : undefined
  const candidates = state.broken && state.target ? repairCandidates(files, state.rootId, state.target) : []

  // 卡片钉在链接下方，左右都夹在视口内（卡宽 300）
  const style = {
    top: state.rect.bottom + 8,
    left: Math.min(Math.max(12, state.rect.left - 8), window.innerWidth - 312),
  }

  // portal 到 body：同 MentionMenu——fixed 坐标不能被带 transform 的祖先劫持
  return createPortal(
    <div
      className={`ws-linkpreview${state.broken ? ' is-broken' : ''}`}
      style={style}
      onMouseEnter={onKeep}
      onMouseLeave={onLeave}
    >
      {state.broken ? (
        <>
          <div className="ws-linkpreview-brokenhead">
            <Unlink size={14} />
            <span>{t('editor.linkTargetMissing')}</span>
          </div>
          <div className="ws-linkpreview-path">{state.target ?? state.href}</div>
          <div className="ws-linkpreview-hint">{t('editor.targetMovedHint')}</div>
          {candidates.length > 0 && (
            <div className="ws-linkpreview-fixes">
              {candidates.slice(0, 3).map((c) => (
                <button
                  key={c.path}
                  className="ws-linkpreview-fix"
                  onClick={() => onRebind(c)}
                  title={c.path}
                >
                  <CornerUpRight size={13} />
                  <span className="ws-truncate">{t('editor.repointTo', { path: c.path })}</span>
                </button>
              ))}
            </div>
          )}
          <div className="ws-linkpreview-fixes">
            <button className="ws-linkpreview-fix" onClick={onCreate}>
              <FilePlus2 size={13} />
              <span>{t('editor.createInDir', { dir: dirOf(state.target ?? '') || t('editor.rootDir'), name: baseOf(state.target ?? '') })}</span>
            </button>
          </div>
        </>
      ) : file && doc ? (
        <>
          <div className="ws-linkpreview-title">
            <FileText size={14} />
            <span className="ws-truncate">{doc.title}</span>
          </div>
          <div className="ws-linkpreview-body">
            {doc.blocks.slice(0, 4).map((b) => (
              <p key={b.id} className="ws-linkpreview-line">
                {snippetOf(b.html, 72)}
              </p>
            ))}
          </div>
          <div className="ws-linkpreview-foot">
            <span className="ws-linkpreview-path ws-truncate">{file.path}</span>
            <button
              className="ws-linkpreview-open"
              onClick={() => {
                onClose()
                openFileTab(file)
              }}
            >
              {t('common.open')}
            </button>
          </div>
        </>
      ) : file ? (
        <>
          {/* 非文档文件（pdf/表格/图片…）：没有内容摘要可预览，给类型说明 + 打开（转交系统程序面板） */}
          <div className="ws-linkpreview-title">
            <FileText size={14} />
            <span className="ws-truncate">{baseOf(file.path)}</span>
          </div>
          <div className="ws-linkpreview-hint">{t('editor.nonDocFileHint')}</div>
          <div className="ws-linkpreview-foot">
            <span className="ws-linkpreview-path ws-truncate">{file.path}</span>
            <button
              className="ws-linkpreview-open"
              onClick={() => {
                onClose()
                openFileTab(file)
              }}
            >
              {t('common.open')}
            </button>
          </div>
        </>
      ) : null}
    </div>,
    document.body,
  )
}
