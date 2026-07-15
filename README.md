<p align="center">
  <img src="public/icons/icon128.png" width="128" height="128" alt="Zevr Guard" />
</p>

<h1 align="center">Zevr Guard</h1>

<p align="center">
  <strong>See who your browser is talking to. Block the dangerous ones.</strong>
</p>

<p align="center">
  <a href="https://github.com/krystasis/zevr-guard/releases/latest">
    <img alt="Release" src="https://img.shields.io/github/v/release/krystasis/zevr-guard" />
  </a>
  <a href="./LICENSE">
    <img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue" />
  </a>
  <img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome_Web_Store-available-green" />
</p>

---

Zevr Guard is a Chrome extension that visualizes every connection your browser makes and automatically blocks malware, phishing, and tracker domains. Install once, zero configuration — protection starts the moment it's enabled.

- **115,000+ tracker signals** identify who reaches your browser and how often
- **Lookalike phishing detection** — homoglyph (`аpple.com`), typosquat (`paypa1.com`) and brand-embedding (`paypal.com.verify-account.net`) domains are caught by on-device heuristics, before they reach any blocklist
- **Country blocking** — block everything from a region with one tap; domains are blocked as soon as traffic from a blocked country is observed
- **Password-entry guard** — a lightweight content script warns before you type a password on an unencrypted page, a suspected lookalike, or a site you have never signed into
- **Community phishing reports** — one click submits a suspicious domain for review; approved reports reach every user through the daily threat feed
- **Daily threat-DB auto-updates** via Zevr's CDN — your browsing URLs are never sent
- **Local-only matching** — every decision happens inside your browser
- **Real-time world map** of the connections a page makes, with risk coloring
- **Faster browsing as a side effect** — blocking ads and trackers removes dozens of HTTP requests and JS executions per page
- **18 languages** — UI and store listing localized, picked automatically from your browser language

## Privacy model

Zevr Guard **never uploads the URLs you visit**. The only outbound traffic is a scheduled, anonymous fetch of the threat database from Zevr's CDN. The request contains no information about you or the sites you browse — it is indistinguishable across users.

If you want to verify this, the code in this repository is the code that ships in the extension. Search for `fetch(` in [`src/`](./src/) — the only network fetches are:

- the threat-DB update in [`src/background/feed.ts`](./src/background/feed.ts) (anonymous, daily, from Zevr's own CDN);
- an approximate-location lookup at `https://feedback.zevrhq.com/v1/whereami` in [`src/background/index.ts`](./src/background/index.ts) — Zevr's own CDN returns the coarse location Cloudflare already resolved from the request, so the map can draw a "you are here" marker. It sends nothing about you or the sites you visit, contacts no third party, is cached after the first call, and stores nothing server-side;
- the phishing-report submission in [`src/background/index.ts`](./src/background/index.ts) — sent **only when you explicitly click "Report as phishing"**, and containing only the reported domain name, never the page you were on or anything about you.

Every other `fetch(` targets assets bundled inside the extension package. The lookalike phishing heuristics in [`src/background/lookalike.ts`](./src/background/lookalike.ts), the password-entry guard, and country blocking all run entirely on-device.

## Build

```bash
npm install
npm run build:data   # fetches upstream threat feeds, writes src/data/*.json and public/rules/block_rules.json
npm run build        # type-checks and produces dist/ (the unpacked Chrome extension)
```

To load the unpacked extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

## Threat data sources

The bundled threat database is assembled from well-known public sources. The exact composition is visible in [`scripts/build-rules.ts`](./scripts/build-rules.ts).

- Tracker identification: DuckDuckGo Tracker Radar, Ghostery trackerdb, Disconnect, EasyPrivacy, AdGuard
- Malware / phishing: abuse.ch URLhaus
- Geolocation: MaxMind GeoLite2 (downloaded at build time)
- Base map: Natural Earth 110m land
- Country flags: Twemoji (CC-BY 4.0)

Attribution for each source is preserved in the code and in this README. If you are a data source maintainer and would like different attribution, please open an issue.

## Project layout

```
src/
├── background/    # service worker, request interception, threat-DB feed logic
├── popup/         # toolbar popup UI
├── sidepanel/     # live globe side panel
├── welcome/       # onboarding page
├── warning/       # "dangerous site blocked" page
├── shared/        # i18n, icons, 3D background
└── data/          # threat-DB artefacts (generated)

scripts/build-rules.ts   # threat-DB builder
_locales/                # Chrome i18n messages
public/                  # static assets bundled with the extension
```

## License

[GPL-3.0-only](./LICENSE). If you redistribute, build derivatives, or fork Zevr Guard, your version must be released under GPL-3.0-only as well.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All commits must be signed off (Developer Certificate of Origin).

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md). Please do not open public issues for security-sensitive reports.
