import FileViewerBar from './FileViewerBar'
import { useT } from '../i18n'
import type { Tab } from '../types'
import './ImageViewer.css'

// Browsers render images natively, so an image opens read-only right here. The
// artwork is a stand-in; a real build shows the actual image file.
export default function ImageViewer({ tab }: { tab: Tab }) {
  const t = useT()
  return (
    <div className="imgv">
      <FileViewerBar fileName={tab.fileName} tag={t('editor.readonlyImage')} app={t('editor.preview')} />
      <div className="imgv-scroll">
        <figure className="imgv-frame">
          <div className="imgv-art" />
          <figcaption className="imgv-cap">{tab.fileName}</figcaption>
        </figure>
      </div>
    </div>
  )
}
