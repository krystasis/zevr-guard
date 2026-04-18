import { getSettings, setSettings } from './storage';

const SUB_RESOURCES = [
  'script',
  'image',
  'xmlhttprequest',
  'sub_frame',
  'stylesheet',
  'font',
  'media',
  'websocket',
] as unknown as chrome.declarativeNetRequest.ResourceType[];

const ALL_RESOURCES = [
  'script',
  'image',
  'xmlhttprequest',
  'sub_frame',
  'stylesheet',
  'font',
  'media',
  'websocket',
  'main_frame',
] as unknown as chrome.declarativeNetRequest.ResourceType[];

const MAIN_FRAME = 'main_frame' as unknown as chrome.declarativeNetRequest.ResourceType;
const BLOCK_ACTION = 'block' as unknown as chrome.declarativeNetRequest.RuleActionType;
const REDIRECT_ACTION = 'redirect' as unknown as chrome.declarativeNetRequest.RuleActionType;
const ALLOW_ACTION = 'allow' as unknown as chrome.declarativeNetRequest.RuleActionType;

// Allow rules must beat every block/redirect/category rule, so give them
// a far higher priority than anything else dynamic or static.
const ALLOW_PRIORITY = 1000;

export async function blockDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const maxId = rules.length > 0 ? Math.max(...rules.map((r) => r.id)) : 10_000;
  const subId = maxId + 1;
  const redirectId = maxId + 2;
  const redirectPath = chrome.runtime.getURL(
    `src/warning/index.html?blocked=${encodeURIComponent(domain)}`,
  );

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: subId,
        priority: 1,
        action: { type: BLOCK_ACTION },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: SUB_RESOURCES,
        },
      },
      {
        id: redirectId,
        priority: 2,
        action: {
          type: REDIRECT_ACTION,
          redirect: { url: redirectPath },
        },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: [MAIN_FRAME],
        },
      },
    ],
    removeRuleIds: [],
  });

  const settings = await getSettings();
  if (!settings.customBlockList.includes(domain)) {
    settings.customBlockList.push(domain);
    await setSettings(settings);
  }
}

export async function unblockDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = rules
    .filter((r) => r.condition.urlFilter === `||${domain}`)
    .map((r) => r.id);

  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: removeIds,
    });
  }

  const settings = await getSettings();
  settings.customBlockList = settings.customBlockList.filter((d) => d !== domain);
  await setSettings(settings);
}

export async function getBlockedDomains(): Promise<Set<string>> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const blocked = new Set<string>();
  for (const r of rules) {
    if (r.action.type !== BLOCK_ACTION && r.action.type !== REDIRECT_ACTION) {
      continue;
    }
    const filter = r.condition.urlFilter;
    if (filter?.startsWith('||')) {
      blocked.add(filter.slice(2));
    }
  }
  return blocked;
}

export async function allowDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingAllow = rules.find(
    (r) =>
      r.action.type === ALLOW_ACTION &&
      r.condition.urlFilter === `||${domain}`,
  );
  if (existingAllow) {
    const settings = await getSettings();
    if (!settings.customWhiteList.includes(domain)) {
      settings.customWhiteList.push(domain);
      await setSettings(settings);
    }
    return;
  }

  const maxId = rules.length > 0 ? Math.max(...rules.map((r) => r.id)) : 10_000;
  const allowId = maxId + 1;

  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: allowId,
        priority: ALLOW_PRIORITY,
        action: { type: ALLOW_ACTION },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ALL_RESOURCES,
        },
      },
    ],
    removeRuleIds: [],
  });

  const settings = await getSettings();
  if (!settings.customWhiteList.includes(domain)) {
    settings.customWhiteList.push(domain);
    await setSettings(settings);
  }
}

export async function disallowDomain(domain: string): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = rules
    .filter(
      (r) =>
        r.action.type === ALLOW_ACTION &&
        r.condition.urlFilter === `||${domain}`,
    )
    .map((r) => r.id);

  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: removeIds,
    });
  }

  const settings = await getSettings();
  settings.customWhiteList = settings.customWhiteList.filter(
    (d) => d !== domain,
  );
  await setSettings(settings);
}

export async function getAllowedDomains(): Promise<Set<string>> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const allowed = new Set<string>();
  for (const r of rules) {
    if (r.action.type !== ALLOW_ACTION) continue;
    const filter = r.condition.urlFilter;
    if (filter?.startsWith('||')) {
      allowed.add(filter.slice(2));
    }
  }
  return allowed;
}
