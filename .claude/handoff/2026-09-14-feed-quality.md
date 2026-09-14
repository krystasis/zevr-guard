# 引き継ぎ: ストアレビュー対応(steamcommunity.com 誤ブロック)— 2026-09-14

## 一言で
レビュー「steamcommunity.com をブロック / 許可できない / 取得後にブロック」の応急処置はブランチ `fix/feed-safelist-and-allow` にコミット済み(未 push)。次にやることは **`docs/design/2026-09-feed-quality-and-warning-ux.md` の §1 の順に実装** すること。設計は全部そこにある。このメモは状態と注意点だけ。

## いまの状態
- ブランチ `fix/feed-safelist-and-allow`(main から 1 コミット)。`git log -1` で内容確認。**コミット署名(Co-Authored-By 等)は付けない方針**(オーナー指示)。
- 通っているもの: `npm test`(126件)、`npx tsc -b --noEmit`、`npm run build:app`、`npm run build:firefox`、`scripts/e2e/verify-extension.mjs`(15/15、5周)。
- 未 push、未リリース。ストア版 1.5.12 は静的ルールに steamcommunity.com が焼かれたまま。**1.5.13 が届くまで利用者側は直らない**。
- ストアレビューへの返信は済み(「早急に除外します」「次のバージョンで」)。返信で約束して未実装なのは、lookalike / 国別ブロックが「後から警告になる」旨の説明文(設計書 §5 = 機能 D)。
- 配信中フィード(zevrhq.com/feed/v1/malware.json)はまだ安全リスト未適用。`zevr-guard-site` の Actions「Refresh threat feed」を手動実行すれば、この branch の `build-rules` が使われて除外される(workflow は `krystasis/zevr-guard` の **main** を checkout するので、先にマージが要る)。

## 実装の順番(設計書 §1 と同じ)
1. D(説明文)+ R5(`blockedByUs` ガード)+ R6(セッションルール削除の id 範囲)→ 1.5.13 に同梱
2. 1.5.13 提出(人の作業: 版上げ commit・tag・push、`npm run build`、ストア提出。`docs/ai-driven.md` §7)
3. A(訪問履歴ソフトブロック)→ C(ブロック理由)→ B(誤検知申告、Worker 先行デプロイ)→ 1.5.14

## ハマりどころ(実際に踏んだ)
- e2e で生きたマルウェアホストを踏み台にすると接続が張り付いて navigation が commit せず、誤 FAIL になる。example.com + 擬似セッションルールを使う(ハーネスはそうなっている)。
- Service Worker 内から `chrome.runtime.sendMessage` しても同じ SW の `onMessage` は発火しない。テストでは拡張ページ経由で送る。
- `syncMalwareSessionRules` は今、セッションルールを **全部** 消す。一時許可(機能 A)を入れる前に id 範囲で絞ること(R6)。
- `build:data` は `src/data/malware.json`(gitignore)を seed として持ち越す。安全リストは seed にも掛かるので、古い混入は次のビルドで消える。
- `tldts` は devDependency(ビルド専用)。`scripts/**/*.test.ts` は `vitest.config.ts` の include に足してある。

## 検証の仕方
```
npm test && npx tsc -b --noEmit && npm run build:app
npm i -D playwright && npx playwright install chromium   # 初回のみ
node scripts/e2e/verify-extension.mjs                     # 15/15 PASS が基準
```

## 関連
- 設計: `docs/design/2026-09-feed-quality-and-warning-ux.md`
- 出典メモ: `docs/sources/tranco.md`
- リリース規約: `docs/ai-driven.md` §7(版上げは人、AI はしない)
