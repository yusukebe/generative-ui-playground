# Generative UI Playground

CopilotKit が提唱する [**Generative UI Spectrum**](https://www.copilotkit.ai/generative-ui-spectrum) の 3 バンド (Controlled / Declarative / Open-Ended) を、同一題材「レストラン提案」で並べて見せるデモ。

2026-06-06 [frontend-phpcon-do-2026](https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020) トーク「AI 時代の UI はどこへ行く？その 2！」用。

## 3 つのバンド

| バンド          | LLM 出力                         | 描画                                     |
| --------------- | -------------------------------- | ---------------------------------------- |
| **Controlled**  | tool call `{ component, props }` | 事前定義 React コンポーネントを dispatch |
| **Declarative** | JSON UI ツリー                   | プリミティブ語彙を再帰的に組立           |
| **Open-Ended**  | HTML + CSS + JS                  | `<iframe sandbox>` + CSP で実行          |

並走サブテーマ: **「フォーム UI は消える」** — レストラン登録は専用フォームではなく、チャット入力 + 写真 DnD で行い、LLM が曖昧な自然言語入力を正規化する。

## Tech Stack

- Cloudflare Workers + [Hono](https://hono.dev/) + [hono-agents](https://www.npmjs.com/package/hono-agents)
- React 19 + Vite
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (Durable Object として Agent を保持)
- Workers AI (Kimi K2.6 / Llama 4 Scout / Llama 3.3 70B / Llama 3.1 8B / Gemma 3 / Qwen 2.5 Coder)
- D1 (レストラン) + R2 (写真)
- Google Places API (住所正規化 — 未配線)

## 開発

```bash
bun install
bun run dev               # http://localhost:5173/
bun run db:migrate:local  # D1 マイグレーション + シード適用
```

```bash
bun run cf-typegen        # wrangler.jsonc 変更後、型を再生成
bun run format:fix        # prettier フォーマット
bun run build             # 本番ビルド
bun run deploy            # Cloudflare へデプロイ
```

---

# アーキテクチャ解説

## 全体図

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React SPA / src/client/*)                              │
│                                                                  │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ Chat.tsx   │───▶│ useAgentChat │◀──▶│ WebSocket            │  │
│  │ (UI)       │    │ (@cf/ai-chat)│    │ /agents/restaurant/* │  │
│  └────────────┘    └──────────────┘    └──────────┬───────────┘  │
│         │                                         │              │
│         │ part を type で分岐して                  │              │
│         ▼                                         │              │
│  ┌─────────────────────────────────────┐         │              │
│  │ tool-search_restaurants             │         │              │
│  │   → <RestaurantList />              │         │              │
│  │ tool-render_ui                      │         │              │
│  │   → <DeclarativeView />             │         │              │
│  │ tool-render_html                    │         │              │
│  │   → <OpenEndedView /> (iframe)      │         │              │
│  └─────────────────────────────────────┘         │              │
└──────────────────────────────────────────────────┼──────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (Hono / src/index.tsx)                        │
│                                                                  │
│  app.use('/agents/*', agentsMiddleware())                        │
│                       │                                          │
│                       ▼                                          │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ RestaurantAgent (Durable Object / src/agent.ts)           │   │
│  │ extends AIChatAgent<CloudflareBindings, AgentState>       │   │
│  │                                                           │   │
│  │  state: { model, mode } ←─ クライアントと双方向同期       │   │
│  │  messages: 永続化される会話履歴 (DO SQLite)               │   │
│  │                                                           │   │
│  │  onChatMessage():                                         │   │
│  │    streamText({                                           │   │
│  │      model: workers-ai-provider(state.model)              │   │
│  │      system: PROMPTS[state.mode]                          │   │
│  │      tools: mode に応じて切替                             │   │
│  │      stopWhen: stepCountIs(5)                             │   │
│  │    }).toUIMessageStreamResponse()                         │   │
│  │                                                           │   │
│  │  @callable registerRestaurant():                          │   │
│  │    Vision → 正規化 → R2 + D1 → saveMessages               │   │
│  └────────┬──────────────────────────────────────────────────┘   │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cloudflare Bindings                                             │
│  - env.AI     Workers AI (LLM + Vision)                          │
│  - env.DB     D1 SQLite (restaurants テーブル)                   │
│  - env.PHOTOS R2 (写真オブジェクトストレージ)                    │
└──────────────────────────────────────────────────────────────────┘
```

## モード切替の仕組み

UI のセグメントコントロール (`Controlled` / `Declarative` / `Open-Ended`) を押すと、クライアントが `agent.setState({ model, mode })` で **Agent の state を更新**する。Agents SDK は state を WebSocket 経由で双方向同期するため、次の発話時に Agent 側の `this.state.mode` が新しい値になっている。

`onChatMessage` はこの `state.mode` を見て、以下のように振る舞いを切り替える:

```ts
const tools: ToolSet =
  mode === 'controlled'
    ? { search_restaurants: searchTool }
    : mode === 'declarative'
      ? { search_restaurants: searchTool, render_ui: renderUITool }
      : { search_restaurants: searchTool, render_html: renderHTMLTool }

streamText({
  model: workersai(this.state.model),
  system: PROMPTS[mode],   // モードごとに別 system prompt
  tools,                   // モードごとに使えるツールを変える
  ...
})
```

## 各バンドが「カード/JSON/HTML を返す」までのフロー

### Controlled

1. ユーザ「中目黒で静かに飲みたい」
2. LLM が `search_restaurants({ area: '中目黒', atmosphere: '静か' })` を tool call
3. AI SDK がツールを実行 → `searchRestaurants()` (src/tools/search-restaurants.ts) が D1 を `SELECT * FROM restaurants WHERE area LIKE ?` でクエリ
4. ツール結果 `{ restaurants: [...] }` がメッセージの parts に `{ type: 'tool-search_restaurants', state: 'output-available', output }` として乗る
5. クライアントの `PartView` (src/client/Chat.tsx) が type を見て `<RestaurantList restaurants={...} />` をレンダ
6. `RestaurantList` が各レストランを `<RestaurantCard>` でマップして並べる

ポイント: LLM は「どのコンポーネントを使うか」を tool 名で表明している（`search_restaurants` → 自動的にカード）。コンポーネントの実装と props 形は完全に開発者の手中にある。

### Declarative

最初の 3 ステップは Controlled と同じ (search_restaurants で D1 から候補取得)。続いて:

- LLM が **2 つ目のツール** `render_ui` を呼ぶ。引数として **Section / Card プリミティブを組み合わせた JSON ツリー** を渡す
- `render_ui` の execute は引数をそのまま返すだけ (echo back)。意味は「LLM の UI 構成意図をクライアントに届ける」こと
- クライアントの PartView が `tool-render_ui` を検出 → `<DeclarativeView ui={...} />` を再帰描画

ポイント: LLM は語彙 (`Card` / `Section`) の中で**自由に配置**できる。開発者は語彙とそのスキーマ (Zod, src/schemas/declarative.ts) を定義しただけ。

### Open-Ended

最初の 3 ステップは同じ。続いて:

- LLM が `render_html` ツールを呼び、**完全な HTML 文書**を引数で渡す (`<html>` から `</html>` まで CSS/JS 含む)
- クライアントが `<OpenEndedView html={...} />` で iframe に流し込み
- `<iframe sandbox="allow-scripts" srcDoc>` + `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; ...">` で隔離実行

ポイント: 描画の自由度は最大。開発者は CSP の許可リストだけ書いている。

## 「フォーム UI は消える」登録フロー

```
[user]   入力欄に「中目黒のラーメン屋」+ 画像をドロップ
   │
   ▼
[client] agent.stub.registerRestaurant({ text, imageDataUrl, imageMime })
   │     ※ RPC call (Agents SDK の @callable)
   ▼
[server] addRestaurant() (src/tools/add-restaurant.ts)
   │
   ├─▶ Workers AI Vision (llama-3.2-11b-vision-instruct)
   │     image → "二郎系の濃厚ラーメンが写っている"
   │
   ├─▶ Workers AI generateObject (llama-3.3-70b-instruct-fp8-fast)
   │     text + visionSummary → { name, area, genre, tags, atmosphere,
   │                              price_range, note } (Zod 検証付き)
   │
   ├─▶ R2.put(`${uuid}`, bytes)          (写真)
   ├─▶ D1.INSERT INTO restaurants ...    (構造化レコード)
   │
   ▼
[server] this.saveMessages([userMsg, assistantMsg])
   │     ※ user メッセージ (画像 file part 付き) と確認テキストを履歴に追加
   ▼
[client] useAgentChat が自動同期、新メッセージが表示される
   │
   └─▶ 次の検索で D1 から新登録分も hit する
```

## 主要ファイル

```
src/
  index.tsx                 Hono Worker entry。/agents/* を hono-agents へ
  agent.ts                  RestaurantAgent (AIChatAgent + Workers AI + tools)
  modes.ts                  Mode 型と一覧 ('controlled' / 'declarative' / 'open-ended')
  models.ts                 Model レジストリ (6 モデル)
  types.ts                  Restaurant 型 + D1 行 → Restaurant のマッパ
  schemas/
    declarative.ts          Section / Card プリミティブの Zod
  tools/
    search-restaurants.ts   D1 をクエリする AI SDK ツール
    render-ui.ts            render_ui / render_html の echo-back ツール
    add-restaurant.ts       Vision + 正規化 + D1 + R2 の登録パイプライン
  client/
    main.tsx                React entry
    App.tsx                 サイドバー + メインペインのレイアウト
    Chat.tsx                useAgent / useAgentChat フックでチャット、part を分岐
    ModeSelector.tsx        セグメントコントロール
    ModelSelector.tsx       モデルドロップダウン
    components/restaurant/  Controlled 用コンポーネント
    modes/
      DeclarativeView.tsx   JSON UI ツリーの再帰描画
      OpenEndedView.tsx     iframe sandbox + CSP のラッパ

migrations/                 D1 マイグレーション (init + seed 18 件)
wrangler.jsonc              D1 / R2 / Agent (DO) / AI バインド
```

## デバグ

dev サーバを `bun run dev` で立ち上げ、Chrome DevTools MCP もしくは普通の DevTools でネットワーク / コンソールを確認。

詳細な現状ステータス（未完了タスク・本番デプロイのために必要な追加手順）は **[AGENTS.md](./AGENTS.md)** を参照。
