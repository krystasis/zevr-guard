# brands.json — なりすまし判定のブランド一覧

- **ファイル**: `src/data/brands.json`(登録可能ドメインの配列、拡張に同梱)
- **用途**: `src/background/lookalike.ts` が「このドメインはどのブランドに化けようとしているか」を判定する基準。homoglyph(`аpple.com`)・typosquat(`amazom.com`)・埋め込み(`paypal.com.evil.xyz`)・ブランド + 誘導語(`apple-id.com`)の 4 規則すべてがこの一覧を見る。**載っていないブランドの偽装は拾わない**。
- **出どころ**: 国内分は[フィッシング対策協議会の月次報告](https://www.antiphishing.jp/report/monthly/)に「悪用されたブランド」として挙がる常連から選ぶ。海外分は主要なログイン・決済・配送・SNS。
- **robots / 規約**: 該当なし。月次報告は人が読むだけで、クローラは向けない。ドメインの確認も `curl` と `whois` を 1 回ずつ。

## 選定基準

1. **実際に偽装されているブランド**であること(報告に載った、または国内で定番の標的)。「有名だから」だけでは足さない。一覧が増えるほど正規サイトとの衝突面も増える。
2. **正規の登録可能ドメインを本人のサイトで確認**してから書く。推測で書かない。確認は「`https://www.<domain>/` か `https://<domain>/` が応答する(200 / 302 / 403 いずれも稼働の証拠)」と、迷うときは `whois` の登録者。
3. 親ドメインが既に載っているものは足さない(ゆうちょ `jp-bank.japanpost.jp` → `japanpost.jp`、d ポイント → `docomo.ne.jp`、ニコス `cr.mufg.jp` → `mufg.jp`)。
4. ラベル(先頭の語)が**日常語**なら、`lookalike.ts` の `LURE_GENERIC_LABELS` にも入れる(`visa` は旅行ビザ、`sakura` は桜)。入れないと `visa-support.com` のような無関係のサイトに警告が出る。

## 規則ごとの前提

| 規則 | 対象になるラベル長 | 備考 |
|---|---|---|
| homoglyph / 埋め込み | 制限なし | 2〜3 文字(`au` `jcb` `ana`)でも効く |
| typosquat | ブランド側 6 文字以上、訪問先 5 文字以上 | 短い語は普通の単語と衝突する |
| ブランド + 誘導語 | 4 文字以上、`LURE_GENERIC_LABELS` と誘導語そのもの(`mail`)を除く | ハイフン入りブランドはハイフン無し綴りも見る |

## 追加の手順

1. 上の基準で正規ドメインを確認し、`src/data/brands.json` の該当する地域のまとまりに足す(国内は `jal.co.jp` の後ろ)。
2. `npx vitest run` — 既存の「正規サイトを止めない」テストが落ちたら、その衝突を解くまで足さない。
3. `npx vite-node scripts/dev/lookalike-fp.ts` — **Tranco 上位 1 万で tracker DB 外の当たりが 0 件**(exit 0)であること。1 万〜5 万の帯に新しく出たものは目で読む。
4. 代表的な偽装の形を `lookalike.test.ts` に 1〜2 件足す。
5. この文書の「履歴」に、確認した日付と方法を書く。

## 更新頻度

四半期に 1 度、月次報告 3 か月分を見て差分を足す。急ぎで足すのは「報告に初めて載った国内ブランドで、被害が広い」とき。

## 履歴

### 2026-10-21 — 国内 25 件

いずれも `curl -sL https://www.<domain>/`(または apex)で稼働を確認(200 / 302 / 403)。403 は bot 遮断で、ドメインが稼働している証拠として扱った。Web を持たないドメインは JPRS whois の登録組織で確認した。

| ドメイン | ブランド | 確認 |
|---|---|---|
| kddi.com | KDDI | 200 |
| auone.jp | au ID / au PAY | apex → `portal.auone.jp` 200 |
| ponta.jp | Ponta | www → `point.recruit.co.jp` 200、whois 登録者 Loyalty Marketing, Inc. |
| eki-net.com | えきねっと(JR 東日本) | 403 |
| jreast.co.jp | JR 東日本 | 403 |
| resonabank.co.jp | りそな銀行 | 403 |
| sevenbank.co.jp | セブン銀行 | 200 |
| eposcard.co.jp | エポスカード | 200 |
| saisoncard.co.jp | セゾンカード | 200 |
| orico.co.jp | オリコ | 200 |
| sbisec.co.jp | SBI 証券 | 200 |
| rakuten-sec.co.jp | 楽天証券 | 200 |
| paidy.com | Paidy | 200 |
| nta.go.jp | 国税庁(e-Tax) | 200 |
| myna.go.jp | マイナポータル | 302(待ち行列) |
| visa.co.jp / visa.com | Visa | 200(`visa` は `LURE_GENERIC_LABELS` へ) |
| mastercard.co.jp / mastercard.com | Mastercard | 403 |
| nuro.jp | NURO 光 | 200 |
| biglobe.ne.jp | BIGLOBE | 200 |
| gmo.jp | GMO インターネットグループ | → `group.gmo` 200 |
| xserver.ne.jp | エックスサーバー | 200 |
| sakura.ad.jp | さくらインターネット | 200(`sakura` は `LURE_GENERIC_LABELS` へ) |
| vpass.ne.jp | Vpass(三井住友カード) | A レコードなし(メール・アプリ用)。JPRS whois の登録組織が Sumitomo Mitsui Card Company, Limited |

計測: 追加前後で Tranco 上位 1 万の当たりは変わらず(3 件、全部 tracker DB 内)、1 万〜5 万も 8 件のまま。

見送り: Suica(`jreast.co.jp` に含む)、ゆうちょ・d ポイント・ニコス(親ドメインが既にある)。
