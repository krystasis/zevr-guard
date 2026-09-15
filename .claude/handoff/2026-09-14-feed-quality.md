# 引き継ぎ: ストアレビュー対応(steamcommunity.com 誤ブロック)— 2026-09-14

## 一言で
レビュー「steamcommunity.com をブロック / 許可できない / 取得後にブロック」への対応は **A/B/C/D/E + R5/R6 まで全部ブランチ `fix/feed-safelist-and-allow` に実装済み(未 push)**。2026-09-14 の再レビューで出た A 優先 7 件 / B 5 件 / C も **すべて対応済み**(経緯は `.claude/handoff/2026-09-14-review-fixes.md`)。残りは push・Worker デプロイ・フィード再配信・版上げで、**すべて人の作業**。

## いまの状態
- ブランチ `fix/feed-safelist-and-allow`(main から数コミット)。`git log main..HEAD` で内容確認。**コミット署名(Co-Authored-By 等)は付けない方針**(オーナー指示)。
- 通っているもの: `npm test`(168件)、`npx tsc -b --noEmit`、`npm run build:app`、`npm run build:firefox`、`npm run e2e`(**117/117**)。
- 実機検証は `/e2e-check` スキル(`.claude/skills/e2e-check/`)から回す。既定は画面に出ないヘッドレスで、`show` / `offscreen` も同じ判定になることを確認済み。
- 手で確認するときは `scripts/dev/build-variant.sh <ref> <label>` で任意のコミットを別フォルダに出せる(`chrome://extensions` にラベル付きで並ぶ)。**古いコミットも今日のデータでビルドされる**ので、当時の誤ブロック再現にはストア版 1.5.12 を有効にすること。
- 未 push、未リリース。ストア版 1.5.12 は静的ルールに steamcommunity.com が焼かれたまま。**1.5.13 が届くまで利用者側は直らない**。
- ストアレビューへの返信は済み(「早急に除外します」「次のバージョンで」)。約束した内容はすべて実装済みで、あとは配信するだけ。
- 配信中フィード(zevrhq.com/feed/v1/malware.json)はまだ安全リスト未適用。`zevr-guard-site` の Actions「Refresh threat feed」を手動実行すれば、この branch の `build-rules` が使われて除外される(workflow は `krystasis/zevr-guard` の **main** を checkout するので、先にマージが要る)。

## 実装済みのもの
- **D** 説明文(lookalike / 国別が「後から警告」になる理由)24言語
- **R5** 警告ページの操作を `GET_BLOCK_CONTEXT` で門番。自分がブロックしていないドメインでは許可ボタンを出さず、`ALLOW_AND_OPEN` も背景側で拒否する
- **R6** `syncMalwareSessionRules` の削除範囲を id < 900,000 に限定
- **A** 訪問履歴ソフトブロック(琥珀色の警告 + 「今回だけ進む」= セッション allow)
- **C** ブロック理由の表示(`malware.meta.json` を別チャネルで配信)
- **B** 誤検知の申告(`/v1/false-positive`、Worker のスキーマとルートも実装済み)
- **E** 全体一時停止(5分 / 1時間 / ブラウザを閉じるまで。セッションルール1本 + alarm。`Settings.blockingEnabled` は削除した)
- 設計外: 地球儀ボタンの修正(ポップアップの自己クローズがサイドパネルを開く処理と競合していた)

## 残っている人の作業
1. push → main にマージ
2. **Worker を先にデプロイ**(`zevr-guard-site/feedback-worker`: `schema.sql` を `--remote` で流してから `wrangler deploy`)。拡張より先でないと申告が 404 になる
3. `zevr-guard-site` の Actions「Refresh threat feed」を手動実行(安全リスト適用済みのフィード + `malware.meta.json` が出る)
4. 版を 1.5.13 に上げてストア提出(`docs/ai-driven.md` §7)

## ハマりどころ(実際に踏んだ)
- e2e で生きたマルウェアホストを踏み台にすると接続が張り付いて navigation が commit せず、誤 FAIL になる。example.com + 擬似セッションルールを使う(ハーネスはそうなっている)。
- Service Worker 内から `chrome.runtime.sendMessage` しても同じ SW の `onMessage` は発火しない。テストでは拡張ページ経由で送る。
- `syncMalwareSessionRules` は今、セッションルールを **全部** 消す。一時許可(機能 A)を入れる前に id 範囲で絞ること(R6)。
- `build:data` は `src/data/malware.json`(gitignore)を seed として持ち越す。安全リストは seed にも掛かるので、古い混入は次のビルドで消える。
- `tldts` は devDependency(ビルド専用)。`scripts/**/*.test.ts` は `vitest.config.ts` の include に足してある。
- **Tranco の順位で自動保護していいのは上位1万まで**。それ以下は稼働中のマルウェアが自力で順位を得る(実測: `dontworry.su` #14,230 が ThreatFox 掲載)。1万〜5万位はビルドログに報告するだけ。ここを「もっと深くまで保護しよう」と変えないこと。
- 訪問履歴(`visits.ts`)はモジュール内にキャッシュを持つ。e2e で `zg.seenExactHosts` を仕込むなら、最初のナビゲーションより前に書くこと。
- ポップアップは `window.close()` を呼ぶ。e2e でポップアップのページを操作すると**本当に閉じる**ので、クリック後に `page.evaluate` で値を読もうとすると落ちる。`page.exposeFunction` で node 側に吐き出すこと(地球儀のテストがその形)。
- 「ブロックされない」ことの確認は、対照を必ず付ける。ナビゲーションが単に成立していないだけでも通ってしまう(lookalike の一時停止テストがその例)。
- 訪問記録は 2 秒の遅延書き込み(`visits.ts` の `FLUSH_MS`)。storage を直接読んで確かめるなら 3 秒待つ。
- `webRequest` の `onCompleted` は `<all_urls>` なので **拡張自身のページも流れてくる**。ホスト名を扱うときは http(s) で絞ること。
- `country.ts` は国別ルール表を、`visits.ts` は訪問表をモジュール内にキャッシュする。e2e から storage を直接書いても反映されない。国別は単体テスト(`country.test.ts`)で担保している。
- **警告ページは web_accessible**。`?reason=` や `?brand=` は攻撃者が指定できる。操作を出す条件は必ず背景の `GET_BLOCK_CONTEXT`(`blockedByUs` / `country` / `lookalike`)から取ること。URL パラメータは表示にしか使わない。
- **カテゴリルール(広告・追跡)は共有インフラを載せない**。`hasCategoryEvidence` が所有者・分類・実績で裏付けを要求する。ここを緩めると `||amazonaws.com` が復活する。

## 検証の仕方
```
npm test && npx tsc -b --noEmit && npm run build:app
npm i -D playwright && npx playwright install chromium   # 初回のみ
npm run e2e                                              # 117/117 PASS が基準
```

## 関連
- 設計: `docs/design/2026-09-feed-quality-and-warning-ux.md`
- 出典メモ: `docs/sources/tranco.md`
- リリース規約: `docs/ai-driven.md` §7(版上げは人、AI はしない)
