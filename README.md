# Generative UI Playground

CopilotKit が提唱する [**Generative UI Spectrum**](https://www.copilotkit.ai/generative-ui-spectrum) の 3 バンド (Controlled / Declarative / Open-Ended) を、同一題材「レストラン提案」で並べて見せるデモ。

2026-06-06 [frontend-phpcon-do-2026](https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020) トーク「AI 時代の UI はどこへ行く？その 2！」用。

## 3 つのバンド

| バンド | LLM 出力 | 描画 |
| --- | --- | --- |
| **Controlled** | tool call `{ component, props }` | 事前定義 React コンポーネントを dispatch |
| **Declarative** | JSON UI ツリー | プリミティブ語彙を再帰的に組立 |
| **Open-Ended** | HTML + CSS + JS | `<iframe sandbox>` + CSP で実行 |

並走サブテーマ: **「フォーム UI は消える」** — レストラン登録は専用フォームではなく、チャット入力 + 写真 DnD で行い、LLM が曖昧な自然言語入力を正規化する。

## Tech Stack

- Cloudflare Workers + [Hono](https://hono.dev/) + [hono-agents](https://www.npmjs.com/package/hono-agents)
- React 19 + Vite
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (Durable Object として Agent を保持)
- Workers AI (Llama 4 Scout)
- D1 (レストラン) + R2 (写真)
- Google Places API (住所正規化)

## 開発

```bash
bun install
bun run dev          # http://localhost:5173/
```

```bash
bun run cf-typegen   # wrangler.jsonc 変更後、型を再生成
bun run deploy       # Cloudflare へデプロイ
```

## 詳しいドキュメント

設計判断・3 バンドの実装方針・登録フローなどの詳細は **[AGENTS.md](./AGENTS.md)** を参照。
