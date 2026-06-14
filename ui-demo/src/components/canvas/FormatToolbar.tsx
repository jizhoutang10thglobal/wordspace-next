import { Bold, Italic } from 'lucide-react'

export interface FormatRect {
  top: number
  left: number
}

/**
 * Floating inline toolbar shown above a non-empty text selection. Commands run
 * through document.execCommand against the live selection; the host persists
 * the affected block afterwards via onApplied.
 */
export default function FormatToolbar({
  rect,
  onApplied,
}: {
  rect: FormatRect
  onApplied: () => void
}) {
  // Keep the selection alive: prevent the toolbar from stealing focus.
  const guard = (e: React.MouseEvent) => e.preventDefault()

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value)
    onApplied()
  }

  return (
    <div
      className="ws-fmtbar"
      style={{ top: rect.top, left: rect.left }}
      onMouseDown={guard}
      role="toolbar"
    >
      <button
        className="ws-fmtbar-btn"
        title="加粗"
        onClick={() => exec('bold')}
      >
        <Bold size={15} strokeWidth={2} />
      </button>
      <button
        className="ws-fmtbar-btn"
        title="斜体"
        onClick={() => exec('italic')}
      >
        <Italic size={15} strokeWidth={2} />
      </button>
      <span className="ws-fmtbar-sep" />
      <button
        className="ws-fmtbar-btn ws-fmtbar-text"
        title="一级标题"
        onClick={() => exec('formatBlock', 'h1')}
      >
        H1
      </button>
      <button
        className="ws-fmtbar-btn ws-fmtbar-text"
        title="二级标题"
        onClick={() => exec('formatBlock', 'h2')}
      >
        H2
      </button>
      <button
        className="ws-fmtbar-btn ws-fmtbar-text"
        title="正文"
        onClick={() => exec('formatBlock', 'p')}
      >
        正文
      </button>
      <span className="ws-fmtbar-sep" />
      <button
        className="ws-fmtbar-color"
        title="标蓝"
        onClick={() => exec('foreColor', '#1a73e8')}
      >
        <span className="ws-fmtbar-swatch" />
      </button>
    </div>
  )
}
