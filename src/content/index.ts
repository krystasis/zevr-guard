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

const DISMISS_KEY = 'zg.pwWarn.dismissed';

let requested = false;
let host: HTMLElement | null = null;

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // sandboxed frame — in-memory `requested` flag still prevents repeats
  }
}

function showBanner(ctx: PasswordContext): void {
  if (host) return;
  host = document.createElement('div');
  host.style.cssText =
    'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });

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
    markDismissed();
    host?.remove();
    host = null;
  });

  card.append(icon, body, close);
  root.append(card);
  (document.body ?? document.documentElement).append(host);
}

async function onPasswordFocus(): Promise<void> {
  if (requested || host || isDismissed()) return;
  requested = true;
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
  }
  if (context) showBanner(context);
  else requested = false; // context may change (e.g. settings toggled back on)
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
