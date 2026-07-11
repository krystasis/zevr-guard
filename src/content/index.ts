// Password-input guard. Injected into every page (and frame), but designed
// to be inert: a single passive focus listener, no DOM scanning, no timers.
// All policy decisions and localized copy come from the background — this
// script only renders what it is told.

interface PasswordContext {
  level: 'danger' | 'notice';
  title: string;
  message: string;
  dismiss: string;
}

// Dismissal is kept in-memory only. It must NOT live in page-reachable
// storage (sessionStorage) — a hostile page could pre-set the flag to
// suppress the very warning it is meant to trigger. In-memory state resets on
// reload, which for a security notice is acceptable (it simply re-appears).
//
// Dismissal is tracked per severity: dismissing a mild "first visit" notice
// must not swallow a later "danger" (plain-HTTP / lookalike) warning on the
// same page. Dismissing a danger stops further nagging entirely.
let inFlight = false;
let dismissedDanger = false;
let dismissedNotice = false;
let host: HTMLElement | null = null;
let hostLevel: 'danger' | 'notice' | null = null;

function suppressed(level: 'danger' | 'notice'): boolean {
  if (dismissedDanger) return true; // worst case already acknowledged
  return level === 'notice' && dismissedNotice;
}

function showBanner(ctx: PasswordContext): void {
  if (host) return;
  hostLevel = ctx.level;
  host = document.createElement('div');
  host.style.cssText =
    'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;';
  // Closed so a hostile page (the very phishing sites we warn about) can't
  // read or tamper with the banner contents.
  const root = host.attachShadow({ mode: 'closed' });

  const danger = ctx.level === 'danger';
  const accent = danger ? '#ef4444' : '#f59e0b';

  const card = document.createElement('div');
  card.style.cssText = [
    'display:flex;align-items:flex-start;gap:10px',
    'max-width:420px;padding:12px 14px',
    'background:#0a1420;color:#e5e7eb',
    `border:1px solid ${accent};border-radius:12px`,
    `box-shadow:0 8px 30px rgba(0,0,0,.55),0 0 14px ${danger ? 'rgba(239,68,68,.35)' : 'rgba(245,158,11,.3)'}`,
    'font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif',
  ].join(';');

  const icon = document.createElement('div');
  icon.textContent = danger ? '⚠️' : '🛡️';
  icon.style.cssText = 'font-size:18px;line-height:1.2;flex:none';

  const body = document.createElement('div');
  body.style.cssText = 'min-width:0';
  const title = document.createElement('div');
  title.textContent = ctx.title;
  title.style.cssText = `font-weight:700;color:${danger ? '#fca5a5' : '#fcd34d'}`;
  const msg = document.createElement('div');
  msg.textContent = ctx.message;
  msg.style.cssText = 'margin-top:2px;color:#9ca3af;font-size:12px';
  const brand = document.createElement('div');
  brand.textContent = 'Zevr Guard';
  brand.style.cssText =
    'margin-top:6px;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#38bdf8';
  body.append(title, msg, brand);

  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', ctx.dismiss);
  close.title = ctx.dismiss;
  close.style.cssText =
    'all:unset;cursor:pointer;flex:none;color:#6b7280;font-size:13px;padding:2px 4px;line-height:1';
  close.addEventListener('click', () => {
    if (hostLevel === 'danger') dismissedDanger = true;
    else dismissedNotice = true;
    host?.remove();
    host = null;
    hostLevel = null;
  });

  card.append(icon, body, close);
  root.append(card);
  (document.body ?? document.documentElement).append(host);
}

// --- Data-exfiltration leak banner ---------------------------------------
// Rendered when the background reports that a watched value (email/phone/…)
// was just sent to a third-party domain. Separate host from the password
// banner so both can coexist, anchored at the top-right.
interface LeakMessage {
  type: 'DATA_LEAK';
  destination: string;
  title: string;
  message: string;
  blockLabel: string;
  dismiss: string;
}

let leakHost: HTMLElement | null = null;

function showLeakBanner(m: LeakMessage): void {
  leakHost?.remove();
  leakHost = document.createElement('div');
  leakHost.style.cssText =
    'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;';
  const root = leakHost.attachShadow({ mode: 'closed' });

  const card = document.createElement('div');
  card.style.cssText = [
    'display:flex;align-items:flex-start;gap:10px',
    'max-width:400px;padding:12px 14px',
    'background:#0a1420;color:#e5e7eb',
    'border:1px solid #ef4444;border-radius:12px',
    'box-shadow:0 8px 30px rgba(0,0,0,.55),0 0 14px rgba(239,68,68,.35)',
    'font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif',
  ].join(';');

  const icon = document.createElement('div');
  icon.textContent = '🚨';
  icon.style.cssText = 'font-size:18px;line-height:1.2;flex:none';

  const body = document.createElement('div');
  body.style.cssText = 'min-width:0';
  const title = document.createElement('div');
  title.textContent = m.title;
  title.style.cssText = 'font-weight:700;color:#fca5a5';
  const msg = document.createElement('div');
  msg.textContent = m.message;
  msg.style.cssText = 'margin-top:2px;color:#cbd5e1;font-size:12px;word-break:break-word';

  const block = document.createElement('button');
  block.textContent = m.blockLabel;
  block.style.cssText =
    'all:unset;cursor:pointer;margin-top:8px;padding:5px 12px;border-radius:8px;background:#ef4444;color:#fff;font-size:12px;font-weight:700';
  block.addEventListener('click', () => {
    try {
      void chrome.runtime.sendMessage({ type: 'BLOCK_DOMAIN', domain: m.destination });
    } catch {
      // background gone — nothing else to do
    }
    leakHost?.remove();
    leakHost = null;
  });

  const brand = document.createElement('div');
  brand.textContent = 'Zevr Guard';
  brand.style.cssText =
    'margin-top:8px;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#38bdf8';
  body.append(title, msg, block, brand);

  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', m.dismiss);
  close.title = m.dismiss;
  close.style.cssText =
    'all:unset;cursor:pointer;flex:none;color:#6b7280;font-size:13px;padding:2px 4px;line-height:1';
  close.addEventListener('click', () => {
    leakHost?.remove();
    leakHost = null;
  });

  card.append(icon, body, close);
  root.append(card);
  (document.body ?? document.documentElement).append(leakHost);
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const m = message as Partial<LeakMessage>;
  if (m && m.type === 'DATA_LEAK') showLeakBanner(m as LeakMessage);
});

async function onPasswordFocus(): Promise<void> {
  if (inFlight || host || dismissedDanger) return;
  inFlight = true;
  let context: PasswordContext | null = null;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'PASSWORD_CONTEXT',
      host: location.hostname,
      isSecure: location.protocol === 'https:',
    })) as { context?: PasswordContext | null } | undefined;
    context = res?.context ?? null;
  } catch {
    // extension got reloaded — nothing to show
  } finally {
    inFlight = false;
  }
  if (context && !suppressed(context.level)) showBanner(context);
}

document.addEventListener(
  'focusin',
  (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t && t.tagName === 'INPUT' && t.type === 'password') {
      void onPasswordFocus();
    }
  },
  true,
);
