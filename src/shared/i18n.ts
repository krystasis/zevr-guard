import enMessages from '../../_locales/en/messages.json';
import jaMessages from '../../_locales/ja/messages.json';

export type Locale = 'en' | 'ja';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'ja'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

type ChromeMessage = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};
type Dictionary = Record<string, ChromeMessage>;

const DICTIONARIES: Record<Locale, Dictionary> = {
  en: enMessages as Dictionary,
  ja: jaMessages as Dictionary,
};

const STORAGE_KEY = 'zg.locale';

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(l: Locale) => void>();

function isSupported(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function getLocale(): Locale {
  return currentLocale;
}

export async function loadLocale(): Promise<Locale> {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const stored = res[STORAGE_KEY];
    if (isSupported(stored)) {
      currentLocale = stored;
      emit();
      return currentLocale;
    }
  } catch {
    // non-extension context or storage unavailable
  }
  currentLocale = DEFAULT_LOCALE;
  emit();
  return currentLocale;
}

export async function setLocale(locale: Locale): Promise<void> {
  if (!isSupported(locale)) return;
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
        currentLocale = next;
        emit();
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
  const dict = DICTIONARIES[currentLocale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const resolved =
    resolveMessage(dict[key], subs) ??
    resolveMessage(DICTIONARIES[DEFAULT_LOCALE][key], subs);
  return resolved ?? fallback ?? key;
}
