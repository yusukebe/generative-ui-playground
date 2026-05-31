import { AIChatAgent } from '@cloudflare/ai-chat'
import { convertToModelMessages, streamText } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'

const SYSTEM_PROMPT = `あなたはレストラン提案のアシスタントです。
ユーザーの気分や条件を聞き取って、おすすめのお店を提案してください。
日本語で簡潔に答えてください。`

export class RestaurantAgent extends AIChatAgent<CloudflareBindings> {
  async onChatMessage(onFinish: Parameters<AIChatAgent<CloudflareBindings>['onChatMessage']>[0], options?: { abortSignal?: AbortSignal }) {
    const workersai = createWorkersAI({ binding: this.env.AI })
    const result = streamText({
      model: workersai('@cf/meta/llama-4-scout-17b-16e-instruct'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish,
    })
    return result.toUIMessageStreamResponse()
  }
}
