import {
  LastTrainCard,
  LastTrainCardSkeleton,
  RestaurantCardSkeleton,
  RestaurantListSkeleton,
  ShopList,
  WeatherBanner,
  WeatherBannerSkeleton,
  type LastTrainInfo,
  type Restaurant,
  type WeatherInfo,
} from '../../ui-components'

type Step = { tool: string; output: unknown }

// どのツールを呼ぶかは LLM(=出る部品の集合は可変)だが、表示順はホストが固定する。
// (参考実装は LLM のツールコール順そのままだが、順が不自然に見えるのでここは固定)
const ORDER = ['get_weather', 'search_restaurants', 'get_ramen', 'get_last_train']

function renderStep(tool: string, output: unknown) {
  switch (tool) {
    case 'get_weather':
      return <WeatherBanner weather={output as WeatherInfo} />
    case 'get_last_train':
      return <LastTrainCard lastTrain={output as LastTrainInfo} />
    case 'search_restaurants':
    case 'get_ramen':
      // ShopList が居酒屋(横グリッド)/〆ラーメン(専用カード)を id で振り分ける
      return <ShopList items={(output as Restaurant[]) ?? []} />
    default:
      return null
  }
}

// ツール実行中(呼ばれたがまだ出力が来てない)はそのツール専用スケルトン
function renderSkeleton(tool: string) {
  switch (tool) {
    case 'get_weather':
      return <WeatherBannerSkeleton />
    case 'get_last_train':
      return <LastTrainCardSkeleton />
    case 'search_restaurants':
      return <RestaurantListSkeleton count={2} />
    case 'get_ramen':
      return <RestaurantCardSkeleton />
    default:
      return null
  }
}

export function StaticView({
  steps,
  runningTools,
  title,
}: {
  steps: Step[]
  runningTools: string[]
  title?: string
}) {
  const doneByTool = new Map(steps.map((s) => [s.tool, s.output]))
  return (
    <div className='plan'>
      {/* タイトルはホスト固定なので即表示 */}
      {title && <h3 className='plan__title'>{title}</h3>}
      {/* 固定順に「完了→部品 / 実行中→スケルトン / 未呼出→何も出さない」 */}
      {ORDER.map((tool) => {
        const node = doneByTool.has(tool)
          ? renderStep(tool, doneByTool.get(tool))
          : runningTools.includes(tool)
            ? renderSkeleton(tool)
            : null
        return node ? <div key={tool}>{node}</div> : null
      })}
    </div>
  )
}
