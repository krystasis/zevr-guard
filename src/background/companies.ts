import { registrableDomain } from '../shared/domain';

// Curated owner map for domains whose feed entry (and every parent entry)
// says "Unknown". Keyed by registrable domain. Only widely documented
// owner/domain relationships belong here — when in doubt, leave it out and
// let the UI fall back to the root domain.
const OWNERS: Record<string, string> = {
  // Google
  'doubleclick.net': 'Google',
  'googlesyndication.com': 'Google',
  'googletagmanager.com': 'Google',
  'googletagservices.com': 'Google',
  'google-analytics.com': 'Google',
  'googleadservices.com': 'Google',
  'googleapis.com': 'Google',
  'gstatic.com': 'Google',
  'googleusercontent.com': 'Google',
  'googlevideo.com': 'Google',
  'ggpht.com': 'Google',
  'ytimg.com': 'Google',
  '2mdn.net': 'Google',
  'app-measurement.com': 'Google',
  'crashlytics.com': 'Google',
  // Meta
  'facebook.net': 'Meta',
  'fbcdn.net': 'Meta',
  // Amazon
  'amazon-adsystem.com': 'Amazon',
  'cloudfront.net': 'Amazon Web Services',
  'amazonaws.com': 'Amazon Web Services',
  // Microsoft
  'adnxs.com': 'Microsoft',
  'clarity.ms': 'Microsoft',
  'msecnd.net': 'Microsoft',
  'azureedge.net': 'Microsoft',
  'licdn.com': 'LinkedIn',
  // Adobe
  'demdex.net': 'Adobe',
  'omtrdc.net': 'Adobe',
  'everesttech.net': 'Adobe',
  'adobedtm.com': 'Adobe',
  'typekit.net': 'Adobe',
  // Oracle
  'bluekai.com': 'Oracle',
  'addthis.com': 'Oracle',
  'moatads.com': 'Oracle',
  // Salesforce
  'krxd.net': 'Salesforce',
  'pardot.com': 'Salesforce',
  // X
  'twimg.com': 'X',
  'ads-twitter.com': 'X',
  // LY Corporation (Yahoo! JAPAN / LINE)
  'yahoo.co.jp': 'LY-Corporation',
  'yimg.jp': 'LY-Corporation',
  'yjtag.jp': 'LY-Corporation',
  'line-scdn.net': 'LY-Corporation',
  'line.me': 'LY-Corporation',
  // Rakuten
  'rakuten.co.jp': 'Rakuten',
  'r10s.jp': 'Rakuten',
  // Ad tech
  'criteo.com': 'Criteo',
  'criteo.net': 'Criteo',
  'adsrvr.org': 'The Trade Desk',
  'rubiconproject.com': 'Magnite',
  'casalemedia.com': 'Index Exchange',
  'indexww.com': 'Index Exchange',
  'pubmatic.com': 'PubMatic',
  'openx.net': 'OpenX',
  'smartadserver.com': 'Equativ',
  'taboola.com': 'Taboola',
  'outbrain.com': 'Outbrain',
  'mathtag.com': 'MediaMath',
  'crwdcntrl.net': 'Lotame',
  'agkn.com': 'Neustar',
  'rlcdn.com': 'LiveRamp',
  'pippio.com': 'LiveRamp',
  'id5-sync.com': 'ID5',
  'adsafeprotected.com': 'Integral Ad Science',
  'doubleverify.com': 'DoubleVerify',
  'microad.jp': 'MicroAd',
  'fout.jp': 'FreakOut',
  'i-mobile.co.jp': 'i-mobile',
  'geniee.co.jp': 'Geniee',
  'socdm.com': 'Supership',
  'popin.cc': 'popIn',
  'logly.co.jp': 'Logly',
  'zucks.net': 'Zucks',
  'a8.net': 'A8.net',
  // Measurement / analytics
  'imrworldwide.com': 'Nielsen',
  'exelator.com': 'Nielsen',
  'scorecardresearch.com': 'Comscore',
  'quantserve.com': 'Quantcast',
  'chartbeat.com': 'Chartbeat',
  'chartbeat.net': 'Chartbeat',
  'parsely.com': 'Parse.ly',
  'mixpanel.com': 'Mixpanel',
  'amplitude.com': 'Amplitude',
  'optimizely.com': 'Optimizely',
  'fullstory.com': 'FullStory',
  'mouseflow.com': 'Mouseflow',
  'hotjar.com': 'Hotjar',
  'segment.com': 'Twilio Segment',
  'segment.io': 'Twilio Segment',
  // Monitoring
  'newrelic.com': 'New Relic',
  'nr-data.net': 'New Relic',
  'sentry.io': 'Sentry',
  'datadoghq.com': 'Datadog',
  'bugsnag.com': 'Bugsnag',
  // Consent / privacy platforms
  'privacy-mgmt.com': 'Sourcepoint',
  'onetrust.com': 'OneTrust',
  'cookielaw.org': 'OneTrust',
  // Publishing / subscriptions
  'piano.io': 'Piano',
  'cxense.com': 'Piano',
  // CDN / infrastructure
  'cloudflareinsights.com': 'Cloudflare',
  'akamaihd.net': 'Akamai',
  'akamaized.net': 'Akamai',
  'fastly.net': 'Fastly',
  'jsdelivr.net': 'jsDelivr',
  'wp.com': 'Automattic',
  'gravatar.com': 'Automattic',
  'vimeocdn.com': 'Vimeo',
  'pinimg.com': 'Pinterest',
  'sc-static.net': 'Snap',
  'tiktokcdn.com': 'TikTok',
  'yastatic.net': 'Yandex',
  'bbci.co.uk': 'BBC',
  // Support / commerce
  'intercom.io': 'Intercom',
  'intercomcdn.com': 'Intercom',
  'zdassets.com': 'Zendesk',
  'hs-scripts.com': 'HubSpot',
  'hsforms.com': 'HubSpot',
  'disquscdn.com': 'Disqus',
  'paypalobjects.com': 'PayPal',
  'stripe.network': 'Stripe',
};

/**
 * Best owner name for a connection: the DB value when it names a real
 * company, otherwise the curated map, otherwise null ("we don't know" —
 * never the literal string "Unknown").
 */
export function resolveOwner(
  domain: string,
  dbCompany: string | null | undefined,
): string | null {
  if (dbCompany && dbCompany !== 'Unknown') return dbCompany;
  return OWNERS[registrableDomain(domain)] ?? null;
}
