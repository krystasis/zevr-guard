import { useEffect, useRef, useState } from 'react';
import { WorldMapCanvas, type WorldMap } from '../shared/worldmap/WorldMapCanvas';
import { Flag } from '../shared/Flag';
import { AppIcon } from '../shared/AppIcon';
import { t } from '../shared/i18n';
import { groupByCountry, type CountryGroup } from '../shared/grouping';
import { registrableDomain } from '../shared/domain';
import countryCentroids from '../data/country_centroids.json';
import type { Connection, PageStats, RiskLevel, Settings } from '../types';

type ListView = 'domains' | 'countries';

const CENTROIDS = countryCentroids as unknown as Record<string, [number, number]>;

type DetailView = null | 'trackers' | 'blocked' | 'companies';

const RISK_COLORS: Record<RiskLevel, string> = {
  safe: 'text-emerald-400',
  tracker: 'text-sky-400',
  suspicious: 'text-amber-400',
  dangerous: 'text-red-400',
};

const RISK_DOT: Record<RiskLevel, string> = {
  safe: 'bg-emerald-500',
  tracker: 'bg-sky-500',
  suspicious: 'bg-amber-500',
  dangerous: 'bg-red-500 animate-pulse',
};

const riskLabel = (r: RiskLevel): string => {
  switch (r) {
    case 'safe':
      return t('legendSafe', 'Safe');
    case 'tracker':
      return t('legendTracker', 'Service');
    case 'suspicious':
      return t('legendSuspicious', 'Ad & tracking');
    case 'dangerous':
      return t('legendDangerous', 'Dangerous');
  }
};

const riskLabelUpper = (r: RiskLevel): string => {
  switch (r) {
    case 'safe':
      return t('riskLabelSafe', 'SAFE');
    case 'tracker':
      return t('riskLabelTracker', 'TRACKER');
    case 'suspicious':
      return t('riskLabelSuspicious', 'SUSPICIOUS');
    case 'dangerous':
      return t('riskLabelDangerous', 'DANGEROUS');
  }
};

function detectUserCountry(): string | null {
  try {
    const IntlAny = Intl as unknown as {
      Locale?: new (tag: string) => { region?: string; maximize(): { region?: string } };
    };
    if (typeof IntlAny.Locale === 'function') {
      for (const lang of navigator.languages ?? [navigator.language]) {
        try {
          const locale = new IntlAny.Locale(lang);
          if (locale.region) return locale.region.toUpperCase();
          const maxi = locale.maximize();
          if (maxi.region) return maxi.region.toUpperCase();
        } catch {
          // ignore invalid tags
        }
      }
    }
    for (const lang of navigator.languages ?? [navigator.language]) {
      const parts = lang.split('-');
      if (parts.length >= 2 && parts[1].length === 2) {
        return parts[1].toUpperCase();
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveUserLocation(): { lat: number; lng: number; code: string } | null {
  const code = detectUserCountry();
  if (code && CENTROIDS[code]) {
    const [lat, lng] = CENTROIDS[code];
    return { lat, lng, code };
  }
  return null;
}

async function fetchAccurateUserLocation(): Promise<
  { lat: number; lng: number; code: string } | null
> {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_USER_LOCATION' });
    const loc = res?.location;
    if (
      loc &&
      typeof loc.lat === 'number' &&
      typeof loc.lng === 'number' &&
      loc.countryCode
    ) {
      return { lat: loc.lat, lng: loc.lng, code: loc.countryCode };
    }
  } catch {
    // ignore
  }
  return null;
}

export const SidePanel: React.FC = () => {
  const [stats, setStats] = useState<PageStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>(null);
  const [listView, setListView] = useState<ListView>('domains');
  const [hoverDomain, setHoverDomain] = useState<string | null>(null);
  const [lockedDomain, setLockedDomain] = useState<string | null>(null);
  const [mapPick, setMapPick] = useState<{
    country: string;
    countryName: string | null;
    domains: number;
  } | null>(null);
  const mapRef = useRef<WorldMap | null>(null);
  const animatedRef = useRef<Set<string>>(new Set());
  const userLocRef = useRef<{ lat: number; lng: number } | null>(null);

  const activeDomain = hoverDomain ?? lockedDomain;

  useEffect(() => {
    // Prefer IP-based geolocation — it's what actually reflects where the
    // user is. Only fall back to navigator.languages-derived region if the
    // IP lookup fails, since Intl.Locale#maximize() coerces "ja" → "JP"
    // for every Japanese-UI user regardless of their actual country.
    void fetchAccurateUserLocation().then((accurate) => {
      if (accurate) {
        userLocRef.current = { lat: accurate.lat, lng: accurate.lng };
        mapRef.current?.setSource(accurate.lat, accurate.lng, accurate.code);
        return;
      }
      const fallback = resolveUserLocation();
      if (!fallback) return;
      userLocRef.current = { lat: fallback.lat, lng: fallback.lng };
      mapRef.current?.setSource(fallback.lat, fallback.lng, fallback.code);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (cancelled || !tab?.id) return;
      const url = tab.url ?? null;
      const [statsRes, settingsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_PAGE_STATS', tabId: tab.id }),
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      ]);
      if (cancelled) return;
      setTabUrl(url);
      setStats(statsRes?.stats ?? null);
      setSettings(settingsRes?.settings ?? null);
    };
    void tick();
    const id = setInterval(tick, 1500);

    const onTabChange = () => void tick();
    chrome.tabs.onActivated.addListener(onTabChange);
    chrome.tabs.onUpdated.addListener(onTabChange);

    return () => {
      cancelled = true;
      clearInterval(id);
      chrome.tabs.onActivated.removeListener(onTabChange);
      chrome.tabs.onUpdated.removeListener(onTabChange);
    };
  }, []);

  const prevTabUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = userLocRef.current;
    if (!activeDomain || !src || !stats) {
      map.clearHighlight();
      return;
    }
    const conn = stats.connections[activeDomain];
    if (!conn || conn.lat == null || conn.lon == null) {
      map.clearHighlight();
      return;
    }
    map.setHighlight(src.lat, src.lng, conn.lat, conn.lon, conn.domain);
  }, [activeDomain, stats]);

  useEffect(() => {
    setHoverDomain(null);
    setLockedDomain(null);
  }, [tabUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (prevTabUrlRef.current !== tabUrl) {
      prevTabUrlRef.current = tabUrl;
      animatedRef.current.clear();
      map.clearArcs();
      map.clearPointers();
    }

    if (!stats) return;
    const src = userLocRef.current;
    if (!src) return;

    for (const conn of Object.values(stats.connections)) {
      if (conn.lat == null || conn.lon == null) continue;
      if (animatedRef.current.has(conn.domain)) continue;
      animatedRef.current.add(conn.domain);
      map.addArc({
        from: src,
        to: { lat: conn.lat, lng: conn.lon },
        risk: conn.riskLevel,
        label: conn.domain,
      });
    }
  }, [stats, tabUrl]);

  const connections = stats
    ? Object.values(stats.connections).sort((a, b) => {
        // Blocked connections sink to the bottom.
        if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1;
        const order: Record<RiskLevel, number> = {
          dangerous: 0,
          suspicious: 1,
          tracker: 2,
          safe: 3,
        };
        const diff = order[a.riskLevel] - order[b.riskLevel];
        return diff !== 0 ? diff : b.count - a.count;
      })
    : [];

  async function refreshSettings() {
    const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    setSettings(settingsRes?.settings ?? null);
  }

  async function handleBlock(domain: string) {
    await chrome.runtime.sendMessage({ type: 'BLOCK_DOMAIN', domain });
    await refreshSettings();
  }

  async function handleUnblock(domain: string) {
    await chrome.runtime.sendMessage({ type: 'UNBLOCK_DOMAIN', domain });
    await refreshSettings();
  }

  async function handleBlockCountry(country: string) {
    await chrome.runtime.sendMessage({ type: 'BLOCK_COUNTRY', country });
    await refreshSettings();
  }

  async function handleUnblockCountry(country: string) {
    await chrome.runtime.sendMessage({ type: 'UNBLOCK_COUNTRY', country });
    await refreshSettings();
  }

  const blockedCountries = settings?.blockedCountries ?? [];

  // Click a dot on the globe to act on the country it sits in. Dots are placed
  // at country centroids, so hit-test the connections with the same
  // equirectangular projection the map uses and pick the nearest one.
  function handleMapClick(px: number, py: number, w: number, h: number) {
    if (!stats) return;
    let best: Connection | null = null;
    let bestDist = 18; // px radius
    for (const c of Object.values(stats.connections)) {
      if (c.lat == null || c.lon == null || !c.country) continue;
      const x = ((c.lon + 180) / 360) * w;
      const y = ((90 - c.lat) / 180) * h;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (!best || !best.country) {
      setMapPick(null);
      return;
    }
    const country = best.country;
    const domains = Object.values(stats.connections).filter(
      (c) => c.country === country,
    ).length;
    setMapPick({ country, countryName: best.countryName, domains });
  }

  const pickBlocked = mapPick ? blockedCountries.includes(mapPick.country) : false;

  const host = stats?.host ?? '';
  const riskLevel = stats?.riskLevel ?? 'safe';

  return (
    <div className="h-screen flex flex-col bg-[radial-gradient(circle_at_top,#0b1e2e_0%,#000_60%)] text-gray-100 font-sans overflow-hidden">
      <Header host={host} riskLevel={riskLevel} score={stats?.riskScore ?? 0} />

      <div className="relative aspect-[2/1] border-b border-cyan-900/40 overflow-hidden shrink-0">
        <WorldMapCanvas
          style={{ position: 'absolute', inset: 0 }}
          onReady={(m) => {
            mapRef.current = m;
            const loc = userLocRef.current;
            if (loc) m.setSource(loc.lat, loc.lng, t('youLabel', 'YOU'));
          }}
          onDispose={() => {
            mapRef.current = null;
          }}
          onMapClick={handleMapClick}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" />
        {stats && Object.keys(stats.connections).length > 0 && !mapPick && (
          <div className="pointer-events-none absolute top-2 left-3 text-[9px] text-cyan-300/70 bg-black/40 rounded-full px-2 py-0.5 border border-cyan-900/40">
            {t('mapBlockHint', 'Tap a dot to block its country')}
          </div>
        )}
        <LegendOverlay stats={stats} />
      </div>

      {mapPick && (
        <MapPickBar
          country={mapPick.country}
          countryName={mapPick.countryName}
          domains={mapPick.domains}
          blocked={pickBlocked}
          onBlock={() => {
            void handleBlockCountry(mapPick.country);
            setMapPick(null);
          }}
          onUnblock={() => {
            void handleUnblockCountry(mapPick.country);
            setMapPick(null);
          }}
          onClose={() => setMapPick(null)}
        />
      )}

      {stats && (
        <PageStrip stats={stats} active={detailView} onSelect={setDetailView} />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-xs">
        {detailView ? (
          <DetailPanel
            view={detailView}
            stats={stats}
            settings={settings}
            onBack={() => setDetailView(null)}
            onUnblock={handleUnblock}
          />
        ) : connections.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-2xl mb-2">📡</div>
            {t('monitoringConnections', 'Monitoring connections...')}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1 px-1">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">
                {t('connectionsCount', 'Connections')} · {connections.length}
              </div>
              <div className="flex border border-cyan-900/40 rounded-md overflow-hidden text-[9px] uppercase tracking-wider">
                <button
                  className={`px-2 py-0.5 transition ${
                    listView === 'domains'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'text-gray-500 hover:text-gray-200 hover:bg-cyan-900/20'
                  }`}
                  onClick={() => setListView('domains')}
                >
                  {t('groupDomains', 'Domains')}
                </button>
                <button
                  className={`px-2 py-0.5 border-l border-cyan-900/40 transition ${
                    listView === 'countries'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'text-gray-500 hover:text-gray-200 hover:bg-cyan-900/20'
                  }`}
                  onClick={() => setListView('countries')}
                >
                  {t('groupCountries', 'Countries')}
                </button>
              </div>
            </div>
            {listView === 'countries'
              ? groupByCountry(connections).map((g) => (
                  <CountryRow
                    key={g.country ?? '(unknown)'}
                    group={g}
                    blocked={g.country ? blockedCountries.includes(g.country) : false}
                    onBlockCountry={handleBlockCountry}
                    onUnblockCountry={handleUnblockCountry}
                  />
                ))
              : connections.map((c) => (
                  <ConnectionRow
                    key={c.domain}
                    connection={c}
                    isLocked={lockedDomain === c.domain}
                    isHover={hoverDomain === c.domain}
                    onHover={(v) => setHoverDomain(v ? c.domain : null)}
                    onToggleLock={() =>
                      setLockedDomain((prev) => (prev === c.domain ? null : c.domain))
                    }
                    onBlock={handleBlock}
                    onUnblock={handleUnblock}
                  />
                ))}
          </>
        )}
      </div>
    </div>
  );
};

const Header: React.FC<{ host: string; riskLevel: RiskLevel; score: number }> = ({
  host,
  riskLevel,
  score,
}) => (
  <div className="shrink-0 px-4 py-3 border-b border-cyan-900/40 bg-black/60 backdrop-blur flex items-center gap-3">
    <AppIcon size={32} className="drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-bold tracking-wider text-sm">ZEVR GUARD</span>
        <span className="text-[10px] uppercase tracking-widest text-cyan-500">
          {t('sidepanelSubtitle', 'Live Globe')}
        </span>
      </div>
      <div className="text-[11px] text-gray-400 truncate">
        {host || t('popupNoData', 'no active page')}
      </div>
    </div>
    <div className="text-right">
      <div
        className={`text-[9px] font-bold tracking-[0.22em] ${RISK_COLORS[riskLevel]}`}
      >
        ● {riskLabelUpper(riskLevel)}
      </div>
      <div className="flex items-baseline justify-end gap-0.5">
        <div className={`text-2xl leading-none font-bold ${RISK_COLORS[riskLevel]}`}>
          {score}
        </div>
        <div className="text-[11px] text-gray-500 font-bold">%</div>
      </div>
      <div className="text-[9px] uppercase tracking-widest text-gray-500">
        {t('riskScoreLabel', 'risk score')}
      </div>
    </div>
  </div>
);

const MapPickBar: React.FC<{
  country: string;
  countryName: string | null;
  domains: number;
  blocked: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onClose: () => void;
}> = ({ country, countryName, domains, blocked, onBlock, onUnblock, onClose }) => (
  <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-cyan-900/40 bg-cyan-950/40">
    <Flag code={country} size={16} />
    <div className="min-w-0 flex-1">
      <div className="text-gray-100 text-[12px] font-bold truncate">
        {countryName ?? country}
      </div>
      <div className="text-gray-500 text-[10px]">
        {domains === 1
          ? t('groupDomainCountOne', '1 domain')
          : t('groupDomainCount', `${domains} domains`, String(domains))}
      </div>
    </div>
    <button
      className={`flex-shrink-0 px-3 h-7 rounded-full text-[10px] font-bold uppercase tracking-wider transition ${
        blocked
          ? 'bg-gray-700/70 text-gray-100 hover:bg-gray-600'
          : 'bg-red-600 text-white hover:bg-red-500'
      }`}
      onClick={blocked ? onUnblock : onBlock}
    >
      {blocked
        ? `✓ ${t('unblock', 'unblock')}`
        : `🌍 ${t('blockCountry', `Block all traffic from ${countryName ?? country}`, countryName ?? country)}`}
    </button>
    <button
      className="flex-shrink-0 text-gray-500 hover:text-gray-200 text-sm px-1"
      onClick={onClose}
      aria-label={t('warningGoBack', 'Close')}
    >
      ✕
    </button>
  </div>
);

const LegendOverlay: React.FC<{ stats: PageStats | null }> = ({ stats }) => {
  const counts = stats
    ? Object.values(stats.connections).reduce(
        (acc, c) => {
          acc[c.riskLevel] = (acc[c.riskLevel] ?? 0) + 1;
          return acc;
        },
        {} as Record<RiskLevel, number>,
      )
    : ({} as Record<RiskLevel, number>);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5 text-[10px]">
      {(['dangerous', 'suspicious', 'tracker', 'safe'] as RiskLevel[]).map((r) => (
        <div
          key={r}
          className="flex items-center gap-1.5 bg-black/60 border border-cyan-900/40 rounded-full px-2 py-0.5"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${RISK_DOT[r]}`} />
          <span className="text-gray-300">{riskLabel(r)}</span>
          <span className="text-white font-bold">{counts[r] ?? 0}</span>
        </div>
      ))}
    </div>
  );
};

const PageStrip: React.FC<{
  stats: PageStats;
  active: DetailView;
  onSelect: (v: DetailView) => void;
}> = ({ stats, active, onSelect }) => {
  const list = Object.values(stats.connections);
  const trackersCount = list.filter(
    (c) => c.riskLevel === 'tracker' || c.riskLevel === 'suspicious',
  ).length;
  const companiesCount = new Set(
    list.filter((c) => c.company).map((c) => c.company!),
  ).size;
  const cells: Array<{
    key: Exclude<DetailView, null>;
    label: string;
    value: number;
    accent: string;
  }> = [
    { key: 'trackers', label: t('stripTrackers', 'Trackers'), value: trackersCount, accent: 'text-sky-400' },
    { key: 'blocked', label: t('stripBlocked', 'Blocked'), value: stats.blockedCount, accent: 'text-red-400' },
    { key: 'companies', label: t('stripCompanies', 'Companies'), value: companiesCount, accent: 'text-emerald-400' },
  ];
  return (
    <div className="shrink-0 grid grid-cols-3 text-center text-[10px] bg-gray-950/80 border-b border-cyan-900/40">
      {cells.map((c) => (
        <StatButton
          key={c.key}
          active={active === c.key}
          onClick={() => onSelect(active === c.key ? null : c.key)}
          label={c.label}
          value={c.value}
          accent={c.accent}
        />
      ))}
    </div>
  );
};

const StatButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  value: number;
  accent: string;
}> = ({ active, onClick, label, value, accent }) => (
  <button
    className={`py-2 border-r border-cyan-900/30 last:border-r-0 transition ${
      active ? 'bg-cyan-900/30' : 'hover:bg-cyan-900/15'
    }`}
    onClick={onClick}
  >
    <div className={`text-lg font-bold ${accent}`}>{value}</div>
    <div className={`uppercase tracking-widest ${active ? 'text-cyan-300' : 'text-gray-500'}`}>
      {label} {active ? '▾' : ''}
    </div>
  </button>
);

const DetailPanel: React.FC<{
  view: Exclude<DetailView, null>;
  stats: PageStats | null;
  settings: Settings | null;
  onBack: () => void;
  onUnblock: (domain: string) => void;
}> = ({ view, stats, settings, onBack, onUnblock }) => {
  const header = (
    <>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-cyan-900/25 hover:bg-cyan-900/40 border-b border-cyan-800/50 text-cyan-200 text-[11px] font-bold tracking-wider transition group -mx-3 -mt-2 mb-2"
        onClick={onBack}
      >
        <span className="text-base leading-none transition group-hover:-translate-x-0.5">
          ←
        </span>
        <span>{t('backToConnections', 'Back to connections')}</span>
      </button>
      <div className="text-[10px] uppercase tracking-widest text-gray-400 px-1 mb-1">
        {t('thisPage', 'This page')} ·{' '}
        {view === 'trackers'
          ? t('stripTrackers', 'Trackers')
          : view === 'blocked'
            ? t('stripBlocked', 'Blocked')
            : t('stripCompanies', 'Companies')}
      </div>
    </>
  );

  if (!stats) {
    return (
      <>
        {header}
        <div className="text-center text-gray-500 py-8">No data yet.</div>
      </>
    );
  }

  const list = Object.values(stats.connections);

  if (view === 'trackers') {
    const entries = list
      .filter((c) => c.riskLevel === 'tracker' || c.riskLevel === 'suspicious')
      .sort((a, b) => b.count - a.count);

    const totalRequests = entries.reduce((s, c) => s + c.count, 0);
    const companiesCount = new Set(
      entries.filter((c) => c.company).map((c) => c.company!),
    ).size;
    const summary = (
      <div className="text-[10px] text-gray-500 px-2 pb-2 flex gap-2 flex-wrap">
        <span>
          <span className="text-sky-300 font-bold">{totalRequests}</span>{' '}
          {t('drillRequests', 'requests')}
        </span>
        <span>·</span>
        <span>
          <span className="text-sky-300 font-bold">{entries.length}</span>{' '}
          {t('drillDomains', 'domains')}
        </span>
        <span>·</span>
        <span>
          <span className="text-sky-300 font-bold">{companiesCount}</span>{' '}
          {t('drillCompanies', 'companies')}
        </span>
      </div>
    );

    if (entries.length === 0) {
      return (
        <>
          {header}
          <div className="text-center text-gray-500 py-8">
            <div className="text-2xl mb-2">🎉</div>
            {t('noTrackersOnPage', 'No trackers on this page.')}
          </div>
        </>
      );
    }
    const max = entries[0].count;
    return (
      <>
        {header}
        {summary}
        {entries.map((c) => (
          <div
            key={c.domain}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                c.riskLevel === 'suspicious' ? 'bg-amber-500' : 'bg-sky-500'
              }`}
            />
            <Flag code={c.country} size={12} />
            <div className="flex-1 min-w-0">
              <div className="truncate text-gray-100 font-mono text-[11px]">
                {c.domain}
              </div>
              {(c.company || c.category) && (
                <div className="text-gray-500 text-[10px] truncate">
                  {[c.company, c.category].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="h-0.5 mt-1 bg-cyan-900/30 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    c.riskLevel === 'suspicious' ? 'bg-amber-500/70' : 'bg-sky-500/70'
                  }`}
                  style={{ width: `${(c.count / max) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-gray-400 text-[11px] font-mono flex-shrink-0">
              {c.count}×
            </div>
          </div>
        ))}
      </>
    );
  }

  if (view === 'companies') {
    const companyMap = new Map<
      string,
      { requests: number; domains: number; country: string | null }
    >();
    for (const c of list) {
      // No owner on record: fall back to the root domain so unclassified
      // connections stay visible instead of vanishing from this view.
      const key = c.company ?? registrableDomain(c.domain);
      const existing = companyMap.get(key);
      if (existing) {
        existing.requests += c.count;
        existing.domains += 1;
        if (!existing.country) existing.country = c.country;
      } else {
        companyMap.set(key, {
          requests: c.count,
          domains: 1,
          country: c.country,
        });
      }
    }
    const entries = Array.from(companyMap.entries()).sort(
      (a, b) => b[1].requests - a[1].requests,
    );

    if (entries.length === 0) {
      return (
        <>
          {header}
          <div className="text-center text-gray-500 py-8">
            <div className="text-2xl mb-2">🎉</div>
            {t('noCompaniesOnPage', 'No identifiable companies on this page.')}
          </div>
        </>
      );
    }
    const max = entries[0][1].requests;
    return (
      <>
        {header}
        {entries.map(([company, info]) => (
          <div
            key={company}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20"
          >
            <Flag code={info.country} size={12} />
            <div className="flex-1 min-w-0">
              <div className="truncate text-gray-100 text-[11px]">{company}</div>
              <div className="text-gray-500 text-[9px]">
                {info.domains === 1
                  ? t('groupDomainCountOne', '1 domain')
                  : t('groupDomainCount', `${info.domains} domains`, String(info.domains))}
              </div>
              <div className="h-0.5 mt-1 bg-cyan-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500/70"
                  style={{ width: `${(info.requests / max) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-gray-400 text-[11px] font-mono flex-shrink-0">
              {info.requests}×
            </div>
          </div>
        ))}
      </>
    );
  }

  const blockedOnPage = list.filter((c) => c.isBlocked);
  const customBlocklist = settings
    ? [...settings.customBlockList].sort()
    : [];

  return (
    <>
      {header}
      {stats.blockedCount > 0 ? (
        <div className="text-[10px] text-gray-500 px-2 pb-2">
          {t(
            'requestsBlockedCount',
            `${stats.blockedCount} requests blocked on this page`,
            String(stats.blockedCount),
          )}
        </div>
      ) : (
        blockedOnPage.length === 0 &&
        customBlocklist.length === 0 && (
          <div className="text-center text-gray-500 py-6">
            <div className="text-2xl mb-2">🛡️</div>
            {t('nothingBlocked', 'Nothing blocked on this page.')}
            <div className="text-[10px] mt-2">
              {t('watchingMsg', 'Zevr Guard is watching — dangerous sites will be auto-blocked.')}
            </div>
          </div>
        )
      )}

      {blockedOnPage.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-widest text-gray-500 px-2 pt-1 pb-1">
            {t('onThisPage', 'On this page')}
          </div>
          {blockedOnPage.map((c) => (
            <div
              key={c.domain}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-red-500" />
              <Flag code={c.country} size={12} />
              <div className="flex-1 min-w-0 text-gray-100 font-mono text-[11px] truncate">
                {c.domain}
              </div>
              <button
                className="flex-shrink-0 px-2 h-5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-700/60 text-gray-200 hover:bg-gray-600 transition"
                onClick={() => onUnblock(c.domain)}
              >
                {t('unblock', 'unblock')}
              </button>
            </div>
          ))}
        </>
      )}

      {customBlocklist.length > 0 && (
        <>
          <div className="flex items-center justify-between px-2 pt-3 pb-1 text-[9px] uppercase tracking-widest">
            <span className="text-gray-500">
              {t('settingsCustomBlocklist', 'Custom blocklist')}
            </span>
            <span className="text-cyan-300 font-bold">
              {customBlocklist.length === 1
                ? t('groupDomainCountOne', '1 domain')
                : t('groupDomainCount', `${customBlocklist.length} domains`, String(customBlocklist.length))}
            </span>
          </div>
          {customBlocklist.map((domain) => (
            <div
              key={domain}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20"
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-500" />
              <div className="flex-1 min-w-0 text-gray-100 font-mono text-[11px] truncate">
                {domain}
              </div>
              <button
                className="flex-shrink-0 px-2 h-5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-700/60 text-gray-200 hover:bg-gray-600 transition"
                onClick={() => onUnblock(domain)}
              >
                {t('unblock', 'unblock')}
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
};

const CountryBadge: React.FC<{ code: string | null }> = ({ code }) => {
  if (!code) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-4 rounded bg-gray-800/60 border border-gray-700/50 text-gray-500 font-mono text-[9px]">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-4 px-1 rounded bg-cyan-900/40 border border-cyan-800/60 text-cyan-200 font-mono text-[9px] font-bold tracking-wider">
      {code.toUpperCase()}
    </span>
  );
};

const ConnectionRow: React.FC<{
  connection: Connection;
  isLocked: boolean;
  isHover: boolean;
  onHover: (v: boolean) => void;
  onToggleLock: () => void;
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
}> = ({ connection, isLocked, isHover, onHover, onToggleLock, onBlock, onUnblock }) => {
  const active = isLocked || isHover;
  const blocked = connection.isBlocked;
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20 cursor-pointer transition ${
        blocked
          ? 'bg-red-950/25 border-l-2 border-l-red-500/60'
          : active
            ? 'bg-cyan-900/25 border-l-2 border-l-cyan-400'
            : 'border-l-2 border-l-transparent hover:bg-cyan-900/10'
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onToggleLock}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          blocked ? 'bg-gray-600' : RISK_DOT[connection.riskLevel]
        }`}
      />
      <CountryBadge code={connection.country} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`truncate font-mono text-[11px] ${
              blocked ? 'text-gray-500 line-through decoration-red-500/60' : 'text-gray-100'
            }`}
          >
            {connection.domain}
          </span>
          {blocked && (
            <span className="flex-shrink-0 px-1 rounded-sm bg-red-900/50 text-red-300 text-[8px] font-bold uppercase tracking-wider leading-[1.4]">
              {t('connBlockedTag', 'blocked')}
            </span>
          )}
        </div>
        {(connection.company || connection.countryName) && (
          <div className="text-gray-500 text-[10px] flex items-center gap-1 min-w-0">
            {connection.company && (
              <span className="truncate">{connection.company}</span>
            )}
            {connection.company && connection.countryName && (
              <span className="text-gray-700">·</span>
            )}
            {connection.countryName && (
              <>
                <Flag code={connection.country} size={12} />
                <span className="truncate">{connection.countryName}</span>
              </>
            )}
          </div>
        )}
      </div>
      {isLocked && !blocked && (
        <span
          className="text-cyan-300 text-[9px] font-bold tracking-wider flex-shrink-0"
          title={t('unpinTitle', 'Click again to unpin')}
        >
          {t('pinBadge', 'PIN')}
        </span>
      )}
      <div className="text-gray-500 text-[10px] flex-shrink-0 tabular-nums">
        {connection.count}x
      </div>
      <button
        className={`flex-shrink-0 px-1.5 h-5 rounded text-[9px] font-bold uppercase tracking-wider transition ${
          blocked
            ? 'bg-gray-700/60 text-gray-300 hover:bg-gray-600'
            : 'bg-red-900/30 text-red-300 border border-red-800/50 hover:bg-red-900/60 hover:border-red-500'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (blocked) onUnblock(connection.domain);
          else onBlock(connection.domain);
        }}
      >
        {blocked ? t('unblock', 'unblock') : t('block', 'block')}
      </button>
    </div>
  );
};

const CountryRow: React.FC<{
  group: CountryGroup;
  blocked: boolean;
  onBlockCountry: (country: string) => void;
  onUnblockCountry: (country: string) => void;
}> = ({ group, blocked, onBlockCountry, onUnblockCountry }) => {
  const label =
    group.countryName ?? group.country ?? t('countryUnknown', 'Unknown location');
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20 ${
        blocked ? 'bg-red-950/25' : ''
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          blocked ? 'bg-gray-600' : RISK_DOT[group.topRisk]
        }`}
      />
      <Flag code={group.country} size={14} />
      <div className="flex-1 min-w-0">
        <div className="truncate text-gray-100 text-[11px] font-bold flex items-center gap-1.5">
          <span className="truncate">{label}</span>
          {blocked && (
            <span className="flex-shrink-0 px-1 rounded-sm bg-red-900/50 text-red-300 text-[8px] font-bold uppercase tracking-wider leading-[1.4]">
              {t('connBlockedTag', 'blocked')}
            </span>
          )}
        </div>
        <div className="text-gray-500 text-[9px]">
          {group.domains.length === 1
            ? t('groupDomainCountOne', '1 domain')
            : t('groupDomainCount', `${group.domains.length} domains`, String(group.domains.length))}
          <span className="text-gray-700"> · </span>
          {group.requests}×
        </div>
      </div>
      {group.country && (
        <button
          className={`flex-shrink-0 px-2 h-6 rounded-full text-[9px] font-bold uppercase tracking-wider transition ${
            blocked
              ? 'bg-gray-700/60 text-gray-200 hover:bg-gray-600'
              : 'bg-red-900/30 text-red-300 border border-red-800/50 hover:bg-red-900/60 hover:border-red-500'
          }`}
          onClick={() =>
            blocked ? onUnblockCountry(group.country!) : onBlockCountry(group.country!)
          }
          title={
            blocked
              ? t('unblockCountry', `Unblock ${label}`, label)
              : t('blockCountry', `Block all traffic from ${label}`, label)
          }
        >
          {blocked ? t('unblock', 'unblock') : `🌍 ${t('block', 'block')}`}
        </button>
      )}
    </div>
  );
};
