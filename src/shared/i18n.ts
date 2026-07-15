import enMessages from '../../_locales/en/messages.json';

export type Locale =
  | 'en'
  | 'ja'
  | 'es'
  | 'pt'
  | 'de'
  | 'fr'
  | 'it'
  | 'nl'
  | 'pl'
  | 'cs'
  | 'hu'
  | 'ro'
  | 'el'
  | 'ru'
  | 'uk'
  | 'tr'
  | 'ko'
  | 'id'
  | 'ms'
  | 'th'
  | 'vi'
  | 'hi'
  | 'zh_CN'
  | 'zh_TW';

export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en',
  'ja',
  'es',
  'pt',
  'de',
  'fr',
  'it',
  'nl',
  'pl',
  'cs',
  'hu',
  'ro',
  'el',
  'ru',
  'uk',
  'tr',
  'ko',
  'id',
  'ms',
  'th',
  'vi',
  'hi',
  'zh_CN',
  'zh_TW',
] as const;
export const DEFAULT_LOCALE: Locale = 'en';

/** Native-language display names for locale pickers. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  es: 'Español',
  pt: 'Português (BR)',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  cs: 'Čeština',
  hu: 'Magyar',
  ro: 'Română',
  el: 'Ελληνικά',
  ru: 'Русский',
  uk: 'Українська',
  tr: 'Türkçe',
  ko: '한국어',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  hi: 'हिन्दी',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
};

type ChromeMessage = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};
type Dictionary = Record<string, ChromeMessage>;

const EN_DICTIONARY = enMessages as Dictionary;

// English ships in every bundle as the always-available fallback; the other
// dictionaries load on demand. With 18 locales, inlining all of them into
// every entry (popup, sidepanel, service worker, ...) would cost several
// hundred kB of parse time per cold start.
const LOCALE_LOADERS = import.meta.glob<Dictionary>(
  '../../_locales/*/messages.json',
  { import: 'default' },
);

function localeDir(locale: Locale): string {
  return locale === 'pt' ? 'pt_BR' : locale;
}

const loadedDictionaries = new Map<Locale, Dictionary>([['en', EN_DICTIONARY]]);

async function ensureDictionary(locale: Locale): Promise<void> {
  if (loadedDictionaries.has(locale)) return;
  const loader = LOCALE_LOADERS[`../../_locales/${localeDir(locale)}/messages.json`];
  if (!loader) return;
  try {
    loadedDictionaries.set(locale, await loader());
  } catch {
    // fall back to English
  }
}

const STORAGE_KEY = 'zg.locale';

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(l: Locale) => void>();

function isSupported(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

function detectLocale(): Locale {
  try {
    const ui = chrome.i18n.getUILanguage().toLowerCase();
    if (ui.startsWith('pt')) return 'pt';
    if (ui.startsWith('zh')) {
      return ui.startsWith('zh-tw') || ui.startsWith('zh-hk') || ui.startsWith('zh-mo')
        ? 'zh_TW'
        : 'zh_CN';
    }
    const base = ui.split('-')[0];
    if (isSupported(base)) return base;
  } catch {
    // non-extension context
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** BCP 47 tag for Intl APIs (date formatting etc.). */
export function bcp47(locale: Locale = currentLocale): string {
  return locale === 'pt' ? 'pt-BR' : locale.replace('_', '-');
}

export async function loadLocale(): Promise<Locale> {
  let next = detectLocale();
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const stored = res[STORAGE_KEY];
    if (isSupported(stored)) next = stored;
  } catch {
    // non-extension context or storage unavailable
  }
  await ensureDictionary(next);
  currentLocale = next;
  emit();
  return currentLocale;
}

export async function setLocale(locale: Locale): Promise<void> {
  if (!isSupported(locale)) return;
  await ensureDictionary(locale);
  currentLocale = locale;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: locale });
  } catch {
    // ignore
  }
  emit();
}

export function subscribeLocale(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  listeners.forEach((fn) => {
    try {
      fn(currentLocale);
    } catch {
      // ignore listener failure
    }
  });
}

// chrome.storage change across contexts (popup/sidepanel/welcome/warning share storage)
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const next = changes[STORAGE_KEY]?.newValue;
      if (isSupported(next) && next !== currentLocale) {
        void ensureDictionary(next).then(() => {
          currentLocale = next;
          emit();
        });
      }
    });
  }
} catch {
  // ignore
}

function resolveMessage(msg: ChromeMessage | undefined, subs: string[]): string | undefined {
  if (!msg) return undefined;
  let result = msg.message;
  if (msg.placeholders && subs.length) {
    for (const [name, ph] of Object.entries(msg.placeholders)) {
      const idxMatch = /^\$(\d+)$/.exec(ph.content);
      const value = idxMatch ? (subs[parseInt(idxMatch[1], 10) - 1] ?? '') : ph.content;
      result = result.replace(new RegExp(`\\$${name}\\$`, 'gi'), value);
    }
  } else if (subs.length) {
    subs.forEach((sub, i) => {
      result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), sub);
    });
  }
  return result;
}

export function t(key: string, fallback?: string, ...subs: string[]): string {
  const dict = loadedDictionaries.get(currentLocale) ?? EN_DICTIONARY;
  const resolved =
    resolveMessage(dict[key], subs) ?? resolveMessage(EN_DICTIONARY[key], subs);
  return resolved ?? fallback ?? key;
}
