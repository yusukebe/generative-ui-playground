# AGENTS.md

このリポジトリは、2026-06-06 開催の [frontend-phpcon-do-2026](https://fortee.jp/frontend-phpcon-do-2026/) Kakehashi Room トーク「**AI 時代の UI はどこへ行く？その 2！**」(Yusuke Wada / 30 分) のデモアプリです。Generative UI の 3 バンドを「レストラン提案」という一つの題材で並べて見せ、加えてサブテーマ「フォーム UI は消える」を体感させることが目的。

このドキュメントは agent (Claude Code 等) が文脈を引き継いで開発を続けられるようにするための記録です。

## 何のためのデモか

- 前作 (前年同カンファレンス) は **MCP-UI** を紹介した。続編は **MCP Apps** への発展 _と_ Generative UI 全般のメインストリーム化を扱う
- 本デモは「Generative UI が一般化した時代の**設計選択肢**」を象徴的に示す装置。MCP Apps を直接ブリッジするものではなく、Spectrum という考え方を見せるためのもの
- MCP Apps はトーク本編で語る — デモはあえて MCP に依存しない作りに保つ

## 中核となる概念: Generative UI Spectrum

CopilotKit が提唱する 3 バンド ([原典](https://www.copilotkit.ai/generative-ui-spectrum))。本リポジトリでは同じプロンプトを 3 モードで投げ分けられる UI で実装する。

| バンド          | LLM 出力                                           | 描画ロジック                                                                                                                                               | このリポでの位置                                                              |
| --------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Controlled**  | tool call で `{ component: "Name", props: {...} }` | 事前定義済み React コンポーネントを name で dispatch、Zod で props 検証                                                                                    | `src/client/modes/ControlledView.tsx` + `src/client/components/restaurant/*`  |
| **Declarative** | JSON UI ツリー `{ type: "Card", children: [...] }` | プリミティブ語彙 (`Card` / `Section` / `Heading` / `Image` / `Tag` / `Button` / `List`) を Zod で定義、JSON を再帰的に React に変換                        | `src/client/modes/DeclarativeView.tsx` + `src/client/components/primitives/*` |
| **Open-Ended**  | HTML + CSS + (inline) JS の文字列                  | `<iframe sandbox="allow-scripts" srcdoc={...}>` + `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; ...">` で外部漏れ遮断しつつ実行 | `src/client/modes/OpenEndedView.tsx`                                          |

参考先行事例: [Zenn 記事 (peintangos)](https://zenn.dev/peintangos/articles/5b6e952c4e8880) — Next.js + LangGraph + Vercel AI SDK 構成。本リポジトリは Cloudflare 完結スタックで作り直す。

## サブテーマ: 「フォーム UI は消える」

レストランデータの**追加**は、専用フォームではなくチャット入力 + 画像 DnD で行う。LLM が曖昧入力を正規化する。

### 登録フロー

1. ユーザがチャット欄に自然文 + 画像をドラッグ&ドロップ (例: 「中目黒のあのラーメン屋すごく良かった」+ 写真)
2. Agent が intent 判定 (登録 / 検索)
3. 登録の場合:
   - Workers AI Vision で画像から「料理名 / 雰囲気 / 推定ジャンル」を抽出
   - テキストから「店名 / エリア / コメント」を抽出
   - **Google Places API** で正式名称・住所・座標を取得 (「情報の出どころは最強でいい」というユーザ判断)
   - R2 に画像保存 (key = uuid)
   - D1 にレコード保存
   - 選択中モードに従って「保存しました」相当の UI を返す

ステージ演出: 「ふつうならここにフォームが出るんですが、**なくなりました**」と語る。

## スタック

完全に Cloudflare 上で完結させる (登壇ストーリーの統一性のため)。

- **Runtime**: Cloudflare Workers + [Hono](https://hono.dev/)
- **UI**: React + [`vite-ssr-components`](https://github.com/yusukebe/vite-ssr-components) (`hono-react` skill の方針)
- **エージェント**: Cloudflare Agents SDK (Durable Object として Agent 保持、WebSocket でクライアント通信)
- **LLM**: Workers AI
  - メイン推論: tool calling 対応モデル (第一候補 Llama 3.3 70B Instruct fp8 fast、実装時に最新ドキュメントで確定)
  - 画像解析: Workers AI Vision モデル (LLaVA 系 or Llama 3.2 Vision)
- **データ**: D1 (レストラン) / R2 (写真)
- **外部 API**: Google Places API (住所正規化)
- **Open-Ended のサンドボックス**: iframe srcdoc + CSP

## UI レイアウト

```
┌──────────────┬─────────────────────────────────────┐
│ History      │  ┌─ Chat (messages with mode badge)┐ │
│ Sidebar      │  │ user: 中目黒のラーメン屋来た 📷  │ │
│ (260px)      │  │ [Controlled] → <RestaurantCard> │ │
│              │  │ user: 静かに飲みたい            │ │
│ • New chat   │  │ [Open-Ended] → iframe ✨        │ │
│ • Session 1  │  └─────────────────────────────────┘ │
│              │  ┌─ Mode: ⦗Controlled⦘ Decl Open ─┐  │
│              │  │ [気分や追加情報を入力 / 📷 DnD]│  │
│              │  └────────────────────────────────┘  │
└──────────────┴─────────────────────────────────────┘
```

- **モード切替方式**: タブで会話を割らず、**入力欄の直上にセグメントコントロール**を置き、送信時に選択モードがそのアシスタント応答に焼き付く。1 セッション内に複数モードのバブルが混在する形にした (デモで「同じ質問を 3 モードで投げる」「会話の途中で切り替える」両方を見せたい)
- 履歴サイドバーは将来用、最初は単一セッションでも十分

## 重要な設計判断と背景

| 判断                                                  | 理由                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare 完結** (Vercel/Next.js を使わない)       | 登壇者が Hono 作者であり Cloudflare 主軸でデモを組みたい。登壇ストーリーの統一性                                                       |
| **モード切替はセグメントコントロール (タブではない)** | タブだと会話履歴が分断され、デモ中に「比較トーク」がしづらい                                                                           |
| **データソースは D1 + R2 (モック JSON ではない)**     | 「ステージでライブ登録してデモする」をやるため。Agent state でなく永続層に置くのは、リハーサル分も次回まで残るから                     |
| **住所正規化は Google Places API**                    | ユーザの判断「情報の出どころは最強でいい」。LLM 知識のみでは「ネット情報で正規化している感」が出ない                                   |
| **画像は Vision モデルでタグ化**                      | デモ価値が大きい。「LLM が写真を見て『台湾まぜそばっぽい』と判定」を見せられる                                                         |
| **Open-Ended は iframe sandbox + CSP**                | XSS とデータ漏洩を両方ケア。`sandbox="allow-scripts"` で JS は許可しないと「動く UI」感が出ない。`connect-src 'none'` で外部通信は遮断 |
| **Open-Ended の Tailwind CDN は最初は許可しない**     | CSP 緩和とビジュアル品質のトレードオフ。見栄えが厳しければ実装中に緩和を検討                                                           |
| **MCP Apps への接続はデモでは作らない**               | トーク本編で語る話なので、デモではあえて切り離して Spectrum そのものに集中させる                                                       |

## ファイル構成

```
src/
  index.tsx                 Hono entry
  agent.ts                  Cloudflare Agents SDK の Agent 定義
  renderer.tsx              SSR shell
  client/
    main.tsx                React SPA entry
    App.tsx                 レイアウト (sidebar + main pane)
    Chat.tsx                チャット (メッセージリスト + 入力 + DnD)
    ModeSelector.tsx        セグメントコントロール
    modes/
      ControlledView.tsx    name → component dispatch
      DeclarativeView.tsx   JSON tree → primitive 再帰描画
      OpenEndedView.tsx     iframe sandbox + srcdoc + CSP
    components/
      restaurant/           RestaurantCard, RestaurantList, RestaurantMap
      primitives/           Card, Section, Heading, Image, Tag, Button, List
  schemas/
    controlled.ts           Controlled で使う各コンポーネントの props (Zod)
    declarative.ts          Declarative のプリミティブ語彙 (Zod)
  tools/
    search-restaurants.ts   D1 をクエリして候補を返す
    add-restaurant.ts       画像+テキスト→Vision+Places→D1+R2
  utils/
    places.ts               Google Places API wrapper
    workers-ai.ts           Workers AI クライアントラッパ
  data/
    schema.sql              D1 マイグレーション
    seed.sql                デモ用シード
wrangler.jsonc              D1 / R2 / Agent (DO) / AI / vars / secrets を追加
```

## デモシナリオ (リハーサル基準)

1. Controlled モードで「中目黒で静かに飲みたい」 → シードから提案カード表示
2. Declarative に切替 → 同じ質問 → 再構成されたカードが出る
3. Open-Ended に切替 → 同じ質問 → 全く違う雰囲気の HTML が iframe で出る
4. 「では今朝行ったラーメン屋を登録します」 → チャット + 写真 DnD → Places が正規化して保存される過程を見せる
5. 続けて「あのラーメン屋みたいなところ他にある？」 → 追加データが提案に含まれる

## 開発・検証フロー

**デバグは Chrome DevTools MCP を使う** (`chrome-devtools-mcp:chrome-devtools` skill)。コンソール / ネットワーク / スクリーンショットを MCP 経由で取得。

```bash
npm run dev      # vite dev (Cloudflare plugin で wrangler 互換)
npm run build    # production build
npm run deploy   # vite build + wrangler deploy
```

Chrome DevTools MCP からの主な利用:

- `list_network_requests` — WebSocket と外部通信の確認
- `take_screenshot` — 3 モードのビジュアル差分確認
- `list_console_messages` — エラー検出
- `fill` / `click` — チャット投入の自動化
- `evaluate_script` — 状態の補助確認

## やらないこと (スコープ外)

- ユーザ認証
- 複数セッションの永続管理
- レストランの編集・削除
- 多言語対応
- MCP Apps への直接ブリッジ

## 関連リンク

- 登壇プロポーザル: https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020
- Generative UI Spectrum 原典: https://www.copilotkit.ai/generative-ui-spectrum
- 先行事例 (Next.js 版): https://zenn.dev/peintangos/articles/5b6e952c4e8880 / https://github.com/peintangos/generative-ui-sample-by-vercel

## 議論経緯 (このプロジェクト誕生まで)

1. ユーザが Generative UI Spectrum (CopilotKit) を題材に挙げ、3 バンドのデモを作りたいと相談
2. テックスタックを Cloudflare Agents SDK + Workers AI + Hono + React に確定
3. UI 切替方式は「タブ」と「会話内モード切替」を比較し、後者 (セグメントコントロール) を採用
4. 単発デモではなく **2026-06-06 のカンファレンス登壇用**であることが判明 → 安定性・舞台映え・6 日制約を設計に追加
5. 「ステージでライブ登録できると面白い」要求 → モック JSON から D1 + R2 の永続層へ
6. 「データ追加はチャット + 写真 DnD でフォームレスに」 → サブテーマ「フォーム UI は消える」が浮上、Generative UI と隣接トピックとしてトークに織り込む方針
7. 住所正規化は Google Places API、画像は Workers AI Vision で解析
8. Open-Ended は iframe sandbox + CSP
9. デバグは Chrome DevTools MCP
10. 「主要モデルから選べると面白い」要望 → ModelSelector を追加 (Llama 4 Scout / Llama 3.3 70B / Llama 3.1 8B / Gemma 3 / Qwen 2.5 Coder)
11. hono-agents を導入し、`/agents/*` ルーティングを `agentsMiddleware` 経由に
12. 型は `CloudflareBindings` で統一 (`Env` は使わない)

## 現在の実装ステータス (2026-05-31 時点)

### 完了

- ✅ React 19 SPA + Vite + Hono + Cloudflare Agents SDK の足場
- ✅ ModelSelector (5 モデル) + ModeSelector (3 バンド)
- ✅ D1 (restaurants) + R2 (PHOTOS) バインド、18 件シードデータ
- ✅ `search_restaurants` ツール (D1 を area/genre/atmosphere/query で検索)
- ✅ Controlled モード: tool call → RestaurantList の dispatch
- ✅ Declarative モード: `render_ui` ツール + Section/Card プリミティブ
- ✅ Open-Ended モード: `render_html` ツール + iframe sandbox + CSP
- ✅ モード切替は Agent state 経由で双方向同期 (`state.mode`)
- ✅ `@callable registerRestaurant`: 画像 DnD → Vision + 正規化 → D1+R2 → saveMessages
- ✅ 型チェック (`tsc --noEmit`) と本番ビルド (`vite build`) が通る

### 未完了 / 要対応

- ⚠️ **Google Places API**: API キー未設定のため住所/座標は `null`。`wrangler secret put GOOGLE_PLACES_API_KEY` を実行し、`src/tools/add-restaurant.ts` の Places 呼び出し部分を埋める必要あり
- ⚠️ **D1 リモートデプロイ**: `wrangler.jsonc` の `database_id: "local"` を実際の DB ID に置き換える必要あり (`wrangler d1 create generative-ui-playground` で取得)
- ⚠️ **R2 バケット作成**: `wrangler r2 bucket create generative-ui-playground-photos`
- ⚠️ **本番デプロイ未検証**: `bun run deploy` をまだ試していない
- ⚠️ **エンドツーエンドの動作確認**: Workers AI を叩いて 3 モードそれぞれが期待通りに UI を生成するか、リハーサルで確認が必要
- ⚠️ **スタイリング磨き込み**: 「あとで」となっている。3 モードの視覚的な差別化はさらに強化できる余地あり (登壇前)
