import { Button } from '@cloudflare/kumo/components/button'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MODEL, type ModelId } from '../models'
import type { DeclarativeUI } from '../schemas/declarative'
import type { Plan, PlanParams } from '../schemas/plan'
import type { Restaurant } from '../ui-components'
import { ModelSelector } from './ModelSelector'
import { StreamFrame } from './StreamFrame'
import { DeclarativeView } from './modes/DeclarativeView'
import { OpenEndedView } from './modes/OpenEndedView'
import { PlanView } from './modes/PlanView'

type Band = 'controlled' | 'declarative' | 'open-ended' | 'dynamic'
type Status = 'idle' | 'streaming' | 'done' | 'error'
type Weather = {
  emoji: string
  label: string
  tempMax: number | null
  tempMin: number | null
  precipProb: number | null
} | null

type LastTrain = { station: string; summary: string; leaveBy: string } | null
type Turn = { role: 'user' | 'assistant'; text: string }

type BandResults = {
  controlled: Plan | null
  declarative: DeclarativeUI | null
  openEnded: string | null
  dynamicFrameUrl: string | null
  dynamicCode: string
  status: Record<Band, Status>
}

const EMPTY_RESULTS: BandResults = {
  controlled: null,
  declarative: null,
  openEnded: null,
  dynamicFrameUrl: null,
  dynamicCode: '',
  status: { controlled: 'idle', declarative: 'idle', 'open-ended': 'idle', dynamic: 'idle' },
}

const BANDS: { id: Band; label: string; desc: string }[] = [
  { id: 'controlled', label: 'Controlled', desc: '既製プランテンプレに AI が値を流し込む' },
  { id: 'declarative', label: 'Declarative', desc: 'section(1軒目/2軒目/〆) を streamObject で順に組む' },
  { id: 'open-ended', label: 'Open-Ended', desc: 'AI が HTML でプラン1枚をフル生成' },
  { id: 'dynamic', label: 'Dynamic ✨', desc: 'AI が React を書き Worker が Suspense SSR' },
]

const SAMPLES = [
  '来週の金曜、関内で4人で接待',
  '今週末 野毛で2人デート',
  'みなとみらいで一人ゆっくり', // 日付なし → 聞き返し
  '関内で飲みたい', // 情報不足 → 聞き返し
]

export function Compare() {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [input, setInput] = useState('')
  const [convo, setConvo] = useState<Turn[]>([])
  const [intaking, setIntaking] = useState(false)
  const [params, setParams] = useState<PlanParams | null>(null)
  const [weather, setWeather] = useState<Weather>(null)
  const [lastTrain, setLastTrain] = useState<LastTrain>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [results, setResults] = useState<BandResults>(EMPTY_RESULTS)
  const [band, setBand] = useState<Band>('controlled')
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const compareRef = useRef<HTMLDivElement>(null)

  const ready = !!params
  const isStreaming = intaking || Object.values(results.status).some((s) => s === 'streaming')

  // ストリーミング中はコンテンツの伸びを追って下へオートスクロール (伸びる iframe にも追従)
  useEffect(() => {
    if (!isStreaming) return
    const el = compareRef.current
    if (!el) return
    const id = setInterval(() => {
      el.scrollTop = el.scrollHeight
    }, 150)
    return () => clearInterval(id)
  }, [isStreaming])

  const submit = async (text: string) => {
    const t = text.trim()
    if (!t || intaking) return
    if (historyRef.current[0] !== t) historyRef.current.unshift(t)
    setHistoryIndex(-1)
    setInput('')
    const nextConvo: Turn[] = [...convo, { role: 'user', text: t }]
    setConvo(nextConvo)
    setIntaking(true)
    setError(null)
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history: nextConvo, model }),
      })
      if (!res.ok) throw new Error(`intake ${res.status}`)
      const data = (await res.json()) as
        | { ready: false; question: string }
        | {
            ready: true
            params: PlanParams
            weather: Weather
            restaurants: Restaurant[]
            lastTrain: LastTrain
          }

      if (!data.ready) {
        setConvo([...nextConvo, { role: 'assistant', text: data.question }])
      } else {
        setParams(data.params)
        setWeather(data.weather)
        setLastTrain(data.lastTrain)
        setRestaurants(data.restaurants)
        setResults(EMPTY_RESULTS)
        generateBand(band, data.params, data.weather, data.restaurants, data.lastTrain)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラー')
    } finally {
      setIntaking(false)
    }
  }

  const generateBand = async (
    b: Band,
    p: PlanParams,
    w: Weather,
    rs: Restaurant[],
    lt: LastTrain
  ) => {
    setResults((r) => ({
      ...r,
      ...(b === 'controlled' && { controlled: null }),
      ...(b === 'declarative' && { declarative: null }),
      ...(b === 'open-ended' && { openEnded: null }),
      ...(b === 'dynamic' && { dynamicFrameUrl: null, dynamicCode: '' }),
      status: { ...r.status, [b]: 'streaming' },
    }))
    try {
      const res = await fetch('/api/band', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ band: b, params: p, weather: w, restaurants: rs, lastTrain: lt, model }),
      })
      if (!res.ok || !res.body) throw new Error(`band ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) if (l.trim()) onBandEvent(b, JSON.parse(l))
      }
      setResults((r) => ({
        ...r,
        status: { ...r.status, [b]: r.status[b] === 'error' ? 'error' : 'done' },
      }))
    } catch {
      setResults((r) => ({ ...r, status: { ...r.status, [b]: 'error' } }))
    }
  }

  const onBandEvent = (b: Band, ev: Record<string, unknown>) => {
    setResults((r) => {
      const s = { ...r }
      switch (ev.type) {
        case 'controlled':
          s.controlled = (ev.plan as Plan) ?? null
          if (ev.error) s.status = { ...s.status, controlled: 'error' }
          break
        case 'declarative-partial':
          s.declarative = ev.ui as DeclarativeUI
          break
        case 'declarative':
          s.declarative = (ev.ui as DeclarativeUI) ?? s.declarative
          if (ev.error) s.status = { ...s.status, declarative: 'error' }
          break
        case 'open-ended':
          s.openEnded = (ev.html as string) ?? null
          if (ev.error) s.status = { ...s.status, 'open-ended': 'error' }
          break
        case 'dynamic-delta':
          s.dynamicCode = s.dynamicCode + (ev.delta as string)
          break
        case 'dynamic-code':
          s.dynamicCode = (ev.code as string) ?? s.dynamicCode
          break
        case 'dynamic-frame':
          s.dynamicFrameUrl = ev.url as string
          break
        case 'dynamic':
          if (ev.error) s.status = { ...s.status, dynamic: 'error' }
          break
      }
      void b
      return s
    })
  }

  const switchBand = (b: Band) => {
    setBand(b)
    if (ready && params && results.status[b] === 'idle') {
      generateBand(b, params, weather, restaurants, lastTrain)
    }
  }

  const clear = () => {
    setConvo([])
    setParams(null)
    setWeather(null)
    setLastTrain(null)
    setRestaurants([])
    setResults(EMPTY_RESULTS)
    setError(null)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const h = historyRef.current
    if (e.key === 'ArrowUp') {
      if (h.length === 0) return
      e.preventDefault()
      const n = Math.min(historyIndex + 1, h.length - 1)
      setHistoryIndex(n)
      setInput(h[n] ?? '')
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < 0) return
      e.preventDefault()
      const n = historyIndex - 1
      setHistoryIndex(n)
      setInput(n < 0 ? '' : (h[n] ?? ''))
    }
  }

  return (
    <div className='chat'>
      <header className='chat__header'>
        <span className='chat__title'>飲み会アドバイザー 🍻</span>
        <div className='chat__header-right'>
          <ModelSelector value={model} onChange={setModel} />
          <Button type='button' variant='ghost' size='sm' onClick={clear} title='クリア'>
            Clear
          </Button>
          <span className='chat__status' data-status={intaking ? 'streaming' : 'ready'}>
            {intaking ? 'THINKING' : 'READY'}
          </span>
        </div>
      </header>

      <div className='compare' ref={compareRef}>
        {convo.length === 0 && (
          <div className='compare__empty'>
            <div className='compare__empty-icon'>🌃</div>
            <p>横浜の夜のプランを作ります。日付・エリア・人数・用途を一言で。</p>
            <div className='compare__samples'>
              {SAMPLES.map((q) => (
                <Button
                  key={q}
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => submit(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* intake の会話 (聞き返し) */}
        {convo.map((t, i) => (
          <div key={i} className='message' data-role={t.role === 'user' ? 'user' : 'assistant'}>
            <div className='message__role'>{t.role === 'user' ? 'あなた' : 'AI'}</div>
            <div className='message__body'>{t.text}</div>
          </div>
        ))}
        {intaking && (
          <div className='thinking-indicator'>
            <span className='thinking-indicator__dots'>
              <span />
              <span />
              <span />
            </span>
            <span className='thinking-indicator__label'>条件を整理中…</span>
          </div>
        )}

        {error && <div className='tool-error'>{error}</div>}

        {ready && params && (
          <>
            <div className='plan-head'>
              <div className='plan-cond'>
                <span className='plan-cond__chip'>📅 {params.dateLabel}</span>
                <span className='plan-cond__chip'>📍 {params.area}</span>
                <span className='plan-cond__chip'>👥 {params.partySize}人</span>
                <span className='plan-cond__chip'>🎯 {params.purpose}</span>
                {weather && (
                  <span className='plan-cond__chip'>
                    {weather.emoji} {weather.label} {weather.tempMax ?? '?'}℃ / 降水
                    {weather.precipProb ?? '?'}%
                  </span>
                )}
                {lastTrain && (
                  <span className='plan-cond__chip' title={`${lastTrain.station}: ${lastTrain.summary}`}>
                    🚃 終電 {lastTrain.leaveBy}に出る
                  </span>
                )}
              </div>

              <div className='seg seg--bands' role='tablist'>
                {BANDS.map((b) => (
                  <button
                    key={b.id}
                    type='button'
                    role='tab'
                    className='seg__item'
                    data-active={band === b.id}
                    onClick={() => switchBand(b.id)}
                  >
                    {b.label}
                    {results.status[b.id] === 'streaming' && <span className='seg__dot' />}
                  </button>
                ))}
              </div>
            </div>
            <p className='band-tabs__desc'>{BANDS.find((b) => b.id === band)?.desc}</p>

            <BandPanel band={band} results={results} restaurants={restaurants} />
          </>
        )}
      </div>

      <form
        className='chat__form'
        onSubmit={(e) => {
          e.preventDefault()
          submit(input)
        }}
      >
        <div className='chat__input-row'>
          <input
            type='text'
            className='chat__input'
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (historyIndex !== -1) setHistoryIndex(-1)
            }}
            onKeyDown={handleKeyDown}
            placeholder='例: 来週の金曜、関内で4人で接待'
            autoComplete='off'
            autoFocus
          />
          <Button type='submit' variant='primary' loading={intaking} disabled={!input.trim()}>
            送信
          </Button>
        </div>
      </form>
    </div>
  )
}

function BandPanel({
  band,
  results,
  restaurants,
}: {
  band: Band
  results: BandResults
  restaurants: Restaurant[]
}) {
  const status = results.status[band]
  let preview: React.ReactNode
  let script = ''
  let scriptLabel = ''

  if (band === 'controlled') {
    preview = results.controlled ? (
      <PlanView plan={results.controlled} restaurants={restaurants} />
    ) : (
      <Streaming label='プランを組み立て中…' />
    )
    script = results.controlled ? JSON.stringify(results.controlled, null, 2) : ''
    scriptLabel = '🧠 AI が埋めたプラン (JSON)'
  } else if (band === 'declarative') {
    preview = results.declarative ? (
      <DeclarativeView ui={results.declarative} />
    ) : (
      <Streaming label='UI ツリーを組み立て中…' />
    )
    script = results.declarative ? JSON.stringify(results.declarative, null, 2) : ''
    scriptLabel = '🧠 AI が組んだ UI ツリー (JSON · 順に埋まる)'
  } else if (band === 'open-ended') {
    preview =
      status === 'error' ? (
        <Failed />
      ) : results.openEnded ? (
        <OpenEndedView html={results.openEnded} />
      ) : (
        <Streaming label='HTML を生成中…' />
      )
    script = results.openEnded ?? ''
    scriptLabel = '🧠 AI が書いた HTML'
  } else {
    preview =
      status === 'error' ? (
        <Failed />
      ) : results.dynamicFrameUrl ? (
        <StreamFrame url={results.dynamicFrameUrl} />
      ) : (
        <Streaming label='AI がコードを書いています… → Worker で SSR' />
      )
    script = results.dynamicCode
    scriptLabel = '🧠 AI が書いた APP コンポーネント (TSX · 流れてくる)'
  }

  return (
    <div className='band-panel'>
      <div className='band-panel__preview'>{preview}</div>
      <details className='band-panel__script'>
        <summary>{scriptLabel}</summary>
        <pre>{script || '…'}</pre>
      </details>
    </div>
  )
}

function Streaming({ label }: { label: string }) {
  return (
    <div className='thinking-indicator'>
      <span className='thinking-indicator__dots'>
        <span />
        <span />
        <span />
      </span>
      <span className='thinking-indicator__label'>{label}</span>
    </div>
  )
}

function Failed() {
  return <div className='tool-error'>このバンドの生成に失敗しました (モデルを変えて再試行)</div>
}
