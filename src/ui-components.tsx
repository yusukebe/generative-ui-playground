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
  photo_url?: string | null
}

const colors = {
  bg: '#f7f8fa',
  surface: '#ffffff',
  surface2: '#eef0f4',
  border: '#dce0e8',
  text: '#1a1d26',
  muted: '#6b7280',
  accent: '#f97316',
}

export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  // Dynamic パターンで AI が書いたコードが undefined を渡しても SSR 全体を巻き込まない
  if (!restaurant) return null
  return (
    <article
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'hidden',
        // 縦1カラムに置かれても全幅に間延びしないよう上限を持たせる (写真が横長に潰れるのを防ぐ)
        width: '100%',
        maxWidth: 360,
        color: colors.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      {restaurant.photo_url && (
        <img
          src={restaurant.photo_url}
          alt={restaurant.name}
          loading='lazy'
          style={{
            width: '100%',
            height: 140,
            objectFit: 'cover',
            display: 'block',
            background: colors.surface2,
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.35, wordBreak: 'break-word' }}>
          {restaurant.name}
        </h3>
        <span style={{ fontSize: 11, color: colors.muted }}>{restaurant.area}</span>
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
      </div>
    </article>
  )
}

/** id が「ramen:」で始まる店は〆ラーメン専用カードで描く。 */
export const isRamen = (r?: Restaurant | null) => !!r && typeof r.id === 'string' && r.id.startsWith('ramen:')

/**
 * 〆ラーメン専用カード (オレンジ枠)。RestaurantCard とは別 UI。
 * 全パターン共通。データは props で渡す (Dynamic では RamenList が内部で使う)。
 */
export function RamenCard({ restaurant }: { restaurant: Restaurant | null }) {
  if (!restaurant) return <RestaurantCardSkeleton />
  return (
    <div
      style={{
        border: `2px solid ${colors.accent}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: '#fff7ed',
        width: '100%',
        maxWidth: 360,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      {restaurant.photo_url && (
        <img
          src={restaurant.photo_url}
          alt={restaurant.name}
          loading='lazy'
          style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', background: colors.surface2 }}
        />
      )}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.accent, letterSpacing: '0.05em' }}>🍜 〆の一杯</div>
        <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700 }}>{restaurant.name}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: colors.muted }}>
          {restaurant.area} · {restaurant.genre || 'ラーメン'}
        </p>
      </div>
    </div>
  )
}

export type WeatherInfo = {
  emoji: string
  label: string
  tempMax: number | null
  tempMin: number | null
  precipProb: number | null
} | null

/** 天気バナー (全パターン共通)。データは上位から渡す。フラットで Kumo っぽく。 */
export function WeatherBanner({ weather }: { weather: WeatherInfo }) {
  if (!weather) return null
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        background: colors.surface,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        color: colors.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      <span style={{ fontSize: 26, lineHeight: 1 }}>{weather.emoji}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{weather.label}</div>
        <div style={{ fontSize: 12, color: colors.muted }}>
          最高 {weather.tempMax ?? '?'}℃ ・ 最低 {weather.tempMin ?? '?'}℃ ・ 降水{' '}
          {weather.precipProb ?? '?'}%
        </div>
      </div>
    </div>
  )
}

export type LastTrainInfo = { station: string; summary: string; leaveBy: string } | null

/** 終電案内カード (全パターン共通)。 */
export function LastTrainCard({ lastTrain }: { lastTrain: LastTrainInfo }) {
  if (!lastTrain) return null
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        background: colors.surface,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        color: colors.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      <span style={{ fontSize: 22 }}>🚃</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>終電めやす · {lastTrain.station}</div>
        <div style={{ fontSize: 12, color: colors.muted }}>
          {lastTrain.summary} ／ お店は <b>{lastTrain.leaveBy}</b> に出る
        </div>
      </div>
    </div>
  )
}

// 部品ごとのスケルトン (収集中はその部品だけスケルトン→データで実物に置き換わる)
const _skel = {
  background: `linear-gradient(90deg, ${colors.surface2} 25%, ${colors.surface} 50%, ${colors.surface2} 75%)`,
  backgroundSize: '200% 100%',
  animation: 'rc-shimmer 1.2s infinite',
  border: `1px solid ${colors.border}`,
}

/** 天気バナーのスケルトン (バナー高さに合わせる) */
export function WeatherBannerSkeleton() {
  return <div style={{ ..._skel, height: 52, borderRadius: 12 }} />
}

/** 終電カードのスケルトン */
export function LastTrainCardSkeleton() {
  return <div style={{ ..._skel, height: 52, borderRadius: 12 }} />
}

/** お店カード1枚のスケルトン (カード高さに合わせてレイアウトシフトを防ぐ) */
export function RestaurantCardSkeleton() {
  return <div style={{ ..._skel, height: 260, width: '100%', maxWidth: 360, borderRadius: 12 }} />
}

/** 検索中に出すスケルトン (記事いわく「ないと不安」レベルの体験差) */
export function RestaurantListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
        gap: 12,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 168,
            borderRadius: 12,
            background: `linear-gradient(90deg, ${colors.surface2} 25%, ${colors.surface} 50%, ${colors.surface2} 75%)`,
            backgroundSize: '200% 100%',
            border: `1px solid ${colors.border}`,
            animation: 'rc-shimmer 1.2s infinite',
          }}
        />
      ))}
    </div>
  )
}

// ShopList の1要素。生の Restaurant でも、ラベル/メモ付きでも渡せる。
export type ShopItem =
  | Restaurant
  | { restaurant: Restaurant | null; label?: string; note?: string }

function normalizeShopItem(it: ShopItem | null | undefined): {
  restaurant: Restaurant | null
  label?: string
  note?: string
} {
  if (!it) return { restaurant: null }
  if ('restaurant' in it) return it
  return { restaurant: it as Restaurant }
}

const IZAKAYA_LABELS = ['1軒目', '2軒目', '3軒目', '4軒目']

/**
 * プランの店リストを **レイアウトごと** 受け持つ高レベル共有部品 (全パターン共通)。
 * - 居酒屋系(id が ramen: 以外)は横並びグリッドに自動配置
 * - 〆ラーメン(id が ramen:)は専用カードで下に単独配置
 * これにより「2枚をGrid・1枚を下」のような配置をホスト/AI が考える必要がない。
 * 参考デモの ItineraryTimeline と同じ発想 (部品が中の並びを持つ)。
 */
export function ShopList({ items = [] }: { items?: ShopItem[] }) {
  const norm = (items ?? []).map(normalizeShopItem)
  const izakaya = norm.filter((n) => !isRamen(n.restaurant))
  const ramen = norm.filter((n) => isRamen(n.restaurant))
  const labelStyle = { color: colors.accent, fontWeight: 700, fontSize: 13 } as const
  const noteStyle = { margin: '2px 0 0', fontSize: 12, color: colors.muted } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 320px))',
          gap: 12,
          justifyContent: 'start',
        }}
      >
        {izakaya.map((it, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={labelStyle}>{it.label || IZAKAYA_LABELS[i] || `${i + 1}軒目`}</div>
            {it.restaurant ? <RestaurantCard restaurant={it.restaurant} /> : <RestaurantCardSkeleton />}
            {it.note && <p style={noteStyle}>{it.note}</p>}
          </div>
        ))}
      </div>
      {ramen.map((it, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={labelStyle}>{it.label || '〆'}</div>
          <RamenCard restaurant={it.restaurant} />
          {it.note && <p style={noteStyle}>{it.note}</p>}
        </div>
      ))}
    </div>
  )
}

export function RestaurantList({ restaurants }: { restaurants: Restaurant[] }) {
  // AI が書いたコードが null/undefined 混じりの配列を渡しても落ちないように
  restaurants = (restaurants ?? []).filter(Boolean)
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
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
        gap: 12,
      }}
    >
      {restaurants.map((r) => (
        <RestaurantCard key={r.id} restaurant={r} />
      ))}
    </div>
  )
}
