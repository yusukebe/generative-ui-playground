# Generative UI Playground

CopilotKit が提唱する [**Generative UI Spectrum**](https://www.copilotkit.ai/generative-ui-spectrum) (Controlled / Declarative / Open-Ended) の 3 バンドを実演しつつ、本デモが提案する **第 4 のバンド「Dynamic」** (Code Mode + Dynamic Worker + JSX SSR) も見せるレストラン提案アプリ。

2026-06-06 [frontend-phpcon-do-2026](https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020) トーク「AI 時代の UI はどこへ行く？その 2！」用。

## 4 つのバンド

| バンド          | LLM 出力                                      | 描画                                                                |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| **Controlled**  | tool call `search_restaurants`                | 事前定義 React コンポーネント (`RestaurantList`) で dispatch        |
| **Declarative** | tool call `render_ui` (JSON UI ツリー)        | プリミティブ語彙 (Section / Card) を再帰描画                        |
| **Open-Ended**  | tool call `render_html` (HTML 文字列)         | `<iframe sandbox>` + CSP で実行                                     |
| **Dynamic** ✨  | tool call `codemode` (**JSX で動的にコード**) | **Cloudflare Dynamic Worker で SSR**、`<RestaurantList />` も借用可 |

並走サブテーマ: **「フォーム UI は消える」** — レストラン登録は専用フォームではなく、チャット入力 + 写真 DnD で行い、LLM が曖昧な自然言語入力を Workers AI Vision で正規化する。

## 「Dynamic」というクライマックス

```
通常の SSR (Next.js / Remix):
  開発者が書いた React コンポーネント → サーバで renderToString → HTML

このデモの Dynamic バンド:
  LLM が書いた React コンポーネント → Dynamic Worker で renderToString → HTML
            ↑ リクエスト時に動的生成 (JIT)
```

つまり Dynamic は **「LLM が書く SSR」**。Open-Ended の延長線上だが:

- サンドボックス隔離が標準で付く (Cloudflare Worker Loader)
- React 環境 (renderToString) が走る
- 既存コンポーネントを **借用できる** (Spectrum を内側でグラデーションできる)

「Code Mode + Dynamic Worker = LLM SSR の実装基盤」。Spectrum 議論はこの上に乗る枝葉、というフレームでもある。

## Tech Stack

- Cloudflare Workers + [Hono](https://hono.dev/) + [hono-agents](https://www.npmjs.com/package/hono-agents)
- React 19 + Vite
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (Durable Object として Agent を保持)
- [@cloudflare/codemode](https://www.npmjs.com/package/@cloudflare/codemode) (Dynamic バンドの実行基盤)
- [@cloudflare/worker-bundler](https://www.npmjs.com/package/@cloudflare/worker-bundler) (React + 共有コンポーネントを runtime でバンドル)
- [sucrase](https://www.npmjs.com/package/sucrase) (LLM 生成コードの JSX → React.createElement トランスパイル)
- Workers AI (Kimi K2.6 / Llama 4 Scout / Llama 3.3 70B / Llama 3.1 8B / Gemma 3 / Qwen 2.5 Coder)
- D1 (レストラン) + R2 (写真)

## 開発

```bash
bun install
bun run dev               # http://localhost:5173/
bun run db:migrate:local  # D1 マイグレーション + シード (横浜 18 件) を投入
```

```bash
bun run cf-typegen        # wrangler.jsonc 変更後、型を再生成
bun run format:fix        # prettier フォーマット
bun run build             # 本番ビルド
bun run deploy            # Cloudflare へデプロイ
```

`.dev.vars` に `ADMIN_TOKEN=local-admin` 等を入れておくと、登録機能が admin 限定になる (本番は `wrangler secret put ADMIN_TOKEN`)。

---

# アーキテクチャ解説

## レイヤ俯瞰

```mermaid
flowchart LR
  B["Browser<br/>React SPA<br/>(src/client/*)"]
  W["Cloudflare Worker<br/>Hono + Agents SDK<br/>(src/index.tsx, src/agent.ts)"]
  S["Dynamic Worker<br/>(Dynamic バンドで<br/>LLM のコードを実行する隔離サンドボックス)"]
  D["Cloudflare Bindings<br/>AI / D1 / R2 / LOADER"]

  B <-->|WebSocket| W
  W -.->|env.LOADER<br/>でスピンアップ| S
  S -->|Workers RPC で<br/>tool 呼び出し| W
  W -->|env| D
```

## Layer 1 — Browser

`Chat.tsx` は `useAgentChat` フックで Agent と双方向通信し、メッセージの `parts` を `PartView` が type で分岐。バンドごとに異なる tool 結果を専用 View に振り分ける。

```mermaid
flowchart TB
  Chat["Chat.tsx<br/>(入力 + DnD + ModeSelector)"] --> Hook["useAgentChat<br/>(@cloudflare/ai-chat/react)"]
  Hook --> PartView["PartView<br/>(message.parts を type で分岐)"]
  PartView -->|tool-search_restaurants| RList["RestaurantList<br/>(Controlled バンド)"]
  PartView -->|tool-render_ui| DV["DeclarativeView<br/>(Declarative バンド)"]
  PartView -->|tool-render_html| OEV["OpenEndedView<br/>(Open-Ended バンド, iframe + CSP)"]
  PartView -->|tool-codemode| CMV["CodeModeView<br/>(Dynamic バンド, 生成コード + SSR 結果)"]
```

## Layer 2 — Worker (Hono + Agent)

`/agents/*` を `agentsMiddleware` が引き受け、Durable Object として動く `RestaurantAgent` に到達。Agent は `state` (model + mode) と `messages` (会話履歴) を SQLite に永続化、`onChatMessage` でモードに応じた tools を選択。

```mermaid
flowchart TB
  Route["/agents/restaurant-agent/default"] --> Mid["agentsMiddleware()<br/>(hono-agents)"]
  Mid --> Agent["RestaurantAgent<br/>(Durable Object)<br/>state: { model, mode }<br/>messages: 永続化"]
  Agent --> Sw["mode で tools を分岐"]
  Sw --> Ctl["Controlled<br/>{ search_restaurants }"]
  Sw --> Dcl["Declarative<br/>{ search_restaurants, render_ui }"]
  Sw --> Oe["Open-Ended<br/>{ search_restaurants, render_html }"]
  Sw --> Dy["Dynamic ✨<br/>{ codemode }<br/>(React + Dynamic Worker)"]
  Agent --> Reg["@callable registerRestaurant()<br/>Vision → 正規化 → R2 + D1<br/>→ saveMessages"]
```

## Layer 3 — Dynamic Worker サンドボックス (Dynamic バンドのみ)

`codemode` ツール実行時、`@cloudflare/codemode` の `DynamicWorkerExecutor` が `env.LOADER` を使って **隔離 Worker をスピンアップ**し、LLM のコードを走らせる。

サンドボックスには `react` / `react-dom/server` / `restaurant-ui` (共有コンポーネント) が **modules として inject 済み**で、LLM のコードから `await import('react')` 等で取り出せる。外部 fetch は `globalOutbound: null` で遮断、ホストとの通信は Workers RPC のみ。

```mermaid
flowchart LR
  CT["codemode tool execute<br/>(host)"] -->|sucrase で JSX 変換| TX["transformed JS"]
  TX -->|DynamicWorkerExecutor.execute| DW["Dynamic Worker<br/>(隔離サンドボックス)"]
  DW -->|fetch ブロック| X1["外部 (不可)"]
  DW <-->|Workers RPC| CT
  CT --> ST["search_restaurants tool<br/>(D1 を叩く)"]
```

サンドボックス内 modules:

| Key                | 中身                                                           |
| ------------------ | -------------------------------------------------------------- |
| `react`            | worker-bundler で React を ESM バンドルしたもの                |
| `react-dom/server` | 同上 (renderToString / renderToStaticMarkup)                   |
| `restaurant-ui`    | `src/ui-components.tsx` を worker-bundler で TSX → JS バンドル |

## 各バンドの LLM 出力例

### Controlled (古典)

LLM は `search_restaurants` を呼ぶだけ。一覧表示はクライアントが自動で行う。

```ts
// LLM が出す tool call
search_restaurants({ area: '関内', atmosphere: '静か' })
// → { restaurants: [...] } → クライアントが <RestaurantList /> でレンダ
```

### Declarative (古典)

`search_restaurants` の後、`render_ui` で Section / Card のツリーを返す。

```ts
render_ui({
  title: '関内のオススメ',
  sections: [
    {
      heading: '雰囲気重視',
      cards: [
        {
          type: 'Card',
          title: 'BAR Kingdom',
          subtitle: '関内 / バー',
          body: '...',
          tags: ['静か'],
        },
      ],
    },
  ],
})
// → render_ui は echo back、クライアントが DeclarativeView で再帰描画
```

### Open-Ended (古典)

`render_html` で完全な HTML 文書を返す。

```ts
render_html({ html: '<!doctype html><html>...</html>' })
// → クライアントが iframe (allow-scripts + CSP) に流す
```

### Dynamic ✨ (新)

`codemode` で **JSX を含む async アロー関数**を渡す。Dynamic Worker で SSR して HTML を返す。

```tsx
;async (codemode) => {
  const { restaurants } = await codemode.search_restaurants({ area: '関内' })
  // 既存コンポーネントを借りる (= Controlled 寄り) / 自分で組む (= Open-Ended 寄り) を自由に選べる
  return renderToString(<RestaurantList restaurants={restaurants} />)
}
```

## 「フォーム UI は消える」登録フロー (Admin 限定)

```mermaid
sequenceDiagram
  participant U as Admin User
  participant C as Client (Chat.tsx)
  participant A as RestaurantAgent (DO)
  participant V as Workers AI Vision
  participant N as Workers AI (Llama 3.3 70B)
  participant R as R2
  participant D as D1

  U->>C: テキスト「関内のラーメン屋」+ 画像 DnD
  C->>A: agent.stub.registerRestaurant({ text, imageDataUrl, adminToken })
  A->>A: env.ADMIN_TOKEN で認証
  A->>V: ai.run('llama-3.2-11b-vision-instruct', { image, prompt })
  V-->>A: 「二郎系の濃厚ラーメンの写真」
  A->>N: generateObject({ schema: NormalizedSchema })
  N-->>A: { name, area, genre, tags, atmosphere, price_range, note }
  A->>R: PHOTOS.put(uuid, bytes)
  A->>D: INSERT INTO restaurants (...)
  A->>A: this.saveMessages([userMsg, assistantMsg])
  A-->>C: 新メッセージが WebSocket で同期
  C-->>U: チャット履歴に「✅ 保存しました」が表示
  Note over U,D: 次の search_restaurants で新登録分も hit する
```

## 主要ファイル

```
src/
  index.tsx                 Hono Worker entry。/agents/* を hono-agents へ
  agent.ts                  RestaurantAgent (4 バンドで tools と prompt を分岐)
  modes.ts                  Mode 型 (4 バンド) + MODES 一覧
  models.ts                 Model レジストリ (6 モデル, default は Kimi K2.6)
  types.ts                  Restaurant 型 + D1 行 → Restaurant のマッパ
  ui-components.tsx         共有 UI コンポーネント (Chat + Dynamic Worker 両方で使う)
                            ※ インラインスタイル、React のみ依存、self-contained
  schemas/
    declarative.ts          Section / Card プリミティブの Zod
  tools/
    search-restaurants.ts   D1 検索ツール (全バンド共通)
    render-ui.ts            render_ui / render_html (echo back ツール)
    code-mode-react.ts      Dynamic バンド用 codemode ツール
                            (sucrase で JSX 変換 + worker-bundler で React 環境)
    add-restaurant.ts       Vision + 正規化 + D1 + R2 の登録パイプライン
  client/
    main.tsx                React entry
    App.tsx                 サイドバー + メインペインのレイアウト
    Chat.tsx                useAgentChat + PartView (4 種類の tool 結果を分岐)
    ModelSelector.tsx       モデルドロップダウン
    ModeSelector.tsx        4 バンドのセグメントコントロール
    modes/
      DeclarativeView.tsx   Declarative バンドの再帰描画
      OpenEndedView.tsx     Open-Ended / Dynamic バンドの iframe ラッパ

migrations/                 D1 マイグレーション (init + reseed 横浜 18 件)
wrangler.jsonc              D1 / R2 / Agent (DO) / AI / LOADER バインド
```

## デバグ

dev サーバを `bun run dev` で立ち上げ、Chrome DevTools MCP もしくは普通の DevTools でネットワーク / コンソールを確認。

詳細な現状ステータス・登壇構成・未完了タスクは **[AGENTS.md](./AGENTS.md)** を参照。
