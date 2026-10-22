/**
 * Slides YT Fix — content script
 *
 * Runs on Google Docs/Sheets/Slides and on YouTube itself. Operates silently —
 * no on-screen notices are shown to students.
 *
 * Behavior:
 *   - Slides: leaves Insert > Video menu visible but neuters the dialog it
 *     opens. Google has shipped three generations of that dialog and all are
 *     handled:
 *       (a) the current one: a main-frame dialog with aria-label
 *           "Insert video", a side list of role="option" entries
 *           (YouTube / Google Drive) and a YouTube search box;
 *       (b) an interim one: heading "Insert Video" with button[role="tab"]
 *           entries "YouTube" / "Drive";
 *       (c) the classic Google Picker iframe at docs.google.com/picker with
 *           div[role="tab"] entries "Search" / "By URL" / "Google Drive".
 *     In every case the YouTube entries and inputs are removed, the Drive
 *     entry is auto-selected, and any YouTube result tiles are stripped, so
 *     students can still insert Drive videos but not YouTube ones.
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
      if (path.startsWith("/picker")) return "picker";
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

  // Never touch the YouTube embed player itself. Teacher-embedded Education
  // videos in Slides (and any legitimate embed) play through a
  // youtube.com/embed/ iframe; interfering with that frame causes
  // "Could not load YouTube Player". The share-dialog embed-preview abuse is
  // already covered by the googlevideo.com network block on top-level
  // YouTube tabs, so we lose no coverage by leaving /embed/ frames alone.
  if (APP === "youtube" && location.pathname.startsWith("/embed/")) {
    return;
  }

  const YOUTUBE_PATTERN =
    /https?:\/\/([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|youtubeeducation\.com)\b/i;

  function isYouTubeUrl(url) {
    if (!url) return false;
    return YOUTUBE_PATTERN.test(url);
  }

  // ── Slides: neuter Insert Video dialog ──────────────────────────────────────

  const VIDEO_DIALOG_PATTERN = /insert\s*video/i;
  // Entries in the dialog's side list / tab strip that lead to YouTube.
  const YT_NAV_PATTERN =
    /^\s*(search|search youtube|youtube( search| videos?)?|by url|url|from (the )?web|web)\s*$/i;
  const DRIVE_NAV_PATTERN = /drive|upload|my drive|shared with me|recent/i;
  const NAV_SELECTOR =
    '[role="tab"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="listitem"], [role="treeitem"], [role="radio"]';
  const YT_INPUT_PATTERN = /youtube|by url|video url|paste a (youtube )?(url|link)/i;
  const YT_RESULT_SELECTOR =
    'img[src*="ytimg.com"], a[href*="youtube.com"], a[href*="youtu.be"], iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtubeeducation.com"]';

  function cleanLabel(el) {
    return (el.getAttribute("aria-label") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSelectedNav(el) {
    if (el.getAttribute("aria-selected") === "true") return true;
    if (el.getAttribute("aria-current")) return true;
    if (el.getAttribute("aria-checked") === "true") return true;
    const cls = typeof el.className === "string" ? el.className : "";
    return /(^|[\s-])(selected|active|checked)($|[\s-])/i.test(cls);
  }

  function hideEl(el) {
    el.style.setProperty("display", "none", "important");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
  }

  function isVideoDialog(dialog) {
    if (VIDEO_DIALOG_PATTERN.test(dialog.getAttribute("aria-label") || "")) {
      return true;
    }
    const heading = dialog.querySelector('[role="heading"], h1, h2, h3');
    return !!heading && VIDEO_DIALOG_PATTERN.test(heading.textContent || "");
  }

  function findVideoDialogs(scope) {
    const found = new Set();
    if (scope.matches && scope.matches('[role="dialog"]')) found.add(scope);
    if (scope.closest) {
      const outer = scope.closest('[role="dialog"]');
      if (outer) found.add(outer);
    }
    if (scope.querySelectorAll) {
      scope.querySelectorAll('[role="dialog"]').forEach((d) => found.add(d));
    }
    return Array.from(found).filter(isVideoDialog);
  }

  function neuterVideoDialog(dialog) {
    let youTubeActive = false;
    let driveNav = null;

    // Side list / tab strip entries.
    dialog.querySelectorAll(NAV_SELECTOR).forEach((el) => {
      const label = cleanLabel(el);
      if (!label) return;
      if (YT_NAV_PATTERN.test(label)) {
        if (isSelectedNav(el)) youTubeActive = true;
        hideEl(el);
      } else if (!driveNav && DRIVE_NAV_PATTERN.test(label)) {
        driveNav = el;
      }
    });

    // YouTube search / URL inputs. If one is present the YouTube pane is
    // showing, so also switch to Drive.
    dialog.querySelectorAll("input, textarea").forEach((input) => {
      const text = [
        input.getAttribute("aria-label"),
        input.getAttribute("placeholder"),
        input.getAttribute("title"),
        input.value,
      ].join(" ");
      if (!YT_INPUT_PATTERN.test(text)) return;
      youTubeActive = true;
      const box =
        input.closest('[role="search"], [role="combobox"], form') || input;
      box.remove();
    });

    // Any YouTube result tiles or preview players that already rendered.
    dialog.querySelectorAll(YT_RESULT_SELECTOR).forEach((hit) => {
      const tile =
        hit.closest(
          '[role="option"], [role="gridcell"], [role="listitem"], [role="row"], li'
        ) || hit;
      tile.remove();
    });

    // Classic picker tab panels labelled by a hidden tab.
    dialog.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      if (panel.dataset.ysbReplaced) return;
      const labelledById = panel.getAttribute("aria-labelledby");
      const labelledByEl = labelledById
        ? document.getElementById(labelledById)
        : null;
      const text =
        cleanLabel(panel) || (labelledByEl ? cleanLabel(labelledByEl) : "");
      if (YT_NAV_PATTERN.test(text)) {
        panel.dataset.ysbReplaced = "1";
        panel.innerHTML = "";
      }
    });

    if (youTubeActive && driveNav && !isSelectedNav(driveNav)) {
      setTimeout(() => driveNav.click(), 0);
    }
  }

  function neuterSlidesVideoDialog(scope) {
    findVideoDialogs(scope).forEach(neuterVideoDialog);
  }

  // ── Picker frame (Insert > Video dialog) ────────────────────────────────────
  //
  // The picker's tab strip has changed markup over time, so match broadly:
  // anything with role="tab", plus the classic picker nav-pane items. Tabs are
  // identified by their visible text / aria-label, never by class name.

  const PICKER_TAB_BLOCKLIST =
    /^\s*(search|search youtube|youtube|youtube search|by url|url|web|from the web)\s*$/i;
  const PICKER_TAB_ALLOW = /drive|upload|my drive|shared|recent/i;
  const PICKER_TAB_SELECTOR =
    '[role="tab"], [class*="navpane-item"], [class*="picker-tab"], [class*="nav-item"], [class*="navitem"]';

  const pickerLabel = cleanLabel;
  const pickerTabIsSelected = isSelectedNav;

  function neuterPickerFrame(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const tabs = root.querySelectorAll(PICKER_TAB_SELECTOR);
    if (!tabs.length) return;

    let hidActiveTab = false;
    let driveTab = null;

    tabs.forEach((tab) => {
      const label = pickerLabel(tab);
      if (!label) return;
      if (PICKER_TAB_BLOCKLIST.test(label)) {
        if (pickerTabIsSelected(tab)) hidActiveTab = true;
        tab.style.setProperty("display", "none", "important");
        tab.setAttribute("aria-hidden", "true");
        tab.setAttribute("tabindex", "-1");
      } else if (!driveTab && PICKER_TAB_ALLOW.test(label)) {
        driveTab = tab;
      }
    });

    if (hidActiveTab && driveTab) {
      setTimeout(() => driveTab.click(), 0);
    }

    // Blank any tab panel that belongs to a blocked tab, in case the panel
    // is already rendered (search box, URL field, result grid).
    root.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      if (panel.dataset.ysbReplaced) return;
      const labelledById = panel.getAttribute("aria-labelledby");
      const labelledByEl = labelledById
        ? document.getElementById(labelledById)
        : null;
      const text = pickerLabel(panel) || (labelledByEl ? pickerLabel(labelledByEl) : "");
      if (PICKER_TAB_BLOCKLIST.test(text)) {
        panel.dataset.ysbReplaced = "1";
        panel.innerHTML = "";
      }
    });
  }

  // Inside the picker frame, remove any YouTube iframe (preview player) and
  // any search result that links to YouTube. Drive results never link there.
  function scrubPickerYouTubeContent(scope) {
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll("iframe").forEach((iframe) => {
      const src = iframe.src || iframe.getAttribute("src") || "";
      if (isYouTubeUrl(src)) iframe.remove();
    });
    scope.querySelectorAll("a[href]").forEach((a) => {
      if (!isYouTubeUrl(a.href)) return;
      const item =
        a.closest('[role="option"], [role="gridcell"], [role="listitem"], [class*="result"], [class*="item"]') ||
        a;
      item.remove();
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
  function injectYouTubeCss() {
    if (document.getElementById("ysb-yt-style")) return;
    const style = document.createElement("style");
    style.id = "ysb-yt-style";
    style.textContent = `
      /* ── Share controls ─────────────────────────────────────────────── */
      button[aria-label="Share" i],
      [aria-label="Share" i],
      a[aria-label="Share" i],
      ytd-unified-share-panel-renderer,
      ytd-share-dialog-renderer,
      yt-share-target-section-renderer {
        display: none !important;
      }

      /* ── Video thumbnails (kills hover preview) ─────────────────────── */
      ytd-thumbnail,
      ytd-moving-thumbnail-renderer,
      yt-thumbnail-view-model,
      yt-collection-thumbnail-view-model,
      yt-lockup-view-model img,
      ytd-playlist-thumbnail,
      ytd-rich-grid-media #thumbnail,
      ytd-video-renderer #thumbnail,
      ytd-compact-video-renderer #thumbnail,
      ytd-grid-video-renderer #thumbnail,
      ytd-reel-thumbnail-renderer,
      ytd-channel-video-player-renderer,
      ytd-video-preview {
        visibility: hidden !important;
      }

      /* ── YouTube Shorts (everything) ────────────────────────────────── */
      ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
      ytd-rich-shelf-renderer[is-shorts],
      ytd-reel-shelf-renderer,
      ytd-reel-item-renderer,
      ytd-shorts,
      ytd-mini-guide-entry-renderer[aria-label="Shorts" i],
      ytd-guide-entry-renderer:has(a[title="Shorts" i]),
      a[href^="/shorts/"],
      a[href*="/shorts/"] {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // Redirect away from /shorts/<id> URLs so the network-blocked Shorts page
  // doesn't sit there in a perpetual buffering state.
  function maybeRedirectShorts() {
    if (location.pathname.startsWith("/shorts/")) {
      location.replace("/");
    }
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
    // gets removed (share-dialog embed preview).
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

  // The Insert video dialog populates its label, side list and panes over
  // several frames after it is attached, so a single pass on the added node
  // is not enough. Coalesce mutations into one cheap whole-document rescan.
  let rescanTimer = null;
  function scheduleDialogRescan() {
    if (rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      if (!document.querySelector('[role="dialog"], #doclist')) return;
      neuterSlidesVideoDialog(document.documentElement);
      if (APP === "picker") {
        neuterPickerFrame(document);
        scrubPickerYouTubeContent(document.documentElement);
      }
    }, 60);
  }

  function processNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (APP === "slides") {
      neuterSlidesVideoDialog(node);
      scanDocsIframes(node);
      scheduleDialogRescan();
    } else if (APP === "picker") {
      neuterPickerFrame(node);
      scrubPickerYouTubeContent(node);
      neuterSlidesVideoDialog(document.documentElement);
      scheduleDialogRescan();
    } else if (APP === "docs" || APP === "sheets") {
      scanDocsIframes(node);
      scanLinkPreviewCards(node);
    } else if (APP === "youtube") {
      hideYouTubeShareControls(node);
    }
  }

  if (APP === "youtube") {
    injectYouTubeCss();
    maybeRedirectShorts();
    // YouTube uses SPA navigation; this event fires after each route change.
    window.addEventListener("yt-navigate-finish", maybeRedirectShorts);
    window.addEventListener("popstate", maybeRedirectShorts);
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
          if (APP === "slides" || APP === "picker") {
            scheduleDialogRescan();
          }
        } else if (mutation.attributeName === "class") {
          if (APP === "slides" || APP === "picker") {
            scheduleDialogRescan();
          }
        } else if (mutation.attributeName === "aria-label") {
          if (APP === "slides" || APP === "picker") {
            scheduleDialogRescan();
          } else if (APP === "youtube") {
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
      "aria-current",
      "aria-checked",
      "aria-hidden",
      "aria-label",
      "class",
    ],
  });
})();
