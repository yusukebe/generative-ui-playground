/**
 * ご飯アドバイザー (パターン比較)。
 * 1 行入力 → intake(条件抽出/不足なら質問) → 天気+店検索 → 4 パターンで「プラン」を描き分け。
 * 1 タスクでやることが多い (日付/天気/検索/複数パート) ので、ストリーミングの差が見える。
 *
 *   Controlled  — 1フェーズ。streamText でデータツール+build_plan を呼び固定部品に流す
 *   Declarative — streamText で UIツリー(JSON)を吐き host が再帰描画
 *   Open-Ended  — HTML でプラン1枚
 *   Dynamic     — React コードでプラン → /api/dynamic-frame で Suspense SSR
 */
import { generateObject, stepCountIs, streamText, tool, type LanguageModelUsage } from 'ai'
import { z } from 'zod'
import { resolveModel } from './llm'
import type { ModelId } from './models'
import { IntakeSchema, type IntakeResult, type PlanParams } from './schemas/plan'
import { declarativeCatalogText, dynamicCatalogText, validateDeclNode } from './schemas/catalog'
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
  const wd = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(
    now
  )
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
    prompt: `あなたは横浜・札幌の夜のプランを組むための条件を聞き取るアシスタントです。

# 日付の解決 (最重要・自分で計算しない)
今日は ${todayContext()}。日付は**下の対応表から選んで** date(YYYY-MM-DD) を埋める。自力で計算しない。
対応表 (今日から):
${dateReference()}
- 「今週」= 今日を含む月〜日の週 / 「来週」= その次の月〜日の週。対応表の曜日を見て該当日を選ぶ
- 「今週末」「週末」→ 今週の土曜 / 「来週末」→ 来週の土曜 / 「明日」→ 上の表の明日
- 曖昧でも代表日に決めてよい。**日付の手がかりがあれば必ず表から選んで date を埋め、日付は二度と聞き返さない**

# 抽出
会話全体から 日付/エリア/人数/用途/気分/食べたいもの を統合して抽出する。
- **date・area・partySize の3つが埋まれば ready=true**、question は null
- どれかが本当に無いときだけ ready=false にし、不足の1つだけを短く質問する
- 既に分かっている項目は二度と聞かない
- dateLabel は「来週の金曜 (6/12)」のような人間向け表記
- エリアは横浜近辺 (関内/中華街/野毛/みなとみらい/桜木町/元町 など) または札幌近辺 (すすきの/大通/札幌駅/狸小路 など)
- **craving**: 「もつが食べたい」「海鮮で」など具体的な食べ物/ジャンルがあれば入れる (無ければ null)。craving は ready の判定には含めない

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
    getRamenShops(params.area, 4),
  ])
  // 〆ラーメン候補を末尾に合流 (id が 'ramen:' で始まる店で区別) + 終電案内
  return { weather, restaurants: [...izakaya, ...ramen], lastTrain: getLastTrain(params.area) }
}

/**
 * AI エージェントがツールを呼んでデータ(天気・終電・お店・〆ラーメン)を集める。
 * **各パターンの生成のたびに毎回実行する**(収集も描画もパターン単位)。
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
      description: '指定日(YYYY-MM-DD)の対象エリアの天気を取得する。1回だけ呼ぶ。',
      inputSchema: z.object({ date: z.string().describe('対象日 YYYY-MM-DD') }),
      execute: async ({ date }) => {
        if (gotWeather) return weatherData ?? { label: '取得済み' }
        gotWeather = true
        send({ type: 'tool', name: 'get_weather', args: { date } })
        weatherData = await getWeather(date, params.area)
        send({ type: 'weather', weather: weatherData })
        return weatherData ?? { label: '取得できず' }
      },
    }),
    get_last_train: tool({
      description:
        '指定エリアの終電目安(最寄り駅・終電時刻・店を出る目安)を取得する。1回だけ呼ぶ。',
      inputSchema: z.object({
        area: z.string().describe('エリア名 (例: 関内, 野毛, みなとみらい)'),
      }),
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
      description: 'ご飯向けのお店をエリア・気分で検索する (Google Places / D1)。1回だけ呼ぶ。',
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
      description: '飲んだあとの〆のラーメン候補を取得する(エリアに合わせる)。1回だけ呼ぶ。',
      inputSchema: z.object({ count: z.number().nullable().describe('件数 (省略時 1)') }),
      execute: async () => {
        if (gotRamen) return { restaurants: ramen.map((r) => ({ id: r.id, name: r.name })) }
        gotRamen = true
        send({ type: 'tool', name: 'get_ramen', args: {} })
        ramen = await getRamenShops(params.area, 1)
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
      prompt: `あなたは横浜・札幌のご飯プランに必要なデータを集めるエージェントです。
以下の条件に対し、4つのツールを**すべて**呼んで情報を集めてください (順不同・並行で構いません)。
- get_weather(date="${params.date}")
- get_last_train(area="${params.area}")
- search_restaurants(area="${params.area}", query="${[params.craving, params.purpose, params.mood].filter(Boolean).join(' ') || 'おすすめ'}"): 1軒目・2軒目用のお店を2件${params.craving ? ` (特に「${params.craving}」が食べられる店を優先)` : ''}
- get_ramen(): 〆のラーメンを1件
各ツールは**1回ずつ**呼ぶこと。全部呼び終えたら「集めました」とだけ短く返してください。

条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'} / 食べたいもの:${params.craving || '指定なし'}`,
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
      weatherData = await getWeather(params.date, params.area)
      send({ type: 'weather', weather: weatherData })
    }
    if (!gotIzakaya) {
      const query = [params.craving, params.purpose, params.mood].filter(Boolean).join(' ')
      izakaya = await findRestaurants(env, { area: params.area, query, limit: 2 })
      send({ type: 'izakaya', restaurants: izakaya })
    }
    if (!gotRamen) {
      ramen = await getRamenShops(params.area, 1)
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
      // Open-Ended は自前で <img> を書くため写真URLを渡す (他パターンは id 参照なので不要)
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
  return `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'} / 食べたいもの:${params.craving || '指定なし'}
天気: ${w}
終電: ${lastTrain.station} … ${lastTrain.summary} (お店を出る目安 ${lastTrain.leaveBy})${params.craving ? `\n※ 「${params.craving}」を食べたいという希望があるので、合う店があれば優先しプランに反映する` : ''}
店候補 (この中の店だけ使う・id 必須。**id が「ramen:」で始まる店は〆ラーメン専用**): ${dataForPrompt(restaurants, includePhoto)}
プラン構成: **提供された全店を使う**。お店(id が ramen: 以外)を「1軒目」「2軒目」、id が ramen: の店を「〆」とする (=1軒目・2軒目・〆 の3ステップ)。**最後に終電メモ(${lastTrain.station}の終電目安と「${lastTrain.leaveBy}には出る」)を必ず添える。**`
}

const COMMON = `重要: 店名・住所は候補データの値だけを使い創作しない。日本語で。雨/寒いなど天気をプランに反映する。`

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
 * 指定 1 パターンの「プラン」を生成し NDJSON でストリーム配信。
 * **毎回まず自分でツールを呼んでデータを集め(gatherWithTools)、続けて描画する。**
 * メトリクスは「収集(ツール) + 生成」の合計を、このパターンの実コストとして計測する。
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
      // 計測開始: ここから収集(ツール)＋描画ぜんぶがこのパターンのコスト
      const started = Date.now()
      // 1) データ収集。**Declarative / Open-Ended のみ**事前にツールで集める(2フェーズ: 収集→描画)。
      //    **Static は1フェーズ** — 1回の streamText でツールを呼び、各結果が直接描画に流れる(参考デモと同じ)。
      //    **Dynamic も収集しない** — 描画時にコンポーネントが Suspense で取得する(Code Mode)。
      let weather: Weather | null = null
      let restaurants: Restaurant[] = []
      let lastTrain: LastTrain = getLastTrain(params.area)
      let agentTokens = 0
      const twoPhase = band === 'declarative' || band === 'open-ended'
      if (twoPhase) {
        const gathered = await gatherWithTools(env, params, modelId, send)
        weather = gathered.weather
        restaurants = gathered.restaurants
        lastTrain = gathered.lastTrain
        agentTokens = gathered.agentTokens
      }
      // 2) 描画フェーズ開始 (D/OE 用。初描画 TTFR はここから測る)
      send({ type: 'render-start' })
      const ctx = twoPhase ? planContext(params, weather, restaurants, lastTrain) : ''
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
          // Static = 1フェーズ。1回の streamText でデータツールを呼び、各結果が直接描画に流れる。
          // 並びは build_plan ツールで組む(参考デモの generateItinerary に相当)。generateObject は使わない。
          let izakaya: Restaurant[] = []
          let ramen: Restaurant[] = []
          // Static で AI がやったこと = ツールコール列そのもの。ソース表示と字数メトリクスに使う
          // (build_plan も含めて「AI はツールを呼んだだけ」を正直に見せる)。
          const toolLog: { name: string; args: unknown }[] = []
          const logTool = (name: string, args: unknown) => {
            toolLog.push({ name, args })
            send({ type: 'tool', name, args })
          }
          const dq =
            [params.craving, params.purpose, params.mood].filter(Boolean).join(' ') || 'おすすめ'
          // 参考実装(旅行プランナー)の Static と同じ: AI が呼んだツールの結果を
          // ツールコール順に固定部品へ流す(switch(tool))。呼ばれなかったツールは出ない。
          // static-step イベント = { tool, output }。クライアントが順に描画する。
          const staticTools = {
            get_weather: tool({
              description: '対象エリアの天気を取得する。',
              inputSchema: z.object({ date: z.string().describe('対象日 YYYY-MM-DD') }),
              execute: async ({ date }) => {
                logTool('get_weather', { date })
                const w = await getWeather(date, params.area)
                send({ type: 'weather', weather: w })
                send({ type: 'static-step', tool: 'get_weather', output: w })
                return w ?? { label: '取得できず' }
              },
            }),
            get_last_train: tool({
              description: 'エリアの終電目安を取得する。',
              inputSchema: z.object({ area: z.string().describe('エリア名') }),
              execute: async ({ area }) => {
                logTool('get_last_train', { area })
                const lt = getLastTrain(area)
                send({ type: 'lasttrain', lastTrain: lt })
                send({ type: 'static-step', tool: 'get_last_train', output: lt })
                return lt
              },
            }),
            search_restaurants: tool({
              description: '飲み会向けのお店を検索する。',
              inputSchema: SearchInputSchema,
              execute: async (input) => {
                logTool('search_restaurants', input)
                izakaya = await findRestaurants(env, { ...input, limit: 2 })
                send({ type: 'izakaya', restaurants: izakaya })
                send({ type: 'static-step', tool: 'search_restaurants', output: izakaya })
                return { restaurants: izakaya.map((r) => ({ id: r.id, name: r.name })) }
              },
            }),
            get_ramen: tool({
              description: '〆のラーメンを取得する。',
              inputSchema: z.object({ count: z.number().nullable().describe('件数 (省略時 1)') }),
              execute: async () => {
                logTool('get_ramen', {})
                ramen = await getRamenShops(params.area, 1)
                send({ type: 'ramen', restaurants: ramen })
                send({ type: 'static-step', tool: 'get_ramen', output: ramen })
                return { restaurants: ramen.map((r) => ({ id: r.id, name: r.name })) }
              },
            }),
          }
          const result = streamText({
            model,
            tools: staticTools,
            stopWhen: stepCountIs(8),
            providerOptions,
            prompt: `あなたは Static パターンのアシスタントです。ユーザーの要望に応じて、**必要なツールを呼んでください**。
各ツールの結果はそのまま固定コンポーネントで表示されます(並び・レイアウト・文言はホスト側が固定で持つので、あなたが作る必要はありません)。
使えるツール (要望に関係するものを呼ぶ。**必ずしも全部呼ばなくてよい**):
- get_weather(date="${params.date}"): 天気
- get_last_train(area="${params.area}"): 終電
- search_restaurants(area="${params.area}", query="${dq}"): お店2件
- get_ramen(): 〆のラーメン
${COMMON}
条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'} / 食べたいもの:${params.craving || '指定なし'}`,
          })
          for await (const _ of result.fullStream) {
            void _
          }
          // Static の「ソース」= AI が呼んだツール列(これが Static で AI がやったこと全部)。
          // 字数メトリクスもこの全体長で測る。
          const toolText = toolLog
            .map((t) => `${t.name}(${JSON.stringify(t.args, null, 2)})`)
            .join('\n\n')
          send({ type: 'controlled-source', source: toolText })
          const usage = await result.totalUsage
          send({
            type: 'metrics',
            ms: Date.now() - started,
            tokens: usage?.outputTokens ?? usage?.totalTokens ?? 0,
            chars: toolText.length,
          })
        } else if (band === 'declarative') {
          // Declarative = AI が UIツリー(JSON)を組む。レイアウト(Stack/Grid)・並び・位置を自分で決める。
          // 型ごとに props が違う (参考デモの json-render と同じ)。streamText で JSON を吐かせて host でパース。
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Declarative パターンのアシスタントです。**UIツリー(JSON)**を組み立ててください。
どの部品を、どの順で並べるかはあなたが決めます (ブロックの構成があなたの仕事)。

# 使える部品 (type ごとに props が違う)
${declarativeCatalogText()}

# 出力形式 (これだけ)
入れ子の JSON を1つ。各ノードは { "type": "...", "props": {...}, "children": [ ...子ノード... ] }。
- 最上位は Stack。Weather・LastTrain・ShopList を組み合わせて構成する
- **ShopList は「ちょうど1つ」だけ**。店も〆ラーメンも全部この1つに入る。**〆用に別の ShopList や別見出しを作らない**
- **Static(素の縦並び)と差をつける工夫**(ここが腕の見せ所):
  - **天気と終電を Grid(columns:2) で横並び**にして情報バー風にする(これが一番効く)
  - 短い導入 Text を1つ、ShopList の前に短い Heading(例「お店」)を1つ、程度に留める
- **中身のない Heading を作らない**(見出しの直後には必ず対応する部品を置く)。終電は LastTrain 1つだけ・〆は ShopList の中なので、それ用の空見出しを作らない
- 店ごとの説明は ShopList が出すので Text で繰り返さない
- 出力は JSON のみ (\`\`\`json フェンス可)。前後に説明文を書かない
${COMMON}
${ctx}`,
          })
          for await (const _ of textStream) {
            void _
          }
          const raw = await text
          // 最低限のフォールバックツリー (Stack に weather/終電/店一覧を並べる)
          const fallbackTree = {
            type: 'Stack',
            props: { gap: 4 },
            children: [
              { type: 'Weather', props: {} },
              { type: 'LastTrain', props: {} },
              { type: 'ShopList', props: {} },
            ],
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(stripFence(raw))
          } catch {
            parsed = fallbackTree
          }
          // カタログ(Zod)でツリーを検証/正規化。壊れていればフォールバック。
          const tree = validateDeclNode(parsed) ?? fallbackTree
          // ツリーは自分の gather の id を参照するので、その restaurants を同梱して渡す
          // (クライアント側の共有 state は別パターンの gather で上書きされ得るため)
          send({ type: 'declarative', ui: tree, restaurants })
          metric(await usage, JSON.stringify(tree))
        } else if (band === 'open-ended') {
          // Open-Ended は写真URLも渡し、自前で <img> を全件書く (他パターンは id 参照=軽い)
          const ctxPhotos = planContext(params, weather, restaurants, lastTrain, true)
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Open-Ended アシスタントです。夜のプランを **完全な単一 HTML 文書**
(<!doctype html>〜</html>) で表現してください。
- 天気バナー、各軒(1軒目/2軒目/〆)、移動・予約メモを含む凝ったデザイン
- **各店には写真を必ず入れる**: 候補データの photo_url を使い <img src="(photo_url)" ...> を書く
- **画像は候補データの photo_url だけ**。天気アイコン等の画像URLを創作しない (天気は絵文字＋文字で表現)
- CSS は <style> インライン、外部リソースは画像(photo_url)のみ可、出力は HTML のみ
${COMMON}
${ctxPhotos}`,
          })
          for await (const delta of textStream) send({ type: 'open-ended-delta', delta })
          const html = extractHTML(await text)
          send({ type: 'open-ended', html })
          metric(await usage, html)
        } else {
          // Dynamic: お店(Places=要キー)だけ host が用意し prop で渡す。天気/〆ラーメンは worker が描画時取得。
          // ★ コード生成と「同時に」お店検索を開始する (await せず Promise を持っておく)。
          const dq = [params.craving, params.purpose, params.mood].filter(Boolean).join(' ')
          const izakayaPromise = findRestaurants(env, { area: params.area, query: dq, limit: 2 })
          const dynCtx = `条件: ${params.dateLabel}(${params.date}) / ${params.area} / ${params.partySize}人 / 用途:${params.purpose} / 気分:${params.mood || '指定なし'}
※ restaurants(お店) は描画時に props で渡されます。データは埋め込まず props を使うこと。`
          const { textStream, text, usage } = streamText({
            model,
            providerOptions,
            prompt: `あなたは Dynamic パターン(Code Mode)のアシスタントです。夜のプランを表示する React
コンポーネント function App({ restaurants }) を1つだけ書いてください (import/export は書かない)。
**あなたはレイアウトを毎回ゼロから設計するデザイナー**です。下記の部品を使い、条件(用途/気分)に
合わせて構成・見出し・配置を自分で考えてください。固定テンプレの丸写しはしないこと。
- restaurants = お店 (props で渡る) / 天気・〆ラーメンは専用コンポーネントが自分で取得する
- **データ取得は全部コンポーネント側**。あなたは型を見て組み立てるだけ (事前取得は不要)

# 使える API (型定義だけ渡します。実装は Worker 側にあり、**あなたは中身を知る必要はありません**)
\`\`\`ts
${dynamicCatalogText()}
declare const CardSkeleton:    React.FC  // ローディング(カード高さ・〆ラーメン用)
declare const WeatherSkeleton: React.FC  // ローディング(バナー高さ・天気用)
\`\`\`

# 設計の自由(ここがこのパターンの肝)
- 全体の構成・順序・見出し文言・グルーピングは**あなたが決める**。例: 天気を上に大きく出す / 1軒目を主役として大きく見せ2軒目を脇に置く / 店を縦リストにする / セクションごとに小見出しを付ける、など毎回違ってよい
- お店は \`<ShopList items={restaurants} />\` を置けば横並び+ラベルまで部品がやる(楽)。もっと凝るなら restaurants.map で RestaurantCard を自分で並べてもよい(件数は可変なので決め打ちしない)
- レイアウトは inline style で自由に(flex / grid / gap / padding 等)。色やborderも好みで

# 必ず守る制約 (壊さないため)
- 使うのは上の部品だけ。独自に fetch / import / 外部URL を書かない
- 非同期の <Weather> と <RamenList> は**必ず個別に <Suspense fallback={<WeatherSkeleton/>}> / <Suspense fallback={<CardSkeleton/>}> で包む**
- <Weather date="${params.date}" area="${params.area}" /> と <RamenList area="${params.area}" /> と <LastTrain area="${params.area}" /> の引数はこの値を使う
- **店名・天気・終電などの値はコードに埋め込まない**(コンポーネントが内部で持つ)。あなたは器を組むだけ
- 出力はコンポーネント関数のみ。説明やコードフェンスは書かない

参考までに最小の断片(これをそのまま使わず、構成は自分で考える):
\`<Suspense fallback={<WeatherSkeleton />}><Weather date="${params.date}" area="${params.area}" /></Suspense>\`
${COMMON}
${dynCtx}`,
          })
          for await (const delta of textStream) send({ type: 'dynamic-delta', delta })
          const code = stripFence(await text)
          send({ type: 'dynamic-code', code })
          // コード生成と並行で走らせていたお店検索を回収して一緒に渡す (フレームは検索しない)
          const izakaya = await izakayaPromise
          send({ type: 'dynamic-ready', code, restaurants: izakaya })
          metric(await usage, code)
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
