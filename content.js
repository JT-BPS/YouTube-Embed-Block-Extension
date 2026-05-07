/**
 * YouTube Block — content script
 *
 * Runs on Google Docs/Sheets/Slides and on YouTube itself. Operates silently —
 * no on-screen notices are shown to students.
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
 *   - YouTube pages: hides the Share button, "Share" menu items, and removes
 *     the share dialog if it opens. This prevents students from using the
 *     Share > Embed preview to watch unrestricted video.
 */

(function () {
  "use strict";

  const HOST = location.hostname;
  const APP = (() => {
    if (HOST === "docs.google.com") {
      const path = location.pathname;
      if (path.startsWith("/presentation")) return "slides";
      if (path.startsWith("/document")) return "docs";
      if (path.startsWith("/spreadsheets")) return "sheets";
    }
    if (
      HOST === "youtube.com" ||
      HOST.endsWith(".youtube.com") ||
      HOST === "youtube-nocookie.com" ||
      HOST.endsWith(".youtube-nocookie.com")
    ) {
      return "youtube";
    }
    return null;
  })();

  if (!APP) return;

  const YOUTUBE_PATTERN =
    /https?:\/\/([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|youtubeeducation\.com)\b/i;

  function isYouTubeUrl(url) {
    if (!url) return false;
    return YOUTUBE_PATTERN.test(url);
  }

  // ── Slides: neuter Insert Video dialog ──────────────────────────────────────

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
          if (tab.getAttribute("aria-selected") === "true") {
            hidActiveTab = true;
          }
        } else if (TAB_DRIVE.test(label)) {
          driveTab = tab;
        }
      });

      if (hidActiveTab && driveTab) {
        setTimeout(() => driveTab.click(), 0);
      }

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
        }
      });
    });
  }

  // ── Docs/Sheets/Slides: iframe handling ─────────────────────────────────────

  const POPUP_ANCESTOR_SELECTOR =
    '[role="dialog"], [role="tooltip"], .docs-linkbubble-bubble, .docs-bubble, .docs-explore-card, [class*="link-preview"], [class*="linkPreview"], [class*="smart-chip"], [class*="smartChip"]';

  function handleDocsIframe(iframe) {
    const src = iframe.src || iframe.getAttribute("src") || "";
    if (!isYouTubeUrl(src)) return;

    if (APP === "slides") {
      const inPopup = iframe.closest(POPUP_ANCESTOR_SELECTOR);
      if (inPopup) iframe.remove();
    } else {
      iframe.remove();
    }
  }

  function scanDocsIframes(scope) {
    if (scope.tagName === "IFRAME") {
      handleDocsIframe(scope);
      return;
    }
    if (scope.querySelectorAll) {
      scope.querySelectorAll("iframe").forEach(handleDocsIframe);
    }
  }

  function scanLinkPreviewCards(scope) {
    if (APP === "slides") return;
    const candidates = scope.querySelectorAll
      ? scope.querySelectorAll(POPUP_ANCESTOR_SELECTOR)
      : [];
    candidates.forEach((card) => {
      if (card.dataset.ysbChecked === "1") return;
      const links = card.querySelectorAll("a[href]");
      const hasYouTubeLink = Array.from(links).some((a) =>
        isYouTubeUrl(a.href)
      );
      const hasYouTubeIframe = !!card.querySelector(
        'iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="youtube-nocookie.com"], iframe[src*="ytimg.com"], iframe[src*="youtubeeducation.com"]'
      );
      if (hasYouTubeLink || hasYouTubeIframe) {
        card.remove();
      } else {
        card.dataset.ysbChecked = "1";
      }
    });
  }

  // ── YouTube: hide Share button, menu items, and dialog ──────────────────────

  const SHARE_TEXT_PATTERN = /^\s*share\s*$/i;
  const SHARE_LABEL_PATTERN = /^\s*share(\b|$)/i;

  // CSS-based hiding for stable selectors (faster than mutation scanning).
  // Injected once per frame.
  function injectYouTubeShareCss() {
    if (document.getElementById("ysb-yt-style")) return;
    const style = document.createElement("style");
    style.id = "ysb-yt-style";
    style.textContent = `
      /* Hide standalone Share buttons (watch page, video cards) */
      ytd-button-renderer[button-renderer][is-icon-button]:has(yt-icon[icon-name="share"]),
      yt-button-shape:has([d^="M15 5.63"]),
      button[aria-label="Share" i],
      [aria-label="Share" i],
      a[aria-label="Share" i] {
        display: none !important;
      }
      /* Hide Share entries in dropdown menus */
      ytd-menu-service-item-renderer:has(yt-formatted-string:where(.ytd-menu-service-item-renderer)),
      tp-yt-paper-item:has(yt-formatted-string) {
        /* matched in JS by text below */
      }
      /* Catch the share dialog wholesale */
      ytd-unified-share-panel-renderer,
      ytd-share-dialog-renderer,
      yt-share-target-section-renderer {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function hideYouTubeShareControls(scope) {
    if (!scope.querySelectorAll) return;

    // Buttons / icon buttons with Share aria-label.
    scope.querySelectorAll("[aria-label]").forEach((el) => {
      const label = (el.getAttribute("aria-label") || "").trim();
      if (SHARE_LABEL_PATTERN.test(label)) {
        el.style.setProperty("display", "none", "important");
      }
    });

    // Menu items where the visible text is exactly "Share".
    scope
      .querySelectorAll(
        '[role="menuitem"], ytd-menu-service-item-renderer, tp-yt-paper-item, ytd-menu-navigation-item-renderer'
      )
      .forEach((el) => {
        const text = (el.textContent || "").trim();
        if (SHARE_TEXT_PATTERN.test(text)) {
          el.style.setProperty("display", "none", "important");
        }
      });

    // Remove any open share dialog.
    scope
      .querySelectorAll(
        'tp-yt-paper-dialog, ytd-popup-container [role="dialog"], ytd-unified-share-panel-renderer, ytd-share-dialog-renderer, [role="dialog"]'
      )
      .forEach((dialog) => {
        const heading = (
          dialog.getAttribute("aria-label") ||
          dialog.querySelector(
            'h1, h2, h3, [role="heading"], yt-formatted-string#title, [slot="title"]'
          )?.textContent ||
          ""
        ).trim();
        if (/^share/i.test(heading) || dialog.matches(
          "ytd-unified-share-panel-renderer, ytd-share-dialog-renderer"
        )) {
          dialog.remove();
        }
      });

    // Belt-and-suspenders: any /embed/ iframe that ends up in a dialog/popup
    // gets removed. The static rule should already prevent it from loading.
    scope.querySelectorAll("iframe").forEach((iframe) => {
      const src = iframe.src || iframe.getAttribute("src") || "";
      if (!/youtube(-nocookie)?\.com\/embed\//.test(src)) return;
      const inDialog = iframe.closest(
        'tp-yt-paper-dialog, [role="dialog"], ytd-popup-container, ytd-unified-share-panel-renderer'
      );
      if (inDialog) iframe.remove();
    });
  }

  // ── Mutation processing ─────────────────────────────────────────────────────

  function processNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (APP === "slides") {
      neuterSlidesVideoDialog(node);
      scanDocsIframes(node);
    } else if (APP === "docs" || APP === "sheets") {
      scanDocsIframes(node);
      scanLinkPreviewCards(node);
    } else if (APP === "youtube") {
      hideYouTubeShareControls(node);
    }
  }

  if (APP === "youtube") {
    injectYouTubeShareCss();
  }

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
        if (
          mutation.attributeName === "src" ||
          mutation.attributeName === "href"
        ) {
          processNode(t);
        } else if (
          mutation.attributeName === "aria-selected" ||
          mutation.attributeName === "aria-hidden"
        ) {
          if (APP === "slides") {
            const dialog = t.closest('[role="dialog"]');
            if (dialog) neuterSlidesVideoDialog(dialog);
          }
        } else if (mutation.attributeName === "aria-label") {
          if (APP === "youtube") {
            const label = (t.getAttribute("aria-label") || "").trim();
            if (SHARE_LABEL_PATTERN.test(label)) {
              t.style.setProperty("display", "none", "important");
            }
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "src",
      "href",
      "aria-selected",
      "aria-hidden",
      "aria-label",
    ],
  });
})();
