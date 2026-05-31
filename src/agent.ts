import { AIChatAgent } from '@cloudflare/ai-chat'
import { convertToModelMessages, streamText } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { DEFAULT_MODEL, type ModelId } from './models'

const SYSTEM_PROMPT = `あなたはレストラン提案のアシスタントです。
ユーザーの気分や条件を聞き取って、おすすめのお店を提案してください。
日本語で簡潔に答えてください。`

export type AgentState = {
  model: ModelId
}

export class RestaurantAgent extends AIChatAgent<CloudflareBindings, AgentState> {
  initialState: AgentState = {
    model: DEFAULT_MODEL,
  }

  async onChatMessage(
    onFinish: Parameters<AIChatAgent<CloudflareBindings, AgentState>['onChatMessage']>[0],
    options?: { abortSignal?: AbortSignal },
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI })
    const result = streamText({
      model: workersai(this.state.model),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      onFinish,
    })
    return result.toUIMessageStreamResponse()
  }
}
