export type Restaurant = {
  id: string
  name: string
  area: string
  address: string | null
  lat: number | null
  lng: number | null
  genre: string
  tags: string[]
  note: string | null
  vision_summary: string | null
  photo_id: string | null
  price_range: string | null
  atmosphere: string | null
  created_at: number
}

export type DbRestaurantRow = Omit<Restaurant, 'tags'> & { tags: string }

export function rowToRestaurant(row: DbRestaurantRow): Restaurant {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }
}
