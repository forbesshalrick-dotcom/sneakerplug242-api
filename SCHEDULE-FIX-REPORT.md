# Schedule page — what was wrong and what changed

**Date:** 9 August 2026
**Files touched:** `shop.js`, `server.js`, `storefront.html`, `package.json`, `shifts.json` → `shifts.legacy.json`
**Status:** built and tested locally. **Not deployed** — nothing has been pushed.

---

## 0. Ground truth first (read this bit, it changes the picture)

### 242plug.com is served from Railway, not GitHub Pages

The live site's response headers say `server: railway-hikari`, `x-powered-by: Express`.
The HTML comes from **`~/sp242-api/storefront.html`**, which `server.js:6839` reads at boot
and rewrites four things in before serving (`serveStore`, around line 6853):

| rewritten at serve time | from | to |
|---|---|---|
| web app manifest | `manifest.json` | `/store/app.webmanifest` |
| the 3 icons | local paths | jsDelivr CDN |
| service worker | `navigator.serviceWorker.register(...)` | a no-op |

Two other copies of this page exist on the Mac and **neither is live**:

- `~/untitled folder 3/index.html` — 615 lines behind the live site
- GitHub Pages repo `forbesshalrick-dotcom/242plug` — 222 lines behind the live site
  (it is missing `_requireDelete`, the Restore nav button, and sizes 4 / 4.5 / 5)

Editing either of those would have shipped nothing. All the work below is in `sp242-api`.
**Deploy = push `sp242-api` to `main`; Railway redeploys.**

### The main card and the popup were NOT reading different stores

The work order expected two data sources. There weren't. Both views read the same
`localStorage.sp_shifts`. What differed was the **rule each one rendered by**, and neither
said whose view it was:

- `renderSchedulePage()` — the main card — drew **only the logged-in person's own slots**.
  Logged in as Manager, that means only the *gaps*. It was structurally incapable of ever
  printing an employee name. That is Bug 1's actual cause.
- `renderSchedulePopup()` — drew **everybody's assigned shifts**, so only Deashinique's rows.

Checked against the Friday 7 August evidence:

| | main card | popup | what was true |
|---|---|---|---|
| Fri Aug 7 morning | (not shown) | Deashinique 8am–3pm | Deashinique was rostered |
| Fri Aug 7 evening | Manager 3pm–10pm | (not shown) | nobody rostered → Manager |

Both were telling the truth about different halves of the same day. Same for Wed and Thu.
Nothing was contradicting anything; the page just never showed a whole day at once.

### There was a third copy nobody mentioned

`sp242-api/shifts.json` on the server, read only by the evening "you work tomorrow"
WhatsApp reminder (`server.js:3191`). I diffed it against the page's data — they agreed
exactly — but nothing *made* them agree. Two lists, kept in step by hand.

### And shifts never left the phone

Notes, sales, the audit log and inventory all sync through the `/shop` backend
(`shop.js`). Shifts did not. They lived in `localStorage` only, re-seeded from a
hardcoded array baked into `storefront.html` **twice** (an IIFE, plus `getPreloadedShifts()`),
with a third dead renderer (`buildSchedulePopup()`) that nothing called.

So a schedule "uploaded" on the manager's phone could never have reached anyone else's,
even if the upload had worked.

---

## 1. What I changed

### One source of truth: the shared schedule on the server

`state.shifts` in `shop.js`, persisted to `/data/shifts.json` on the Railway volume,
alongside notes/sales/inventory. Shape:

```js
{ id: "2026-08-09|Deashinique|evening", date: "2026-08-09",
  employee: "Deashinique", type: "morning" | "evening" }
```

**Why the server and not localStorage:** it is the only copy every phone, and the WhatsApp
reminder, can all see. A schedule the manager imports now reaches the whole team and Kiki
at once. Production has a persistent volume attached (`/shop/state` reports
`persistent: true`), so it survives redeploys.

**The rule, written once** (`shop.js` `dayRoster()`, `storefront.html` `buildWeekModel()`):

> A slot with an employee assigned belongs to that employee.
> A slot with nobody assigned is covered by the Manager.

A day with no records is therefore not missing data — it is a full Manager day. **That is
also exactly what an OFF day looks like**, which is why OFF days need no storage: they *are*
the absence of a record.

### What happened to the other copies

| copy | what I did |
|---|---|
| `localStorage.sp_shifts` | kept, but demoted to an **offline cache** of the server list. Every write goes to the server first; the server wins on every sync. |
| hardcoded seed in `storefront.html` (×2) | **deleted** — 66-line IIFE and `getPreloadedShifts()` |
| dead `buildSchedulePopup()` | **deleted** — 64 lines, nothing called it |
| `sp242-api/shifts.json` | **migrated once, then retired.** Renamed `shifts.legacy.json` and annotated. On first boot with no `/data/shifts.json`, its 22 real shifts convert to records; after that it is never read. Safe to delete once production has booted. |

I renamed rather than deleted it outright so a fresh/detached volume still has the July
data to seed from. It is no longer a store — it is a migration fixture, and says so inside.

### The WhatsApp reminder now reads the same list

`server.js` used to `require('./shifts.json')` at boot. It now calls
`require('./shop').getShifts()`. Two improvements fell out:

- Somebody on **both** slots gets **one** message listing both sets of hours (before, the
  old object shape could only hold one time range per person per day).
- "Manager" rows are skipped — the Manager is the fallback who covers unassigned slots, not
  a rota entry to text about.

---

## 2. The bugs

### BUG 1 — main card ignored employee assignments ✅

Both views now render from **one** `buildWeekModel(offset)` that returns all 7 days × both
slots, each already resolved to a person. The card and the popup call the same function, so
they cannot disagree again. A rostered name shows in white (yours in green); a fallback
shows in grey marked *(covering)*, so "Manager" now carries information — nobody is
rostered here — instead of appearing on every row.

The Manager fallback is intact, just correctly scoped to the slot instead of the whole view.

### BUG 2 — PDF upload failed silently ✅

The old `handleScheduleUpload()` did this, in full:

```js
status.textContent = '✓ Schedule PDF uploaded: ' + file.name;
localStorage.setItem('sp_schedule_pdf_name', file.name);
showToast('✓ Schedule uploaded: ' + file.name);
```

It stored **the filename**. It never opened the file. There was no parser to find — it had
never been written. It always claimed success, which is why nothing changed and no error
appeared.

Now: the file is sent to `POST /shop/shifts/upload` and parsed **on the server**, so there
is one parser and a PDF the phone can't read still imports.

- **Accepts `.json`, `.csv` and `.pdf`** (plus `.txt`/`.tsv`). JSON was added as asked —
  it is the sturdy path; PDF text extraction is inherently fragile.
- **States: reading → importing → result.** Success names a real count and range:
  `✅ Imported 54 shifts for Deashinique, Aug 9 – Oct 10`, plus how many older shifts it
  replaced and any rows it had to skip.
- **Failure always names the reason** and writes nothing.
- **The page re-renders immediately** — the client re-pulls the shared list and redraws. No
  refresh.

#### The exact format the parser accepts (also written on the page itself, behind "What should the file look like?")

Six columns, one row per calendar day:

```
Employee | Day | Date | Start | End | Shift

Deashinique   Sunday   Aug 09, 2026   3:00pm   10:00pm   Night
Deashinique   Monday   Aug 10, 2026   -        -         OFF
```

- **Dates:** `Aug 09, 2026`, `August 9 2026`, `9 Aug 2026`, or `2026-08-09`
- **Times:** `8:00am` / `3:00pm`, or 24-hour `08:00` / `15:00`, or bare `8am`
- **Off days:** `OFF` in the Shift column with `-` for Start and End. They import as *no
  record*, which is what makes the Manager cover both slots that day.
- **Morning vs evening is decided by the START time** (before noon = 8am–3pm slot), *not*
  by the word in the Shift column — that word is only a label and people rename it.
- Header rows and title lines are ignored. A line with no date is ignored.
- CSV quoting is handled, because `"Aug 09, 2026"` has a comma in it.

**Your file's layout imports as-is. No regeneration needed.**

JSON, exactly the shape in the work order:

```json
{ "staff": "Deashinique", "period_start": "2026-08-09", "period_end": "2026-10-10",
  "shifts": [ { "date": "2026-08-09", "day": "Sunday", "staff": "Deashinique",
                "shift": "Night", "start": "15:00", "end": "22:00", "hours": 7 } ] }
```

**Import is scoped, not destructive.** It replaces only *those people's* shifts *between the
first and last date in the file*. Importing Deashinique's Aug–Oct sheet never touches July
and never touches anyone else's rows.

### BUG 3 — "duplicate" rows and OFF days ✅

**They were not duplicates.** Mon Aug 3 and Sun Aug 9 appeared twice because nobody was
rostered on either slot those days, so the Manager covered *both* — two real rows. Tue–Sat
showed once because Deashinique held the other slot. The view just never said which slot a
row was, so two legitimate rows read as a doubled record.

Every day now renders **exactly two labelled slots** — `☀️ 8am–3pm` and `🌙 3pm–10pm` —
every day, whoever is on them. Verified: 7 days, slot counts `2,2,2,2,2,2,2`.

OFF days do not vanish. Verified against the imported file: Mon Aug 10 is an OFF day and
renders `Manager (covering)` on **both** slots.

De-duplication is also enforced server-side on `date+employee+slot`, and assigning someone
to a slot replaces whoever held it — one person per slot, so a re-import cannot double a
day up.

### BUG 4 — week window ✅

The week was already derived from `new Date()`, so it was not pinned — but it could not be
paged, and it had a real timezone bug: the old code built dates with
`new Date().toISOString().split('T')[0]`, which is **UTC**. In Nassau (UTC−4) that rolls
over to tomorrow at 8pm, so every evening the page could sit on the wrong day and, on a
Sunday evening, the wrong week entirely.

- All date maths now uses a local-calendar `ymd()` helper. No `toISOString()`.
- Monday is computed at midday to stay clear of DST edges.
- `‹` / `›` page the week; a "back to this week" link appears once you have moved off it.
  The popup pages too, and shares the same pointer, so the page and the popup stay on the
  same week as each other.
- Offset is always relative to *today*, so the page rolls into the new week on its own and
  an imported schedule months ahead is reachable by paging.

---

## 3. What I actually ran

Chrome's extension wasn't connected, so I could not click the real site. Instead I ran the
**real shipped code** — the schedule block and popup block are lifted verbatim out of
`storefront.html` at test time, not re-implemented — inside a jsdom DOM using the page's own
markup, talking to the **real `shop.js` routes** on a local Express server.

Harness: `scratchpad/render-test.js`, `render-test2.js`, `testsrv.js`, `make-fixtures.js`.
Fixtures: a 63-calendar-day Aug 9 – Oct 10 schedule (54 work shifts, 9 Mondays off) as
JSON, CSV and a real PDF, plus deliberately broken files.

| check | result |
|---|---|
| main card and popup identical for the same week | ✅ all 7 days, both slots |
| a day with an employee assigned shows the employee | ✅ Fri Aug 7 morning → Deashinique |
| a day with no assignment shows Manager | ✅ Fri Aug 7 evening → Manager |
| an OFF day shows Manager on BOTH slots | ✅ Mon Aug 10 |
| two slots per day, not duplicate records | ✅ 7 days × 2 |
| JSON upload → success with a real count, no refresh | ✅ 54 shifts, Aug 9 – Oct 10 |
| PDF upload → same result | ✅ 54 shifts, via real pdf-parse extraction |
| CSV upload → same result | ✅ 54 shifts |
| broken JSON → visible error naming the reason | ✅ names the parse position |
| unsupported file type → visible error | ✅ names the extension |
| empty / unreadable PDF → visible error | ✅ tells you to use JSON/CSV |
| nothing is written on a failed import | ✅ store unchanged after every failure |
| paging forward lands on the right week | ✅ Aug 3–9 → Aug 10–16 → back |
| current week derives from today's date | ✅ ran on Sun 9 Aug, landed on Aug 3–9 |
| employee's view matches the manager's | ✅ Deashinique sees the same week |
| add a shift by hand → shows the name | ✅ and the other slot stays Manager |
| remove it → slot returns to Manager | ✅ |
| on-duty lookup uses the same rule | ✅ |
| all 7 inline script blocks parse | ✅ 0 syntax errors |

Reasoned about but **not** executed: the live Railway deploy, the 6pm WhatsApp reminder
firing (it is on a 10-minute timer gated to the 18:00 Nassau hour), and iOS Safari
rendering.

---

## 4. Left over

- **Nothing is deployed.** `sp242-api` has uncommitted changes. Push to `main` to ship.
- **`pdf-parse` was added to `package.json`** — Railway installs it on deploy.
- **`shifts.legacy.json` can be deleted** after production boots once and
  `/data/shifts.json` exists.
- **`~/untitled folder 3/index.html` and the `242plug` GitHub repo are still stale** — they
  were already behind before this work and I did not touch them. Worth deciding whether to
  keep them at all; right now they are three copies of a page with one live one, which is
  how this kind of confusion starts.
- The **day-off request** feature still stores requests in `localStorage` only
  (`sp_dayoff_requests`), so it has the same "never leaves the phone" problem the schedule
  just got fixed for. Out of scope here, but it is the next one.
