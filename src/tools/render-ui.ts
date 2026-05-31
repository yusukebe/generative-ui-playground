import { tool } from 'ai'
import { z } from 'zod'
import { DeclarativeUISchema } from '../schemas/declarative'

export const renderUITool = tool({
  description:
    'ユーザに対して構造化された UI を提示する。Section と Card のプリミティブを組み合わせて、検索結果や提案を表現する。',
  inputSchema: DeclarativeUISchema,
  execute: async (ui) => ui,
})

export const renderHTMLInputSchema = z.object({
  html: z
    .string()
    .describe('完全な独立 HTML 文書。<html> から </html> まで含め、CSS/JS は inline。外部リソースは禁止。'),
})

export const renderHTMLTool = tool({
  description:
    'ユーザに対して完全な HTML 文書を提示する。Open-Ended モード専用。iframe sandbox 内で実行される。',
  inputSchema: renderHTMLInputSchema,
  execute: async (input) => input,
})
