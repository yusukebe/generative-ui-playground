export type Mode = 'auto' | 'controlled' | 'declarative' | 'open-ended'

export const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'LLM が Content-Type を選んで出力 UI を決める',
  },
  {
    value: 'controlled',
    label: 'Controlled',
    description: 'application/json (restaurants) に固定 — 事前定義カード',
  },
  {
    value: 'declarative',
    label: 'Declarative',
    description: 'application/vnd.gui-tree+json に固定 — プリミティブ語彙',
  },
  {
    value: 'open-ended',
    label: 'Open-Ended',
    description: 'text/html に固定 — iframe 描画',
  },
]

export const DEFAULT_MODE: Mode = 'auto'
