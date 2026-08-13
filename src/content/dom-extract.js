/**
 * DOM extraction - the fallback path and gap-filler.
 *
 * API capture is authoritative when it fires, but it won't always: LinkedIn
 * serves some results from a client-side cache with no new request, and
 * endpoint names drift. The DOM is always there, so this keeps a complete
 * (if shallower) second source and the merge step prefers whichever has data.
 *
 * Selector lists are ordered by durability. `data-anonymize` attributes come
 * first - LinkedIn uses them internally to blur PII for screenshots, so they
 * track the *meaning* of a field and survive visual redesigns that rename every
 * CSS class in the row.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});

  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  function pick(scope, selectors) {
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el && text(el)) return el;
    }
    return null;
  }

  const pickText = (scope, selectors) => text(pick(scope, selectors));

  function absUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.origin).href.split("?")[0];
    } catch {
      return "";
    }
  }

  /** Locate each person row on the page. */
  function resultItems() {
    const byAttr = document.querySelectorAll(
      'li[data-x-search-result="LEAD"], li[data-x--people-search-result]'
    );
    if (byAttr.length) return [...byAttr];

    // Anchor on the one attribute a lead row always has, then climb to the row.
    const byName = [...document.querySelectorAll('[data-anonymize="person-name"]')]
      .map((el) => el.closest("li"))
      .filter(Boolean);
    if (byName.length) return [...new Set(byName)];

    return [...document.querySelectorAll("#search-results-container li.artdeco-list__item")];
  }

  /** Nearest scrollable ancestor - Sales Nav scrolls an inner pane, not the window. */
  function scrollContainer() {
    let node = (resultItems()[0] || {}).parentElement;
    while (node && node !== document.body) {
      const { overflowY } = getComputedStyle(node);
      if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 20) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function degreeOf(li) {
    const el = li.querySelector('[data-anonymize="degree"], .artdeco-entity-lockup__degree');
    if (el) return text(el).replace(/^[•·\s]+/, "");
    // Scoped to the title block so unrelated copy ("3rd party vendor") can't match.
    const titleBox = li.querySelector(".artdeco-entity-lockup__title") || li;
    const m = text(titleBox).match(/\b(1st|2nd|3rd\+?)\b/);
    return m ? m[1] : "";
  }

  /** Time-in-role badge, e.g. "2 yrs 3 mos", read only from leaf nodes. */
  function tenureMonths(li) {
    for (const el of li.querySelectorAll("span, div, time")) {
      if (el.children.length) continue;
      const t = text(el);
      if (!/\d/.test(t) || !/^(\d+\s*yrs?)?\s*(\d+\s*mos?)?$/i.test(t)) continue;
      const years = Number((t.match(/(\d+)\s*yr/i) || [])[1] || 0);
      const months = Number((t.match(/(\d+)\s*mo/i) || [])[1] || 0);
      const total = years * 12 + months;
      if (total) return total;
    }
    return "";
  }

  function spotlightsOf(li) {
    const out = new Set();
    const nodes = li.querySelectorAll(
      '[class*="spotlight"], [data-anonymize="spotlight"], .artdeco-entity-lockup__badge, [class*="highlight"]'
    );
    for (const node of nodes) {
      const t = text(node);
      if (t && t.length < 90) out.add(t);
    }
    return [...out];
  }

  function extractRow(li, ctx, rank) {
    const nameEl = pick(li, [
      'a[data-anonymize="person-name"]',
      '[data-anonymize="person-name"]',
      ".artdeco-entity-lockup__title a",
    ]);
    const fullName = text(nameEl);
    if (!fullName) return null;

    const nameLink =
      (nameEl.matches("a") && nameEl) || nameEl.closest("a") || li.querySelector('a[href*="/sales/lead/"]');
    const profileUrl = absUrl(nameLink && nameLink.getAttribute("href"));
    const leadId = (profileUrl.match(/\/sales\/lead\/([^,/?]+)/) || [])[1] || "";

    const companyEl = pick(li, [
      'a[data-anonymize="company-name"]',
      '[data-anonymize="company-name"]',
      'a[href*="/sales/company/"]',
    ]);
    const companyLink = companyEl && ((companyEl.matches("a") && companyEl) || companyEl.closest("a"));
    const companyUrl = absUrl(companyLink && companyLink.getAttribute("href"));

    const photo = li.querySelector('img[data-anonymize="headshot-photo"], .artdeco-entity-lockup__image img');
    const shared = text(li).match(/(\d+)\s+shared connection/i);

    return {
      fullName,
      headline: pickText(li, ['[data-anonymize="headline"]', ".artdeco-entity-lockup__subtitle"]),
      profileUrl,
      leadId,
      photoUrl: (photo && photo.src) || "",

      title: pickText(li, ['[data-anonymize="title"]', '[data-anonymize="job-title"]', ".artdeco-entity-lockup__subtitle"]),
      company: text(companyEl),
      companyId: (companyUrl.match(/\/sales\/company\/(\d+)/) || [])[1] || "",
      companyUrl,
      roleMonths: tenureMonths(li),

      location: pickText(li, ['[data-anonymize="location"]', ".artdeco-entity-lockup__caption"]),
      summary: pickText(li, ['[data-anonymize="person-blurb"]', '[data-anonymize="general-blurb"]', ".result-lockup__highlight-keyword"]),
      degree: degreeOf(li),
      sharedConnections: shared ? shared[1] : "",

      spotlights: spotlightsOf(li),
      saved: Boolean(li.querySelector('[aria-pressed="true"][class*="save"], button[aria-label*="Saved"]')),

      source: "dom",
      page: ctx.page || "",
      rank,
      searchUrl: ctx.searchUrl || "",
      scrapedAt: new Date().toISOString(),
    };
  }

  function extractPage(ctx = {}) {
    return resultItems()
      .map((li, i) => extractRow(li, ctx, i + 1))
      .filter(Boolean);
  }

  function currentPageNumber() {
    const fromUrl = new URLSearchParams(location.search).get("page");
    if (fromUrl && /^\d+$/.test(fromUrl)) return Number(fromUrl);

    const active = document.querySelector(
      ".artdeco-pagination__indicator--number.active button, .artdeco-pagination__indicator.active button"
    );
    const n = parseInt(text(active), 10);
    return Number.isFinite(n) ? n : 1;
  }

  function nextButton() {
    const selectors = [
      "button.artdeco-pagination__button--next",
      'button[aria-label="Next"]',
      'button[aria-label="Next page"]',
      'button[data-test-pagination-page-btn="next"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") return btn;
    }
    return null;
  }

  /** Total result count LinkedIn reports for the search, when shown. */
  function totalResults() {
    const el = document.querySelector('[class*="results-count"], .artdeco-typography--display1');
    const m = text(el).replace(/,/g, "").match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /** Cheap fingerprint of the visible result set, used to confirm a page turn. */
  function pageFingerprint(items = resultItems()) {
    const first = items[0];
    const link = first && first.querySelector('a[href*="/sales/lead/"]');
    return `${items.length}|${(link && link.getAttribute("href")) || text(first).slice(0, 80)}`;
  }

  SNS.dom = {
    resultItems,
    scrollContainer,
    extractPage,
    currentPageNumber,
    nextButton,
    totalResults,
    pageFingerprint,
    text,
  };
})(typeof window !== "undefined" ? window : globalThis);
