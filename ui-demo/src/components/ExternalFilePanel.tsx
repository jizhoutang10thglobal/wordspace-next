import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  ExternalLink,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useT } from '../i18n'
import { EXTERNAL_APP, type FileKind } from '../types'
import type { Tab } from '../types'
import './ExternalFilePanel.css'

// Shown when a non-HTML file is opened from a connected folder. Wordspace can't
// edit it, so the page says so and hands off to the OS default app.
const KIND_KEY: Record<FileKind, string> = {
  html: 'sidebar.kindHtml',
  word: 'sidebar.kindWord',
  pdf: 'sidebar.kindPdf',
  image: 'sidebar.kindImage',
  sheet: 'sidebar.kindSheet',
  slides: 'sidebar.kindSlides',
  other: 'sidebar.kindOther',
}

function BigIcon({ kind }: { kind: FileKind }) {
  switch (kind) {
    case 'image':
      return <FileImage size={30} />
    case 'sheet':
      return <FileSpreadsheet size={30} />
    case 'slides':
      return <Presentation size={30} />
    case 'word':
    case 'pdf':
      return <FileText size={30} />
    default:
      return <File size={30} />
  }
}

export default function ExternalFilePanel({ tab }: { tab: Tab }) {
  const toast = useStore((s) => s.toast)
  const t = useT()
  const kind = (tab.fileKind ?? 'other') as FileKind
  const app = kind === 'html' ? t('sidebar.browserApp') : EXTERNAL_APP[kind as Exclude<FileKind, 'html'>]
  return (
    <div className="efp">
      <div className={`efp-card st-${kind}`}>
        <div className="efp-ico">
          <BigIcon kind={kind} />
        </div>
        <div className="efp-name ws-truncate">{tab.fileName}</div>
        <div className="efp-meta">
          {t(KIND_KEY[kind])} · {tab.url}
        </div>
        <p className="efp-note">{t('sidebar.notHtmlNote')}</p>
        <button
          className="ws-btn ws-btn-primary efp-open"
          onClick={() => toast(t('sidebar.openingWith', { app, name: tab.fileName ?? '' }), 'success')}
        >
          <ExternalLink size={15} />{t('sidebar.openWithApp', { app })}
        </button>
      </div>
    </div>
  )
}
