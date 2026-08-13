/**
 * Bridge between the MAIN-world interceptor and the scraping controller.
 *
 * Buffers captured payloads from document_start, because the first page of
 * results is usually fetched before the user ever opens the side panel. Each
 * payload is tagged with the result page it belongs to, derived from the
 * request's own `start` offset, so a page is matched to its data exactly rather
 * than by "whatever arrived most recently".
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});
  const CHANNEL = "__SNS_BRIDGE__";
  const PAGE_SIZE = 25;
  const MAX_BUFFER = 40;

  const buffer = [];
  const listeners = new Set();
  const state = { throttled: null, interceptorReady: false };

  /** Voyager passes paging as `?start=25` or inline as `(start:25,count:25)`. */
  function pageFromUrl(url) {
    let start = null;

    try {
      const qs = new URL(url, location.origin).searchParams.get("start");
      if (qs !== null && /^\d+$/.test(qs)) start = Number(qs);
    } catch {
      // Relative or malformed URL; fall through to the inline form.
    }
    if (start === null) {
      const inline = String(url).match(/[(,]start:(\d+)/);
      if (inline) start = Number(inline[1]);
    }
    if (start === null) return null;

    return Math.floor(start / PAGE_SIZE) + 1;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL) return;

    if (msg.kind === "ready") {
      state.interceptorReady = true;
      return;
    }

    if (msg.kind === "throttle") {
      state.throttled = msg.payload;
      listeners.forEach((fn) => fn({ type: "throttle", data: msg.payload }));
      return;
    }

    if (msg.kind === "payload") {
      const { url, body, at } = msg.payload;
      buffer.push({ url, body, at, page: pageFromUrl(url) });
      while (buffer.length > MAX_BUFFER) buffer.shift();
      listeners.forEach((fn) => fn({ type: "payload", data: buffer[buffer.length - 1] }));
    }
  });

  /**
   * Take every buffered payload for a page. Falls back to untagged payloads
   * that arrived recently, which covers endpoints that page differently.
   */
  function drain(page, since = 0) {
    const taken = [];
    for (let i = buffer.length - 1; i >= 0; i--) {
      const entry = buffer[i];
      const matches = entry.page === page || (entry.page === null && entry.at >= since);
      if (!matches) continue;
      taken.unshift(entry);
      buffer.splice(i, 1);
    }
    return taken;
  }

  /** Resolve once a payload for `page` lands, or on timeout. */
  function waitFor(page, timeoutMs, since) {
    return new Promise((resolve) => {
      const ready = drain(page, since);
      if (ready.length) return resolve(ready);

      const timer = setTimeout(() => {
        listeners.delete(onEvent);
        resolve(drain(page, since));
      }, timeoutMs);

      function onEvent(evt) {
        if (evt.type !== "payload") return;
        const hit = evt.data.page === page || (evt.data.page === null && evt.data.at >= since);
        if (!hit) return;
        clearTimeout(timer);
        listeners.delete(onEvent);
        resolve(drain(page, since));
      }

      listeners.add(onEvent);
    });
  }

  SNS.capture = {
    state,
    drain,
    waitFor,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    pending: () => buffer.length,
    /** Read the buffer without consuming it - for diagnostics. */
    peek: () => buffer.slice(),
    clearThrottle: () => (state.throttled = null),
  };
})(typeof window !== "undefined" ? window : globalThis);
