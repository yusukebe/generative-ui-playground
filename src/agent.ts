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
import { makeReactCodeTool } from './tools/code-mode-react'
import { renderHTMLTool, renderUITool } from './tools/render-ui'
import { makeSearchRestaurantsTool } from './tools/search-restaurants'

// ─────────────────────────────────────────────────────────────────
// 4 バンドの実装:
//   Controlled  — 古典: search_restaurants 直叩き、クライアントがカード描画
//   Declarative — 古典: render_ui (echo back) で JSON UI ツリーを搬送
//   Open-Ended  — 古典: render_html (echo back) で HTML を iframe へ
//   Dynamic     — 新: codemode (JSX + Dynamic Worker SSR、コンポーネント借用可)
// ─────────────────────────────────────────────────────────────────

const PROMPTS: Record<Mode, string> = {
  controlled: `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランはすべて D1 データベースに登録されています。
あなた自身の知識から店名を答えることは絶対に禁止です。

ユーザーの発話に対しては必ず以下の手順で対応してください:
1. search_restaurants ツールを呼ぶ (area / genre / atmosphere / query を抽出)
   - 例: "関内で静かに飲みたい" → area="関内", atmosphere="静か"
   - 例: "中華街で点心" → area="中華街", genre="中華"
2. ツール結果を見て 1〜2 文の簡潔なコメントだけ返す (レストラン一覧の表示はクライアントが自動で行う)

日本語で簡潔に。`,

  declarative: `あなたはレストラン提案 UI を組み立てるアシスタントです。
- まず search_restaurants ツールで候補を取得
- 次に render_ui ツールを呼び、Section と Card のプリミティブを組み合わせて UI を構築
  - sections に目的別の見出し (例: "雰囲気重視のお店", "コスパが良いお店")
  - 各 card に title (店名), subtitle (エリア+ジャンル), body (一言), tags
- render_ui の後は短い結びのテキストだけ。日本語で。`,

  'open-ended': `あなたは独自の UI を HTML/CSS/JS で生成するアシスタントです。
- まず search_restaurants ツールで候補を取得
- 次に render_html ツールを呼び、完全な単一の HTML 文書を渡してください
  - <!doctype html> から </html> までを含む完全な文書
  - CSS は <style> インライン、JS は <script> インライン
  - 外部リソース (CDN, fetch) は使わない (iframe の CSP でブロック)
  - ダークテーマで美しく
- render_html の後は短い結びのテキストだけ。日本語で。`,

  dynamic: `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランはすべて D1 データベースに登録されています。
あなた自身の知識から店名を答えることは絶対に禁止です。

唯一のツール codemode に JSX を含む async アロー関数を渡してください。
関数は Cloudflare Dynamic Worker (隔離サンドボックス) で実行され、React 環境と
事前定義コンポーネント (RestaurantCard, RestaurantList) が利用可能です。

詳細は codemode ツールの説明を参照してください。日本語で短く結びのテキストも添えてください。`,
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
    let tools: ToolSet
    if (mode === 'controlled') {
      tools = { search_restaurants: searchTool }
    } else if (mode === 'declarative') {
      tools = { search_restaurants: searchTool, render_ui: renderUITool }
    } else if (mode === 'open-ended') {
      tools = { search_restaurants: searchTool, render_html: renderHTMLTool }
    } else {
      // dynamic: Code Mode + Dynamic Worker + JSX
      const codemode = await makeReactCodeTool({
        tools: { search_restaurants: searchTool },
        loader: this.env.LOADER,
      })
      tools = { codemode }
    }

    const result = streamText({
      model: workersai(this.state.model),
      system: PROMPTS[mode],
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      providerOptions: {
        'workers-ai': {
          max_tokens: mode === 'open-ended' || mode === 'dynamic' ? 8192 : 4096,
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
