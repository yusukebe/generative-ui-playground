/**
 * Google Places API (New) の Text Search をデータソースに使う。
 * 検索結果を D1 と同じ Restaurant 型へマップして返すので、上位層は
 * D1 か Places かを意識しなくてよい (search-restaurants.ts でフォールバック制御)。
 *
 * 参考デモ (peintangos/generative-ui-sample-by-vercel) と同じく
 * places.googleapis.com/v1/places:searchText を叩く。
 */
import { decodeUnicodeEscapes, type Restaurant } from '../types'
import type { SearchInput } from './search-restaurants'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

// 必要なフィールドだけ取得する (課金は取得フィールドに依存するため絞る)
// UI で実際に使うフィールドだけ取得 (レスポンスを軽く・課金も抑える)。
// location(緯度経度)・userRatingCount は未使用なので外した。
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.editorialSummary',
  'places.rating',
  'places.priceLevel',
  'places.photos',
].join(',')

type PlacesResponse = {
  places?: Array<{
    id: string
    displayName?: { text?: string }
    formattedAddress?: string
    location?: { latitude?: number; longitude?: number }
    primaryTypeDisplayName?: { text?: string }
    editorialSummary?: { text?: string }
    rating?: number
    userRatingCount?: number
    priceLevel?: string
    photos?: Array<{ name?: string }>
  }>
}

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: '¥',
  PRICE_LEVEL_MODERATE: '¥¥',
  PRICE_LEVEL_EXPENSIVE: '¥¥¥',
  PRICE_LEVEL_VERY_EXPENSIVE: '¥¥¥¥',
}

/** area/genre/atmosphere/query を 1 本のテキストクエリに束ねる */
function buildTextQuery(input: SearchInput): string {
  const parts = [input.area, input.genre, input.atmosphere, input.query]
    .map((s) => (s ? decodeUnicodeEscapes(s).trim() : ''))
    .filter(Boolean)
  const q = parts.join(' ')
  // 横浜・関内周辺に寄せる (題材がローカルなため)
  return q.includes('横浜') ? q : `${q} 横浜`.trim()
}

export async function searchPlaces(apiKey: string, input: SearchInput): Promise<Restaurant[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: buildTextQuery(input),
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: Math.min(input.limit ?? 5, 10),
      includedType: 'restaurant',
    }),
  })

  if (!res.ok) {
    throw new Error(`Places API ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as PlacesResponse
  const now = Date.now()

  return (data.places ?? []).map((p) => {
    const rating = p.rating
    const tags: string[] = []
    if (p.primaryTypeDisplayName?.text) tags.push(p.primaryTypeDisplayName.text)
    if (rating) tags.push(`★${rating.toFixed(1)}`)
    if (p.priceLevel && PRICE_LABEL[p.priceLevel]) tags.push(PRICE_LABEL[p.priceLevel])

    // 写真はキーを隠すため自前プロキシ経由の URL にする (index.tsx の /api/places-photo)
    const photoName = p.photos?.[0]?.name
    const photo_url = photoName ? `/api/places-photo?name=${encodeURIComponent(photoName)}` : null

    return {
      id: p.id,
      name: p.displayName?.text ?? '(名称不明)',
      area: input.area ? decodeUnicodeEscapes(input.area) : (p.formattedAddress ?? ''),
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      genre: p.primaryTypeDisplayName?.text ?? (input.genre ? decodeUnicodeEscapes(input.genre) : ''),
      tags,
      note: p.editorialSummary?.text ?? null,
      vision_summary: null,
      photo_id: null,
      photo_url,
      price_range: p.priceLevel ? (PRICE_LABEL[p.priceLevel] ?? null) : null,
      atmosphere: input.atmosphere ? decodeUnicodeEscapes(input.atmosphere) : null,
      created_at: now,
    } satisfies Restaurant
  })
}
