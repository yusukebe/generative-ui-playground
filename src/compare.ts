/**
 * 飲み会アドバイザー (パターン比較)。
 * 1 行入力 → intake(条件抽出/不足なら質問) → 天気+店検索 → 4 バンドで「プラン」を描き分け。
 * 1 タスクでやることが多い (日付/天気/検索/複数パート) ので、ストリーミングの差が見える。
 *
 *   Controlled  — 既製プランテンプレに値を流し込む (generateObject)
 *   Declarative — section を streamObject で順に組む
 *   Open-Ended  — HTML でプラン1枚
 *   Dynamic     — React コードでプラン → /api/dynamic-frame で Suspense SSR
 */
import {
  generateObject,
  stepCountIs,
  streamObject,
  streamText,
  tool,
  type LanguageModelUsage,
} from 'ai'
import { z } from 'zod'
import { resolveModel } from './llm'
import type { ModelId } from './models'
import { DeclarativeUISchema } from './schemas/declarative'
import { IntakeSchema, PlanSchema, type IntakeResult, type PlanParams } from './schemas/plan'
import { getLastTrain, type LastTrain } from './tools/lasttrain'
import { getRamenShops } from './tools/ramen'
import { findRestaurants, SearchInputSchema } from './tools/search-restaurants'
import { getWeather, type Weather } from './tools/weather'
import type { Restaurant } from './types'

export type Band = 'controlled' | 'declarative' | 'open-ended' | 'dynamic'

/** 今日の日付 (JST) と曜日 */
function todayContext(): string {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now)
  const wd = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(now)
  return `${date} (${wd})`
}

/** 今日から16日ぶんの日付表 (LLM に計算させず選ばせて誤りを防ぐ) */
function dateReference(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
  const wd = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' })
  const base = Date.now()
  const lines: string[] = []
  for (let i = 0; i < 16; i++) {
    const d = new Date(base + i * 86400000)
    const tag = i === 0 ? ' ←今日' : i === 1 ? ' ←明日' : ''
    lines.push(`${ymd.format(d)}(${wd.format(d)})${tag}`)
  }
  return lines.join('\n')
}

/** 1 行入力(と会話履歴)から条件を抽出。不足があれば ready=false + question */
export async function runIntake(
  env: CloudflareBindings,
  history: { role: 'user' | 'assistant'; text: string }[],
  modelId: ModelId
): Promise<IntakeResult> {
  const { model, isOpenAI } = resolveModel(env, modelId)
  const providerOptions = isOpenAI
    ? undefined
    : { 'workers-ai': { max_tokens: 1024, reasoning_effort: 'low' as const } }
  const convo = history
    .map((h) => `${h.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${h.text}`)
    .join('\n')
  const { object } = await generateObject({
    model,
    schema: IntakeSchema,
    providerOptions,
    prompt: `あなたは横浜の夜のプランを組むための条件を聞き取るアシスタントです。

# 日付の解決 (最重要・自分で計算しない)
今日は ${todayContext()}。日付は**下の対応表から選んで** date(YYYY-MM-DD) を埋める。自力で計算しない。
対応表 (今日から):
${dateReference()}
- 「今週」= 今日を含む月〜日の週 / 「来週」= その次の月〜日の週。対応表の曜日を見て該当日を選ぶ
- 「今週末」「週末」→ 今週の土曜 / 「来週末」→ 来週の土曜 / 「明日」→ 上の表の明日
- 曖昧でも代表日に決めてよい。**日付の手がかりがあれば必ず表から選んで date を埋め、日付は二度と聞き返さない**

# 抽出
会話全体から 日付/エリア/人数/用途/気分 を統合して抽出する。
- **date・area・partySize の3つが埋まれば ready=true**、question は null
- どれかが本当に無いときだけ ready=false にし、不足の1つだけを短く質問する
- 既に分かっている項目は二度と聞かない
- dateLabel は「来週の金曜 (6/12)」のような人間向け表記
- エリアは横浜近辺 (関内/中華街/野毛/みなとみらい/桜木町/元町 など)

会話:
${convo}`,
  })
  return object
}

/** 条件が揃ったら 天気 + 居酒屋(Places) + 〆ラーメン(Ramen API) を並行取得 */
export async function preparePlan(
  env: CloudflareBindings,
  params: PlanParams
): Promise<{ weather: Weather | null; restaurants: Restaurant[]; lastTrain: LastTrain }> {
  // area は別フィールドで渡す (query に入れると Places が area=住所全文 にしてカードが崩れる)
  const query = [params.purpose, params.mood].filter(Boolean).join(' ')
  const [weather, izakaya, ramen] = await Promise.all([
    getWeather(params.date),
    findRestaurants(env, { area: params.area, query, limit: 6 }),
    getRamenShops(4),
  ])
  // 〆ラーメン候補を末尾に合流 (genre='家系ラーメン' で区別) + 終電案内
  return { weather, restaurants: [...izakaya, ...ramen], lastTrain: getLastTrain(params.area) }
}

/**
 * 条件データ (天気・終電・居酒屋・〆ラーメン) を **AI エージェントがツールを呼んで** 集め、
 * 解決した順に NDJSON でストリーム配信する。
 *   - intake 直後にプランヘッダを出し、ツール結果が返るたびにチップ/候補を非同期で埋める
 *   - 「エージェントがツールを叩いてデータを集める → 同じ素材を 4 バンドが描き分ける」二段構成
 *   - ツールが呼ばれなかった場合はホスト側でフォールバック取得 (会場保険)
 * NDJSON イベント: {type:'tool', name, args} / 'weather' / 'lasttrain' / 'izakaya' / 'ramen' / 'done'
 */
export function streamPrepare(
  env: CloudflareBindings,
  params: PlanParams,
  modelId: ModelId
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))
      const { model, isOpenAI } = resolveModel(env, modelId)
      const providerOptions = isOpenAI
        ? undefined
        : { 'workers-ai': { max_tokens: 2048, reasoning_effort: 'low' as const } }

      let gotWeather = false
      let gotTrain = false
      let gotIzakaya = false
      let gotRamen = false

      const tools = {
        get_weather: tool({
          description: '指定日(YYYY-MM-DD)の横浜(関内)の天気を取得する。プランに天気を反映するため最初に呼ぶ。',
          inputSchema: z.object({ date: z.string().describe('対象日 YYYY-MM-DD') }),
          execute: async ({ date }) => {
            send({ type: 'tool', name: 'get_weather', args: { date } })
            const weather = await getWeather(date)
            gotWeather = true
            send({ type: 'weather', weather })
            return weather ?? { label: '取得できず' }
          },
        }),
        get_last_train: tool({
          description: '指定エリアの終電目安(最寄り駅・終電時刻・店を出る目安)を取得する。',
          inputSchema: z.object({ area: z.string().describe('エリア名 (例: 関内, 野毛, みなとみらい)') }),
          execute: async ({ area }) => {
            send({ type: 'tool', name: 'get_last_train', args: { area } })
            const lastTrain = getLastTrain(area)
            gotTrain = true
            send({ type: 'lasttrain', lastTrain })
            return lastTrain
          },
        }),
        search_restaurants: tool({
          description: '居酒屋など飲み会向けの店をエリア・気分で検索する (Google Places / D1)。',
          inputSchema: SearchInputSchema,
          execute: async (input) => {
            send({ type: 'tool', name: 'search_restaurants', args: input })
            const restaurants = await findRestaurants(env, { ...input, limit: input.limit ?? 6 })
            gotIzakaya = true
            send({ type: 'izakaya', restaurants })
            // モデルに返すのは id と name だけ (プロンプトを膨らませない)
            return { restaurants: restaurants.map((r) => ({ id: r.id, name: r.name })) }
          },
        }),
        get_ramen: tool({
          description: '飲んだあとの〆の家系ラーメン候補(横浜)を取得する。',
          inputSchema: z.object({ count: z.number().nullable().describe('件数 (省略時 4)') }),
          execute: async ({ count }) => {
            send({ type: 'tool', name: 'get_ramen', args: { count } })
            const restaurants = await getRamenShops(count ?? 4)
            gotRamen = true
            send({ type: 'ramen', restaurants })
            return { restaurants: restaurants.map((r) => ({ id: r.id, name: r.name })) }
          },
        }),
      }

      try {
        const result = streamText({
          model,
          tools,
          stopWhen: stepCountIs(8),
          providerOptions,
          prompt: `あなたは横浜の飲み会プランに必要なデータを集めるエージェントです。
以下の条件に対し、4つのツールを**すべて**呼んで情報を集めてください (順不同・並行で構いません)。
- get_weather(date="${params.date}")
- get_last_train(area="${params.area}")
- search_restaurants(area="${params.area}", query=用途や気分を表す短い語): 飲み会向けの居酒屋を6件ほど
- get_ramen(): 〆の家系ラーメン候補
全部のツールを呼び終えたら「集めました」とだけ短く返してください。

条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}`,
        })
        // ツールの execute を走らせるためにストリームを最後まで駆動する (text は使わない)
        for await (const _ of result.fullStream) {
          void _
        }
      } catch (e) {
        console.error('[prepare] agent failed:', e)
      }

      // フォールバック: エージェントが呼ばなかったツールはホストが補完する
      try {
        if (!gotTrain) send({ type: 'lasttrain', lastTrain: getLastTrain(params.area) })
        if (!gotWeather) send({ type: 'weather', weather: await getWeather(params.date) })
        if (!gotIzakaya) {
          const query = [params.purpose, params.mood].filter(Boolean).join(' ')
          send({
            type: 'izakaya',
            restaurants: await findRestaurants(env, { area: params.area, query, limit: 6 }),
          })
        }
        if (!gotRamen) send({ type: 'ramen', restaurants: await getRamenShops(4) })
      } catch (e) {
        console.error('[prepare] fallback failed:', e)
      }
      send({ type: 'done' })
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
}

function dataForPrompt(restaurants: Restaurant[]): string {
  return JSON.stringify(
    restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      area: r.area,
      genre: r.genre,
      tags: r.tags,
      note: r.note,
      price_range: r.price_range,
      address: r.address,
    }))
  )
}

function planContext(
  params: PlanParams,
  weather: Weather | null,
  restaurants: Restaurant[],
  lastTrain: LastTrain
): string {
  const w = weather
    ? `${weather.emoji} ${weather.label} / 最高${weather.tempMax ?? '?'}℃ 最低${weather.tempMin ?? '?'}℃ / 降水確率${weather.precipProb ?? '?'}%`
    : '不明'
  return `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}
天気: ${w}
終電: ${lastTrain.station} … ${lastTrain.summary} (お店を出る目安 ${lastTrain.leaveBy})
店候補 (この中の店だけ使う・id 必須。genre が「家系ラーメン」の店は〆ラーメン専用): ${dataForPrompt(restaurants)}
プラン構成: 1軒目・2軒目は居酒屋系から、最後の「〆」は家系ラーメンの店を1つ。**最後に終電メモ(${lastTrain.station}の終電目安と「${lastTrain.leaveBy}には出る」)を必ず添える。**`
}

const COMMON = `重要: 店名・住所は候補データの値だけを使い創作しない。日本語で。雨/寒いなど天気をプランに反映する。`

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stripFence(text: string): string {
  const fence = text.match(/```[^\n]*\n([\s\S]*?)```/)
  return (fence ? fence[1] : text).trim()
}

function extractHTML(text: string): string {
  const body = stripFence(text)
  const doc = body.match(/<!doctype[\s\S]*<\/html>/i) ?? body.match(/<html[\s\S]*<\/html>/i)
  return (doc ? doc[0] : body).trim()
}

/** 指定 1 バンドの「プラン」を生成し NDJSON でストリーム配信 */
export function streamBand(
  env: CloudflareBindings,
  band: Band,
  params: PlanParams,
  weather: Weather | null,
  restaurants: Restaurant[],
  lastTrain: LastTrain,
  modelId: ModelId
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))
      const { model, isOpenAI } = resolveModel(env, modelId)
      const providerOptions = isOpenAI
        ? undefined
        : { 'workers-ai': { max_tokens: 4096, reasoning_effort: 'low' as const } }
      const ctx = planContext(params, weather, restaurants, lastTrain)
      const started = Date.now()
      // 生成コストの計測 (Dynamic は map でループ＝出力が小さく最速、を見せる)
      const metric = (usage: LanguageModelUsage | undefined, output: string) =>
        send({
          type: 'metrics',
          ms: Date.now() - started,
          tokens: usage?.outputTokens ?? usage?.totalTokens ?? 0,
          chars: output.length,
        })

      try {
        if (band === 'controlled') {
          const { object, usage } = await generateObject({
            model,
            schema: PlanSchema,
            providerOptions,
            prompt: `あなたは既製の「プラン」テンプレに値を流し込む Controlled アシスタントです。
はしご (2〜3軒) のプランを組み、weatherNote / steps[{label,restaurantId,why}] / tip を埋めてください。
label は「1軒目」「2軒目」「〆」など。restaurantId は候補の id。
${COMMON}
${ctx}`,
          })
          send({ type: 'controlled', plan: object })
          metric(usage, JSON.stringify(object))
        } else if (band === 'declarative') {
          const { partialObjectStream, object, usage } = streamObject({
            model,
            schema: DeclarativeUISchema,
            providerOptions,
            prompt: `あなたは Declarative UI アシスタントです。Section と Card のプリミティブで
夜のプランを組み立ててください。
- intro に天気をふまえたプラン概要 (1〜2文)
- **section は1個だけ** (例: heading="今夜のプラン")。その中に各店を card として並べる
- 各 card: title=店名 / subtitle="1軒目 · エリア · ジャンル" / body=why(短く) / tags
- 店は 1軒目→2軒目→〆 の順。〆は家系ラーメンの店
${COMMON}
${ctx}`,
          })
          for await (const partial of partialObjectStream) {
            send({ type: 'declarative-partial', ui: partial })
          }
          const finalUi = await object
          send({ type: 'declarative', ui: finalUi })
          metric(await usage, JSON.stringify(finalUi))
        } else if (band === 'open-ended') {
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Open-Ended アシスタントです。夜のプランを **完全な単一 HTML 文書**
(<!doctype html>〜</html>) で表現してください。
- 天気バナー、各軒(1軒目/2軒目/〆)、移動・予約メモを含む凝ったデザイン
- CSS は <style> インライン、外部リソース禁止、出力は HTML のみ
${COMMON}
${ctx}`,
          })
          for await (const delta of textStream) send({ type: 'open-ended-delta', delta })
          const html = extractHTML(await text)
          send({ type: 'open-ended', html })
          metric(await usage, html)
        } else {
          // Dynamic は restaurants(居酒屋) と ramens(〆) を別 prop で受け取る
          const izakaya = restaurants.filter((r) => r.genre !== '家系ラーメン')
          const ramens = restaurants.filter((r) => r.genre === '家系ラーメン')
          const dynCtx = `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}
天気: ${weather ? `${weather.emoji} ${weather.label} 最高${weather.tempMax ?? '?'}℃ 降水${weather.precipProb ?? '?'}%` : '不明'}
終電: ${lastTrain.station} … ${lastTrain.summary} (お店を出る目安 ${lastTrain.leaveBy})
restaurants(居酒屋・手元データ): ${dataForPrompt(izakaya)}
ramens(〆ラーメン候補・id と name のみ。詳細は useRamenShop で取る): ${JSON.stringify(ramens.map((r) => ({ id: r.id, name: r.name })))}`
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Dynamic バンドのアシスタントです。夜のプランを表示する React
コンポーネント function APP({ restaurants, ramens }) を1つだけ書いてください (import/export は書かない)。
- restaurants = 居酒屋 (手元にデータあり) / ramens = 〆ラーメン (id と name のみ)

# スコープで使えるもの
- <RestaurantList restaurants={restaurants} /> : 居酒屋の一覧を即描画
- <Ramen id={ramenId} /> : 〆ラーメン1件。中で useRamenShop が per-item 取得し、ラーメン専用UIで描画。**必ず <Suspense> の中で使う**
- <CardSkeleton /> : ローディング / Suspense : React の Suspense
- (上級) useRamenShop(id) で自分でラーメンUIを自作してもよい

# 書き方
- 居酒屋: <RestaurantList restaurants={restaurants} /> で即描画
- 〆ラーメンは ramens を map し、**各店を Suspense で包んで <Ramen> を per-item で出す**。
  **必ず grid コンテナで横に並べる**:
\`\`\`jsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
  {ramens.map((r) => (
    <Suspense key={r.id} fallback={<CardSkeleton />}>
      <Ramen id={r.id} />
    </Suspense>
  ))}
</div>
\`\`\`
- 見出しは小さく1行 (<h2 style={{ fontSize: 18, margin: 0 }}>)、天気は <p style={{ fontSize: 13, color: '#6b7280' }}>
- **最後に終電メモを必ず添える** (🚃 ${lastTrain.station} の終電目安と「${lastTrain.leaveBy} には出る」)
- **要素は縦に積みすぎず、横(grid)に広げる**
- 全体は <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}> で囲む
- 出力はコンポーネント関数のみ。説明やコードフェンスは書かない
${COMMON}
${dynCtx}`,
          })
          for await (const delta of textStream) send({ type: 'dynamic-delta', delta })
          const code = stripFence(await text)
          send({ type: 'dynamic-code', code })
          const q = [params.purpose, params.mood].filter(Boolean).join(' ')
          const url = `/api/dynamic-frame?area=${encodeURIComponent(params.area)}&q=${encodeURIComponent(q)}&code=${b64urlEncode(code)}`
          send({ type: 'dynamic-frame', url, code })
          metric(await usage, code)
          send({ type: 'dynamic', code })
        }
      } catch (e) {
        console.error(`[plan] ${band} failed:`, e)
        send({ type: band, error: true })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
}
