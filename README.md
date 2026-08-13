<img src="icons/icon128.png" width="64" align="left" alt="" hspace="12" />

# LinkedIn Scraper by mailzy

A Chrome extension (Manifest V3) that extracts people results from LinkedIn Sales
Navigator into CSV or JSON, running in the browser **side panel** so it stays open
beside the search results.

<br clear="left" />

Its distinguishing trick: it doesn't primarily scrape the DOM. It reads the JSON
the page fetches for itself.

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Pin the extension; click its icon to open the side panel.

Chrome 114+ (side panel API). No build step, no dependencies.

On first open the panel shows a risk notice covering the whole surface; scraping
stays blocked until it's acknowledged. The acceptance is stored with a version
number, so it appears exactly once — bumping `CONSENT_VERSION` in
[`sidepanel.js`](src/sidepanel/sidepanel.js) is the only thing that re-prompts,
and clearing results deliberately doesn't. The controller enforces this
independently of the UI, so the gate can't be skipped by messaging it directly.

## How it gets precise data

Sales Navigator is a single-page app backed by Voyager / sales-api JSON
endpoints. The rendered row is a lossy projection of that payload — it drops
company IDs, position start dates, past roles, industry, education and spotlight
signals, and truncates most of what remains.

So [`src/content/interceptor.js`](src/content/interceptor.js) runs in the page's
MAIN world at `document_start` and wraps `fetch` / `XMLHttpRequest` to *observe*
responses the app requests on its own, forwarding a clone to the extension.

**It issues no requests of its own.** Every byte it reads was already on its way
to your browser. That makes it simultaneously the most complete source available
and the one that adds exactly zero load — a rare case where the precise path and
the gentle path are the same path.

DOM extraction still runs as a second source, because API capture won't always
fire (results served from the app's client-side cache produce no request). The
two views are merged per person by stable identity, API winning field-by-field
and DOM filling gaps. Each row records which sources contributed in `source`.

## Data extracted

45 fields. API-only ones are marked ◆ — they're empty on rows that fell back to
DOM extraction.

| Group | Fields |
| --- | --- |
| Identity | full/first◆/last◆ name, headline, Sales Nav URL, public profile URL◆, lead ID, member URN◆, photo |
| Current role | title, company, company ID◆, company URL, industry◆, size◆, location◆, role start◆, months in role, company start◆, months at company◆, description◆ |
| History | previous title◆, previous company◆, all past positions◆, years experience◆, school◆, education detail◆ |
| Context | location, country◆, industry◆, about◆, connection degree, shared connections, connections count◆ |
| Signals | spotlights, OpenLink◆, premium◆, open to work◆, saved lead, recently viewed◆, last activity◆ |
| Meta | source, result page, rank on page, search URL, scraped at |

Results accumulate in `chrome.storage.local`, deduplicated by lead ID across
pages and searches — re-seeing someone *enriches* their row rather than
duplicating it. CSV exports with a UTF-8 BOM so Excel handles accented names.

Not available at any effort: **email addresses**. They are not in the search
payload. Neither are public `/in/` URLs, reliably — `publicIdentifier` appears in
some responses and not others.

## Pacing and account safety

Read this part honestly, because the marketing around it is uniformly dishonest.

**You cannot make automated scraping undetectable.** Detection is overwhelmingly
server-side: request volume, timing distribution, session-level sequencing, and
Sales Navigator's own per-seat usage analytics. Nothing running inside your
browser can reach any of that. This extension therefore contains no fingerprint
spoofing, no telemetry blocking, and no attempt to defeat LinkedIn's bot
detection — those would add risk (a broken spoof is a *louder* signal than none)
while buying nothing against server-side measurement.

What actually reduces risk is being genuinely low-volume and stopping when told.
[`src/content/pacing.js`](src/content/pacing.js) enforces:

- **Hard budgets** — max pages/hour and leads/day, persisted across sessions, so
  closing the browser doesn't reset your allowance. Clearing results deliberately
  does *not* clear the budget.
- **Jittered delays** drawn from a triangular distribution (3.5–9s default), to
  avoid the fixed-interval drumbeat a uniform sleep produces.
- **Long pauses** between bursts, every 8 pages by default.
- **Exponential backoff** on HTTP 429/999, escalating to a full stop after
  repeated throttling.
- **Hard halt** on any checkpoint, auth wall or "unusual activity" notice.
- **Background pause** — only runs while the tab is actually in front.

The halt behaviour is the important one. Pushing through a soft block is what
turns a throttle into a restricted account, so when LinkedIn signals stop, this
stops and tells you why.

All of it is adjustable under **Pacing & limits** in the panel. Raising the
ceilings raises your risk; that tradeoff is yours to make, but the defaults are
deliberately unhurried.

## Layout

```
manifest.json
src/
  content/
    interceptor.js    MAIN world — passive fetch/XHR observation
    capture.js        bridge + per-page payload buffer
    dom-extract.js    DOM fallback source
    pacing.js         rate governor, backoff, halt detection
    controller.js     per-page state machine
  lib/
    dig.js            shape-agnostic traversal primitives
    normalize.js      Voyager JSON -> flat record
    schema.js         field definitions (shared with the panel)
  sidepanel/          UI, storage, CSV/JSON export
  background/         side panel wiring, badge
icons/                brand mark, 16/32/48/128
```

Every file here is loaded by the extension at runtime — nothing is dev-only
scaffolding, so the folder can be zipped and shipped as-is.

## Branding

mailzy indigo (`#5b57d9`, gradient `#8387f6` → `#5852d8`) is defined once as CSS
custom properties at the top of
[`sidepanel.css`](src/sidepanel/sidepanel.css), with a dark-mode block beneath.

The icons in [`icons/`](icons/) were **redrawn from the logo geometrically** at
each size rather than resampled from one bitmap. They are finished assets — to
replace them, drop your own `icon16/32/48/128.png` into that folder; nothing
references them but `manifest.json`.

## Testing before you rely on it

Open a Sales Navigator people search, then **Self-test** in the panel. It's
read-only: no scrolling, no clicking, no requests. It verifies the interceptor is
patched in, rows are locatable, the scroll container and pagination button
resolve, API payloads are being captured *and parsing into leads*, storage is
writable, and no challenge is present.

Then it reports **per-field fill rates across the rows on screen** — which is the
part that matters. A selector that drifted shows up immediately as an empty
column, instead of as a silently blank CSV after a 40-page run. Fields marked
`*` are API-only and are expected to be empty if capture didn't fire.

**Copy report** puts the whole thing on the clipboard as plain text. Run it once
on a real search before trusting the tool; if anything reads FAIL or a column you
need is empty, that report says precisely which selector or endpoint pattern to
fix.

## When it breaks

LinkedIn changes this constantly. Two independent layers have to fail before you
get nothing:

- **API capture** — if the endpoint is renamed, update `LEAD_ENDPOINT` in
  [`interceptor.js`](src/content/interceptor.js). If the envelope is restructured,
  usually nothing needs doing: [`normalize.js`](src/lib/normalize.js) searches the
  tree for objects that *look* like a person rather than following fixed paths. If
  a leaf key is renamed, add it to that field's path list.
- **DOM extraction** — selector lists in
  [`dom-extract.js`](src/content/dom-extract.js), ordered by durability.
  `data-anonymize` attributes come first: LinkedIn uses them internally to blur
  PII in screenshots, so they track a field's *meaning* and survive redesigns that
  rename every CSS class.

The panel shows `Capture: N page(s) from API, M DOM-only` — if that flips to
DOM-only, the interceptor is what needs attention.

If the panel says "reload the tab", the content scripts aren't in that page yet.
Note that injecting mid-session can't retroactively see the first page's fetch,
so reload for full capture.

## Legal

Automated scraping violates the LinkedIn User Agreement, and LinkedIn enforces it
— restrictions and permanent bans on both the account and the Sales Navigator
seat are real outcomes, and no pacing eliminates that. Personal data you extract
is very likely subject to GDPR/CCPA obligations including lawful basis, retention
limits, and subject access requests.

Your call to make. Just make it knowingly.
