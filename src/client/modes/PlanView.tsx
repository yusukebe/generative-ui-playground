import type { Plan } from '../../schemas/plan'
import { RestaurantCard, type Restaurant } from '../../ui-components'

/**
 * Controlled バンドのプラン描画。
 * AI は既製の「プラン」テンプレ (weatherNote / steps / tip) に値を流し込むだけ。
 * ここで固定レイアウトに dispatch する。
 */
export function PlanView({ plan, restaurants }: { plan: Plan | null; restaurants: Restaurant[] }) {
  if (!plan) return null
  const byId = new Map(restaurants.map((r) => [r.id, r]))
  return (
    <div className='plan'>
      {plan.title && <h3 className='plan__title'>{plan.title}</h3>}
      {plan.weatherNote && <div className='plan__weather'>☔️ {plan.weatherNote}</div>}
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
      {plan.tip && <div className='plan__tip'>📝 {plan.tip}</div>}
    </div>
  )
}
