/**
 * YouTube Block — background service worker
 *
 * Adds tab-scoped declarativeNetRequest session rules that block YouTube
 * embed sub-frames in Google Docs and Google Sheets tabs. Slides tabs
 * are deliberately untouched so teacher-inserted YouTube Education /
 * approved-content videos still play.
 *
 * youtubeeducation.com is not in the blocked domain list, so it always
 * loads fine.
 */

const RULE_BASE = 100000;
const RULES_PER_TAB = 1;

function ruleIdsForTab(tabId) {
  return [RULE_BASE + tabId];
}

function rulesForTab(tabId) {
  return [
    {
      id: RULE_BASE + tabId,
      priority: 1,
      action: { type: "block" },
      condition: {
        // youtubeeducation.com is included here because the smart-chip
        // preview in Docs/Sheets routes through it for Workspace Education
        // accounts. Slides tabs never get this rule, so teacher-embedded
        // Education videos still load there.
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

function shouldBlockUrl(url) {
  if (!url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.hostname !== "docs.google.com") return false;
  return (
    u.pathname.startsWith("/document/") ||
    u.pathname.startsWith("/spreadsheets/")
  );
}

async function syncTabRules(tabId, url) {
  const removeRuleIds = ruleIdsForTab(tabId);
  const addRules = shouldBlockUrl(url) ? rulesForTab(tabId) : [];
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
  // Re-sync on every URL change so navigating between Slides and Docs
  // in the same tab toggles the rule correctly.
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
      url: ["https://docs.google.com/*"],
    });
    await Promise.all(tabs.map((t) => syncTabRules(t.id, t.url)));
  } catch (e) {
    console.error("YSB: rescanAllTabs failed", e);
  }
}

chrome.runtime.onInstalled.addListener(rescanAllTabs);
chrome.runtime.onStartup.addListener(rescanAllTabs);
