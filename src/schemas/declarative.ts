// Declarative パターン = AI が「UIツリー」を組む (参考デモの json-render と同じ発想)。
// 型ごとに props が違い、レイアウト(Stack/Grid)・並び・位置を AI 自身が決める。
// zod の strict structured output は「型別 props のツリー」が苦手なので、
// streamObject ではなく streamText で JSON を吐かせて host でパースする。

/** UIツリーのノード。type ごとに props が異なる。children は子ノードの配列。 */
export type DeclNode = {
  type: 'Stack' | 'Grid' | 'Heading' | 'Text' | 'Weather' | 'LastTrain' | 'ShopList' | 'Shop' | string
  props?: {
    // レイアウト系
    gap?: number
    columns?: number
    // テキスト系
    content?: string
    level?: number
    // Shop 系 (単体 Shop の後方互換用。通常は ShopList を使う)
    restaurantId?: string
    label?: string
    note?: string
    [k: string]: unknown
  }
  children?: DeclNode[]
}

/** Declarative の最終出力 = ルートノード1つ (入れ子ツリー)。 */
export type DeclarativeUI = DeclNode
