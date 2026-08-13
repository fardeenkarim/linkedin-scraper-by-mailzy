<img src="icons/icon128.png" width="72" align="left" alt="" hspace="14" />

# LinkedIn Scraper by mailzy

Turn a LinkedIn Sales Navigator search into a spreadsheet.
Runs in a side panel next to your search. Install, agree, use.

<br clear="left" />

---

## What this actually does for you

Sales Navigator is very good at helping you find the right people. It is
deliberately bad at letting you keep them.

You can run a search that returns 800 perfect prospects, and there is no export
button anywhere. You can scroll through them and save them to a list inside
LinkedIn, and that is where it ends. If you want those people in a spreadsheet,
in your CRM, or in an email tool, you copy them out by hand, one at a time.

This extension turns that search into a spreadsheet file.

### What that's worth day to day

**It saves hours.** Copying 250 people by hand is an afternoon of clicking
between tabs. This collects them in about ten minutes while you do something
else.

**You get more than you'd ever copy manually.** For each person it saves up to 45
details - not just name and title, but how long they have been in the role, their
previous job, company size and industry, where they studied, how many connections
you share, and whether they recently changed jobs. Nobody copies all that by
hand. It comes along for free here.

**You can finally sort and filter properly.** Once it is a spreadsheet, you can
sort by how long someone has been in their role, filter to companies of a certain
size, group by city, or pull out only the people who just started a new job. Sales
Navigator will not let you slice your results that way. Excel will.

**It plugs into everything else.** A CSV file imports directly into HubSpot,
Pipedrive, Salesforce, Google Sheets, Notion, Airtable, or an email-finding tool.
Your list stops being trapped in LinkedIn.

**You can share it.** Teammates without their own Sales Navigator seat can still
work the list with you.

**You can compare over time.** Run the same search next quarter, and you can see
who is new, who moved, and who left.

### What people actually use it for

- **Building an outreach list.** Search for your ideal customer, export, then
  write to them.
- **Finding work emails.** This does not give you emails, but most email-finder
  tools take a CSV of names and companies and return addresses.
- **Mapping an account.** Export everyone at one target company so you can see
  the whole team and pick the right entry point.
- **Recruiting.** Export a shortlist of candidates with their tenure and history
  already filled in.

### What it can't do

- **No email addresses or phone numbers.** These are genuinely not on the search
  page, so no extension can read them from there. Anyone who promises you emails
  straight from a Sales Navigator search is either guessing them or getting them
  from somewhere else entirely.
- **Sales Navigator only.** It does not work on normal LinkedIn search.
- **You need your own Sales Navigator account.** This reads the page you are
  already looking at. It cannot get you access you do not have.

---

## Before you install, please read this

Collecting data from LinkedIn automatically goes against their User Agreement.
Accounts and Sales Navigator seats **do** get restricted, and sometimes closed
permanently, over exactly this.

No tool can remove that risk, and any tool that tells you otherwise is lying to
you. What this one does is stay small and quiet: it only reads what the page has
already loaded, limits how much it takes per hour and per day, slows down when
LinkedIn pushes back, and shuts off completely if LinkedIn shows a warning.

**Use it on an account you could afford to lose.** And if the people you save
live in the EU, UK, or California, the data you collect comes with legal
obligations about how you store and use it.

---

## Step 1 - Install

1. Download this folder to your computer, and unzip it if needed.
2. Open Chrome and go to **chrome://extensions** - type that into the address bar.
3. Turn on **Developer mode** with the switch in the top-right corner.
4. Click **Load unpacked** in the top-left.
5. Select this folder - the one with `manifest.json` inside it - and click Open.
6. Click the puzzle-piece icon in Chrome's toolbar and pin **LinkedIn Scraper by
   mailzy** so it is always one click away.

You need Chrome 114 or newer. There is nothing to build or install beyond this.

## Step 2 - Agree, once

Click the extension icon. The side panel opens with a notice about the risks.
Read it and click **I understand - continue**.

You will only ever see this once.

## Step 3 - Use it

1. Log into LinkedIn and open **Sales Navigator**.
2. Run a people search. The web address should start with
   `linkedin.com/sales/search/people`.
3. Click the extension icon to open the side panel.
4. Look at the small grey label in the top-right of the panel. It shows how many
   people it can currently see. If it says anything else, check the table below.
5. Choose **How many pages?** Each page holds about 25 people, so 4 pages is
   roughly 100 people. Start with 2 the first time, just to see it work.
6. Click **Start**.

Now leave it alone. It scrolls down each page, saves everyone on it, waits a few
seconds, and moves on. Names appear in the panel as they are saved, so you can
watch it working.

**Keep the LinkedIn tab in front.** It pauses if you switch to a different tab.
That is on purpose. You can still use other windows and other apps.

You can click **Stop** at any time. It finishes the page it is on and stops.
Nothing you have already collected is lost.

### A worked example

Say you want every Head of Marketing at software companies in London.

Build that search in Sales Navigator as you normally would. It says 312 results.
Open the panel, set pages to **13** (13 x 25 is about 325, enough to cover them
all), and click Start. Come back in about fifteen minutes to roughly 312 people
in the panel. Click **Download CSV** and open it in Excel.

## Step 4 - Get your data

| Button | What it does |
| --- | --- |
| **Download CSV** | Saves a spreadsheet file. Opens in Excel, Numbers, or Google Sheets. |
| **Clear** | Deletes everyone saved so far and starts fresh. Cannot be undone. |

Results build up as you go. You can run one search, then a completely different
one, then download them all together as a single file at the end.

If the same person turns up in two searches, they are not duplicated. Their entry
just gets more complete.

---

## What's in the spreadsheet

One row per person, up to 45 columns:

**Who they are** - full name, first and last name separately, headline, photo,
profile link.

**Their job** - title, company, industry, company size, when they started, how
many months they have been in the role and at the company.

**Their history** - previous job title and company, full job history, years of
experience, school and subject.

**Context** - city, country, how many connections you share, whether they are a
1st, 2nd or 3rd degree connection, their About text.

**Signals** - recently changed jobs, posted recently, open to work, whether you
already saved them in LinkedIn.

Some cells will be blank for some people. That is normal. It just means LinkedIn
did not have that detail on show.

---

## If something goes wrong

| The panel says | What to do |
| --- | --- |
| "not on Sales Nav" | You are on a different website. Open Sales Navigator. |
| "open a people search" | You are in Sales Navigator, but not on a people search. Run a search. |
| "reload the tab" | Refresh the LinkedIn page (Cmd-R or Ctrl-R) and try again. |
| "Refresh this LinkedIn tab to collect the full detail" | Refresh the LinkedIn page. It still works without this, but saves fewer details. |
| "Daily limit reached" | You have hit the safety cap of 800 people. Come back tomorrow. |
| "Hourly limit reached" | Wait the number of minutes shown. |
| "LinkedIn asked us to slow down" | Nothing. It is already handling it. Let it wait. |
| "LinkedIn is asking you to log in or verify" | **Stop for today.** Log in normally, use LinkedIn like a person for a while, and do not run this again for several hours. |
| A red bar across the top | LinkedIn pushed back and it stopped on purpose. Read the message and do not immediately retry. |

**Names are saving but lots of columns are empty?** LinkedIn changed their
website. Open **Advanced**, click **Check the page**, then **Copy result**, and
send that to whoever looks after this extension. It says exactly what broke.

**Nothing happens when you click Start?** Refresh the LinkedIn tab, then open the
panel again.

---

## Advanced (safe to ignore)

Everything in this drawer is optional. The defaults are the recommended setup.

**Check the page** reads your current page and tells you whether the extension
can still find everything on it, then lists which details came back blank. Use it
when results look wrong. **Copy result** puts that report on your clipboard so
you can send it to someone who can fix it.

**Speed limits** control how long it waits between pages, how often it takes a
longer break, and the most it will collect per hour and per day.

Slower is safer. These numbers are deliberately unhurried, and raising them
raises the chance LinkedIn notices you. The daily and hourly limits keep counting
even if you close Chrome, and **Clear** does not reset them. That is on purpose.

**Restore defaults** puts everything back the way it was.

---

## Common questions

**Will this get my account banned?**
It might. That is not a comfortable answer, but it is the honest one. The safety
limits genuinely reduce the risk, and the defaults are cautious. They do not
remove it, because LinkedIn watches your activity on their own servers, where no
extension can reach. Use an account you could afford to lose.

**Does my data go anywhere?**
No. Everything stays inside Chrome on your own computer until you download it.
This extension has no server and sends nothing anywhere.

**Why does it pause when I switch tabs?**
On purpose. A browser that keeps working while you are apparently away looks more
like a robot than one that stops. You can use other windows freely.

**How many people can I collect in a day?**
800 by default, across a maximum of 90 pages an hour. Both are adjustable under
Advanced, and both are there to protect you.

**Can I combine two searches?**
Yes. Run one, then run the other, then download once at the end.

**How long does it take?**
Roughly a minute per page, including the waiting. So about 25 people a minute,
and a longer break every 8 pages.

---

## For developers

Manifest V3, no build step, no dependencies.

`src/content/` holds the page-side logic: `interceptor.js` watches the data
LinkedIn's own page already requests, so no extra network calls are made, and
`dom-extract.js` reads the visible page as a fallback. `src/lib/` handles parsing
and the field list. `src/sidepanel/` is the interface.

When LinkedIn changes their site, the two things to update are the selectors in
`dom-extract.js` and the endpoint pattern in `interceptor.js`. The in-panel page
check reports which of the two stopped working.
