/**
 * Ramen API (https://ramen-api.dev · 認証/レート制限なし · 作: yusukebe)。
 * 「ご飯の〆ラーメン」候補として使う。prefecture で絞れるのでエリア(横浜/札幌)に合わせて取得。
 * 天気(Open-Meteo) + 居酒屋(Places) と組み合わせ、出どころ・遅延の違う複数ソースを
 * 集約することで、ストリーミング/Suspense の差が活きる。
 */
import type { Restaurant } from '../types'

type RamenShop = {
  id: string
  name: string
  prefecture?: string
  photos?: { url?: string }[]
}

/** エリア → 都道府県 (Ramen API の prefecture フィルタ用)。札幌系なら北海道、それ以外は神奈川県。 */
export function prefectureForArea(area = ''): string {
  const a = String(area)
  const sapporo = ['札幌', 'すすきの', 'ススキノ', '大通', '狸小路', '中島公園', '北海道']
  return sapporo.some((m) => a.includes(m)) ? '北海道' : '神奈川県'
}

/** 〆ラーメン候補を Restaurant 形に揃えて返す。area に合う都道府県で絞り込む。 */
export async function getRamenShops(area = '', count = 1): Promise<Restaurant[]> {
  const prefecture = prefectureForArea(area)
  const url =
    `https://ramen-api.dev/shops?perPage=${Math.min(count, 100)}` +
    `&prefecture=${encodeURIComponent(prefecture)}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { shops?: RamenShop[] }
  const now = Date.now()
  return (data.shops ?? []).map((s) => ({
    id: `ramen:${s.id}`,
    name: s.name,
    area: s.prefecture ?? prefecture,
    address: null,
    lat: null,
    lng: null,
    genre: 'ラーメン',
    tags: ['ラーメン', '〆'],
    note: '飲んだあとの〆の一杯に',
    vision_summary: null,
    photo_id: null,
    photo_url: s.photos?.[0]?.url ?? null,
    price_range: '¥',
    atmosphere: null,
    created_at: now,
  }))
}
