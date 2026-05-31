import type { Restaurant } from '../../../types'

export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  return (
    <article className='restaurant-card'>
      <div className='restaurant-card__head'>
        <h3 className='restaurant-card__name'>{restaurant.name}</h3>
        <span className='restaurant-card__area'>{restaurant.area}</span>
      </div>
      <div className='restaurant-card__meta'>
        <span className='restaurant-card__genre'>{restaurant.genre}</span>
        {restaurant.atmosphere && (
          <span className='restaurant-card__chip'>{restaurant.atmosphere}</span>
        )}
        {restaurant.price_range && (
          <span className='restaurant-card__chip'>{restaurant.price_range}</span>
        )}
      </div>
      {restaurant.note && <p className='restaurant-card__note'>{restaurant.note}</p>}
      {restaurant.tags.length > 0 && (
        <div className='restaurant-card__tags'>
          {restaurant.tags.map((t) => (
            <span key={t} className='restaurant-card__tag'>
              #{t}
            </span>
          ))}
        </div>
      )}
      {restaurant.address && <div className='restaurant-card__address'>{restaurant.address}</div>}
    </article>
  )
}
