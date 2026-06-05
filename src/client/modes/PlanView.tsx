import type { Plan } from '../../schemas/plan'
import {
  LastTrainCard,
  LastTrainCardSkeleton,
  ShopList,
  WeatherBanner,
  WeatherBannerSkeleton,
  isRamen,
  type LastTrainInfo,
  type Restaurant,
  type ShopItem,
  type WeatherInfo,
} from '../../ui-components'

const SCAFFOLD_LABELS = ['1軒目', '2軒目', '〆']

/**
 * Controlled パターンのプラン描画。
 * 旅行プランナーの Static と同様、**部品ごとにスケルトン→データで埋まる**。
 * 収集フェーズで 天気/終電/店 が1つずつ届くので、届くまでは各部品スケルトン、
 * 届いたら実物に置き換える。plan(steps の並びと理由)は最後に LLM から届く。
 * 店の並び(1軒目2軒目の横並び・〆を下に)は ShopList が中で持つ。
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
  // plan 到着後は steps の並び・理由を使う。未到着なら集まった店でスロットを埋める。
  const items: ShopItem[] = plan
    ? plan.steps.map((s) => ({ restaurant: byId.get(s.restaurantId) ?? null, label: s.label, note: s.why || undefined }))
    : (restaurants.length ? restaurants : [null, null, null]).map((r, i) => ({
        restaurant: r,
        label: r ? (isRamen(r) ? '〆' : SCAFFOLD_LABELS[i] ?? `${i + 1}軒目`) : SCAFFOLD_LABELS[i] ?? `${i + 1}軒目`,
      }))
  return (
    <div className='plan'>
      {plan?.title ? <h3 className='plan__title'>{plan.title}</h3> : <div className='plan__title-skeleton' />}

      {weather ? <WeatherBanner weather={weather} /> : <WeatherBannerSkeleton />}
      {lastTrain ? <LastTrainCard lastTrain={lastTrain} /> : <LastTrainCardSkeleton />}

      <ShopList items={items} />
    </div>
  )
}
