import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppIcon } from '../shared/AppIcon';
import { t, loadLocale } from '../shared/i18n';
import { useLocale } from '../shared/useLocale';
import '../styles/tailwind.css';

const params = new URLSearchParams(window.location.search);
const blocked = params.get('blocked') ?? 'unknown-domain';

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.close();
}

const Warning: React.FC = () => {
  useLocale();
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
            {t('warningTitle', 'Dangerous Site Blocked')}
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
      </div>

      <div className="bg-black/30 rounded p-3 mb-6 text-sm">
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
      </div>

      <div className="flex flex-col gap-2">
        <button
          className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded"
          onClick={goBack}
        >
          ← {t('warningGoBack', 'Go Back (Safe)')}
        </button>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-300">
            {t('warningUnderstandRisk', 'I understand the risk')}
          </summary>
          <div className="mt-2 p-2 bg-black/40 rounded">
            {t(
              'warningOverrideDetail',
              "To proceed anyway, remove this domain from your blocklist via Zevr Guard's popup (block/unblock button), then reload.",
            )}
          </div>
        </details>
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
