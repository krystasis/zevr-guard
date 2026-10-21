# 出典のライセンスと、使ってよい製品(2026-10-21 決定)

`scripts/build-rules.ts` が `trackers.json` を作るときに合成している出典と、そのライセンス(原文を 2026-10-21 に確認)。

| 出典 | ライセンス | 入っている列 |
|---|---|---|
| DuckDuckGo Tracker Radar(`ios-tds.json`) | CC BY-NC-SA 4.0(商用は要契約) | company / category / prevalence(優先 1 位) |
| Ghostery trackerdb | CC BY-NC-SA 4.0(商用は sales@ghostery.com) | company / category |
| Disconnect(`disconnect.json`) | CC BY-NC-SA 4.0 | company / category |
| AdGuard Tracking Protection | GPL-3.0 | ドメインだけ |
| EasyPrivacy | GPL-3.0 / CC BY-SA 3.0 | ドメインだけ |

## 決まり
- **Chrome 拡張と Safari 版は無料で配る**。上の 5 出典をこのまま使ってよい(帰属は README とコードに残す)。
- **有料のサービス(DNS を予定)には、CC BY-NC-SA の 3 出典(DDG / Ghostery / Disconnect)由来のデータを使わない**。遮断リストは GPL の AdGuard / EasyPrivacy と、自前の判定(ホモグリフ・タイポスクワット・ブランド埋め込み、`src/` の lookalike 検出)で組む。会社名・種類・出現率の列は有料側に持ち込まない。
- サイト(zevrhq.com)で `trackers.json` から作るページ(issue zevr-guard-site#53)は、無料版の案内として出す。各ページに出典の帰属と「有料サービスには使っていない」の 1 文を書く。
- 無料版を有料に変える、または有料側で NC の出典を使いたくなったら、先に DDG / Ghostery / Disconnect と商用契約を取る。帰属表記では NC の条件は解けない。
