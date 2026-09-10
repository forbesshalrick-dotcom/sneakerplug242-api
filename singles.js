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
const fs = require('fs');
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
function liveSingles() {
  let shoes = [];
  try { shoes = require('./shop').getShoes() || []; } catch (_) {}
  const cat = catalogue();
  return shoes
    .filter((s) => s && Array.isArray(s.sizes) && s.sizes.length === 1 && !s.sold)
    .map((s) => {
      const c = cat[String(s.id)] || {};
      return {
        id: s.id,
        brand: c.brand || '',
        name: c.name || '',
        nickname: c.nickname || '',
        color: c.color || '',
        size: String(s.sizes[0]),
        price: s.price || c.price || null,
        img: c.image || '',
        // 9 of the 140 have no catalogue row at all, so the card has to survive
        // with nothing but an id. Saying so is more use than hiding it.
        known: !!cat[String(s.id)],
      };
    })
    // The 9 with no catalogue row have no brand or name to sort by, so they would
    // otherwise land at the very top as a block of blank cards. Push them to the
    // bottom — they still need doing, they just should not be the first thing seen.
    .sort((a, b) => (a.known === b.known)
      ? (a.brand + ' ' + a.name).localeCompare(b.brand + ' ' + b.name)
      : (a.known ? -1 : 1));
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
    res.json({ live: liveSingles(), photographed: photos(), photographedAt: '2026-09-04' });
  });

  app.get('/singles', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(page());
  });
}

function page() {
  const live = liveSingles();
  const pics = photos();
  const card = (o) => `<a class="c${o.img ? '' : ' nopic'}" ${o.full ? `href="${esc(o.full)}" target="_blank" rel="noopener"` : ''}>
    <div class="ph">${o.img ? `<img loading="lazy" src="${esc(o.img)}" alt="">` : `<span class="noimg">no photo</span>`}<span class="sz">${esc(o.size)}</span></div>
    <div class="meta">
      <div class="nm">${esc(title(o)) || esc(o.id)}</div>
      <div class="cl">${esc(o.color || (o.known === false ? 'not in the catalogue yet' : ''))}</div>
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
  .tb{flex:1;appearance:none;border:0;background:transparent;color:var(--dim);font:inherit;font-size:13px;
      font-weight:600;padding:9px 6px;border-bottom:2px solid transparent;cursor:pointer}
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
    <button class="tb" id="t-pic" role="tab" aria-selected="false">Photographed <span class="n">${pics.length}</span></button>
  </div>
</header>
<div class="tools"><input id="q" inputmode="search" placeholder="Search brand, model, colour or size…"></div>

<div id="v-live">
  <p class="note">Worked out from the shelf <b>right now</b> — every shoe you have exactly <b>one pair</b> of.
  This changes on its own as things sell, so it is always today's answer. Photos are the catalogue photos.</p>
  <div class="grid" id="g-live">${live.map(card).join('') || '<div class="empty">Nothing is down to its last pair.</div>'}</div>
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
  var tl=document.getElementById('t-live'), tp=document.getElementById('t-pic');
  var vl=document.getElementById('v-live'), vp=document.getElementById('v-pic');
  function show(livePane){
    vl.hidden=!livePane; vp.hidden=livePane;
    tl.setAttribute('aria-selected',livePane?'true':'false');
    tp.setAttribute('aria-selected',livePane?'false':'true');
    filter();
  }
  tl.onclick=function(){show(true)}; tp.onclick=function(){show(false)};
  var q=document.getElementById('q');
  function filter(){
    var t=q.value.trim().toLowerCase();
    var pane=vl.hidden?vp:vl;
    var cards=pane.querySelectorAll('.c'), shown=0;
    for(var i=0;i<cards.length;i++){
      var hit=!t||cards[i].textContent.toLowerCase().indexOf(t)>=0;
      cards[i].style.display=hit?'':'none'; if(hit)shown++;
    }
  }
  q.addEventListener('input',filter);
})();
</script>
</body></html>`;
}

module.exports = { mount, liveSingles };
