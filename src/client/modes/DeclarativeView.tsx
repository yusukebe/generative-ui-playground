import type { DeclNode } from '../../schemas/declarative'
import {
  LastTrainCard,
  RestaurantCard,
  RestaurantCardSkeleton,
  ShopList,
  WeatherBanner,
  type LastTrainInfo,
  type Restaurant,
  type WeatherInfo,
} from '../../ui-components'

// gap/columns の数値 → 実際の値
const GAP: Record<number, number> = { 0: 0, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 }
const gapPx = (g?: number) => GAP[g ?? 4] ?? 16

type Ctx = {
  byId: Map<string, Restaurant>
  list: Restaurant[]
  weather: WeatherInfo
  lastTrain: LastTrainInfo
  shopListShown: boolean // ShopList は1つだけ描く (AI が複数置いても重複させない)
}

/**
 * Declarative パターン = AI が組んだ UIツリーを再帰描画する (参考デモの json-render と同じ)。
 * 型ごとに props が違い、レイアウト(Stack/Grid)・並び・位置は AI が決めている。
 */
function renderNode(node: DeclNode | null | undefined, ctx: Ctx, key?: number): React.ReactNode {
  if (!node || typeof node !== 'object') return null
  const props = node.props ?? {}
  const children = Array.isArray(node.children) ? node.children : []
  const kids = children.map((c, i) => renderNode(c, ctx, i))

  switch (node.type) {
    case 'Stack':
      return (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: gapPx(props.gap) }}>
          {kids}
        </div>
      )
    case 'Grid':
      return (
        <div
          key={key}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${props.columns ?? 2}, minmax(0, 1fr))`,
            gap: gapPx(props.gap),
          }}
        >
          {kids}
        </div>
      )
    case 'Heading':
      return (
        <p key={key} className='decl-heading' data-level={props.level ?? 2}>
          {String(props.content ?? '')}
        </p>
      )
    case 'Text':
      return (
        <p key={key} className='decl-text'>
          {String(props.content ?? '')}
        </p>
      )
    case 'Weather':
      return <WeatherBanner key={key} weather={ctx.weather} />
    case 'LastTrain':
      return <LastTrainCard key={key} lastTrain={ctx.lastTrain} />
    case 'ShopList':
      // 店の並び(1軒目2軒目の横並び・〆を下に)は ShopList が中で持つ。
      // AI が複数 ShopList を置いても、2つ目以降は描画しない(店の重複を防ぐ)。
      if (ctx.shopListShown) return null
      ctx.shopListShown = true
      return <ShopList key={key} items={ctx.list} />
    case 'Shop': {
      const r = props.restaurantId ? ctx.byId.get(props.restaurantId) : undefined
      return (
        <div key={key} className='decl-shop'>
          {props.label && <h3 className='decl-shop__label'>{String(props.label)}</h3>}
          {r ? <RestaurantCard restaurant={r} /> : <RestaurantCardSkeleton />}
          {props.note && <p className='decl-shop__note'>{String(props.note)}</p>}
        </div>
      )
    }
    default:
      // 未知の type は children だけ描く (壊さない)
      return kids.length ? <div key={key}>{kids}</div> : null
  }
}

export function DeclarativeView({
  ui,
  restaurants = [],
  weather = null,
  lastTrain = null,
}: {
  ui: DeclNode | null
  restaurants?: Restaurant[]
  weather?: WeatherInfo
  lastTrain?: LastTrainInfo
}) {
  const ctx: Ctx = {
    byId: new Map(restaurants.map((r) => [r.id, r])),
    list: restaurants,
    weather,
    lastTrain,
    shopListShown: false,
  }
  return <div className='declarative'>{renderNode(ui, ctx)}</div>
}
