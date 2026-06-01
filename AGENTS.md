# AGENTS.md

このリポジトリは、2026-06-06 開催の [frontend-phpcon-do-2026](https://fortee.jp/frontend-phpcon-do-2026/) Kakehashi Room トーク「**AI 時代の UI はどこへ行く？その 2！**」(Yusuke Wada / 30 分) のデモアプリです。

このドキュメントは agent (Claude Code 等) が文脈を引き継いで開発を続けられるようにするための記録。**ユーザ向けの設計説明は [README.md](./README.md)** にまとまっているので、まずそちらを読んでください。本ドキュメントは「設計判断の裏側 / 議論経緯 / 未完了タスク」中心。

## 何のためのデモか

- 前作 (前年同カンファレンス) は **MCP-UI** を紹介。続編は **MCP Apps** への発展と Generative UI 全般のメインストリーム化を扱う
- 本デモは「Generative UI が一般化した時代の**設計選択肢**」を象徴的に示す装置
- MCP Apps はトーク本編で語る — デモはあえて MCP に依存しない作りに保つ

## プレゼンのコアメッセージ

> **Code Mode と Dynamic Workers で、Generative UI の未来を見せる**

「Spectrum を 3 つに分けて見せる」ではない。**LLM がコードを書き、Dynamic Worker で実行される**仕組みそのものが面白く、その結果として Spectrum 上の様々な点に **LLM 自身が降り立てる**ことを体感させる。

> 「これが未来です」がかっこいい着地。

### プレゼン構成 (2026-06-06 登壇)

本デモアプリが登壇のどこで使われるかと、各セクションで見せたい挙動の対応:

| #   | セクション                                                                             | このリポの関わり                                                                                        |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | 前回のおさらい (MCP-UI)                                                                | —                                                                                                       |
| 2   | MCP-UI → MCP Apps への進化                                                             | —                                                                                                       |
| 3   | MCP Apps の説明                                                                        | —                                                                                                       |
| 4   | Generative UI という大きな流れ                                                         | —                                                                                                       |
| 5   | Spectrum の説明 (Controlled / Declarative / Open-Ended)                                | —                                                                                                       |
| 6   | **デモを作ってみた**                                                                   | **3 バンドそれぞれで同じ質問を投げ、UI が違うことを見せる**                                             |
| 7   | **第 4 のパターン「Dynamic」** ⭐                                                      | **同じ題材を Dynamic (Code Mode + Dynamic Worker + JSX SSR) で投げて、先の 3 つを超える表現力を見せる** |
| 8   | Generative UI のまとめ                                                                 | —                                                                                                       |
| 9   | 補足: エージェント時代にフォームはなくなる？                                           | **フォームレス登録デモ (Admin で画像 D&D + 自然文 → Vision + Places 正規化 → D1+R2 保存)**              |
| 10  | みんなの新聞のデモ ([everyones-times.yusuke.run](https://everyones-times.yusuke.run/)) | (別アプリ)                                                                                              |
| 11  | 全体のまとめ: 「**UI はなくならないが、AI が UI を作る**」                             | —                                                                                                       |

ストーリーアーチ:

- セクション 9 で **「定型フォームは消える」** を見せ、
- セクション 11 で **「でも UI 自体はなくならない (AI が UI を作る側に回る)」** で着地

→ サブテーマ「フォーム UI は消える」が**メイントピックの中に綺麗に組み込まれる**構成。

### Dynamic バンド (第 4 の追加)

CopilotKit の Spectrum は 3 バンドだが、本デモでは **4 つ目「Dynamic」**を提案する位置付け:

| バンド         | LLM 出力                   | 実装ハイライト                                  |
| -------------- | -------------------------- | ----------------------------------------------- |
| Controlled     | tool call で props         | 事前定義コンポーネント dispatch                 |
| Declarative    | JSON UI ツリー             | プリミティブ語彙の再帰描画                      |
| Open-Ended     | HTML 文字列                | iframe + CSP                                    |
| **Dynamic** ✨ | **JSX (動的にコード生成)** | **Dynamic Worker で SSR、コンポーネント借用可** |

Dynamic は Open-Ended の延長線上だが、LLM が**コードを書く** ことで:

- サンドボックス隔離が標準で付く (Worker Loader)
- React 環境 (renderToString) が走る
- 既存コンポーネントを借用できる → Spectrum を内側でグラデーションできる

セクション 7 のクライマックスでこの位置付けを宣言する:

> 「Generative UI Spectrum には 3 つのバンドがあると言われています。でも僕は **4 つ目**を提案します — それが **Dynamic** です。これが LLM が書く SSR、未来の Generative UI の姿です。」

### 別フレーミング: 「LLM が書く SSR / JIT SSR」

このデモの仕組みは本質的に **サーバーサイドレンダリング**そのもの。違うのは「誰が書いたか」:

```
通常の SSR (Next.js / Remix):
  開発者が書いた React コンポーネント → サーバで renderToString → HTML

このデモの SSR:
  LLM が書いた React コンポーネント → Dynamic Worker で renderToString → HTML
            ↑ リクエスト時に動的生成 (JIT)
```

- **コンポーネントがリクエスト時に LLM から動的生成される** (JIT)
- 実行環境はリクエストごとに**隔離 Worker がスピンアップ**する
- 出力は普通の React renderToString が吐く HTML 文字列

つまり「**Code Mode + Dynamic Worker = LLM SSR の実装基盤**」と一発で説明できる。Spectrum 議論はこの上に乗る枝葉、というフレームも成立する。

## 中核アイデア (2026-06-01 再構成後)

**4 バンド構成**: Controlled / Declarative / Open-Ended (古典的 3 バンド) に加えて、**第 4 のバンド「Dynamic」** を提案する位置付け。

- 古典 3 バンドは echo-back ツール (`render_ui` / `render_html`) または直叩き tool で実装、シンプル
- **Dynamic は Code Mode + Dynamic Worker + JSX + React** で実装。LLM が書く SSR の実装基盤
- ModeSelector で 4 つを切り替え可能 (ステージで「同じ質問を 4 モードで投げて比較」できる)
- Dynamic は内側で更にグラデーションあり: `<RestaurantList />` を借りる ↔ raw な `<div>` で凝る

> 2026-05-31 に一度 ModeSelector 撤去 + Code Mode 一本化を試したが、登壇演出 (「**実は 4 つ目を考えました！**」) の都合で 4 バンド共存に再構成した (2026-06-01)。

### 共有 UI コンポーネント

`src/ui-components.tsx` に **チャット側と Dynamic Worker サンドボックス側の両方で使う**コンポーネントを集約。

- インラインスタイル only (CSS クラスは iframe には届かないため)
- `react` のみ依存、self-contained TSX
- vite の `?raw` import でソース文字列を取得 → worker-bundler に `files['src/restaurant-ui.tsx']` として渡し、LLM の Worker module から `'./restaurant-ui'` で相対 import 可能に
- LLM の prompt には `.d.ts` 相当の型情報を埋め込む

## サブテーマ: 「フォーム UI は消える」

レストラン登録は専用フォームではなくチャット入力 + 画像 DnD で行う。LLM が曖昧入力を正規化。Admin 限定 (env `ADMIN_TOKEN`)。

### 登録フロー

1. 登壇者がチャット欄に自然文 + 画像をドラッグ&ドロップ
2. クライアントが `agent.stub.registerRestaurant({ text, imageDataUrl, adminToken })` を RPC
3. Agent 側で `env.ADMIN_TOKEN` と照合 → 不一致なら拒否
4. Workers AI Vision で画像から特徴抽出
5. Llama 3.3 70B の `generateObject` で構造化 (name / area / genre / tags / atmosphere / price_range / note)
6. R2 に画像保存 (key = uuid)、D1 にレコード保存
7. `this.saveMessages` で確認メッセージを履歴に追加

> Google Places API での住所正規化は当初の計画にあったが未配線。`address`/`lat`/`lng` は今 `null`。

ステージ演出: 「ふつうならここにフォームが出るんですが、**なくなりました**」と語る。

## 重要な設計判断と背景

| 判断                                                    | 理由                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare 完結** (Vercel/Next.js を使わない)         | 登壇者が Hono 作者。Cloudflare 主軸でデモを組みたい                                                                                                                                                                                      |
| **Dynamic だけ "コードを書く" 仕様、他は素朴な tool**   | Spectrum を「素朴 → 動的」の階段として見せるため。Controlled/Declarative/Open-Ended は echo back ツールで素朴に、Dynamic だけ worker-bundler + LOADER で「LLM が SSR Worker module を書く」                                              |
| **4 バンドを ModeSelector で切替可能に**                | 登壇演出「実は 4 つ目を考えました」のため。Dynamic を第 4 のバンドとして他 3 つと並べて見せる                                                                                                                                            |
| **Content-Type で UI 描画を分岐**                       | 擬似 Response `{ contentType, body }` の Content-Type を見て RestaurantList / DeclarativeView / iframe を切り替え                                                                                                                        |
| **共有コンポーネントを worker-bundler で bundle 同梱**  | LLM が JSX で `<RestaurantList />` を借りられる = Spectrum の「Controlled 端」を表現できる。`src/ui-components.tsx` を `'./restaurant-ui'` で相対 import 可能に                                                                          |
| **Dynamic は hono-eval パターン**                       | LLM が**完全な Cloudflare Worker module** を書く → `createWorker` でバンドル → `env.LOADER.get` で spawn → `worker.fetch(request)` で実行。codemode 経由ではなく env.LOADER 直叩きで Response を返すため、ガチの「LLM が書く SSR」になる |
| **react-dom/server.edge を強制**                        | `react-dom/server` (default) は node 版で `util` を require して Worker runtime で動かない。prompt で `.edge` 付きを必須にしつつ、念のため host 側で string replace でも書き換える二重防御                                               |
| **データソースは D1 + R2 (モック JSON ではない)**       | ステージでライブ登録するため。Agent state でなく永続層に置けばリハーサル分も残る                                                                                                                                                         |
| **画像は Vision モデルでタグ化**                        | デモ価値が大きい。「LLM が写真を見て『二郎系』と判定」が見せられる                                                                                                                                                                       |
| **Open-Ended は iframe sandbox + CSP**                  | XSS とデータ漏洩を両方ケア。`sandbox="allow-scripts"` で JS は許可、`connect-src 'none'` で外部通信遮断                                                                                                                                  |
| **Admin token は localStorage**                         | デモなのでシンプルに。本番は `wrangler secret put ADMIN_TOKEN` で                                                                                                                                                                        |
| **MCP Apps への接続はデモでは作らない**                 | トーク本編で語る話なので、デモではあえて切り離す                                                                                                                                                                                         |
| **型は `CloudflareBindings` で統一** (`Env` は使わない) | プロジェクトコンベンション                                                                                                                                                                                                               |

## 議論経緯 (時系列)

1. CopilotKit の Generative UI Spectrum (3 バンド) を題材に決定
2. テックスタックを Cloudflare Agents SDK + Workers AI + Hono + React に確定
3. UI 切替方式: タブ vs 会話内モード切替 → 後者 (セグメントコントロール) 採用
4. 2026-06-06 カンファレンス登壇用と判明 → 安定性・舞台映え・6 日制約を設計に追加
5. 「ステージでライブ登録」要求 → モック JSON から D1 + R2 の永続層へ
6. 「フォームレス登録」サブテーマが浮上 (画像 DnD + 自然文)
7. hono-agents 導入、`Env` → `CloudflareBindings` 統一
8. Kimi K2.6 追加、`stopWhen: stepCountIs(5)` で multi-step 有効化
9. **題材を中目黒 → 横浜 (関内周辺) に変更** (登壇者の地元)
10. README にアーキテクチャ Mermaid 図 (3 つに分割)
11. Admin 機構: `localStorage` + `env.ADMIN_TOKEN`
12. (一時的) ModeSelector 撤去、Code Mode 常時 ON、擬似 Response { contentType, body } で UI 分岐に統一
13. **登壇演出のため 4 バンド構成に戻す** (2026-06-01)
    → Controlled / Declarative / Open-Ended / **Dynamic** を ModeSelector で切替
    → 古典 3 バンドは echo back ツール (render_ui / render_html) で素朴に実装
    → Dynamic だけ新世代 (Code Mode + Dynamic Worker + JSX)
14. **Dynamic を hono-eval パターンに再実装** (2026-06-01)
    → 元々の `@cloudflare/codemode` 経由 → うまく動かない部分があったため
    → `@cloudflare/worker-bundler` + `env.LOADER` 直叩き + `worker.fetch()` パターンに切替
    → LLM が完全な Worker module を書く
    → React + react-dom + restaurant-ui は worker-bundler が npm registry から resolve
    → `react-dom/server.edge` を強制 (node 版は util require で動かないため)
15. **共有 UI コンポーネント** (`src/ui-components.tsx`) を Dynamic Worker に bundle 同梱
    → LLM が `<RestaurantList />` を借用するか raw JSX で書くかを自由に選べる

## 現在の実装ステータス

### 完了

- ✅ React 19 SPA + Vite + Hono + Cloudflare Agents SDK の足場
- ✅ ModelSelector (5 モデル, デフォルト Llama 3.3 70B fp8 fast。Kimi K2.6 は Workers AI 上で遅すぎたため外した)
- ✅ D1 (restaurants) + R2 (PHOTOS) バインド + 横浜 18 件シード
- ✅ `search_restaurants` ツール (D1 検索)
- ✅ **4 バンド構成** (ModeSelector で切替):
  - Controlled: search_restaurants 直叩き → RestaurantList でレンダ
  - Declarative: search_restaurants + `render_ui` (echo back) → DeclarativeView
  - Open-Ended: search_restaurants + `render_html` (echo back) → iframe + CSP
  - **Dynamic ✨**: `dynamic_render` (hono-eval パターン) → 完全な Worker module を spawn → SSR HTML
- ✅ **Dynamic = hono-eval パターン** (`src/tools/dynamic-render.ts`):
  - LLM は `{ search: SearchInput, code: string }` を出力
  - host で search 実行 → `createWorker` で bundle (react/react-dom を npm 解決) → `env.LOADER.get` で spawn → `worker.getEntrypoint().fetch()` で HTML 取得
  - `react-dom/server.edge` を prompt + string replace で強制
  - restaurant-ui は files に同梱して `'./restaurant-ui'` で相対 import 可能
- ✅ 共有 UI コンポーネント (`src/ui-components.tsx`、Chat 側と Dynamic Worker の両方で同一実装)
- ✅ `@callable registerRestaurant`: 画像 DnD → Vision + 正規化 → D1+R2 → saveMessages
- ✅ Admin token (localStorage + env.ADMIN_TOKEN)
- ✅ ヘッダーに ModeSelector / ModelSelector / Clear / Admin / カラーステータス
- ✅ AI メッセージにモードバッジ (Controlled/Declarative/Open-Ended/Dynamic)
- ✅ Declarative/Open-Ended/Dynamic では search_restaurants の生結果表示を抑制 (重複防止)
- ✅ 進行状況表示 (思考中スピナー)、Clear ボタン、チャット入力欄で ↑↓ で履歴辿り
- ✅ 空状態にサンプルクエリチップ (デモ中に即送信できる)
- ✅ prettier (hono 設定)、型チェック (`tsc --noEmit`) と本番ビルド (`vite build`)
- ✅ E2E 動作確認 (4 バンドそれぞれ動作。当初 Kimi K2.6 で確認したが遅いため Llama 3.3 70B fp8 fast に変更)

### 未完了 / 要対応

- ⚠️ **React Max update depth warning**: AI SDK の useChat の useSyncExternalStore で React が警告を出すことがある。動作は OK だがコンソールが汚れる
- ⚠️ **Google Places API**: 住所/座標は `null` のまま (キー未設定)。本番までに `wrangler secret put GOOGLE_PLACES_API_KEY` + `src/tools/add-restaurant.ts` の埋め込み
- ⚠️ **D1 リモートデプロイ**: `wrangler.jsonc` の `database_id: "local"` を実際の DB ID に置き換え (`wrangler d1 create generative-ui-playground` で取得)
- ⚠️ **R2 バケット作成**: `wrangler r2 bucket create generative-ui-playground-photos`
- ⚠️ **本番デプロイ未検証**: `bun run deploy` をまだ試していない
- ⚠️ **worker-bundler の初回コスト**: Dynamic の最初の呼び出しは npm から react / react-dom を fetch + bundle するため遅い。本番では起動時に warm-up または cache 戦略が必要
- ⚠️ **登壇用リハーサル**: 想定するデモシナリオを通しで実行

## 今後の検討候補 (登壇前に時間があれば)

1. **ガチの Response を返す** (実は dynamic_render で既に実現済み — hono-eval パターンで `worker.fetch()` の `Response` を受けてる)
2. **`list_components()` ツール** — LLM が「使えるコンポーネント一覧」を動的に取得できる仕組み。prompt 直書きから動的化、MCP Apps の文脈にも繋がる
3. **ストリーミング描画** — `search_restaurants` の tool-call part が来た時点で先行レンダ。コンポーネント借用ルートが高速・ストリーム描画になり、Spectrum に **性能軸**が加わる
4. **Open-Ended の Tailwind CDN 許可** — iframe 内で見栄えを上げたい時の選択肢
5. **React Max update depth warning の解消** — useAgentChat 内部のループ。動作問題はないが console が汚れる

## デモシナリオ (リハーサル基準)

ModeSelector で 4 バンドを切り替えながら、同じ質問「**関内で静かに飲みたい**」を投げて UI の違いを見せる:

1. **Controlled** → search_restaurants だけで RestaurantList カードが並ぶ (シンプル)
2. **Declarative** → 「静かに過ごせるお店」のセクション + Card プリミティブで整理された UI
3. **Open-Ended** → 独自デザインの HTML が iframe で出る (色使い、レイアウト自由)
4. **Dynamic ✨** → LLM が書いた **完全な Worker module** が表示され、Dynamic Worker で SSR された HTML が iframe に流れる
   - 「これがクライマックス: LLM が書く SSR、Cloudflare Worker Loader で実行」
5. (フォームレス登録デモ) Admin モードで画像 DnD + 自然文 → Vision + 正規化 → D1+R2 保存

## やらないこと (スコープ外)

- ユーザ認証 (admin token のみ)
- 複数セッションの永続管理
- レストランの編集・削除
- 多言語対応
- MCP Apps への直接ブリッジ

## 関連リンク

- 登壇プロポーザル: https://fortee.jp/frontend-phpcon-do-2026/proposal/3435cc2a-90b6-4f28-8394-1d0665001020
- Generative UI Spectrum 原典: https://www.copilotkit.ai/generative-ui-spectrum
- 先行事例 (Next.js 版): https://zenn.dev/peintangos/articles/5b6e952c4e8880

## デバグ

dev サーバ `bun run dev` + Chrome DevTools MCP (`chrome-devtools-mcp:chrome-devtools` skill)。コンソール / ネットワーク / スクリーンショットを MCP 経由で確認できる。
