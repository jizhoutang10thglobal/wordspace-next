import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'
import { initAppearance } from './appearance'

// 首屏同步应用外观偏好（挂 data-theme），必须在 render 前，防深色用户看到一帧浅色。
initAppearance()

// HashRouter so the production build runs from file:// or any static host
// without server-side route rewrites.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
