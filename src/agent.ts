import { AIChatAgent } from '@cloudflare/ai-chat'
import { callable } from 'agents'
import { convertToModelMessages, stepCountIs, streamText, type ToolSet, type UIMessage } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { DEFAULT_MODE, type Mode } from './modes'
import { DEFAULT_MODEL, type ModelId } from './models'
import {
  addRestaurant,
  type AddRestaurantInput,
  type AddRestaurantResult,
} from './tools/add-restaurant'
import { renderHTMLTool, renderUITool } from './tools/render-ui'
import { makeSearchRestaurantsTool } from './tools/search-restaurants'

const PROMPTS: Record<Mode, string> = {
  controlled: `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランはすべて D1 データベースに登録されています。
あなた自身の知識から店名を答えることは絶対に禁止です。実在の店も知識から提案してはいけません。

ユーザーの発話に対しては、必ず以下の手順で対応してください:
1. search_restaurants ツールを呼ぶ。ユーザーの発話から area / genre / atmosphere / query を抽出してパラメータに渡す。
   - 例: "中目黒で静かに飲みたい" → area="中目黒", atmosphere="静か"
   - 例: "横浜のラーメン" → area="横浜", genre="ラーメン"
   - 適切なパラメータが思いつかないときも、最低限 query にユーザー発話を渡して必ず検索すること
2. ツールが返した結果を見て、ユーザーに 1〜2 文の簡潔なコメントだけ返す。レストラン一覧の表示はクライアントが自動で行うので、店名や住所を文中で繰り返さなくてよい。

日本語で簡潔に。`,

  declarative: `あなたはレストラン提案 UI を組み立てるアシスタントです。
- まず search_restaurants ツールで候補を取得してください。
- 次に render_ui ツールを呼び、Section と Card のプリミティブを組み合わせて結果を整理した UI を構築してください。
  - sections には目的別の見出しを付けてください (例: "雰囲気重視のお店", "コスパが良いお店")
  - 各 card には title (店名), subtitle (エリア + ジャンル), body (一言), tags を含めてください
- render_ui を呼んだ後は短い結びのテキストだけ返してください。
- 日本語で。`,

  'open-ended': `あなたは独自の UI を HTML/CSS/JS で生成するアシスタントです。
- まず search_restaurants ツールで候補を取得してください。
- 次に render_html ツールを呼び、完全な単一の HTML 文書を渡してください。
  - <html> から </html> までを含む完全な文書にしてください
  - CSS は <style> インライン、JS は <script> インライン
  - 外部リソース (CDN, fetch) は使わないこと
  - ダークテーマで美しく、インタラクション (クリックで詳細表示など) があると良い
  - JavaScript は許可されています
- render_html の後は短い結びのテキストだけ返してください。
- 日本語で。`,
}

export type AgentState = {
  model: ModelId
  mode: Mode
}

export class RestaurantAgent extends AIChatAgent<CloudflareBindings, AgentState> {
  initialState: AgentState = {
    model: DEFAULT_MODEL,
    mode: DEFAULT_MODE,
  }

  async onChatMessage(
    onFinish: Parameters<AIChatAgent<CloudflareBindings, AgentState>['onChatMessage']>[0],
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI })
    const mode = this.state.mode

    const searchTool = makeSearchRestaurantsTool(this.env.DB)
    const tools: ToolSet =
      mode === 'controlled'
        ? { search_restaurants: searchTool }
        : mode === 'declarative'
          ? { search_restaurants: searchTool, render_ui: renderUITool }
          : { search_restaurants: searchTool, render_html: renderHTMLTool }

    const result = streamText({
      model: workersai(this.state.model),
      system: PROMPTS[mode],
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      // Open-Ended は HTML 文書を丸ごと吐くのでトークン量が多い。
      // Declarative も JSON ツリーを出力するため、余裕を持って大きめに。
      providerOptions: {
        'workers-ai': {
          max_tokens: mode === 'open-ended' ? 8192 : 4096,
        },
      },
      abortSignal: options?.abortSignal,
      onFinish,
    })
    return result.toUIMessageStreamResponse()
  }

  @callable()
  async registerRestaurant(input: AddRestaurantInput): Promise<AddRestaurantResult> {
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
