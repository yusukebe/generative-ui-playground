/**
 * Dynamic パターンの実装。
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
import uiComponentsSource from '../ui-components.tsx?raw'
import dynamicRuntimeSource from './dynamic-runtime.tsx?raw'
import { decodeUnicodeEscapes } from '../types'

// ─────────────────────────────────────────────────────────────────
// Phase 2: Suspense ストリーミング SSR
//   renderToReadableStream + カードごとの Suspense 境界で、シェル → スケルトン →
//   カードが順に流れてくる "本物の SSR ストリーミング" を見せる。
//   AI が <RestaurantList> を借りた場合に、この streaming 版 List が効く。
// ─────────────────────────────────────────────────────────────────

/** worker 内で使う streaming 版 restaurant-ui (B-2)。
 *  こちらが渡すのは「表示部品」と「データ取得フック」だけ。
 *  Suspense 境界や per-item 取得の合成は **AI が書いたコンポーネント側で行う**。 */
// Dynamic Worker のランタイム (非同期フック + worker 用コンポーネント) は
// src/tools/dynamic-runtime.tsx に実ファイルとして定義し、?raw で読み込む。
// 先頭の `// @ts-nocheck` 行だけ除去して worker の src/restaurant-ui.tsx として埋め込む。
const STREAMING_UI_SOURCE = dynamicRuntimeSource.replace(/^\/\/ @ts-nocheck\n/, '')

const DOC_CSS = `body{margin:0;background:#f7f8fa;color:#1a1d26;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Hiragino Sans','Noto Sans JP',sans-serif}h1{font-size:20px}@keyframes rc-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`

/** APP コンポーネントを renderToReadableStream で SSR する Worker module に包む */
function wrapStreamingModule(component: string): string {
  return `import React, { Suspense } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'
import { RestaurantCard, RestaurantList, ShopList, CardSkeleton, WeatherSkeleton, Ramen, RamenList, Weather, LastTrain } from './restaurant-ui'

${component}

// AI が App / APP どちらの名前で書いても拾えるようにする (取り違えでフォールバックに落ちない)
const Root = (typeof App !== 'undefined' && App) || (typeof APP !== 'undefined' && APP)

export default {
  async fetch(request: Request): Promise<Response> {
    // お店(Places=要キー)だけホストが prop で渡す。天気/〆ラーメンは worker が描画時に取得する。
    const { restaurants } = (await request.json()) as { restaurants: unknown[] }
    const css = ${JSON.stringify(DOC_CSS)}
    let stream: ReadableStream
    try {
      stream = await renderToReadableStream(
        <html>
          <head><meta charSet="utf-8" /><style dangerouslySetInnerHTML={{ __html: css }} /></head>
          <body><div style={{ padding: 24 }}><Root restaurants={restaurants} /></div></body>
        </html>
      )
    } catch (e) {
      // AI のコードが落ちても: お店は即・天気/〆ラーメンは Suspense でフォールバック描画
      stream = await renderToReadableStream(
        <html>
          <head><meta charSet="utf-8" /><style dangerouslySetInnerHTML={{ __html: css }} /></head>
          <body><div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Suspense fallback={<WeatherSkeleton />}><Weather date={new Date().toISOString().slice(0,10)} /></Suspense>
            <RestaurantList restaurants={restaurants} />
            <Suspense fallback={<CardSkeleton />}><RamenList count={1} /></Suspense>
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
  restaurants: unknown[]
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
    // outbound 許可 (〆ラーメンの RamenCard が Ramen API を、Weather が Open-Meteo を per-item 取得するため)。
    globalOutbound: undefined,
  }))

  const response = await worker.getEntrypoint().fetch('http://internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restaurants }),
  })
  if (!response.body) throw new Error('Dynamic streaming SSR returned no body')
  return { stream: response.body, moduleCode }
}
