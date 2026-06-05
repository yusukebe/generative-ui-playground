import type { Plan } from '../../schemas/plan'
import {
  LastTrainCard,
  LastTrainCardSkeleton,
  RestaurantCard,
  RestaurantCardSkeleton,
  WeatherBanner,
  WeatherBannerSkeleton,
  type LastTrainInfo,
  type Restaurant,
  type WeatherInfo,
} from '../../ui-components'

const SCAFFOLD_LABELS = ['1軒目', '2軒目', '〆']

/**
 * Controlled パターンのプラン描画。
 * 旅行プランナーの Static と同様、**部品ごとにスケルトン→データで埋まる**。
 * 収集フェーズで 天気/終電/店 が1つずつ届くので、届くまでは各部品スケルトン、
 * 届いたら実物に置き換える。plan(steps の並びと理由)は最後に LLM から届く。
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
  const byId = new Map(restaurants.map((r) => [r.id, r]))
  return (
    <div className='plan'>
      {plan?.title ? <h3 className='plan__title'>{plan.title}</h3> : <div className='plan__title-skeleton' />}

      {weather ? <WeatherBanner weather={weather} /> : <WeatherBannerSkeleton />}
      {lastTrain ? <LastTrainCard lastTrain={lastTrain} /> : <LastTrainCardSkeleton />}

      <ol className='plan__steps plan__steps--grid'>
        {plan
          ? plan.steps.map((s, i) => {
              const r = byId.get(s.restaurantId)
              return (
                <li key={i} className='plan__step'>
                  <div className='plan__step-label'>{s.label}</div>
                  {r ? <RestaurantCard restaurant={r} /> : <RestaurantCardSkeleton />}
                  {s.why && <p className='plan__why'>💬 {s.why}</p>}
                </li>
              )
            })
          : // plan 未到着: 想定スロット(店数 or 3)を並べ、店データが来た分だけ実カードに
            Array.from({ length: restaurants.length || 3 }).map((_, i) => (
              <li key={i} className='plan__step'>
                <div className='plan__step-label'>{SCAFFOLD_LABELS[i] ?? `${i + 1}軒目`}</div>
                {restaurants[i] ? (
                  <RestaurantCard restaurant={restaurants[i]} />
                ) : (
                  <RestaurantCardSkeleton />
                )}
              </li>
            ))}
      </ol>
    </div>
  )
}
