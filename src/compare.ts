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
 * AI エージェントがツールを呼んでデータ(天気・終電・お店・〆ラーメン)を集める。
 * **各バンドの生成のたびに毎回実行する**(収集も描画もバンド単位)。
 * tool/weather/lasttrain/izakaya/ramen イベントを send で逐次配信しつつ、
 * 集めたデータと「収集にかかったトークン数」を返す。
 */
async function gatherWithTools(
  env: CloudflareBindings,
  params: PlanParams,
  modelId: ModelId,
  send: (o: unknown) => void
): Promise<{
  weather: Weather | null
  restaurants: Restaurant[]
  lastTrain: LastTrain
  agentTokens: number
}> {
  const { model, isOpenAI } = resolveModel(env, modelId)
  const providerOptions = isOpenAI
    ? undefined
    : { 'workers-ai': { max_tokens: 2048, reasoning_effort: 'low' as const } }
  let agentTokens = 0
  let weatherData: Weather | null = null
  let lastTrainData: LastTrain | null = null
  let izakaya: Restaurant[] = []
  let ramen: Restaurant[] = []
  let gotWeather = false
  let gotTrain = false
  let gotIzakaya = false
  let gotRamen = false

  const tools = {
    get_weather: tool({
      description: '指定日(YYYY-MM-DD)の横浜(関内)の天気を取得する。1回だけ呼ぶ。',
      inputSchema: z.object({ date: z.string().describe('対象日 YYYY-MM-DD') }),
      execute: async ({ date }) => {
        if (gotWeather) return weatherData ?? { label: '取得済み' }
        gotWeather = true
        send({ type: 'tool', name: 'get_weather', args: { date } })
        weatherData = await getWeather(date)
        send({ type: 'weather', weather: weatherData })
        return weatherData ?? { label: '取得できず' }
      },
    }),
    get_last_train: tool({
      description: '指定エリアの終電目安(最寄り駅・終電時刻・店を出る目安)を取得する。1回だけ呼ぶ。',
      inputSchema: z.object({ area: z.string().describe('エリア名 (例: 関内, 野毛, みなとみらい)') }),
      execute: async ({ area }) => {
        if (gotTrain) return lastTrainData
        gotTrain = true
        send({ type: 'tool', name: 'get_last_train', args: { area } })
        lastTrainData = getLastTrain(area)
        send({ type: 'lasttrain', lastTrain: lastTrainData })
        return lastTrainData
      },
    }),
    search_restaurants: tool({
      description: '飲み会向けのお店をエリア・気分で検索する (Google Places / D1)。1回だけ呼ぶ。',
      inputSchema: SearchInputSchema,
      execute: async (input) => {
        if (gotIzakaya) return { restaurants: izakaya.map((r) => ({ id: r.id, name: r.name })) }
        gotIzakaya = true
        send({ type: 'tool', name: 'search_restaurants', args: input })
        izakaya = await findRestaurants(env, { ...input, limit: 2 })
        send({ type: 'izakaya', restaurants: izakaya })
        // モデルに返すのは id と name だけ (プロンプトを膨らませない)
        return { restaurants: izakaya.map((r) => ({ id: r.id, name: r.name })) }
      },
    }),
    get_ramen: tool({
      description: '飲んだあとの〆の家系ラーメン候補(横浜)を取得する。1回だけ呼ぶ。',
      inputSchema: z.object({ count: z.number().nullable().describe('件数 (省略時 1)') }),
      execute: async () => {
        if (gotRamen) return { restaurants: ramen.map((r) => ({ id: r.id, name: r.name })) }
        gotRamen = true
        send({ type: 'tool', name: 'get_ramen', args: {} })
        ramen = await getRamenShops(1)
        send({ type: 'ramen', restaurants: ramen })
        return { restaurants: ramen.map((r) => ({ id: r.id, name: r.name })) }
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
- search_restaurants(area="${params.area}", query=用途や気分を表す短い語): 1軒目・2軒目用のお店を2件
- get_ramen(): 〆の家系ラーメンを1件
各ツールは**1回ずつ**呼ぶこと。全部呼び終えたら「集めました」とだけ短く返してください。

条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}`,
    })
    for await (const _ of result.fullStream) {
      void _
    }
    const usage = await result.totalUsage
    agentTokens = usage?.outputTokens ?? usage?.totalTokens ?? 0
  } catch (e) {
    console.error('[gather] agent failed:', e)
  }

  // フォールバック: エージェントが呼ばなかったツールはホストが補完する (会場保険)
  try {
    if (!gotTrain) {
      lastTrainData = getLastTrain(params.area)
      send({ type: 'lasttrain', lastTrain: lastTrainData })
    }
    if (!gotWeather) {
      weatherData = await getWeather(params.date)
      send({ type: 'weather', weather: weatherData })
    }
    if (!gotIzakaya) {
      const query = [params.purpose, params.mood].filter(Boolean).join(' ')
      izakaya = await findRestaurants(env, { area: params.area, query, limit: 2 })
      send({ type: 'izakaya', restaurants: izakaya })
    }
    if (!gotRamen) {
      ramen = await getRamenShops(1)
      send({ type: 'ramen', restaurants: ramen })
    }
  } catch (e) {
    console.error('[gather] fallback failed:', e)
  }

  return {
    weather: weatherData,
    restaurants: [...izakaya, ...ramen],
    lastTrain: lastTrainData ?? getLastTrain(params.area),
    agentTokens,
  }
}

function dataForPrompt(restaurants: Restaurant[], includePhoto = false): string {
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
      // Open-Ended は自前で <img> を書くため写真URLを渡す (他バンドは id 参照なので不要)
      ...(includePhoto && r.photo_url ? { photo_url: r.photo_url } : {}),
    }))
  )
}

function planContext(
  params: PlanParams,
  weather: Weather | null,
  restaurants: Restaurant[],
  lastTrain: LastTrain,
  includePhoto = false
): string {
  const w = weather
    ? `${weather.emoji} ${weather.label} / 最高${weather.tempMax ?? '?'}℃ 最低${weather.tempMin ?? '?'}℃ / 降水確率${weather.precipProb ?? '?'}%`
    : '不明'
  return `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}
天気: ${w}
終電: ${lastTrain.station} … ${lastTrain.summary} (お店を出る目安 ${lastTrain.leaveBy})
店候補 (この中の店だけ使う・id 必須。genre が「家系ラーメン」の店は〆ラーメン専用): ${dataForPrompt(restaurants, includePhoto)}
プラン構成: **提供された全店を使う**。お店(家系ラーメン以外)を「1軒目」「2軒目」、家系ラーメンを「〆」とする (=1軒目・2軒目・〆 の3ステップ)。**最後に終電メモ(${lastTrain.station}の終電目安と「${lastTrain.leaveBy}には出る」)を必ず添える。**`
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

/**
 * 指定 1 バンドの「プラン」を生成し NDJSON でストリーム配信。
 * **毎回まず自分でツールを呼んでデータを集め(gatherWithTools)、続けて描画する。**
 * メトリクスは「収集(ツール) + 生成」の合計を、このバンドの実コストとして計測する。
 */
export function streamBand(
  env: CloudflareBindings,
  band: Band,
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
        : { 'workers-ai': { max_tokens: 4096, reasoning_effort: 'low' as const } }
      // 計測開始: ここから収集(ツール)＋描画ぜんぶがこのバンドのコスト
      const started = Date.now()
      // 1) データ収集。Controlled/Declarative/Open-Ended は事前にツールで集める。
      //    **Dynamic は事前収集しない** — 描画時にコンポーネントが Suspense で取得する(Code Mode)。
      let weather: Weather | null = null
      let restaurants: Restaurant[] = []
      let lastTrain: LastTrain = getLastTrain(params.area)
      let agentTokens = 0
      if (band !== 'dynamic') {
        const gathered = await gatherWithTools(env, params, modelId, send)
        weather = gathered.weather
        restaurants = gathered.restaurants
        lastTrain = gathered.lastTrain
        agentTokens = gathered.agentTokens
      }
      // 2) 描画フェーズ開始 (初描画 TTFR はここから測る)
      send({ type: 'render-start' })
      const ctx = band === 'dynamic' ? '' : planContext(params, weather, restaurants, lastTrain)
      // 生成コストの計測 = 収集トークン + 生成トークン、時間は収集込みの総時間
      const metric = (usage: LanguageModelUsage | undefined, output: string) =>
        send({
          type: 'metrics',
          ms: Date.now() - started,
          tokens: agentTokens + (usage?.outputTokens ?? usage?.totalTokens ?? 0),
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
- 各 card: title=店名 / subtitle="1軒目 · エリア · ジャンル" / body=why(短く) / tags / **restaurantId=その店の id (必須・写真表示に使う)**
- **提供された全店を card にする**。お店→〆(家系ラーメン) の順
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
          // Open-Ended は写真URLも渡し、自前で <img> を全件書く (他バンドは id 参照=軽い)
          const ctxPhotos = planContext(params, weather, restaurants, lastTrain, true)
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Open-Ended アシスタントです。夜のプランを **完全な単一 HTML 文書**
(<!doctype html>〜</html>) で表現してください。
- 天気バナー、各軒(1軒目/2軒目/〆)、移動・予約メモを含む凝ったデザイン
- **各店には写真を必ず入れる**: 候補データの photo_url を使い <img src="(photo_url)" ...> を書く
- CSS は <style> インライン、外部リソースは画像(photo_url)のみ可、出力は HTML のみ
${COMMON}
${ctxPhotos}`,
          })
          for await (const delta of textStream) send({ type: 'open-ended-delta', delta })
          const html = extractHTML(await text)
          send({ type: 'open-ended', html })
          metric(await usage, html)
        } else {
          // Dynamic は事前収集しない。restaurants(お店) と ramens(〆id) は描画時に host が prop で渡す。
          const dynCtx = `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}
※ restaurants(お店) と ramens(〆ラーメンの id/name) は描画時に props で渡されます。データは埋め込まず props を使うこと。`
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Dynamic バンド(Code Mode)のアシスタントです。夜のプランを表示する React
コンポーネント function App({ restaurants, ramens }) を1つだけ書いてください (import/export は書かない)。
- restaurants = お店 (props で渡る) / ramens = 〆ラーメン (id と name のみ・props で渡る)
- **データ取得は全部コンポーネント側**。あなたは型を見て組み立てるだけ (事前取得は不要)

# 使える API (型定義だけ渡します。実装は Worker 側にあり、**あなたは中身を知る必要はありません**)
\`\`\`ts
type Restaurant = { id: string; name: string; area: string; genre: string; tags: string[]; note: string | null; price_range: string | null; photo_url?: string | null }
// 非同期コンポーネント (内部で fetch する。**必ず <Suspense> で包む**)
declare const Weather: React.FC<{ date: string }>   // 天気バナー (自分で天気を取得)
declare const Ramen:   React.FC<{ id: string }>     // 〆ラーメン1件 (自分でラーメン詳細を取得)
// 同期コンポーネント (即描画)
declare const LastTrain:      React.FC<{ area: string }>                  // 終電案内
declare const RestaurantCard: React.FC<{ restaurant: Restaurant }>        // お店カード1枚
declare const RestaurantList: React.FC<{ restaurants: Restaurant[] }>     // お店一覧
declare const CardSkeleton:   React.FC                                    // ローディング
\`\`\`

# 書き方 (テンプレ。店名・天気・終電の値はコードに埋めず、コンポーネントに任せる)
- お店は **「1軒目」「2軒目」… のラベル付き**で、**横並びグリッド**に (縦に伸ばさない)
\`\`\`jsx
function App({ restaurants, ramens }) {
  const labels = ['1軒目', '2軒目', '3軒目']
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Suspense fallback={<CardSkeleton />}><Weather date="${params.date}" /></Suspense>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {restaurants.map((r, i) => (
          <div key={r.id}>
            <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{labels[i] || (i + 1) + '軒目'}</h2>
            <RestaurantCard restaurant={r} />
          </div>
        ))}
      </div>
      <h2 style={{ fontSize: 14, margin: 0 }}>〆のラーメン</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {ramens.map((r) => (
          <Suspense key={r.id} fallback={<CardSkeleton />}><Ramen id={r.id} /></Suspense>
        ))}
      </div>
      <LastTrain area="${params.area}" />
    </div>
  )
}
\`\`\`
- 上をベースに、用途/気分に合わせて見出し文言や順序を少しだけ調整してよい
- **店名・天気・終電の値はコードに埋め込まない** (コンポーネントが持つ)
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
