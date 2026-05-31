import { useAgentChat } from '@cloudflare/ai-chat/react'
import { useAgent } from 'agents/react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MODE, type Mode } from '../modes'
import { DEFAULT_MODEL, type ModelId } from '../models'
import type { DeclarativeUI } from '../schemas/declarative'
import type { Restaurant } from '../types'
import { ModelSelector } from './ModelSelector'
import { ModeSelector } from './ModeSelector'
import { RestaurantList } from './components/restaurant/RestaurantList'
import { DeclarativeView } from './modes/DeclarativeView'
import { OpenEndedView } from './modes/OpenEndedView'

type AgentSyncState = { model: ModelId; mode: Mode }

export function Chat() {
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)

  const agent = useAgent({
    agent: 'RestaurantAgent',
    name: 'default',
    onStateUpdate: (state: AgentSyncState) => {
      if (state?.model) setModel(state.model)
      if (state?.mode) setMode(state.mode)
    },
  })

  const { messages, sendMessage, status } = useAgentChat({ agent })
  const [input, setInput] = useState('')
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

  const handleModelChange = (id: ModelId) => {
    setModel(id)
    agent.setState({ model: id, mode })
  }

  const handleModeChange = (m: Mode) => {
    setMode(m)
    agent.setState({ model, mode: m })
  }

  return (
    <div className="chat">
      <header className="chat__header">
        <span className="chat__title">レストラン提案</span>
        <div className="chat__header-right">
          <ModelSelector value={model} onChange={handleModelChange} />
          <span className="chat__status" data-status={status}>{status}</span>
        </div>
      </header>

      <div className="chat__messages">
        {messages.length === 0 && (
          <div className="chat__empty">気分や条件を入力してください。例: 「中目黒で静かに飲みたい」</div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <ModeSelector value={mode} onChange={handleModeChange} />
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

function MessageBubble({ message }: { message: { id: string; role: string; parts: MessagePart[] } }) {
  return (
    <div className="message" data-role={message.role}>
      <div className="message__role">{message.role === 'user' ? 'あなた' : 'AI'}</div>
      <div className="message__body">
        {message.parts.map((part, i) => (
          <PartView key={i} part={part} />
        ))}
      </div>
    </div>
  )
}

type ToolPart = {
  type: `tool-${string}`
  toolCallId?: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: unknown
  output?: unknown
  errorText?: string
}

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | ToolPart
  | { type: string; [k: string]: unknown }

function PartView({ part }: { part: MessagePart }) {
  if (part.type === 'text') {
    return <span className="part-text">{(part as { text: string }).text}</span>
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const tp = part as ToolPart
    const toolName = part.type.replace(/^tool-/, '')
    if (tp.state === 'input-streaming' || tp.state === 'input-available') {
      return (
        <div className="tool-progress">
          <span className="tool-progress__icon">⚙️</span>
          <span>{toolName} を実行中…</span>
        </div>
      )
    }
    if (tp.state === 'output-error') {
      return <div className="tool-error">ツールエラー: {tp.errorText ?? 'unknown'}</div>
    }
    if (tp.state === 'output-available') {
      if (toolName === 'search_restaurants') {
        const output = tp.output as { restaurants?: Restaurant[] } | undefined
        if (output?.restaurants) return <RestaurantList restaurants={output.restaurants} />
      }
      if (toolName === 'render_ui') {
        const output = tp.output as DeclarativeUI | undefined
        if (output) return <DeclarativeView ui={output} />
      }
      if (toolName === 'render_html') {
        const output = tp.output as { html?: string } | undefined
        if (output?.html) return <OpenEndedView html={output.html} />
      }
      return (
        <details className="tool-result">
          <summary>{toolName} の結果</summary>
          <pre>{JSON.stringify(tp.output, null, 2)}</pre>
        </details>
      )
    }
  }
  return null
}
