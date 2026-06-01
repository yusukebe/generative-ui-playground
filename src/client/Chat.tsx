import { useAgentChat } from '@cloudflare/ai-chat/react'
import { useAgent } from 'agents/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import type { RestaurantAgent } from '../agent'
import { DEFAULT_MODE, type Mode } from '../modes'
import { DEFAULT_MODEL, type ModelId } from '../models'
import type { DeclarativeUI } from '../schemas/declarative'
import { RestaurantList, type Restaurant } from '../ui-components'
import { ModelSelector } from './ModelSelector'
import { ModeSelector } from './ModeSelector'
import { DeclarativeView } from './modes/DeclarativeView'
import { OpenEndedView } from './modes/OpenEndedView'

type AgentSyncState = { model: ModelId; mode: Mode }

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const ADMIN_TOKEN_KEY = 'generative-ui-playground:admin-token'

export function Chat() {
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : localStorage.getItem(ADMIN_TOKEN_KEY)
  )
  const isAdmin = !!adminToken

  const agent = useAgent<typeof RestaurantAgent>({
    agent: 'RestaurantAgent',
    name: 'default',
    onStateUpdate: ((state: AgentSyncState) => {
      if (state?.model) setModel(state.model)
      if (state?.mode) setMode(state.mode)
    }) as never,
  })

  const { messages, sendMessage, status, clearHistory, error } = useAgentChat({ agent })
  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [dropZoneActive, setDropZoneActive] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const userHistory = useMemo(() => {
    const texts: string[] = []
    for (const m of messages) {
      if (m.role !== 'user') continue
      for (const p of m.parts as Array<{ type: string; text?: string }>) {
        if (p.type === 'text' && p.text) texts.push(p.text)
      }
    }
    return texts.reverse()
  }, [messages])

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
      if (!isAdmin) return
      setIsRegistering(true)
      try {
        const dataUrl = await fileToDataURL(imageFile)
        await agent.stub.registerRestaurant({
          text: input,
          imageDataUrl: dataUrl,
          imageMime: imageFile.type,
          adminToken: adminToken ?? undefined,
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
    setHistoryIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowUp') {
      if (userHistory.length === 0) return
      const next = Math.min(historyIndex + 1, userHistory.length - 1)
      e.preventDefault()
      setHistoryIndex(next)
      setInput(userHistory[next] ?? '')
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < 0) return
      const next = historyIndex - 1
      e.preventDefault()
      setHistoryIndex(next)
      setInput(next < 0 ? '' : (userHistory[next] ?? ''))
    }
  }

  const setAgentState = agent.setState as unknown as (s: AgentSyncState) => void

  const handleModelChange = (id: ModelId) => {
    setModel(id)
    setAgentState({ model: id, mode })
  }

  const handleModeChange = (m: Mode) => {
    setMode(m)
    setAgentState({ model, mode: m })
  }

  const handleFile = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (!isAdmin) return
    setImageFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropZoneActive(false)
    if (!isAdmin) return
    const file = e.dataTransfer.files?.[0]
    handleFile(file ?? null)
  }

  const handleAdminToggle = () => {
    if (isAdmin) {
      localStorage.removeItem(ADMIN_TOKEN_KEY)
      setAdminToken(null)
      return
    }
    const t = window.prompt('Admin token を入力してください')
    if (!t) return
    localStorage.setItem(ADMIN_TOKEN_KEY, t)
    setAdminToken(t)
  }

  const statusText = isRegistering ? 'registering' : !error && status === 'error' ? 'ready' : status

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
        <ModeSelector value={mode} onChange={handleModeChange} />
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
          <button
            type='button'
            className='chat__admin'
            data-active={isAdmin}
            onClick={handleAdminToggle}
            title={isAdmin ? '管理モード ON (クリックで解除)' : '管理モードに切替'}
          >
            {isAdmin ? '🔓 Admin' : '🔒'}
          </button>
          <span className='chat__status' data-status={statusText}>
            {statusText}
          </span>
        </div>
      </header>

      <div className='chat__messages'>
        {messages.length === 0 && (
          <div className='chat__empty'>
            <p>気分や条件を入力してください</p>
            <div className='chat__samples'>
              {[
                '関内で静かに飲みたい',
                '中華街で点心',
                '桜木町でクラフトビール',
                'みなとみらいでデート',
              ].map((q) => (
                <button
                  key={q}
                  type='button'
                  className='chat__sample'
                  onClick={() => {
                    if (isBusy) return
                    sendMessage({ text: q })
                  }}
                  disabled={isBusy}
                >
                  {q}
                </button>
              ))}
            </div>
            <small>📷 画像をドロップしてお店を登録することもできます (Admin のみ)</small>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m as { id: string; role: string; parts: MessagePart[] }}
          />
        ))}
        {isBusy && (
          <div className='thinking-indicator'>
            <span className='thinking-indicator__dots'>
              <span />
              <span />
              <span />
            </span>
            <span className='thinking-indicator__label'>
              {isRegistering
                ? 'レストランを登録中…'
                : status === 'submitted'
                  ? 'リクエスト送信済、応答待ち…'
                  : 'AI が考え中…'}
            </span>
          </div>
        )}
        {dropZoneActive && <div className='drop-overlay'>📷 ここにドロップしてお店を登録</div>}
        <div ref={endRef} />
      </div>

      <form className='chat__form' onSubmit={handleSubmit}>
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
          {isAdmin && (
            <>
              <button
                type='button'
                className='chat__attach'
                onClick={() => fileInputRef.current?.click()}
                title='画像を添付 (admin)'
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
            </>
          )}
          <input
            type='text'
            name='chat-input'
            className='chat__input'
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (historyIndex !== -1) setHistoryIndex(-1)
            }}
            onKeyDown={handleKeyDown}
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
            {isBusy ? '応答中…' : imageFile ? '登録' : '送信'}
          </button>
        </div>
      </form>
    </div>
  )
}

function detectMessageMode(parts: MessagePart[]): { label: string; bandClass: string } | null {
  // parts 全体をスキャンして、より specific な (バンド特性が強い) tool を優先する
  const types = new Set(parts.map((p) => p.type))
  if (types.has('tool-dynamic_render')) return { label: 'Dynamic ✨', bandClass: 'dynamic' }
  if (types.has('tool-render_html')) return { label: 'Open-Ended', bandClass: 'open-ended' }
  if (types.has('tool-render_ui')) return { label: 'Declarative', bandClass: 'declarative' }
  if (types.has('tool-search_restaurants')) return { label: 'Controlled', bandClass: 'controlled' }
  return null
}

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; parts: MessagePart[] }
}) {
  const mode = message.role === 'assistant' ? detectMessageMode(message.parts) : null
  // Declarative / Open-Ended / Dynamic では search_restaurants の生結果は隠す
  // (後続の render_ui / render_html / dynamic_render が UI を再構成するため)
  const types = new Set(message.parts.map((p) => p.type))
  const hideSearchOutput =
    types.has('tool-render_ui') || types.has('tool-render_html') || types.has('tool-dynamic_render')

  return (
    <div className='message' data-role={message.role}>
      <div className='message__role'>
        <span>{message.role === 'user' ? 'あなた' : 'AI'}</span>
        {mode && <span className={`message__band band-${mode.bandClass}`}>{mode.label}</span>}
      </div>
      <div className='message__body'>
        {message.parts.map((part, i) => (
          <PartView key={i} part={part} hideSearchOutput={hideSearchOutput} />
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

/**
 * Dynamic バンド: LLM が書いた Worker module の SSR 結果を表示。
 * - input.code: LLM が書いた TSX ソース
 * - output.body: Worker の Response body (HTML)
 * - output.contentType: Worker の Response Content-Type
 */
function DynamicRenderView({ part }: { part: ToolPart }) {
  const input = part.input as { code?: string; search?: unknown } | undefined
  const output = part.output as
    | { contentType?: string; body?: string; restaurants?: Restaurant[]; code?: string }
    | undefined
  const code = input?.code ?? output?.code

  return (
    <div className='codemode'>
      {code && (
        <details className='codemode__code' open>
          <summary>🧠 Agent が書いた Worker module (TSX)</summary>
          <pre>
            <code>{code}</code>
          </pre>
        </details>
      )}
      {output?.body && output.contentType?.includes('html') ? (
        <OpenEndedView html={output.body} />
      ) : (
        <details className='tool-result'>
          <summary>Dynamic Worker の Response</summary>
          <pre>{output?.body ?? JSON.stringify(output, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

function PartView({ part, hideSearchOutput }: { part: MessagePart; hideSearchOutput?: boolean }) {
  if (part.type === 'text') {
    return (
      <div className='part-text'>
        <Streamdown>{(part as { text: string }).text}</Streamdown>
      </div>
    )
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
      // search_restaurants の "実行中" 表示は Declarative/Open-Ended/Dynamic では隠す
      // (短時間で終わるノイズなため)
      if (toolName === 'search_restaurants' && hideSearchOutput) return null
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
      // Dynamic バンド (LLM が書く Worker module を SSR 実行)
      if (toolName === 'dynamic_render') return <DynamicRenderView part={tp} />
      // Controlled バンド (Declarative/Open-Ended/Dynamic では搬送路扱いで隠す)
      if (toolName === 'search_restaurants') {
        if (hideSearchOutput) return null
        const output = tp.output as { restaurants?: Restaurant[] } | undefined
        if (output?.restaurants) return <RestaurantList restaurants={output.restaurants} />
      }
      // Declarative バンド
      if (toolName === 'render_ui') {
        const output = tp.output as DeclarativeUI | undefined
        if (output) return <DeclarativeView ui={output} />
      }
      // Open-Ended バンド
      if (toolName === 'render_html') {
        const output = tp.output as { html?: string } | undefined
        if (output?.html) return <OpenEndedView html={output.html} />
      }
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
