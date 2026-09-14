# 再レビュー指摘の修正指示(2026-09-14)— Opus 向け

ブランチ `fix/feed-safelist-and-allow`(16 コミット)を `main` に対して高精度レビューした結果。**すべて手元のコードで実在を確認済み**。修正はこのメモを読む Opus セッションが行う。修正後は `npm test` / `npx tsc -b --noEmit` / `npm run build:app` / `npm run build:firefox` / `node scripts/e2e/verify-extension.mjs`(現在 73/73)を通し、**各項目の受け入れ条件を e2e か単体に足す**こと。コミット署名は付けない。

優先度: **A = リリース前に必須(保護が実際に穴になる / 攻撃面)**、B = 品質、C = 整理。

---

## A1. フィード末尾 72 ドメインが何にもブロックされていない
- **場所**: `scripts/build-rules.ts:884` `kept.slice(0, Math.floor(URLHAUS_MAX / 2))` = 2,500 件、`src/background/blocking.ts:283` `MAX_SESSION_DOMAINS = 2400`。現在 `src/data/malware.json` は 2,472 件。
- **何が起きるか**: 静的 `block_rules` を引退させたので、セッションルールに乗らない index 2400 以降(seed 持ち越しの古い順)は DNR ルールが無い。一方 `isMalware()` は 2,472 件全部に true を返すので、統計は「ブロックした」と言い、`recordVisit` も飛ばされ、ナビゲーションは通る。
- **直し方**: 上限を 1 か所で定義して両側で使う。`src/shared/limits.ts`(新規)に `export const FEED_MAX_DOMAINS = 2400;` を置き、`build-rules.ts` の cap と `blocking.ts` の `MAX_SESSION_DOMAINS` の両方がそれを参照する。予算: 2,400×2 = 4,800 + 一時許可 100 + 一時停止 1 = 4,901 ≤ 5,000。
- **受け入れ**: `build:data` 後の `malware.json` が 2,400 件以下。単体で「`getMalwareDomains().length` が `MAX_SESSION_DOMAINS` を超えない」を assert。e2e で session rules 数 == `malware.json` 件数 × 2。

## A2. 国別ブロックの「解除」ボタンが R5 の門番を迂回する
- **場所**: `src/background/index.ts:879` `countryBlocked: /^[A-Z]{2}$/.test(country) && settings.blockedCountries.includes(country)`。`country` は警告ページの URL パラメータ(攻撃者が指定可能)。
- **何が起きるか**: 悪意あるページが `warning/index.html?reason=country&country=RU&blocked=anything` を開く。利用者が RU をブロックしていれば「Unblock Russia」が有効で描画され、1 クリックで `UNBLOCK_COUNTRY`(`index.ts:964`、門番なし)が国ごと解除される。他の操作は `blockedByUs` で守ったのに、ここだけ素通り。
- **直し方**: `classifyBlock` が `source === 'country'` を返したときだけ `countryBlocked` を true にし、国コードは URL ではなく **国別ルールマップ(`country.ts` の `ruleMap[domain].country`)から**取る。`country.ts` に `getBlockingCountry(domain): Promise<string | null>` を足し、`GET_BLOCK_CONTEXT` は `country` フィールドとして返す。警告ページの `CountryActions` は `ctx.country` を使い、URL の `country` パラメータは表示名にしか使わない。`UNBLOCK_COUNTRY` ハンドラ側は変えなくてよい(ポップアップからも使う)。
- **受け入れ**: e2e: `GET_BLOCK_CONTEXT { domain: 'not-blocked.example', country: 'JP' }`(JP をブロック設定した状態)で `countryBlocked === false`。警告ページを `?reason=country&country=JP&blocked=not-blocked.example` で開いて解除ボタンが**出ない**。

## A3. SW 再起動直後、一時停止中なのに割り込みが動く
- **場所**: `src/background/pause.ts:142` `reconcilePause()` は `index.ts:806` で `void` 呼び出し。`isPaused()` はメモリの `pausedNow`(初期値 false)しか見ない。`pause.test.ts:155` は `isPaused() === false // nothing known yet` をむしろ保証している。
- **何が起きるか**: 「閉じるまで停止」中に SW が idle で落ち、次のナビゲーションで SW が起動。`onBeforeRequest`(`index.ts:475`)は reconcile の `getSessionRules`/`storage.session.get` が返る前に走るので `isPaused()` は false → lookalike の `tabs.update` が発火。DNR の allow は生きているのに警告ページに飛ぶ。バッジとパスワード警告も同様。
- **直し方**: `pause.ts` に `let ready: Promise<void>` を持たせ(`reconcilePause()` が resolve する)、割り込み系の呼び出し側は `await ready` してから `isPaused()` を見る。具体的に: `checkNavigation` の前、`PASSWORD_CONTEXT`、`handleRequest` のバッジ書き込み、`resetPage`。`onBeforeRequest` リスナー自体は sync のままでよく、中で `void (async () => { await pauseReady(); if (!isPaused()) void checkNavigation(...) })()` にする(`checkNavigation` はもともと非同期)。
- **受け入れ**: `pause.test.ts:155` の assert を「reconcile 前は `pauseReady()` が未解決」に置き換え、reconcile 後に true。e2e: 一時停止 → `chrome.runtime.reload()` 相当が難しいので、単体で「reconcile 完了前に `isPaused()` を呼んでも、`await pauseReady()` 後には true」を確認。

## A4. 許可した危険サイトの訪問が一切記録されず、既存の「初回パスワード警告」が消える
- **場所**: `src/background/index.ts:469` `if (!isMalware(url.hostname)) void recordVisit(url.hostname);`。`isMalware` は「リストに載っている」であって「ブロックされた」ではない。
- **何が起きるか**: 利用者が「Allow and continue」した phish.example は、`allowDomain` が `MALWARE_SET` を触らないので永久に記録されない。ログインフォームで `isFreshVisit` が entry 無しで false → 1.5.12 にあった `pwWarnFirst` 通知(`index.ts:1001`)が**まさに必要な場面で**出ない。一時停止中・一時許可中・マルウェアカテゴリ OFF も同じ。「常連」にも永久になれない。
- **直し方**: 記録の場所を「要求時」から「**main_frame の完了時**」に移す。`handleRequest` は `details.type === 'main_frame'` を早期 return しているので、その直前に `if (outcome === 'completed') void recordVisit(hostname)` を入れる。ブロックされた遷移は警告ページ(拡張 URL)にリダイレクトされるので、元ホストの main_frame が completed になることはない。要求時の `recordVisit` 呼び出しは削除。`isMalware` ガードも不要になる。
- **受け入れ**: 単体は据え置き。e2e: example.com を手動ブロック → 訪問 → `zg.seenExactHosts` に **入らない**。許可 → 訪問 → 入る。

## A5. 「許可」の意味が入口ごとに違い、ブロックリストと許可リストに同時に載る
- **場所**: `ALLOW_AND_OPEN` は unblock→allow、`ALLOW_DOMAIN`(ポップアップ・設定の手入力)は allow のみ、`REPORT_FALSE_POSITIVE(alsoAllow)` も allow のみ。`allowDomain`(`blocking.ts:133-172`)は `customBlockList` を見ない。
- **何が起きるか**: 手動ブロック済みのドメインが後でフィードにも載ると `classifyBlock` は先に `'feed'` を返す(`index.ts:183`)ので ReportSafe が出て、既定 ON の alsoAllow で許可リストに追加。ブロックエントリは残り、設定画面(`Popup.tsx:1834`)で両方のリストに同じドメインが並ぶ。
- **直し方**: `allowDomain` の中で `customBlockList` に含まれていれば `unblockDomain` を先に呼ぶ(= 3 経路が収束)。`ALLOW_AND_OPEN` の個別 unblock 呼び出しは削除。`classifyBlock` の順序も `manual` を `feed` より先に(自分で入れたブロックは自分の判断が優先)。
- **受け入れ**: 単体: `blockDomain('x') → allowDomain('x')` 後に `customBlockList` に無く `customWhiteList` にある。

## A6. 一時停止バッジが既存タブでは見えず、遷移のたびに消える
- **場所**: `src/background/badge.ts:52` `setBadgeText({ text: '', tabId })`。`index.ts:198` `resetPage()` の `clearBadge(tabId)` に `isPaused()` ガードが無い(兄弟の `onActivated`/`handleRequest` には入れた)。`reportLeaks` の `flashDangerBadge`(`index.ts:536`)も未ガード。
- **何が起きるか**: Chrome の action API では tab 指定の `''` は「そのタブは空」という**上書き**で、全体の `'||'` に勝つ。開いているタブ全部が空表示になる。さらに `tabs.onUpdated` のたびに `resetPage` が `''` を書く。色も per-tab の赤/緑が残る。`pause.test.ts` のモックは tabId 付き書き込みを無視するので検出できない。
- **直し方**: per-tab のクリアは `text: null`(または `undefined`)で「タブ固有値を消して全体に従う」にする。`clearBadge` / `showPausedBadge` の per-tab ループ / `resetPage` を揃える。`resetPage` と `reportLeaks` の `flashDangerBadge` を `isPaused()` でガード(流出**アラート**自体は出す。バッジだけ触らない)。per-tab の色も `setBadgeBackgroundColor({ color: null?, tabId })` 相当で戻す(API が null を受けない場合は一時停止色を per-tab にも書く)。
- **受け入れ**: `pause.test.ts` のモックを tabId 付き書き込みも記録するようにし、`pauseAll` 後に per-tab の text が `''` ではなく null/未設定であること。e2e: 一時停止中に example.com へ遷移しても SW 側 `chrome.action.getBadgeText({tabId})` が `'||'`。

## A7. ブラウザ起動〜初回同期の間、マルウェア保護が空(設計 R1 の「受容」の見直し)
- **場所**: `blocking.ts:387` 静的 `block_rules` の引退は永続。`onStartup` で再有効化していない。
- **何が起きるか**: 再起動直後のセッション復元やブックマーク直打ちで、`syncMalwareSessionRules` の遅い経路(storage 読み→4,800 ルール構築→適用)が終わる前の要求は何にも当たらない。main では静的ルールが拾っていた。設計書 R1 は「コードコメントに明記」としたが、`blocking.ts:371-380` のコメントには書かれていない。
- **直し方**: `chrome.runtime.onStartup` で `updateEnabledRulesets({ enableRulesetIds: ['block_rules'] })` を先に打ち、`initFeed` → `syncMalwareSessionRules` が済んだら従来どおり引退させる。静的ルールは安全リスト適用済みでビルドされるので再有効化しても人気サイトは含まれない(1.5.13 以降)。コメントも実態に合わせる。
- **受け入れ**: 単体: `onStartup` 相当を呼ぶと `enableRulesetIds` に `block_rules` が入り、sync 後に `disableRulesetIds` に入る。

## B1. 警告ページに 30 秒以上いると「元 URL に戻る」が壊れる
- **場所**: `index.ts:153` `lastMainFrameUrl` はメモリ上の Map。SW が落ちると消える。
- **直し方**: 警告ページが起動時の `GET_BLOCK_CONTEXT` で受け取った `ctx.url` を保持し、`ALLOW_AND_OPEN` / `ALLOW_FOR_SESSION_AND_OPEN` / `REPORT_FALSE_POSITIVE` に `url` として送り返す。背景は受け取った `url` を `resolveResumeUrl` と同じ検証(http(s) かつ host が domain 配下)に通し、通ればそれを、通らなければ従来の fallback を使う。Map はそのまま残してよい。
- **受け入れ**: 単体: 検証関数に `https://evil.example/` を `domain: 'shop.example'` で渡すと null。e2e: SW の Map を空にした状態(`sw.evaluate` で直接触れないので、警告ページを 40 秒待ってから押す)で path+query が保たれる。

## B2. `resumeAll` は削除が失敗しても「再開した」と表示する
- **場所**: `pause.ts:109-120`。先にメモリのフラグを落とし、`updateSessionRules` の失敗を握りつぶし、状態と badge を消す。
- **直し方**: 削除が resolve してからフラグを落とす。catch では `getSessionRules()` で id 950,000 の有無を確認し、残っていれば paused のまま(`console.warn`)にして呼び出し側に `{ success: false }` を返す。コメント「nothing to remove」は誤り(存在しない id の削除は reject しない)なので直す。
- **受け入れ**: 単体: `updateSessionRules` を reject させると `isPaused()` が true のまま。

## B3. 日付表示のタイムゾーンとロケール
- **場所**: `src/warning/index.tsx:383` `fmt()` と `586-588`。`meta.since` は `'YYYY-MM-DD'`(UTC 日付)を `new Date()` に入れ `toLocaleDateString()`(ブラウザ既定ロケール、TZ 未指定)。
- **直し方**: `src/shared/i18n.ts:150` の `bcp47()` を使い、`meta.since` は `new Intl.DateTimeFormat(bcp47(), { dateStyle: 'medium', timeZone: 'UTC' })`、epoch ms の値は `timeZone` なし。`src/report/Report.tsx:119` と同じ流儀。
- **受け入れ**: 単体(関数を切り出して): `'2026-09-14'` が `America/Los_Angeles` でも 14 日と出る。

## B4. `pauseAll` も順序が逆(補足指摘)
- `pause.ts:73` フラグを立ててから `updateSessionRules` を await。reject すると「停止中」表示で保護は生きている。B2 と同じ方針(適用が resolve してからフラグ)で揃える。

## B5. 1.5.12 からの更新直後は「常連」が誰もいない(補足、設計どおりだが明記)
- `visits.ts:180` 完全ホストの記録は更新後から始まるので、既存利用者はソフト変種が最低 7 日出ない。仕様として受容。`docs/design` §2 に一文追記するだけでよい。

## C. 整理(動作は変わらない。まとめて 1 コミット)
- `docs/sources/tranco.md:4` が **存在しない** `subtreeLimit / apexLimit` と「10,001〜50,000 位は本体と www. を保護」を書いている。実装と `tranco-rank-is-not-safety` の方針(その帯は**ログに出すだけ**)に合わせて書き直す。`robots: N/A(zip を手動取得)` の 1 行も足す(business/CLAUDE.md の規約)。
- `scripts/build-rules.ts:270` の `MalwareMeta` / `MalwareMetaEntry` は `../src/types` を import する。
- `src/warning/index.tsx:182/337` `AllowAndOpen` と `ContinueOnce` は message type と文言だけ違う。1 コンポーネントに。
- `feed.ts:155` `malware.meta.json`(約 120KB)を cold start で毎回 storage から読んでいる。警告ページしか使わないので `lookupMalwareMeta` の初回呼び出しで遅延ロードに(trackers と同じ流儀)。
- 親ラベルを歩く処理が 4 か所(`risk.ts:86/121/132`, `blocking.ts:271`)。`src/shared/domain.ts` に 1 つにまとめる。
- `Popup.tsx:2159` の `normalizeDomainInput` 内の正規表現は `index.ts:99` `HOSTNAME_RE` と同一。`src/shared/domain.ts` に `isValidHostname` を移して両方から使う。
- `compat.ts:53/90` `prepareLiveGlobe` / `openLiveGlobe` の tabs.query + setOptions を 1 関数に。
- `pause.test.ts` と `blocking.test.ts` の DNR セッションルールのスタブを `src/test/dnr-stub.ts` に共通化。

---

## 済んでいるもの(このメモの前に修正済み)
- ドメイン系 4 ハンドラ(`BLOCK/UNBLOCK/ALLOW/DISALLOW_DOMAIN`)のホスト名検証漏れ → コミット `ff53837`。

## 順番の提案
A1 → A5 → A4 → A2 → A6 → A3 → A7 → B1 → B2/B4 → B3 → B5 → C。A1 と A5 はリリース可否に直結し、A4 は A5 の後にやると `classifyBlock` の順序変更と整合する。C は最後にまとめて。
