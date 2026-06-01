/**
 * Dynamic バンドの実装。
 *
 * LLM には **`function APP({ restaurants }) { return <jsx> }` というコンポーネント
 * 関数だけ** を書かせる。import / export / fetch / Response などのボイラープレートは
 * こちら側で固定テンプレートとして包む。これにより:
 *   - LLM の出力が短くなり、tool 引数 JSON が途中で切れる事故が激減
 *   - react-dom/server.edge の取り違えなどの定型ミスも防げる
 *   - LLM は本質 (コンポーネントをどう組むか) だけに集中できる
 *   - 「LLM がコンポーネントを書く」という自然な React のメンタルモデルに一致
 *
 * 包んだ Worker module を worker-bundler でバンドルし、env.LOADER で
 * spawn して fetch、SSR された HTML を返す (hono-eval パターン)。
 */
import { createWorker } from '@cloudflare/worker-bundler'
import { tool } from 'ai'
import { z } from 'zod'
import uiComponentsSource from '../ui-components.tsx?raw'
import { decodeUnicodeEscapes } from '../types'
import { findRestaurants, SearchInputSchema } from './search-restaurants'

const RESTAURANT_UI_DTS = `
type Restaurant = {
  id: string
  name: string
  area: string
  genre: string
  tags: string[]
  note: string | null
  atmosphere: string | null
  price_range: string | null
  address: string | null
}
// コンポーネント内で使えるもの:
//   props.restaurants : Restaurant[]   検索結果 (host が渡す)
declare const RestaurantCard: React.FC<{ restaurant: Restaurant }>
declare const RestaurantList: React.FC<{ restaurants: Restaurant[] }>
`.trim()

const EXAMPLE_BORROW = `function APP({ restaurants }) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>中華街の点心のお店</h1>
      <RestaurantList restaurants={restaurants} />
    </div>
  )
}`

const EXAMPLE_RAW = `function APP({ restaurants }) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>中華街の点心のお店</h1>
      <div style={{ display: 'grid', gap: 12 }}>
        {restaurants.map((r) => (
          <article key={r.id} style={{ padding: 16, background: '#fff', border: '1px solid #dce0e8', borderRadius: 12 }}>
            <h3 style={{ margin: 0 }}>{r.name}</h3>
            <p style={{ color: '#6b7280', fontSize: 12 }}>{r.area} / {r.genre}</p>
            <p style={{ margin: 0 }}>{r.note}</p>
          </article>
        ))}
      </div>
    </div>
  )
}`

/** LLM が書いた APP コンポーネントを、完全な Worker module に包む */
function wrapModule(component: string): string {
  return `import React from 'react'
import { renderToString } from 'react-dom/server.edge'
import { RestaurantCard, RestaurantList } from './restaurant-ui'

${component}

export default {
  async fetch(request: Request): Promise<Response> {
    const { restaurants } = (await request.json()) as { restaurants: unknown[] }
    // AI が書いたコードが SSR で落ちても Worker 全体を巻き込まず、既製の一覧へフォールバック
    let html: string
    try {
      html = renderToString(<APP restaurants={restaurants} />)
    } catch (e) {
      html =
        '<p style="padding:12px;color:#b91c1c;font-size:13px">⚠️ Agent のコードが描画に失敗したため一覧表示にフォールバックしました</p>' +
        renderToString(<RestaurantList restaurants={restaurants} />)
    }
    return new Response('<!doctype html>' + html, {
      headers: { 'content-type': 'text/html' },
    })
  },
}`
}

export const DynamicRenderInputSchema = z.object({
  search: SearchInputSchema.describe('D1 検索の引数。ホスト側で先に実行して結果を Worker に渡す'),
  code: z
    .string()
    .describe(
      'function APP({ restaurants }) { return <jsx> } というコンポーネント関数だけ。import / export / fetch などは書かない'
    ),
})

export type DynamicRenderInput = z.infer<typeof DynamicRenderInputSchema>

export function makeDynamicRenderTool(env: CloudflareBindings) {
  return tool({
    description: `Cloudflare Dynamic Worker 上で **React コンポーネントを SSR** してユーザに UI を返すツール。

# 入力
- search: D1/Places 検索の引数 ({ area?, genre?, atmosphere?, query? })。ホスト側で先に実行されます
- code: \`function APP({ restaurants }) { return <jsx> }\` という **コンポーネント関数だけ**

# code の書き方 (重要)
- 必ず \`APP\` という名前の関数コンポーネントを 1 つだけ書く。引数は { restaurants }
- import / export / fetch / Response などは **書かないでください**。それらはシステムが自動で付けます
  (host が <APP restaurants={...} /> を renderToString します)
- props と スコープで使えるもの:
${RESTAURANT_UI_DTS}
- 店名・住所などは restaurants 配列の値を使い、コードに直接埋め込まないこと

# スペクトラム (どこまで自分で書くかは自由)

## 例 A: コンポーネント借用 (シンプル、≒ Controlled 寄り)
\`\`\`jsx
${EXAMPLE_BORROW}
\`\`\`

## 例 B: 自分で raw に書く (≒ Open-Ended 寄り)
\`\`\`jsx
${EXAMPLE_RAW}
\`\`\`

借用と自前 raw のミックスもできます。要件に応じて選んでください。`,
    inputSchema: DynamicRenderInputSchema,
    execute: async (input) => {
      // 1. host 側で search を実行 (Places 優先、無ければ D1)
      const restaurants = await findRestaurants(env, input.search)
      // 2. APP コンポーネントを Worker module に包んでバンドル → spawn → SSR
      const { body, contentType, moduleCode } = await renderDynamicComponent(
        env,
        input.code,
        restaurants
      )
      return {
        contentType,
        body,
        restaurants,
        // クライアント表示用に、LLM が書いた APP を包んだ完全なコードを返す
        code: moduleCode,
      }
    },
  })
}

/**
 * LLM が書いた APP コンポーネントを Worker module に包み、worker-bundler で
 * バンドル → env.LOADER で spawn → fetch して SSR 結果 (HTML) を返す。
 * tool / compare の双方から呼べる純関数。
 */
export async function renderDynamicComponent(
  env: CloudflareBindings,
  componentCode: string,
  restaurants: unknown[]
): Promise<{ body: string; contentType: string; moduleCode: string }> {
  // 日本語の \u エスケープはデコード
  const component = decodeUnicodeEscapes(componentCode)
  const moduleCode = wrapModule(component)
  const uiSource = uiComponentsSource.replace(
    /from\s+(['"])react-dom\/server\1/g,
    "from 'react-dom/server.edge'"
  )

  // worker-bundler でバンドル (react / react-dom は npm registry から resolve)
  const { mainModule, modules } = await createWorker({
    files: {
      'src/index.tsx': moduleCode,
      'src/restaurant-ui.tsx': uiSource,
      'package.json': JSON.stringify({
        dependencies: {
          react: '^19.2.6',
          'react-dom': '^19.2.6',
        },
      }),
    },
    entryPoint: 'src/index.tsx',
    bundle: true,
    jsx: 'automatic',
    jsxImportSource: 'react',
    conditions: ['workerd', 'worker', 'edge-light', 'browser', 'default'],
  })

  // Dynamic Worker をスピンアップして fetch
  const worker = env.LOADER.get(crypto.randomUUID(), async () => ({
    mainModule,
    modules,
    compatibilityDate: '2025-08-03',
    compatibilityFlags: ['nodejs_compat'],
    globalOutbound: null,
  }))

  const response = await worker.getEntrypoint().fetch('http://internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restaurants }),
  })
  const body = await response.text()
  const contentType = response.headers.get('content-type') ?? 'text/html'
  return { body, contentType, moduleCode }
}

// ─────────────────────────────────────────────────────────────────
// Phase 2: Suspense ストリーミング SSR
//   renderToReadableStream + カードごとの Suspense 境界で、シェル → スケルトン →
//   カードが順に流れてくる "本物の SSR ストリーミング" を見せる。
//   AI が <RestaurantList> を借りた場合に、この streaming 版 List が効く。
// ─────────────────────────────────────────────────────────────────

/** worker 内で使う streaming 版 restaurant-ui (B-2)。
 *  こちらが渡すのは「表示部品」と「データ取得フック」だけ。
 *  Suspense 境界や per-item 取得の合成は **AI が書いたコンポーネント側で行う**。 */
const STREAMING_UI_SOURCE = `import React from 'react'
import { RestaurantCard } from './base-ui'
export { RestaurantCard } from './base-ui'

// 1レンダー内で同じ fetch を使い回すキャッシュ (worker はリクエストごとに新規 spawn なので OK)
const _cache = new Map()

// 〆ラーメンを Ramen API から取得して suspend するフック。<Suspense> の中で呼ぶ。
// id は 'ramen:xxx' でも 'xxx' でも可。取得後は restaurant 形のオブジェクトを返す。
export function useRamenShop(id) {
  const shopId = String(id).replace('ramen:', '')
  let e = _cache.get(shopId)
  if (!e) {
    e = { done: false, data: null }
    e.promise = fetch('https://ramen-api.dev/shops/' + shopId)
      .then((r) => r.json())
      .then((d) => {
        const s = d && d.shop
        e.data = s
          ? { id: 'ramen:' + s.id, name: s.name, area: '横浜', genre: '家系ラーメン',
              tags: ['家系', '〆'], note: '飲んだあとの〆の一杯に', address: null,
              price_range: '¥', atmosphere: null,
              photo_url: (s.photos && s.photos[0] && s.photos[0].url) || null }
          : null
      })
      .catch(() => { e.data = null })
      .finally(() => { e.done = true })
    _cache.set(shopId, e)
  }
  if (!e.done) throw e.promise
  return e.data
}

// ローディング用スケルトン
export function CardSkeleton() {
  return <div style={{
    height: 168, borderRadius: 12, border: '1px solid #dce0e8',
    background: 'linear-gradient(90deg, #eef0f4 25%, #ffffff 50%, #eef0f4 75%)',
    backgroundSize: '200% 100%', animation: 'rc-shimmer 1.2s infinite',
  }} />
}

// 〆ラーメンの葉 (居酒屋カードとは別UI・ラーメン専用)。id を渡すと useRamenShop で
// per-item 取得して描画。<Suspense> の中で使う。さらに凝るなら useRamenShop で自作も可。
export function Ramen({ id }) {
  const r = useRamenShop(id)
  if (!r) return null
  return (
    <div style={{ border: '2px solid #f97316', borderRadius: 14, overflow: 'hidden', background: '#fff7ed' }}>
      {r.photo_url && (
        <img src={r.photo_url} alt={r.name} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f97316', letterSpacing: '0.05em' }}>🍜 〆の一杯</div>
        <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700 }}>{r.name}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>{r.area} · 家系ラーメン</p>
      </div>
    </div>
  )
}

// 手元データの一覧 (fetch も Suspense もしない・即描画)
export function RestaurantList({ restaurants }) {
  const list = (restaurants || []).filter(Boolean)
  if (list.length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 13, padding: 12 }}>該当するお店が見つかりませんでした。</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
      {list.map((r) => <RestaurantCard key={r.id} restaurant={r} />)}
    </div>
  )
}
`

const DOC_CSS = `body{margin:0;background:#f7f8fa;color:#1a1d26;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Hiragino Sans','Noto Sans JP',sans-serif}h1{font-size:20px}@keyframes rc-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`

/** APP コンポーネントを renderToReadableStream で SSR する Worker module に包む */
function wrapStreamingModule(component: string): string {
  return `import React, { Suspense } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'
import { RestaurantCard, RestaurantList, useRamenShop, CardSkeleton, Ramen } from './restaurant-ui'

${component}

export default {
  async fetch(request: Request): Promise<Response> {
    const { restaurants, ramens } = (await request.json()) as { restaurants: unknown[]; ramens: any[] }
    const css = ${JSON.stringify(DOC_CSS)}
    let stream: ReadableStream
    try {
      stream = await renderToReadableStream(
        <html>
          <head><meta charSet="utf-8" /><style dangerouslySetInnerHTML={{ __html: css }} /></head>
          <body><div style={{ padding: 24 }}><APP restaurants={restaurants} ramens={ramens} /></div></body>
        </html>
      )
    } catch (e) {
      // AI のコードが落ちても: 居酒屋は即・〆ラーメンは Suspense でフォールバック描画
      stream = await renderToReadableStream(
        <html>
          <head><meta charSet="utf-8" /><style dangerouslySetInnerHTML={{ __html: css }} /></head>
          <body><div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <RestaurantList restaurants={restaurants} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12 }}>
              {(ramens || []).map((r) => (
                <Suspense key={r.id} fallback={<CardSkeleton />}><Ramen id={r.id} /></Suspense>
              ))}
            </div>
          </div></body>
        </html>
      )
    }
    return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
}`
}

/**
 * AI の APP コンポーネントを renderToReadableStream で **ストリーミング SSR** する。
 * worker の Response body (ReadableStream) をそのまま返すので、呼び出し側でチャンクを
 * 逐次転送できる。
 */
export async function renderDynamicComponentStream(
  env: CloudflareBindings,
  componentCode: string,
  restaurants: unknown[],
  ramens: unknown[] = []
): Promise<{ stream: ReadableStream<Uint8Array>; moduleCode: string }> {
  const component = decodeUnicodeEscapes(componentCode)
  const moduleCode = wrapStreamingModule(component)
  const baseSource = uiComponentsSource.replace(
    /from\s+(['"])react-dom\/server\1/g,
    "from 'react-dom/server.edge'"
  )

  const { mainModule, modules } = await createWorker({
    files: {
      'src/index.tsx': moduleCode,
      'src/restaurant-ui.tsx': STREAMING_UI_SOURCE,
      'src/base-ui.tsx': baseSource,
      'package.json': JSON.stringify({
        dependencies: { react: '^19.2.6', 'react-dom': '^19.2.6' },
      }),
    },
    entryPoint: 'src/index.tsx',
    bundle: true,
    jsx: 'automatic',
    jsxImportSource: 'react',
    conditions: ['workerd', 'worker', 'edge-light', 'browser', 'default'],
  })

  const worker = env.LOADER.get(crypto.randomUUID(), async () => ({
    mainModule,
    modules,
    compatibilityDate: '2025-08-03',
    compatibilityFlags: ['nodejs_compat'],
    // streaming 版だけ outbound 許可 (〆ラーメンの RamenCard が Ramen API を per-item 取得するため)。
    // ユーザ承諾済み。非ストリーミング版 (renderDynamicComponent) は null のまま遮断。
    globalOutbound: undefined,
  }))

  const response = await worker.getEntrypoint().fetch('http://internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restaurants, ramens }),
  })
  if (!response.body) throw new Error('Dynamic streaming SSR returned no body')
  return { stream: response.body, moduleCode }
}
