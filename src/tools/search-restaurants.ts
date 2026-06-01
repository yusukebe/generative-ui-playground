import { tool } from 'ai'
import { z } from 'zod'
import {
  decodeUnicodeEscapes,
  rowToRestaurant,
  type DbRestaurantRow,
  type Restaurant,
} from '../types'
import { searchPlaces } from './places'

export const SearchInputSchema = z.object({
  query: z.string().optional().describe('自由文クエリ。曖昧な気分の表現も可'),
  area: z
    .string()
    .optional()
    .describe('エリア名 (例: 関内, 馬車道, 中華街, 野毛, 桜木町, みなとみらい, 元町)'),
  genre: z.string().optional().describe('ジャンル (例: ラーメン, イタリアン, 寿司, バー)'),
  atmosphere: z.string().optional().describe('雰囲気 (例: 静か, 賑やか, デート向き, 落ち着いた)'),
  limit: z.coerce.number().min(1).max(10).default(5),
})

export type SearchInput = z.infer<typeof SearchInputSchema>

export async function searchRestaurants(db: D1Database, input: SearchInput): Promise<Restaurant[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  // LLM が日本語を \uXXXX エスケープのまま渡してくることがあるのでデコード
  const area = input.area ? decodeUnicodeEscapes(input.area) : undefined
  const genre = input.genre ? decodeUnicodeEscapes(input.genre) : undefined
  const atmosphere = input.atmosphere ? decodeUnicodeEscapes(input.atmosphere) : undefined
  const query = input.query ? decodeUnicodeEscapes(input.query) : undefined

  if (area) {
    conditions.push('area LIKE ?')
    params.push(`%${area}%`)
  }
  if (genre) {
    conditions.push('genre LIKE ?')
    params.push(`%${genre}%`)
  }
  if (atmosphere) {
    conditions.push('atmosphere LIKE ?')
    params.push(`%${atmosphere}%`)
  }
  // query は他の絞り込み条件が無いときだけ使う (LLM が area/genre/atmosphere
  // と一緒に query=ユーザ発話全体 を渡してくると AND 結合で 0 件になるため)
  if (query && !area && !genre && !atmosphere) {
    conditions.push('(name LIKE ? OR note LIKE ? OR tags LIKE ? OR vision_summary LIKE ?)')
    const q = `%${query}%`
    params.push(q, q, q, q)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT * FROM restaurants ${where} ORDER BY created_at DESC LIMIT ?`
  params.push(input.limit)

  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<DbRestaurantRow>()
  return results.map(rowToRestaurant)
}

/**
 * データソースの解決層。
 * GOOGLE_MAPS_API_KEY があれば Google Places (New) を優先し、キーが無い・
 * エラー・0 件のときは D1 シードへフォールバックする (会場でキー切れでも動く保険)。
 */
export async function findRestaurants(
  env: CloudflareBindings,
  input: SearchInput
): Promise<Restaurant[]> {
  if (env.GOOGLE_MAPS_API_KEY) {
    try {
      const places = await searchPlaces(env.GOOGLE_MAPS_API_KEY, input)
      if (places.length > 0) return places
    } catch (err) {
      console.error('Places API failed, falling back to D1:', err)
    }
  }
  return searchRestaurants(env.DB, input)
}

export function makeSearchRestaurantsTool(env: CloudflareBindings) {
  return tool({
    description:
      'レストランを条件で検索する (Google Places / D1)。エリア・ジャンル・雰囲気で絞り込みできる。',
    inputSchema: SearchInputSchema,
    execute: async (input) => {
      const restaurants = await findRestaurants(env, input)
      return { restaurants }
    },
  })
}
