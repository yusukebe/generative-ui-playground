/**
 * Dynamic バンドの実装。
 *
 * LLM には **renderToString に渡す JSX 式だけ** を書かせる。
 * import / export / fetch / Response などのボイラープレートはこちら側で
 * 固定テンプレートとして包む。これにより:
 *   - LLM の出力が短くなり、tool 引数 JSON が途中で切れる事故が激減
 *   - react-dom/server.edge の取り違えなどの定型ミスも防げる
 *   - LLM は本質 (JSX で UI をどう組むか) だけに集中できる
 *
 * 包んだ Worker module を worker-bundler でバンドルし、env.LOADER で
 * spawn して fetch、SSR された HTML を返す (hono-eval パターン)。
 */
import { createWorker } from '@cloudflare/worker-bundler'
import { tool } from 'ai'
import { z } from 'zod'
import uiComponentsSource from '../ui-components.tsx?raw'
import { decodeUnicodeEscapes } from '../types'
import { SearchInputSchema, searchRestaurants } from './search-restaurants'

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
// JSX 内で使える変数・コンポーネント:
declare const restaurants: Restaurant[]   // 検索結果
declare const title: string               // ユーザの発話 (見出しにそのまま使う)
declare const RestaurantCard: React.FC<{ restaurant: Restaurant }>
declare const RestaurantList: React.FC<{ restaurants: Restaurant[] }>
`.trim()

const EXAMPLE_BORROW = `<div style={{ padding: 24, fontFamily: 'sans-serif' }}>
  <h1>{title}</h1>
  <RestaurantList restaurants={restaurants} />
</div>`

const EXAMPLE_RAW = `<div style={{ padding: 24, fontFamily: 'sans-serif' }}>
  <h1>{title}</h1>
  <div style={{ display: 'grid', gap: 12 }}>
    {restaurants.map((r) => (
      <article key={r.id} style={{ padding: 16, background: '#fff', border: '1px solid #dce0e8', borderRadius: 12 }}>
        <h3 style={{ margin: 0 }}>{r.name}</h3>
        <p style={{ color: '#6b7280', fontSize: 12 }}>{r.area} / {r.genre}</p>
        <p style={{ margin: 0 }}>{r.note}</p>
      </article>
    ))}
  </div>
</div>`

/** LLM が書いた JSX 式を、完全な Worker module に包む。title はホスト側で注入 */
function wrapModule(jsx: string, title: string): string {
  return `import React from 'react'
import { renderToString } from 'react-dom/server.edge'
import { RestaurantCard, RestaurantList } from './restaurant-ui'

const title = ${JSON.stringify(title)}

export default {
  async fetch(request: Request): Promise<Response> {
    const { restaurants } = (await request.json()) as { restaurants: unknown[] }
    const html = renderToString(
      ${jsx}
    )
    return new Response('<!doctype html>' + html, {
      headers: { 'content-type': 'text/html' },
    })
  },
}`
}

export const DynamicRenderInputSchema = z.object({
  search: SearchInputSchema.describe('D1 検索の引数。ホスト側で先に実行して結果を Worker に渡す'),
  jsx: z
    .string()
    .describe(
      'renderToString に渡す JSX 式だけ (例: <div>...</div>)。import / export / fetch などは書かない'
    ),
})

export type DynamicRenderInput = z.infer<typeof DynamicRenderInputSchema>

export function makeDynamicRenderTool(env: CloudflareBindings, title = '') {
  return tool({
    description: `Cloudflare Dynamic Worker 上で **React JSX を SSR** してユーザに UI を返すツール。

# 入力
- search: D1 検索の引数 ({ area?, genre?, atmosphere?, query? })。ホスト側で先に実行されます
- jsx: renderToString に渡す **JSX 式だけ**

# jsx の書き方 (重要)
- import / export / fetch / Response などは **書かないでください**。それらはシステムが自動で付けます
- あなたが書くのは renderToString に渡す **単一の JSX 式** (例: <div>...</div>) だけ
- 以下が JSX のスコープで使えます:
${RESTAURANT_UI_DTS}
- 店名・住所などは restaurants 配列の値を使い、コードに直接埋め込まないこと
- 日本語は見出しもユーザの発話をそのまま使い、創作・言い換えをしないこと

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
      // 1. host 側で search を実行
      const restaurants = await searchRestaurants(env.DB, input.search)

      // 2. JSX 式を Worker module に包む (日本語の \u エスケープはデコード)
      //    見出し用の title は LLM ではなくホスト側で注入 (日本語の化け防止)
      const jsx = decodeUnicodeEscapes(input.jsx)
      const moduleCode = wrapModule(jsx, title)
      const uiSource = uiComponentsSource.replace(
        /from\s+(['"])react-dom\/server\1/g,
        "from 'react-dom/server.edge'"
      )

      // 3. worker-bundler でバンドル (react / react-dom は npm registry から resolve)
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

      // 4. Dynamic Worker をスピンアップして fetch
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

      return {
        contentType,
        body,
        restaurants,
        // クライアント表示用に、LLM が書いた JSX を包んだ完全なコードを返す
        code: moduleCode,
      }
    },
  })
}
