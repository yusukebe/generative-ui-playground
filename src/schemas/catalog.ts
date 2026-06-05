// UI 部品の「契約」を Zod で定義した単一の真実源 (参考デモ旅行プランナーの json-render catalog と同じ発想)。
//
// ここ1か所から:
//   - Declarative: プロンプトの部品リスト生成 + AI が吐いたツリーの検証/正規化
//   - Dynamic:     プロンプトの `declare const` 型宣言を生成 (z.toJSONSchema 経由)
// を導出する。プロンプト・型・検証を手書きで3か所に分散させない。
//
// Declarative と Dynamic は同じ部品名でも props が違う (前者=ホストがデータ注入 / 後者=AI が props で配線)
// ので、エントリは declarative / dynamic を別々に持つ。
import { z } from 'zod'
import type { DeclNode } from './declarative'

// 〆/店データ。Dynamic の props 型として参照する (TS 宣言では `Restaurant` と表示される)。
// プロンプトに見せる最小サブセット (実体は ui-components の Restaurant 型の一部)。
export const RestaurantSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    area: z.string(),
    genre: z.string(),
    tags: z.array(z.string()),
    note: z.string().nullable(),
    price_range: z.string().nullable(),
    photo_url: z.string().nullable().optional(),
  })
  .meta({ id: 'Restaurant' })

// 共通の prop スキーマ
const gap = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).optional()
const level = z.union([z.literal(2), z.literal(3)]).optional()

type DeclEntry = { props: z.ZodObject; children?: boolean; note?: string }
type DynEntry = { props: z.ZodObject; async?: boolean }
export type CatalogEntry = { description: string; declarative?: DeclEntry; dynamic?: DynEntry }

/** UI 部品カタログ。各部品の props を Zod で定義 (= 単一の真実源)。 */
export const CATALOG: Record<string, CatalogEntry> = {
  Stack: {
    description: '縦並びコンテナ',
    declarative: { props: z.object({ gap }), children: true },
  },
  Heading: {
    description: '見出し',
    declarative: { props: z.object({ content: z.string(), level }) },
  },
  Text: {
    description: '説明文 (全体の短い導入・補足のみ。店の紹介には使わない)',
    declarative: { props: z.object({ content: z.string() }) },
  },
  Weather: {
    description: '天気バナー',
    declarative: { props: z.object({}), note: 'データはホストが持つ' },
    dynamic: { props: z.object({ date: z.string(), area: z.string().optional() }), async: true },
  },
  LastTrain: {
    description: '終電案内',
    declarative: { props: z.object({}), note: 'データはホストが持つ' },
    dynamic: { props: z.object({ area: z.string() }) },
  },
  ShopList: {
    description: '店一覧 (1軒目/2軒目の横並びと〆ラーメンの配置を部品が中でやる)',
    declarative: { props: z.object({}), note: '店と〆はこれ1つで全部出る。必ず1つ入れる' },
    dynamic: { props: z.object({ items: z.array(RestaurantSchema) }) },
  },
  RamenList: {
    description: '〆ラーメン一覧 (一覧+各店を内部で取得)',
    dynamic: {
      props: z.object({ count: z.number().optional(), area: z.string().optional() }),
      async: true,
    },
  },
  RestaurantCard: {
    description: 'お店カード1枚',
    dynamic: { props: z.object({ restaurant: RestaurantSchema }) },
  },
  RestaurantList: {
    description: 'お店一覧 (均一グリッド)',
    dynamic: { props: z.object({ restaurants: z.array(RestaurantSchema) }) },
  },
}

// ---- Zod → TS 型シグネチャ (z.toJSONSchema の公開 API で内部依存なし) ----

function tsType(s: Record<string, unknown> | undefined): string {
  if (!s) return 'unknown'
  if (typeof s.$ref === 'string') return s.$ref.split('/').pop() ?? 'unknown' // 例: 'Restaurant'
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (Array.isArray(s.anyOf))
    return s.anyOf.map((x) => tsType(x as Record<string, unknown>)).join(' | ')
  if (Array.isArray(s.type)) return s.type.map((t) => scalar(String(t))).join(' | ')
  if (s.type === 'array') return tsType(s.items as Record<string, unknown>) + '[]'
  if (s.type === 'object') return objSig(s)
  return scalar(String(s.type))
}

function scalar(t: string): string {
  return t === 'integer' ? 'number' : t === 'null' ? 'null' : t
}

function objSig(js: Record<string, unknown>): string {
  const props = (js.properties as Record<string, Record<string, unknown>>) ?? {}
  const req = (js.required as string[]) ?? []
  const keys = Object.keys(props)
  if (!keys.length) return '{}'
  return (
    '{ ' +
    keys.map((k) => `${k}${req.includes(k) ? '' : '?'}: ${tsType(props[k])}`).join('; ') +
    ' }'
  )
}

/** Zod object → `{ field?: type; ... }` の TS シグネチャ文字列。 */
function sig(schema: z.ZodType): string {
  const js = z.toJSONSchema(schema) as Record<string, unknown>
  const ref = typeof js.$ref === 'string' ? js.$ref.split('/').pop() : undefined
  const root = ref ? (js.$defs as Record<string, Record<string, unknown>>)[ref] : js
  return objSig(root)
}

// ---- プロンプト生成 ----

/** Declarative プロンプトの「使える部品」リストを生成。 */
export function declarativeCatalogText(): string {
  return Object.entries(CATALOG)
    .filter(([, e]) => e.declarative)
    .map(([name, e]) => {
      const d = e.declarative!
      const extra = [d.children ? 'children に子ノード' : '', d.note ?? '', e.description]
        .filter(Boolean)
        .join('。')
      return `- ${name} ${sig(d.props)}  ${extra}`
    })
    .join('\n')
}

/** Dynamic プロンプトの `type Restaurant` + `declare const` 宣言ブロックを生成。 */
export function dynamicCatalogText(): string {
  const restaurant = `type Restaurant = ${sig(RestaurantSchema)}`
  const decls = Object.entries(CATALOG)
    .filter(([, e]) => e.dynamic)
    .map(([name, e]) => {
      const d = e.dynamic!
      const note = d.async ? ` (内部で取得・**必ず <Suspense> で包む**)` : ''
      return `declare const ${name}: React.FC<${sig(d.props)}>  // ${e.description}${note}`
    })
    .join('\n')
  return `${restaurant}\n${decls}`
}

// ---- Declarative ツリーの検証/正規化 (カタログの Zod で props を検証) ----

/** AI が吐いたノードをカタログで検証し、props を正規化する。未知 type は children だけ残す。 */
export function validateDeclNode(node: unknown): DeclNode | null {
  if (!node || typeof node !== 'object') return null
  const n = node as { type?: unknown; props?: unknown; children?: unknown }
  const type = String(n.type ?? '')
  const entry = CATALOG[type]?.declarative
  const rawChildren = Array.isArray(n.children) ? n.children : []
  const children = rawChildren.map(validateDeclNode).filter((c): c is DeclNode => c !== null)
  if (!entry) {
    // 未知 type: 壊さず children だけ残す (renderer の従来挙動と合わせる)
    return children.length ? { type, props: {}, children } : null
  }
  const parsed = entry.props.safeParse(n.props ?? {})
  return {
    type,
    props: (parsed.success ? parsed.data : {}) as DeclNode['props'],
    children: entry.children ? children : [],
  }
}
