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
      className="w-full py-2 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 transition text-sm"
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

const Warning: React.FC = () => {
  useLocale();
  const target = safeTargetUrl();
  return (
  <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-red-950 via-red-900 to-gray-900">
    <div className="max-w-lg w-full bg-gray-900/80 border border-red-700 rounded-lg p-6 shadow-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <AppIcon size={56} className="drop-shadow-[0_0_12px_rgba(239,68,68,0.6)]" />
          <div className="absolute -bottom-1 -right-1 text-2xl">⚠️</div>
        </div>
        <div>
          <div className="text-red-400 text-2xl font-bold">
            {isLookalike
              ? t('warningLookalikeTitle', 'Suspected Phishing Blocked')
              : isCountry
                ? t('warningCountryTitle', 'Blocked by Your Country Rule')
                : t('warningTitle', 'Dangerous Site Blocked')}
          </div>
          <div className="text-gray-400 text-sm">
            {t('warningSubtitle', 'Protected by Zevr Guard')}
          </div>
        </div>
      </div>

      <div className="text-gray-300 mb-4">
        {t('warningBlockedSiteLabel', 'Zevr Guard blocked access to:')}
        <div className="font-mono mt-1 text-red-300 break-all bg-black/40 rounded p-2">
          {blocked}
        </div>
        {isLookalike && brand && (
          <div className="flex items-center gap-2 mt-2 text-sm">
            <span className="text-gray-500">
              {t('warningLookalikeNotSame', 'Not the same as:')}
            </span>
            <span className="font-mono text-emerald-300 bg-black/40 rounded px-2 py-0.5 break-all">
              {brand}
            </span>
          </div>
        )}
      </div>

      <div className="bg-black/30 rounded p-3 mb-6 text-sm">
        {isCountry ? (
          <>
            <div className="text-gray-200 font-bold mb-2">
              {t(
                'warningCountryHeader',
                `This site communicates from ${countryDisplayName(countryCode)}, which you chose to block.`,
                countryDisplayName(countryCode),
              )}
            </div>
            <div className="text-gray-400">
              {t(
                'warningCountryDetail',
                'You enabled country blocking for this region in Zevr Guard. Nothing is wrong with your device — this is your own rule doing its job.',
              )}
            </div>
          </>
        ) : isLookalike ? (
          <>
            <div className="text-gray-200 font-bold mb-2">
              {t(
                'warningLookalikeHeader',
                `This address imitates ${brand} but is not the real site.`,
                brand,
              )}
            </div>
            <div className="text-gray-400">
              {t('warningLookalikeIntro', 'Lookalike sites are typically used to:')}
            </div>
            <ul className="text-gray-400 list-disc list-inside mt-1 space-y-0.5">
              <li>{t('warningLookalikeItem1', 'Steal your password or login codes')}</li>
              <li>{t('warningLookalikeItem2', 'Capture credit card or banking details')}</li>
              <li>{t('warningLookalikeItem3', 'Deliver malware disguised as the real service')}</li>
            </ul>
            <div className="text-gray-500 text-xs mt-3 pt-2 border-t border-gray-800">
              {t(
                'warningLookalikeDetected',
                'Detected by on-device lookalike analysis. Your URL never left this browser.',
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-gray-200 font-bold mb-2">
              {t(
                'warningListHeader',
                'This domain is listed in known malware/phishing databases.',
              )}
            </div>
            <div className="text-gray-400">
              {t('warningListIntro', 'Visiting this site may:')}
            </div>
            <ul className="text-gray-400 list-disc list-inside mt-1 space-y-0.5">
              <li>{t('warningListItem1', 'Install malware on your device')}</li>
              <li>{t('warningListItem2', 'Steal your passwords or personal data')}</li>
              <li>{t('warningListItem3', 'Hijack your browser or accounts')}</li>
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded"
          onClick={goBack}
        >
          ← {t('warningGoBack', 'Go Back (Safe)')}
        </button>
        {isCountry && <CountryActions />}
        {!isCountry && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-300">
            {t('warningUnderstandRisk', 'I understand the risk')}
          </summary>
          {isLookalike && target ? (
            <div className="mt-2 p-2 bg-black/40 rounded">
              <button
                className="w-full py-2 rounded border border-red-800/60 text-red-300 hover:bg-red-900/40 transition font-bold"
                onClick={() => void proceedAnyway()}
              >
                {t('warningProceedAnyway', 'Proceed anyway (not recommended)')}
              </button>
            </div>
          ) : (
            <div className="mt-2 p-2 bg-black/40 rounded">
              {t(
                'warningOverrideDetail',
                "To proceed anyway, remove this domain from your blocklist via Zevr Guard's popup (block/unblock button), then reload.",
              )}
            </div>
          )}
        </details>
        )}
      </div>

      <div className="text-center text-gray-600 text-xs mt-6">
        {t('warningFooter', 'Protected by Zevr Guard · Safe browsing for everyone')}
      </div>
    </div>
  </div>
  );
};

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Warning />
    </React.StrictMode>,
  );
})();
