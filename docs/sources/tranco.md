# Tranco top sites — 安全リストの元データ

- **URL**: https://tranco-list.eu/ (list download: `https://tranco-list.eu/top-1m.csv.zip`)
- **用途**: `scripts/safelist.ts` が、脅威フィード(URLhaus / ThreatFox)から人気サイトとその配下を除外するために使う。上位 50,000 件を `src/data/tranco.snapshot.json`(登録ドメインの配列、順位順)として保持。上位 10,000 位は配下ごと保護、10,001〜50,000 位は登録ドメイン本体と www. のみ保護(`scripts/safelist.ts` の subtreeLimit / apexLimit)。ビルド専用で、拡張のパッケージには入らない。
- **規約**: 研究・商用とも利用可、出典表記が条件(Le Pochat et al., NDSS 2019)。取得は zip を 1 回落とすだけで、スクレイピングはしない。
- **更新**: 数か月に 1 度で足りる(人気サイトの顔ぶれは安定)。更新時は `top-1m.csv.zip` を取得し、CSV 2 列目の上位 50,000 を JSON 配列に落とし、`npm test` の `scripts/safelist.test.ts` が通ることを確認する。
- **なぜ必要か**: 2026-09-14 のストアレビュー。フィードに一時的に混じった steamcommunity.com がストア版 1.5.12 の静的ルールに焼き込まれ、Steam が丸ごと遮断された。フィードはホスト単位、拡張はドメイン単位でブロックするので、共有ホストの混入は全利用者に効く。
