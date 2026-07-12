import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DebugPresets from './DebugPresets.tsx'

// No router dependency for one internal QA route — a plain path check is enough.
const Root = window.location.pathname === '/debug/presets' ? DebugPresets : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
