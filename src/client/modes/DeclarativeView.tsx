import type { DeclarativeUI } from '../../schemas/declarative'
import {
  LastTrainCard,
  RestaurantCard,
  WeatherBanner,
  type LastTrainInfo as LastTrain,
  type Restaurant,
  type WeatherInfo as Weather,
} from '../../ui-components'

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
  if (block.type === 'weather') return <WeatherBanner weather={weather} />
  if (block.type === 'lastTrain') return <LastTrainCard lastTrain={lastTrain} />
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
