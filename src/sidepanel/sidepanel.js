/** Side panel: drives the controller, shows progress, exports the store. */

const $ = (id) => document.getElementById(id);

/** Isolated-world scripts, in dependency order — mirrors the manifest. */
const CONTENT_SCRIPTS = [
  "src/lib/dig.js",
  "src/lib/schema.js",
  "src/lib/normalize.js",
  "src/content/capture.js",
  "src/content/dom-extract.js",
  "src/content/pacing.js",
  "src/content/controller.js",
];

/** Pacing fields the UI edits, and whether the stored value is in ms. */
const PACING_FIELDS = {
  minDelayMs: { ms: true },
  maxDelayMs: { ms: true },
  burstPages: { ms: false },
  longPauseMinMs: { ms: true },
  longPauseMaxMs: { ms: true },
  maxPagesPerHour: { ms: false },
  maxLeadsPerDay: { ms: false },
};

/** Bump only when the notice's substance changes — that re-prompts everyone. */
const CONSENT_VERSION = 1;

let requestedPages = 0;
let lastReport = null;

// ------------------------------------------------------------------ helpers

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Ping the content script, injecting it if absent — needed when the extension
 * was loaded while a Sales Navigator tab was already open, since manifest
 * content scripts only run on navigation.
 *
 * The interceptor is injected too, but it can only patch fetch from that moment
 * on; results already fetched were never seen. Hence the "reload for full
 * capture" hint in the status pill.
 */
async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "SN_PING" });
    if (res && res.ok) return res;
  } catch {
    // Not injected yet.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/interceptor.js"],
    world: "MAIN",
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
  return chrome.tabs.sendMessage(tabId, { type: "SN_PING" });
}

let tabStateTimer = null;
const scheduleTabStateRefresh = () => {
  clearTimeout(tabStateTimer);
  tabStateTimer = setTimeout(refreshTabState, 400);
};

function csvEscape(value) {
  const s = SNS.cell(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [SNS.COLUMNS.join(",")];
  for (const row of rows) lines.push(SNS.COLUMNS.map((c) => csvEscape(row[c])).join(","));
  return lines.join("\r\n");
}

function download(filename, mime, content) {
  // A data: URL outlives this page; a blob: URL would not.
  chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(content)}`,
    filename,
    saveAs: true,
  });
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// ------------------------------------------------------------------- render

function renderStatus(status) {
  if (!status) return;

  $("message").textContent = status.message || "Ready.";
  $("error").textContent = status.error || "";
  $("error").classList.toggle("hidden", !status.error);

  const halt = $("halt");
  halt.textContent = status.halted ? `Halted — ${status.haltReason}` : "";
  halt.classList.toggle("hidden", !status.halted);

  $("pages").textContent = status.pagesDone ? `· ${status.pagesDone} page(s)` : "";

  const total = requestedPages || status.pagesDone || 1;
  const pct = status.running
    ? Math.min(100, ((status.pagesDone || 0) / total) * 100)
    : status.pagesDone
      ? 100
      : 0;
  $("fill").style.width = `${pct}%`;

  if (status.budget) {
    const { leadsRemaining, pagesRemaining } = status.budget;
    $("budget").textContent = `${leadsRemaining} more people today · ${pagesRemaining} more pages this hour`;
  }

  $("start").disabled = !!status.running;
  $("stop").disabled = !status.running;
}

function renderLeads(leads) {
  $("count").textContent = leads.length;

  const list = $("list");
  list.textContent = "";
  for (const lead of leads.slice(-60).reverse()) {
    const li = document.createElement("li");

    const b = document.createElement("b");
    b.textContent = lead.fullName || "(no name)";

    const em = document.createElement("em");
    em.textContent = [lead.title, lead.company].filter(Boolean).join(" · ");

    li.append(b, em);
    list.append(li);
  }
}

async function refresh() {
  const { leads = [], status } = await chrome.storage.local.get(["leads", "status"]);
  renderLeads(leads);
  renderStatus(status);
}

async function refreshTabState() {
  const pill = $("pill");
  const tab = await activeTab();

  const disable = (label) => {
    pill.textContent = label;
    pill.className = "pill bad";
    $("start").disabled = true;
  };

  if (!tab || !/^https:\/\/www\.linkedin\.com\/sales\//.test(tab.url || "")) {
    return disable("not on Sales Nav");
  }

  try {
    const ping = await ensureContentScript(tab.id);
    if (!ping || !ping.onSearchPage) return disable("open a people search");

    const res = await chrome.tabs.sendMessage(tab.id, { type: "SN_COUNT" });
    const count = (res && res.count) || 0;
    const total = res && res.total;

    pill.textContent = total ? `${count} of ${total.toLocaleString()}` : `${count} on page`;
    pill.className = "pill ok";
    $("start").disabled = !!ping.running;

    if (!ping.interceptor) {
      $("message").textContent = "Reload the tab to enable full API capture.";
    }
  } catch {
    disable("reload the tab");
  }
}

// ------------------------------------------------------------------- pacing

async function loadPacing() {
  const { pacing = {} } = await chrome.storage.local.get("pacing");
  const defaults = {
    minDelayMs: 3500,
    maxDelayMs: 9000,
    burstPages: 8,
    longPauseMinMs: 45000,
    longPauseMaxMs: 120000,
    maxPagesPerHour: 90,
    maxLeadsPerDay: 800,
    pauseWhenHidden: true,
  };
  const merged = { ...defaults, ...pacing };

  for (const [key, { ms }] of Object.entries(PACING_FIELDS)) {
    $(key).value = ms ? merged[key] / 1000 : merged[key];
  }
  $("pauseWhenHidden").checked = merged.pauseWhenHidden !== false;
  return merged;
}

async function savePacing() {
  const pacing = {};
  for (const [key, { ms }] of Object.entries(PACING_FIELDS)) {
    const raw = Number($(key).value);
    if (!Number.isFinite(raw)) continue;
    pacing[key] = ms ? Math.round(raw * 1000) : Math.round(raw);
  }
  pacing.pauseWhenHidden = $("pauseWhenHidden").checked;

  // Keep the ranges coherent so a typo can't invert them.
  pacing.maxDelayMs = Math.max(pacing.maxDelayMs, pacing.minDelayMs);
  pacing.longPauseMaxMs = Math.max(pacing.longPauseMaxMs, pacing.longPauseMinMs);

  await chrome.storage.local.set({ pacing });
}

for (const key of [...Object.keys(PACING_FIELDS), "pauseWhenHidden"]) {
  $(key).addEventListener("change", savePacing);
}

$("resetPacing").addEventListener("click", async () => {
  await chrome.storage.local.remove("pacing");
  await loadPacing();
});

// ------------------------------------------------------------------ consent

/**
 * Show the risk notice until it is acknowledged once. The acceptance is stored
 * with a version, so revising the notice can re-prompt without also nagging
 * people every time they open the panel.
 */
async function checkConsent() {
  const { consent } = await chrome.storage.local.get("consent");
  const accepted = Boolean(consent && consent.accepted && (consent.version || 0) >= CONSENT_VERSION);
  $("consent").classList.toggle("hidden", accepted);
  return accepted;
}

$("consentAccept").addEventListener("click", async () => {
  await chrome.storage.local.set({
    consent: { accepted: true, version: CONSENT_VERSION, at: new Date().toISOString() },
  });
  $("consent").classList.add("hidden");
  refreshTabState();
});

// -------------------------------------------------------------- self-test

function renderDiag(report) {
  const out = $("diagOut");
  out.textContent = "";

  const head = document.createElement("div");
  head.className = `diag-head${report.failures ? " fail" : ""}`;
  head.textContent = report.failures
    ? `${report.failures} of ${report.checks.length} checks need attention`
    : `All ${report.checks.length} checks passed`;
  out.append(head);

  for (const check of report.checks) {
    const row = document.createElement("div");
    row.className = `chk ${check.ok ? "pass" : "fail"}`;

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = check.ok ? "✓" : "✕";

    const body = document.createElement("span");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = check.label;
    body.append(label);

    if (check.detail) {
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = check.detail;
      body.append(detail);
    }

    row.append(icon, body);
    out.append(row);
  }

  // Empty columns are the actionable signal: a field that drifted shows up here.
  const gaps = report.coverage.filter((c) => c.pct === 0);
  const partial = report.coverage.filter((c) => c.pct > 0 && c.pct < 0.5);

  const summary = document.createElement("div");
  summary.className = "gaps";
  const title = document.createElement("b");
  title.textContent = `Field coverage — ${report.coverage.length - gaps.length}/${report.coverage.length} populated across ${report.rows.merged} row(s)`;
  summary.append(title);

  if (gaps.length) {
    summary.append(`Empty: ${gaps.map((g) => g.key + (g.apiOnly ? "*" : "")).join(", ")}. `);
  }
  if (partial.length) {
    summary.append(`Sparse: ${partial.map((p) => p.key).join(", ")}. `);
  }
  if (gaps.some((g) => g.apiOnly)) {
    summary.append("* API-only fields — expected empty if API capture did not fire.");
  }
  out.append(summary);

  $("copyDiag").disabled = false;
}

function reportText(report) {
  const lines = [
    "LinkedIn Scraper by mailzy — self-test",
    report.when,
    report.url,
    "",
    ...report.checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`),
    "",
    `Rows: ${report.rows.dom} DOM, ${report.rows.api} API, ${report.rows.merged} merged`,
    "",
    "Field coverage:",
    ...report.coverage.map(
      (c) => `  ${c.pct === 0 ? "EMPTY " : `${Math.round(c.pct * 100)}%`.padStart(6)}  ${c.key}${c.apiOnly ? " (api-only)" : ""}`
    ),
  ];
  return lines.join("\n");
}

$("runDiag").addEventListener("click", async () => {
  const btn = $("runDiag");
  btn.disabled = true;
  btn.textContent = "Running…";

  try {
    const tab = await activeTab();
    await ensureContentScript(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, { type: "SN_DIAGNOSE" });
    if (res && res.ok) {
      lastReport = res.report;
      renderDiag(res.report);
    }
  } catch (err) {
    $("diagOut").textContent = `Self-test could not reach the page: ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = "Run self-test";
});

$("copyDiag").addEventListener("click", async () => {
  if (!lastReport) return;
  await navigator.clipboard.writeText(reportText(lastReport));
  const btn = $("copyDiag");
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy report"), 1200);
});

// ------------------------------------------------------------------ actions

$("start").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab) return;

  await savePacing();
  requestedPages = Math.max(1, Number($("maxPages").value) || 1);

  $("start").disabled = true;
  $("stop").disabled = false;
  $("halt").classList.add("hidden");
  $("message").textContent = "Starting…";

  try {
    await ensureContentScript(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "SN_START",
      options: { maxPages: requestedPages },
    });
    if (res && res.ok === false) {
      $("error").textContent = res.error;
      $("error").classList.remove("hidden");
      $("start").disabled = false;
      $("stop").disabled = true;
    }
  } catch (err) {
    $("error").textContent = `Could not reach the page: ${err.message}`;
    $("error").classList.remove("hidden");
    $("start").disabled = false;
    $("stop").disabled = true;
  }
});

$("stop").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "SN_STOP" }).catch(() => {});
  $("stop").disabled = true;
  $("message").textContent = "Stopping after the current page…";
});

$("csv").addEventListener("click", async () => {
  const { leads = [] } = await chrome.storage.local.get("leads");
  if (!leads.length) return;
  // Leading BOM so Excel reads UTF-8 names correctly.
  download(`mailzy-linkedin-leads-${stamp()}.csv`, "text/csv", `﻿${toCsv(leads)}`);
});

$("json").addEventListener("click", async () => {
  const { leads = [] } = await chrome.storage.local.get("leads");
  if (!leads.length) return;
  download(`mailzy-linkedin-leads-${stamp()}.json`, "application/json", JSON.stringify(leads, null, 2));
});

$("copy").addEventListener("click", async () => {
  const { leads = [] } = await chrome.storage.local.get("leads");
  if (!leads.length) return;
  await navigator.clipboard.writeText(JSON.stringify(leads, null, 2));
  const btn = $("copy");
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1200);
});

$("clear").addEventListener("click", async () => {
  // Deliberately leaves `budget` alone — clearing results must not reset the
  // daily cap, or the cap would mean nothing.
  await chrome.storage.local.set({ leads: [], status: null });
  chrome.action.setBadgeText({ text: "" });
  requestedPages = 0;
  $("fill").style.width = "0";
  $("message").textContent = "Cleared.";
  await refresh();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "SN_PROGRESS") refresh();
});

// Unlike a popup, the side panel stays open as the user moves around, so it has
// to track which tab it is pointed at.
chrome.tabs.onActivated.addListener(scheduleTabStateRefresh);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === "complete" || info.url)) scheduleTabStateRefresh();
});
chrome.windows.onFocusChanged.addListener(scheduleTabStateRefresh);

checkConsent();
loadPacing();
refresh();
refreshTabState();
