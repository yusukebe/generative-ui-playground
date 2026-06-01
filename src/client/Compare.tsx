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
  dynamicCode: string
  dynamicReady: boolean // code とお店データが揃いフレーム描画可能
  dynamicRestaurants: Restaurant[]
  status: Record<Band, Status>
  metrics: Partial<Record<Band, Metric>>
  ttfr: Partial<Record<Band, number>> // 初描画までの ms (最初の可視コンテンツ)
}

const EMPTY_RESULTS: BandResults = {
  controlled: null,
  declarative: null,
  openEnded: null,
  dynamicCode: '',
  dynamicReady: false,
  dynamicRestaurants: [],
  status: { controlled: 'idle', declarative: 'idle', 'open-ended': 'idle', dynamic: 'idle' },
  metrics: {},
  ttfr: {},
}

const BANDS: { id: Band; label: string; desc: string }[] = [
  { id: 'controlled', label: 'Controlled', desc: '既製プランテンプレに AI が値を流し込む' },
  { id: 'declarative', label: 'Declarative', desc: '部品(天気/終電/店)を選んで JSON で並べ streamObject で順に組む' },
  { id: 'open-ended', label: 'Open-Ended', desc: 'AI が HTML でプラン1枚をフル生成' },
  { id: 'dynamic', label: 'Dynamic ✨', desc: 'AI が React を書き Worker が Suspense SSR' },
]

// prepare のツール名 → 表示ラベル (エージェントが何を呼んだか見せる)
const TOOL_LABELS: Record<string, string> = {
  get_weather: '🌤️ 天気を取得',
  get_last_train: '🚃 終電を取得',
  search_restaurants: '🍶 お店を検索',
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
  // モデル選択は localStorage に記憶 (次回も同じモデルで開く)
  const [model, setModel] = useState<ModelId>(() => {
    try {
      return (localStorage.getItem('giup-model') as ModelId) || DEFAULT_MODEL
    } catch {
      return DEFAULT_MODEL
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('giup-model', model)
    } catch {
      // localStorage 不可の環境では無視
    }
  }, [model])
  const [input, setInput] = useState('')
  const [convo, setConvo] = useState<Turn[]>([])
  const [intaking, setIntaking] = useState(false)
  const [params, setParams] = useState<PlanParams | null>(null)
  const [weather, setWeather] = useState<Weather>(null)
  const [lastTrain, setLastTrain] = useState<LastTrain>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [results, setResults] = useState<BandResults>(EMPTY_RESULTS)
  const [band, setBand] = useState<Band>('controlled')
  const [toolCalls, setToolCalls] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const compareRef = useRef<HTMLDivElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [chatWidth, setChatWidth] = useState(340)
  const genStartRef = useRef<Partial<Record<Band, number>>>({})

  // 中央のリサイザー: ドラッグでチャット(左)幅を調整
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      const box = bodyRef.current
      if (!box) return
      const w = ev.clientX - box.getBoundingClientRect().left
      setChatWidth(Math.max(240, Math.min(w, box.clientWidth - 360)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const ready = !!params

  // チャット側: 会話が増えたら最下部へ
  useEffect(() => {
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [convo, intaking])

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
        // 条件確定 → プランヘッダを即表示。表示中バンドが「ツール収集→描画」を毎回実行する
        setParams(data.params)
        setResults(EMPTY_RESULTS)
        generateBand(band, data.params)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラー')
    } finally {
      setIntaking(false)
    }
  }

  // 1バンド = 「ツールでデータ収集 → 描画」を毎回まとめて実行する。
  // ストリームは tool/weather/lasttrain/izakaya/ramen(収集) → render-start → バンド描画 + metrics。
  const generateBand = async (b: Band, p: PlanParams) => {
    genStartRef.current[b] = Date.now() // 初描画は「生成開始(=ツール収集含む)」から測る
    setToolCalls([])
    setWeather(null)
    setLastTrain(null)
    setRestaurants([])
    setResults((r) => ({
      ...r,
      ...(b === 'controlled' && { controlled: null }),
      ...(b === 'declarative' && { declarative: null }),
      ...(b === 'open-ended' && { openEnded: null }),
      ...(b === 'dynamic' && { dynamicCode: '', dynamicReady: false, dynamicRestaurants: [] }),
      status: { ...r.status, [b]: 'streaming' },
      ttfr: { ...r.ttfr, [b]: undefined },
    }))
    let izakaya: Restaurant[] = []
    let ramen: Restaurant[] = []
    try {
      const res = await fetch('/api/band', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ band: b, params: p, model }),
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
            case 'render-start':
              break // 初描画は生成開始から測るのでここでは何もしない
            default:
              onBandEvent(b, ev)
          }
        }
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
      // 最初の可視コンテンツが出た時刻を記録 (初描画 TTFR)
      const markFirst = () => {
        const t0 = genStartRef.current[b]
        if (t0 && s.ttfr[b] === undefined) s.ttfr = { ...s.ttfr, [b]: Date.now() - t0 }
      }
      switch (ev.type) {
        case 'controlled':
          s.controlled = (ev.plan as Plan) ?? null
          if (ev.error) s.status = { ...s.status, controlled: 'error' }
          else markFirst()
          break
        case 'declarative-partial':
          s.declarative = ev.ui as DeclarativeUI
          markFirst()
          break
        case 'declarative':
          s.declarative = (ev.ui as DeclarativeUI) ?? s.declarative
          if (ev.error) s.status = { ...s.status, declarative: 'error' }
          break
        case 'open-ended':
          s.openEnded = (ev.html as string) ?? null
          if (ev.error) s.status = { ...s.status, 'open-ended': 'error' }
          else markFirst()
          break
        case 'dynamic-delta':
          s.dynamicCode = s.dynamicCode + (ev.delta as string)
          break
        case 'dynamic-code':
          s.dynamicCode = (ev.code as string) ?? s.dynamicCode
          break
        case 'dynamic-ready':
          // code とお店データが揃った → フレーム(StreamFrame)を描画
          s.dynamicCode = (ev.code as string) ?? s.dynamicCode
          s.dynamicRestaurants = (ev.restaurants as Restaurant[]) ?? []
          s.dynamicReady = true
          markFirst()
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

  // バンドを切り替えたら、まだ生成していなければそのバンドを生成 (毎回ツール収集→描画)
  const switchBand = (b: Band) => {
    setBand(b)
    if (params && results.status[b] === 'idle') generateBand(b, params)
  }

  const clear = () => {
    setConvo([])
    setParams(null)
    setWeather(null)
    setLastTrain(null)
    setRestaurants([])
    setResults(EMPTY_RESULTS)
    setToolCalls([])
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

  // 「プラン作成」コスト = 収集(ツール) + 生成 の合計 (バックエンドが合算済み)
  const activeMetric = results.metrics[band]

  return (
    <div className='advisor'>
      <header className='advisor__header'>
        <span className='chat__title'>ご飯アドバイザー 🍻</span>
        <div className='chat__header-right'>
          <ModelSelector value={model} onChange={setModel} />
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => (window.location.href = '/gallery')}
            title='共有コンポーネント一覧'
          >
            🧩 部品
          </Button>
          <Button type='button' variant='ghost' size='sm' onClick={clear} title='クリア'>
            Clear
          </Button>
          <span className='chat__status' data-status={intaking ? 'streaming' : 'ready'}>
            {intaking ? 'THINKING' : 'READY'}
          </span>
        </div>
      </header>

      <div className='advisor__body' ref={bodyRef}>
        {/* 左: チャット (条件のやりとり) */}
        <aside className='advisor__chat' style={{ width: chatWidth }}>
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

        {/* ドラッグで左右の幅を調整 */}
        <div
          className='advisor__resizer'
          onMouseDown={startResize}
          role='separator'
          aria-orientation='vertical'
          title='ドラッグで幅を調整'
        />

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

              {band === 'dynamic' && (
                <div className='tool-activity'>
                  <span className='tool-activity__title'>
                    🧩 Code Mode: 事前ツール収集はしない。AI はコンポーネントを組むだけで、
                    天気・〆ラーメンは<strong>描画時にコンポーネントが Suspense で取得</strong>する
                  </span>
                </div>
              )}

              {band !== 'dynamic' && toolCalls.length > 0 && (
                <div className='tool-activity' data-running={results.status[band] === 'streaming'}>
                  <div className='tool-activity__head'>
                    <span className='tool-activity__title'>
                      {results.status[band] === 'streaming'
                        ? '🤖 このバンドがツールでデータ収集 → 描画中…'
                        : '🤖 このバンドが収集に使ったツール (毎回実行)'}
                    </span>
                  </div>
                  <div className='tool-activity__list'>
                    {toolCalls.map((name, i) => (
                      <span key={i} className='tool-activity__chip'>
                        {TOOL_LABELS[name] ?? name}
                      </span>
                    ))}
                    {results.status[band] === 'streaming' && (
                      <span className='tool-activity__chip tool-activity__chip--pending'>…</span>
                    )}
                  </div>
                </div>
              )}

              <div className='band-tabs__meta'>
                <p className='band-tabs__desc'>
                  {BANDS.find((b) => b.id === band)?.desc}
                  <button
                    type='button'
                    className='band-reload'
                    title='このバンドをもう一度生成 (ツール収集→描画)'
                    disabled={results.status[band] === 'streaming'}
                    onClick={() => params && generateBand(band, params)}
                  >
                    ↻ リロード
                  </button>
                </p>
                <span className='band-metric-row'>
                  {results.ttfr[band] !== undefined && (
                    <span
                      className='band-metric band-metric--ttfr'
                      title='初描画: 生成開始(ツール収集を含む)から最初の可視コンテンツが出るまで'
                    >
                      初描画 {((results.ttfr[band] as number) / 1000).toFixed(1)}s
                    </span>
                  )}
                  {activeMetric && (
                    <span
                      className='band-metric'
                      title='プラン作成の合計コスト = データ収集(ツール) + このバンドの生成。時間 / トークン / 生成文字数'
                    >
                      プラン作成 {(activeMetric.ms / 1000).toFixed(1)}s · {activeMetric.tokens}tok ·{' '}
                      {activeMetric.chars.toLocaleString()}字
                    </span>
                  )}
                </span>
              </div>

              <BandPanel
                band={band}
                results={results}
                restaurants={restaurants}
                weather={weather}
                lastTrain={lastTrain}
              />
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
  weather,
  lastTrain,
}: {
  band: Band
  results: BandResults
  restaurants: Restaurant[]
  weather: Weather
  lastTrain: LastTrain
}) {
  const status = results.status[band]
  let preview: React.ReactNode
  let script = ''
  let scriptLabel = ''

  if (band === 'controlled') {
    preview = results.controlled ? (
      <PlanView
        plan={results.controlled}
        restaurants={restaurants}
        weather={weather}
        lastTrain={lastTrain}
      />
    ) : (
      <Streaming label='プランを組み立て中…' />
    )
    script = results.controlled ? JSON.stringify(results.controlled, null, 2) : ''
    scriptLabel = 'AI が埋めたのは title と steps だけ (天気/終電/店は固定コンポーネント+データ)'
  } else if (band === 'declarative') {
    preview = results.declarative ? (
      <DeclarativeView
        ui={results.declarative}
        restaurants={restaurants}
        weather={weather}
        lastTrain={lastTrain}
      />
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
      ) : results.dynamicReady ? (
        <StreamFrame code={results.dynamicCode} restaurants={results.dynamicRestaurants} />
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
