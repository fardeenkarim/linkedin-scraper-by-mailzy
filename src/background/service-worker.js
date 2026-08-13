/**
 * Background service worker.
 *
 * Two jobs: make the toolbar icon open the side panel, and mirror scrape
 * progress onto the action badge so the count is visible with the panel closed.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// setPanelBehavior is not persisted across browser restarts in every Chrome
// build, so re-assert it on startup.
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "SN_PROGRESS") return;

  const { found = 0, running, halted } = msg.status || {};

  if (halted) {
    // A halt is the one state worth interrupting for, so it gets the badge.
    chrome.action.setBadgeBackgroundColor({ color: "#b24020" });
    chrome.action.setBadgeText({ text: "!" });
    return;
  }

  chrome.action.setBadgeBackgroundColor({ color: running ? "#5b57d9" : "#3d8a3d" });
  chrome.action.setBadgeText({ text: found ? String(found) : "" });
});
