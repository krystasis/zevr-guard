import { openLiveGlobe, IS_GECKO } from '../shared/compat';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppIcon, BrandMark } from '../shared/AppIcon';
import { TechBackground } from '../shared/TechBackground';
import {
  t,
  loadLocale,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type Locale,
} from '../shared/i18n';
import { useLocale } from '../shared/useLocale';
import '../styles/tailwind.css';

function openSidePanel() {
  // Synchronous: Firefox's sidebarAction.open() only works inside the click
  // gesture, which an await here would break.
  try {
    openLiveGlobe();
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
      <HostPermissionCard />
      <PinHint />
      <Hero />
      <FeatureSection />
      <WatchSetupSection />
      <CredibilitySection />
      <Footer />
    </div>
  );
};

// Firefox treats MV3 host permissions as optional: without them the
// connection monitor sees nothing. Chromium grants them at install, so
// permissions.contains() is true there and the card never renders.
const HostPermissionCard: React.FC = () => {
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const granted = await chrome.permissions.contains({
          origins: ['<all_urls>'],
        });
        if (mounted) setMissing(!granted);
      } catch {
        // API unavailable — assume granted rather than nag
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  if (!missing) return null;
  const request = async () => {
    try {
      const granted = await chrome.permissions.request({
        origins: ['<all_urls>'],
      });
      if (granted) setMissing(false);
    } catch {
      // ignore
    }
  };
  return (
    <div className="fixed top-16 left-4 z-50 w-80 rounded-xl border border-amber-500/60 bg-black/85 backdrop-blur p-4 shadow-[0_8px_40px_-8px_rgba(245,158,11,0.45)]">
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none" aria-hidden="true">
          🛡️
        </span>
        <div>
          <div className="text-sm font-bold text-white leading-snug">
            {t('hostPermTitle', 'Turn on full protection')}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
            {t(
              'hostPermDesc',
              'Your browser asks separately for access to website data. Zevr Guard needs it to see and block connections — everything stays on your device.',
            )}
          </p>
          <button
            className="mt-3 rounded-full bg-amber-400 hover:bg-amber-300 px-4 py-1.5 text-xs font-bold text-black transition"
            onClick={request}
          >
            {t('hostPermGrant', 'Grant access')}
          </button>
        </div>
      </div>
    </div>
  );
};

const PIN_HINT_DISMISSED = 'zg.pinHintDismissed';

const PinHint: React.FC = () => {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      // Firefox: the puzzle-menu flow doesn't apply and getUserSettings is
      // unavailable, so there's no reliable pin state to nudge on — skip it.
      if (IS_GECKO) return;
      try {
        const store = await chrome.storage.local.get(PIN_HINT_DISMISSED);
        if (store[PIN_HINT_DISMISSED]) return;
        // Only nudge users whose icon is still buried in the puzzle menu.
        const settings = await chrome.action.getUserSettings();
        if (mounted) setVisible(!settings.isOnToolbar);
      } catch {
        // Can't determine the state — don't nag.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const dismiss = () => {
    setVisible(false);
    // Persist so it stays dismissed across future opens of this page.
    void chrome.storage.local.set({ [PIN_HINT_DISMISSED]: true });
  };
  if (!visible) return null;
  return (
    <div className="fixed top-16 right-4 z-50 w-72 rounded-xl border border-cyan-500/50 bg-black/85 backdrop-blur p-4 shadow-[0_8px_40px_-8px_rgba(56,189,248,0.45)]">
      <div className="absolute -top-5 right-8 text-cyan-300 text-lg animate-bounce-slow" aria-hidden="true">
        ↑
      </div>
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none" aria-hidden="true">
          📌
        </span>
        <div>
          <div className="text-sm font-bold text-white leading-snug">
            {t('pinHintTitle', 'Pin Zevr Guard to your toolbar')}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
            {t(
              'pinHintDesc',
              'Click the puzzle icon above, then the pin next to Zevr Guard. Your protection stays one glance away.',
            )}
          </p>
          <button
            className="mt-3 rounded-full border border-cyan-600/60 hover:border-cyan-400/80 px-4 py-1.5 text-xs font-bold text-cyan-200 transition"
            onClick={dismiss}
          >
            {t('pinHintGotIt', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
};

const LanguageSwitcher: React.FC = () => {
  const [locale, setLocale] = useLocale();
  return (
    <label className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-full border border-cyan-900/50 bg-black/70 backdrop-blur pl-3 pr-2 py-1.5 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)] cursor-pointer hover:border-cyan-600/60 transition">
      <span aria-hidden="true">🌐</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t('languageSwitchLabel', 'Language')}
        className="bg-transparent text-gray-200 text-xs font-mono tracking-wide outline-none cursor-pointer [&>option]:bg-gray-900"
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
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
      {/* inline-block: wrap the accent phrase as a unit instead of mid-phrase */}
      <span className="text-cyan-300 inline-block">
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
        className="group relative inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-full transition shadow-[0_0_24px_rgba(56,189,248,0.5)] hover:shadow-[0_0_36px_rgba(56,189,248,0.8)]"
        onClick={openSidePanel}
      >
        {/* inline SVG: emoji glyphs render inconsistently on the cyan fill */}
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
        </svg>
        {t('ctaOpenGlobe', 'Open Live Globe')}
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
            {t('fourLayersTitle', 'Five layers of protection')}
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
          accent="violet"
          index="02"
          title={t('featureLookalikeTitle', 'Catch lookalike phishing')}
          desc={t(
            'featureLookalikeDesc',
            'Fake domains that imitate real brands — examp1e.com, exаmple.com — are caught by on-device analysis, before they reach any blocklist.',
          )}
        />
        <FeatureCard
          accent="sky"
          index="03"
          title={t('feature2Title', 'See every tracker')}
          desc={t(
            'feature2Desc',
            'A 115,000+ tracker-signal database identifies which companies reach your browser, how often, and from where.',
          )}
        />
        <FeatureCard
          accent="amber"
          index="04"
          title={t('feature3Title', 'Warn on suspicious')}
          desc={t(
            'feature3Desc',
            "Ads, analytics, and fingerprinting domains are highlighted by color. See each page's tracking density in real time.",
          )}
        />
        <FeatureCard
          accent="emerald"
          index="05"
          wide
          title={t('feature4Title', 'Local matching. Your URLs never leave.')}
          desc={t(
            'feature4Desc',
            'Threat databases and map assets are bundled locally. No external servers, no data collection. Works offline.',
          )}
        />
      </div>

      <div className="mt-10 text-center">
        <div className="text-[10px] uppercase tracking-[0.35em] text-gray-400 mb-4">
          {t('welcomeAlsoTitle', 'Also included')}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {[
            ['🌍', t('welcomeAlsoCountry', 'One-tap country blocking')],
            ['🔑', t('welcomeAlsoPw', 'Password-entry guard')],
            ['📤', t('welcomeAlsoShare', '1-click share card')],
            ['📊', t('welcomeAlsoReport', 'Weekly protection report')],
            ['⏸️', t('welcomeAlsoPause', 'Per-site pause')],
            [
              '🌍',
              t(
                'welcomeAlsoLangs',
                `Available in ${SUPPORTED_LOCALES.length} languages`,
                String(SUPPORTED_LOCALES.length),
              ),
            ],
          ].map(([icon, label]) => (
            <span
              key={label}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-cyan-800/40 bg-white/[0.03] text-xs text-gray-200"
            >
              <span>{icon}</span>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// The data-exfiltration monitor shipped buried in the popup's settings tab
// where nobody found it. Offer the 10-second setup right on the welcome
// page — it is the one feature that needs user input to be useful.
const WatchSetupSection: React.FC = () => {
  const [kind, setKind] = React.useState<'email' | 'phone' | 'custom'>('email');
  const [value, setValue] = React.useState('');
  const [items, setItems] = React.useState<Array<{ id: string; display: string }>>([]);
  const [tooShort, setTooShort] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const w = (await chrome.runtime.sendMessage({ type: 'GET_WATCH' })) as
          | { watch?: Array<{ id: string; display: string }> }
          | undefined;
        setItems(w?.watch ?? []);
      } catch {
        // background not ready — the section still renders, adding retries
      }
    })();
  }, []);

  async function add() {
    const v = value.trim();
    if (!v) return;
    const res = (await chrome.runtime.sendMessage({
      type: 'ADD_WATCH',
      kind,
      value: v,
    })) as { success?: boolean } | undefined;
    if (res?.success) {
      setValue('');
      setTooShort(false);
      const w = (await chrome.runtime.sendMessage({ type: 'GET_WATCH' })) as
        | { watch?: Array<{ id: string; display: string }> }
        | undefined;
      setItems(w?.watch ?? []);
    } else {
      setTooShort(true);
    }
  }

  return (
    <section className="relative py-20 px-6 bg-black border-t border-cyan-900/30">
      <div className="max-w-3xl mx-auto">
        <div className="relative p-8 rounded-2xl border border-violet-800/40 bg-gradient-to-br from-violet-500/10 to-transparent overflow-hidden">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-25 bg-violet-500" />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-[0.35em] font-bold text-violet-400 mb-2">
              {t('welcomeWatchTagline', 'Optional · 10-second setup · stays on this device')}
            </div>
            <h2 className="text-white font-bold text-2xl mb-2 [word-break:keep-all]">
              {t('watchTitle', 'Watch your info')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-5 max-w-xl">
              {t(
                'watchDesc',
                'Warns you when your email, phone, or any value you add is sent to another site — even hashed. All matching stays on your device.',
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="bg-black/50 border border-violet-800/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-500/70"
              >
                <option value="email">{t('watchKindEmail', 'Email')}</option>
                <option value="phone">{t('watchKindPhone', 'Phone')}</option>
                <option value="custom">{t('watchKindCustom', 'Custom')}</option>
              </select>
              <input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTooShort(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder={t('watchPlaceholder', 'value to watch for')}
                className="flex-1 min-w-[220px] bg-black/50 border border-violet-800/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500/70"
              />
              <button
                onClick={() => void add()}
                className="px-5 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-black text-sm font-bold transition"
              >
                {t('watchAdd', 'Add')}
              </button>
            </div>
            {tooShort && (
              <div className="text-xs text-red-400 mt-2">
                {t('watchTooShort', 'Too short to watch safely (5+ characters).')}
              </div>
            )}
            {items.length > 0 && (
              <div className="mt-4 space-y-1">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 text-sm">
                    <span className="text-emerald-400">✓</span>
                    <span className="font-mono text-gray-200">{it.display}</span>
                  </div>
                ))}
                <p className="text-gray-400 text-xs mt-2">
                  {t(
                    'welcomeWatchDone',
                    'Watching. You will see a red banner the moment it is sent to another site.',
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const FeatureCard: React.FC<{
  accent: 'red' | 'sky' | 'amber' | 'emerald' | 'violet';
  index: string;
  title: string;
  desc: string;
  wide?: boolean;
}> = ({ accent, index, title, desc, wide }) => {
  const accentBg = {
    red: 'from-red-500/20 to-transparent',
    sky: 'from-sky-500/20 to-transparent',
    amber: 'from-amber-500/20 to-transparent',
    emerald: 'from-emerald-500/20 to-transparent',
    violet: 'from-violet-500/20 to-transparent',
  }[accent];
  const accentBorder = {
    red: 'border-red-900/40 hover:border-red-600/60',
    sky: 'border-sky-900/40 hover:border-sky-600/60',
    amber: 'border-amber-900/40 hover:border-amber-600/60',
    emerald: 'border-emerald-900/40 hover:border-emerald-600/60',
    violet: 'border-violet-900/40 hover:border-violet-600/60',
  }[accent];
  const accentText = {
    red: 'text-red-400',
    sky: 'text-sky-400',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    violet: 'text-violet-400',
  }[accent];
  const accentBlob = {
    red: 'bg-red-500',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    violet: 'bg-violet-500',
  }[accent];
  return (
    <div
      className={`group relative p-6 rounded-lg border ${accentBorder} bg-gradient-to-br ${accentBg} backdrop-blur-sm transition overflow-hidden ${wide ? 'md:col-span-2' : ''}`}
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
      <div className="text-[10px] text-gray-300">v{chrome.runtime.getManifest().version}</div>
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
