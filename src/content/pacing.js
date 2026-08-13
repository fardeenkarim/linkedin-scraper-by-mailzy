/**
 * Rate governor.
 *
 * This is the honest version of "don't get flagged": stay genuinely low-volume
 * and obey the platform when it pushes back. There is no disguise here and none
 * is possible — request volume, timing and per-seat usage are all measured
 * server-side, where nothing running in this browser can reach. What a client
 * *can* do is be small, irregular, and quick to stop.
 *
 *   - Hard ceilings on pages/hour and leads/day, persisted across sessions so
 *     closing the browser doesn't reset your budget.
 *   - Jittered delays drawn from a triangular distribution. Not to look human —
 *     to avoid the fixed-interval drumbeat that a uniform sleep produces.
 *   - Periodic long pauses between bursts.
 *   - Exponential backoff on HTTP 429/999, and a full stop on a challenge.
 *
 * The last one matters most: when LinkedIn signals that it wants you to stop,
 * this stops. Pushing through a soft block is what escalates a throttle into a
 * restricted account.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});

  const DEFAULTS = {
    minDelayMs: 3500,
    maxDelayMs: 9000,
    scrollMinMs: 260,
    scrollMaxMs: 620,
    burstPages: 8, // pages between long pauses
    longPauseMinMs: 45000,
    longPauseMaxMs: 120000,
    maxPagesPerHour: 90,
    maxLeadsPerDay: 800,
    pauseWhenHidden: true,
  };

  const config = { ...DEFAULTS };
  const runtime = { backoffMs: 0, halted: false, haltReason: "", pagesThisRun: 0 };

  const today = () => new Date().toISOString().slice(0, 10);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Triangular jitter: sums two uniforms so the middle is likelier than the edges. */
  function jitter(min, max) {
    const t = (Math.random() + Math.random()) / 2;
    return Math.round(min + t * (max - min));
  }

  async function loadConfig() {
    const { pacing } = await chrome.storage.local.get("pacing");
    Object.assign(config, DEFAULTS, pacing || {});
    return config;
  }

  // ------------------------------------------------------------- budget log

  /** Rolling counters: a day bucket for leads, an hour of page timestamps. */
  async function readBudget() {
    const { budget } = await chrome.storage.local.get("budget");
    const fresh = { date: today(), leads: 0, pages: 0, pageTimes: [] };
    if (!budget || budget.date !== today()) return fresh;

    const cutoff = Date.now() - 3600_000;
    return { ...fresh, ...budget, pageTimes: (budget.pageTimes || []).filter((t) => t > cutoff) };
  }

  async function writeBudget(budget) {
    await chrome.storage.local.set({ budget });
  }

  async function notePage() {
    const budget = await readBudget();
    budget.pages += 1;
    budget.pageTimes.push(Date.now());
    await writeBudget(budget);
  }

  async function noteLeads(count) {
    const budget = await readBudget();
    budget.leads += count;
    await writeBudget(budget);
  }

  /** Remaining headroom, for display in the side panel. */
  async function budgetStatus() {
    const budget = await readBudget();
    return {
      leadsToday: budget.leads,
      leadsRemaining: Math.max(0, config.maxLeadsPerDay - budget.leads),
      pagesThisHour: budget.pageTimes.length,
      pagesRemaining: Math.max(0, config.maxPagesPerHour - budget.pageTimes.length),
    };
  }

  async function checkBudget() {
    const budget = await readBudget();
    if (budget.leads >= config.maxLeadsPerDay) {
      return { ok: false, reason: `Daily limit reached (${config.maxLeadsPerDay} people). Try again tomorrow.` };
    }
    if (budget.pageTimes.length >= config.maxPagesPerHour) {
      const oldest = Math.min(...budget.pageTimes);
      const mins = Math.ceil((3600_000 - (Date.now() - oldest)) / 60000);
      return { ok: false, reason: `Hourly limit reached. Try again in about ${mins} min.` };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------- backoff/halt

  /**
   * Escalating backoff on throttle responses. Three strikes and we stop
   * entirely rather than keep probing a system that is already saying no.
   */
  function noteThrottle(status) {
    runtime.backoffMs = runtime.backoffMs ? Math.min(runtime.backoffMs * 2, 600_000) : 60_000;
    if (runtime.backoffMs >= 240_000) {
      halt("LinkedIn kept asking us to slow down, so we stopped. Wait a few hours before trying again.");
    }
    return runtime.backoffMs;
  }

  function clearThrottle() {
    runtime.backoffMs = 0;
  }

  function halt(reason) {
    runtime.halted = true;
    runtime.haltReason = reason;
  }

  function resetRun() {
    runtime.halted = false;
    runtime.haltReason = "";
    runtime.backoffMs = 0;
    runtime.pagesThisRun = 0;
  }

  /** A checkpoint or verification interstitial means stop now, not slow down. */
  function detectChallenge() {
    if (/\/checkpoint\/|\/authwall|\/uas\/login/.test(location.pathname)) {
      return "LinkedIn is asking you to log in or verify. Stopped.";
    }
    const body = document.body ? document.body.innerText.slice(0, 4000) : "";
    if (/unusual activity|verify.{0,20}(you.?re|you are) human|temporarily restricted/i.test(body)) {
      return "LinkedIn is showing a verification notice. Stopped.";
    }
    return "";
  }

  // ----------------------------------------------------------------- waits

  /** Only run while the tab is actually in front. */
  async function awaitVisible() {
    if (!config.pauseWhenHidden) return;
    while (document.visibilityState === "hidden") await sleep(1500);
  }

  /** Delay before the next page turn, including backoff and burst pauses. */
  async function pageDelay(pageIndex, onTick) {
    let ms = jitter(config.minDelayMs, config.maxDelayMs);

    if (runtime.backoffMs) {
      ms += runtime.backoffMs;
    } else if (pageIndex > 0 && pageIndex % config.burstPages === 0) {
      ms += jitter(config.longPauseMinMs, config.longPauseMaxMs);
    }

    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (runtime.halted) return;
      const left = until - Date.now();
      if (onTick) onTick(Math.ceil(left / 1000));
      await sleep(Math.min(1000, left));
    }
  }

  const scrollDelay = () => sleep(jitter(config.scrollMinMs, config.scrollMaxMs));

  SNS.pacing = {
    DEFAULTS,
    config,
    runtime,
    loadConfig,
    checkBudget,
    budgetStatus,
    notePage,
    noteLeads,
    noteThrottle,
    clearThrottle,
    halt,
    resetRun,
    detectChallenge,
    awaitVisible,
    pageDelay,
    scrollDelay,
    jitter,
    sleep,
  };
})(typeof window !== "undefined" ? window : globalThis);
