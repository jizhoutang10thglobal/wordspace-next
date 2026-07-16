import { useEffect, useRef } from 'react'
import { Type, Heading, Quote, Plus, Copy, Trash2 } from 'lucide-react'
import { useT } from '../../i18n'
import type { BlockType } from '../../types'

const COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2']

/**
 * 点块左侧 ⋮⋮ 手柄弹出的块操作菜单（拖手柄仍是重排）。Notion 的块菜单：转块 / 复制 / 删除 / 颜色。
 * 用 fixed 定位在手柄下方（pos 是视口坐标）。
 */
export default function BlockActionMenu({
  pos,
  blockType,
  onTurnInto,
  onInsertBelow,
  onDuplicate,
  onDelete,
  onColor,
  onClose,
}: {
  pos: { top: number; left: number }
  blockType?: BlockType // 图片等原子块：转为/颜色不适用（转正文会把 base64 当文字塞进段落）
  onTurnInto: (type: BlockType, level?: 1 | 2 | 3) => void
  onInsertBelow: () => void
  onDuplicate: () => void
  onDelete: () => void
  onColor: (c: string) => void
  onClose: () => void
}) {
  const t = useT()
  const atomic = blockType === 'image'
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="ws-blockmenu"
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
    >
      {!atomic && (
        <>
          <button
            className="ws-blockmenu-item"
            role="menuitem"
            onClick={() => {
              onTurnInto('text')
              onClose()
            }}
          >
            <Type size={15} strokeWidth={1.8} />
            <span>{t('editor.turnIntoText')}</span>
          </button>
          <button
            className="ws-blockmenu-item"
            role="menuitem"
            onClick={() => {
              onTurnInto('heading', 2)
              onClose()
            }}
          >
            <Heading size={15} strokeWidth={1.8} />
            <span>{t('editor.turnIntoHeading')}</span>
          </button>
          <button
            className="ws-blockmenu-item"
            role="menuitem"
            onClick={() => {
              onTurnInto('quote')
              onClose()
            }}
          >
            <Quote size={15} strokeWidth={1.8} />
            <span>{t('editor.turnIntoQuote')}</span>
          </button>

          <div className="ws-blockmenu-sep" />
        </>
      )}

      <button
        className="ws-blockmenu-item"
        role="menuitem"
        onClick={() => {
          onInsertBelow()
          onClose()
        }}
      >
        <Plus size={15} strokeWidth={1.8} />
        <span>{t('editor.insertBelow')}</span>
      </button>
      <button
        className="ws-blockmenu-item"
        role="menuitem"
        onClick={() => {
          onDuplicate()
          onClose()
        }}
      >
        <Copy size={15} strokeWidth={1.8} />
        <span>{t('common.copy')}</span>
      </button>
      <button
        className="ws-blockmenu-item ws-blockmenu-danger"
        role="menuitem"
        onClick={() => {
          onDelete()
          onClose()
        }}
      >
        <Trash2 size={15} strokeWidth={1.8} />
        <span>{t('common.delete')}</span>
      </button>

      {!atomic && (
        <>
          <div className="ws-blockmenu-sep" />

          <div className="ws-blockmenu-colors">
            {COLORS.map((c) => (
              <button
                key={c}
                className="ws-blockmenu-swatch"
                style={{ background: c }}
                title={c}
                onClick={() => {
                  onColor(c)
                  onClose()
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
