/**
 * Budgets shared by the feed build and the extension that consumes it.
 *
 * These two used to be set independently — build-rules capped the malware list
 * at 2,500 while the session mirror only carried 2,400 — which was harmless
 * while the packaged static ruleset covered the whole list, and became a hole
 * the moment that ruleset was retired: the tail had no rule behind it, yet
 * isMalware() still called those domains dangerous.
 */

/**
 * How many malware domains ship in the feed and reach DNR. Each costs two
 * session rules (a main-frame redirect and a block for everything else), so
 * 2,400 * 2 = 4,800, leaving room under Chrome's 5,000-rule session budget
 * for the per-domain session allows (100) and the global pause (1).
 */
export const FEED_MAX_DOMAINS = 2400;
