# リリース前レビュー(2026-09-15)— Opus 向け修正指示

対象: zevr-guard `fix/feed-safelist-and-allow`(23 コミット)+ zevr-guard-site `fix/false-positive-reports`(2 コミット)。
結論: **必須 2 件を直すまでリリース不可**。それ以外は任意。すべて手元で実在を確認済み。修正後は `npm test` / `npm run e2e`(117/117 基準、項目を足すこと)/ `npm run build:firefox` を通す。署名行は付けない。

---

## 必須 1. クライアント側フィード検証が、共有ホスティングのテナントを丸ごと落とす → LP のツアーが壊れる

- **場所**: `src/background/feedguard.ts` `sanitizeMalwareFeed` と、`scripts/build-rules.ts` が出す `src/data/popular.json`。
- **何が起きるか**: `popular.json` は Tranco 上位 1 万の登録ドメインで、`workers.dev`(#80)や `duckdns.org`・`on.aws`・`azurefd.net`・`pantheonsite.io` を含む。クライアントは PSL を持たないので、`findSelfOrParent` が `evil.workers.dev` → `workers.dev` を「人気ドメイン配下」と判定して落とす。ビルド時の安全リスト(`scripts/safelist.ts`)はこれをテナント別サイトとして**残す**設計なので、クライアントだけが厳しい。
- **実測**: 今日のフィード 2,400 件のうち 21 件を落とす。内訳 `workers.dev` 13 / `azurefd.net` `amazonaws.com` `kozow.com` `duckdns.org` `dpdns.org` `on.aws` `pantheonsite.io` 各 1 / 不正表記 1。
- **致命的なのはツアー**: `zevr-tour-threat.krystasis12.workers.dev`(LP のガイドツアー Step 5 が「フィードに意図的に登録した無害ドメイン」として使う)が落ちる。実機で確認: フィード更新完了(起動後 1.5 秒)以降、セッションルールに無い。LP の `src/i18n/ui.ts` L306/L631 の「このリクエストはブラウザから出る前に死んでいます」と L312「赤い警告ページで遮断されるはず」が**全訪問者に対して嘘になる**。デモが失敗する LP は、レビュー対応の説得力を丸ごと失う。
- **直し方**(ビルド側で PSL を使い、クライアントには判定結果だけ渡す):
  1. `scripts/build-rules.ts`: `popular.json` を `{ "subtree": string[], "apexOnly": string[] }` に変える。Tranco 上位 1 万を `tldts` の `getPublicSuffix(d, {allowPrivateDomains:true}) === d` で二分し、**私的サフィックス(workers.dev 等)は `apexOnly`**、それ以外は `subtree`。加えて `zevr-tour-threat.krystasis12.workers.dev` は `TOUR_TEST_DOMAIN` としてクライアントにも `"pinned": [..]` で渡す(フィードに載っている限り必ず残す)。
  2. `src/background/feedguard.ts`: `subtree` は現行どおり親を歩いて保護、`apexOnly` は**完全一致のみ**保護(`||workers.dev` という丸ごと指定だけ拒否し、テナントは通す)。`pinned` は無条件で残す。
  3. `src/background/feedguard.test.ts` の「keeps a tenant whose own name is the registrable domain」を、期待値 `['phish.workers.dev']`(テナントは残す、`workers.dev` 単体は落とす)に書き換える。現在のテストは「わざと厳しい」と言い訳しているが、それが今回の不具合そのもの。
  4. ビルド時の `PEDIANOW.ORG` のような大文字は `fetchURLhausDomains` / `hostFromIoc` で `toLowerCase()` する(クライアントは吸収するが、公開フィードに大文字が混じるのは行儀が悪い)。
- **受け入れ**: 単体で上記。e2e に「フィード更新後もセッションルールに `||zevr-tour-threat.krystasis12.workers.dev` がある」を追加。あわせて「クライアント検証で落とすのが `popular.json` の `subtree` 配下と不正表記だけ」を単体で担保。

## 必須 2. e2e の「全掲載ドメインにルールがある」検査が空振りで通っている

- **場所**: `scripts/e2e/verify-extension.mjs` §5h 冒頭。`chrome.runtime.getURL('src/data/malware.json')` の fetch は web_accessible でないので失敗し `listed === null` → `check(..., listed === null || ...)` が**常に PASS**。必須 1 を検出できなかった原因。
- **直し方**: node 側で `readFileSync('src/data/malware.json')` を読んで件数を取り、セッションルールのドメイン数と比較する(ただし必須 1 の修正後は「クライアントが落とした分」を差し引く。落とした一覧は SW の `console.warn('[zg-feed] refused …')` を拾うか、`GET_FEED_GUARD_REPORT` のような読み取り専用メッセージを足して返す)。
- **受け入れ**: 意図的に `popular.json` に載る apex をフィードへ混ぜた場合に FAIL すること(手で 1 回確認)。

---

## 任意(直せば良くなるが、リリースは止めない)

- **A. リストブロックの警告ページに「送信前に止めた」の一文が無い**。`warningLookalikeTiming` / `warningCountryTiming` は入れたが、レビュアーが実際に見る**リスト系の警告**には順序の説明が無い。`warningListTiming`「This domain was never contacted — the block happens before the request leaves your browser.」を `warningListItem3` の後に 24 言語で。ストアレビューの指摘 2 に真正面から答える一文で、e2e §5i で実測もしている(遮断 1ms vs 対照 58ms)。
- **B. `Popup.tsx:1982` のフォールバック文言が古い**(`settingsBlockedCountriesHint` の第 2 引数「Domains are blocked as soon as traffic from these countries is observed.」)。辞書が勝つので表示には出ないが、次に読む人を誤らせる。辞書と同じ文に。
- **C. LP の FAQ(`ui.ts` L229 / L553)**「Pause turns blocking off for a single site」は今も正しいが、全体一時停止(5 分 / 1 時間 / 閉じるまで)が増えたので一文足すと親切。同様に L189 / L515 の国別ブロック「検知し次第適用」は、`settingsBlockedCountriesHint` と同じく「最初の 1 回は通る」を明示した方が今回の指摘(取得後にブロック)と整合する。
- **D. 設計書ヘッダ**(`docs/design/2026-09-feed-quality-and-warning-ux.md` 9 行目)が「単体 149 / 実機 73 / 再レビュー指摘 7 件が未対応」のまま。現状(単体 168 / 実機 117 / 全対応済み)に。
- **E. サイトは未ビルド**。`zevr-guard-site` に `node_modules` が無く `astro build` を通していない。デプロイ前に `npm ci && npm run build`。プライバシーページの HTML はタグ数の整合だけ確認済み。

---

## 確認済みで問題なし(再確認不要)

- ストアレビュー指摘 1(steamcommunity):ビルド時安全リスト + クライアント検証の二重。公開フィードに steamcommunity.com が戻った状態でも拡張が拒否することを実機で確認。
- 指摘 2(許可登録):警告ページ / 設定の手入力 / 一覧の行 / 詳細画面の 4 経路。詳細画面はフィード・国別・カテゴリのブロックでは「許可」に切り替わる。
- 指摘 3(取得後にブロック):リスト系は DNR で送信前(実測)。後から警告になる lookalike・国別には説明文あり。LP のツアー文言(L306/L631)も実態と一致。
- LP のプライバシーページ:`api.ipify.org` の誤記を両言語で除去、誤検知申告を追記。拡張の README も同様。申告ペイロードから利用者情報(言語・常連判定)を除去済み。
- LP の Features / FAQ の「オンデバイス」「URL は外に出ない」「第三者へ送信を警告」の各主張は現行コードと一致。ESET 比較への答え(L195 / L521)は LP 側にある。
- `manifest.json` 無変更(権限追加なし)、`extName` / `extDescription` 無変更。
