import { AIChatAgent } from '@cloudflare/ai-chat'
import { convertToModelMessages, stepCountIs, streamText, type ToolSet } from 'ai'
import { resolveModel } from './llm'
import { DEFAULT_MODE, type Mode } from './modes'
import { DEFAULT_MODEL, type ModelId } from './models'
import { makeDynamicRenderTool } from './tools/dynamic-render'
import { renderHTMLTool, renderUITool } from './tools/render-ui'
import { makeSearchRestaurantsTool } from './tools/search-restaurants'

// ─────────────────────────────────────────────────────────────────
// 4 バンドの実装:
//   Controlled  — 古典: search_restaurants 直叩き、クライアントがカード描画
//   Declarative — 古典: render_ui (echo back) で JSON UI ツリーを搬送
//   Open-Ended  — 古典: render_html (echo back) で HTML を iframe へ
//   Dynamic     — 新: codemode (JSX + Dynamic Worker SSR、コンポーネント借用可)
// ─────────────────────────────────────────────────────────────────

const CONVERSATION_NOTE = `
なお、ユーザーの発話がお店探しと関係ない雑談・挨拶・質問の場合は、ツールを使わず普通に日本語で会話してください。
また search_restaurants の結果が 0 件だった場合も、無理に提案せず「見つからなかった」ことを正直に伝え、別のエリアやジャンルを提案するなど自然に会話を続けてください。`

const PROMPTS: Record<Mode, string> = {
  controlled: `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランはすべて事前に登録されたデータベース内のみです。
あなた自身の知識から実在の店名を答えることは禁止です (架空の店名もダメ)。

ユーザーがお店を探している場合は以下の手順で対応してください:
1. search_restaurants ツールを呼ぶ。ユーザーの発話から area / genre / atmosphere / query を抽出して引数に渡す
   - 例: "関内で静かに飲みたい" → { area: "関内", atmosphere: "静か" }
   - 例: "中華街で点心" → { area: "中華街", genre: "中華" }
   - 引数が分からない場合は空文字ではなく省略すること
2. ツール結果を見て 1〜2 文の簡潔なコメントだけ返す (レストラン一覧の表示はクライアントが自動で行う)
${CONVERSATION_NOTE}`,

  declarative: `あなたはレストラン提案 UI を組み立てるアシスタントです。
ユーザーがお店を探している場合:
- まず search_restaurants ツールで候補を取得
- 次に render_ui ツールを呼び、Section と Card のプリミティブを組み合わせて UI を構築
  - sections に目的別の見出し (例: "雰囲気重視のお店", "コスパが良いお店")
  - 各 card に title (店名), subtitle (エリア+ジャンル), body (一言), tags
- render_ui の後は短い結びのテキストだけ。日本語で。
${CONVERSATION_NOTE}`,

  'open-ended': `あなたは独自の UI を HTML/CSS/JS で生成するアシスタントです。
ユーザーがお店を探している場合:
- まず search_restaurants ツールで候補を取得
- 次に render_html ツールを呼び、完全な単一の HTML 文書を渡してください
  - <!doctype html> から </html> までを含む完全な文書
  - CSS は <style> インライン、JS は <script> インライン
  - 外部リソース (CDN, fetch) は使わない (iframe の CSP でブロック)
  - 明るい背景で見やすく美しく
- render_html の後は短い結びのテキストだけ。日本語で。
${CONVERSATION_NOTE}`,

  dynamic: `あなたはレストラン提案アシスタントです。
重要: 提案できるレストランは検索ツールが返したデータのみ。店名や住所を創作しないこと。

ユーザーがお店を探している場合は dynamic_render ツールを 1 回呼んでください。引数は 2 つ:
- search: { area?, genre?, atmosphere?, query? } を抽出 (ユーザ発話から)
- code: \`function APP({ restaurants }) { return <jsx> }\` という **コンポーネント関数だけ**
  (import/export/fetch は書かない。host が <APP restaurants={...} /> を SSR します)

コンポーネント内では props.restaurants と RestaurantCard / RestaurantList が使えます。
シンプルに <RestaurantList restaurants={restaurants} /> を借りるのも、自分で raw な
<div> から組み立てるのも自由です。詳細は dynamic_render の説明を参照。

日本語で短く結びのテキストも添えてください。
${CONVERSATION_NOTE}`,
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
    const mode = this.state.mode

    const searchTool = makeSearchRestaurantsTool(this.env)
    let tools: ToolSet
    if (mode === 'controlled') {
      tools = { search_restaurants: searchTool }
    } else if (mode === 'declarative') {
      tools = { search_restaurants: searchTool, render_ui: renderUITool }
    } else if (mode === 'open-ended') {
      tools = { search_restaurants: searchTool, render_html: renderHTMLTool }
    } else {
      // dynamic: LLM は APP コンポーネント関数だけ書く
      tools = { dynamic_render: makeDynamicRenderTool(this.env) }
    }

    // Dynamic / Open-Ended は長いコード/HTML を吐く。さらに gpt-oss 等の
    // reasoning モデルは推論トークンを消費するので、大きめの上限を取る
    const maxTokens = mode === 'controlled' ? 8192 : 32000
    const { model, isOpenAI } = resolveModel(this.env, this.state.model)

    const result = streamText({
      model,
      system: PROMPTS[mode],
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: maxTokens,
      providerOptions: isOpenAI
        ? {}
        : {
            'workers-ai': {
              max_tokens: maxTokens,
              // gpt-oss は reasoning model。推論を軽くして本体出力にトークンを回す
              reasoning_effort: 'low',
            },
          },
      abortSignal: options?.abortSignal,
      onFinish,
    })
    return result.toUIMessageStreamResponse()
  }
}
