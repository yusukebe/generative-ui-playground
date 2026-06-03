import type { ControlledUI } from '../../schemas/controlled'
import { RestaurantCard, RestaurantList, type Restaurant } from '../../ui-components'

/**
 * Controlled パターンの描画。
 * AI は「既製コンポーネントを 1 つ選ぶ」だけ (list / highlight / ranking)。
 * ここでその選択を事前定義済みコンポーネントに dispatch する。
 */
export function ControlledView({
  ui,
  restaurants,
}: {
  ui: ControlledUI | null
  restaurants: Restaurant[]
}) {
  const component = ui?.component ?? 'list'
  const heading = ui?.heading

  if (component === 'highlight') {
    const featured = restaurants.find((r) => r.id === ui?.featuredId) ?? restaurants[0]
    const rest = restaurants.filter((r) => r.id !== featured?.id)
    return (
      <div className='controlled'>
        {heading && <h3 className='controlled__heading'>{heading}</h3>}
        {featured && (
          <div className='controlled__featured'>
            <span className='controlled__badge'>イチオシ</span>
            <RestaurantCard restaurant={featured} />
          </div>
        )}
        {rest.length > 0 && <RestaurantList restaurants={rest} />}
      </div>
    )
  }

  if (component === 'ranking') {
    return (
      <div className='controlled'>
        {heading && <h3 className='controlled__heading'>{heading}</h3>}
        <ol className='controlled__ranking'>
          {restaurants.map((r, i) => (
            <li key={r.id} className='controlled__rank-item'>
              <span className='controlled__rank-num'>{i + 1}</span>
              <div className='controlled__rank-card'>
                <RestaurantCard restaurant={r} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  // list (デフォルト)
  return (
    <div className='controlled'>
      {heading && <h3 className='controlled__heading'>{heading}</h3>}
      <RestaurantList restaurants={restaurants} />
    </div>
  )
}
