# リハーサルメモ

2026-06-06 frontend-phpcon-do-2026 登壇用のリハーサル手順。詳細は [AGENTS.md](./AGENTS.md) と [README.md](./README.md) を参照。

## 起動

```bash
bun install
bun run db:migrate:local  # D1 マイグレーション + シード投入 (初回 / DB リセット時のみ)
bun run dev               # http://localhost:5173/
```

`.dev.vars` に `ADMIN_TOKEN=local-admin` (任意の値) を入れておくと管理モードが使える。

## デフォルト

- **モデル**: Llama 4 Scout (速くてバランス良い)
- **モード**: Controlled

## 4 バンドそれぞれの動作確認 (ステージ前のリハーサル)

ヘッダーから ModeSelector でバンドを切り替えて、毎回同じプロンプトを投げる。

### サンプルクエリ (チップで送信可)

- 関内で静かに飲みたい (関内 + 静か → 喫茶 さくら / BAR Kingdom)
- 中華街で点心 (中華街 + 中華)
- 桜木町でクラフトビール (CRAFT BEER MARKET 桜木町)
- みなとみらいでデート (Le Petit Marche)

### 想定挙動

| バンド          | LLM の挙動                                | 描画                             | 所要時間 (目安)                 |
| --------------- | ----------------------------------------- | -------------------------------- | ------------------------------- |
| **Controlled**  | search_restaurants を呼ぶだけ             | RestaurantList が並ぶ            | 数秒                            |
| **Declarative** | search → render_ui で Section/Card ツリー | DeclarativeView (色付き Section) | 10〜20 秒                       |
| **Open-Ended**  | search → render_html で HTML 全文         | iframe (独自デザイン)            | 20〜40 秒                       |
| **Dynamic ✨**  | dynamic_render で Worker module を書く    | iframe (SSR 結果)                | 30〜60 秒 (初回 npm fetch あり) |

### Dynamic の初回コスト

Dynamic を初めて呼ぶときは worker-bundler が npm registry から `react` / `react-dom` を fetch してバンドルするため **時間がかかる**。ステージ前に必ず 1 回 warm-up しておく:

```
1. Dynamic モードに切替
2. サンプル「関内で静かに飲みたい」を 1 回送る
3. iframe で SSR された UI を確認
```

これで 2 回目以降はキャッシュが効くので速くなる (はず)。

## フォームレス登録デモ (セクション 9)

1. ヘッダーの 🔒 ボタンをクリックし、Admin token (local-admin) を入力
2. 🔓 Admin 表示になり、入力欄左に 📷 ボタンが現れる
3. 写真を画面にドラッグ&ドロップ or 📷 ボタンで選択
4. 入力欄に「中華街のあの店行ってきた」など自然文を入れる
5. 送信 → 登録 → 「✅ 保存しました」が表示
6. 続けて Controlled モードで関連クエリ ("中華街のおすすめ") を投げると新登録分が hit する

## ステージで起きうるトラブル & 対処

### ステータスが "ERROR" になる

React Max update depth warning が原因のことがある (AI SDK 内部の挙動)。動作は OK なら無視。実際の error は `useAgentChat` の `error` が立ったときだけ。

### LLM が tool を呼んでくれない

- Clear ボタンで会話履歴をクリア (過去の失敗が悪影響することがある)
- モデルを Llama 3.3 70B fp8 fast に切り替えてリトライ (tool calling が安定)

### Dynamic で `Dynamic require of "util"` エラー

`react-dom/server` (拡張子なし) を LLM が書いてしまうと出る。host 側で `react-dom/server.edge` に書き換える二重防御を入れているが、稀にすり抜ける。Clear して再試行で改善。

### worker-bundler が遅い

npm registry からの fetch がボトルネック。一度叩いておけば暖まる。ステージ直前の warm-up 必須。

## デプロイ (本番)

```bash
# D1 / R2 を Cloudflare 側に作成
wrangler d1 create generative-ui-playground       # 出力された ID を wrangler.jsonc の database_id に貼る
wrangler r2 bucket create generative-ui-playground-photos

# Admin token (本番用)
wrangler secret put ADMIN_TOKEN

# 本番マイグレーション
bun run db:migrate:remote

# デプロイ
bun run deploy
```

> 注: `wrangler.jsonc` の `database_id` は今 `"local"` のままなので、deploy 前に **必ず実 ID に置き換え**ること。

## 登壇前最終チェックリスト

- [ ] `wrangler whoami` でログイン状態を確認
- [ ] Workers AI のクレジット残量を確認
- [ ] 4 バンド全部リハーサル (warm-up 兼ねて)
- [ ] フォームレス登録デモを 1 回試す
- [ ] ステージ環境のネットワーク状況 (会場 Wi-Fi が速いか)
- [ ] 画面解像度に合わせて拡大率 (Ctrl/Cmd + +) を調整
- [ ] バックアップ: 失敗時に切り替えるモデル候補 (Llama 4 Scout / Gemma 3 12B)
