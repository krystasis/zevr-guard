import '../shared/compat';
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AppIcon } from '../shared/AppIcon';
import { t, loadLocale } from '../shared/i18n';
import { useLocale } from '../shared/useLocale';
import '../styles/tailwind.css';

const params = new URLSearchParams(window.location.search);
const blocked = params.get('blocked') ?? 'unknown-domain';
const isLookalike = params.get('reason') === 'lookalike';
const isCountry = params.get('reason') === 'country';
const brand = params.get('brand') ?? '';
const countryCode = params.get('country') ?? '';

function countryDisplayName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

// Anyone can deep-link this page with arbitrary params (it is
// web-accessible), so only ever resume to a plain http(s) URL.
function safeTargetUrl(): string | null {
  const raw = params.get('url');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

// This page is web-accessible, so a hostile site could iframe it and try to
// clickjack the state-changing buttons (unblock a country, report+block a
// domain, proceed past a lookalike). Refuse to act when we are not the top
// frame — the buttons still render but do nothing, and the entry point below
// shows a plain notice instead.
const isFramed = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true; // cross-origin access threw — we are framed
  }
})();

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.close();
}

async function proceedAnyway() {
  const target = safeTargetUrl();
  if (!target) return;
  try {
    await chrome.runtime.sendMessage({ type: 'BYPASS_LOOKALIKE', host: blocked });
  } catch {
    // background not reachable — still honor the user's choice
  }
  window.location.href = target;
}

const ReportButton: React.FC = () => {
  const [state, setState] = useState<'idle' | 'confirm' | 'sending' | 'done' | 'error'>('idle');
  const [alsoBlock, setAlsoBlock] = useState(true);
  async function send() {
    setState('sending');
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'REPORT_PHISHING',
        domain: blocked,
        context: brand ? `lookalike:${brand}` : 'warning-page',
        alsoBlock,
      })) as { success?: boolean } | undefined;
      setState(res?.success ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }
  if (state === 'done') {
    return (
      <div className="text-center text-emerald-300 text-xs py-2">
        ✓{' '}
        {alsoBlock
          ? t('reportPhishingDoneBlocked', 'Reported & blocked. Thank you for protecting other users!')
          : t('reportPhishingDone', 'Reported. Thank you for protecting other users!')}
      </div>
    );
  }
  return (
    <div className="text-center">
      {state === 'confirm' || state === 'sending' ? (
        <div className="text-xs text-gray-400">
          <div className="mb-2">
            {t(
              'reportPhishingConfirm',
              'Send this domain (and nothing else) to Zevr for review?',
            )}
          </div>
          <label className="flex items-center justify-center gap-2 mb-3 cursor-pointer text-gray-300">
            <input
              type="checkbox"
              checked={alsoBlock}
              onChange={(e) => setAlsoBlock(e.target.checked)}
              className="accent-cyan-500"
            />
            {t('reportPhishingAlsoBlock', 'Also block it on this device')}
          </label>
          <div className="flex justify-center gap-2">
            <button
              className="rounded-full bg-cyan-500 px-4 py-1.5 font-bold text-black transition hover:bg-cyan-400 disabled:opacity-50"
              disabled={state === 'sending'}
              onClick={() => void send()}
            >
              {state === 'sending' ? '…' : t('reportPhishingSend', 'Send report')}
            </button>
            <button
              className="rounded-full border border-white/15 px-4 py-1.5 text-gray-300 transition hover:bg-white/[0.06]"
              onClick={() => setState('idle')}
            >
              {t('reportPhishingCancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="text-xs text-cyan-400 hover:text-cyan-200 underline underline-offset-2"
          onClick={() => setState('confirm')}
        >
          🎣 {t('reportPhishingButton', 'Report as phishing — protect other users')}
        </button>
      )}
      {state === 'error' && (
        <div className="text-[11px] text-amber-300 mt-1">
          {t('reportPhishingError', "Couldn't send the report. Please try again later.")}
        </div>
      )}
    </div>
  );
};

const CountryActions: React.FC = () => {
  const [unblocked, setUnblocked] = useState(false);
  const name = countryDisplayName(countryCode);
  if (unblocked) {
    return (
      <div className="text-center text-emerald-300 text-xs py-2">
        ✓ {t('warningCountryUnblocked', 'Unblocked. Go back and reload the page.', name)}
      </div>
    );
  }
  return (
    <button
      className="w-full rounded-full border border-sky-500/40 px-5 py-2.5 text-sm font-bold text-sky-300 transition hover:bg-sky-500/10"
      onClick={() => {
        void chrome.runtime
          .sendMessage({ type: 'UNBLOCK_COUNTRY', country: countryCode })
          .then(() => setUnblocked(true));
      }}
    >
      {t('warningCountryUnblock', `Unblock ${name}`, name)}
    </button>
  );
};

// Big custom glyph instead of an emoji bolted onto the app icon: a rounded
// octagon with an exclamation, tinted per variant.
const DangerGlyph: React.FC<{ tone: 'red' | 'sky' }> = ({ tone }) => (
  <svg
    viewBox="0 0 96 96"
    className={`h-20 w-20 ${
      tone === 'red'
        ? 'text-red-500 drop-shadow-[0_0_28px_rgba(239,68,68,0.45)]'
        : 'text-sky-400 drop-shadow-[0_0_28px_rgba(56,189,248,0.4)]'
    }`}
    fill="none"
    aria-hidden
  >
    <path
      d="M33 10h30a8 8 0 0 1 5.7 2.3l15 15A8 8 0 0 1 86 33v30a8 8 0 0 1-2.3 5.7l-15 15A8 8 0 0 1 63 86H33a8 8 0 0 1-5.7-2.3l-15-15A8 8 0 0 1 10 63V33a8 8 0 0 1 2.3-5.7l15-15A8 8 0 0 1 33 10Z"
      stroke="currentColor"
      strokeWidth="5"
    />
    <path d="M48 28v26" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
    <circle cx="48" cy="67" r="4.5" fill="currentColor" />
  </svg>
);

const Warning: React.FC = () => {
  useLocale();
  const target = safeTargetUrl();
  const tone: 'red' | 'sky' = isCountry ? 'sky' : 'red';
  const title = isLookalike
    ? t('warningLookalikeTitle', 'Suspected Phishing Blocked')
    : isCountry
      ? t('warningCountryTitle', 'Blocked by Your Country Rule')
      : t('warningTitle', 'Dangerous Site Blocked');
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0507] font-sans text-gray-100">
      {/* one glow, tinted per variant */}
      <div
        className={`pointer-events-none absolute -top-1/3 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full blur-3xl ${
          tone === 'red' ? 'bg-red-600/[0.14]' : 'bg-sky-500/[0.12]'
        }`}
      />
      <div className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-10 flex items-center gap-2.5">
          <AppIcon size={20} />
          <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-gray-500">
            {t('warningSubtitle', 'Protected by Zevr Guard')}
          </span>
        </div>

        <DangerGlyph tone={tone} />

        <h1 className="mt-7 text-3xl md:text-[2.6rem] font-black leading-tight tracking-tight text-white [word-break:keep-all]">
          {title}
        </h1>

        <div className="mt-6 flex flex-col items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.2em] text-gray-600 font-mono">
            {t('warningBlockedSiteLabel', 'Zevr Guard blocked access to:')}
          </span>
          <span
            className={`inline-block max-w-full break-all rounded-full border px-4 py-1.5 font-mono text-[13px] ${
              tone === 'red'
                ? 'border-red-500/40 bg-red-500/[0.07] text-red-300'
                : 'border-sky-500/40 bg-sky-500/[0.07] text-sky-300'
            }`}
          >
            {blocked}
          </span>
          {isLookalike && brand && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-[12px]">
              <span className="text-gray-500">
                {t('warningLookalikeNotSame', 'Not the same as:')}
              </span>
              <span className="break-all rounded-full border border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-0.5 font-mono text-emerald-300">
                {brand}
              </span>
            </div>
          )}
        </div>

        <div className="mt-8 max-w-md">
          {isCountry ? (
            <>
              <p className="font-medium text-gray-200 [word-break:keep-all]">
                {t(
                  'warningCountryHeader',
                  `This site communicates from ${countryDisplayName(countryCode)}, which you chose to block.`,
                  countryDisplayName(countryCode),
                )}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-gray-500">
                {t(
                  'warningCountryDetail',
                  'You enabled country blocking for this region in Zevr Guard. Nothing is wrong with your device — this is your own rule doing its job.',
                )}
              </p>
            </>
          ) : isLookalike ? (
            <>
              <p className="font-medium text-gray-200 [word-break:keep-all]">
                {t(
                  'warningLookalikeHeader',
                  `This address imitates ${brand} but is not the real site.`,
                  brand,
                )}
              </p>
              <p className="mt-3 text-sm text-gray-500">
                {t('warningLookalikeIntro', 'Lookalike sites are typically used to:')}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-400">
                <li>{t('warningLookalikeItem1', 'Steal your password or login codes')}</li>
                <li>{t('warningLookalikeItem2', 'Capture credit card or banking details')}</li>
                <li>{t('warningLookalikeItem3', 'Deliver malware disguised as the real service')}</li>
              </ul>
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-gray-600">
                {t(
                  'warningLookalikeDetected',
                  'Detected by on-device lookalike analysis. Your URL never left this browser.',
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-gray-200 [word-break:keep-all]">
                {t(
                  'warningListHeader',
                  'This domain is listed in known malware/phishing databases.',
                )}
              </p>
              <p className="mt-3 text-sm text-gray-500">
                {t('warningListIntro', 'Visiting this site may:')}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-400">
                <li>{t('warningListItem1', 'Install malware on your device')}</li>
                <li>{t('warningListItem2', 'Steal your passwords or personal data')}</li>
                <li>{t('warningListItem3', 'Hijack your browser or accounts')}</li>
              </ul>
            </>
          )}
        </div>

        <div className="mt-9 flex w-full max-w-sm flex-col items-center gap-3">
          <button
            className="w-full rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-gray-200"
            onClick={goBack}
          >
            ← {t('warningGoBack', 'Go Back (Safe)')}
          </button>
          {isCountry && <CountryActions />}
          {isLookalike && <ReportButton />}
          {!isCountry && (
            <details className="w-full text-xs text-gray-600">
              <summary className="cursor-pointer py-1 transition hover:text-gray-300">
                {t('warningUnderstandRisk', 'I understand the risk')}
              </summary>
              {isLookalike && target ? (
                <div className="mt-2">
                  <button
                    className="w-full rounded-full border border-red-500/40 px-5 py-2.5 font-bold text-red-300 transition hover:bg-red-500/10"
                    onClick={() => void proceedAnyway()}
                  >
                    {t('warningProceedAnyway', 'Proceed anyway (not recommended)')}
                  </button>
                </div>
              ) : (
                <p className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left leading-relaxed">
                  {t(
                    'warningOverrideDetail',
                    "To proceed anyway, remove this domain from your blocklist via Zevr Guard's popup (block/unblock button), then reload.",
                  )}
                </p>
              )}
            </details>
          )}
        </div>

        <div className="mt-12 text-[10px] uppercase tracking-[0.25em] text-gray-700 font-mono">
          {t('warningFooter', 'Protected by Zevr Guard · Safe browsing for everyone')}
        </div>
      </div>
    </div>
  );
};

const FramedNotice: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center p-6 bg-gray-900 text-gray-300 text-sm">
    <div className="max-w-sm text-center">
      <div className="text-red-400 text-lg font-bold mb-2">Zevr Guard</div>
      <div>
        {t(
          'warningFramedNotice',
          'This safety page cannot be shown inside another site. Open it directly.',
        )}
      </div>
    </div>
  </div>
);

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{isFramed ? <FramedNotice /> : <Warning />}</React.StrictMode>,
  );
})();
