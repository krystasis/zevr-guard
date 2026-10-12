import { getBlockedDomains, isStaticMalwareRuleActive, matchesDomainOrParent } from './blocking';
import { getBlockingCountry } from './country';
import { isBundledMalware, isMalware } from './risk';
import { getSettings } from './storage';

export interface BlockClassification {
  blockedByUs: boolean;
  source: 'feed' | 'manual' | 'country' | null;
  country: string | null;
}

/**
 * Which of our own rule sources blocks this domain, if any. Used to gate the
 * warning page's state-changing controls: the page is web-accessible, so a
 * hostile site could open it with ?blocked=<attacker domain> and try to get
 * the user to click "allow".
 */
export async function classifyBlock(domain: string): Promise<BlockClassification> {
  // The user's own block is checked first: when a domain they blocked by hand
  // later turns up on the feed, calling it a feed block would offer them a
  // "report this as a mistake" button for their own decision.
  const settings = await getSettings();
  if (matchesDomainOrParent(domain, new Set(settings.customBlockList))) {
    return { blockedByUs: true, source: 'manual', country: null };
  }
  if (isMalware(domain)) return { blockedByUs: true, source: 'feed', country: null };
  // Country rules are dynamic rules too, so the generic sweep below would
  // claim them as "manual" and the warning page would lose its unblock
  // button. Ask the country bookkeeping first, the way the stats path does.
  const country = await getBlockingCountry(domain);
  if (country) return { blockedByUs: true, source: 'country', country };
  const blocked = await getBlockedDomains();
  if (matchesDomainOrParent(domain, blocked)) {
    return { blockedByUs: true, source: 'manual', country: null };
  }
  // Between browser launch and the first feed sync the packaged snapshot is
  // armed again, and it can still carry a domain the live feed has since
  // dropped. Without this the warning page would tell the user we are not
  // blocking the very address we just blocked, and offer no way through.
  // The packaged ruleset only ever blocks what the packaged list carries, so
  // ask the list, not just the ruleset flag: while the ruleset is armed, any
  // other domain would otherwise pass this gate.
  if ((await isStaticMalwareRuleActive()) && isBundledMalware(domain)) {
    return { blockedByUs: true, source: 'feed', country: null };
  }
  return { blockedByUs: false, source: null, country: null };
}
