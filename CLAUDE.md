# SNEAKERPLUG242 API — read this before you touch anything

This repo is Rodney's **live business**. The bot in here (Kiki/Jess) is talking to paying
customers on WhatsApp right now, and `storefront.html` is the app his staff run the shop on.
There is no staging environment. Everything below is a lesson that cost him money.

## ⚠️ You are probably not the only Claude in this folder

Rodney regularly runs **several sessions against this same checkout at once** — not separate
copies, the same working tree. Sessions have committed each other's half-finished work with
`git add -A`.

- **Run `git log --oneline -5` before assuming the tree is yours.**
- An **empty `git status` right after you edited files** means someone else just committed them.
- `git add <specific files>`, never `git add -A`.
- Cross-session `SendMessage` needs Rodney to approve it in the other window, and it expires.
  Don't plan around getting a reply.

## 🚨 A push to `main` is a live deploy

Railway redeploys on push, which **restarts the server and kills any photo album mid-send**.
A customer gets half an album and nothing else. Before pushing:

```bash
curl -s "$API/last?key=$DEBUG_KEY" | grep -o 'album-done' | head
```

Wait until the last `album-done` / `inbox-send-shoe` is **8+ minutes** old. Albums drain slowly
through ManyChat — a 12-photo album has taken ~6 minutes.

## 💾 Never hand-roll a stock write. Use `count.js`.

`POST /shop/shoe` answers `{ok:true}` for **six different outcomes**, three of which store
**nothing** (`skipped: deleted | stale | resurrection-guard`) and one of which silently drops
sizes (`stripRevertedSizes`). Any caller doing `if (res.ok)` cannot tell a save from a refusal.

This is the actual cause of the "stock keeps reverting" complaint. It was never reverting —
counts were reported saved and never arrived. Proven 2026-08-15: `asicsblk001` had **3 writes
ever** in its full audit, and 0 reverts were blocked across the last 1000 writes.

```bash
node count.js <shoeId> 7 7 7.5 8 8 8.5    # one entry per PAIR, always MEN'S
node count.js <shoeId> --dry              # show current, write nothing
node why.js  <shoeId>                     # every write accepted/refused, in plain English
node next.js / node ok.js                 # the full shelf-count worklist
```

`count.js` writes, then **reads the shoe back off the server and compares size by size**. It
sets the two fields a write dies without: `_manualEdit: true` (or a grown size is clamped as a
suspected revert) and a fresh `updatedAt` (or the push is refused as "timeless").

**Never tell Rodney a count is saved without a read-back.**

## 📸 Album rules (learned the hard way)

- **`ALBUM_MAX_PHOTOS` is off on purpose.** It shipped 2026-08-05 and took live albums to
  `sent=0` — customers got nothing. Do not re-enable it without testing off live chats.
- ManyChat's ceiling is real: **6-8 shoes deliver perfectly, 60+ becomes a ghost storm.**
  ManyChat answers `200 success` for every image and delivers none of them. An 86-shoe album
  jams that account for an hour and blocks everyone queued behind it.
- ManyChat's `400 "Subscriber does not exist"` is a **lie** — it delivers anyway. Don't retry
  on it.

## 🤐 Why the unified inbox goes deaf

When Rodney replies **by hand in WhatsApp**, ManyChat pauses automation for that contact and
**stops calling this server entirely** — so the customer's replies are never even recorded, and
his inbox shows his own side of the conversation and none of theirs. Not a bug in our code.
Replying **from the inbox** instead keeps messages flowing (our own `setHumanPause`, 45 min,
still stops Kiki talking over him).

## Sizes

Flat list of strings, **one entry per pair, always MEN'S**. Women's are converted on the way in
(women's − 1.5 = men's). A literal `"W8"` would `parseFloat` to `NaN` and make the pair
invisible and unsellable.

## Endpoints worth knowing

| | |
|---|---|
| `/shop/state?key=` | everything: shoes, sales, notes |
| `/shop/audit?key=&id=<shoeId>&limit=1000` | **per-shoe history — always pass `id`**, it defaults to 100 rows across ALL shoes |
| `/last?key=<DEBUG_KEY>` | the bot's request log — `&q=<phone>` to filter |

Keys default in-code (`shop.js`, `server.js`) and are overridden by env vars in Railway.

## Talking to Rodney

Plain everyday language, no jargon — he's new to code and learning through this. Give him the
"why". He works overnight; never suggest he rest or leave it until tomorrow. When he calls out
stock by voice, **always echo back a per-size table plus the total pairs** so he can check it
against the shelf, and flag any size that silently disappeared.
