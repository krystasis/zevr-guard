# Tranco top sites — 安全リストの元データ

- **URL**: https://tranco-list.eu/ (list download: `https://tranco-list.eu/top-1m.csv.zip`)
- **用途**: `scripts/safelist.ts` が、脅威フィード(URLhaus / ThreatFox)から人気サイトとその配下を除外するために使う。上位 50,000 件を `src/data/tranco.snapshot.json`(登録ドメインの配列、順位順)として保持。ビルド専用で、拡張のパッケージには入らない。
- **自動保護は上位 10,000 位まで**(`createSafelist` の `limit`)。その帯は登録ドメインの配下ごと除外する。
- **10,001〜50,000 位は保護しない**(`reviewLimit`)。ブロック対象がこの帯に載っていればビルドログに `[build-rules] review: ...` として出すだけで、除外するかは人が判断し、確認できたものを `scripts/safelist.manual.json` の `never_block` に入れる。**深い順位を自動保護にしてはいけない**: Tranco は DNS 問い合わせ量で順位を付けるため、稼働中のマルウェアが自力で順位を得る(実測 2026-09-14: `okiloveyoupleasedonttouchme.net` #11,453 / `dontworry.su` #14,230 / `dnsrecordsarepowerful.com` #27,967、いずれも同時に ThreatFox 掲載)。
- **robots**: 該当なし。クローラで巡回せず、公開されている `top-1m.csv.zip` を人が 1 回ダウンロードするだけ。
- **規約**: 研究・商用とも利用可、出典表記が条件(Le Pochat et al., NDSS 2019)。取得は zip を 1 回落とすだけで、スクレイピングはしない。
- **更新**: 数か月に 1 度で足りる(人気サイトの顔ぶれは安定)。更新時は `top-1m.csv.zip` を取得し、CSV 2 列目の上位 50,000 を JSON 配列に落とし、`npm test` の `scripts/safelist.test.ts` が通ることを確認する。
- **なぜ必要か**: 2026-09-14 のストアレビュー。フィードに一時的に混じった steamcommunity.com がストア版 1.5.12 の静的ルールに焼き込まれ、Steam が丸ごと遮断された。フィードはホスト単位、拡張はドメイン単位でブロックするので、共有ホストの混入は全利用者に効く。
