/**
 * Dynamic バンドの実装。
 *
 * LLM が完全な Cloudflare Worker module (TSX) を書き、
 *   - worker-bundler で React / react-dom を npm 解決して bundle
 *   - env.LOADER.get() でサンドボックスを spawn
 *   - worker.getEntrypoint().fetch() でリクエスト実行
 *
 * ホスト側は事前に search_restaurants を実行して結果を request.json で
 * Worker に渡す。Worker は restaurants を受け取って JSX で SSR し、
 * `text/html` の Response を返す。
 *
 * これが「LLM が書く SSR」のクライマックス実装。
 */
import { createWorker } from '@cloudflare/worker-bundler'
import { tool } from 'ai'
import { z } from 'zod'
import uiComponentsSource from '../ui-components.tsx?raw'
import { SearchInputSchema, searchRestaurants } from './search-restaurants'

const RESTAURANT_UI_DTS = `
// './restaurant-ui' で利用可能な型 (LLM 向け参考)
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
declare const RestaurantCard: React.FC<{ restaurant: Restaurant }>
declare const RestaurantList: React.FC<{ restaurants: Restaurant[] }>
`.trim()

const TEMPLATE_BORROWED = `import React from 'react'
import { renderToString } from 'react-dom/server.edge'
import { RestaurantList } from './restaurant-ui'

export default {
  async fetch(request) {
    const { restaurants } = await request.json()
    const html = renderToString(
      <div style={{ background: '#f7f8fa', color: '#1a1d26', padding: 24, minHeight: '100vh' }}>
        <h1>関内のおすすめ</h1>
        <RestaurantList restaurants={restaurants} />
      </div>
    )
    return new Response('<!doctype html>' + html, {
      headers: { 'content-type': 'text/html' },
    })
  },
}`

const TEMPLATE_RAW = `import React from 'react'
import { renderToString } from 'react-dom/server.edge'

export default {
  async fetch(request) {
    const { restaurants } = await request.json()
    const html = renderToString(
      <div style={{ background: '#f7f8fa', color: '#1a1d26', padding: 24 }}>
        <h1>関内のおすすめ</h1>
        <div style={{ display: 'grid', gap: 12 }}>
          {restaurants.map(r => (
            <article key={r.id} style={{ padding: 16, background: '#fff', border: '1px solid #dce0e8', borderRadius: 12 }}>
              <h3 style={{ margin: 0 }}>{r.name}</h3>
              <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>{r.area} / {r.genre}</p>
              <p style={{ margin: 0 }}>{r.note}</p>
            </article>
          ))}
        </div>
      </div>
    )
    return new Response('<!doctype html>' + html, {
      headers: { 'content-type': 'text/html' },
    })
  },
}`

export const DynamicRenderInputSchema = z.object({
  search: SearchInputSchema.describe('D1 検索の引数。ホスト側で先に実行して結果を Worker に渡す'),
  code: z
    .string()
    .describe(
      'TSX で書かれた完全な Cloudflare Worker module ソース。export default { fetch(request) { ... } }'
    ),
})

export type DynamicRenderInput = z.infer<typeof DynamicRenderInputSchema>

export function makeDynamicRenderTool(env: CloudflareBindings) {
  return tool({
    description: `Cloudflare Dynamic Worker 上で **React JSX を SSR** してユーザに UI を返すツール。

# 入力
- search: D1 検索の引数 ({ area?, genre?, atmosphere?, query? }) — ホスト側で先に実行されます
- code: 完全な Cloudflare Worker module の TSX ソース

# Worker module の規約
- \`export default { async fetch(request) { ... } }\` の形
- request.body は \`{ restaurants: Restaurant[] }\` の JSON (上で指定した search の結果)
- Response を返してください (Content-Type: text/html を想定)
- 利用可能ライブラリ:
  - \`react\` (default import)
  - \`react-dom/server.edge\` (renderToString) — **必ず \`server.edge\` を使うこと**。\`react-dom/server\` (拡張子なし) は node 版で Worker runtime では動きません
  - \`./restaurant-ui\` (事前定義の RestaurantCard / RestaurantList)

# restaurant-ui の型
${RESTAURANT_UI_DTS}

# スペクトラム (どこまで自分で書くかは自由)

## 例 A: コンポーネント借用 (シンプル、≒ Controlled 寄り)
\`\`\`tsx
${TEMPLATE_BORROWED}
\`\`\`

## 例 B: 自分で raw に書く (≒ Open-Ended 寄り)
\`\`\`tsx
${TEMPLATE_RAW}
\`\`\`

借用と自前 raw のミックスもできます。要件に応じて選んでください。`,
    inputSchema: DynamicRenderInputSchema,
    execute: async (input) => {
      // 1. host 側で search を実行
      const restaurants = await searchRestaurants(env.DB, input.search)

      // 2. LLM の TSX コードを pre-process:
      //    react-dom/server は default で node 版 (util を require) を引いてしまい
      //    Worker runtime で動かない。確実に edge 版を引くため
      //    'react-dom/server' → 'react-dom/server.edge' に置換する
      const processedCode = input.code.replace(
        /from\s+(['"])react-dom\/server\1/g,
        "from 'react-dom/server.edge'"
      )
      const processedUiSource = uiComponentsSource.replace(
        /from\s+(['"])react-dom\/server\1/g,
        "from 'react-dom/server.edge'"
      )

      // 3. worker-bundler でバンドル
      //    - react / react-dom は npm registry から resolve
      //    - restaurant-ui.tsx は files に含めて相対 import で参照
      const { mainModule, modules } = await createWorker({
        files: {
          'src/index.tsx': processedCode,
          'src/restaurant-ui.tsx': processedUiSource,
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

      // 3. Dynamic Worker をスピンアップ
      const worker = env.LOADER.get(crypto.randomUUID(), async () => ({
        mainModule,
        modules,
        compatibilityDate: '2025-08-03',
        compatibilityFlags: ['nodejs_compat'],
        globalOutbound: null,
      }))

      // 4. fetch でリクエスト実行 (restaurants を body に乗せる)
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
        code: input.code,
      }
    },
  })
}
