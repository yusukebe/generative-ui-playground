import type { Restaurant } from '../../../types'
import { RestaurantCard } from './RestaurantCard'

export function RestaurantList({ restaurants }: { restaurants: Restaurant[] }) {
  if (restaurants.length === 0) {
    return <div className='restaurant-list__empty'>該当するお店が見つかりませんでした。</div>
  }
  return (
    <div className='restaurant-list'>
      {restaurants.map((r) => (
        <RestaurantCard key={r.id} restaurant={r} />
      ))}
    </div>
  )
}
