import { ExternalLink } from 'lucide-react'
import { useStore } from '../mock/store'
import './FileViewerBar.css'

// The shared top bar for in-app file viewers (PDF, image, …): the file name, a
// read-only tag, and a top-right "open in the OS default app" escape hatch.
export default function FileViewerBar({
  fileName,
  tag,
  app,
}: {
  fileName?: string
  tag: string
  app: string
}) {
  const toast = useStore((s) => s.toast)
  return (
    <div className="fv-bar">
      <span className="fv-bar-name ws-truncate">{fileName}</span>
      <span className="fv-bar-tag">{tag}</span>
      <div className="fv-bar-sp" />
      <button
        className="fv-open"
        onClick={() => toast(`正在用 ${app} 打开「${fileName}」`, 'success')}
      >
        <ExternalLink size={14} />用 {app} 打开
      </button>
    </div>
  )
}
