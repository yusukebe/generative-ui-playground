import { AIChatAgent } from '@cloudflare/ai-chat'
import { DynamicWorkerExecutor } from '@cloudflare/codemode'
import { createCodeTool } from '@cloudflare/codemode/ai'
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
import { makeSearchRestaurantsTool } from './tools/search-restaurants'

// ─────────────────────────────────────────────────────────────────
// LLM の関数戻り値は擬似 Response { contentType, body } とする。
// クライアントは contentType を見て描画方法を分岐する:
//   - application/json (restaurants)            → RestaurantList (Controlled)
//   - application/vnd.gui-tree+json (sections)  → DeclarativeView (Declarative)
//   - text/html                                  → iframe (Open-Ended)
// ─────────────────────────────────────────────────────────────────

const COMMON = `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランはすべて D1 データベースに登録されています。
あなた自身の知識から店名を答えることは絶対に禁止です。

使えるツールは唯一 \`codemode\` だけです。codemode は async アロー関数を 1 つ受け取り、Worker サンドボックスで実行します。
関数の中では \`await search_restaurants({ area?, genre?, atmosphere?, query? })\` を呼んで D1 を検索できます (戻り値: { restaurants: [...] })。

最終的に関数は擬似 Response オブジェクト { contentType, body } を return してください。`

const PROMPTS: Record<Mode, string> = {
  auto: `${COMMON}

【Auto モード】ユーザの要望に応じて、最適な contentType を **あなた自身が選択**してください:
- シンプルにお店を並べて見せたい → contentType: 'application/json', body: JSON.stringify({ restaurants: [...] })
- 目的別に整理したい           → contentType: 'application/vnd.gui-tree+json', body: JSON.stringify({ sections: [{ heading, cards: [{ title, subtitle, body, tags }] }] })
- 凝った見た目で見せたい (地図・グラフ等) → contentType: 'text/html', body: '<!doctype html>...'

日本語で。`,

  controlled: `${COMMON}

【Controlled モード】必ず以下の形を返してください:
contentType: 'application/json'
body: JSON.stringify({ restaurants: [...search_restaurants の結果をそのまま] })

日本語で。`,

  declarative: `${COMMON}

【Declarative モード】必ず以下の形を返してください:
contentType: 'application/vnd.gui-tree+json'
body: JSON.stringify({
  title?: string,
  intro?: string,
  sections: [{
    heading?: string,
    description?: string,
    cards: [{ type: 'Card', title, subtitle?, body?, tags?: string[], variant?: 'default'|'highlight' }]
  }]
})

- sections には目的別の見出しを付けてください (例: "雰囲気重視のお店", "コスパが良いお店")
- 各 card には title (店名), subtitle (エリア + ジャンル), body (一言), tags を含めてください

日本語で。`,

  'open-ended': `${COMMON}

【Open-Ended モード】必ず以下の形を返してください:
contentType: 'text/html'
body: 完全な単一の HTML 文書 ('<!doctype html>' から '</html>' まで)
- CSS は <style> インライン、JS は <script> インライン
- 外部リソース (CDN, fetch) は禁止 (CSP でブロックされる)
- ダークテーマで美しく、クリックなどのインタラクションがあると良い

日本語で。`,
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
    const tools: ToolSet = {
      codemode: createCodeTool({
        tools: { search_restaurants: searchTool },
        executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
      }),
    }

    const result = streamText({
      model: workersai(this.state.model),
      system: PROMPTS[mode],
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      providerOptions: {
        'workers-ai': {
          // Open-Ended と Auto は HTML 文書を吐くかもしれないので大きめに
          max_tokens: mode === 'open-ended' || mode === 'auto' ? 8192 : 4096,
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
