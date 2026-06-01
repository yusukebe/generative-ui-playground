import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Cloudflare 製 UI ライブラリ Kumo (非 Tailwind の standalone CSS)。styles.css より先に読み込む
// @ts-expect-error CSS の side-effect import (型なし)
import '@cloudflare/kumo/styles/standalone'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
