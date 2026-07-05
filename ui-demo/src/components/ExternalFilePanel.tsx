import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  ExternalLink,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { EXTERNAL_APP, type FileKind } from '../types'
import type { Tab } from '../types'
import './ExternalFilePanel.css'

// Shown when a non-HTML file is opened from a connected folder. Wordspace can't
// edit it, so the page says so and hands off to the OS default app.
const KIND_LABEL: Record<FileKind, string> = {
  html: 'HTML 文档',
  word: 'Word 文档',
  pdf: 'PDF',
  image: '图片',
  sheet: '表格',
  slides: '演示文稿',
  other: '文件',
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
  const kind = (tab.fileKind ?? 'other') as FileKind
  const app = kind === 'html' ? '浏览器' : EXTERNAL_APP[kind as Exclude<FileKind, 'html'>]
  return (
    <div className="efp">
      <div className={`efp-card st-${kind}`}>
        <div className="efp-ico">
          <BigIcon kind={kind} />
        </div>
        <div className="efp-name ws-truncate">{tab.fileName}</div>
        <div className="efp-meta">
          {KIND_LABEL[kind]} · {tab.url}
        </div>
        <p className="efp-note">这不是 HTML 文档,Wordspace 不能直接编辑它。你可以一键用默认程序打开。</p>
        <button
          className="ws-btn ws-btn-primary efp-open"
          onClick={() => toast(`正在用 ${app} 打开「${tab.fileName}」`, 'success')}
        >
          <ExternalLink size={15} />用 {app} 打开
        </button>
      </div>
    </div>
  )
}
