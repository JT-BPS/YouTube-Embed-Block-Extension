/**
 * Slides YT Fix — background service worker
 *
 * Two layers of network blocking:
 *
 * 1. Static rules (rules.json, declared in the manifest):
 *    Block youtube.googleapis.com (and any googleapis.com/youtube/ API path)
 *    for XHR/fetch/script requests whose initiator is docs.google.com. The
 *    Insert > Video dialog is a Google Picker iframe (docs.google.com/picker)
 *    and its "Search" and "By URL" tabs fetch YouTube data through that host,
 *    so blocking it makes YouTube search return nothing and URL lookups fail.
 *
 *    The Slides video player itself is an iframe at
 *    youtube.googleapis.com/embed/..., and its internal requests are
 *    initiated by that frame (not docs.google.com), so they are unaffected.
 *    sub_frame and media are deliberately NOT in the blocked resource types,
 *    and /embed/, /s/ and /iframe_api are explicitly allowed at a higher
 *    priority. This is what 1.6.0 got wrong: it blocked sub_frame too, which
 *    produced "Could not load YouTube player" for teacher embeds.
 *
 * 2. Tab-scoped session rules (this file):
 *
 *   - Docs / Sheets tabs: block YouTube embed sub-frames (smart chip preview).
 *     Slides tabs are deliberately untouched so teacher Education embeds work.
 *
 *   - YouTube top-level tabs: block requests to googlevideo.com (video data).
 *     This kills hover previews on search results, Shorts playback, and the
 *     watch-page player. Tabs whose top-level URL is docs.google.com — even
 *     when they contain a youtube.com iframe — are not affected, so teacher
 *     Education embeds in Slides continue to play.
 *
 * youtubeeducation.com is allowed in Slides (no rule applies there).
 */

const DOCS_RULE_BASE = 100000;
const YT_RULE_BASE = 200000;

function ruleIdsForTab(tabId) {
  return [DOCS_RULE_BASE + tabId, YT_RULE_BASE + tabId];
}

function classifyTab(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "docs.google.com") {
    if (
      u.pathname.startsWith("/document/") ||
      u.pathname.startsWith("/spreadsheets/")
    ) {
      return "docs-or-sheets";
    }
    return null;
  }
  if (
    u.hostname === "youtube.com" ||
    u.hostname.endsWith(".youtube.com") ||
    u.hostname === "youtube-nocookie.com" ||
    u.hostname.endsWith(".youtube-nocookie.com")
  ) {
    return "youtube";
  }
  return null;
}

function rulesForTab(tabId, url) {
  const kind = classifyTab(url);
  if (kind === "docs-or-sheets") {
    return [
      {
        id: DOCS_RULE_BASE + tabId,
        priority: 1,
        action: { type: "block" },
        condition: {
          // youtubeeducation.com included because Workspace Education routes
          // smart-chip preview content through it. Slides never gets this rule.
          requestDomains: [
            "youtube.com",
            "youtube-nocookie.com",
            "youtu.be",
            "youtubeeducation.com",
          ],
          resourceTypes: ["sub_frame", "media"],
          tabIds: [tabId],
        },
      },
    ];
  }
  if (kind === "youtube") {
    return [
      {
        id: YT_RULE_BASE + tabId,
        priority: 1,
        action: { type: "block" },
        condition: {
          // googlevideo.com is the CDN for all YouTube video/audio segments.
          // Blocking it stops hover previews, Shorts, watch-page playback,
          // and the share-dialog embed preview, all in one shot.
          requestDomains: ["googlevideo.com"],
          resourceTypes: ["media", "xmlhttprequest"],
          tabIds: [tabId],
        },
      },
    ];
  }
  return [];
}

async function syncTabRules(tabId, url) {
  const removeRuleIds = ruleIdsForTab(tabId);
  const addRules = rulesForTab(tabId, url);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules,
    });
  } catch (e) {
    console.error("YSB: updateSessionRules failed", e);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    syncTabRules(tabId, tab && tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  syncTabRules(tabId, null);
});

async function rescanAllTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://docs.google.com/*",
        "https://*.youtube.com/*",
        "https://*.youtube-nocookie.com/*",
      ],
    });
    await Promise.all(tabs.map((t) => syncTabRules(t.id, t.url)));
  } catch (e) {
    console.error("YSB: rescanAllTabs failed", e);
  }
}

chrome.runtime.onInstalled.addListener(rescanAllTabs);
chrome.runtime.onStartup.addListener(rescanAllTabs);
