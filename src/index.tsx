import { Hono } from 'hono'
import { agentsMiddleware } from 'hono-agents'
import { preparePlan, runIntake, streamBand, streamPrepare, type Band } from './compare'
import { DEFAULT_MODEL, type ModelId } from './models'
import type { PlanParams } from './schemas/plan'
import { renderDynamicComponentStream } from './tools/dynamic-render'
import { getRamenShops } from './tools/ramen'
import { findRestaurants } from './tools/search-restaurants'

export { RestaurantAgent } from './agent'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.use('/agents/*', agentsMiddleware())

/** intake: 1 行入力(会話履歴)から条件を抽出。揃ったら天気+店検索も返す */
app.post('/api/intake', async (c) => {
  const { history, model } = await c.req.json<{
    history?: { role: 'user' | 'assistant'; text: string }[]
    model?: ModelId
  }>()
  if (!history?.length) return c.json({ error: 'history required' }, 400)
  const r = await runIntake(c.env, history, model ?? DEFAULT_MODEL)

  if (!r.ready) {
    return c.json({ ready: false, question: r.question ?? '条件をもう少し教えてください。' })
  }
  const params: PlanParams = {
    date: r.date ?? '',
    dateLabel: r.dateLabel ?? r.date ?? '',
    area: r.area ?? '横浜',
    partySize: r.partySize ?? 2,
    purpose: r.purpose ?? '友人',
    mood: r.mood ?? '',
  }
  // データ取得 (天気/終電/店/ラーメン) は /api/prepare でツール経由・非同期に行う
  return c.json({ ready: true, params })
})

/** 条件が揃ったら、エージェントがツールでデータを集めて NDJSON ストリーム配信 */
app.post('/api/prepare', async (c) => {
  const { params, model } = await c.req.json<{ params?: PlanParams; model?: ModelId }>()
  if (!params) return c.json({ error: 'params required' }, 400)
  return streamPrepare(c.env, params, model ?? DEFAULT_MODEL)
})

/** 指定 1 バンドのプランを生成してストリーム配信 (見ているバンドだけオンデマンド) */
app.post('/api/band', async (c) => {
  const body = await c.req.json<{
    band?: Band
    params?: PlanParams
    weather?: Awaited<ReturnType<typeof preparePlan>>['weather']
    restaurants?: Awaited<ReturnType<typeof preparePlan>>['restaurants']
    lastTrain?: Awaited<ReturnType<typeof preparePlan>>['lastTrain']
    model?: ModelId
  }>()
  if (!body.band || !body.params || !body.restaurants || !body.lastTrain) {
    return c.json({ error: 'band/params/restaurants/lastTrain required' }, 400)
  }
  return streamBand(
    c.env,
    body.band,
    body.params,
    body.weather ?? null,
    body.restaurants,
    body.lastTrain,
    body.model ?? DEFAULT_MODEL
  )
})

// Dynamic バンドの Suspense ストリーミング SSR フレーム (iframe が fetch して使う)
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/
app.get('/api/dynamic-frame', async (c) => {
  const q = c.req.query('q') ?? ''
  const area = c.req.query('area') ?? ''
  const codeB64 = c.req.query('code') ?? ''
  if (!codeB64 || (!q && !area)) return c.notFound()
  let code: string
  try {
    const bin = atob(codeB64.replace(/-/g, '+').replace(/_/g, '/'))
    code = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
  } catch {
    return c.notFound()
  }
  const [izakaya, ramen] = await Promise.all([
    findRestaurants(c.env, { area, query: q, limit: 2 }),
    getRamenShops(1),
  ])
  // restaurants(居酒屋) と ramens(〆) を別々に渡す。ramens は id+名前だけ
  // (写真等の詳細は worker 内の useRamenShop が per-item 取得=本物の Suspense)
  const ramenStubs = ramen.map((r) => ({ id: r.id, name: r.name }))
  const { stream } = await renderDynamicComponentStream(c.env, code, izakaya, ramenStubs)
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
})

// Google Places の写真プロキシ (API キーをクライアントに晒さない)
app.get('/api/places-photo', async (c) => {
  const name = c.req.query('name') ?? ''
  const key = c.env.GOOGLE_MAPS_API_KEY
  if (!PHOTO_NAME.test(name) || !key) return c.notFound()
  const url = `https://places.googleapis.com/v1/${name}/media?maxHeightPx=400&maxWidthPx=800&key=${key}`
  const res = await fetch(url)
  if (!res.ok) return c.notFound()
  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    },
  })
})

export default app
