import { tool } from 'ai'
import { z } from 'zod'

// 注: 旧 Chat/agent 経路用 (現デモ <Compare/> では未使用)。Declarative の UIツリーは
// 現在 streamText で生成するため、ここは最小スキーマに留める。
export const renderUITool = tool({
  description:
    'ユーザに対して構造化された UI を提示する。UIツリー(JSON)を組み立てて検索結果や提案を表現する。',
  inputSchema: z.object({ ui: z.unknown().describe('UIツリー(JSON)') }),
  execute: async (input) => input,
})

export const renderHTMLInputSchema = z.object({
  html: z
    .string()
    .describe(
      '完全な独立 HTML 文書。<html> から </html> まで含め、CSS/JS は inline。外部リソースは禁止。'
    ),
})

export const renderHTMLTool = tool({
  description:
    'ユーザに対して完全な HTML 文書を提示する。Open-Ended モード専用。iframe sandbox 内で実行される。',
  inputSchema: renderHTMLInputSchema,
  execute: async (input) => input,
})
