import { Routes, Route, Navigate } from 'react-router-dom'
import ArcSidebar from './components/ArcSidebar'
import Canvas from './components/Canvas'
import BasicEditor from './components/BasicEditor'
import WebView from './components/WebView'
import ExternalFilePanel from './components/ExternalFilePanel'
import PdfViewer from './components/PdfViewer'
import ImageViewer from './components/ImageViewer'
import TopActions from './components/TopActions'
import ToastHost from './components/ToastHost'
import Templates from './components/Templates'
import Agents from './components/Agents'
import Settings from './components/Settings'
import SchemaPage from './components/SchemaPage'
import PublishDialog from './components/PublishDialog'
import CreateModal from './components/CreateModal'
import CreateSpaceModal from './components/CreateSpaceModal'
import FindPalette from './components/FindPalette'
import { useStore } from './mock/store'
import { checkSchema } from './lib/schemaCheck'
import './App.css'

function MainDocs() {
  const { tabs, activeTabId, docs } = useStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab?.kind === 'web') return <WebView tab={tab} />
  if (tab?.kind === 'file') {
    if (tab.fileKind === 'pdf') return <PdfViewer tab={tab} />
    if (tab.fileKind === 'image') return <ImageViewer tab={tab} />
    return <ExternalFilePanel tab={tab} />
  }
  // 非合规野生 HTML：由确定性校验器实判 → 不合规即走基础编辑（BasicEditor），不进块编辑器 Canvas。
  const doc = tab?.docId ? docs.find((d) => d.id === tab.docId) : undefined
  if (doc?.rawHtml && !checkSchema(doc.rawHtml).conform) {
    return <BasicEditor doc={doc} />
  }
  return (
    <div className="ws-main-doc">
      <TopActions />
      <Canvas />
    </div>
  )
}

export default function App() {
  return (
    <div className="ws-app">
      <div className="ws-body">
        <ArcSidebar />
        <div className="ws-main">
          <Routes>
            <Route path="/docs" element={<MainDocs />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/schema" element={<SchemaPage />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/docs" replace />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
      <PublishDialog />
      <CreateModal />
      <CreateSpaceModal />
      <FindPalette />
    </div>
  )
}
