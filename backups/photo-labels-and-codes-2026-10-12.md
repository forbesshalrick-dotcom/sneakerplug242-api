# Removed from server.js on 2026-10-12 (photo labels / order codes) — kept for revert

Git has the full history too: `git show e51ea1c:server.js`.

## server.js lines 2495-2538 (at commit e51ea1c)
```js
  // WhatsApp images carry NO caption (ManyChat drops it), so the label has to be
  // its own text bubble sent right after the photo. That also stops WhatsApp from
  // clumping the photos into one album, so each pic shows with its label beneath.
  // photosOnly=true flips that on purpose (staff request 2026-07-14): NO label
  // bubbles and NO closing line — bare images clump into one WhatsApp album, which
  // saves as a group on staff phones and forwards to a customer in ONE tap.
  // womens=true → show BOTH sides of the conversion so she sees her women's size
  // AND the men's size it actually is ("a men's 5.5 is a women's 7"), no confusion.
  const labelText = (s) => {
    // Price in WhatsApp BOLD — just the price (Rodney 2026-07-15: "some people still
    // ask for price even tho we send the price list").
    const sizeLine = womens
      ? `📏 *Women's Sizes:* ${sizesOf(s, true)}  ·  *Men's:* ${sizesOf(s, false)}`
      : `📏 *Men's Sizes:* ${sizesOf(s, false)}`;
    // ⚠️ HALF-SIZE-UP HONESTY (Rodney 2026-07-28). The size guard deliberately lets a shoe
    // through when it only carries the half size ABOVE what was asked for, so we can offer a
    // near fit — that part is wanted. What was NOT wanted: a size-8 customer got "B9 · Air
    // Jordan 1 Blue/Red — Men's Sizes: 8.5" sitting inside a "size 8" album with nothing
    // said, reading as though we had her size. Offer it, but say plainly that we don't.
    let nearNote = '';
    const want = parseFloat(wantSize);
    if (!isNaN(want)) {
      const raw = s.sizesRaw || [];
      const has = (n) => raw.some(x => parseFloat(x) === n);
      const fmt = (n) => (n % 1 === 0 ? String(n) : n.toFixed(1));
      // ⚠️ WOMEN'S HONESTY (Rodney 2026-08-04). A women's-6 album went out full of men's-6
      // shoes — a men's 6 is a women's 7.5, a size and a half too big — under the lead-in
      // "everything we have in women's 6". The search deliberately widens a women's ask to
      // the literal number as well so she isn't dead-ended by a thin size, and that stays;
      // what changes is that a pair which is NOT her size now SAYS so, the same way the
      // men's half-size-up note already does. Her women's size = our men's size + 1.5.
      if (womens) {
        if (!has(want - 1.5)) {
          const inWomens = [...new Set(raw.map(x => parseFloat(x) + 1.5))].filter(n => !isNaN(n));
          // Closest to her size; on a tie (a 5.5 and a 6.5 either side of a 6) offer the
          // BIGGER one — going up half a size wears fine, going down doesn't fit at all.
          const nearest = inWomens.sort((a, b) => (Math.abs(a - want) - Math.abs(b - want)) || (b - a))[0];
          if (nearest != null) nearNote = `\n⚠️ _Not a women's ${fmt(want)} — closest is a women's ${fmt(nearest)}_`;
        }
      }
      else if (!has(want) && has(want + 0.5)) nearNote = `\n⚠️ _No ${want} in this one — closest is ${want + 0.5}_`;
    }
    return `${displayName(s)} — ${priceLabel(s, true)}\n${sizeLine}${nearNote}`;
  };
```

## server.js lines 2753-2783 (at commit e51ea1c)
```js
  // One shoe → its photo immediately followed by its label bubble (when labelling).
  // Each photo gets a short ORDER CODE in its label (A1, A2, …) so the customer can
  // just reply with the code to pick it. Codes are assigned in send order.
  // 📉 HALVE THE MESSAGES ON A BIG ALBUM (Rodney 2026-08-05). Every shoe costs TWO ManyChat
  // messages — the photo, then its label — so 34 pairs is 68 sends in one burst. Proven live
  // today: albums of 6 and 8 shoes delivered perfectly to another customer at the same
  // moment a 34-pair album jammed Rodney's chat so badly ManyChat stopped forwarding his
  // messages in BOTH directions for 15 minutes. Small albums are fine; the burst is what
  // kills it. So above the threshold we send the pictures alone and follow with ONE list
  // carrying every code, name, price and size. Half the sends, and the list is immune to
  // ManyChat delivering things out of order — today a customer got "Here's the Dunks" with
  // New Balance photos under it, because a detached label lands wherever it lands.
  // ⚠️ OFF BY DEFAULT — Rodney 2026-08-05: "the label should be underneath each shoe."
  // The code has to sit under its own picture; that's how customers order, and a separate
  // list makes them scroll and match. The picture cap (ALBUM_MAX_PHOTOS, below) is what
  // now keeps the burst small — 15 shoes with labels is 31 messages, against 106 for the
  // 53-shoe album that jammed the queue this morning. Keep the list mode here anyway: if
  // ManyChat starts choking again, ALBUM_LIST_OVER=8 halves the sends in one env change,
  // no deploy. Set it only if delivery gets bad enough to be worth the trade.
  const LIST_OVER = (() => { const v = parseInt(process.env.ALBUM_LIST_OVER, 10); return isNaN(v) ? 0 : v; })();
  const useList = showLabels && LIST_OVER > 0 && totalPhotos > LIST_OVER;
  const listRows = [];
  const photoWithLabel = (s) => {
    if (!showLabels) return [{ type: 'image', url: s.image }];
    const code = nextPhotoCode(sub, s);
    if (useList) {
      if (!listRows.some(r => r.id === s.id)) listRows.push({ id: s.id, line: `🟢 *${code}*  ·  ${labelText(s)}` });
      return [{ type: 'image', url: s.image }];
    }
    return [{ type: 'image', url: s.image }, { type: 'text', text: `🟢 *${code}*  ·  ${labelText(s)}` }];
  };
```

## server.js lines 2886-2904 (at commit e51ea1c)
```js
  // 📋 THE ONE LIST that replaces a label under every photo on a big album (see useList).
  // Sent AFTER the pictures so the customer scrolls up from it, and split only if it would
  // blow WhatsApp's 4096-character limit. Every code, name, price and size in one place, so
  // it stays correct no matter what order ManyChat delivered the pictures in.
  if (useList && listRows.length && sent > 0 && !manualStopped && !photosOnly) {
    const header = '👆 Here\'s what\'s in those pics — reply with the *code* of the one you want 👟\n\n';
    const chunks = [];
    let cur = header;
    for (const r of listRows) {
      const line = r.line + '\n\n';
      if (cur.length + line.length > 3800) { chunks.push(cur.trimEnd()); cur = ''; }
      cur += line;
    }
    if (cur.trim()) chunks.push(cur.trimEnd());
    for (const c of chunks) {
      try { await sendChunk(sub, [{ type: 'text', text: c }], token); } catch (e) { /* non-fatal */ }
      await albumGap();
    }
  }
```

## server.js lines 2909-2930 (at commit e51ea1c)
```js
      /* 🖼️ A WAY TO SEE THE PICTURES WHEN THE PICTURES DO NOT ARRIVE (Rodney 2026-08-20).
       *
       * ManyChat is accepting images and not delivering them. Proven twice today on live
       * chats: an album of 5 came back "200 success" five times and the customer had none;
       * another was told "This is what we have in size 13 rite now 👇" and nothing followed.
       * The existing text fallback never fires because ManyChat reports SUCCESS, so the bot
       * believes it delivered and says nothing is wrong.
       *
       * TEXT always arrives — this closing line is proof, it lands every time. So it now
       * carries a link that opens the shop already filtered to exactly what she just tried
       * to send. A customer staring at a "👇" and no photos has one tap to see them all,
       * with prices and sizes.
       *
       * The site reads #size= / #q= / #brand= off the URL (getHashParams in storefront.html),
       * so this is a real filtered view, not the front page.
       *
       * ⚠️ THIS IS A PLASTER, NOT THE CURE. The cure is sending images through Meta's Graph
       * API instead of ManyChat — both retail numbers are already on the Cloud API and
       * approved. See the photo-pipe section in HANDOVER.md. */
      let closing = L(END_OF_PHOTOS_T, sub);
      // Translated whole, AFTER the link is appended, so the sentence around the URL
      // reads properly in their language. say() leaves web addresses alone.
```

## server.js lines 3160-3225 (at commit e51ea1c)
```js
// PHOTO ORDER CODES (A1, A2, … B1 …): every pic Kiki sends gets a short code in its
// label so the customer can just reply with the code to pick it — no re-describing, no
// re-sending the photo. Per sub we keep a running counter + a code→shoe map so a reply
// like "A3" resolves to that exact shoe. PERSISTED to the /data volume so a redeploy/restart
// no longer wipes them (Rodney 2026-07-13 — a customer's "C2" died after an update restart).
const photoCodes = new Map();      // sub -> { n, ts, map: { CODE -> {id,name,price} } }
const PHOTO_CODES_FILE = (() => {
  try {
    const fs = require('fs');
    for (const d of [process.env.DATA_DIR, '/data'].filter(Boolean)) {
      if (fs.existsSync(d)) return require('path').join(d, 'photo-codes.json');
    }
  } catch (_) {}
  return null; // no volume → stays in-memory like before
})();
try {
  if (PHOTO_CODES_FILE && require('fs').existsSync(PHOTO_CODES_FILE)) {
    const saved = JSON.parse(require('fs').readFileSync(PHOTO_CODES_FILE, 'utf8'));
    const cutoff = Date.now() - 12 * 60 * 60 * 1000; // restore codes still within their 12-hour life
    for (const [k, v] of Object.entries(saved)) if (v && v.ts > cutoff) photoCodes.set(k, v);
    console.log('[codes] restored photo codes for', photoCodes.size, 'customers');
  }
} catch (e) { console.log('[codes] restore failed:', e.message); }
let photoCodesSaveT = null;
function savePhotoCodes() { // debounced best-effort write
  if (!PHOTO_CODES_FILE) return;
  clearTimeout(photoCodesSaveT);
  photoCodesSaveT = setTimeout(() => {
    try { require('fs').writeFileSync(PHOTO_CODES_FILE, JSON.stringify(Object.fromEntries(photoCodes))); } catch (_) {}
  }, 1500);
  if (photoCodesSaveT.unref) photoCodesSaveT.unref();
}
function nextPhotoCode(sub, shoe) {
  const e = photoCodes.get(sub) || { n: 0, ts: 0, map: {} };
  // ONE SHOE = ONE LABEL per customer (Rodney 2026-07-14): the same navy 1906 went out
  // three times in one chat under THREE different codes (F6/H6/…) because every send
  // minted a fresh label — the customer called a code and nobody knew which was "right".
  // If this shoe already has a live code in this conversation, REUSE it.
  for (const [code, v] of Object.entries(e.map)) {
    if (v && v.id === shoe.id) {
      e.ts = Date.now();
      v.name = displayName(shoe); v.price = shoe.price; v.sizes = sizesOf(shoe);
      photoCodes.set(sub, e); savePhotoCodes();
      return code;
    }
  }
  // ⚠️ BOTH limits below used to be way too tight for how this store actually runs (Rodney
  // 2026-08-02): a customer browsed past 100+ coded photos in one chat (wide "everything in
  // my size" sends add up fast), picked "F1" — shown WAY earlier — and said stop. By then F1
  // had long since been evicted by the old 60-entry cap, so codeCtx below no longer mentioned
  // it at all; Kiki had no memory of what F1 was, never recognized the selection OR the stop,
  // and just kept dumping unrelated photos for another hour while the customer repeated
  // themselves. Each entry here is a few bytes — there's no real memory reason to cap this
  // tight. Both limits now comfortably cover the whole catalog (~370 shoes) so a code stays
  // valid for the WHOLE chat in practice instead of quietly expiring mid-conversation.
  if (e.n >= 26 * 9 * 5) { e.n = 0; e.map = {}; }     // safety wrap — effectively never hit
  e.n += 1;
  const code = String.fromCharCode(65 + Math.floor((e.n - 1) / 9)) + (((e.n - 1) % 9) + 1); // A1..A9,B1..
  e.ts = Date.now();
  e.map[code] = { id: shoe.id, name: displayName(shoe), price: shoe.price, sizes: sizesOf(shoe) };
  const keys = Object.keys(e.map);
  if (keys.length > 400) delete e.map[keys[0]];       // don't grow forever
  photoCodes.set(sub, e);
  savePhotoCodes(); // survive restarts
  return code;
}
```

## server.js lines 5044-5051 (at commit e51ea1c)
```js
  // If we recently sent this customer CODED photos, hand Claude the code→shoe map so a
  // reply like "A3" resolves to that exact shoe (works for a typed code, no photo needed).
  let codeCtx = '';
  const cc = photoCodes.get(sub);
  if (cc && cc.map && Object.keys(cc.map).length && (Date.now() - (cc.ts || 0)) < 12 * 60 * 60 * 1000) {
    const lines = Object.entries(cc.map).map(([code, v]) => `${code} = ${v.name}${v.price != null ? ` ($${v.price})` : ''}${v.sizes ? ` [sizes: ${v.sizes}]` : ''}`);
    codeCtx = `\n\n[PHOTO CODES you gave this customer — every pic you sent was labelled with its code, and the sizes shown are the ONLY sizes that shoe comes in. If their message IS or CONTAINS one of these codes, they mean THAT exact shoe: confirm it and go straight to their order — do NOT re-ask what shoe. ⚠️ If the customer states a SIZE for a code (e.g. "D9 in 7"), CHECK it against that code's listed sizes: only agree if that size is actually in the list. If it is NOT, do NOT agree — tell them that shoe only comes in [its real sizes] and offer the nearest. NEVER confirm a size that isn't in the code's sizes. ⚠️ A code that LOOKS like our format (a letter + number, e.g. "F1") but is NOT in the list below is one you no longer have a record of — NEVER guess which shoe it was and NEVER silently search something else instead. Say so honestly and ask them to resend the name or a photo: "That code's not showing on my end anymore, sorry 🙈 — what was the shoe called, or send the pic again and I'll pull it right up 👟". Codes → shoes: ${lines.join('; ')}]`;
  }
```
