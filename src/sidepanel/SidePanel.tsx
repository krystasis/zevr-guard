import { useEffect, useRef, useState } from 'react';
import { WorldMapCanvas, type WorldMap } from '../shared/worldmap/WorldMapCanvas';
import { Flag } from '../shared/Flag';
import { AppIcon } from '../shared/AppIcon';
import { t } from '../shared/i18n';
import countryCentroids from '../data/country_centroids.json';
import type { Connection, PageStats, RiskLevel, Settings } from '../types';

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
      return t('legendTracker', 'Tracker');
    case 'suspicious':
      return t('legendSuspicious', 'Suspicious');
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
  const [hoverDomain, setHoverDomain] = useState<string | null>(null);
  const [lockedDomain, setLockedDomain] = useState<string | null>(null);
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

  async function handleUnblock(domain: string) {
    await chrome.runtime.sendMessage({ type: 'UNBLOCK_DOMAIN', domain });
    const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    setSettings(settingsRes?.settings ?? null);
  }

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
            if (loc) m.setSource(loc.lat, loc.lng, 'YOU');
          }}
          onDispose={() => {
            mapRef.current = null;
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" />
        <LegendOverlay stats={stats} />
      </div>

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
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 px-1">
              {t('connectionsCount', 'Connections')} · {connections.length}
            </div>
            {connections.map((c) => (
              <ConnectionRow
                key={c.domain}
                connection={c}
                isLocked={lockedDomain === c.domain}
                isHover={hoverDomain === c.domain}
                onHover={(v) => setHoverDomain(v ? c.domain : null)}
                onToggleLock={() =>
                  setLockedDomain((prev) => (prev === c.domain ? null : c.domain))
                }
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
      if (!c.company) continue;
      const existing = companyMap.get(c.company);
      if (existing) {
        existing.requests += c.count;
        existing.domains += 1;
        if (!existing.country) existing.country = c.country;
      } else {
        companyMap.set(c.company, {
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
                unblock
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
}> = ({ connection, isLocked, isHover, onHover, onToggleLock }) => {
  const active = isLocked || isHover;
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20 cursor-pointer transition ${
        active
          ? 'bg-cyan-900/25 border-l-2 border-l-cyan-400'
          : 'border-l-2 border-l-transparent hover:bg-cyan-900/10'
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onToggleLock}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RISK_DOT[connection.riskLevel]}`} />
      <CountryBadge code={connection.country} />
      <div className="flex-1 min-w-0">
        <div className="truncate text-gray-100 font-mono text-[11px]">
          {connection.domain}
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
      {isLocked && (
        <span
          className="text-cyan-300 text-[9px] font-bold tracking-wider flex-shrink-0"
          title="Click again to unpin"
        >
          {t('pinBadge', 'PIN')}
        </span>
      )}
      <div className="text-gray-500 text-[10px] flex-shrink-0">{connection.count}x</div>
    </div>
  );
};
