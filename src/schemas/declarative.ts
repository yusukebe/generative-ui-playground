import { z } from 'zod'

// 注: OpenAI の strict structured output は全プロパティが required である必要があるため、
// 省略可フィールドは .optional() ではなく .nullable() を使う (Workers AI でも問題なし)
export const CardSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  body: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  variant: z.enum(['default', 'highlight']).nullable(),
  // 店候補の id。指定すると写真付きの実カードで描画される (ホストが解決)
  restaurantId: z.string().nullable(),
})

export const SectionSchema = z.object({
  heading: z.string().nullable(),
  description: z.string().nullable(),
  cards: z.array(CardSchema),
})

export const DeclarativeUISchema = z.object({
  title: z.string().nullable(),
  intro: z.string().nullable(),
  sections: z.array(SectionSchema),
})

export type DeclarativeUI = z.infer<typeof DeclarativeUISchema>
export type CardNode = z.infer<typeof CardSchema>
export type SectionNode = z.infer<typeof SectionSchema>
