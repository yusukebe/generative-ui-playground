import { useAgentChat } from '@cloudflare/ai-chat/react'
import { Button } from '@cloudflare/kumo/components/button'
import { useAgent } from 'agents/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import type { RestaurantAgent } from '../agent'
import { DEFAULT_MODE, type Mode } from '../modes'
import { DEFAULT_MODEL, type ModelId } from '../models'
import type { DeclarativeUI } from '../schemas/declarative'
import { RestaurantList, RestaurantListSkeleton, type Restaurant } from '../ui-components'
import { ModelSelector } from './ModelSelector'
import { ModeSelector } from './ModeSelector'
import { ViewTabs, type View } from './ViewTabs'
import { DeclarativeView } from './modes/DeclarativeView'
import { OpenEndedView } from './modes/OpenEndedView'

type AgentSyncState = { model: ModelId; mode: Mode }

export function Chat({ view, onViewChange }: { view: View; onViewChange: (v: View) => void }) {
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)

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
  const [historyIndex, setHistoryIndex] = useState(-1)
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

  const isBusy = status === 'streaming' || status === 'submitted'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isBusy || !input.trim()) return
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

  const statusText = !error && status === 'error' ? 'ready' : status

  return (
    <div className='chat'>
      <header className='chat__header'>
        <span className='chat__title'>レストラン提案</span>
        <ViewTabs value={view} onChange={onViewChange} />
        <ModeSelector value={mode} onChange={handleModeChange} />
        <div className='chat__header-right'>
          <ModelSelector value={model} onChange={handleModelChange} />
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => clearHistory()}
            title='会話履歴をクリア'
          >
            Clear
          </Button>
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
                <Button
                  key={q}
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    if (isBusy) return
                    sendMessage({ text: q })
                  }}
                  disabled={isBusy}
                >
                  {q}
                </Button>
              ))}
            </div>
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
              {status === 'submitted' ? 'リクエスト送信済、応答待ち…' : 'AI が考え中…'}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className='chat__form' onSubmit={handleSubmit}>
        <div className='chat__input-row'>
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
            placeholder='気分や条件を入力'
            autoFocus
            autoComplete='off'
            autoCorrect='off'
            spellCheck={false}
          />
          <Button type='submit' variant='primary' loading={isBusy} disabled={!input.trim()}>
            送信
          </Button>
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
          <summary>🧠 Agent が書いた APP コンポーネント (TSX)</summary>
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
      // Controlled: 検索中はスケルトンを出す (テキスト→スケルトン→実カード の体験)
      if (toolName === 'search_restaurants') {
        return (
          <div className='tool-skeleton'>
            <div className='tool-progress'>
              <span className='tool-progress__icon'>🔎</span>
              <span>お店を検索中…</span>
            </div>
            <RestaurantListSkeleton />
          </div>
        )
      }
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
