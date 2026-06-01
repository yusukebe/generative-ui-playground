import { z } from 'zod'

// 抽出するプラン条件 (intake で埋める)
export type PlanParams = {
  date: string // YYYY-MM-DD
  dateLabel: string // 「来週の月曜 (6/8)」など人間向け表記
  area: string
  partySize: number
  purpose: string // デート / 接待 / 友人 / 一人 など
  mood: string // 静か / 賑やか など (空でも可)
  craving: string // 食べたいもの・料理ジャンル (もつ / 海鮮 / 中華 など。空でも可)
}

// intake: 1行入力から条件を抽出。足りなければ ready=false + question を返す
// (OpenAI strict 対応のため省略可は nullable)
export const IntakeSchema = z.object({
  ready: z.boolean().describe('日付・エリア・人数が揃っていれば true'),
  question: z.string().nullable().describe('ready=false のとき、不足を埋める短い質問を1つ'),
  date: z.string().nullable().describe('YYYY-MM-DD。今日の日付を基準に「来週の月曜」等を解決'),
  dateLabel: z.string().nullable().describe('人間向けの日付表記 (例: 来週の月曜 (6/8))'),
  area: z.string().nullable().describe('エリア (関内 / 中華街 / 野毛 / みなとみらい 等)'),
  partySize: z.number().nullable().describe('人数'),
  purpose: z.string().nullable().describe('用途 (デート / 接待 / 友人 / 一人 など)'),
  mood: z.string().nullable().describe('気分 (静か / 賑やか など。無ければ null)'),
  craving: z
    .string()
    .nullable()
    .describe('食べたいもの・料理ジャンル (例: もつ, 海鮮, 中華, 焼き鳥。指定が無ければ null)'),
})

export type IntakeResult = z.infer<typeof IntakeSchema>

// Controlled バンド: 既製の「プラン」テンプレートに AI が値を流し込む。
// 天気/終電は WeatherBanner/LastTrainCard(共有コンポーネント)が描くので、ここでは
// タイトルと各ステップ(店選びと理由)だけ AI に埋めさせる。
export const PlanSchema = z.object({
  title: z.string().describe('プランのタイトル (天気/エリア/用途をふまえて)'),
  steps: z
    .array(
      z.object({
        label: z.string().describe('1軒目 / 2軒目 / 〆 など'),
        restaurantId: z.string().describe('restaurants の id'),
        why: z.string().describe('その店を選んだ理由 (一言・天気もふまえて)'),
      })
    )
    .describe('時系列のプラン (店をはしご)'),
})

export type Plan = z.infer<typeof PlanSchema>
