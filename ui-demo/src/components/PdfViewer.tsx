import FileViewerBar from './FileViewerBar'
import { useT } from '../i18n'
import type { Tab } from '../types'
import './PdfViewer.css'

// Wordspace is a browser, so a PDF opens read-only right here in the tab (like
// Chrome's built-in viewer) instead of handing off to another app. The pages
// below are mock content — a real build renders the actual PDF.
export default function PdfViewer({ tab }: { tab: Tab }) {
  const t = useT()
  const title = (tab.fileName ?? 'PDF').replace(/\.pdf$/i, '')
  return (
    <div className="pdfv">
      <FileViewerBar fileName={tab.fileName} tag={t('editor.readonlyPdf')} app={t('editor.preview')} />

      <div className="pdfv-scroll">
        <div className="pdfv-page">
          <div className="pdfv-eyebrow">{t('editor.pdfEyebrow')}</div>
          <h1 className="pdfv-h1">{title}</h1>
          <div className="pdfv-meta">{t('editor.pdfMeta1')}</div>
          <p className="pdfv-p">
            {t('editor.pdfIntro')}
          </p>
          <h2 className="pdfv-h2">{t('editor.pdfOverview')}</h2>
          <p className="pdfv-p">
            {t('editor.pdfOverviewBody')}
          </p>
          <div className="pdfv-chart">
            {[62, 81, 48, 92, 70].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="pdfv-cap">{t('editor.pdfChartCap')}</p>
        </div>

        <div className="pdfv-page">
          <h2 className="pdfv-h2">{t('editor.pdfBreakdown')}</h2>
          <ul className="pdfv-list">
            <li>{t('editor.pdfItem1')}</li>
            <li>{t('editor.pdfItem2')}</li>
            <li>{t('editor.pdfItem3')}</li>
          </ul>
          <p className="pdfv-p">{t('editor.pdfClosing')}</p>
          <div className="pdfv-meta">{t('editor.pdfMeta2')}</div>
        </div>
      </div>
    </div>
  )
}
