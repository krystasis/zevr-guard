# 設計: フィード品質と警告ページ UX(2026-09-14)

ストアレビュー「steamcommunity.com をブロックする / 許可登録できない / 取得後にブロックしている」への恒久対応。
ブランチ `fix/feed-safelist-and-allow` に入っている応急処置(§0)の上に、A〜D の機能と §6 の対策を積む。
**実装担当は別セッション(Opus)**。このファイルだけで実装できるよう、触るファイル・メッセージ型・データ形・境界条件・受け入れ条件を書く。

---

> **実装状況(2026-09-14 時点)**: §2〜§5 の A/B/C/D と §6 の R5/R6 はすべてブランチ `fix/feed-safelist-and-allow` に実装・コミット済み。実機 33/33、単体 138 件通過。残るは push・フィード再配信・版上げ(§8)で、いずれも人の作業。R2 は実装中に結論が変わった(下表を読むこと)。

## 0. 現状(ブランチ `fix/feed-safelist-and-allow`、コミット済み・未 push)

| 変更 | ファイル | 状態 |
|---|---|---|
| フィード生成の安全リスト(Tranco 上位1万 + PSL + 共有ホスト手動リスト) | `scripts/safelist.ts`, `scripts/build-rules.ts`, `src/data/tranco.snapshot.json`, `docs/sources/tranco.md` | 実装・テスト済み(29件) |
| 同梱静的ルール `block_rules` を、セッションルール適用後に無効化 | `src/background/blocking.ts` `retireStaticMalwareRules()` | 実装・実機確認済み |
| 警告ページ「Allow `<domain>` and continue」+ 元 URL 復帰 | `src/warning/index.tsx` `AllowAndOpen`, `src/background/index.ts` `ALLOW_AND_OPEN` / `lastMainFrameUrl`, `src/types/index.ts`, `_locales/*`(24言語) | 実装・実機確認済み |

実機確認ハーネス: `scripts/e2e/verify-extension.mjs`(Playwright の Chromium に `dist/` を未パッケージで読み込み、15項目を検査。§7 参照)。

前提知識:
- フィードはホスト単位で並ぶが、拡張は `||domain` で **ドメイン配下ごと** ブロックする。共有ホストの混入が全利用者に効くのはこのため。
- ブロック源は3つ。(1) 日次フィード → セッションルール(id 1..4800、`syncMalwareSessionRules`)、(2) 利用者の手動ブロック → 動的ルール(id 10001..)、(3) 国別学習 → 動的ルール(id 1,000,000..)。許可は動的 allow ルール priority 1000 で全部に勝つ。
- 警告ページ `src/warning/index.html` は web_accessible。`blocked` パラメータは誰でも指定できる(§6 R5)。

---

## 1. 実装順序と受け入れ条件

1. **D(説明文)** → 1.5.13 に同梱。返信で約束した文言。30分。
2. **§6 R5/R6(警告ページのガードとセッションルール範囲)** → 1.5.13 に同梱。A の前提でもある。1時間。
3. **1.5.13 を提出**(§8)。ここまでは審査リスクを増やさない範囲。
4. **A(訪問履歴ソフトブロック)** → 1.5.14。
5. **C(ブロック理由)** → 1.5.14。フィード側(build-rules)は先に出してよい(1.5.13 クライアントは新ファイルを無視する)。
6. **B(誤検知申告)** → 1.5.14。Worker 側の変更を伴う。

各項目の受け入れ条件は各節末尾。共通条件: `npm test` / `npx tsc -b --noEmit` / `npm run build:app` / `npm run build:firefox` が通り、`scripts/e2e/verify-extension.mjs` が全項目 PASS。

---

## 2. 機能 A: 訪問履歴によるソフトブロック

### 狙い
フィードに載ったドメインでも、利用者が **以前から通っているサイト** なら、赤いハードブロックではなく「最近侵害されたか、リストの誤りの可能性がある」琥珀色の警告にし、「今回だけ続ける」を主導線にする。Steam 常連が今回踏んだケースを直接救う。**既定は依然ブロック**(利用者が押すまで通さない)。DNR のリダイレクトは変えない。差が出るのは警告ページの描画と選択肢だけ。

### データ: `src/background/visits.ts`
- `SeenEntry` に `n: number`(訪問回数)を追加。`recordVisit` で `n += 1`。既存データの移行: `n` が無ければ 1。`MAX_ENTRIES` 3000 と LRU はそのまま。
- 追加 export:
  ```ts
  export interface VisitRecord { first: number; last: number; n: number }
  export async function getVisitRecord(host: string): Promise<VisitRecord | null>;
  /** 7日以上前から3回以上訪問、かつインストールから48h(LEARNING_MS)経過 */
  export async function isEstablishedSite(host: string): Promise<boolean>;
  ```
- 閾値は定数化: `ESTABLISHED_MIN_VISITS = 3`, `ESTABLISHED_MIN_AGE_MS = 7 * 24h`。
- 注意: `recordVisit` は main_frame の `onBeforeRequest` で呼ばれる(`src/background/index.ts` の lookalike 用リスナー)。DNR でリダイレクトされる navigation でもこのイベントは発火するので、**ブロックされた訪問も回数に入る**。これを防ぐため、`recordVisit` 呼び出しの前に `isMalware(host)` なら記録しない(ブロックされた訪問で「常連」にならないように)。手動ブロック中も同様に `getBlockedDomains()` は非同期で重いので、`isMalware` のみで良い。

### 背景: 新メッセージ `GET_BLOCK_CONTEXT`
`src/types/index.ts`:
```ts
| { type: 'GET_BLOCK_CONTEXT'; domain: string }
| { type: 'ALLOW_FOR_SESSION_AND_OPEN'; domain: string }
```
応答(`src/background/index.ts`):
```ts
interface BlockContext {
  blockedByUs: boolean;            // §6 R5: false なら警告ページは操作ボタンを出さない
  source: 'feed' | 'manual' | 'country' | null;
  url: string | null;              // lastMainFrameUrl[sender.tab.id] が domain 配下なら返す
  established: { since: number; n: number } | null;  // isEstablishedSite が真のときのみ
  meta: { src: 'u' | 't' | 'm' | null; since: string | null } | null;  // 機能 C
  feedGeneratedAt: string | null;  // 機能 C
}
```
- `blockedByUs`: `isMalware(domain)`(feed) → `settings.customBlockList` に含む(manual) → `isCountryBlockedDomain(domain)`(country)の順で判定し、`source` も同時に決める。
- `domain` は `isValidHostname` で検証。不正なら `{ blockedByUs: false, ... }`。
- `url` の決め方は既存 `ALLOW_AND_OPEN` と同じ(`matchesDomainOrParent(host, new Set([domain]))`)。`ALLOW_AND_OPEN` 側もこの共通関数に寄せる(`resolveResumeUrl(tabId, domain)`)。

### 一時許可: `src/background/blocking.ts`
```ts
export const SESSION_ALLOW_ID_BASE = 900_000;   // フィード用 1..4800 と衝突しない
const MAX_SESSION_ALLOWS = 100;                 // 4800 + 100 ≤ 5000(Chrome のセッションルール上限)
export async function allowDomainForSession(domain: string): Promise<void>;
export async function getSessionAllowedDomains(): Promise<Set<string>>;
```
- ルール: `{ id, priority: ALLOW_PRIORITY(1000), action: allow, condition: { urlFilter: '||'+domain, resourceTypes: ALL_RESOURCES } }`。
- id は `SESSION_ALLOW_ID_BASE` 以上の既存最大+1。`MAX_SESSION_ALLOWS` 超過時は最小 id から削除(FIFO で十分)。
- **必須の前提変更(§6 R6)**: `syncMalwareSessionRules` は現在 `existing.map(r => r.id)` で **全セッションルールを消す**。`r.id < SESSION_ALLOW_ID_BASE` のものだけ消すよう変更。この変更は A を入れない場合でも 1.5.13 に入れる(将来の事故防止)。
- セッションルールはブラウザ再起動で消える = 「今回だけ」の意味がそのまま実現される。
- `ALLOW_FOR_SESSION_AND_OPEN` ハンドラ: `allowDomainForSession(domain)` → `resolveResumeUrl` → `{ success, url }`。`customWhiteList` には入れない。

### 警告ページ: `src/warning/index.tsx`
- 起動時に `GET_BLOCK_CONTEXT` を投げ、応答が来るまで操作ボタン群は描画しない(スケルトンでよい。`Go Back` は常に出す)。
- `established !== null && source === 'feed'` のとき **ソフト変種**:
  - tone: 新設 `'amber'`(`text-amber-400` / `bg-amber-500/[0.12]` / `border-amber-500/40`)。
  - タイトル `warningSoftTitle`: "This site is on today's threat list"
  - 本文 `warningSoftHeader`: "You've used $DOMAIN$ since $SINCE$ ($N$ visits). It may have been compromised recently, or this may be a mistake in the list."(`$SINCE$` は `toLocaleDateString()`)
  - 主ボタン(白): `warningGoBack`(既存)
  - 副ボタン(琥珀枠): `warningContinueOnce`: "Continue this time (until browser restart)" → `ALLOW_FOR_SESSION_AND_OPEN`
  - `<details>` `warningUnderstandRisk` の中: 既存 `AllowAndOpen`(恒久許可)と、機能 B の「Report as safe」
- それ以外(`established === null`)は現状の赤いハード変種。`<details>` の中身は `AllowAndOpen` のまま + 機能 B。
- `country` は `CountryActions` のみ(変更なし)。`lookalike` は `proceedAnyway` のまま。
- 統計: ソフト変種で「続ける」を押しても `dangerousDetected` を増やさない(現状もリスト系は増やしていない。触らない)。

### 受け入れ条件
- vitest: `visits.test.ts` に `n` のカウント、旧形式(`number` / `{first,last}`)からの移行、`isEstablishedSite` の閾値境界(2回→false、3回→true、6日→false、7日→true、インストール48h未満→false)。
- vitest: `blocking.test.ts` に「`syncMalwareSessionRules` が id ≥ 900,000 のルールを消さない」「`allowDomainForSession` が 100 件で FIFO する」(`src/test/setup.ts` の DNR スタブに `getSessionRules` / `updateSessionRules` を足す)。
- e2e: 訪問履歴を `chrome.storage.local['zg.seenHosts']` に直接投入して example.com を「常連」にし、擬似フィードブロック → 琥珀色の警告 → 「Continue this time」→ 元 URL に復帰 → セッション allow ルールが存在 → `customWhiteList` は空のまま、を確認。

---

## 3. 機能 B: 誤検知の申告

### 狙い
リストブロックを踏んだ利用者が「これは安全なサイト」と一手で知らせられる導線。集まった申告は **人が見て** `scripts/safelist.manual.json` に反映する。自動で安全リストに入れない(攻撃者が本物のマルウェアドメインを「安全」と申告してブロックを外させる毒入れを防ぐ)。

### 拡張側
- メッセージ: `| { type: 'REPORT_FALSE_POSITIVE'; domain: string; context: 'list' | 'soft'; alsoAllow?: boolean }`
- ハンドラ(`src/background/index.ts`、`REPORT_PHISHING` と対称に):
  - `isValidHostname` 検証。
  - `alsoAllow` なら先に `allowDomain`(通信失敗でも利用者の意思を優先。`REPORT_PHISHING` の `alsoBlock` と同じ考え方)。
  - `POST https://feedback.zevrhq.com/v1/false-positive` body:
    ```json
    { "domain": "...", "context": "list|soft", "locale": "ja", "version": "1.5.14", "feedGeneratedAt": "2026-09-13T17:53:21Z|null" }
    ```
    URL・パス・ページタイトルは **送らない**。`AbortSignal.timeout(10_000)`。
  - 応答 `{ success: boolean, allowed: boolean, url: string | null }`(`url` は `alsoAllow` のとき `resolveResumeUrl`)。
- 警告ページ: ハード/ソフト両変種の `<details>` 内に `ReportSafeButton`。UI は既存 `ReportButton` を複製して文言差し替え(確認 → チェックボックス「Also allow it on this device」既定 ON → 送信 → 完了表示。`alsoAllow` かつ `url` があれば完了表示の後 1.5 秒で `url` へ遷移)。
- 文言キー: `reportSafeButton` "This is a safe site — report the mistake", `reportSafeConfirm` "Send only this domain to Zevr for review?", `reportSafeAlsoAllow` "Also allow it on this device", `reportSafeSend` "Send", `reportSafeDone` "Reported. Thank you — we review every report by hand.", `reportSafeDoneAllowed` "Reported & allowed. Thank you!", `reportSafeError`(既存 `reportPhishingError` を流用可)。24言語。

### Worker 側(`zevr-guard-site/feedback-worker`)
- `schema.sql` に追加:
  ```sql
  CREATE TABLE IF NOT EXISTS false_positive_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    last_ts TEXT NOT NULL DEFAULT (datetime('now')),
    domain TEXT NOT NULL UNIQUE,
    context TEXT,
    locale TEXT,
    version TEXT,
    feed_generated_at TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending'  -- pending | accepted | rejected
  );
  ```
  適用: `wrangler d1 execute zevr-guard-feedback --remote --file=schema.sql`(`CREATE TABLE IF NOT EXISTS` なので既存表に無害)。
- `src/index.js`: `/v1/false-positive` ルート。`phishing-report` と同じホスト名検証・`ALLOWED_ORIGINS` 免除・UPSERT。`version` は `/^\d+\.\d+\.\d+$/`、`feed_generated_at` は ISO 8601 か null。先頭コメントの API 一覧にも追記。
- `stats.sh` に `false_positive_reports` の pending 一覧クエリを追加。

### 運用ループ
- 週1で `stats.sh` を見る → 妥当なものを `scripts/safelist.manual.json` に追加(次項)→ 次の日次フィードから除外。ドメインごとの判断は `docs/sources/tranco.md` の末尾に理由付きで追記。
- `scripts/safelist.ts` の `SHARED_HOSTS` を `scripts/safelist.manual.json` に外出し済み:
  ```json
  { "shared_hosts": ["raw.githubusercontent.com", ...], "never_block": [] }
  ```
  `never_block` は登録ドメイン単位(配下も含めて保護)。`createSafelist` は両方を読む。**誤検知の申告を反映する唯一の場所がここ**(R2 のとおり、順位で自動保護してはいけない)。

### 受け入れ条件
- vitest: `safelist.test.ts` に `never_block` のケース。
- Worker: `curl -X POST .../v1/false-positive` で 204、不正ドメインで 400、同一ドメイン2回で `count=2`。
- e2e: 擬似フィードブロック → Report as safe → 完了表示(通信は `page.route` で 204 を返してスタブ)→ `customWhiteList` に入る。

---

## 4. 機能 C: ブロック理由の表示

### 狙い
警告ページに「どのリストに、いつから載っているか」を出す。ESET などと比較された以上、根拠を見せることが信頼に直結する。

### フィード側(`scripts/build-rules.ts`)
- 新ファイル `malware.meta.json`(フィード配信先 `LP_FEED_DIR` と、同梱用 `src/data/malware.meta.json`。後者は `.gitignore` に追加):
  ```json
  { "generatedAt": "2026-09-14T15:00:00Z",
    "domains": { "evil.example": { "s": "u", "f": "2026-09-10" }, ... } }
  ```
  - `s`: `u` = URLhaus, `t` = ThreatFox, `m` = 手動(承認済み `phishing_reports`、現状は未接続なので出現しない), 持ち越し(seed 由来)は前回の `s` を引き継ぐ。
  - `f`: 初めてフィードに載った日(UTC 日付)。前回の meta(`LP_FEED_DIR/malware.meta.json`、無ければ `src/data/malware.meta.json`)から引き継ぎ、無ければ当日。
  - `main()` の `capped` 確定後に生成。`interleave` の前に「どの源から来たか」を `Map<string, 'u'|'t'>` で持っておく(URLhaus と ThreatFox の両方にある場合は `u`)。
- `feed.json` の `files` に `"malwareMeta": "malware.meta.json"` を追加(1.5.12/1.5.13 は無視する)。
- サイズ見積り: 2,500 件 × 約 45B ≈ 110KB。`chrome.storage.local` に置いて問題ない(trackers の 8MB とは別物)。

### 拡張側
- `src/background/feed.ts`: `fetchChannel<MalwareMeta>` で `malware.meta.json` を `STORAGE_MALWARE_META = 'zg.feed.malwareMeta'` に保存。`FeedMeta` に `malwareMeta?: FeedChannelMeta` を追加(ETag 別管理)。失敗しても他チャネルに影響させない(`Promise.allSettled` に1本追加)。
- `src/background/risk.ts`: `setMalwareMetaOverride(meta | null)` と `lookupMalwareMeta(domain): { src, since } | null`(`isMalware` と同じ親ドメイン歩き)。同梱 `src/data/malware.meta.json` は **import しない**(SW 起動コストを増やさない)。フィード未取得時は `null` → 警告ページは汎用文言。
- `GET_BLOCK_CONTEXT` の `meta` / `feedGeneratedAt` を埋める。
- 警告ページ: ハード/ソフト両変種の本文下に1行:
  - `warningSourceLine`: "Listed by $SOURCE$ since $SINCE$ · list updated $UPDATED$"
  - `$SOURCE$`: `u` → "URLhaus (abuse.ch)", `t` → "ThreatFox (abuse.ch)", `m` → "Zevr user reports", null → `warningSourceGeneric` "Zevr Guard's threat list"。
  - `meta === null` のときは `warningSourceGenericLine`: "Listed in Zevr Guard's threat list · list updated $UPDATED$"(`feedGeneratedAt` も無ければ行ごと非表示)。

### 受け入れ条件
- `npm run build:data` 後に `src/data/malware.meta.json` が生成され、`domains` のキー集合が `malware.json` と一致する(スクリプト内で assert)。
- vitest: `risk.test.ts` に `lookupMalwareMeta` の親ドメイン歩き。
- e2e: `zg.feed.malwareMeta` を storage に投入 → 擬似フィードブロック → 警告ページに "Listed by URLhaus (abuse.ch) since 2026-09-10" が出る。

---

## 5. 機能 D: 「後から警告」経路の説明文(返信で約束したもの)

- lookalike 警告ページ(`src/warning/index.tsx`、`warningLookalikeDetected` の直後): `warningLookalikeTiming` "This check runs as the page starts loading, so the site may appear for a moment before this warning."
- 国別警告ページ(`warningCountryDetail` の直後): `warningCountryTiming` "Country blocking learns from traffic: the first request to a new site goes through so its country can be identified; later requests are blocked."
- ポップアップの国別ブロックの説明 `settingsBlockedCountriesHint` を上の趣旨に書き換え(現状 "Domains are blocked as soon as traffic from these countries is observed." は「初回は通る」を言っていない)。
- ストア掲載文(`zevr-guard-site` 側の説明、`_locales/*/messages.json` の `extDescription` は変えない。変えると `needs:human` になり審査に響く)。
- 24言語。既存の翻訳文体(ja は「です・ます」)に合わせる。

受け入れ条件: 文言が3箇所に出る(e2e で lookalike `amazom.com` と country は擬似ルールで確認)。

---

## 6. 危うい点の再検討と対策

| # | 危うさ | 判断 | 対策 / 実装メモ |
|---|---|---|---|
| R1 | 静的ルール無効化後、ブラウザ起動〜セッションルール貼り直しの間だけマルウェア保護が空く | **受容** | `chrome.runtime.onStartup` は登録済み(`index.ts:719`)なので SW は起動直後に走り、同梱データからネット無しで貼る(数十 ms)。`blocking.ts` の `retireStaticMalwareRules` コメントに「起動直後の隙間は onStartup + 同梱データで埋める」と明記。1.5.12 は静的ルールで常時埋めていたので厳密には後退だが、誤検知固定化の害の方が大きい。 |
| R2 | 安全リストが Tranco 上位1万まで。下位の正規サイトは素通りしない | **設計変更(実装時に判明)** | 当初案(10,001〜50,000 位の登録ドメインも保護)は **危険なので採用しない**。Tranco は DNS 問い合わせ量で順位を付けるため、稼働中のマルウェア基盤が自力で順位を得る。実測: `okiloveyoupleasedonttouchme.net` #11,453 / `dontworry.su` #14,230 / `dnsrecordsarepowerful.com` #27,967 — いずれも同時に ThreatFox 掲載。中位帯を保護すると生きた C2 のブロックを外す。代わりに **保護は上位1万のまま**、1万〜5万位に載るブロック対象は `safelist.reviewCandidates()` が**ビルドログに報告するだけ**にして人が見る。確認できた誤検知は `scripts/safelist.manual.json` の `never_block` に手で入れる。スナップショットは報告のため 5 万件に拡張済み(ビルド専用)。 |
| R3 | 誤検知が運営に届かない | **機能 B** | — |
| R4 | 「Allow and continue」は恒久許可。侵害中のサイトを永久に通す | **機能 A** | ソフト変種では「今回だけ」を副導線に、恒久許可は `<details>` の中へ。ハード変種は現状どおり(明示的に「非推奨」表示)。 |
| R5 | 警告ページは web_accessible。悪意あるページが `?blocked=attacker.example` で開き、利用者に赤い「Allow」を押させれば攻撃者ドメインが許可される | **対策(1.5.13)** | `GET_BLOCK_CONTEXT.blockedByUs` が false なら `AllowAndOpen` / `ReportSafe` / ソフト変種を描画せず、`Go Back` のみ。`isFramed` ガードは維持。 |
| R6 | `syncMalwareSessionRules` が全セッションルールを消す。A の一時許可と衝突 | **対策(1.5.13)** | id `< SESSION_ALLOW_ID_BASE` のみ削除。§2 参照。 |
| R7 | Firefox: セッションルール / `updateEnabledRulesets` の挙動差 | **確認** | `npm run build:firefox` の zip を Firefox に一時読み込みし、`about:debugging` から steamcommunity.com とハード変種の Allow を手で確認。差があれば `retireStaticMalwareRules` を Firefox では no-op に(`navigator.userAgent` ではなく `browser.runtime.getBrowserInfo` の有無で判定)。 |
| R8 | CI(`refresh-feed.yml`)で `tldts` が解決されない | **確認済み** | `package-lock.json` に入っている。`npm ci` で入る。 |
| R9 | セッションルール上限 5,000 | **計算済み** | フィード 2,400 ドメイン × 2 = 4,800 + 一時許可 ≤ 100 = 4,900。`MAX_SESSION_DOMAINS` は増やさない。 |
| R10 | `recordVisit` がブロックされた訪問も数え、常連判定を汚す | **対策(A と同時)** | §2 の `isMalware` ガード。 |
| R11 | 1.5.12 利用者は 1.5.13 が届くまで直らない | **受容** | 技術的に不可避。ストア返信は「次のバージョンで」の表現になっている。 |
| R12 | 1.5.13 で `block_rules` が同梱される以上、初回インストール直後の一瞬はビルド日の静的ルールが効く | **受容** | 安全リスト適用済みなので人気サイトは含まれない。初回同期で引退。 |

---

## 7. テストとハーネス

- 単体: `npm test`(vitest、`src/**` と `scripts/**`)。
- 実機: `scripts/e2e/verify-extension.mjs`。Playwright の Chromium に `dist/` を未パッケージで読み込み、example.com に擬似フィードルールを貼って検査する。依存: `npm i -D playwright && npx playwright install chromium`(devDependency にしてよい。パッケージには入らない)。実行: `npm run build:app && node scripts/e2e/verify-extension.mjs`。
  - 注意点(ハマりどころ): 生きたマルウェアホストを踏み台にしない(接続が張り付いて navigation が commit しない)。Service Worker から自分宛てに `sendMessage` しても自分の `onMessage` は発火しないので、メッセージは拡張ページ(警告ページ)経由で送る。
- A/B/C/D を足すたびに、このハーネスへ §2〜§5 の e2e 項目を追記する。

---

## 8. リリース手順

1. `fix/feed-safelist-and-allow` に D と R5/R6 を積む → `main` にマージ → push。
2. `zevr-guard-site` の GitHub Actions「Refresh threat feed」を `workflow_dispatch` で実行 → `public/feed/v1/malware.json` から steamcommunity.com / t.me / telegram.me / cdn.jsdelivr.net / raw.githubusercontent.com / community.fandom.com が消えていることを確認。
3. `manifest.json` / `package.json` を 1.5.13 に上げ、`chore(release): 1.5.13 — feed safelist, allow from warning page` で commit・tag・push(`docs/ai-driven.md` §7 の人の手順)。`npm run build`(`build:data` 込み。安全リスト適用済みの同梱ルールになる)→ zip → Chrome Web Store / Edge / AMO に提出。
4. 審査通過後、ストアレビューに「1.5.13 で修正しました」と追記。
5. A/B/C は 1.5.14 として同じ流れ。B の Worker 変更(D1 スキーマ + ルート)は拡張より **先に** デプロイする(古い拡張は叩かないので安全)。

---

## 付録: 触るファイル一覧

拡張(`zevr-guard`):
`src/background/{visits,blocking,index,feed,risk}.ts`, `src/types/index.ts`, `src/warning/index.tsx`, `src/popup/Popup.tsx`(国別説明文のみ), `src/test/setup.ts`, `src/background/{visits,blocking,risk}.test.ts`, `scripts/{safelist,build-rules}.ts`, `scripts/safelist.manual.json`, `scripts/safelist.test.ts`, `scripts/e2e/verify-extension.mjs`, `_locales/*/messages.json`(24), `.gitignore`(`src/data/malware.meta.json`), `docs/sources/tranco.md`。

サイト(`zevr-guard-site`):
`feedback-worker/{schema.sql,src/index.js,stats.sh}`, `.github/workflows/refresh-feed.yml`(変更不要。`build:data` が meta も書く)。
