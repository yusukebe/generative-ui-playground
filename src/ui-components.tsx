/**
 * Restaurant 提案 UI の共有コンポーネント集。
 *
 * このファイルは 2 箇所から使われる:
 *   1. クライアントの Chat (チャット欄に直接埋め込み)
 *   2. Dynamic Worker サンドボックス (LLM が JSX で借用)
 *
 * Dynamic Worker でも動かすため、すべて **インラインスタイル**で実装する
 * (CSS クラスは iframe や別 Worker からは届かないため)。
 *
 * import は React のみに留め、worker-bundler でバンドル可能な
 * self-contained TSX とする。
 */
import React from 'react'

export type Restaurant = {
  id: string
  name: string
  area: string
  genre: string
  tags: string[]
  note: string | null
  atmosphere: string | null
  price_range: string | null
  address: string | null
  vision_summary?: string | null
  photo_id?: string | null
}

const colors = {
  bg: '#0f1117',
  surface: '#161922',
  surface2: '#1d2230',
  border: '#2a3040',
  text: '#e6e8ee',
  muted: '#8a92a6',
  accent: '#6366f1',
}

export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  return (
    <article
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        color: colors.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{restaurant.name}</h3>
        <span style={{ fontSize: 11, color: colors.muted, whiteSpace: 'nowrap' }}>
          {restaurant.area}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: colors.accent,
            color: 'white',
          }}
        >
          {restaurant.genre}
        </span>
        {restaurant.atmosphere && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: colors.surface2,
              color: colors.muted,
            }}
          >
            {restaurant.atmosphere}
          </span>
        )}
        {restaurant.price_range && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: colors.surface2,
              color: colors.muted,
            }}
          >
            {restaurant.price_range}
          </span>
        )}
      </div>
      {restaurant.note && (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{restaurant.note}</p>
      )}
      {restaurant.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {restaurant.tags.map((t) => (
            <span key={t} style={{ fontSize: 11, color: colors.muted }}>
              #{t}
            </span>
          ))}
        </div>
      )}
      {restaurant.address && (
        <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{restaurant.address}</div>
      )}
    </article>
  )
}

export function RestaurantList({ restaurants }: { restaurants: Restaurant[] }) {
  if (restaurants.length === 0) {
    return (
      <div style={{ color: colors.muted, fontSize: 13, padding: 12 }}>
        該当するお店が見つかりませんでした。
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
      }}
    >
      {restaurants.map((r) => (
        <RestaurantCard key={r.id} restaurant={r} />
      ))}
    </div>
  )
}
