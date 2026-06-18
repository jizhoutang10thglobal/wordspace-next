import FileViewerBar from './FileViewerBar'
import type { Tab } from '../types'
import './PdfViewer.css'

// Wordspace is a browser, so a PDF opens read-only right here in the tab (like
// Chrome's built-in viewer) instead of handing off to another app. The pages
// below are mock content — a real build renders the actual PDF.
export default function PdfViewer({ tab }: { tab: Tab }) {
  const title = (tab.fileName ?? 'PDF').replace(/\.pdf$/i, '')
  return (
    <div className="pdfv">
      <FileViewerBar fileName={tab.fileName} tag="PDF · 只读" app="预览" />

      <div className="pdfv-scroll">
        <div className="pdfv-page">
          <div className="pdfv-eyebrow">TENTH GLOBAL · 报告</div>
          <h1 className="pdfv-h1">{title}</h1>
          <div className="pdfv-meta">2026 年 6 月 · 第 1 页 / 共 2 页</div>
          <p className="pdfv-p">
            这是一份 PDF 文档。Wordspace 作为浏览器,可以直接在标签页里阅读它,不用切到别的程序。PDF
            是只读的,需要编辑时再用默认程序打开。
          </p>
          <h2 className="pdfv-h2">概述</h2>
          <p className="pdfv-p">
            本季度核心业务保持稳健增长,新签客户与复购同步提升。下面是关键指标与各业务线的分项说明。
          </p>
          <div className="pdfv-chart">
            {[62, 81, 48, 92, 70].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="pdfv-cap">图 1 · 各业务线季度表现</p>
        </div>

        <div className="pdfv-page">
          <h2 className="pdfv-h2">分项说明</h2>
          <ul className="pdfv-list">
            <li>咨询交付:现金流稳定,毛利率维持在 40% 以上</li>
            <li>培训与内容:方法论持续沉淀,转化率提升</li>
            <li>AI 产品:从内部工具孵化,进入验证阶段</li>
          </ul>
          <p className="pdfv-p">详细数据见附录。本页为示意内容,用于演示 PDF 在 Wordspace 中的阅读体验。</p>
          <div className="pdfv-meta">第 2 页 / 共 2 页</div>
        </div>
      </div>
    </div>
  )
}
