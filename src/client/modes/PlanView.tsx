import type { Plan } from '../../schemas/plan'
import {
  LastTrainCard,
  RestaurantCard,
  WeatherBanner,
  type LastTrainInfo,
  type Restaurant,
  type WeatherInfo,
} from '../../ui-components'

/**
 * Controlled パターンのプラン描画。
 * AI は既製の「プラン」テンプレ (weatherNote / steps / tip) に値を流し込むだけ。
 * 天気/終電/店は**全パターン共通のコンポーネント** (WeatherBanner / LastTrainCard / RestaurantCard) で
 * 固定レイアウトに dispatch する。
 */
export function PlanView({
  plan,
  restaurants,
  weather = null,
  lastTrain = null,
}: {
  plan: Plan | null
  restaurants: Restaurant[]
  weather?: WeatherInfo
  lastTrain?: LastTrainInfo
}) {
  if (!plan) return null
  const byId = new Map(restaurants.map((r) => [r.id, r]))
  return (
    <div className='plan'>
      {plan.title && <h3 className='plan__title'>{plan.title}</h3>}
      <WeatherBanner weather={weather} />
      <LastTrainCard lastTrain={lastTrain} />
      <ol className='plan__steps plan__steps--grid'>
        {plan.steps.map((s, i) => {
          const r = byId.get(s.restaurantId)
          return (
            <li key={i} className='plan__step'>
              <div className='plan__step-label'>{s.label}</div>
              {r ? (
                <RestaurantCard restaurant={r} />
              ) : (
                <div className='plan__step-missing'>{s.restaurantId}</div>
              )}
              {s.why && <p className='plan__why'>💬 {s.why}</p>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
