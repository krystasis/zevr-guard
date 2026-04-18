import { useEffect, useState } from 'react';
import { Flag } from '../shared/Flag';
import { AppIcon } from '../shared/AppIcon';
import { t } from '../shared/i18n';
import type { Connection, PageStats, RiskLevel, Settings, TodayStats } from '../types';

const RISK_TEXT: Record<RiskLevel, string> = {
  safe: 'text-emerald-400',
  tracker: 'text-sky-400',
  suspicious: 'text-amber-400',
  dangerous: 'text-red-400',
};

const RISK_DOT: Record<RiskLevel, string> = {
  safe: 'bg-emerald-500 shadow-[0_0_6px_theme(colors.emerald.500)]',
  tracker: 'bg-sky-500 shadow-[0_0_6px_theme(colors.sky.500)]',
  suspicious: 'bg-amber-500 shadow-[0_0_6px_theme(colors.amber.500)]',
  dangerous: 'bg-red-500 shadow-[0_0_8px_theme(colors.red.500)] animate-pulse',
};

const RISK_GLOW: Record<RiskLevel, string> = {
  safe: 'drop-shadow-[0_0_10px_rgba(16,185,129,0.45)]',
  tracker: 'drop-shadow-[0_0_10px_rgba(56,189,248,0.45)]',
  suspicious: 'drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]',
  dangerous: 'drop-shadow-[0_0_12px_rgba(239,68,68,0.7)]',
};

const RISK_BORDER: Record<RiskLevel, string> = {
  safe: 'border-emerald-700/40',
  tracker: 'border-sky-700/40',
  suspicious: 'border-amber-600/40',
  dangerous: 'border-red-600/50',
};

const riskLabelUpperPopup = (r: RiskLevel): string => {
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

const riskMessage = (r: RiskLevel): string => {
  switch (r) {
    case 'safe':
      return t('riskMsgSafe', 'This page is safe');
    case 'tracker':
      return t('riskMsgTracker', 'Trackers detected');
    case 'suspicious':
      return t('riskMsgSuspicious', 'Suspicious traffic detected');
    case 'dangerous':
      return t('riskMsgDangerous', 'Dangerous traffic detected');
  }
};

const RISK_EXPLAIN: Record<RiskLevel, string> = {
  dangerous:
    'This domain is in known malware/phishing databases. It may attempt to steal your data or install malware.',
  suspicious:
    'This domain is used for advertising or tracking. It collects data about your browsing behavior.',
  tracker:
    'This domain is used for analytics or content delivery. It may collect some usage data.',
  safe: 'This domain appears to be safe. No known tracking or malicious activity detected.',
};

type GroupBy = 'domain' | 'company';

export const Popup: React.FC = () => {
  const [stats, setStats] = useState<PageStats | null>(null);
  const [today, setToday] = useState<TodayStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RiskLevel | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('domain');

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => {
      void loadData();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setLoading(false);
      return;
    }

    const [statsRes, settingsRes, todayRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PAGE_STATS', tabId: tab.id }),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
      chrome.runtime.sendMessage({ type: 'GET_TODAY_STATS' }),
    ]);

    setStats(statsRes?.stats ?? null);
    setSettings(settingsRes?.settings ?? null);
    setToday(todayRes?.today ?? null);
    setLoading(false);
  }

  async function handleBlock(domain: string) {
    await chrome.runtime.sendMessage({ type: 'BLOCK_DOMAIN', domain });
    await loadData();
  }

  async function handleUnblock(domain: string) {
    await chrome.runtime.sendMessage({ type: 'UNBLOCK_DOMAIN', domain });
    await loadData();
  }

  async function handleAllow(domain: string) {
    await chrome.runtime.sendMessage({ type: 'ALLOW_DOMAIN', domain });
    await loadData();
  }

  async function handleDisallow(domain: string) {
    await chrome.runtime.sendMessage({ type: 'DISALLOW_DOMAIN', domain });
    await loadData();
  }

  async function handleSettingsChange(next: Settings) {
    setSettings(next);
    await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: next });
  }

  if (loading) {
    return (
      <div className="w-[360px] h-48 bg-[radial-gradient(circle_at_top,#0b1e2e_0%,#000_70%)] flex items-center justify-center">
        <div className="text-cyan-300 text-xs tracking-widest animate-pulse">
          {t('popupScanning', 'SCANNING...')}
        </div>
      </div>
    );
  }

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

  const selected = selectedDomain
    ? connections.find((c) => c.domain === selectedDomain) ?? null
    : null;

  const riskCounts = connections.reduce(
    (acc, c) => {
      acc[c.riskLevel] = (acc[c.riskLevel] ?? 0) + 1;
      return acc;
    },
    { safe: 0, tracker: 0, suspicious: 0, dangerous: 0 } as Record<RiskLevel, number>,
  );

  const filtered = filter ? connections.filter((c) => c.riskLevel === filter) : connections;

  return (
    <div className="w-[360px] bg-[radial-gradient(circle_at_top,#0b1e2e_0%,#000_70%)] text-gray-100 font-sans text-xs relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-[repeating-linear-gradient(0deg,#38bdf8_0px,#38bdf8_1px,transparent_1px,transparent_3px)]" />
      <div className="relative">
        <TopBar view={view} onToggle={setView} />

        {view === 'settings' && settings ? (
          <SettingsPanel
            settings={settings}
            onChange={handleSettingsChange}
            onUnblock={handleUnblock}
            onDisallow={handleDisallow}
          />
        ) : selected ? (
          <ConnectionDetail
            connection={selected}
            onBack={() => setSelectedDomain(null)}
            onBlock={handleBlock}
            onUnblock={handleUnblock}
          />
        ) : (
          <>
            <Header stats={stats} today={today} />
            {settings && stats && (
              <AllowBar
                host={stats.host}
                allowed={settings.customWhiteList.includes(stats.host)}
                onAllow={handleAllow}
                onDisallow={handleDisallow}
              />
            )}
            {connections.length > 0 && (
              <Toolbar
                filter={filter}
                onFilterChange={setFilter}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                counts={riskCounts}
                total={connections.length}
              />
            )}
            <ConnectionList
              connections={filtered}
              groupBy={groupBy}
              onSelect={setSelectedDomain}
              onBlock={handleBlock}
              onUnblock={handleUnblock}
            />
          </>
        )}

        <Footer stats={stats} />
      </div>
    </div>
  );
};

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'src/sidepanel/index.html',
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch {
    // ignore
  }
}

const TopBar: React.FC<{
  view: 'list' | 'settings';
  onToggle: (v: 'list' | 'settings') => void;
}> = ({ view, onToggle }) => (
  <div className="flex items-center justify-between px-3 py-2 bg-black/60 backdrop-blur border-b border-cyan-900/40">
    <div className="flex items-center gap-2">
      <AppIcon size={22} className="drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
      <div className="leading-tight">
        <div className="font-bold tracking-[0.22em] text-[13px]">ZEVR GUARD</div>
        <div className="flex items-center gap-1 text-[9px] text-emerald-400 uppercase tracking-widest">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          {t('popupStatusLive', 'protection live')}
        </div>
      </div>
    </div>
    <div className="flex items-center gap-1">
      <IconButton onClick={openSidePanel} title="Open live globe side panel">
        🌐
      </IconButton>
      <IconButton
        onClick={() => onToggle(view === 'settings' ? 'list' : 'settings')}
        title="Settings"
        active={view === 'settings'}
      >
        {view === 'settings' ? '←' : '⚙'}
      </IconButton>
    </div>
  </div>
);

const IconButton: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  active?: boolean;
}> = ({ children, onClick, title, active }) => (
  <button
    onClick={onClick}
    title={title}
    className={`w-7 h-7 rounded-md border flex items-center justify-center transition ${
      active
        ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200'
        : 'border-cyan-900/40 text-cyan-400 hover:border-cyan-500/60 hover:text-cyan-200 hover:bg-cyan-500/10'
    }`}
  >
    {children}
  </button>
);

const AllowBar: React.FC<{
  host: string;
  allowed: boolean;
  onAllow: (domain: string) => void;
  onDisallow: (domain: string) => void;
}> = ({ host, allowed, onAllow, onDisallow }) => {
  if (!host) return null;
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${
        allowed
          ? 'border-emerald-800/40 bg-emerald-500/[0.04]'
          : 'border-cyan-900/40 bg-black/30'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-[0.25em] text-gray-500">
          {allowed
            ? t('allowBarAllowed', 'Allowed')
            : t('allowBarThisSite', 'This site')}
        </div>
        <div className="text-[11px] font-mono text-gray-200 truncate mt-0.5">
          {host}
        </div>
      </div>
      <button
        className={`flex-shrink-0 px-2.5 h-6 rounded-full text-[10px] font-bold uppercase tracking-wider transition ${
          allowed
            ? 'bg-emerald-500/80 text-black hover:bg-emerald-400'
            : 'bg-gray-700/60 text-gray-200 hover:bg-gray-600'
        }`}
        onClick={() =>
          allowed ? onDisallow(host) : onAllow(host)
        }
        title={
          allowed
            ? t('allowBarRemoveTitle', 'Remove this site from the allowlist')
            : t('allowBarAddTitle', 'Add this site to the allowlist (bypass blocking)')
        }
      >
        {allowed
          ? t('allowBarRevoke', 'Revoke')
          : t('allowBarAllow', 'Allow')}
      </button>
    </div>
  );
};

const Header: React.FC<{ stats: PageStats | null; today: TodayStats | null }> = ({
  stats,
  today,
}) => {
  if (!stats) {
    return (
      <div className="p-5 border-b border-cyan-900/40 text-center">
        <div className="text-gray-300 text-sm">
          {t('popupNoData', 'No data for this page yet.')}
        </div>
        <div className="text-gray-500 text-[11px] mt-1">
          {t('popupReloadToMonitor', 'Reload the tab to start monitoring.')}
        </div>
        {today && <TodayStrip today={today} />}
      </div>
    );
  }

  const riskLevel = stats.riskLevel;
  const domainCount = Object.keys(stats.connections).length;

  return (
    <>
      <div
        className={`relative p-3 border-b ${RISK_BORDER[riskLevel]} overflow-hidden`}
      >
        <div
          className={`pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-30 ${
            riskLevel === 'dangerous'
              ? 'bg-red-500'
              : riskLevel === 'suspicious'
                ? 'bg-amber-500'
                : riskLevel === 'tracker'
                  ? 'bg-sky-500'
                  : 'bg-emerald-500'
          }`}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className={`text-[10px] tracking-[0.3em] font-bold ${RISK_TEXT[riskLevel]}`}
            >
              ● {riskLabelUpperPopup(riskLevel)}
            </div>
            <div className="text-gray-300 text-[11px] mt-0.5">
              {riskMessage(riskLevel)}
            </div>
            <div className="text-gray-500 text-[11px] truncate mt-1.5 font-mono">
              {stats.host}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-baseline gap-0.5 justify-end">
              <div
                className={`text-[42px] font-black leading-none ${RISK_TEXT[riskLevel]} ${RISK_GLOW[riskLevel]}`}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {stats.riskScore}
              </div>
              <div
                className={`text-base font-bold ${RISK_TEXT[riskLevel]} opacity-70`}
              >
                %
              </div>
            </div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-gray-500 mt-1">
              risk score
            </div>
          </div>
        </div>

        <RiskGauge score={stats.riskScore} riskLevel={riskLevel} />

        <div className="relative grid grid-cols-3 gap-2 mt-3 text-center">
          <Metric label={t('metricDomains', 'domains')} value={domainCount} accent="text-cyan-300" />
          <Metric
            label={t('metricRequests', 'requests')}
            value={stats.totalCount}
            accent="text-gray-100"
          />
          <Metric
            label={t('metricBlocked', 'blocked')}
            value={stats.blockedCount}
            accent={stats.blockedCount > 0 ? 'text-red-400' : 'text-gray-500'}
          />
        </div>
      </div>

      {today && <TodayStrip today={today} />}
    </>
  );
};

const RiskGauge: React.FC<{ score: number; riskLevel: RiskLevel }> = ({
  score,
}) => {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="relative mt-3">
      <div className="flex justify-between text-[8px] uppercase tracking-[0.18em] text-gray-600 mb-1">
        <span>safe</span>
        <span>tracker</span>
        <span>suspicious</span>
        <span>dangerous</span>
      </div>
      <div className="relative h-1.5 rounded-full border border-cyan-900/30 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#10b981_0%,#38bdf8_30%,#facc15_60%,#ef4444_100%)] opacity-80" />
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white transition-[left] duration-500"
          style={{
            left: `${clamped}%`,
            boxShadow: '0 0 6px rgba(255,255,255,0.9), 0 0 10px rgba(255,255,255,0.6)',
          }}
        />
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number; accent: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="bg-black/30 border border-cyan-900/30 rounded px-2 py-1.5">
    <div className={`text-base font-bold leading-none ${accent}`}>{value}</div>
    <div className="text-[9px] uppercase tracking-widest text-gray-500 mt-1">
      {label}
    </div>
  </div>
);

const TodayStrip: React.FC<{ today: TodayStats }> = ({ today }) => {
  const trackerDomainCount = Object.keys(today.trackerDomains).length;
  const trackersValue =
    trackerDomainCount > 0 ? trackerDomainCount : today.trackersDetected;
  return (
    <div className="grid grid-cols-3 text-center border-b border-cyan-900/40 bg-black/40">
      <TodayCell
        label={t('todayTrackers', 'Trackers today')}
        value={trackersValue}
        accent="text-sky-400"
      />
      <TodayCell
        label={t('todayBlocked', 'Blocked today')}
        value={today.blockedConnections}
        accent="text-red-400"
      />
      <TodayCell
        label={t('todayCompanies', 'Companies')}
        value={today.companiesDetected.length}
        accent="text-emerald-400"
      />
    </div>
  );
};

const TodayCell: React.FC<{ label: string; value: number; accent: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="py-1.5 border-r border-cyan-900/30 last:border-r-0">
    <div className={`text-sm font-bold ${accent}`}>{value}</div>
    <div className="text-[9px] uppercase tracking-widest text-gray-500">{label}</div>
  </div>
);

const RISK_ORDER: Record<RiskLevel, number> = {
  dangerous: 0,
  suspicious: 1,
  tracker: 2,
  safe: 3,
};

const Toolbar: React.FC<{
  filter: RiskLevel | null;
  onFilterChange: (f: RiskLevel | null) => void;
  groupBy: GroupBy;
  onGroupByChange: (g: GroupBy) => void;
  counts: Record<RiskLevel, number>;
  total: number;
}> = ({ filter, onFilterChange, groupBy, onGroupByChange, counts, total }) => {
  const chips: Array<{ key: RiskLevel | null; label: string; count: number }> = [
    { key: null, label: t('filterAll', 'All'), count: total },
    { key: 'dangerous', label: t('filterDangerShort', 'Danger'), count: counts.dangerous },
    { key: 'suspicious', label: t('filterSuspicShort', 'Suspic'), count: counts.suspicious },
    { key: 'tracker', label: t('filterTrackerShort', 'Tracker'), count: counts.tracker },
    { key: 'safe', label: t('filterSafeShort', 'Safe'), count: counts.safe },
  ];
  return (
    <div className="border-b border-cyan-900/20 bg-black/40">
      <div className="flex flex-wrap gap-1 px-2 pt-2">
        {chips.map((c) => {
          const active = filter === c.key;
          const disabled = c.key !== null && c.count === 0;
          return (
            <button
              key={String(c.key)}
              disabled={disabled}
              className={`flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] border transition ${
                active
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-100 shadow-[0_0_6px_rgba(56,189,248,0.4)]'
                  : disabled
                    ? 'bg-gray-900/40 border-gray-800/50 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-900/50 border-cyan-900/40 text-gray-400 hover:text-gray-100 hover:border-cyan-700'
              }`}
              onClick={() => onFilterChange(active ? null : c.key)}
            >
              {c.key && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    c.key === 'dangerous'
                      ? 'bg-red-500'
                      : c.key === 'suspicious'
                        ? 'bg-amber-500'
                        : c.key === 'tracker'
                          ? 'bg-sky-500'
                          : 'bg-emerald-500'
                  }`}
                />
              )}
              <span>{c.label}</span>
              <span className={active ? 'text-cyan-300 font-bold' : 'text-gray-500 font-bold'}>
                {c.count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 mt-1">
        <div className="text-[9px] uppercase tracking-[0.2em] text-gray-500">
          {t('viewLabel', 'View')}
        </div>
        <div className="flex border border-cyan-900/40 rounded-md overflow-hidden text-[9px] uppercase tracking-wider">
          <button
            className={`px-2 py-0.5 transition ${
              groupBy === 'domain'
                ? 'bg-cyan-500/20 text-cyan-200'
                : 'text-gray-500 hover:text-gray-200 hover:bg-cyan-900/20'
            }`}
            onClick={() => onGroupByChange('domain')}
          >
            {t('groupDomains', 'Domains')}
          </button>
          <button
            className={`px-2 py-0.5 border-l border-cyan-900/40 transition ${
              groupBy === 'company'
                ? 'bg-cyan-500/20 text-cyan-200'
                : 'text-gray-500 hover:text-gray-200 hover:bg-cyan-900/20'
            }`}
            onClick={() => onGroupByChange('company')}
          >
            {t('groupCompanies', 'Companies')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CompanyGroup {
  company: string;
  domains: Connection[];
  requests: number;
  topRisk: RiskLevel;
}

function groupByCompany(connections: Connection[]): CompanyGroup[] {
  const map = new Map<string, Connection[]>();
  for (const c of connections) {
    const key = c.company ?? '(unknown)';
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([company, arr]) => ({
      company,
      domains: arr,
      requests: arr.reduce((s, c) => s + c.count, 0),
      topRisk: arr.reduce<RiskLevel>(
        (top, c) => (RISK_ORDER[c.riskLevel] < RISK_ORDER[top] ? c.riskLevel : top),
        'safe',
      ),
    }))
    .sort(
      (a, b) =>
        RISK_ORDER[a.topRisk] - RISK_ORDER[b.topRisk] || b.requests - a.requests,
    );
}

const ConnectionList: React.FC<{
  connections: Connection[];
  groupBy: GroupBy;
  onSelect: (domain: string) => void;
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
}> = ({ connections, groupBy, onSelect, onBlock, onUnblock }) => {
  if (connections.length === 0) {
    return (
      <div className="max-h-[280px] py-10 text-gray-500 text-center">
        <div className="text-2xl mb-2 opacity-60">📡</div>
        <div className="text-[11px] tracking-wide">
          {t('noMatchingConnections', 'No matching connections.')}
        </div>
      </div>
    );
  }

  if (groupBy === 'company') {
    const groups = groupByCompany(connections);
    return (
      <div className="max-h-[280px] overflow-y-auto">
        {groups.map((g) => (
          <CompanyGroupRow key={g.company} group={g} />
        ))}
      </div>
    );
  }

  return (
    <div className="max-h-[280px] overflow-y-auto">
      {connections.map((conn) => (
        <ConnectionRow
          key={conn.domain}
          connection={conn}
          onSelect={onSelect}
          onBlock={onBlock}
          onUnblock={onUnblock}
        />
      ))}
    </div>
  );
};

const CompanyGroupRow: React.FC<{ group: CompanyGroup }> = ({ group }) => {
  const representativeCountry =
    group.domains.find((d) => d.country)?.country ?? null;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border-b border-cyan-900/20 ${
        group.topRisk === 'dangerous' ? 'bg-red-950/20' : ''
      }`}
    >
      <div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${RISK_DOT[group.topRisk]}`}
      />
      <Flag code={representativeCountry} size={12} />
      <div className="flex-1 min-w-0">
        <div className="truncate text-gray-100 text-[12px] font-bold">
          {group.company}
        </div>
        <div className="text-gray-500 text-[10px]">
          {group.domains.length === 1
            ? t('groupDomainCountOne', '1 domain')
            : t('groupDomainCount', `${group.domains.length} domains`, String(group.domains.length))}
        </div>
      </div>
      <div className="text-gray-400 text-[11px] tabular-nums flex-shrink-0">
        {group.requests}×
      </div>
    </div>
  );
};

const CountryBadge: React.FC<{ code: string | null }> = ({ code }) => (
  <span
    className={`inline-flex items-center justify-center min-w-[26px] h-4 px-1 rounded font-mono text-[9px] font-bold tracking-wider ${
      code
        ? 'bg-cyan-900/40 border border-cyan-800/60 text-cyan-200'
        : 'bg-gray-800/60 border border-gray-700/50 text-gray-500'
    }`}
  >
    {code?.toUpperCase() ?? '—'}
  </span>
);

const ConnectionRow: React.FC<{
  connection: Connection;
  onSelect: (domain: string) => void;
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
}> = ({ connection, onSelect, onBlock, onUnblock }) => (
  <div
    className={`group flex items-center gap-2 px-3 py-1.5 border-b border-cyan-900/20 hover:bg-cyan-900/15 cursor-pointer transition ${
      connection.isBlocked ? 'opacity-40' : ''
    }`}
    onClick={() => onSelect(connection.domain)}
  >
    <div
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${RISK_DOT[connection.riskLevel]}`}
    />
    <CountryBadge code={connection.country} />
    <div className="flex-1 min-w-0">
      <div className="truncate text-gray-100 font-mono text-[11px]">
        {connection.domain}
      </div>
      {(connection.company || connection.category || connection.countryName) && (
        <div className="text-gray-500 text-[10px] flex items-center gap-1 min-w-0">
          {connection.company && (
            <span className="truncate">{connection.company}</span>
          )}
          {connection.company && connection.category && (
            <span className="text-gray-700">·</span>
          )}
          {connection.category && (
            <span className="truncate">{connection.category}</span>
          )}
          {(connection.company || connection.category) && connection.countryName && (
            <span className="text-gray-700">·</span>
          )}
          {connection.countryName && (
            <>
              <Flag code={connection.country} size={11} />
              <span className="truncate">{connection.countryName}</span>
            </>
          )}
        </div>
      )}
    </div>
    <div className="text-gray-500 text-[10px] tabular-nums flex-shrink-0">
      {connection.count}×
    </div>
    <button
      className={`flex-shrink-0 px-1.5 h-5 rounded text-[9px] font-bold uppercase tracking-wider transition ${
        connection.isBlocked
          ? 'bg-gray-700/60 text-gray-300 hover:bg-gray-600'
          : 'bg-red-900/30 text-red-300 border border-red-800/50 hover:bg-red-900/60 hover:border-red-500'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (connection.isBlocked) onUnblock(connection.domain);
        else onBlock(connection.domain);
      }}
    >
      {connection.isBlocked ? t('unblock', 'unblock') : t('block', 'block')}
    </button>
  </div>
);

const ConnectionDetail: React.FC<{
  connection: Connection;
  onBack: () => void;
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
}> = ({ connection, onBack, onBlock, onUnblock }) => (
  <div className="p-3">
    <button
      className="text-cyan-400 hover:text-cyan-200 text-[11px] mb-3 tracking-wide"
      onClick={onBack}
    >
      ← {t('backToList', 'Back to list')}
    </button>

    <div
      className={`p-3 rounded border ${RISK_BORDER[connection.riskLevel]} bg-black/40 mb-3`}
    >
      <div className="flex items-start gap-2 mb-3">
        <CountryBadge code={connection.country} />
        <div className="min-w-0 flex-1">
          <div className="text-white font-mono text-[12px] break-all leading-tight">
            {connection.domain}
          </div>
          <div
            className={`text-[10px] tracking-[0.2em] font-bold mt-1 ${RISK_TEXT[connection.riskLevel]}`}
          >
            ● {riskLabelUpperPopup(connection.riskLevel)}
          </div>
        </div>
      </div>
      <div className="space-y-1 text-[11px] pt-2 border-t border-cyan-900/30">
        {connection.company && (
          <Row label={t('detailCompany', 'Company')} value={connection.company} />
        )}
        {connection.category && (
          <Row label={t('detailCategory', 'Category')} value={connection.category} />
        )}
        {connection.countryName && (
          <div className="flex justify-between gap-3 items-center">
            <span className="text-gray-500 uppercase text-[9px] tracking-widest pt-0.5">
              {t('detailLocation', 'Location')}
            </span>
            <span className="text-gray-200 truncate flex items-center gap-1.5">
              <Flag code={connection.country} size={12} />
              {connection.countryName}
            </span>
          </div>
        )}
        {connection.org && (
          <Row label={t('detailHostedBy', 'Hosted by')} value={connection.org} />
        )}
        {connection.isp && connection.isp !== connection.org && (
          <Row label={t('detailISP', 'ISP')} value={connection.isp} />
        )}
        {connection.asn && <Row label={t('detailASN', 'ASN')} value={connection.asn} />}
        <Row label={t('detailRequests', 'Requests')} value={`${connection.count}×`} />
        <Row
          label={t('detailFirstSeen', 'First seen')}
          value={new Date(connection.firstSeen).toLocaleTimeString()}
        />
      </div>
    </div>

    <div className="bg-black/40 border border-cyan-900/30 rounded p-2.5 text-[11px] text-gray-300 leading-relaxed">
      {RISK_EXPLAIN[connection.riskLevel]}
    </div>

    <button
      className={`w-full py-2.5 rounded text-xs font-bold uppercase tracking-wider mt-3 transition ${
        connection.isBlocked
          ? 'bg-gray-700 text-gray-100 hover:bg-gray-600'
          : 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
      }`}
      onClick={() => {
        if (connection.isBlocked) onUnblock(connection.domain);
        else onBlock(connection.domain);
      }}
    >
      {connection.isBlocked
        ? `✓ ${t('unblockThisDomain', 'Unblock this domain')}`
        : `🚫 ${t('blockThisDomain', 'Block this domain')}`}
    </button>
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <span className="text-gray-500 uppercase text-[9px] tracking-widest pt-0.5">
      {label}
    </span>
    <span className="text-gray-200 truncate">{value}</span>
  </div>
);

const SettingsPanel: React.FC<{
  settings: Settings;
  onChange: (s: Settings) => void;
  onUnblock: (domain: string) => void;
  onDisallow: (domain: string) => void;
}> = ({ settings, onChange, onUnblock, onDisallow }) => {
  function toggle<K extends keyof Settings>(key: K, value: Settings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function toggleCategory(key: keyof Settings['blockCategories']) {
    onChange({
      ...settings,
      blockCategories: {
        ...settings.blockCategories,
        [key]: !settings.blockCategories[key],
      },
    });
  }

  const blockedDomains = [...settings.customBlockList].sort();
  const allowedDomains = [...settings.customWhiteList].sort();

  return (
    <div className="p-3 space-y-1">
      <SectionLabel>{t('settingsGeneral', 'General')}</SectionLabel>
      <ToggleRow
        label={t('settingsNotifications', 'Notifications')}
        description={t('settingsNotificationsDesc', 'Notify when dangerous traffic is detected')}
        checked={settings.notificationsEnabled}
        onChange={(v) => toggle('notificationsEnabled', v)}
      />

      <SectionLabel>{t('settingsBlockCategories', 'Block categories')}</SectionLabel>
      <ToggleRow
        label={t('settingsMalware', 'Malware / Phishing')}
        description={t('settingsMalwareDesc', 'Known malware & phishing (recommended)')}
        checked={settings.blockCategories.malware}
        onChange={() => toggleCategory('malware')}
      />
      <ToggleRow
        label={t('settingsAdvertising', 'Advertising')}
        description={t('settingsAdvertisingDesc', 'Advertising domains')}
        checked={settings.blockCategories.advertising}
        onChange={() => toggleCategory('advertising')}
      />
      <ToggleRow
        label={t('settingsTracking', 'Tracking')}
        description={t('settingsTrackingDesc', 'Tracking & analytics domains')}
        checked={settings.blockCategories.tracking}
        onChange={() => toggleCategory('tracking')}
      />

      <div className="pt-3 mt-2 border-t border-cyan-900/30">
        <div className="flex items-center justify-between text-[10px] tracking-wide mb-1.5">
          <span className="uppercase text-gray-500">
            {t('settingsCustomBlocklist', 'Custom blocklist')}
          </span>
          <span className="text-cyan-300 font-bold">
            {blockedDomains.length === 0
              ? '0'
              : blockedDomains.length === 1
                ? t('settingsBlocklistCountOne', '1 domain')
                : t('settingsBlocklistCountMany', `${blockedDomains.length} domains`, String(blockedDomains.length))}
          </span>
        </div>
        {blockedDomains.length === 0 ? (
          <div className="text-[10px] text-gray-600 py-2">
            {t('settingsBlocklistEmpty', 'No blocked domains')}
          </div>
        ) : (
          <div className="max-h-[180px] overflow-y-auto border border-cyan-900/30 rounded bg-black/30">
            {blockedDomains.map((domain) => (
              <div
                key={domain}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-cyan-900/20 last:border-b-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <div className="flex-1 min-w-0 truncate text-gray-100 font-mono text-[11px]">
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
          </div>
        )}
      </div>

      <div className="pt-3 mt-2 border-t border-cyan-900/30">
        <div className="flex items-center justify-between text-[10px] tracking-wide mb-1.5">
          <span className="uppercase text-gray-500">
            {t('settingsCustomAllowlist', 'Custom allowlist')}
          </span>
          <span className="text-emerald-300 font-bold">
            {allowedDomains.length === 0
              ? '0'
              : allowedDomains.length === 1
                ? t('settingsAllowlistCountOne', '1 domain')
                : t('settingsAllowlistCountMany', `${allowedDomains.length} domains`, String(allowedDomains.length))}
          </span>
        </div>
        <div className="text-[10px] text-gray-500 pb-1">
          {t(
            'settingsAllowlistHint',
            'Domains added here bypass all blocking rules, even malware.',
          )}
        </div>
        {allowedDomains.length === 0 ? (
          <div className="text-[10px] text-gray-600 py-2">
            {t('settingsAllowlistEmpty', 'No allowed domains')}
          </div>
        ) : (
          <div className="max-h-[180px] overflow-y-auto border border-emerald-900/30 rounded bg-black/30">
            {allowedDomains.map((domain) => (
              <div
                key={domain}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-emerald-900/20 last:border-b-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0 truncate text-gray-100 font-mono text-[11px]">
                  {domain}
                </div>
                <button
                  className="flex-shrink-0 px-2 h-5 rounded text-[9px] font-bold uppercase tracking-wider bg-gray-700/60 text-gray-200 hover:bg-gray-600 transition"
                  onClick={() => onDisallow(domain)}
                >
                  {t('remove', 'remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt-2 pb-1 text-[9px] uppercase tracking-[0.25em] text-cyan-500">
    {children}
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex items-center justify-between gap-3 py-2 cursor-pointer border-b border-cyan-900/20 last:border-b-0">
    <div className="min-w-0">
      <div className="text-gray-100">{label}</div>
      {description && (
        <div className="text-gray-500 text-[10px]">{description}</div>
      )}
    </div>
    <div
      className={`w-9 h-5 rounded-full transition relative flex-shrink-0 ${
        checked
          ? 'bg-cyan-500 shadow-[0_0_8px_rgba(56,189,248,0.6)]'
          : 'bg-gray-800 border border-gray-700'
      }`}
      onClick={() => onChange(!checked)}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </div>
    <input type="checkbox" className="hidden" checked={checked} readOnly />
  </label>
);

const Footer: React.FC<{ stats: PageStats | null }> = ({ stats }) => (
  <div className="px-3 py-1.5 bg-black/60 border-t border-cyan-900/40 flex items-center justify-between text-[9px] uppercase tracking-[0.2em]">
    <div className="text-gray-600">Zevr Guard v1.0</div>
    {stats && (
      <div className="text-cyan-700 tabular-nums">
        {new Date(stats.lastUpdated).toLocaleTimeString()}
      </div>
    )}
  </div>
);
