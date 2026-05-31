import { AIChatAgent } from '@cloudflare/ai-chat'
import { callable } from 'agents'
import { convertToModelMessages, stepCountIs, streamText, type ToolSet, type UIMessage } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { DEFAULT_MODEL, type ModelId } from './models'
import {
  addRestaurant,
  type AddRestaurantInput,
  type AddRestaurantResult,
} from './tools/add-restaurant'
import { makeReactCodeTool } from './tools/code-mode-react'
import { makeSearchRestaurantsTool } from './tools/search-restaurants'

// ─────────────────────────────────────────────────────────────────
// 単一のシステムプロンプト。LLM は唯一のツール codemode に JSX を含む
// async アロー関数を渡し、Cloudflare Dynamic Worker サンドボックスで実行する。
//
// LLM の選択:
//   - <RestaurantList /> を借りる (Controlled 寄り)
//   - Section/Card プリミティブで JSON ツリーを返す (Declarative 寄り)
//   - 自分で raw な JSX を書く (Open-Ended 寄り)
//
// クライアントは Content-Type で描画方法を切替える:
//   - application/json (restaurants)            → RestaurantList
//   - application/vnd.gui-tree+json (sections)  → DeclarativeView
//   - text/html                                  → iframe + CSP
// ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `あなたはレストラン提案アシスタントです。

# 重要なルール
- 提案できるレストランはすべて D1 データベースに登録されています
- あなた自身の知識から店名を答えることは絶対に禁止 (D1 に無いお店は存在しないものとして扱う)

# 仕組み
- 唯一のツール codemode に JSX を含む async アロー関数を渡してください
- 関数は Cloudflare Dynamic Worker サンドボックスで実行されます
- React (createElement / JSX), renderToString, 事前定義コンポーネント (<RestaurantCard/>, <RestaurantList/>) が import 不要で使えます
- 最終的に擬似 Response { contentType, body } を return してください
- クライアントは Content-Type を見て描画方法を切替えます

# どう書くか (ユーザの要望に応じて自由に判断)
- シンプルにお店を並べたい → <RestaurantList restaurants={...} /> を 1 個使うだけで OK
- 凝った見た目で見せたい → 自分で <div> から組み立て、style を inline で書く
- 構造化したい → { contentType: 'application/vnd.gui-tree+json', body: JSON.stringify({ sections: [...] }) } で Section/Card プリミティブのツリーを返す

# 共通
- search_restaurants ツールでユーザの発話から area/genre/atmosphere/query を抽出して D1 検索
- 関数の最後に必ず { contentType, body } を return
- 日本語で短い結びのテキストも添えてください`

export type AgentState = {
  model: ModelId
}

export class RestaurantAgent extends AIChatAgent<CloudflareBindings, AgentState> {
  initialState: AgentState = {
    model: DEFAULT_MODEL,
  }

  async onChatMessage(
    onFinish: Parameters<AIChatAgent<CloudflareBindings, AgentState>['onChatMessage']>[0],
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI })

    const searchTool = makeSearchRestaurantsTool(this.env.DB)
    const codemode = await makeReactCodeTool({
      tools: { search_restaurants: searchTool },
      loader: this.env.LOADER,
    })
    const tools: ToolSet = { codemode }

    const result = streamText({
      model: workersai(this.state.model),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      providerOptions: {
        'workers-ai': {
          max_tokens: 8192,
        },
      },
      abortSignal: options?.abortSignal,
      onFinish,
    })
    return result.toUIMessageStreamResponse()
  }

  @callable()
  async registerRestaurant(input: AddRestaurantInput): Promise<AddRestaurantResult> {
    const expected = this.env.ADMIN_TOKEN
    if (expected && input.adminToken !== expected) {
      throw new Error('Unauthorized: invalid admin token')
    }
    const result = await addRestaurant(this.env, input)

    const now = Date.now()
    const userMessage: UIMessage = {
      id: `user-${now}`,
      role: 'user',
      parts: [
        { type: 'text', text: input.text || '(写真のみ)' },
        ...(input.imageDataUrl
          ? [
              {
                type: 'file' as const,
                mediaType: input.imageMime ?? 'image/jpeg',
                url: input.imageDataUrl,
              },
            ]
          : []),
      ],
    }

    const assistantMessage: UIMessage = {
      id: `assistant-${now + 1}`,
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: `✅ 保存しました: **${result.restaurant.name}** (${result.restaurant.area} / ${result.restaurant.genre})${
            result.visionSummary ? `\n📷 ${result.visionSummary}` : ''
          }\n\n次の検索結果に含まれるようになりました。`,
        },
      ],
    }

    await this.saveMessages((messages) => [...messages, userMessage, assistantMessage])
    return result
  }
}
