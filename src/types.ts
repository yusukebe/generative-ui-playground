export type Restaurant = {
  id: string
  name: string
  area: string
  address: string | null
  lat: number | null
  lng: number | null
  genre: string
  tags: string[]
  note: string | null
  vision_summary: string | null
  photo_id: string | null
  photo_url?: string | null
  price_range: string | null
  atmosphere: string | null
  created_at: number
}

export type DbRestaurantRow = Omit<Restaurant, 'tags'> & { tags: string }

export function rowToRestaurant(row: DbRestaurantRow): Restaurant {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }
}

/**
 * LLM が tool 引数の日本語を \uXXXX エスケープのまま返してくることがある
 * (Workers AI の一部モデルのクセ)。それをデコードして実際の文字に戻す。
 * 例: "中华街" → "中華街"
 */
export function decodeUnicodeEscapes(s: string): string {
  if (!s.includes('\\u')) return s
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}
