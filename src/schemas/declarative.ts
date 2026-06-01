import { z } from 'zod'

// 注: OpenAI の strict structured output は全プロパティが required である必要があるため、
// 省略可フィールドは .optional() ではなく .nullable() を使う (Workers AI でも問題なし)

// Declarative の「部品(プリミティブ)」語彙。AI はこの type を選んで並べる。
//  - weather   : 天気バナー (データはホストが渡す)
//  - lastTrain : 終電案内   (データはホストが渡す)
//  - shop      : お店/〆ラーメンのカード (restaurantId で実データに紐づく・写真つき)
export const BlockSchema = z.object({
  type: z.enum(['weather', 'lastTrain', 'shop']).describe('部品の種類'),
  restaurantId: z.string().nullable().describe('type=shop のとき、店候補の id'),
  label: z.string().nullable().describe('type=shop のとき 1軒目 / 2軒目 / 〆 など'),
  note: z.string().nullable().describe('type=shop のとき その店を選んだ理由(短く)'),
})

export const DeclarativeUISchema = z.object({
  title: z.string().nullable(),
  intro: z.string().nullable().describe('天気をふまえたプラン概要 (1〜2文)'),
  blocks: z.array(BlockSchema).describe('上から並べる部品。weather → lastTrain → shop... の順を推奨'),
})

export type DeclarativeUI = z.infer<typeof DeclarativeUISchema>
export type BlockNode = z.infer<typeof BlockSchema>
