export type Mode = 'controlled' | 'declarative' | 'open-ended'

export const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: 'controlled',
    label: 'Controlled',
    description: '事前定義コンポーネントを Agent が選択して描画',
  },
  {
    value: 'declarative',
    label: 'Declarative',
    description: 'プリミティブ語彙を組み合わせて Agent が UI を組み立て',
  },
  {
    value: 'open-ended',
    label: 'Open-Ended',
    description: 'Agent が HTML/CSS/JS をフル生成 (iframe sandbox)',
  },
]

export const DEFAULT_MODE: Mode = 'controlled'
