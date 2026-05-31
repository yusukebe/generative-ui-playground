import { useAgentChat } from '@cloudflare/ai-chat/react'
import { useAgent } from 'agents/react'
import { useEffect, useRef, useState } from 'react'
import type { RestaurantAgent } from '../agent'
import { DEFAULT_MODE, type Mode } from '../modes'
import { DEFAULT_MODEL, type ModelId } from '../models'
import type { DeclarativeUI } from '../schemas/declarative'
import type { Restaurant } from '../types'
import { ModelSelector } from './ModelSelector'
import { ModeSelector } from './ModeSelector'
import { RestaurantList } from './components/restaurant/RestaurantList'
import { DeclarativeView } from './modes/DeclarativeView'
import { OpenEndedView } from './modes/OpenEndedView'

type AgentSyncState = { model: ModelId; mode: Mode; useCodeMode: boolean }

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function Chat() {
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [useCodeMode, setUseCodeMode] = useState<boolean>(false)

  const agent = useAgent<typeof RestaurantAgent>({
    agent: 'RestaurantAgent',
    name: 'default',
    onStateUpdate: ((state: AgentSyncState) => {
      if (state?.model) setModel(state.model)
      if (state?.mode) setMode(state.mode)
      if (typeof state?.useCodeMode === 'boolean') setUseCodeMode(state.useCodeMode)
    }) as never,
  })

  const { messages, sendMessage, status, clearHistory } = useAgentChat({ agent })
  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [dropZoneActive, setDropZoneActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const isBusy = status === 'streaming' || status === 'submitted' || isRegistering

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isBusy) return

    if (imageFile) {
      // 登録フロー
      if (!input.trim()) {
        // 画像のみでも登録できるようにテキストは空でも進める
      }
      setIsRegistering(true)
      try {
        const dataUrl = await fileToDataURL(imageFile)
        await agent.stub.registerRestaurant({
          text: input,
          imageDataUrl: dataUrl,
          imageMime: imageFile.type,
        })
        setInput('')
        setImageFile(null)
      } catch (err) {
        console.error('registerRestaurant failed', err)
      } finally {
        setIsRegistering(false)
      }
      return
    }

    if (!input.trim()) return
    sendMessage({ text: input })
    setInput('')
  }

  const setAgentState = agent.setState as unknown as (s: AgentSyncState) => void

  const handleModelChange = (id: ModelId) => {
    setModel(id)
    setAgentState({ model: id, mode, useCodeMode })
  }

  const handleModeChange = (m: Mode) => {
    setMode(m)
    setAgentState({ model, mode: m, useCodeMode })
  }

  const handleCodeModeToggle = () => {
    const next = !useCodeMode
    setUseCodeMode(next)
    setAgentState({ model, mode, useCodeMode: next })
  }

  const handleFile = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return
    setImageFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropZoneActive(false)
    const file = e.dataTransfer.files?.[0]
    handleFile(file ?? null)
  }

  return (
    <div
      className='chat'
      data-drop-active={dropZoneActive}
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) setDropZoneActive(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropZoneActive(false)
      }}
      onDrop={handleDrop}
    >
      <header className='chat__header'>
        <span className='chat__title'>レストラン提案</span>
        <div className='chat__header-right'>
          <ModelSelector value={model} onChange={handleModelChange} />
          <button
            type='button'
            className='chat__clear'
            onClick={() => clearHistory()}
            title='会話履歴をクリア'
          >
            Clear
          </button>
          <span className='chat__status' data-status={status}>
            {isRegistering ? 'registering' : status}
          </span>
        </div>
      </header>

      <div className='chat__messages'>
        {messages.length === 0 && (
          <div className='chat__empty'>
            気分や条件を入力してください。例: 「関内で静かに飲みたい」
            <br />
            <small>📷 画像をドロップしてお店を登録することもできます。</small>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m as { id: string; role: string; parts: MessagePart[] }}
          />
        ))}
        {dropZoneActive && <div className='drop-overlay'>📷 ここにドロップしてお店を登録</div>}
        <div ref={endRef} />
      </div>

      <form className='chat__form' onSubmit={handleSubmit}>
        <div className='chat__controls'>
          <ModeSelector value={mode} onChange={handleModeChange} />
          <label
            className='code-mode-toggle'
            title='LLM がコードを書いて tool 群を呼ぶ (experimental)'
          >
            <input type='checkbox' checked={useCodeMode} onChange={handleCodeModeToggle} />
            <span>Code Mode</span>
          </label>
        </div>
        {imagePreview && (
          <div className='image-preview'>
            <img src={imagePreview} alt='登録予定' />
            <button
              type='button'
              className='image-preview__remove'
              onClick={() => setImageFile(null)}
              aria-label='画像を削除'
            >
              ×
            </button>
            <span className='image-preview__hint'>写真と一言でお店を登録します</span>
          </div>
        )}
        <div className='chat__input-row'>
          <button
            type='button'
            className='chat__attach'
            onClick={() => fileInputRef.current?.click()}
            title='画像を添付'
          >
            📷
          </button>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <input
            type='text'
            name='chat-input'
            className='chat__input'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              imageFile ? '一言コメント (例: 関内のラーメン屋)' : '気分を入力 / 画像をドロップ'
            }
            autoFocus
            autoComplete='off'
            autoCorrect='off'
            spellCheck={false}
          />
          <button
            type='submit'
            className='chat__send'
            disabled={isBusy || (!input.trim() && !imageFile)}
          >
            {imageFile ? '登録' : '送信'}
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; parts: MessagePart[] }
}) {
  return (
    <div className='message' data-role={message.role}>
      <div className='message__role'>{message.role === 'user' ? 'あなた' : 'AI'}</div>
      <div className='message__body'>
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

type FilePart = { type: 'file'; mediaType?: string; url?: string }

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | FilePart
  | ToolPart
  | { type: string; [k: string]: unknown }

function CodeModeView({ part }: { part: ToolPart }) {
  const input = part.input as { code?: string } | undefined
  const output = part.output
  const code = input?.code

  // codemode は `{ result: ... }` で包んで返すことがあるので一段ほどく
  const peel = (v: unknown): unknown => {
    if (v && typeof v === 'object' && 'result' in v) {
      return (v as { result: unknown }).result
    }
    return v
  }
  const actual = peel(output)

  let body: React.ReactNode = (
    <details className='tool-result'>
      <summary>実行結果 (生データ)</summary>
      <pre>{JSON.stringify(output, null, 2)}</pre>
    </details>
  )
  if (actual && typeof actual === 'object') {
    const o = actual as Record<string, unknown>
    if (Array.isArray((o as { restaurants?: unknown }).restaurants)) {
      body = <RestaurantList restaurants={(o as { restaurants: Restaurant[] }).restaurants} />
    } else if (Array.isArray((o as { sections?: unknown }).sections)) {
      body = <DeclarativeView ui={o as DeclarativeUI} />
    } else if (typeof (o as { html?: unknown }).html === 'string') {
      body = <OpenEndedView html={(o as { html: string }).html} />
    }
  }

  return (
    <div className='codemode'>
      {code && (
        <details className='codemode__code' open>
          <summary>🧠 Agent が生成したコード</summary>
          <pre>
            <code>{code}</code>
          </pre>
        </details>
      )}
      {body}
    </div>
  )
}

function PartView({ part }: { part: MessagePart }) {
  if (part.type === 'text') {
    return <span className='part-text'>{(part as { text: string }).text}</span>
  }
  if (part.type === 'file') {
    const fp = part as FilePart
    if (fp.url) {
      return <img src={fp.url} alt='添付画像' className='message__file' />
    }
    return null
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const tp = part as ToolPart
    const toolName = part.type.replace(/^tool-/, '')
    if (tp.state === 'input-streaming' || tp.state === 'input-available') {
      return (
        <div className='tool-progress'>
          <span className='tool-progress__icon'>⚙️</span>
          <span>{toolName} を実行中…</span>
        </div>
      )
    }
    if (tp.state === 'output-error') {
      return <div className='tool-error'>ツールエラー: {tp.errorText ?? 'unknown'}</div>
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
      if (toolName === 'codemode') return <CodeModeView part={tp} />
      return (
        <details className='tool-result'>
          <summary>{toolName} の結果</summary>
          <pre>{JSON.stringify(tp.output, null, 2)}</pre>
        </details>
      )
    }
  }
  return null
}
