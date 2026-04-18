import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppIcon, BrandMark } from '../shared/AppIcon';
import { TechBackground } from '../shared/TechBackground';
import { t, loadLocale, SUPPORTED_LOCALES } from '../shared/i18n';
import { useLocale } from '../shared/useLocale';
import '../styles/tailwind.css';

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
  } catch {
    // ignore
  }
}

const Welcome: React.FC = () => {
  // re-render on locale change
  useLocale();
  return (
    <div className="min-h-screen bg-black text-gray-100 relative font-sans">
      <LanguageSwitcher />
      <Hero />
      <FeatureSection />
      <CredibilitySection />
      <Footer />
    </div>
  );
};

const LanguageSwitcher: React.FC = () => {
  const [locale, setLocale] = useLocale();
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-1 rounded-full border border-cyan-900/50 bg-black/70 backdrop-blur px-1 py-1 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)]">
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={
            'px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.25em] transition ' +
            (locale === l
              ? 'bg-cyan-500 text-black font-bold shadow-[0_0_12px_rgba(56,189,248,0.55)]'
              : 'text-gray-400 hover:text-white')
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
};

const HeroBackground: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute inset-0 opacity-[0.045]">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
    </div>

    <div className="absolute -top-1/4 -left-1/4 w-[60vw] h-[60vw] rounded-full bg-cyan-500/10 blur-3xl animate-aurora-1" />
    <div className="absolute top-1/3 -right-1/4 w-[70vw] h-[70vw] rounded-full bg-sky-600/10 blur-3xl animate-aurora-2" />
    <div className="absolute bottom-0 left-1/3 w-[50vw] h-[50vw] rounded-full bg-emerald-500/5 blur-3xl animate-aurora-3" />

    <TechBackground className="absolute inset-0 opacity-60 mix-blend-screen" />

    <div className="absolute inset-0 opacity-[0.04] bg-[repeating-linear-gradient(0deg,#38bdf8_0px,#38bdf8_1px,transparent_1px,transparent_3px)]" />

    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.55)_70%,_#000_100%)]" />
    <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-black" />
  </div>
);

const Hero: React.FC = () => (
  <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-20 overflow-hidden">
    <HeroBackground />
    <div className="relative z-10 w-full flex flex-col items-center">
    <div className="flex items-center gap-2 mb-10">
      <BrandMark size={16} />
      <span className="text-[10px] uppercase tracking-[0.4em] text-gray-200">
        {t('brandZevr', 'Zevr')}
      </span>
      <span className="text-gray-400">·</span>
      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
      <span className="text-[10px] uppercase tracking-[0.4em] text-emerald-300">
        {t('protectionActive', 'Protection active')}
      </span>
    </div>

    <div className="relative mb-10">
      <RadarRings />
      <div className="relative z-10 drop-shadow-[0_0_40px_rgba(56,189,248,0.6)]">
        <AppIcon size={132} />
      </div>
    </div>

    <h1 className="relative text-6xl md:text-8xl font-black tracking-tight mb-6 text-center leading-none">
      <span className="bg-gradient-to-b from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent">
        ZEVR
      </span>
      <span className="text-gray-500 mx-3">/</span>
      <span className="bg-gradient-to-b from-cyan-300 via-cyan-400 to-sky-600 bg-clip-text text-transparent">
        GUARD
      </span>
    </h1>

    <p className="text-xl md:text-2xl text-white text-center max-w-2xl mb-3 font-light leading-tight">
      {t('heroTagline', 'See who your browser talks to.')}{' '}
      <span className="text-cyan-300">
        {t('heroTaglineAccent', 'Block the dangerous ones.')}
      </span>
    </p>
    <p className="text-sm text-gray-200 text-center max-w-xl mb-12 leading-relaxed">
      {t(
        'heroDescription',
        'See which parts of the world your browser is reaching in real time. Dangerous connections are blocked automatically.',
      )}
    </p>

    <div className="flex flex-wrap gap-3 mb-20 justify-center">
      <button
        className="group relative px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-full transition shadow-[0_0_24px_rgba(56,189,248,0.5)] hover:shadow-[0_0_36px_rgba(56,189,248,0.8)]"
        onClick={openSidePanel}
      >
        🌐 {t('ctaOpenGlobe', 'Open Live Globe')}
      </button>
      <button
        className="px-6 py-3 border border-cyan-600/60 hover:border-cyan-400/80 text-white font-bold rounded-full transition backdrop-blur"
        onClick={() => window.close()}
      >
        {t('ctaStartBrowsing', 'Start browsing')} →
      </button>
    </div>

    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[10px] uppercase tracking-[0.3em] text-gray-200">
      <TrustItem color="bg-cyan-400" label={t('trustTrackers', '115,000+ tracker signals', '115,000+')} />
      <span className="text-gray-500">·</span>
      <TrustItem color="bg-red-400" label={t('trustUrlhaus', 'Daily threat feed')} />
      <span className="text-gray-500">·</span>
      <TrustItem color="bg-emerald-400" label={t('trust100Local', 'Local-only matching')} />
      <span className="text-gray-500">·</span>
      <TrustItem color="bg-emerald-400" label={t('trustNoTelemetry', 'No telemetry')} />
    </div>

    </div>
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-[9px] uppercase tracking-[0.3em] text-gray-300 animate-bounce-slow">
      <span>{t('scrollHint', 'Scroll')}</span>
      <span>↓</span>
    </div>
  </section>
);

const TrustItem: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-2">
    <span className={`w-1 h-1 rounded-full ${color}`} />
    {label}
  </span>
);

const RadarRings: React.FC = () => (
  <>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="absolute top-1/2 left-1/2 rounded-full border border-cyan-400/30 animate-radar-ring"
        style={{
          width: '180px',
          height: '180px',
          marginLeft: '-90px',
          marginTop: '-90px',
          animationDelay: `${i * 1000}ms`,
        }}
      />
    ))}
    <div
      className="absolute top-1/2 left-1/2 rounded-full bg-cyan-500/5 blur-2xl"
      style={{
        width: '240px',
        height: '240px',
        marginLeft: '-120px',
        marginTop: '-120px',
      }}
    />
  </>
);

const FeatureSection: React.FC = () => (
  <section className="relative py-24 px-6 bg-black">
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <div className="text-[10px] uppercase tracking-[0.35em] text-cyan-300 mb-3">
          {t('howItWorks', 'How it works')}
        </div>
        <h2 className="text-4xl md:text-5xl font-black">
          <span className="bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">
            {t('fourLayersTitle', 'Four layers of protection')}
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard
          accent="red"
          index="01"
          title={t('feature1Title', 'Auto-block malware')}
          desc={t(
            'feature1Desc',
            'Known malware and phishing domains are blocked before you notice them. Threat lists are bundled with the extension and refreshed daily.',
          )}
        />
        <FeatureCard
          accent="sky"
          index="02"
          title={t('feature2Title', 'See every tracker')}
          desc={t(
            'feature2Desc',
            'A 115,000+ tracker-signal database identifies which companies reach your browser, how often, and from where.',
          )}
        />
        <FeatureCard
          accent="amber"
          index="03"
          title={t('feature3Title', 'Warn on suspicious')}
          desc={t(
            'feature3Desc',
            "Ads, analytics, and fingerprinting domains are highlighted by color. See each page's tracking density in real time.",
          )}
        />
        <FeatureCard
          accent="emerald"
          index="04"
          title={t('feature4Title', 'Local matching. Your URLs never leave.')}
          desc={t(
            'feature4Desc',
            'Threat databases and map assets are bundled locally. No external servers, no data collection. Works offline.',
          )}
        />
      </div>
    </div>
  </section>
);

const FeatureCard: React.FC<{
  accent: 'red' | 'sky' | 'amber' | 'emerald';
  index: string;
  title: string;
  desc: string;
}> = ({ accent, index, title, desc }) => {
  const accentBg = {
    red: 'from-red-500/20 to-transparent',
    sky: 'from-sky-500/20 to-transparent',
    amber: 'from-amber-500/20 to-transparent',
    emerald: 'from-emerald-500/20 to-transparent',
  }[accent];
  const accentBorder = {
    red: 'border-red-900/40 hover:border-red-600/60',
    sky: 'border-sky-900/40 hover:border-sky-600/60',
    amber: 'border-amber-900/40 hover:border-amber-600/60',
    emerald: 'border-emerald-900/40 hover:border-emerald-600/60',
  }[accent];
  const accentText = {
    red: 'text-red-400',
    sky: 'text-sky-400',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
  }[accent];
  const accentBlob = {
    red: 'bg-red-500',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
  }[accent];
  return (
    <div
      className={`group relative p-6 rounded-lg border ${accentBorder} bg-gradient-to-br ${accentBg} backdrop-blur-sm transition overflow-hidden`}
    >
      <div
        className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-30 ${accentBlob}`}
      />
      <div className="relative">
        <div
          className={`text-[10px] uppercase tracking-[0.3em] font-bold ${accentText} mb-2`}
        >
          {index}
        </div>
        <div className="text-white font-bold text-lg mb-2">{title}</div>
        <div className="text-gray-200 text-sm leading-relaxed">{desc}</div>
      </div>
    </div>
  );
};

const CredibilitySection: React.FC = () => (
  <section className="relative py-16 px-6 border-t border-cyan-800/30 bg-black">
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-10">
        <div className="text-[10px] uppercase tracking-[0.35em] text-cyan-300 mb-3">
          {t('dataSourcesSubtitle', 'By the numbers')}
        </div>
        <h3 className="text-2xl font-bold text-white">
          {t('dataSourcesTitle', 'Quiet defense, at verifiable scale.')}
        </h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DataNumberCard
          value={t('dataByNumbers1Value', '115,000+')}
          unit={t('dataByNumbers1Unit', 'trackers')}
          label={t('dataByNumbers1Label', 'Tracker identification DB')}
        />
        <DataNumberCard
          value={t('dataByNumbers2Value', 'daily')}
          unit={t('dataByNumbers2Unit', 'updates')}
          label={t('dataByNumbers2Label', 'Threat feed refresh')}
        />
        <DataNumberCard
          value={t('dataByNumbers3Value', '244')}
          unit={t('dataByNumbers3Unit', 'countries')}
          label={t('dataByNumbers3Label', 'Geolocation coverage')}
        />
        <DataNumberCard
          value={t('dataByNumbers4Value', '100%')}
          unit={t('dataByNumbers4Unit', 'offline')}
          label={t('dataByNumbers4Label', 'Local-only matching')}
        />
      </div>
    </div>
  </section>
);

const DataNumberCard: React.FC<{
  value: string;
  unit: string;
  label: string;
}> = ({ value, unit, label }) => (
  <div className="p-4 rounded border border-cyan-700/40 bg-white/[0.03]">
    <div className="text-cyan-300 font-black text-3xl leading-none tabular-nums">
      {value}
    </div>
    <div className="text-[9px] uppercase tracking-widest text-gray-300 mt-1">{unit}</div>
    <div className="text-white text-xs mt-3 leading-relaxed">{label}</div>
  </div>
);

const Footer: React.FC = () => (
  <footer className="relative py-12 px-6 border-t border-cyan-800/30 bg-black">
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <BrandMark size={14} />
        <span className="text-[10px] uppercase tracking-[0.4em] text-gray-200">
          {t('brandZevr', 'Zevr')} · {t('brandTagline', 'The first product')}
        </span>
      </div>
      <div className="text-[10px] uppercase tracking-[0.3em] text-gray-300">
        {t('footerNetworkVisibility', 'Network visibility, instantly')}
      </div>
      <div className="text-[10px] text-gray-300">v1.0</div>
    </div>
  </footer>
);

void (async () => {
  await loadLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Welcome />
    </React.StrictMode>,
  );
})();
