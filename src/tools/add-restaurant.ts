import { generateObject } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { z } from 'zod'
import { rowToRestaurant, type DbRestaurantRow, type Restaurant } from '../types'

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
const NORMALIZE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const NormalizedSchema = z.object({
  name: z.string().describe('店名'),
  area: z.string().describe('エリア (例: 関内, 馬車道, 中華街, 野毛, 桜木町, みなとみらい, 元町)'),
  genre: z.string().describe('ジャンル (例: ラーメン, イタリアン)'),
  tags: z.array(z.string()).max(5).describe('特徴を表すタグ 3〜5 個'),
  atmosphere: z.string().describe('雰囲気 (静か, 賑やか, デート向き, 落ち着いた のいずれか)'),
  price_range: z.string().describe('価格帯 (低価格, 中価格, 高価格 のいずれか)'),
  note: z.string().describe('30 文字程度の紹介文'),
})

type Normalized = z.infer<typeof NormalizedSchema>

export type AddRestaurantInput = {
  text: string
  imageDataUrl?: string
  imageMime?: string
}

export type AddRestaurantResult = {
  restaurant: Restaurant
  visionSummary?: string
}

async function describeImage(ai: Ai, imageDataUrl: string): Promise<string> {
  // data URL → base64 部分のみ
  const match = imageDataUrl.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) return ''
  const base64 = match[1]
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const result = (await ai.run(
    VISION_MODEL as keyof AiModels,
    {
      image: Array.from(bytes),
      prompt:
        'この写真に写っている料理または店内の様子を 50 文字程度で簡潔に説明してください。日本語で。',
      max_tokens: 200,
    } as unknown as never
  )) as { description?: string; response?: string }
  return result.description ?? result.response ?? ''
}

async function normalize(ai: Ai, userText: string, visionSummary: string): Promise<Normalized> {
  const workersai = createWorkersAI({ binding: ai })
  const { object } = await generateObject({
    model: workersai(NORMALIZE_MODEL),
    schema: NormalizedSchema,
    prompt: `ユーザーが新しいレストランを登録しようとしています。次の情報から構造化データを推定してください。

ユーザーの入力テキスト: "${userText}"
画像から抽出した特徴: "${visionSummary}"

不明な部分は妥当な推測で埋めてください。`,
  })
  return object
}

export async function addRestaurant(
  env: CloudflareBindings,
  input: AddRestaurantInput
): Promise<AddRestaurantResult> {
  const visionSummary = input.imageDataUrl ? await describeImage(env.AI, input.imageDataUrl) : ''
  const normalized = await normalize(env.AI, input.text, visionSummary)

  let photoId: string | null = null
  if (input.imageDataUrl) {
    const match = input.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      const [, mime, base64] = match
      photoId = crypto.randomUUID()
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      await env.PHOTOS.put(`${photoId}`, bytes, {
        httpMetadata: { contentType: mime },
      })
    }
  }

  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await env.DB.prepare(
    `INSERT INTO restaurants (id, name, area, address, lat, lng, genre, tags, note, vision_summary, photo_id, price_range, atmosphere, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      normalized.name,
      normalized.area,
      null, // address (TODO: Google Places API で取得)
      null,
      null,
      normalized.genre,
      JSON.stringify(normalized.tags),
      normalized.note,
      visionSummary,
      photoId,
      normalized.price_range,
      normalized.atmosphere,
      createdAt
    )
    .run()

  const row: DbRestaurantRow = {
    id,
    name: normalized.name,
    area: normalized.area,
    address: null,
    lat: null,
    lng: null,
    genre: normalized.genre,
    tags: JSON.stringify(normalized.tags),
    note: normalized.note,
    vision_summary: visionSummary,
    photo_id: photoId,
    price_range: normalized.price_range,
    atmosphere: normalized.atmosphere,
    created_at: createdAt,
  }

  return {
    restaurant: rowToRestaurant(row),
    visionSummary,
  }
}
