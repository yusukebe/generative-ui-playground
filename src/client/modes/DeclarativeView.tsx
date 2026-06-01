import type { DeclarativeUI } from '../../schemas/declarative'
import type { Restaurant } from '../../ui-components'
import { RestaurantCard } from '../../ui-components'

type Weather = {
  emoji: string
  label: string
  tempMax: number | null
  tempMin: number | null
  precipProb: number | null
} | null
type LastTrain = { station: string; summary: string; leaveBy: string } | null

// streamObject の途中状態 (DeepPartial) でも描画できるよう loose に扱う
type PartialBlock = {
  type?: 'weather' | 'lastTrain' | 'shop' | null
  restaurantId?: string | null
  label?: string | null
  note?: string | null
}
type PartialUI = {
  title?: string | null
  intro?: string | null
  blocks?: (PartialBlock | null | undefined)[] | null
}

export function DeclarativeView({
  ui,
  restaurants = [],
  weather = null,
  lastTrain = null,
}: {
  ui: DeclarativeUI | PartialUI
  restaurants?: Restaurant[]
  weather?: Weather
  lastTrain?: LastTrain
}) {
  const u = ui as PartialUI
  const byId = new Map(restaurants.map((r) => [r.id, r]))
  return (
    <div className='declarative'>
      {u.title && <h2 className='declarative__title'>{u.title}</h2>}
      {u.intro && <p className='declarative__intro'>{u.intro}</p>}
      <div className='decl-blocks'>
        {(u.blocks ?? []).filter(Boolean).map((b, i) => (
          <BlockView key={i} block={b as PartialBlock} byId={byId} weather={weather} lastTrain={lastTrain} />
        ))}
      </div>
    </div>
  )
}

function BlockView({
  block,
  byId,
  weather,
  lastTrain,
}: {
  block: PartialBlock
  byId: Map<string, Restaurant>
  weather: Weather
  lastTrain: LastTrain
}) {
  if (block.type === 'weather') {
    if (!weather) return null
    return (
      <div className='decl-weather'>
        {weather.emoji} {weather.label} / 最高{weather.tempMax ?? '?'}℃ / 降水{weather.precipProb ?? '?'}%
      </div>
    )
  }
  if (block.type === 'lastTrain') {
    if (!lastTrain) return null
    return (
      <div className='decl-train'>
        <span className='decl-train__icon'>🚃</span>
        <div>
          <div className='decl-train__head'>終電めやす · {lastTrain.station}</div>
          <div className='decl-train__sub'>
            {lastTrain.summary} ／ お店は <b>{lastTrain.leaveBy}</b> に出る
          </div>
        </div>
      </div>
    )
  }
  if (block.type === 'shop') {
    const r = block.restaurantId ? byId.get(block.restaurantId) : undefined
    return (
      <div className='decl-shop'>
        {block.label && <h3 className='decl-shop__label'>{block.label}</h3>}
        {r ? <RestaurantCard restaurant={r} /> : <div className='decl-shop__pending'>店を選択中…</div>}
        {block.note && <p className='decl-shop__note'>{block.note}</p>}
      </div>
    )
  }
  return null
}
