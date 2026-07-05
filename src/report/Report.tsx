import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '../shared/AppIcon';
import { t } from '../shared/i18n';
import type { TodayStats } from '../types';

interface DayEntry {
  date: string;
  stats: TodayStats | null;
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const Report: React.FC = () => {
  const [history, setHistory] = useState<TodayStats[]>([]);
  const [today, setToday] = useState<TodayStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [histRes, todayRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_STATS_HISTORY' }).catch(() => null),
        chrome.runtime.sendMessage({ type: 'GET_TODAY_STATS' }).catch(() => null),
      ]);
      setHistory((histRes as { history?: TodayStats[] } | null)?.history ?? []);
      setToday((todayRes as { today?: TodayStats } | null)?.today ?? null);
      setLoading(false);
    })();
  }, []);

  const week: DayEntry[] = useMemo(() => {
    const byDate = new Map<string, TodayStats>();
    for (const d of history) byDate.set(d.date, d);
    if (today) byDate.set(today.date, today);
    return lastNDates(7).map((date) => ({
      date,
      stats: byDate.get(date) ?? null,
    }));
  }, [history, today]);

  const totals = useMemo(() => {
    const days = week.map((d) => d.stats).filter(Boolean) as TodayStats[];
    const companyCounts: Record<string, number> = {};
    const blockedDomains: Record<string, number> = {};
    let connections = 0;
    let blocked = 0;
    let trackers = 0;
    let dangerous = 0;
    for (const d of days) {
      connections += d.totalConnections;
      blocked += d.blockedConnections;
      trackers += Object.keys(d.trackerDomains).length || d.trackersDetected;
      dangerous += d.dangerousDetected;
      for (const [c, n] of Object.entries(d.companyCounts)) {
        companyCounts[c] = (companyCounts[c] ?? 0) + n;
      }
      for (const [dom, n] of Object.entries(d.blockedDomains)) {
        blockedDomains[dom] = (blockedDomains[dom] ?? 0) + n;
      }
    }
    const topCompanies = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const topBlocked = Object.entries(blockedDomains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return { connections, blocked, trackers, dangerous, topCompanies, topBlocked };
  }, [week]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1e2e_0%,#000_70%)] flex items-center justify-center">
        <div className="text-cyan-300 text-sm tracking-widest animate-pulse">
          {t('popupScanning', 'SCANNING...')}
        </div>
      </div>
    );
  }

  const maxBlocked = Math.max(1, ...week.map((d) => d.stats?.blockedConnections ?? 0));

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1e2e_0%,#000_70%)] text-gray-100 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="flex items-center gap-3 mb-8">
          <AppIcon size={40} className="drop-shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
          <div>
            <h1 className="font-bold tracking-[0.2em] text-xl">ZEVR GUARD</h1>
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-400">
              {t('reportSubtitle', 'Weekly protection report')}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Stat
            label={t('reportBlocked', 'Blocked')}
            value={totals.blocked}
            accent="text-red-400"
          />
          <Stat
            label={t('reportConnections', 'Connections')}
            value={totals.connections}
            accent="text-gray-100"
          />
          <Stat
            label={t('reportTrackers', 'Trackers')}
            value={totals.trackers}
            accent="text-sky-400"
          />
          <Stat
            label={t('reportDangerous', 'Dangerous')}
            value={totals.dangerous}
            accent={totals.dangerous > 0 ? 'text-red-400' : 'text-emerald-400'}
          />
        </section>

        <section className="mb-8 bg-black/40 border border-cyan-900/30 rounded-lg p-5">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-cyan-500 mb-4">
            {t('reportDailyBlocked', 'Blocked per day')}
          </h2>
          <div className="flex items-end gap-2 h-32">
            {week.map((d) => {
              const v = d.stats?.blockedConnections ?? 0;
              const h = Math.max(2, Math.round((v / maxBlocked) * 100));
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="text-[10px] text-red-300 tabular-nums">{v}</div>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-red-900/70 to-red-500/90 shadow-[0_0_8px_rgba(239,68,68,0.35)]"
                    style={{ height: `${h}%` }}
                  />
                  <div className="text-[9px] text-gray-500">{d.date.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid sm:grid-cols-2 gap-4">
          <RankList
            title={t('reportTopCompanies', 'Top watching companies')}
            entries={totals.topCompanies}
            barClass="from-sky-900/70 to-sky-500/80"
            emptyLabel={t('reportNoData', 'No data yet — browse a little first.')}
          />
          <RankList
            title={t('reportTopBlocked', 'Most blocked domains')}
            entries={totals.topBlocked}
            barClass="from-red-900/70 to-red-500/80"
            emptyLabel={t('reportNoData', 'No data yet — browse a little first.')}
            mono
          />
        </div>

        <footer className="mt-10 text-center text-[10px] uppercase tracking-[0.25em] text-gray-600">
          {t('reportFooter', 'All data is stored locally on this device.')}
        </footer>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; accent: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="bg-black/40 border border-cyan-900/30 rounded-lg px-4 py-4 text-center">
    <div className={`text-3xl font-black tabular-nums ${accent}`}>
      {value.toLocaleString()}
    </div>
    <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mt-1.5">
      {label}
    </div>
  </div>
);

const RankList: React.FC<{
  title: string;
  entries: Array<[string, number]>;
  barClass: string;
  emptyLabel: string;
  mono?: boolean;
}> = ({ title, entries, barClass, emptyLabel, mono }) => {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <section className="bg-black/40 border border-cyan-900/30 rounded-lg p-5">
      <h2 className="text-[11px] uppercase tracking-[0.25em] text-cyan-500 mb-4">
        {title}
      </h2>
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-600 py-4">{emptyLabel}</div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(([name, n]) => (
            <div key={name}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className={`truncate text-gray-200 ${mono ? 'font-mono' : ''}`}>
                  {name}
                </span>
                <span className="text-gray-400 tabular-nums ml-3">{n}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800/80 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${barClass}`}
                  style={{ width: `${Math.max(3, Math.round((n / max) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
