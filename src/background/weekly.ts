import { t, loadLocale } from '../shared/i18n';
import { getSettings, getStatsHistory, getTodayStats } from './storage';

// ---------------------------------------------------------------------------
// Weekly report notification. Once a week, if there is anything to show,
// nudge the user toward the report page — that is where the shareable weekly
// recap card lives. Skipped entirely when notifications are disabled or the
// week was empty.
// ---------------------------------------------------------------------------

const WEEKLY_ALARM = 'zg-weekly-report';
const NOTIF_PREFIX = 'zg-weekly-';

/** Next Monday at 10:00 local time. */
function nextTrigger(): number {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday
  let ahead = (8 - day) % 7;
  if (ahead === 0 && d.getTime() <= Date.now()) ahead = 7;
  d.setDate(d.getDate() + ahead);
  return d.getTime();
}

export async function initWeeklyReport(): Promise<void> {
  try {
    const existing = await chrome.alarms.get(WEEKLY_ALARM);
    if (!existing) {
      await chrome.alarms.create(WEEKLY_ALARM, {
        when: nextTrigger(),
        periodInMinutes: 7 * 24 * 60,
      });
    }
  } catch {
    // alarms unavailable — the report page still works on demand
  }
}

async function blockedLast7Days(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const history = await getStatsHistory();
  let blocked = history
    .filter((d) => d.date >= cutoffDate)
    .reduce((sum, d) => sum + d.blockedConnections, 0);
  try {
    blocked += (await getTodayStats()).blockedConnections;
  } catch {
    // today's bucket is optional here
  }
  return blocked;
}

async function notifyWeekly(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  const blocked = await blockedLast7Days();
  if (blocked <= 0) return;

  await loadLocale();
  const count = blocked.toLocaleString();
  chrome.notifications.create(`${NOTIF_PREFIX}${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
    title: t('weeklyNotifTitle', '📊 Your weekly protection report is ready'),
    message: t(
      'weeklyNotifMessage',
      `${count} requests blocked in the last 7 days. See who was watching you.`,
      count,
    ),
    buttons: [{ title: t('weeklyNotifView', 'View report') }],
    priority: 0,
  });
}

function openReport(): void {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('src/report/index.html'),
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WEEKLY_ALARM) void notifyWeekly();
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith(NOTIF_PREFIX)) openReport();
});

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id.startsWith(NOTIF_PREFIX) && buttonIndex === 0) openReport();
});
