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

type Metric = { ms: number; tokens: number; chars: number }
type BandResults = {
  controlled: Plan | null
  declarative: DeclarativeUI | null
  openEnded: string | null
  dynamicFrameUrl: string | null
  dynamicCode: string
  status: Record<Band, Status>
  metrics: Partial<Record<Band, Metric>>
}

const EMPTY_RESULTS: BandResults = {
  controlled: null,
  declarative: null,
  openEnded: null,
  dynamicFrameUrl: null,
  dynamicCode: '',
  status: { controlled: 'idle', declarative: 'idle', 'open-ended': 'idle', dynamic: 'idle' },
  metrics: {},
}

const BANDS: { id: Band; label: string; desc: string }[] = [
  { id: 'controlled', label: 'Controlled', desc: '既製プランテンプレに AI が値を流し込む' },
  { id: 'declarative', label: 'Declarative', desc: 'section(1軒目/2軒目/〆) を streamObject で順に組む' },
  { id: 'open-ended', label: 'Open-Ended', desc: 'AI が HTML でプラン1枚をフル生成' },
  { id: 'dynamic', label: 'Dynamic ✨', desc: 'AI が React を書き Worker が Suspense SSR' },
]

// prepare のツール名 → 表示ラベル (エージェントが何を呼んだか見せる)
const TOOL_LABELS: Record<string, string> = {
  get_weather: '🌤️ 天気を取得',
  get_last_train: '🚃 終電を取得',
  search_restaurants: '🍶 居酒屋を検索',
  get_ramen: '🍜 〆ラーメンを取得',
}

// デモで詰まらないよう、日付・エリア・人数が揃った「一発で通る」例にしておく
const SAMPLES = [
  '関内で今日、一人で飲みたい',
  '来週の金曜、関内で4人で接待',
  '今週末 野毛で2人デート',
  'みなとみらいで明日、3人で女子会',
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
  const [preparing, setPreparing] = useState(false)
  const [toolCalls, setToolCalls] = useState<string[]>([])
  const [prepareMetric, setPrepareMetric] = useState<{ ms: number; tokens: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const compareRef = useRef<HTMLDivElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)

  const ready = !!params

  // チャット側: 会話が増えたら最下部へ
  useEffect(() => {
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [convo, intaking])

  // データ収集 (prepare) が終わったら、表示中バンドがまだ idle なら生成を起動
  useEffect(() => {
    if (preparing || !params || restaurants.length === 0) return
    if (results.status[band] === 'idle') {
      generateBand(band, params, weather, restaurants, lastTrain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing, band, restaurants.length])

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
        | { ready: true; params: PlanParams }

      if (!data.ready) {
        setConvo([...nextConvo, { role: 'assistant', text: data.question }])
      } else {
        // 条件確定 → プランヘッダを即表示。データは prepare がツール経由で非同期に集める
        setParams(data.params)
        setWeather(null)
        setLastTrain(null)
        setRestaurants([])
        setResults(EMPTY_RESULTS)
        prepare(data.params)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラー')
    } finally {
      setIntaking(false)
    }
  }

  // エージェントがツールでデータを集める prepare ストリームを購読し、解決順にチップ/候補を埋める。
  // プラン生成 (generateBand) は preparing が終わったら下の effect が起動する。
  const prepare = async (p: PlanParams) => {
    setPreparing(true)
    setToolCalls([])
    setPrepareMetric(null)
    let izakaya: Restaurant[] = []
    let ramen: Restaurant[] = []
    try {
      const res = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: p, model }),
      })
      if (!res.ok || !res.body) throw new Error(`prepare ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) {
          if (!l.trim()) continue
          const ev = JSON.parse(l) as Record<string, unknown>
          switch (ev.type) {
            case 'tool':
              setToolCalls((t) => [...t, ev.name as string])
              break
            case 'weather':
              setWeather((ev.weather as Weather) ?? null)
              break
            case 'lasttrain':
              setLastTrain((ev.lastTrain as LastTrain) ?? null)
              break
            case 'izakaya':
              izakaya = (ev.restaurants as Restaurant[]) ?? []
              setRestaurants([...izakaya, ...ramen])
              break
            case 'ramen':
              ramen = (ev.restaurants as Restaurant[]) ?? []
              setRestaurants([...izakaya, ...ramen])
              break
            case 'prepare-metrics':
              setPrepareMetric({ ms: ev.ms as number, tokens: ev.tokens as number })
              break
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'prepare エラー')
    } finally {
      setPreparing(false)
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
        case 'metrics':
          s.metrics = {
            ...s.metrics,
            [b]: { ms: ev.ms as number, tokens: ev.tokens as number, chars: ev.chars as number },
          }
          break
      }
      void b
      return s
    })
  }

  // バンド切替は表示の切替だけ。未生成なら上の effect が生成を起動する
  const switchBand = (b: Band) => setBand(b)

  const clear = () => {
    setConvo([])
    setParams(null)
    setWeather(null)
    setLastTrain(null)
    setRestaurants([])
    setResults(EMPTY_RESULTS)
    setPreparing(false)
    setToolCalls([])
    setPrepareMetric(null)
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

  const activeMetric = results.metrics[band]

  return (
    <div className='advisor'>
      <header className='advisor__header'>
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

      <div className='advisor__body'>
        {/* 左: チャット (条件のやりとり) */}
        <aside className='advisor__chat'>
          <div className='advisor__log' ref={chatLogRef}>
            {convo.length === 0 && (
              <div className='advisor__intro'>
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
        </aside>

        {/* 右: プラン (主役) */}
        <main className='advisor__plan' ref={compareRef}>
          {!(ready && params) ? (
            <div className='advisor__plan-empty'>
              <div className='compare__empty-icon'>🍻</div>
              <p>左のチャットで条件を伝えると、ここに同じプランを 4 パターンで描き分けます。</p>
            </div>
          ) : (
            <>
              <div className='plan-head'>
                {/* 条件は intake で確定したものだけ。天気・終電はツールで集めてプラン本文に出す */}
                <div className='plan-cond'>
                  <span className='plan-cond__chip'>📅 {params.dateLabel}</span>
                  <span className='plan-cond__chip'>📍 {params.area}</span>
                  <span className='plan-cond__chip'>👥 {params.partySize}人</span>
                  <span className='plan-cond__chip'>🎯 {params.purpose}</span>
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

              {(preparing || toolCalls.length > 0) && (
                <div className='tool-activity' data-running={preparing}>
                  <div className='tool-activity__head'>
                    <span className='tool-activity__title'>
                      {preparing ? '🤖 エージェントがツールでデータ収集中…' : '🤖 収集に使ったツール'}
                    </span>
                    {prepareMetric && (
                      <span
                        className='band-metric'
                        title='データ収集(ツール呼び出し)のコスト。1クエリ1回・全バンド共通の前段コスト'
                      >
                        共通 ⏱ {(prepareMetric.ms / 1000).toFixed(1)}s · 🔢 {prepareMetric.tokens} tok
                      </span>
                    )}
                  </div>
                  <div className='tool-activity__list'>
                    {toolCalls.map((name, i) => (
                      <span key={i} className='tool-activity__chip'>
                        {TOOL_LABELS[name] ?? name}
                      </span>
                    ))}
                    {preparing && <span className='tool-activity__chip tool-activity__chip--pending'>…</span>}
                  </div>
                </div>
              )}

              <div className='band-tabs__meta'>
                <p className='band-tabs__desc'>{BANDS.find((b) => b.id === band)?.desc}</p>
                {activeMetric && (
                  <span
                    className='band-metric'
                    title='このバンドの「生成」コスト (データ収集は上の共通コスト)。AIが描画を吐くのにかかった時間 / 出力トークン / 出力文字数'
                  >
                    生成 ⏱ {(activeMetric.ms / 1000).toFixed(1)}s · 🔢 {activeMetric.tokens} tok · 📝{' '}
                    {activeMetric.chars.toLocaleString()} chars
                  </span>
                )}
              </div>

              <BandPanel band={band} results={results} restaurants={restaurants} />
            </>
          )}
        </main>
      </div>
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
      <DeclarativeView ui={results.declarative} restaurants={restaurants} />
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
