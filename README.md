# Zevr Guard

**See who your browser is talking to. Block the dangerous ones.**

Zevr Guard is a Chrome extension that visualizes every connection your browser makes and automatically blocks malware, phishing, and tracker domains. Install once, zero configuration — protection starts the moment it's enabled.

- **115,000+ tracker signals** identify who reaches your browser and how often
- **Daily threat-DB auto-updates** via Zevr's CDN — your browsing URLs are never sent
- **Local-only matching** — every decision happens inside your browser
- **Real-time world map** of the connections a page makes, with risk coloring
- **Faster browsing as a side effect** — blocking ads and trackers removes dozens of HTTP requests and JS executions per page

## Privacy model

Zevr Guard **never uploads the URLs you visit**. The only outbound traffic is a scheduled, anonymous fetch of the threat database from Zevr's CDN. The request contains no information about you or the sites you browse — it is indistinguishable across users.

If you want to verify this, the code in this repository is the code that ships in the extension. Search for `fetch(` in [`src/`](./src/) — you will find only the threat-DB fetch in [`src/background/feed.ts`](./src/background/feed.ts) and the geolocation lookup of your own IP via `api.ipify.org` in [`src/background/index.ts`](./src/background/index.ts) (this lookup is made once per session to render the "you are here" marker on the world map and can be disabled in settings).

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
