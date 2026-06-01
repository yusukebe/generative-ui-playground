import { Hono } from 'hono'
import { agentsMiddleware } from 'hono-agents'
import { runIntake, streamBand, type Band } from './compare'
import { DEFAULT_MODEL, type ModelId } from './models'
import type { PlanParams } from './schemas/plan'
import { renderDynamicComponentStream } from './tools/dynamic-render'
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
    craving: r.craving ?? '',
  }
  // データ取得(天気/終電/店/ラーメン)は各バンド生成のたびに /api/band 内でツール経由で行う
  return c.json({ ready: true, params })
})

/**
 * 指定 1 バンドのプランを生成してストリーム配信。
 * このエンドポイント内で「ツールでデータ収集 → 描画」を毎回まとめて行う。
 */
app.post('/api/band', async (c) => {
  const { band, params, model } = await c.req.json<{
    band?: Band
    params?: PlanParams
    model?: ModelId
  }>()
  if (!band || !params) {
    return c.json({ error: 'band/params required' }, 400)
  }
  return streamBand(c.env, band, params, model ?? DEFAULT_MODEL)
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
  // お店(Places=要キー)だけホストが取得して渡す。天気/〆ラーメン(キー不要)は worker が描画時に取得。
  const izakaya = await findRestaurants(c.env, { area, query: q, limit: 2 })
  const { stream } = await renderDynamicComponentStream(c.env, code, izakaya)
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
