import { useAgentChat } from '@cloudflare/ai-chat/react'
import { useAgent } from 'agents/react'
import { useEffect, useRef, useState } from 'react'
import { ModeSelector, type Mode } from './ModeSelector'

export function Chat() {
  const [mode, setMode] = useState<Mode>('controlled')
  const agent = useAgent({
    agent: 'RestaurantAgent',
    name: 'default',
  })

  const { messages, sendMessage, status } = useAgentChat({ agent })
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const isBusy = status === 'streaming' || status === 'submitted'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isBusy) return
    sendMessage({ text: input })
    setInput('')
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <span className="chat__title">レストラン提案</span>
        <span className="chat__status" data-status={status}>{status}</span>
      </header>

      <div className="chat__messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="chat__empty">気分や条件を入力してください。例: 「中目黒で静かに飲みたい」</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="message" data-role={m.role}>
            <div className="message__role">{m.role === 'user' ? 'あなた' : 'AI'}</div>
            <div className="message__body">
              {m.parts.map((part, i) => {
                if (part.type === 'text') return <span key={i}>{part.text}</span>
                return null
              })}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <ModeSelector value={mode} onChange={setMode} />
        <div className="chat__input-row">
          <input
            type="text"
            name="chat-input"
            className="chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="気分を入力 / 画像をドロップ"
            autoFocus
          />
          <button
            type="submit"
            className="chat__send"
            disabled={!input.trim() || isBusy}
          >
            送信
          </button>
        </div>
      </form>
    </div>
  )
}
