import type { Settings } from '../types';

const ADS_RULESET = 'ads_rules';
const TRACKING_RULESET = 'tracking_rules';

/**
 * Align the enabled static rulesets with the user's block-category toggles.
 * Called on startup and on every settings change.
 */
export async function syncCategoryRulesets(settings: Settings): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;

  let enabled: string[] = [];
  try {
    enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch {
    enabled = [];
  }
  const enabledSet = new Set(enabled);

  const desired = {
    [ADS_RULESET]: settings.blockCategories.advertising === true,
    [TRACKING_RULESET]: settings.blockCategories.tracking === true,
  };

  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const [id, want] of Object.entries(desired)) {
    const has = enabledSet.has(id);
    if (want && !has) enableRulesetIds.push(id);
    if (!want && has) disableRulesetIds.push(id);
  }

  if (enableRulesetIds.length === 0 && disableRulesetIds.length === 0) return;

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    });
  } catch (err) {
    console.warn(
      '[Zevr Guard] updateEnabledRulesets failed:',
      (err as Error).message,
    );
  }
}
