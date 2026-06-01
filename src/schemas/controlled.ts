import { z } from 'zod'

/**
 * Controlled バンドの語彙。
 * AI は「事前定義された既製コンポーネント」から 1 つ選び、最小限の props を渡すだけ。
 * (Declarative のように構造を自由に組むのではなく、用意された部品を選ぶのが Controlled)
 */
// OpenAI strict structured output 対応のため .optional() ではなく .nullable() を使う
export const ControlledUISchema = z.object({
  component: z
    .enum(['list', 'highlight', 'ranking'])
    .describe('使う既製コンポーネント: list=カード一覧 / highlight=1店を大きく推す / ranking=順位付き'),
  heading: z.string().nullable().describe('一覧の見出し (日本語)'),
  featuredId: z
    .string()
    .nullable()
    .describe("component='highlight' のとき大きく推す店の id (restaurants の id から選ぶ)"),
})

export type ControlledUI = z.infer<typeof ControlledUISchema>
