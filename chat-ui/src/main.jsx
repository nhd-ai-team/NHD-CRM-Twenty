import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MailApp } from './components/MailApp.jsx'
import { useTheme } from './hooks/useTheme.js'

// 视图路由：hash 含 view=mail → 邮箱视图；否则渠道工作台。两者共用 twenty auth hash。
function getView() {
  const hash = window.location.hash?.replace(/^#/, '') || ''
  return new URLSearchParams(hash).get('view') === 'mail' ? 'mail' : 'chat'
}

function Root() {
  useTheme()
  return getView() === 'mail' ? <MailApp /> : <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
