---
name: project_compare_view
description: デモは「ご飯アドバイザー」4パターン比較(Static/Declarative/Open-Ended/Dynamic)。Zodカタログが単一源
metadata:
  node_type: memory
  type: project
  originSessionId: e1494a38-ab59-42e5-8d14-86b9bfcf5dad
---

デモUI = **「ご飯アドバイザー 🍻」**(`App` は `<Compare/>` のみ)。札幌/横浜の夜のご飯プランを **4 パターン**で描き分ける比較デモ。**「バンド」ではなく「パターン」と呼ぶ**(統一済)。詳細な設計は [README.md] / [AGENTS.md] が現状の正(このセッションで全面更新済)。[[project_talk_demo]] の登壇日に使う。

**フロー**: 1行入力 → `/api/intake`(条件抽出) → 表示中パターンが `/api/band`(`streamBand` in `src/compare.ts`)で NDJSON ストリーム生成。タブ切替では再実行せず ↻リロードで再生成。

**Zodカタログ = 単一の真実源** (`src/schemas/catalog.ts`): UI部品の props を Zod で1か所定義し、そこから ① Declarative のプロンプト部品リスト生成 + ツリー検証(`validateDeclNode`)② Dynamic の `declare const` 型宣言(`z.toJSONSchema`)を導出。手書き分散をやめた。

**共有部品** (`src/ui-components.tsx`): `ShopList`(1軒目/2軒目横グリッド+〆を専用カードで配置=レイアウトを部品が所有)/ `RamenCard` / `WeatherBanner` / `LastTrainCard` / `RestaurantCard`。全パターン共通(Dynamic Worker へは `?raw` で埋め込み)。

**4 パターン**(差別化済):
- **Static** = 参考実装(旅行プランナー)準拠。AI は **データ取得ツールを呼ぶだけ**(必須でない・LLM が選ぶ)、呼ばれたツールの出力を**ツールコール順に `switch(tool)` で固定部品へ**(`src/client/modes/StaticView.tsx`)。**build_plan 撤去**= AI のオーサリングゼロ。title はホスト固定テンプレ(クライアント即描画)。「ツール」トグルでツールコール列が見える。
- **Declarative** = AI が UIツリー(JSON)を組む。**Grid(段組み)・Heading(セクション)・Text** で構成された page にして Static と差をつける(天気+終電を Grid 2カラム等)。host が再帰描画(`DeclarativeView`)。
- **Open-Ended** = HTML 1枚 → iframe。**多層防御**(①正規表現サニタイズ ②CSP `connect-src none`+`img-src` を self/ramen-api.dev に絞る ③sandbox=allow-scripts ④srcdoc opaque origin)。
- **Dynamic** = Code Mode。AI が `function App({restaurants})` を書く → Worker Loader で SSR。ランタイムは `src/tools/dynamic-runtime.tsx`(実ファイル・`?raw` 埋め込み・`@ts-nocheck`)。天気/〆は描画時に自分で fetch(Suspense)。**人工遅延は撤去**。

**UI**: プレビュー / ソース(=データ生成物) / 両方 トグル(既定=プレビュー、両方は**中央ドラッグで左右比可変**)。収集中はプレビュー内に「データ収集中」+ツールchip。**左チャットを完全に隠すトグル**(ヘッダー左、サイドバー風アイコン)。ヘッダー順=タイトル→チャットトグル→Clear→…→MODEL/部品/READY。

**〆ラーメンはランダム**(北海道は多数登録あり。ramen.ts と dynamic-runtime の useRamenList で perPage=100 取得→ランダム count 件)。

**旧 Agent/Chat 経路は一括撤去済**(`agent.ts`/`Chat.tsx`/`makeDynamicRenderTool`/agentsMiddleware/wrangler の DO バインド)。

**データ**: Google Places New(`GOOGLE_MAPS_API_KEY`・`/api/places-photo` プロキシ)/ Open-Meteo / ramen-api.dev / 終電は静的テーブル(`lasttrain.ts`)。モデル既定=GPT-4o。

**残タスク**: 本番デプロイ検証 / 英語切替(i18n) 未着手。コミットはユーザが手動で行う方針。
