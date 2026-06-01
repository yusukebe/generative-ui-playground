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

## 中核アイデア (2026-05-31 大改修後)

**LLM がコードを書く → Dynamic Worker で実行 → Response を返す**、を主軸とした **Code Mode + React** の単一プラットフォーム上で、LLM が状況に応じて Spectrum 上を歩く。

ハードな ModeSelector は撤去した。LLM のコード次第で:

- `<RestaurantList restaurants={...} />` を 1 個借りる → Controlled 寄り
- Section / Card ツリーで `gui-tree+json` を返す → Declarative 寄り
- 自分で raw な JSX で凝る → Open-Ended 寄り

**Spectrum はモードではなく LLM の選択**、というのが最終的な主張。

### 共有 UI コンポーネント

`src/ui-components.tsx` に **チャット側と Dynamic Worker サンドボックス側の両方で使う**コンポーネントを集約。

- インラインスタイル only (CSS クラスは iframe には届かないため)
- `react` のみ依存、self-contained TSX
- vite の `?raw` import でソース文字列を取得 → worker-bundler で TSX → JS にバンドル → DynamicWorkerExecutor の modules に `'restaurant-ui'` として inject
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

| 判断                                                    | 理由                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare 完結** (Vercel/Next.js を使わない)         | 登壇者が Hono 作者。Cloudflare 主軸でデモを組みたい                                                                                                                       |
| **Code Mode + React を全モードで使う**                  | LLM が同じ仕組みで Spectrum を歩けるようにするため                                                                                                                        |
| **ModeSelector 撤去**                                   | コンポーネント借用と raw 自由度のグラデーションを LLM に任せた方が「LLM の選択としての Spectrum」が伝わる                                                                 |
| **Content-Type で UI 描画を分岐**                       | 擬似 Response `{ contentType, body }` の Content-Type を見て RestaurantList / DeclarativeView / iframe を切り替え                                                         |
| **共有コンポーネントを worker-bundler で inject**       | LLM が JSX で `<RestaurantList />` を借りられる = Spectrum の「Controlled 端」を表現できる                                                                                |
| **sucrase で JSX → React.createElement**                | DynamicWorkerExecutor が arrow function を期待しているため、ESM モジュール bundle 前提の `jsx: 'automatic'` は不可。classic transform で素直に React.createElement を吐く |
| **データソースは D1 + R2 (モック JSON ではない)**       | ステージでライブ登録するため。Agent state でなく永続層に置けばリハーサル分も残る                                                                                          |
| **画像は Vision モデルでタグ化**                        | デモ価値が大きい。「LLM が写真を見て『二郎系』と判定」が見せられる                                                                                                        |
| **Open-Ended は iframe sandbox + CSP**                  | XSS とデータ漏洩を両方ケア。`sandbox="allow-scripts"` で JS は許可、`connect-src 'none'` で外部通信遮断                                                                   |
| **Admin token は localStorage**                         | デモなのでシンプルに。本番は `wrangler secret put ADMIN_TOKEN` で                                                                                                         |
| **MCP Apps への接続はデモでは作らない**                 | トーク本編で語る話なので、デモではあえて切り離す                                                                                                                          |
| **型は `CloudflareBindings` で統一** (`Env` は使わない) | プロジェクトコンベンション                                                                                                                                                |

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
12. **大改修**: ModeSelector 撤去、Code Mode 常時 ON
13. **擬似 Response { contentType, body }** に統一、Content-Type で UI 分岐
14. **JSX + worker-bundler + sucrase** で LLM が JSX を書けるように
15. **共有 UI コンポーネント** (`src/ui-components.tsx`) を Dynamic Worker に inject
    → LLM が `<RestaurantList />` を借用するか raw JSX で書くかを自由に選べる
    → ModeSelector を完全に撤去し、Spectrum は LLM の選択として現れる

## 現在の実装ステータス

### 完了

- ✅ React 19 SPA + Vite + Hono + Cloudflare Agents SDK の足場
- ✅ ModelSelector (6 モデル, デフォルト Kimi K2.6)
- ✅ D1 (restaurants) + R2 (PHOTOS) バインド + 横浜 18 件シード
- ✅ `search_restaurants` ツール (D1 検索)
- ✅ **Code Mode + JSX + React 環境** (`makeReactCodeTool` in `src/tools/code-mode-react.ts`)
  - sucrase で JSX → React.createElement
  - worker-bundler で React / react-dom/server / restaurant-ui を ESM バンドル
  - DynamicWorkerExecutor の modules として inject
- ✅ Content-Type ベースの UI 分岐 (`ResponseView` in `src/client/Chat.tsx`)
- ✅ 共有 UI コンポーネント (`src/ui-components.tsx`、両側で同一)
- ✅ `@callable registerRestaurant`: 画像 DnD → Vision + 正規化 → D1+R2 → saveMessages
- ✅ Admin token (localStorage + env.ADMIN_TOKEN)
- ✅ ヘッダーに ModelSelector / Clear / Admin / ステータス
- ✅ 進行状況表示 (思考中スピナー)
- ✅ チャット入力欄で ↑↓ で過去発話を辿れる
- ✅ prettier (hono 設定)、型チェック (`tsc --noEmit`) と本番ビルド (`vite build`)
- ✅ README のアーキテクチャ解説を新設計に合わせて全面書き換え

### 未完了 / 要対応

- ⚠️ **エンドツーエンドの動作確認**: Workers AI を叩いて LLM が実際に JSX を書いて Dynamic Worker で動かす流れがエラー無く通るか、十分に確認していない。リハーサル必須
- ⚠️ **Google Places API**: 住所/座標は `null` のまま (キー未設定)。本番までに `wrangler secret put GOOGLE_PLACES_API_KEY` + `src/tools/add-restaurant.ts` の埋め込み
- ⚠️ **D1 リモートデプロイ**: `wrangler.jsonc` の `database_id: "local"` を実際の DB ID に置き換え (`wrangler d1 create generative-ui-playground` で取得)
- ⚠️ **R2 バケット作成**: `wrangler r2 bucket create generative-ui-playground-photos`
- ⚠️ **本番デプロイ未検証**: `bun run deploy` をまだ試していない
- ⚠️ **worker-bundler の初回コスト**: 起動直後の最初のリクエストは React / react-dom/server / restaurant-ui を bundle するので遅い。本番では起動時に warm-up したい
- ⚠️ **スタイリング磨き込み**: 「あとで」となっている。3 モードの視覚的な差別化はさらに強化できる余地あり (登壇前)
- ⚠️ **登壇用リハーサル**: 想定する 5 つのデモシナリオを Kimi K2.6 で実行して、想定通りの Spectrum 移動が起きるか確認

## 今後の検討候補 (登壇前に時間があれば)

ユーザ提案 (2026-05-31 後半):

1. **ガチの Response を返す** — `new Response(body, { headers: { 'content-type': ... } })` を LLM の関数戻り値として実際に返す。AI SDK の JSON シリアライズを越えるには codemode の executor を介さず `env.LOADER` 直叩きで Response を受け取るフローへ作り替える必要あり。「LLM が Worker のハンドラーを書いてる」感が更に増す
2. **`list_components()` ツール** — LLM が「使えるコンポーネント一覧」を動的に取得できる仕組み。prompt 直書きから動的化、MCP Apps の文脈にも繋がる。実装軽い・効果大
3. **ストリーミング描画** — `search_restaurants` の tool-call part が来た時点で先行レンダして、codemode の最終結果と差し替え or マージ。コンポーネント借用ルートが高速・ストリーム描画になり、Spectrum に **性能軸**が加わる

## デモシナリオ (リハーサル基準)

ModeSelector を撤去した今、LLM への要望文で Spectrum 上を移動する:

1. 「関内で静かに飲みたい」 → LLM はシンプルに `<RestaurantList />` 借用 (Controlled 寄り)
2. 「目的別に整理して」 → `gui-tree+json` を返して DeclarativeView 描画 (Declarative 寄り)
3. 「マップで表示して」 / 「もっと派手に」 → 自分で SVG + raw JSX で凝る (Open-Ended 寄り)
4. 「今朝行ったラーメン屋を登録 (写真 DnD)」 → 登録フロー
5. 「あの店みたいなとこ他にある？」 → 新登録分が hit

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
