import { Chat } from './Chat'

export function App() {
  return (
    <div className='app'>
      <aside className='sidebar'>
        <div className='sidebar__header'>Generative UI Playground</div>
        <button type='button' className='sidebar__new'>
          + New chat
        </button>
        <ul className='sidebar__sessions'>
          <li className='sidebar__session sidebar__session--active'>現在のセッション</li>
        </ul>
      </aside>
      <main className='main'>
        <Chat />
      </main>
    </div>
  )
}
