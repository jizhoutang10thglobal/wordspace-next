import { Routes, Route, Navigate } from 'react-router-dom'
import ArcSidebar from './components/ArcSidebar'
import Canvas from './components/Canvas'
import WebView from './components/WebView'
import TopActions from './components/TopActions'
import ToastHost from './components/ToastHost'
import Templates from './components/Templates'
import Agents from './components/Agents'
import Settings from './components/Settings'
import PublishDialog from './components/PublishDialog'
import CreateModal from './components/CreateModal'
import { useStore } from './mock/store'
import './App.css'

function MainDocs() {
  const { tabs, activeTabId } = useStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab?.kind === 'web') return <WebView tab={tab} />
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
            <Route path="/agents" element={<Agents />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/docs" replace />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
      <PublishDialog />
      <CreateModal />
    </div>
  )
}
