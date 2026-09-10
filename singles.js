// ── 👟 SINGLES — "what am I down to my last pair of?" ─────────────────────────
// Rodney 2026-09-10: "add a tab called singles in the website and chat app",
// then: "this isnt for customers only backend". So this is a STAFF page. It is
// never linked from the customer storefront and it is marked noindex, exactly
// like /inbox — the same posture, no new hole.
//
// ⚠️ THE ONE RULE THIS FILE MUST KEEP: it NEVER writes. Not to stock, not to the
// catalogue, not to anything. It reads the live shop state and renders it. A
// previous attempt at a singles feature tried to reconcile two lists and started
// inventing links; this one is a window, not a hand.
//
// WHY TWO LISTS AND NOT ONE (learned 2026-09-04, re-measured 2026-09-10):
// On 4 Sep a session physically photographed 132 last-pair shoes. Those are real
// photos of the real pair. Six days later the LIVE shop has 140 shoes down to one
// pair — and matching the two sets on brand+name+colour+size lands only 3 exact
// unique hits. An earlier fuzzy match collided on 63 of 132 (nine different Air
// Max 97s all matched one catalogue id). So they are NOT merged and never will be.
// They are shown side by side, each labelled for what it is:
//   • IN STOCK NOW  — computed live, correct today, catalogue photo.
//   • PHOTOGRAPHED  — the 4 Sep snapshot, real photos, frozen and honest about it.
//
// Rodney 2026-09-10, second ask: "can there be a button that shows the shoes that
// are on the website but not on the singles page". That is the THIRD tab,
// EVERYTHING ELSE — the other 197 shoes, deliberately sorted fewest-pairs-first so
// the 2-pair rows sit at the top. Those are next week's singles, which makes the
// tab an early warning rather than just a leftovers bin. The 6 shoes showing ZERO
// pairs lead it, in red: they are still on the website with nothing behind them.
const fs = require('fs');
// The one address every shoe photo lives at. 358 of the 359 catalogue rows use it verbatim.
const CDN = 'https://cdn.jsdelivr.net/gh/forbesshalrick-dotcom/Sp242-frames@master/';
const path = require('path');

let _cat = null, _catAt = 0;
function catalogue() {
  // Re-read rather than require(): catalog.json is edited by other sessions while
  // the server is up, and a cached require would serve last week's names forever.
  if (_cat && Date.now() - _catAt < 60000) return _cat;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
    const byId = {};
    (Array.isArray(raw) ? raw : []).forEach((c) => { if (c && c.id) byId[String(c.id)] = c; });
    _cat = byId; _catAt = Date.now();
  } catch (_) { _cat = _cat || {}; }
  return _cat;
}

let _photos = null;
function photos() {
  if (_photos) return _photos;
  try { _photos = JSON.parse(fs.readFileSync(path.join(__dirname, 'singles-photos.json'), 'utf8')); }
  catch (_) { _photos = []; }
  return Array.isArray(_photos) ? _photos : (_photos = []);
}

// A "single" is a shoe with exactly ONE pair left on the shelf. `sizes` is a flat
// list with one entry per PAIR, so that is simply length 1.
// ⚠️ Deliberately NOT "the last pair in a size" — 545 size-slots are down to one
// pair, which is a wall of noise, not a tab you would ever open twice.
// Every shoe on the shelf that is not sold, in one place, so the two live tabs
// can never disagree about what "on the website" means.
function shelf() {
  let shoes = [];
  try { shoes = require('./shop').getShoes() || []; } catch (_) {}
  return shoes.filter((s) => s && Array.isArray(s.sizes) && !s.sold);
}

function dress(s) {
  const c = catalogue()[String(s.id)] || {};
  return {
    id: s.id,
    brand: c.brand || '',
    name: c.name || '',
    nickname: c.nickname || '',
    color: c.color || '',
    size: String(s.sizes[0] == null ? '' : s.sizes[0]),
    pairs: s.sizes.length,
    // Sizes repeat, one entry per pair. Fold them so a card reads "8, 9 ×2, 11"
    // instead of "8, 9, 9, 11" — a staff member counting stock needs the count.
    sizeList: foldSizes(s.sizes),
    price: s.price || c.price || null,
    // 🖼️ THE PHOTOS WERE THERE ALL ALONG (Rodney, 10 Sep: "these pics not showing").
    // 11 shoes on the shelf have no row in catalog.json, so `c.image` was empty and they
    // drew as grey "no photo" tiles — but every one of their frames IS on the CDN. I
    // checked all 11 by hand: 200 on every single one. 358 of the 359 catalogue rows use
    // exactly this URL, so building it from the id is the same address the catalogue would
    // have given us, not a guess. Only for rows with stock behind them: the empty leftover
    // records have no frame and would 404 into a broken-image icon.
    img: c.image || (s.sizes.length ? CDN + String(s.id) + '-thumb.jpg' : ''),
    // 9 of the 140 have no catalogue row at all, so the card has to survive
    // with nothing but an id. Saying so is more use than hiding it.
    known: !!catalogue()[String(s.id)],
  };
}

function foldSizes(sizes) {
  const n = {};
  sizes.forEach((z) => { const k = String(z); n[k] = (n[k] || 0) + 1; });
  return Object.keys(n)
    .sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0))
    .map((k) => (n[k] > 1 ? k + ' \u00d7' + n[k] : k))
    .join(', ');
}

function liveSingles() {
  return shelf()
    .filter((s) => s.sizes.length === 1)
    .map(dress)
    // The 9 with no catalogue row have no brand or name to sort by, so they would
    // otherwise land at the very top as a block of blank cards. Push them to the
    // bottom — they still need doing, they just should not be the first thing seen.
    .sort((a, b) => (a.known === b.known)
      ? (a.brand + ' ' + a.name).localeCompare(b.brand + ' ' + b.name)
      : (a.known ? -1 : 1));
}

// "On the website but NOT on the singles page" — literally the rest of the shelf.
// Zero-pair rows are INCLUDED on purpose: they are the most urgent thing here,
// because a customer can still see and ask for a shoe there is nothing behind.
function liveRest() {
  return shelf()
    .filter((s) => s.sizes.length !== 1)
    .map(dress)
    // Fewest pairs first. A 2-pair shoe is one sale away from being a single, so
    // the top of this list is the useful part; a 12-pair shoe needs no attention.
    .sort((a, b) => (a.pairs !== b.pairs)
      ? a.pairs - b.pairs
      : (a.brand + ' ' + a.name).localeCompare(b.brand + ' ' + b.name));
}

// Catalogue names already carry the brand on most rows ("Jordan" + "Air Jordan 1"
// reads as "Jordan Air Jordan 1", and "Asics" + "Asics" as "Asics Asics"). Only
// prefix the brand when the name does not already start with it.
function title(o) {
  const b = String(o.brand || '').trim();
  const n = String(o.name || '').trim();
  if (!b) return n;
  if (!n) return b;
  return n.toLowerCase().startsWith(b.toLowerCase()) ? n : b + ' ' + n;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mount(app) {
  // Data on its own so the page can refresh without a reload, and so anything
  // else (a future stock screen) can reuse the same definition of "single".
  app.get('/singles.json', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ live: liveSingles(), rest: liveRest(), photographed: photos(), photographedAt: '2026-09-04' });
  });

  app.get('/singles', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(page());
  });
}

function page() {
  const live = liveSingles();
  const rest = liveRest();
  const pics = photos();
  // ⚠️ Rodney, 10 Sep, pointing at six grey "no photo" tiles: "these pics not showing".
  // There is no photo because there is no shoe. Those six rows are `{id, _catalog:true,
  // sizes:[], sold:false}` and nothing else — no name, no price, no colour, no sizes, and
  // no row in catalog.json. They are empty leftovers, not stock. Rendering them as six
  // photo-less cards made them look like shoes that had merely lost their picture, which
  // is worse than useless. They collapse into ONE line instead: still visible, still
  // countable, no longer pretending to be a shoe waiting for a photograph.
  // A zero-pair shoe that DOES have a catalogue row is a different animal — a real shoe
  // that has sold out — so that one keeps its card and its red badge.
  const ghosts = rest.filter((o) => o.pairs === 0 && !o.known);
  const ghostIds = ghosts.map((o) => o.id);
  const shown = rest.filter((o) => !(o.pairs === 0 && !o.known));
  const gone = shown.filter((o) => o.pairs === 0).length;
  // On the singles tab the badge is the one size left, because that IS the shoe.
  // On the everything-else tab it is the pair count, because that is the question
  // being asked there — a size on its own would read as "one pair, size 8".
  const badge = (o) => (o.pairs == null || o.pairs === 1)
    ? { txt: o.size, cls: 'sz' }
    : (o.pairs === 0 ? { txt: 'none left', cls: 'sz gone' } : { txt: o.pairs + ' pairs', cls: 'sz' });
  const card = (o) => `<a class="c${o.img ? '' : ' nopic'}" ${o.full ? `href="${esc(o.full)}" target="_blank" rel="noopener"` : ''}>
    <div class="ph">${o.img ? `<img loading="lazy" src="${esc(o.img)}" alt="" onerror="this.remove()">` : `<span class="noimg">no photo</span>`}<span class="${badge(o).cls}">${esc(badge(o).txt)}</span></div>
    <div class="meta">
      <div class="nm">${esc(title(o)) || esc(o.id)}</div>
      <div class="cl">${esc(o.color || (o.known === false ? 'not in the catalogue yet' : ''))}</div>
      ${o.pairs > 1 ? `<div class="szs">${esc(o.sizeList)}</div>` : ''}
      <div class="ft"><span class="pr">${o.price ? '$' + esc(o.price) : '—'}</span><span class="id">${esc(o.id || o.sku || '')}</span></div>
    </div></a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Singles — THE PLUG 242</title>
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#252a34;--ink:#e7e9ee;--dim:#8b93a7;
        --hot:#ff8a3d;--ok:#2fe08a;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
  header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,#12151c,#0f1115);
         border-bottom:1px solid var(--line);padding:12px 14px 0}
  .ttl{display:flex;align-items:baseline;gap:10px}
  h1{margin:0;font-size:20px;letter-spacing:.5px}
  .sub{color:var(--dim);font-size:12px}
  .tabs{display:flex;gap:6px;margin-top:10px}
  /* Three tabs across a 360px phone: shrink the type rather than let a label wrap. */
  .tb{flex:1;min-width:0;appearance:none;border:0;background:transparent;color:var(--dim);font:inherit;
      font-size:12.5px;font-weight:600;padding:9px 4px;border-bottom:2px solid transparent;cursor:pointer;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tb[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--hot)}
  .tb .n{font-family:var(--mono);font-size:11px;color:var(--hot)}
  .tools{display:flex;gap:8px;padding:10px 14px}
  #q{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:10px;
     color:var(--ink);font:inherit;font-size:15px;padding:10px 12px}
  .note{margin:0 14px 10px;padding:10px 12px;background:#1a1712;border:1px solid #3a2c18;
        border-radius:10px;color:#e3c9a3;font-size:12.5px;line-height:1.5}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:0 14px 90px}
  .c{display:block;background:var(--card);border:1px solid var(--line);border-radius:12px;
     overflow:hidden;text-decoration:none;color:inherit}
  .ph{position:relative;aspect-ratio:4/3;background:#0b0d12;display:flex;align-items:center;justify-content:center}
  .ph img{width:100%;height:100%;object-fit:cover;display:block}
  .noimg{color:#4c5468;font-size:11px}
  .sz{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.18);
      color:#fff;font-family:var(--mono);font-size:12px;font-weight:700;padding:2px 7px;border-radius:7px}
  .meta{padding:8px 9px 9px}
  .nm{font-size:13px;font-weight:650;line-height:1.25;text-wrap:balance}
  .cl{color:var(--dim);font-size:11.5px;margin-top:2px;line-height:1.3}
  .szs{margin-top:4px;font-family:var(--mono);font-size:11px;color:#9aa3b8;line-height:1.35;
       word-break:break-word}
  .sz.gone{background:rgba(120,20,20,.85);border-color:rgba(255,120,120,.45);color:#ffd9d9}
  .note.warn{background:#1c1213;border-color:#4a2226;color:#f0c2c2}
  .ft{display:flex;justify-content:space-between;align-items:center;margin-top:7px}
  .pr{color:var(--ok);font-family:var(--mono);font-size:12.5px;font-weight:700}
  .id{color:#5c657a;font-family:var(--mono);font-size:10.5px}
  .c.nopic .ph{aspect-ratio:5/2}
  .empty{color:var(--dim);padding:30px 14px;text-align:center;font-size:14px}
  .back{position:fixed;left:0;right:0;bottom:0;background:#12151c;border-top:1px solid var(--line);
        padding:10px 14px;display:flex;gap:10px}
  .back a{flex:1;text-align:center;text-decoration:none;color:var(--ink);background:var(--card);
          border:1px solid var(--line);border-radius:10px;padding:10px;font-size:13.5px;font-weight:600}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<header>
  <div class="ttl"><h1>👟 SINGLES</h1><span class="sub">last pair left</span></div>
  <div class="tabs" role="tablist">
    <button class="tb" id="t-live" role="tab" aria-selected="true">In stock now <span class="n">${live.length}</span></button>
    <button class="tb" id="t-rest" role="tab" aria-selected="false">Everything else <span class="n">${shown.length}</span></button>
    <button class="tb" id="t-pic" role="tab" aria-selected="false">Photographed <span class="n">${pics.length}</span></button>
  </div>
</header>
<div class="tools"><input id="q" inputmode="search" placeholder="Search brand, model, colour or size…"></div>

<div id="v-live">
  <p class="note">Worked out from the shelf <b>right now</b> — every shoe you have exactly <b>one pair</b> of.
  This changes on its own as things sell, so it is always today's answer. Photos are the catalogue photos.</p>
  <div class="grid" id="g-live">${live.map(card).join('') || '<div class="empty">Nothing is down to its last pair.</div>'}</div>
</div>

<div id="v-rest" hidden>
  ${gone ? `<p class="note warn">\u26a0\ufe0f <b>${gone} of these have sold out</b> \u2014 zero pairs left. They are first
  in the list, marked <b>none left</b> in red. Restock or take them off the site.</p>` : ''}
  ${ghosts.length ? `<p class="note" style="margin-top:4px">\ud83d\uddd1\ufe0f <b>${ghosts.length} empty leftover records</b>
  \u2014 ids <span style="font-family:var(--mono)">${esc(ghostIds.join(', '))}</span>. These are <b>not shoes</b>: no name,
  no price, no colour, no sizes and no photo, because there is nothing in them. That is why they have no picture.
  A customer can't find them \u2014 the website's search skips anything with no sizes \u2014 so they are harmless,
  just clutter. Say the word and they get deleted.</p>` : ''}
  <p class="note">Everything on the website that is <b>not</b> a single \u2014 the other <b>${shown.length}</b> shoes.
  Sorted <b>fewest pairs first</b>, so the top of this list is what is about to become a single. The badge on each
  photo is the <b>number of pairs</b>, and under the colour is which sizes those pairs are
  (<span style="font-family:var(--mono)">9 \u00d72</span> means two pairs of a 9).</p>
  <div class="grid" id="g-rest">${shown.map(card).join('') || '<div class="empty">Every shoe on the website is down to its last pair.</div>'}</div>
</div>

<div id="v-pic" hidden>
  <p class="note">📸 The <b>132 pairs photographed on 4 September</b> — real photos of the real shoe, not catalogue
  shots. This list is <b>frozen on that date</b> and does not update, so treat it as a photo album rather than a
  stock count. Two things worth knowing: <b>47 of these were in the wrong box</b>, so a printed label's model and
  size can both be wrong — the size shown is <b>Rodney's own handwriting on the box</b>, then the shoe itself.
  And the <b>prices are middle-of-the-road guesses</b> per model, never checked by him. Tap a shoe for the big photo.</p>
  <div class="grid" id="g-pic">${pics.map(card).join('')}</div>
</div>

<nav class="back"><a href="/inbox">‹ Chats</a><a href="https://242plug.com" target="_blank" rel="noopener">Website</a></nav>
<script>
(function(){
  // Three panes now, so drive them off a list instead of a boolean. Adding a
  // fourth tab later is one more entry here and nothing else.
  var KEYS=['live','rest','pic'], cur='live';
  function tab(k){return document.getElementById('t-'+k)}
  function pane(k){return document.getElementById('v-'+k)}
  function show(k){
    cur=k;
    KEYS.forEach(function(x){
      pane(x).hidden = x!==k;
      tab(x).setAttribute('aria-selected', x===k?'true':'false');
    });
    filter();
    window.scrollTo(0,0);
  }
  KEYS.forEach(function(k){ tab(k).onclick=function(){show(k)} });
  var q=document.getElementById('q');
  function filter(){
    var t=q.value.trim().toLowerCase();
    var cards=pane(cur).querySelectorAll('.c');
    for(var i=0;i<cards.length;i++){
      var hit=!t||cards[i].textContent.toLowerCase().indexOf(t)>=0;
      cards[i].style.display=hit?'':'none';
    }
  }
  q.addEventListener('input',filter);
})();
</script>
</body></html>`;
}

module.exports = { mount, liveSingles, liveRest };
