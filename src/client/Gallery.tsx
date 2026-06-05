import { Button } from '@cloudflare/kumo/components/button'
import {
  LastTrainCard,
  RestaurantCard,
  RestaurantList,
  RestaurantListSkeleton,
  WeatherBanner,
  type Restaurant,
} from '../ui-components'

// プレースホルダ写真 (Places の実写真は鍵が要るのでギャラリーでは SVG で代用)
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#dce0e8"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#6b7280" font-family="sans-serif" font-size="18">photo</text></svg>`
  )

const SAMPLE: Restaurant[] = [
  {
    id: 's1',
    name: '関内 海鮮酒場 うろこ',
    area: '関内',
    genre: '居酒屋',
    tags: ['海鮮', '日本酒', '★4.5'],
    note: '新鮮な魚介と地酒が自慢のアットホームな居酒屋。',
    atmosphere: '静か',
    price_range: '¥¥',
    address: '神奈川県横浜市中区真砂町3丁目',
    photo_url: PHOTO,
  },
  {
    id: 's2',
    name: '野毛 もつ焼き 大番',
    area: '野毛',
    genre: 'もつ焼き',
    tags: ['もつ', '立ち飲み', '★4.3'],
    note: '煮込みと串が旨い下町の名店。',
    atmosphere: '賑やか',
    price_range: '¥',
    address: null,
    photo_url: PHOTO,
  },
  {
    id: 'ramen:1',
    name: '吉村家',
    area: '横浜',
    genre: '家系ラーメン',
    tags: ['家系', '〆'],
    note: '飲んだあとの〆の一杯に。',
    atmosphere: null,
    price_range: '¥',
    address: null,
    photo_url: PHOTO,
  },
]

const WEATHER = { emoji: '☁️', label: '曇り', tempMax: 22, tempMin: 15, precipProb: 30 }
const LAST_TRAIN = {
  station: '関内駅',
  summary: 'JR根岸線 大船方面 0:09頃 / 横浜方面 0:24頃',
  leaveBy: '23:45',
}

function Item({
  name,
  desc,
  children,
}: {
  name: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section className='gallery__item'>
      <div className='gallery__item-head'>
        <code className='gallery__name'>{name}</code>
        <span className='gallery__desc'>{desc}</span>
      </div>
      <div className='gallery__demo'>{children}</div>
    </section>
  )
}

export function Gallery() {
  return (
    <div className='gallery'>
      <header className='advisor__header'>
        <span className='chat__title'>コンポーネントギャラリー 🧩</span>
        <div className='chat__header-right'>
          <Button type='button' variant='ghost' size='sm' onClick={() => (window.location.href = '/')}>
            ← デモに戻る
          </Button>
        </div>
      </header>

      <div className='gallery__body'>
        <p className='gallery__lead'>
          ご飯アドバイザーの 4 パターンが共通で使う部品キット。Static / Declarative /
          Dynamic はこれらを組み合わせて UI を作ります (Dynamic は Worker 側に同等の自己取得版を持つ)。
        </p>

        <Item name='<WeatherBanner weather />' desc='天気バナー (データは上位から)'>
          <WeatherBanner weather={WEATHER} />
        </Item>

        <Item name='<LastTrainCard lastTrain />' desc='終電案内カード'>
          <LastTrainCard lastTrain={LAST_TRAIN} />
        </Item>

        <Item name='<RestaurantCard restaurant />' desc='お店カード1枚 (写真・ジャンル・タグ・住所)'>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {SAMPLE.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} />
            ))}
          </div>
        </Item>

        <Item name='<RestaurantList restaurants />' desc='お店の一覧 (レスポンシブグリッド)'>
          <RestaurantList restaurants={SAMPLE} />
        </Item>

        <Item name='<RestaurantListSkeleton count />' desc='検索中のローディング'>
          <RestaurantListSkeleton count={3} />
        </Item>
      </div>
    </div>
  )
}
