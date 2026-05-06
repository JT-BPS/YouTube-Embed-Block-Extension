/**
 * YouTube Block — content script
 *
 * Runs on Google Docs, Sheets, and Slides.
 *
 * Behavior:
 *   - Slides: leaves Insert > Video menu visible. When the dialog opens, hides
 *     the "Search" and "By URL" tabs (YouTube entry points) and auto-switches
 *     to the Google Drive tab so users can still upload videos.
 *   - Docs / Sheets: removes any YouTube link-preview iframe (smart chip
 *     expand-to-play). The link itself stays as plain text.
 *   - Slides: leaves teacher-embedded YouTube iframes inside the slide canvas
 *     alone so YouTube Education / approved-content videos still play. Only
 *     YouTube iframes inside link-preview popups are removed.
 *   - youtubeeducation.com is always allowed.
 */

(function () {
  "use strict";

  const APP = (() => {
    const path = location.pathname;
    if (path.startsWith("/presentation")) return "slides";
    if (path.startsWith("/document")) return "docs";
    if (path.startsWith("/spreadsheets")) return "sheets";
    return null;
  })();

  if (!APP) return;

  const YOUTUBE_PATTERN =
    /https?:\/\/([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com)\b/i;
  const YOUTUBE_EDU_PATTERN = /youtubeeducation\.com/i;

  function isBlockedYouTubeUrl(url) {
    if (!url) return false;
    if (YOUTUBE_EDU_PATTERN.test(url)) return false;
    return YOUTUBE_PATTERN.test(url);
  }

  // ── On-screen notice ────────────────────────────────────────────────────────

  let noticeTimeout = null;
  function showBlockedNotice(message) {
    const text =
      message ||
      "YouTube videos are blocked by your school. Drive uploads are still allowed.";
    const existing = document.getElementById("ysb-notice");
    if (existing) {
      existing.textContent = text;
      clearTimeout(noticeTimeout);
      noticeTimeout = setTimeout(() => existing.remove(), 4000);
      return;
    }
    const notice = document.createElement("div");
    notice.id = "ysb-notice";
    notice.textContent = text;
    Object.assign(notice.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#c0392b",
      color: "#fff",
      padding: "10px 20px",
      borderRadius: "6px",
      fontFamily: "Roboto, Arial, sans-serif",
      fontSize: "14px",
      zIndex: "2147483647",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      pointerEvents: "none",
    });
    document.body.appendChild(notice);
    clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => notice.remove(), 4000);
  }

  // ── Slides: neuter Insert Video dialog ──────────────────────────────────────
  // The dialog has tabs: "Search", "By URL", "Google Drive". Hide the first two
  // and auto-select Google Drive if the user lands on a hidden tab.

  const TAB_BLOCKLIST = /^\s*(search|by url)\s*$/i;
  const TAB_DRIVE = /google drive/i;

  function neuterSlidesVideoDialog(scope) {
    const dialogs =
      scope.matches && scope.matches('[role="dialog"]')
        ? [scope]
        : scope.querySelectorAll
        ? scope.querySelectorAll('[role="dialog"]')
        : [];
    dialogs.forEach((dialog) => {
      const heading =
        dialog.getAttribute("aria-label") ||
        dialog.querySelector('[role="heading"]')?.textContent ||
        dialog.querySelector("h1, h2, h3")?.textContent ||
        "";
      if (!/insert video|video/i.test(heading)) return;

      const tabs = dialog.querySelectorAll('[role="tab"]');
      if (!tabs.length) return;

      let hidActiveTab = false;
      let driveTab = null;
      const blockedTabs = [];

      tabs.forEach((tab) => {
        const label = (
          tab.getAttribute("aria-label") ||
          tab.textContent ||
          ""
        ).trim();
        if (TAB_BLOCKLIST.test(label)) {
          tab.style.setProperty("display", "none", "important");
          tab.setAttribute("aria-hidden", "true");
          tab.setAttribute("tabindex", "-1");
          blockedTabs.push(tab);
          if (tab.getAttribute("aria-selected") === "true") {
            hidActiveTab = true;
          }
        } else if (TAB_DRIVE.test(label)) {
          driveTab = tab;
        }
      });

      if (blockedTabs.length && !dialog.dataset.ysbAnnounced) {
        dialog.dataset.ysbAnnounced = "1";
        showBlockedNotice(
          "YouTube search and URL embedding are blocked. Use Google Drive to insert an uploaded video."
        );
      }

      if (hidActiveTab && driveTab) {
        // Defer the click so Google's tab manager finishes its own handlers.
        setTimeout(() => driveTab.click(), 0);
      }

      // Defense in depth: if a YouTube tabpanel is somehow visible, replace it.
      const panels = dialog.querySelectorAll('[role="tabpanel"]');
      panels.forEach((panel) => {
        if (panel.dataset.ysbReplaced) return;
        const panelLabel = (panel.getAttribute("aria-label") || "").trim();
        const labelledById = panel.getAttribute("aria-labelledby");
        const labelledByEl = labelledById
          ? dialog.querySelector("#" + CSS.escape(labelledById))
          : null;
        const labelledByText = (labelledByEl?.textContent || "").trim();
        if (
          TAB_BLOCKLIST.test(panelLabel) ||
          TAB_BLOCKLIST.test(labelledByText)
        ) {
          panel.dataset.ysbReplaced = "1";
          panel.innerHTML = "";
          const msg = document.createElement("div");
          msg.textContent =
            "YouTube video search and URL embedding are blocked by your school. Please use the Google Drive tab to insert an uploaded video.";
          Object.assign(msg.style, {
            padding: "48px 24px",
            textAlign: "center",
            color: "#444",
            fontFamily: "Roboto, Arial, sans-serif",
            fontSize: "14px",
            lineHeight: "1.5",
          });
          panel.appendChild(msg);
        }
      });
    });
  }

  // ── Iframe handling ─────────────────────────────────────────────────────────
  // Slides:    only remove YouTube iframes inside popups (link previews).
  //            Leave iframes inside the slide canvas alone (teacher embeds).
  // Docs/Sheets: remove all YouTube iframes (smart-chip previews).

  const POPUP_ANCESTOR_SELECTOR =
    '[role="dialog"], [role="tooltip"], .docs-linkbubble-bubble, .docs-bubble, .docs-explore-card, [class*="link-preview"], [class*="linkPreview"], [class*="smart-chip"], [class*="smartChip"]';

  function handleIframe(iframe) {
    const src = iframe.src || iframe.getAttribute("src") || "";
    if (!isBlockedYouTubeUrl(src)) return;

    if (APP === "slides") {
      const inPopup = iframe.closest(POPUP_ANCESTOR_SELECTOR);
      if (inPopup) {
        iframe.remove();
        showBlockedNotice();
      }
      // else: teacher-embedded video in the slide canvas — leave alone.
    } else {
      iframe.remove();
      showBlockedNotice();
    }
  }

  function scanIframes(scope) {
    if (scope.tagName === "IFRAME") {
      handleIframe(scope);
      return;
    }
    if (scope.querySelectorAll) {
      scope.querySelectorAll("iframe").forEach(handleIframe);
    }
  }

  // ── Docs/Sheets: strip preview cards that point at YouTube ──────────────────
  // The expand-preview card may render before its iframe. Detect link previews
  // whose target URL is YouTube and remove them so the user only sees the
  // plain-text link in the document.

  function scanLinkPreviewCards(scope) {
    if (APP === "slides") return;
    const candidates = scope.querySelectorAll
      ? scope.querySelectorAll(POPUP_ANCESTOR_SELECTOR)
      : [];
    candidates.forEach((card) => {
      if (card.dataset.ysbChecked === "1") return;
      const links = card.querySelectorAll("a[href]");
      const hasYouTubeLink = Array.from(links).some((a) =>
        isBlockedYouTubeUrl(a.href)
      );
      const hasYouTubeIframe = !!card.querySelector(
        'iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="youtube-nocookie.com"], iframe[src*="ytimg.com"]'
      );
      if (hasYouTubeLink || hasYouTubeIframe) {
        card.remove();
        showBlockedNotice();
      } else {
        card.dataset.ysbChecked = "1";
      }
    });
  }

  // ── Mutation processing ─────────────────────────────────────────────────────

  function processNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (APP === "slides") {
      neuterSlidesVideoDialog(node);
    }
    scanIframes(node);
    scanLinkPreviewCards(node);
  }

  // Initial pass over what's already in the DOM
  processNode(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(processNode);
      } else if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element
      ) {
        const t = mutation.target;
        // Re-process when src/href change (iframe lazy-load) or a tabpanel becomes visible
        if (
          mutation.attributeName === "src" ||
          mutation.attributeName === "href"
        ) {
          processNode(t);
        } else if (
          mutation.attributeName === "aria-selected" ||
          mutation.attributeName === "aria-hidden"
        ) {
          const dialog = t.closest('[role="dialog"]');
          if (dialog && APP === "slides") {
            neuterSlidesVideoDialog(dialog);
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "href", "aria-selected", "aria-hidden"],
  });
})();
