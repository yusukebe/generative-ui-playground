import { tool } from 'ai'
import { z } from 'zod'
import { rowToRestaurant, type DbRestaurantRow, type Restaurant } from '../types'

export const SearchInputSchema = z.object({
  query: z.string().optional().describe('自由文クエリ。曖昧な気分の表現も可'),
  area: z.string().optional().describe('エリア名 (例: 中目黒, 渋谷, 銀座)'),
  genre: z.string().optional().describe('ジャンル (例: ラーメン, イタリアン, 寿司, バー)'),
  atmosphere: z.string().optional().describe('雰囲気 (例: 静か, 賑やか, デート向き, 落ち着いた)'),
  limit: z.number().min(1).max(10).default(5),
})

export type SearchInput = z.infer<typeof SearchInputSchema>

export async function searchRestaurants(
  db: D1Database,
  input: SearchInput,
): Promise<Restaurant[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (input.area) {
    conditions.push('area LIKE ?')
    params.push(`%${input.area}%`)
  }
  if (input.genre) {
    conditions.push('genre LIKE ?')
    params.push(`%${input.genre}%`)
  }
  if (input.atmosphere) {
    conditions.push('atmosphere LIKE ?')
    params.push(`%${input.atmosphere}%`)
  }
  if (input.query) {
    conditions.push('(name LIKE ? OR note LIKE ? OR tags LIKE ? OR vision_summary LIKE ?)')
    const q = `%${input.query}%`
    params.push(q, q, q, q)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT * FROM restaurants ${where} ORDER BY created_at DESC LIMIT ?`
  params.push(input.limit)

  const { results } = await db.prepare(sql).bind(...params).all<DbRestaurantRow>()
  return results.map(rowToRestaurant)
}

export function makeSearchRestaurantsTool(db: D1Database) {
  return tool({
    description:
      'D1 に保存されたレストランから条件にマッチするお店を検索する。エリア・ジャンル・雰囲気で絞り込みできる。',
    inputSchema: SearchInputSchema,
    execute: async (input) => {
      const restaurants = await searchRestaurants(db, input)
      return { restaurants }
    },
  })
}
