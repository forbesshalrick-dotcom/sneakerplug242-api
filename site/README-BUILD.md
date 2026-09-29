# Agency site — build notes

Static site. No framework, no build step. Open `index.html` and it works.

---

## ⚠️ Read this first: three placeholders are still in the code

The **name is settled — Nightshift**, confirmed 9 Aug 2026. Three things are still placeholders, and swapping each is one command.

| What | Placeholder in the code | Status |
|---|---|---|
| Agency name | `Nightshift` | ✅ **Confirmed.** Brand mark is a clock (hands at 2 o'clock). |
| Domain | `nightshift242.com` | Placeholder |
| WhatsApp number | `12424481632` | Nightshift's line — a real 242 Bahamian number, on the ordinary WhatsApp app so wa.me works and Rodney answers by hand. Do NOT put it through Meta's setup; that would lock it out of the app. |
| Email | `hello@nightshift242.com` | Placeholder |

### About the WhatsApp number

This was `1242XXXXXXX` — an invalid number on purpose, so a stranger's phone never started receiving Rodney's enquiries. It is now the real number, **+1 929 556 4851**. Note it is a US (New York) number, not a 242; if a Bahamian number replaces it later, the swap is one command.

### Swapping them — run these from inside the site folder

```bash
cd ~/agency-site

# 1. Agency name  (replace "Nightshift" with yours)
grep -rl "Nightshift" . --include="*.html" --include="*.css" --include="*.js" --include="*.md" \
  | xargs sed -i '' 's/Nightshift/YOUR NAME HERE/g'

# 2. Domain
grep -rl "nightshift242.com" . --include="*.html" --include="*.xml" --include="*.txt" \
  | xargs sed -i '' 's/nightshift\.bs/yourdomain.com/g'

# 3. WhatsApp number  (digits only, country code first, no + and no spaces)
grep -rl "12424481632" . --include="*.html" \
  | xargs sed -i '' 's/12424481632/<the new number>/g'

# 4. Email
grep -rl "hello@" . --include="*.html" \
  | xargs sed -i '' 's/hello@yourdomain\.com/you@yourdomain.com/g'
```

Do the name **first** — the email and domain placeholders contain it.

### Two things `sed` can't do for you

1. **The OG share image and the four MP4s** have the name drawn into them as pixels. Ask me to re-render them if the wording ever changes.
2. **The favicon** is the clock mark in `assets/img/favicon.svg` — name-independent, so it needs nothing.

---

## Also still to fill in

- **Case study numbers** — `case-study.html` has four stat boxes showing dashed orange "to confirm" tokens. They are meant to look unfinished. The real figures are in your own systems (`/last` logs, the sales log, the shop backend) and I can pull them once you point me at the right window of time.
- **Screenshots of Jess** — there is a marked block near the bottom of `case-study.html` waiting for them. Real screen recordings will sell that page harder than any copy on it.
- **Business Licence and NIB numbers** — referenced on the site and in the proposal template footer, not printed anywhere yet.
- **Testimonial slots** — three empty seats on `about.html`. They stay empty until real founding clients say real things.

---

## What's in here

```
agency-site/
├── index.html          home
├── services.html       five tiers expanded + add-ons
├── pricing.html        published price table + terms
├── case-study.html     THE PLUG 242 — the page that does the selling
├── about.html          why we started + founding client seats
├── contact.html        qualifying form + WhatsApp
├── 404.html
├── robots.txt
├── sitemap.xml
├── assets/
│   ├── css/site.css    all styling, tokens at the top
│   ├── js/site.js      nav, hero conversation, form
│   ├── fonts/          IBM Plex Mono + Archivo, self-hosted (72K)
│   └── img/            favicon.svg, og.png
└── docs/
    ├── proposal-template.md
    ├── founding-client-offer.md
    ├── contract-skeleton.md      ← attorney must review
    └── discovery-questions.md
```

---

## How the contact form works

There is **no server and no database**. The form gathers the six answers, builds a WhatsApp message out of them, and opens WhatsApp with it typed and ready to send.

Why this way:

- It works on any host — GitHub Pages, Netlify, anywhere. No backend to keep alive.
- Enquiries land in the inbox you already read all day instead of a dashboard you'll forget.
- Nothing is stored on the site, so there's no database of customer details to look after.
- No form-spam problem, because there is nothing to spam.

The Netlify Forms attributes are still on the `<form>` tag, so if the site is ever hosted on Netlify the form will also post there as a backup with no code changes.

---

## Deploying

Netlify CLI is **not** installed on this Mac, and your Netlify account got paused for bandwidth once already — which is why 242plug moved to GitHub Pages. I'd put this on **GitHub Pages** too: free, no bandwidth ceiling, same setup you already know.

```bash
cd ~/agency-site
git init && git add -A && git commit -m "Agency site"
gh repo create <repo-name> --public --source=. --push
# then: repo Settings → Pages → Deploy from branch → main → /(root)
```

For a custom domain, add a `CNAME` file containing the bare domain and point the DNS at GitHub Pages — the same four A records you set up for 242plug.com.

**Do not deploy until the WhatsApp number is real.**

---

## The demos — your strongest sales asset

`/demos/` holds four working preview sites, one per trade, plus a showroom index. **Every bot in them genuinely works** — it holds state, keeps a running total and prints a real quote. Not a video, not a click-through mockup.

| Demo | Fictional business | What its bot does | Its look |
|---|---|---|---|
| `demos/bfc/` | BFC · Bahamas Fried Chicken | **Numbered combos** — send "2", pick a side, extras, pickup branch or delivery branch | Anton, red + gold stripe, food photography |
| `demos/estate/` | Fitzwilliam & Cay | **Qualifies a buyer** — purpose, budget, island, space, timeframe — then matches the portfolio and names the fits | Near-black + champagne, Cormorant, cinematic slow-push hero |
| `demos/car-rental/` | Out Island Auto | Vehicle → days → airport/hotel delivery → extras → priced booking | Oswald condensed, deep blue, real vehicle photography |
| `demos/restaurant/` | Blue Hole | **Branches**: table (covers → night → wine pairing → allergies) *or* collection (boxed order → time) | Two-star dark: near-black, brass, Cormorant, full-bleed food |
| `demos/salon/` | Verandah House | Category → treatment (list **changes to match** the category) → add-ons → therapist → slot → 25% deposit | Ivory + sage, Cormorant, soft 16px corners, room photography |
| `demos/print-shop/` | Press 242 | **Design all four sides**, drag the artwork into place, then the bot prices every printed side | Anton, black + yellow, square |

### Photography and licensing

All demo photography is openly licensed, sourced through the Openverse API and stored as WebP in each demo's `img/`. The first batch is CC0 / public domain (no credit needed); the later batch includes **CC BY**, which requires attribution — that is what `demos/credits.html` is for, and every demo footer links to it. **Don't delete that page.**

Screened out deliberately: anything with a recognisable face, and anything showing a real brand. One catch worth knowing — the first BFC hero had **Popeyes packaging visible in it**, which is exactly the kind of thing that cannot ship on a fictional competitor's site. It was replaced and all nine BFC images were re-checked on a contact sheet.

### The shirt designer (`demos/assets/designer.js`)

Four views — front, back, left sleeve, right sleeve — each holding its own artwork. Six garment colours, five graphics, four lettering faces, a text size and a graphic size, and the artwork is **dragged into position** (arrow keys nudge it, so it works without a mouse). Sides that have print on them are published to `window.SHIRT.sides`, and the bot charges B$4 per extra printed side.

The sleeves are drawn as **flat sleeve panels, not side profiles** — a true side-on tee renders as an unreadable sliver, and the sleeve panel is what you actually print on.

To swap in a client's own photos, drop them in the same `img/` folder with the same filenames. Sizes are in the `<img>` tags — keep them accurate or layout will shift.

Worked examples that were actually tested end to end:
- Jeep, 3 days, airport, full insurance → **B$354** (95×3 + 18×3 + 15) ✓
- Table for 4, Friday, wine pairing, shellfish allergy → **B$1,120** (185×4 + 95×4) ✓
- Collection: lobster pasta + aged beef, 8pm → **B$110** ✓ (table-only steps correctly skipped)
- Hot stone 90 + aromatherapy, Renée, Thursday → **B$235**, deposit **B$59**, 1h 30m ✓
- BFC: Family Bucket × 2, mac side, extra side, delivery → **B$80** ✓
- Press 242: 30 shirts, three printed sides, rush → **B$863** (450 + 2 extra sides × 30 × B$4 + 25%) ✓
- 30 navy shirts, front+back, rush → **B$713** (15×30 + 4×30 + 25%) ✓, with the visitor's own text and graphic read out of the designer

### How it's put together

- `demos/assets/demo.css` — shared skeleton only. Each demo sets its **own** tokens (`--d-accent`, `--d-display`, `--d-radius`…) in a `<style>` block on its page. That's why they don't look like four copies of each other.
- `demos/assets/bot.js` — the engine. Knows nothing about cars, food, hair or shirts. Each demo passes `steps` and a `summarise()`. A step can carry `when(answers)` to skip itself, which is how one bot runs two different paths (Blue Hole's table vs collection), and `options` can be a function of the answers so far, which is how Verandah House swaps its treatment list per category.
- `demos/assets/designer.js` — canvas shirt customiser. Publishes to `window.SHIRT`, which the print-shop bot reads.

### The bots hold a conversation, not just a form

`bot.js` resolves free text in this order, and the order is the point:

1. **Is it an answer?** Accent-folded, punctuation-stripped matching with number words ("two" → 2), glued numbers ("2pm" → 2:00 pm), digit prefixes ("number 2" → "2 — Family Bucket") and word overlap ("deep tissue" → "Deep tissue 90"). The multi-select **done** button is a match candidate too — without that, "just the treatment" scored against *Scalp treatment* and silently added it.
2. **Is it a question this business answers?** Each demo carries a `knows:` list — opening hours, delivery, parking, allergies, licence rules, turnaround, fees. It answers properly, then nudges back to the flow.
3. **Is it just a human being human?** Greetings, thanks, "are you a bot", "let me speak to someone", and frustration ("this is stupid") — all handled in the engine, so every demo gets them.
4. **Otherwise**, a rotating apology that never repeats back-to-back, and after three misses it **offers a person**.

It also reads a whole sentence at once. *"Can I get 2 family buckets delivered"* fills the combo, the quantity **and** the delivery choice in one go — `autofill()` looks ahead at every remaining step and takes anything scoring 80+. Answer a question it hasn't asked yet ("peas n rice" while it's asking quantity) and it banks that too. Matching folds accents, stems loosely (delivered/delivery, bucket/buckets) and maps digits to words both ways so "2" finds an option called "Two".

Two traps worth remembering: a step's `when()` guard can throw during look-ahead because the answer it depends on doesn't exist yet — it's wrapped in try/catch, and without that the whole message handler died silently. And the multi-select **done** button must be a match candidate, or "just the treatment" quietly adds *Scalp treatment* to the bill.

This came out of a real complaint: typing "hello" and then "what's on the menu?" got the same curt line twice — *"Just the number, boss — 1 through 8."* On a page selling customer service, that was the worst possible bug. A full booking can now be completed by typing only, no buttons touched.

### Galleries open full screen

`demos/assets/lightbox.js` — put `data-lightbox="<group>"` on any image or wrapper and it becomes clickable: full-screen viewer, arrows, keyboard, swipe, counter, caption. Optional `data-full` and `data-caption` override the source and label, which is how **Blue Hole's menu rows open the actual dish** rather than just sitting there as text. Wired into the salon mosaic, the restaurant plates and menu, the estate gallery and listings, the car fleet and the BFC board.

### Car photography is model-accurate

The first pass labelled a **Ford Taurus as a Toyota Corolla**, which is exactly the sort of detail that loses a client's trust. The fleet is now the five vehicles actually rented in Nassau — **Nissan March, Honda Fit, Toyota Corolla, Jeep Wrangler, crew pickup** — each with a photograph of that real model (verified against the source titles).

### Adding a fifth trade

Copy the closest demo folder, change the tokens in its `<style>` block, rewrite `steps` and `summarise()`, then add a card to `demos/index.html` and the home page. No engine changes. Construction/hardware and a pharmacy are the obvious next two.

### Two deliberate choices

1. **Every demo has a loud black ribbon at the top** saying the business is fictional and nothing takes a real order. Do not remove it — a demo that could be mistaken for a real shop, or that looks like it took someone's money, is a real problem.
2. **The four demo pages are `noindex`.** Lighthouse flags this as "blocked from indexing" — that's intended, not a bug. They shouldn't compete with your real pages in search. The showroom at `/demos/` **is** indexed and is in the sitemap.

## Shareable videos — `assets/video/`

Four vertical MP4s (720×1280, ~10s, ~150 KB each) for WhatsApp, Instagram and Facebook: `bot-restaurant.mp4`, `bot-salon.mp4`, `bot-car-rental.mp4`, `bot-print-shop.mp4`. Each opens with a hook, plays a real WhatsApp thread typing out, and ends on a Nightshift card.

**How they were made** (repeat any time the copy changes): a build tool called `_reel.html` renders the conversation as a *pure function of time* — `?trade=x&start=0&n=8&step=67` lays out 8 stacked frames at exact timestamps, so nothing is caught mid-animation. `make_reels.py` (in the session scratchpad) screenshots those filmstrips, slices them with Pillow and encodes with a pip-installed ffmpeg (`pip install --user imageio-ffmpeg` — there is no system ffmpeg on this Mac). `_reel.html` is deleted after each render; recreate it from git history or ask for it again.

## Behind the message — `behind-the-scenes.html`

The machine room, built to **the real shape of a Plug 242 conversation** — not a generic checkout:

1. Customer: *"Yo you have any blackwork shoes?"* — no code, no size, typo included
2. Bot normalises `blackwork` → black + work shoe, notices **no size was given**, and asks for it *before* sending anything
3. Customer: *"size 10"* → the search runs **visibly**: all 40 tiles sweep, then dim out filter by filter (40 → 13 black → 6 work → 4 with a size 10)
4. Bot sends the **album — one photo, one label underneath** (A6 / B2 / C4 / D1) and says to pick a label
5. Customer types `A6` → resolved to the shoe, price, size; held 15 minutes
6. Pickup or delivery → delivery → address → zone detected, **staff WhatsApp alert**, driver assigned
7. Stock write `A6 −1`, inventory drops 3 → 2, order number issued and logged

Three panels move together: the WhatsApp thread, the **stock scanner** (the 40-tile shelf physically filtering down), and the inventory table. Play / Step forward / Restart are all wired so it can be driven at a client's pace in a pitch.

**Numbers are derived, not typed.** `N_BLACK` / `N_WORK` / `N_HIT` are computed from the `SHELF` array, so the log lines can never drift from what the grid shows — an earlier version claimed "9 black / 5 work" while the filter actually found 13 and 6. Edit `SHELF` and every count follows.

## Verified, not assumed

Run on 8 Aug 2026 against a local server, headless Chrome:

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| index | 100 | 100 | 100 | 100 |
| case-study | 100 | 100 | 100 | 100 |
| pricing | 100 | 100 | 100 | 100 |
| contact | 100 | 100 | 100 | 100 |

Also checked: every page measured in a true 375px viewport with **zero** elements overflowing the body (the pricing table scrolls inside its own container, as intended); every internal link resolves to a file that exists.

Three real bugs were found and fixed during that pass, worth knowing about because they'd have come back otherwise:

1. **The nav button lost its padding.** `.nav a` (specificity 0,1,1) was beating `.btn` (0,1,0), so the CTA's text spilled out of its orange box. Fixed with an explicit `.nav a.btn` rule.
2. **White text on the vivid orange was 3.36:1** — below the 4.5:1 minimum. Any orange with red at 255 mathematically cannot pass against white, so there are now two orange tokens: `--accent` (#FF4A1C) for marks and large display type, `--accent-strong` (#D63F10, 4.59:1) for anything filled that carries white text. The vivid orange still appears exactly where you see it — the headline dot, the eyebrow squares, the registration marks.
3. **Chat timestamps were white at 55% opacity** over orange — 2.33:1. Now explicit colours per bubble side.

## Design notes

Tokens live at the top of `assets/css/site.css`. Both light and dark themes are defined there.

- **White ground, orange rationed** to three places only: buttons, the bot's chat bubbles, and the hairline registration marks. Adding orange anywhere else weakens it.
- **IBM Plex Mono** for display — the typewriter DNA you asked for, drawn sharp. **Archivo** for body.
- **Square corners and 1px hairlines** throughout. No rounded cards, no drop shadows except the one on the chat panel.
- **One animation on the whole site:** the hero conversation typing itself in. `prefers-reduced-motion` is respected — it renders instantly instead.

### Why the home hero is not sneakers

The visitor is a restaurant or a salon, not a sneaker shop. If the demo they land on is shoes, they have to do the translation work themselves, and most won't bother. So the home hero has **three trades they can switch between** — restaurant, salon, auto parts — each a full conversation with the closing move that trade actually needs (hold two dinners, book Tuesday, hold it at the counter).

The **case study keeps the sneaker conversation**, because that page is the proof and it has to be genuinely ours. The home page now says so out loud: *"The shop happens to sell sneakers. The system does not care what you sell."*

Conversations live in the `DEMOS` object at the top of `assets/js/site.js` — add a trade by adding an entry and a button. The first one is also written into `index.html` as plain HTML so the panel still reads with JavaScript switched off.
