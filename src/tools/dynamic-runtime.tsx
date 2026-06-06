// @ts-nocheck
// Dynamic Worker (Code Mode) のランタイム。AI が書いた App から借用される
// 非同期フック + worker 用コンポーネントを定義する。
//
// このファイルは `?raw` でソースとして読み込まれ、Dynamic Worker の
// `src/restaurant-ui.tsx` として埋め込まれる (dynamic-render.ts 参照)。
// import している `./base-ui` は worker バンドル内の仮想モジュール (= ui-components.tsx)
// なので、アプリ側からは解決できない。そのため型チェックは無効化している
// (worker ランタイム専用コードであり、本質的にアプリ側では動かない)。
import React, { Suspense } from 'react'
import { RestaurantCard, RamenCard, ShopList } from './base-ui'
export { RestaurantCard, ShopList } from './base-ui'

// 1レンダー内で同じ fetch を使い回すキャッシュ (worker はリクエストごとに新規 spawn なので OK)
const _cache = new Map()

// 〆ラーメンを Ramen API から取得して suspend するフック。<Suspense> の中で呼ぶ。
// id は 'ramen:xxx' でも 'xxx' でも可。取得後は restaurant 形のオブジェクトを返す。
export function useRamenShop(id) {
  const shopId = String(id).replace('ramen:', '')
  let e = _cache.get(shopId)
  if (!e) {
    e = { done: false, data: null }
    // 〆ラーメンを取得して suspend (人工遅延なし・実 fetch のみ)
    e.promise = Promise.resolve()
      .then(() => fetch('https://ramen-api.dev/shops/' + shopId))
      .then((r) => r.json())
      .then((d) => {
        const s = d && d.shop
        e.data = s
          ? {
              id: 'ramen:' + s.id,
              name: s.name,
              area: s.prefecture || '',
              genre: 'ラーメン',
              tags: ['ラーメン', '〆'],
              note: '飲んだあとの〆の一杯に',
              address: null,
              price_range: '¥',
              atmosphere: null,
              photo_url: (s.photos && s.photos[0] && s.photos[0].url) || null,
            }
          : null
      })
      .catch(() => {
        e.data = null
      })
      .finally(() => {
        e.done = true
      })
    _cache.set(shopId, e)
  }
  if (!e.done) throw e.promise
  return e.data
}

const _shimmer = {
  background: 'linear-gradient(90deg, #eef0f4 25%, #ffffff 50%, #eef0f4 75%)',
  backgroundSize: '200% 100%',
  animation: 'rc-shimmer 1.2s infinite',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontSize: 13,
  fontWeight: 600,
}

// ローディング用スケルトン (カード高さに合わせてレイアウトシフトを防ぐ)
export function CardSkeleton() {
  return (
    <div style={{ ..._shimmer, height: 236, borderRadius: 14, border: '1px solid #dce0e8' }}>
      ⏳ 取得中… (Suspense)
    </div>
  )
}

// 天気バナー用のスケルトン (細い・バナーと同じ高さ)
export function WeatherSkeleton() {
  return (
    <div style={{ ..._shimmer, height: 52, borderRadius: 14 }}>⏳ 天気を取得中… (Suspense)</div>
  )
}

// 〆ラーメンの葉 (居酒屋カードとは別UI・ラーメン専用)。id を渡すと useRamenShop で
// per-item 取得して描画。<Suspense> の中で使う。さらに凝るなら useRamenShop で自作も可。
export function Ramen({ id }) {
  const r = useRamenShop(id)
  if (!r) return null
  // 見た目は共有の RamenCard に統一 (Static/Declarative と同じ〆カード)
  return <RamenCard restaurant={r} />
}

// エリア→都道府県 (Ramen API の prefecture フィルタ用)
function _prefFor(area) {
  const a = String(area || '')
  if (
    ['札幌', 'すすきの', 'ススキノ', '大通', '狸小路', '中島公園', '北海道'].some((m) =>
      a.includes(m)
    )
  )
    return '北海道'
  return '神奈川県'
}

// 〆ラーメンの一覧を自分で取得して suspend するフック (ramen-api はキー不要なので worker が直接叩ける)。
// area に合う都道府県で絞り込む。
const _rlcache = new Map()
export function useRamenList(count, area) {
  const pref = _prefFor(area)
  const key = 'list:' + count + ':' + pref
  let e = _rlcache.get(key)
  if (!e) {
    e = { done: false, data: [] }
    e.promise = Promise.resolve()
      // 多めに取得してランダムに count 件 (北海道はたくさん登録があるので毎回違う〆に)
      .then(() =>
        fetch('https://ramen-api.dev/shops?perPage=100&prefecture=' + encodeURIComponent(pref))
      )
      .then((r) => r.json())
      .then((d) => {
        const shops = ((d && d.shops) || []).slice().sort(() => Math.random() - 0.5)
        e.data = shops.slice(0, count || 1).map((s) => ({ id: s.id, name: s.name }))
      })
      .catch(() => {
        e.data = []
      })
      .finally(() => {
        e.done = true
      })
    _rlcache.set(key, e)
  }
  if (!e.done) throw e.promise
  return e.data
}

// 〆ラーメン一覧。count と area を渡すと worker が該当エリアの一覧を取得し、各店を per-item Suspense で描画。
// **必ず <Suspense> の中で使う** (一覧取得自体が suspend する)。
export function RamenList({ count = 1, area }) {
  const list = useRamenList(count, area)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 320px))',
        gap: 12,
        justifyContent: 'start',
      }}
    >
      {list.map((r) => (
        <Suspense key={r.id} fallback={<CardSkeleton />}>
          <Ramen id={r.id} />
        </Suspense>
      ))}
    </div>
  )
}

// エリア→緯度経度 (札幌 / 横浜)。それ以外は横浜。
function _coordsFor(area) {
  const a = String(area || '')
  if (
    ['札幌', 'すすきの', 'ススキノ', '大通', '狸小路', '中島公園', '北海道'].some((m) =>
      a.includes(m)
    )
  )
    return { lat: 43.0618, lon: 141.3545 }
  return { lat: 35.4437, lon: 139.638 }
}

// 天気を自分で取得して suspend するフック (worker から Open-Meteo を直接叩く)
const _wcache = new Map()
export function useWeather(date, area) {
  const { lat, lon } = _coordsFor(area)
  const key = date + '@' + lat
  let e = _wcache.get(key)
  if (!e) {
    e = { done: false, data: null }
    // 天気を取得して suspend (人工遅延なし・実 fetch のみ)
    e.promise = Promise.resolve()
      .then(() =>
        fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=' +
            lat +
            '&longitude=' +
            lon +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16'
        )
      )
      .then((r) => r.json())
      .then((d) => {
        const days = (d.daily && d.daily.time) || []
        const i = days.indexOf(date)
        if (i < 0) {
          e.data = null
          return
        }
        const code = d.daily.weather_code[i]
        const label =
          code === 0
            ? '快晴'
            : code <= 2
              ? '晴れ時々曇り'
              : code === 3
                ? '曇り'
                : code <= 48
                  ? '霧'
                  : code <= 67
                    ? '雨'
                    : code <= 77
                      ? '雪'
                      : code <= 82
                        ? 'にわか雨'
                        : code <= 99
                          ? '雷雨'
                          : '不明'
        const emoji =
          code === 0
            ? '☀️'
            : code <= 2
              ? '🌤️'
              : code === 3
                ? '☁️'
                : code <= 67
                  ? '🌧️'
                  : code <= 77
                    ? '🌨️'
                    : '⛈️'
        e.data = {
          date,
          label,
          emoji,
          tempMax: d.daily.temperature_2m_max[i],
          tempMin: d.daily.temperature_2m_min[i],
          precipProb: d.daily.precipitation_probability_max[i],
        }
      })
      .catch(() => {
        e.data = null
      })
      .finally(() => {
        e.done = true
      })
    _wcache.set(key, e)
  }
  if (!e.done) throw e.promise
  return e.data
}

// 天気バナー。date(と area)を渡すと中で自分で取得して描画する。**<Suspense> の中で使う**。
export function Weather({ date, area }) {
  const w = useWeather(date, area)
  if (!w) return null
  return (
    <div
      style={{
        border: '1px solid #dce0e8',
        borderRadius: 12,
        padding: '12px 14px',
        background: '#fff',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 26, lineHeight: 1 }}>{w.emoji}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{w.label}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          最高 {w.tempMax}℃ ・ 最低 {w.tempMin}℃ ・ 降水 {w.precipProb}%
        </div>
      </div>
    </div>
  )
}

// 終電案内。area を渡すと最寄り駅・終電目安を表示 (静的・fetch しないので Suspense 不要)。
const _trains = [
  {
    m: ['関内', '伊勢佐木', '馬車道'],
    s: '関内駅',
    t: 'JR根岸線/市営地下鉄 0:00〜0:24頃',
    l: '23:45',
  },
  { m: ['桜木町', '野毛'], s: '桜木町駅', t: 'JR根岸線/市営地下鉄 0:02〜0:26頃', l: '23:45' },
  { m: ['みなとみらい'], s: 'みなとみらい駅', t: 'みなとみらい線 0:10〜0:30頃', l: '23:50' },
  {
    m: ['中華街', '元町', '山下'],
    s: '元町・中華街駅',
    t: 'みなとみらい線 0:07頃 (始発)',
    l: '23:45',
  },
  { m: ['横浜'], s: '横浜駅', t: '各線 0:30前後まで', l: '0:00' },
  {
    m: ['すすきの', 'ススキノ', '狸小路'],
    s: 'すすきの駅',
    t: '市営地下鉄南北線 真駒内方面 0:00頃 / 麻生方面 0:12頃',
    l: '23:40',
  },
  {
    m: ['大通', '中島公園'],
    s: '大通駅',
    t: '地下鉄 南北線/東西線/東豊線 各 0:00〜0:24頃',
    l: '23:45',
  },
  { m: ['札幌', '北海道'], s: '札幌駅', t: 'JR各線・地下鉄 0:00〜0:30前後', l: '23:50' },
]
export function LastTrain({ area }) {
  const a = area || ''
  const hit = _trains.find((e) => e.m.some((m) => a.includes(m)))
  const e = hit || { s: a + '周辺の駅', t: '概ね 0:00〜0:30頃', l: '23:45' }
  return (
    <div
      style={{
        border: '1px solid #dce0e8',
        borderRadius: 12,
        padding: '12px 14px',
        background: '#fff',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 22 }}>🚃</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>終電めやす · {e.s}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {e.t} ／ お店は <b>{e.l}</b> に出る
        </div>
      </div>
    </div>
  )
}

// 手元データの一覧 (fetch も Suspense もしない・即描画)
export function RestaurantList({ restaurants }) {
  const list = (restaurants || []).filter(Boolean)
  if (list.length === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: 13, padding: 12 }}>
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
      {list.map((r) => (
        <RestaurantCard key={r.id} restaurant={r} />
      ))}
    </div>
  )
}
