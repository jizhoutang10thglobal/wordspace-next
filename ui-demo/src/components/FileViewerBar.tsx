import { ExternalLink } from 'lucide-react'
import { useStore } from '../mock/store'
import { useT } from '../i18n'
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
  const t = useT()
  return (
    <div className="fv-bar">
      <span className="fv-bar-name ws-truncate">{fileName}</span>
      <span className="fv-bar-tag">{tag}</span>
      <div className="fv-bar-sp" />
      <button
        className="fv-open"
        onClick={() => toast(t('sidebar.openingWith', { app, name: fileName ?? '' }), 'success')}
      >
        <ExternalLink size={14} />{t('sidebar.openWithApp', { app })}
      </button>
    </div>
  )
}
