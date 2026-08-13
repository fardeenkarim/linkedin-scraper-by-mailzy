/**
 * Passive response capture — MAIN world, document_start.
 *
 * Sales Navigator is a single-page app backed by the Voyager / sales-api JSON
 * endpoints. The DOM is a lossy projection of those payloads: it drops company
 * IDs, position start dates, past roles, industry, spotlight signals and more,
 * and it truncates whatever does survive.
 *
 * So rather than scrape the projection, we read the source. This patches fetch
 * and XMLHttpRequest to *observe* responses the page requests on its own and
 * forwards a clone to the isolated world. It issues no requests of its own —
 * every byte it sees was already on its way to the user's browser. That makes
 * it both the most precise extraction path and the one with zero added load.
 *
 * Bodies are always read from a clone, never the original stream, so the app's
 * own consumption of the response is untouched.
 */
(() => {
  if (window.__snsInterceptorLoaded) return;
  window.__snsInterceptorLoaded = true;

  const CHANNEL = "__SNS_BRIDGE__";

  /** Search/list endpoints that carry lead records. */
  const LEAD_ENDPOINT = /(salesApiLeadSearch|leadSearch|peopleSearch|salesApiPeople|searchDashClusters|salesApiSavedLeads)/i;
  /** Any first-party API call, watched only for rate-limit status codes. */
  const API_ENDPOINT = /\/(voyager|sales-api|sales\/api)\//i;

  const post = (kind, payload) => {
    try {
      window.postMessage({ channel: CHANNEL, kind, payload }, window.location.origin);
    } catch {
      // Payload wasn't structured-cloneable; nothing useful to do here.
    }
  };

  const urlOf = (input) => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return (input && input.url) || "";
  };

  /**
   * LinkedIn signals throttling with 429 and with its own 999 status. Surface
   * those so the controller can back off or stop rather than press on.
   */
  function reportStatus(url, status) {
    if (status === 429 || status === 999 || status === 403) {
      post("throttle", { url, status, at: Date.now() });
    }
  }

  function handleBody(url, status, text) {
    if (!text) return;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return; // Not JSON (HTML challenge page, tracking pixel, etc.).
    }
    post("payload", { url, status, body, at: Date.now() });
  }

  // ------------------------------------------------------------------ fetch

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (...args) {
      const url = urlOf(args[0]);
      const pending = nativeFetch.apply(this, args);

      if (!API_ENDPOINT.test(url)) return pending;

      return pending.then((response) => {
        reportStatus(url, response.status);
        if (LEAD_ENDPOINT.test(url) && response.ok) {
          // Clone first: reading the original would consume the app's stream.
          response
            .clone()
            .text()
            .then((text) => handleBody(url, response.status, text))
            .catch(() => {});
        }
        return response;
      });
    };
  }

  // -------------------------------------------------------------------- xhr

  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;

  proto.open = function (method, url, ...rest) {
    this.__snsUrl = typeof url === "string" ? url : urlOf(url);
    return nativeOpen.call(this, method, url, ...rest);
  };

  proto.send = function (...args) {
    const url = this.__snsUrl || "";
    if (API_ENDPOINT.test(url)) {
      this.addEventListener("load", () => {
        reportStatus(url, this.status);
        if (!LEAD_ENDPOINT.test(url) || this.status < 200 || this.status >= 300) return;
        const type = this.responseType;
        if (type === "" || type === "text") handleBody(url, this.status, this.responseText);
        else if (type === "json" && this.response) post("payload", { url, status: this.status, body: this.response, at: Date.now() });
      });
    }
    return nativeSend.apply(this, args);
  };

  post("ready", { at: Date.now() });
})();
