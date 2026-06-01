import { Chat } from './Chat'

const BANDS = [
  {
    label: 'Controlled',
    color: '#a5a8ff',
    desc: '事前定義コンポーネントを Agent が選択して描画',
  },
  {
    label: 'Declarative',
    color: '#6fd9b8',
    desc: 'Section / Card プリミティブで Agent が UI を組み立て',
  },
  {
    label: 'Open-Ended',
    color: '#ffaf5f',
    desc: 'Agent が HTML/CSS/JS をフル生成 (iframe + CSP)',
  },
  {
    label: 'Dynamic ✨',
    color: '#cc88ff',
    desc: 'Agent が JSX で Worker module を書き、Dynamic Worker で SSR',
  },
]

export function App() {
  return (
    <div className='app'>
      <aside className='sidebar'>
        <div className='sidebar__header'>Generative UI Playground</div>
        <p className='sidebar__lead'>
          Cloudflare Workers + Hono + React + Workers AI で作ったレストラン提案デモ
        </p>
        <div className='sidebar__bands'>
          <div className='sidebar__bands-title'>4 つのバンド</div>
          {BANDS.map((b) => (
            <div key={b.label} className='sidebar__band'>
              <span className='sidebar__band-dot' style={{ background: b.color }} />
              <div className='sidebar__band-text'>
                <div className='sidebar__band-label'>{b.label}</div>
                <div className='sidebar__band-desc'>{b.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className='sidebar__footer'>
          <a
            href='https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020'
            target='_blank'
            rel='noopener noreferrer'
            className='sidebar__link'
          >
            登壇プロポーザル ↗
          </a>
          <a
            href='https://www.copilotkit.ai/generative-ui-spectrum'
            target='_blank'
            rel='noopener noreferrer'
            className='sidebar__link'
          >
            Spectrum 原典 (CopilotKit) ↗
          </a>
        </div>
      </aside>
      <main className='main'>
        <Chat />
      </main>
    </div>
  )
}
