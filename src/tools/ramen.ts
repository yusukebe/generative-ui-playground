/**
 * Ramen API (https://ramen-api.dev · 認証/レート制限なし · 作: yusukebe)。
 * 横浜の家系ラーメンが揃っているので「ご飯の〆ラーメン」候補として使う。
 * 天気(Open-Meteo) + 居酒屋(Places) と組み合わせ、出どころ・遅延の違う複数ソースを
 * 集約することで、ストリーミング/Suspense の差が活きる。
 */
import type { Restaurant } from '../types'

type RamenShop = {
  id: string
  name: string
  photos?: { url?: string }[]
}

/** 〆ラーメン候補を Restaurant 形に揃えて返す (既存の描画/プロンプトをそのまま使える) */
export async function getRamenShops(count = 4): Promise<Restaurant[]> {
  const res = await fetch(`https://ramen-api.dev/shops?perPage=${Math.min(count, 100)}`)
  if (!res.ok) return []
  const data = (await res.json()) as { shops?: RamenShop[] }
  const now = Date.now()
  return (data.shops ?? []).map((s) => ({
    id: `ramen:${s.id}`,
    name: s.name,
    area: '横浜',
    address: null,
    lat: null,
    lng: null,
    genre: '家系ラーメン',
    tags: ['家系', '〆ラーメン'],
    note: '飲んだあとの〆の一杯に',
    vision_summary: null,
    photo_id: null,
    photo_url: s.photos?.[0]?.url ?? null,
    price_range: '¥',
    atmosphere: null,
    created_at: now,
  }))
}
