/**
 * Scrape controller — orchestrates capture, extraction, merging and pacing.
 *
 * Per page: wait for visibility and budget, scroll to force lazy rows to
 * render, take whatever the interceptor captured for that page, extract the
 * DOM as a second source, merge the two, persist, then wait and turn the page.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});
  const { pacing, dom, capture } = SNS;

  const PAGE_TURN_TIMEOUT_MS = 25000;
  const API_WAIT_MS = 6000;
  const MAX_SCROLL_ROUNDS = 60;

  const state = {
    running: false,
    stopRequested: false,
    page: 0,
    pagesDone: 0,
    found: 0,
    apiPages: 0,
    domOnlyPages: 0,
  };

  const onSearchPage = () => /\/sales\/search\/people/.test(location.pathname);

  // Mirrored from storage so the sync start-check can consult it. The side
  // panel records consent; scraping stays blocked until it does.
  let consentGiven = false;
  chrome.storage.local.get("consent").then(({ consent }) => {
    consentGiven = Boolean(consent && consent.accepted);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.consent) {
      consentGiven = Boolean(changes.consent.newValue && changes.consent.newValue.accepted);
    }
  });

  // ------------------------------------------------------------- reporting

  async function report(patch = {}) {
    const status = {
      running: state.running,
      page: state.page,
      pagesDone: state.pagesDone,
      found: state.found,
      apiPages: state.apiPages,
      domOnlyPages: state.domOnlyPages,
      halted: pacing.runtime.halted,
      haltReason: pacing.runtime.haltReason,
      budget: await pacing.budgetStatus(),
      updatedAt: Date.now(),
      ...patch,
    };
    await chrome.storage.local.set({ status });
    chrome.runtime.sendMessage({ type: "SN_PROGRESS", status }).catch(() => {});
  }

  // --------------------------------------------------------------- storing

  async function persist(leads) {
    const { leads: existing = [] } = await chrome.storage.local.get("leads");
    const index = new Map(existing.map((lead) => [SNS.identity(lead), lead]));
    let added = 0;
    let enriched = 0;

    for (const lead of leads) {
      const id = SNS.identity(lead);
      if (!id) continue;
      if (index.has(id)) {
        // Same person seen again — keep the richer of the two records.
        const merged = SNS.merge(lead, index.get(id));
        index.set(id, merged);
        enriched++;
      } else {
        index.set(id, lead);
        added++;
      }
    }

    const all = [...index.values()];
    await chrome.storage.local.set({ leads: all });
    state.found = all.length;
    return { added, enriched };
  }

  // -------------------------------------------------------------- scrolling

  /** Force lazy rows into the DOM, then return to the top. */
  async function renderAllRows() {
    const box = dom.scrollContainer();
    const step = Math.max(300, Math.floor(box.clientHeight * 0.8));
    let lastCount = -1;
    let stable = 0;

    for (let i = 0; i < MAX_SCROLL_ROUNDS; i++) {
      if (state.stopRequested || pacing.runtime.halted) return;
      box.scrollTop = Math.min(box.scrollTop + step, box.scrollHeight);
      await pacing.scrollDelay();

      const count = dom.resultItems().length;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
      if (count === lastCount && atBottom) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
      }
      lastCount = count;
    }

    box.scrollTop = 0;
    await pacing.scrollDelay();
  }

  // -------------------------------------------------------------- one page

  async function scrapeCurrentPage(since) {
    const ctx = { page: state.page, searchUrl: location.href };

    // API records first — richer, and ordered exactly as the server returned them.
    const payloads = await capture.waitFor(state.page, API_WAIT_MS, since);
    const apiLeads = payloads.flatMap((entry) => SNS.leadsFromPayload(entry.body, ctx));

    const domLeads = dom.extractPage(ctx);

    if (apiLeads.length) state.apiPages++;
    else if (domLeads.length) state.domOnlyPages++;

    // Merge the two views by stable identity, API winning field by field.
    const byId = new Map();
    for (const lead of domLeads) {
      const id = SNS.identity(lead);
      if (id) byId.set(id, lead);
    }
    for (const lead of apiLeads) {
      const id = SNS.identity(lead);
      if (!id) continue;
      byId.set(id, byId.has(id) ? SNS.merge(lead, byId.get(id)) : lead);
    }

    return { leads: [...byId.values()], apiCount: apiLeads.length, domCount: domLeads.length };
  }

  /** Wait for the result set to actually swap, so no page is scraped twice. */
  async function waitForPageTurn(previousFingerprint) {
    const deadline = Date.now() + PAGE_TURN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (state.stopRequested || pacing.runtime.halted) return false;
      await pacing.sleep(400);
      const items = dom.resultItems();
      if (items.length && dom.pageFingerprint(items) !== previousFingerprint) {
        await pacing.sleep(pacing.jitter(700, 1400)); // let row contents settle
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- driver

  function canStart() {
    if (state.running) return { ok: false, error: "Already running." };
    if (!consentGiven) return { ok: false, error: "Acknowledge the risk notice before scraping." };
    if (!onSearchPage()) {
      return { ok: false, error: "Open a Sales Navigator people search first (/sales/search/people)." };
    }
    return { ok: true };
  }

  async function run({ maxPages = 5 } = {}) {
    state.running = true;
    state.stopRequested = false;
    state.pagesDone = 0;
    state.apiPages = 0;
    state.domOnlyPages = 0;
    pacing.resetRun();
    await pacing.loadConfig();

    const { leads = [] } = await chrome.storage.local.get("leads");
    state.found = leads.length;
    await report({ message: "Starting…", error: "" });

    try {
      for (let i = 0; i < maxPages; i++) {
        if (state.stopRequested || pacing.runtime.halted) break;

        await pacing.awaitVisible();

        const challenge = pacing.detectChallenge();
        if (challenge) {
          pacing.halt(challenge);
          break;
        }

        const budget = await pacing.checkBudget();
        if (!budget.ok) {
          await report({ message: budget.reason });
          break;
        }

        state.page = dom.currentPageNumber();
        const since = Date.now();

        await report({ message: `Reading page ${state.page}…` });
        await renderAllRows();
        if (state.stopRequested || pacing.runtime.halted) break;

        const { leads: pageLeads, apiCount, domCount } = await scrapeCurrentPage(since);
        if (!pageLeads.length) {
          await report({ message: "No people found on this page." });
          break;
        }

        const { added, enriched } = await persist(pageLeads);
        await pacing.notePage();
        await pacing.noteLeads(pageLeads.length);
        state.pagesDone++;

        await report({
          message: `Page ${state.page} — ${added} new${enriched ? `, ${enriched} updated` : ""}.`,
        });

        if (i === maxPages - 1) break;

        const next = dom.nextButton();
        if (!next) {
          await report({ message: "That was the last page." });
          break;
        }

        const fingerprint = dom.pageFingerprint();
        await pacing.pageDelay(i + 1, (secondsLeft) => {
          report({ message: `Pausing ${secondsLeft}s before page ${state.page + 1}…` });
        });
        if (state.stopRequested || pacing.runtime.halted) break;

        next.click();
        if (!(await waitForPageTurn(fingerprint))) {
          await report({ message: "The next page didn't load. Stopped." });
          break;
        }
      }
    } catch (err) {
      await report({ message: "Stopped on error.", error: String((err && err.message) || err) });
    }

    state.running = false;
    const halted = pacing.runtime.halted;
    await report({
      running: false,
      message: halted
        ? `Halted: ${pacing.runtime.haltReason}`
        : state.stopRequested
          ? `Stopped. ${state.found} people saved.`
          : `Finished — ${state.found} people saved from ${state.pagesDone} page(s).`,
    });
  }

  // ----------------------------------------------------------- diagnostics

  /**
   * Preflight against the live page. Every assumption the scraper makes gets
   * checked and reported, plus per-field fill rates from the rows currently
   * rendered — so a selector that has drifted shows up as an empty column here
   * rather than as a silently blank CSV after a 40-page run.
   *
   * Passive: no scrolling, no clicking, no requests.
   */
  async function diagnose() {
    const checks = [];
    const add = (label, ok, detail = "") => checks.push({ label, ok, detail });

    add("On a people search page", onSearchPage(), location.pathname);
    add("Risk notice acknowledged", consentGiven);
    add(
      "Interceptor active in page",
      capture.state.interceptorReady,
      capture.state.interceptorReady ? "fetch/XHR patched" : "reload the tab — capture will fall back to DOM"
    );

    const items = dom.resultItems();
    add("Result rows located", items.length > 0, `${items.length} rendered (scroll loads the rest)`);

    const box = dom.scrollContainer();
    const isInner = box !== document.scrollingElement && box !== document.documentElement;
    add("Scroll container identified", Boolean(box), isInner ? "inner pane" : "document (verify on a long list)");

    add("Page number detected", Number.isFinite(dom.currentPageNumber()), `page ${dom.currentPageNumber()}`);
    const next = dom.nextButton();
    add("Next-page button found", Boolean(next), next ? "" : "absent — fine on a single-page result set");
    const total = dom.totalResults();
    add("Total result count parsed", total !== null, total !== null ? `${total} results` : "not shown");

    const payloads = capture.peek();
    const apiRows = payloads.flatMap((p) => {
      try {
        return SNS.leadsFromPayload(p.body, {});
      } catch {
        return [];
      }
    });
    add(
      "API payloads captured",
      payloads.length > 0,
      `${payloads.length} buffered, ${apiRows.length} leads parsed`
    );
    add(
      "API parsing produced leads",
      apiRows.length > 0,
      apiRows.length ? "" : "endpoint pattern may need updating (see LEAD_ENDPOINT)"
    );

    const domRows = dom.extractPage({ page: dom.currentPageNumber(), searchUrl: location.href });
    add("DOM extraction produced rows", domRows.length > 0, `${domRows.length} rows`);

    // Storage round-trip — proves the export path has somewhere to write.
    let storageOk = false;
    try {
      await chrome.storage.local.set({ __snsProbe: 1 });
      storageOk = (await chrome.storage.local.get("__snsProbe")).__snsProbe === 1;
      await chrome.storage.local.remove("__snsProbe");
    } catch {
      storageOk = false;
    }
    add("Extension storage writable", storageOk);

    await pacing.loadConfig();
    const budget = await pacing.budgetStatus();
    add(
      "Pacing budget readable",
      Boolean(budget),
      `${budget.leadsRemaining} leads / ${budget.pagesRemaining} pages left`
    );

    const challenge = pacing.detectChallenge();
    add("No challenge or checkpoint detected", !challenge, challenge);

    // Per-field coverage across the merged view of whatever is on screen.
    const merged = new Map();
    for (const row of domRows) {
      const id = SNS.identity(row);
      if (id) merged.set(id, row);
    }
    for (const row of apiRows) {
      const id = SNS.identity(row);
      if (!id) continue;
      merged.set(id, merged.has(id) ? SNS.merge(row, merged.get(id)) : row);
    }
    const sample = [...merged.values()];

    const coverage = SNS.COLUMNS.map((key) => {
      const filled = sample.filter((row) => !SNS.isEmpty(row[key])).length;
      const field = SNS.FIELDS.find((f) => f.key === key) || {};
      return { key, apiOnly: field.source === "api", filled, pct: sample.length ? filled / sample.length : 0 };
    });

    return {
      when: new Date().toISOString(),
      url: location.href,
      checks,
      rows: { dom: domRows.length, api: apiRows.length, merged: sample.length },
      coverage,
      failures: checks.filter((c) => !c.ok).length,
    };
  }

  // ------------------------------------------------------------- listeners

  capture.subscribe((evt) => {
    if (evt.type !== "throttle") return;
    const wait = pacing.noteThrottle(evt.data.status);
    report({ message: `LinkedIn asked us to slow down. Pausing ${Math.round(wait / 1000)}s.` });
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.type) {
      case "SN_PING":
        sendResponse({
          ok: true,
          onSearchPage: onSearchPage(),
          running: state.running,
          interceptor: capture.state.interceptorReady,
        });
        return false;

      case "SN_COUNT":
        sendResponse({
          ok: true,
          count: dom.resultItems().length,
          total: dom.totalResults(),
          buffered: capture.pending(),
          onSearchPage: onSearchPage(),
        });
        return false;

      case "SN_START": {
        // Ack immediately: a run lasts minutes and the panel may close long
        // before it ends, so progress travels via storage, not this response.
        const check = canStart();
        sendResponse(check);
        if (check.ok) run(msg.options || {});
        return false;
      }

      case "SN_DIAGNOSE":
        diagnose().then((report) => sendResponse({ ok: true, report }));
        return true; // async

      case "SN_STOP":
        state.stopRequested = true;
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
