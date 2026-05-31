/**
 * JSX 対応の code mode ツール。
 *
 * - LLM は async アロー関数 (JSX 構文可) を書く
 * - sucrase で JSX → React.createElement に変換
 * - React / react-dom/server / restaurant-ui を worker-bundler で 1 回バンドル
 *   してキャッシュし、DynamicWorkerExecutor に modules として inject
 * - 関数の戻り値は擬似 Response { contentType, body }
 * - Content-Type に応じてクライアント側で描画方法を分岐
 *
 * LLM はサンドボックス内で:
 *   - 完全自由に raw な JSX を書く ↔ <RestaurantList /> など借用する
 *   をその場で選択できる (Spectrum を歩く)。
 */
import { DynamicWorkerExecutor } from '@cloudflare/codemode'
import { aiTools, generateTypes, resolveProvider } from '@cloudflare/codemode/ai'
import { createWorker } from '@cloudflare/worker-bundler'
import { tool, type ToolSet } from 'ai'
import { transform } from 'sucrase'
import { z } from 'zod'
// Vite の ?raw で TSX のソースを文字列として取り込む
// (worker-bundler に渡してサンドボックス向け ESM に再バンドルする)
import uiComponentsSource from '../ui-components.tsx?raw'

let cachedModules: Record<string, string> | null = null

const sourceOf = (bundle: Awaited<ReturnType<typeof createWorker>>): string => {
  const m = bundle.modules[bundle.mainModule]
  if (typeof m === 'string') return m
  return m.js ?? ''
}

async function buildSandboxModules(): Promise<Record<string, string>> {
  if (cachedModules) return cachedModules

  const [reactBundle, rdsBundle, uiBundle] = await Promise.all([
    createWorker({
      files: { 'entry.js': `import React from 'react'; export default React;` },
      entryPoint: 'entry.js',
      bundle: true,
    }),
    createWorker({
      files: {
        'entry.js': `export { renderToString, renderToStaticMarkup } from 'react-dom/server'`,
      },
      entryPoint: 'entry.js',
      bundle: true,
    }),
    createWorker({
      files: { 'ui-components.tsx': uiComponentsSource },
      entryPoint: 'ui-components.tsx',
      bundle: true,
      jsx: 'automatic',
      jsxImportSource: 'react',
    }),
  ])

  cachedModules = {
    react: sourceOf(reactBundle),
    'react-dom/server': sourceOf(rdsBundle),
    'restaurant-ui': sourceOf(uiBundle),
  }
  return cachedModules
}

const RESTAURANT_UI_TYPES = `
declare module 'restaurant-ui' {
  export type Restaurant = {
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
  export const RestaurantCard: React.FC<{ restaurant: Restaurant }>
  /** 検索結果カードのグリッド表示 (1 行で済むなら一番ラク) */
  export const RestaurantList: React.FC<{ restaurants: Restaurant[] }>
}
`.trim()

export async function makeReactCodeTool(opts: {
  tools: ToolSet
  loader: WorkerLoader
  description?: string
}) {
  const modules = await buildSandboxModules()
  const executor = new DynamicWorkerExecutor({
    loader: opts.loader,
    modules,
  })

  const provider = aiTools(opts.tools)
  const resolved = resolveProvider(provider)
  const types = generateTypes(opts.tools)

  const defaultDescription = `JSX を含む async アロー関数を書いて UI を生成してください。

【利用可能 (import 不要、関数内で自動的に使える)】
- React (createElement / JSX)
- renderToString (react-dom/server)
- RestaurantCard, RestaurantList (restaurant-ui — 事前定義された UI コンポーネント)

【restaurant-ui の型】
${RESTAURANT_UI_TYPES}

【ツール (codemode 経由)】
${types}

【返却フォーマット】
擬似 Response { contentType, body } を return してください。クライアントは
Content-Type を見て描画方法を切り替えます:
- 'application/json'  + body { restaurants } → RestaurantList で描画
- 'application/vnd.gui-tree+json' + body { sections } → DeclarativeView で描画
- 'text/html' + body 完全 HTML → iframe (allow-scripts + CSP) で描画

【スペクトラム】
ユーザの要望に応じて以下の自由度で書き分けてください:
- カード一覧で済むなら <RestaurantList /> を 1 個使うだけで十分
- 中間: 一部 RestaurantCard を借りつつ周りは自分で組む
- 完全自由: 自分で <div> や <article> から組み立てる (Open-Ended 寄り)

【例 1: 借用全振り (シンプル)】
\`\`\`tsx
async (codemode) => {
  const { restaurants } = await codemode.search_restaurants({ area: '関内' })
  return {
    contentType: 'text/html',
    body: '<!doctype html>' + renderToString(<RestaurantList restaurants={restaurants} />),
  }
}
\`\`\`

【例 2: 自分で凝る (Open-Ended 寄り)】
\`\`\`tsx
async (codemode) => {
  const { restaurants } = await codemode.search_restaurants({ area: '関内' })
  return {
    contentType: 'text/html',
    body: '<!doctype html>' + renderToString(
      <div style={{ background: '#0f1117', color: '#e6e8ee', padding: 24 }}>
        <h1>関内のおすすめ</h1>
        <div style={{ display: 'grid', gap: 12 }}>
          {restaurants.map(r => (
            <article key={r.id} style={{ padding: 16, background: '#1d2230', borderRadius: 12 }}>
              <h3>{r.name}</h3>
              <p>{r.note}</p>
            </article>
          ))}
        </div>
      </div>
    ),
  }
}
\`\`\`

【例 3: シンプル JSON (Controlled 寄り)】
\`\`\`tsx
async (codemode) => {
  const { restaurants } = await codemode.search_restaurants({ area: '関内', atmosphere: '静か' })
  return { contentType: 'application/json', body: JSON.stringify({ restaurants }) }
}
\`\`\`

日本語で短い結びのテキストも返してください。`

  return tool({
    description: opts.description ?? defaultDescription,
    inputSchema: z.object({
      code: z.string().describe('JSX を含む async アロー関数のコード'),
    }),
    execute: async ({ code }) => {
      // 1. JSX → React.createElement へ変換
      const transformed = transform(code, {
        transforms: ['jsx'],
        jsxRuntime: 'classic',
      }).code

      // 2. ヘルパーを動的 import するラッパで包む
      const wrapped = `async (codemode) => {
  const React = (await import('react')).default
  const { renderToString } = await import('react-dom/server')
  const { RestaurantCard, RestaurantList } = await import('restaurant-ui')
  const userFn = ${transformed}
  return await userFn(codemode)
}`

      // 3. DynamicWorkerExecutor で実行
      const result = await executor.execute(wrapped, [resolved])
      return result
    },
  })
}
