// shop.js — shared "brain" for the SNEAKERPLUG242 web app.
// Stores notes/tasks, sales, activity log and inventory in one place so every
// employee phone sees the same data. Persists to a Railway volume (/data) so it
// survives restarts. Sends WhatsApp alerts to employees on new notes via ManyChat.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── web push ─────────────────────────────────────────────────────────────────
// Lets us notify the installed staff PWA about a new delivery/task even when the
// app is fully closed. The PUBLIC key is also baked into the website (index.html);
// they MUST match. Override via env on Railway if you ever rotate the keys.
let webpush = null;
try { webpush = require('web-push'); } catch (_) { console.log('[shop] web-push not installed — push disabled'); }
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BPq6mcx1D_CUpEjdWBW-1PWXPtQ20UiLfE5V22xUr1LHqe-ZwnOpbGe5x3EuPcoH7J9a1m3VE6vaN7IjqPnbAzU';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'MQPaHYxJWm0bryPNJipgF4nXvzyZe5gjgQQ5TnhRGqk';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:rodneymunnings@gmail.com';
if (webpush) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); }
  catch (e) { console.log('[shop] VAPID setup failed — push disabled:', e.message); webpush = null; }
}

// Shared key the website sends with every request. It lives in the (public)
// client JS so it's a gate against random scanners, not a strong secret — the
// note endpoint is also rate-limited below to blunt abuse.
const SHOP_KEY = process.env.SHOP_KEY || 'sp242-shop-c988c5711bf067dccccc85b55fc14fde';
const MAX_SALES = 5000;
const MAX_LOG = 2000;

// ── persistence ────────────────────────────────────────────────────────────
// Prefer the mounted volume at /data; fall back to a local folder if it isn't
// there yet (data is then only kept until the next restart, but nothing breaks).
function pickDataDir() {
  const candidates = [process.env.DATA_DIR, '/data', path.join(__dirname, 'data')].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) { /* try next */ }
  }
  return path.join(__dirname, 'data');
}
const DATA_DIR = pickDataDir();
const PERSISTENT = DATA_DIR === '/data' || DATA_DIR === process.env.DATA_DIR;
console.log('[shop] data dir:', DATA_DIR, PERSISTENT ? '(persistent)' : '(EPHEMERAL — attach a volume to keep data)');

function loadFile(name, fallback) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (_) { return fallback; }
}

const state = {
  notes: loadFile('notes.json', []),       // [{id, text, kind, shoeId, shoeLabel, by, done, doneBy, createdAt, doneAt}]
  sales: loadFile('sales.json', []),       // mirror of website sale records
  log: loadFile('log.json', []),           // mirror of website audit entries
  shoes: loadFile('shoes.json', null),     // null = server has no inventory yet (don't overwrite devices)
  deleted: loadFile('deleted.json', []),   // deleted shoe ids
  employees: loadFile('employees.json', {}), // { name: "+1242..." } WhatsApp numbers
  accounts: loadFile('accounts.json', {}),  // { name: "passwordOrEmpty" } login accounts
  roles: loadFile('roles.json', {}),        // { name: "supervisor"|"line_staff" }
  deletedStaff: loadFile('deletedStaff.json', []), // names permanently removed — devices must never re-add these
  proofs: loadFile('proofs.json', {}),      // saleId -> {media_type, data(base64), by, at} — payment screenshots pinned to a sale (kept OUT of /shop/state so the poll payload stays small)
  subs: loadFile('subs.json', []),          // web-push subscriptions [{endpoint, keys, by, at}]
  logins: loadFile('logins.json', {}),      // SERVER-side login patterns: { name: {hash, salt} } — hashed, never plaintext
  rev: loadFile('rev.json', { n: 1 }),
};

// Baseline seed so the core staff numbers/accounts come back automatically after a
// redeploy even before a persistent disk is attached (the /data folder is wiped on
// every Railway deploy). Only fills keys that are MISSING — never clobbers a value
// already loaded from /data or pushed up by a device. Update if core staff change.
const SEED_EMPLOYEES = { Manager: '12428033126', Deashinique: '12424684477' };
const SEED_ACCOUNTS = { Manager: '', Deashinique: '' };
for (const k of Object.keys(SEED_EMPLOYEES)) if (!(k in state.employees)) state.employees[k] = SEED_EMPLOYEES[k];
for (const k of Object.keys(SEED_ACCOUNTS)) if (!(k in state.accounts)) state.accounts[k] = SEED_ACCOUNTS[k];

const dirty = new Set();
function persist(name) { dirty.add(name); schedule(); }
let timer = null;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    for (const name of dirty) {
      try {
        const key = name.replace('.json', '');
        fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(state[key]));
      } catch (e) { console.error('[shop] write failed', name, e.message); }
    }
    dirty.clear();
  }, 400);
}
function bump() { state.rev.n++; persist('rev.json'); }

// ── One-time SOLD-STATUS RECOVERY (Jul 8 2026) ───────────────────────────────
// A stale-device bulk sync overwrote the inventory with old FULL-stock data, wiping
// every "sold" reduction (sold shoes reappeared in stock). The SALE RECORDS survived
// (stored separately) and pinpoint each sale, so we re-subtract each sold size from
// its shoe — removing ONE instance per sale (so multi-pair stock stays right). Guarded
// by a marker file on the persistent disk so restarts never double-subtract. To restock
// a size later, VOID its sale (that's the correct way to put a size back).
function applySoldFromSales() {
  if (!Array.isArray(state.shoes) || !Array.isArray(state.sales) || !state.sales.length) return 0;
  const soldBy = {}; // shoeId -> { sizeString: count }
  for (const sale of state.sales) {
    if (!sale || sale.shoeId == null || sale.size == null) continue;
    const sz = String(parseFloat(sale.size)); if (sz === 'NaN') continue;
    const m = (soldBy[String(sale.shoeId)] = soldBy[String(sale.shoeId)] || {});
    m[sz] = (m[sz] || 0) + 1;
  }
  let changed = 0;
  for (const shoe of state.shoes) {
    if (!shoe || shoe.id == null) continue;
    const sold = soldBy[String(shoe.id)]; if (!sold) continue;
    const key = Array.isArray(shoe.sizes) ? 'sizes' : (Array.isArray(shoe.sizesRaw) ? 'sizesRaw' : null);
    if (!key) continue;
    const toRemove = Object.assign({}, sold); const remaining = [];
    for (const x of shoe[key]) {
      const sz = String(parseFloat(x));
      if (toRemove[sz] > 0) { toRemove[sz]--; continue; } // drop one pair per sale
      remaining.push(x);
    }
    if (remaining.length !== shoe[key].length) {
      shoe[key] = remaining; changed++;
      if (!remaining.length) shoe.sold = true;
    }
  }
  return changed;
}
try {
  const marker = path.join(DATA_DIR, 'sold_recovered_v1.flag');
  if (!fs.existsSync(marker)) {
    const n = applySoldFromSales();
    console.log('[shop] one-time sold recovery: adjusted', n, 'shoes from', state.sales.length, 'sale records');
    if (n) persist('shoes.json');
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch (_) {}
  }
} catch (e) { console.error('[shop] sold recovery failed:', e.message); }

// ── One-time SALES BACKFILL (Jul 24 2026) ────────────────────────────────────
// Two real sales never made it into the register: the Air Max 90 Black/Yellow size 8
// (reported to Kiki Jul 22 ~8 AM — confirmed but the record is missing) and the
// Air Jordan 11 Legend Blue size 12 (Jul 23 — only ever reported in chat; its stock
// was corrected but no sale row was written). Insert them once, in the exact shape
// recordStaffSale writes, guarded by a marker file AND a same-shoe/size/day dupe
// check so an organic record that exists but isn't rendering can never double-count.
// Stock is NOT touched here — it was already corrected on the storefront side.
try {
  const marker2 = path.join(DATA_DIR, 'sales_backfill_v1.flag');
  if (!fs.existsSync(marker2)) {
    const BACKFILL = [
      { id: 'backfill-j11-12-20260723', shoeId: 'jordan11white001', shoeLabel: 'Air Jordan 11 Retro (Legend Blue)', size: '12',
        price: 180, by: 'Manager', at: '2026-07-23T16:00:00.000Z', src: 'backfill', name: 'Air Jordan 11 Retro (Legend Blue)',
        brand: '', color: '', date: '2026-07-23T16:00:00.000Z', dateStr: 'Jul 23, 2026', timeStr: '12:00 PM', soldBy: 'Manager' },
      { id: 'backfill-am90-8-20260722', shoeId: 'airmax90bkyel001', shoeLabel: 'Air Max 90 — Black/Yellow', size: '8',
        price: 120, by: 'Manager P', at: '2026-07-22T12:02:00.000Z', src: 'backfill', name: 'Air Max 90 — Black/Yellow',
        brand: '', color: '', date: '2026-07-22T12:02:00.000Z', dateStr: 'Jul 22, 2026', timeStr: '08:02 AM', soldBy: 'Manager P' },
    ];
    if (!Array.isArray(state.sales)) state.sales = [];
    let added = 0;
    for (const b of BACKFILL) {
      const dupe = state.sales.some(s => s && String(s.shoeId) === b.shoeId
        && String(parseFloat(s.size)) === String(parseFloat(b.size))
        && (s.dateStr === b.dateStr || String(s.date || s.at || '').slice(0, 10) === b.date.slice(0, 10)));
      if (!dupe) { state.sales.unshift(b); added++; }
    }
    if (added) { persist('sales.json'); bump(); }
    console.log('[shop] one-time sales backfill: added', added, 'of', BACKFILL.length);
    try { fs.writeFileSync(marker2, new Date().toISOString()); } catch (_) {}
  }
} catch (e) { console.error('[shop] sales backfill failed:', e.message); }

// Correction (Jul 24 2026): the backfilled J11 sale was labelled Legend Blue, but Rodney
// confirmed the sold pair was the CONCORD (Black/White, an app-added shoe). Rewrite the
// row in place — runs every boot but the condition self-limits to a single rewrite, and
// resolves the Concord's real id from live inventory when it can.
try {
  const bf = (state.sales || []).find(s => s && s.id === 'backfill-j11-12-20260723');
  if (bf && /legend blue/i.test(String(bf.shoeLabel || ''))) {
    const cc = (state.shoes || []).find(s => s && /concord/i.test(String(s.nickname || '') + ' ' + String(s.name || '')));
    bf.shoeLabel = 'Air Jordan 11 Retro (Concord)'; bf.name = 'Air Jordan 11 Retro (Concord)';
    if (cc && cc.id != null) bf.shoeId = cc.id;
    persist('sales.json'); bump();
    console.log('[shop] backfill J11 sale relabelled to Concord', cc ? '(id ' + cc.id + ')' : '(id unresolved)');
  }
} catch (e) { console.error('[shop] backfill relabel failed:', e.message); }

// Shared ACTIVITY LOG entry, in the exact shape the website's audit log uses
// ({id, action, detail, category, shoeId, user, time}) so Kiki's actions show up
// on every device's Log tab (Rodney 2026-07-14: "no sales being logged, what a joke").
function addLogEntry(action, detail, category, shoeId, user) {
  const e = { id: Date.now() + Math.random(), action, detail: detail || '', category: category || 'general',
    shoeId: shoeId || null, user: user || 'Kiki 🤖', time: new Date().toISOString() };
  state.log.unshift(e);
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
  persist('log.json'); bump();
  return e;
}

// Per-size counts, the way staff think ("10.5 x2, 11 x1 — 22 pairs total").
function sizeSummary(sizes) {
  const counts = {};
  for (const x of sizes || []) { const k = String(parseFloat(x)); if (k !== 'NaN') counts[k] = (counts[k] || 0) + 1; }
  const parts = Object.keys(counts).sort((a, b) => parseFloat(a) - parseFloat(b)).map(k => `${k} x${counts[k]}`);
  return parts.length ? `${parts.join(', ')} — ${(sizes || []).length} pairs total` : 'NONE — sold out';
}

// Kiki-reported sale (staff WhatsApps "sold the pink Air Max in a 10" and confirms
// the photo): remove ONE pair of that size from the live shoe entry, append a real
// sale record (same shape the website writes, so voiding works the same way), stamp
// updatedAt so no stale phone can resurrect the pair, and bump rev so every phone
// syncs. baseSizes = the shoe's current live sizes from the caller's liveShoeMap,
// used when the shoe has no live override entry yet.
function recordStaffSale(shoeId, size, by, price, label, baseSizes) {
  const sz = String(parseFloat(size));
  if (sz === 'NaN') return { error: 'bad size' };
  if (!Array.isArray(state.shoes)) state.shoes = [];
  let shoe = state.shoes.find(x => x && String(x.id) === String(shoeId));
  if (!shoe) {
    shoe = { id: shoeId, _catalog: true, sizes: (baseSizes || []).slice(), sold: false };
    state.shoes.push(shoe);
  }
  if (!Array.isArray(shoe.sizes)) shoe.sizes = (baseSizes || []).slice();
  const idx = shoe.sizes.findIndex(x => String(parseFloat(x)) === sz);
  if (idx === -1) return { error: 'size ' + size + ' is not in stock for this shoe', sizes: shoe.sizes.slice() };
  shoe.sizes.splice(idx, 1);
  if (!shoe.sizes.length) shoe.sold = true;
  shoe.updatedAt = Date.now();
  const uid = 'jess-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  // Write BOTH dialects: the bot's fields (at/shoeLabel/by) AND the website sales
  // page's native fields (date/dateStr/timeStr/name/soldBy, Bahamas clock) so a
  // Kiki-reported sale counts in TODAY'S REGISTER immediately (2026-07-16).
  const bah = new Date(Date.now() - 4 * 3600 * 1000);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = MONTHS[bah.getUTCMonth()] + ' ' + bah.getUTCDate() + ', ' + bah.getUTCFullYear();
  let hr = bah.getUTCHours(); const ampm = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
  const timeStr = String(hr).padStart(2, '0') + ':' + String(bah.getUTCMinutes()).padStart(2, '0') + ' ' + ampm;
  state.sales.unshift({ id: uid, shoeId: shoeId, shoeLabel: label || String(shoeId), size: sz,
    price: price != null ? price : null, by: by || 'staff', at: new Date().toISOString(), src: 'jess-staff',
    name: label || String(shoeId), brand: '', color: '',
    date: new Date().toISOString(), dateStr: dateStr, timeStr: timeStr, soldBy: by || 'staff' });
  if (state.sales.length > MAX_SALES) state.sales.length = MAX_SALES;
  persist('shoes.json'); persist('sales.json'); bump();
  addAlert('🧾 SALE — ' + (label || shoeId) + ' — size ' + sz + (price != null ? ' — $' + price : '') + ' (reported by ' + (by || 'staff') + ' via Kiki)', by || 'Kiki 🤖');
  addLogEntry('Sale (via Kiki)', (label || shoeId) + ' — size ' + sz + (price != null ? ' — $' + price : ''), 'sales', shoeId, by || 'staff');
  return { ok: true, saleId: uid, remaining_sizes: shoe.sizes.slice(), remaining_summary: sizeSummary(shoe.sizes), sold_out: !!shoe.sold };
}

// Pin a payment-proof screenshot to an existing sale (Rodney 2026-07-18: after a sale,
// staff send the customer's money-confirmation pic). The bytes live in a SEPARATE proofs
// map so the frequently-polled /shop/state payload stays small; the sale just gets a tiny
// hasProof=true flag so the website can show a 📎. Served on demand via /shop/proof/:id.
function attachSaleProof(saleId, img, by) {
  if (!saleId || !img || !img.data) return { error: 'no image' };
  const sale = state.sales.find(x => x && String(x.id) === String(saleId));
  if (!sale) return { error: 'unknown sale ' + saleId + ' — proof not saved' };
  state.proofs[String(saleId)] = { media_type: img.media_type || 'image/jpeg', data: img.data, by: by || sale.by || '', at: new Date().toISOString() };
  sale.hasProof = true;
  persist('proofs.json'); persist('sales.json'); bump();
  addLogEntry('Payment proof pinned', (sale.shoeLabel || sale.name || sale.shoeId) + ' — size ' + sale.size, 'sales', sale.shoeId, by || 'staff');
  return { ok: true, saleId: String(saleId), shoe: sale.shoeLabel || sale.name || sale.shoeId };
}
function getProof(saleId) { return state.proofs[String(saleId)] || null; }

// Staff restock via Kiki — the inverse of recordStaffSale: add pairs of a size.
// No sale record (nothing sold); a task note + rev bump so every phone syncs.
function recordStaffRestock(shoeId, size, count, by, label, baseSizes) {
  const sz = String(parseFloat(size));
  if (sz === 'NaN') return { error: 'bad size' };
  const n = Math.max(1, Math.min(20, parseInt(count) || 1));
  if (!Array.isArray(state.shoes)) state.shoes = [];
  let shoe = state.shoes.find(x => x && String(x.id) === String(shoeId));
  if (!shoe) {
    shoe = { id: shoeId, _catalog: true, sizes: (baseSizes || []).slice(), sold: false };
    state.shoes.push(shoe);
  }
  if (!Array.isArray(shoe.sizes)) shoe.sizes = (baseSizes || []).slice();
  for (let i = 0; i < n; i++) shoe.sizes.push(sz);
  shoe.sold = false;
  shoe.updatedAt = Date.now();
  persist('shoes.json'); bump();
  addAlert('📦 RESTOCK — ' + (label || shoeId) + ' — size ' + sz + ' x' + n + ' added (by ' + (by || 'staff') + ' via Kiki)', by || 'Kiki 🤖');
  addLogEntry('Restock (via Kiki)', (label || shoeId) + ' — size ' + sz + ' x' + n, 'inventory', shoeId, by || 'staff');
  return { ok: true, added: n, remaining_sizes: shoe.sizes.slice(), remaining_summary: sizeSummary(shoe.sizes) };
}

// Add a note to the shared board programmatically (e.g. a delivery-ready alert
// from the bot), so it shows on the website's Tasks for whoever's on duty.
// Does NOT fire the employee WhatsApp blast — the caller handles any messaging.
function addAlert(text, by, meta) {
  const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const note = {
    id: uid, text: String(text || '').trim(), kind: 'task',
    shoeId: null, shoeLabel: null, by: by || 'Kiki 🤖',
    done: false, doneBy: null, doneAt: null, createdAt: new Date().toISOString(),
  };
  // Optional link back to the customer's chat (delivery/order alerts pass this) so the
  // Inbox's Today's Orders can open the exact in-site conversation + show a pic.
  if (meta && typeof meta === 'object') {
    if (meta.sub) note.sub = String(meta.sub);
    if (meta.account) note.account = String(meta.account);
    if (meta.img) note.img = String(meta.img);
  }
  if (!note.text) return null;
  state.notes.unshift(note);
  if (state.notes.length > 500) state.notes.length = 500;
  persist('notes.json'); bump();
  // Push to installed staff phones even if the app is closed (best effort).
  // If this alert carries a customer's WhatsApp number (delivery alerts include a
  // wa.me link), make the push TAPPABLE → it opens the customer's WhatsApp so staff
  // can message them the instant they tap the notification.
  let pushUrl = '/';
  const _m = note.text.match(/wa\.me\/(\d{7,})/i);
  if (_m && _m[1]) pushUrl = 'https://wa.me/' + _m[1];
  sendPush('New delivery / task', note.text, pushUrl).catch(() => {});
  return note;
}

// ── WhatsApp send via ManyChat (find subscriber by phone, then send text) ────
async function waSend(phoneDigits, text) {
  const token = process.env.MANYCHAT_TOKEN;
  if (!token || !phoneDigits) return false;
  try {
    const f = await fetch('https://api.manychat.com/fb/subscriber/findBySystemField?phone=' +
      encodeURIComponent('+' + phoneDigits), { headers: { Authorization: `Bearer ${token}` } });
    const fj = await f.json();
    const d = fj && fj.data;
    const sub = d && (d.id || (Array.isArray(d) && d[0] && d[0].id));
    if (!sub) return false;
    const r = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriber_id: sub, data: { version: 'v2', content: { type: 'whatsapp', messages: [{ type: 'text', text }] } } }),
    });
    return r.ok;
  } catch (_) { return false; }
}

async function blastEmployees(text, exceptName) {
  const nums = state.employees || {};
  const results = [];
  for (const name of Object.keys(nums)) {
    if (exceptName && name.toLowerCase() === String(exceptName).toLowerCase()) continue;
    const digits = String(nums[name] || '').replace(/[^0-9]/g, '');
    if (!digits) continue;
    const ok = await waSend(digits, text);
    results.push({ name, ok });
  }
  return results;
}

// Send a web-push notification to every subscribed staff device. Best-effort:
// dead/expired subscriptions (HTTP 404/410) are pruned so the list stays clean.
async function sendPush(title, body, url) {
  if (!webpush || !Array.isArray(state.subs) || !state.subs.length) return 0;
  const payload = JSON.stringify({ title: title || 'THE PLUG 242', body: body || 'New delivery / task', url: url || '/', tag: 'plug242-task' });
  let sent = 0; const dead = [];
  await Promise.all(state.subs.map(async (s) => {
    try { await webpush.sendNotification(s, payload); sent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint); }
  }));
  if (dead.length) {
    state.subs = state.subs.filter((s) => dead.indexOf(s.endpoint) === -1);
    persist('subs.json');
  }
  return sent;
}

// ── routes ───────────────────────────────────────────────────────────────────
function mount(app) {
  function auth(req, res) {
    const key = req.query.key || req.get('x-shop-key') || (req.body && req.body.key);
    if (key !== SHOP_KEY) { res.status(401).json({ error: 'bad key' }); return false; }
    return true;
  }
  const uid = () => Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36);

  // Full snapshot (website pulls this on load + when rev changes)
  app.get('/shop/state', (req, res) => {
    if (!auth(req, res)) return;
    res.json({
      rev: state.rev.n,
      persistent: PERSISTENT, // false = data lost on redeploy (attach a Railway volume at /data)
      notes: state.notes,
      sales: state.sales,
      log: state.log,
      shoes: state.shoes,
      deleted: state.deleted,
      employees: state.employees,
      accounts: state.accounts,
      roles: state.roles,
      deletedStaff: state.deletedStaff,
    });
  });

  // Cheap change check for polling
  app.get('/shop/rev', (req, res) => {
    if (!auth(req, res)) return;
    res.json({ rev: state.rev.n });
  });

  // ---- Notes / tasks ----
  app.get('/shop/notes', (req, res) => {
    if (!auth(req, res)) return;
    res.json({ notes: state.notes });
  });

  let noteTimes = [];
  app.post('/shop/note', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    if (!b.text || !String(b.text).trim()) return res.status(400).json({ error: 'empty note' });
    // spam-guard: at most 12 new notes per minute (each can fire WhatsApp messages)
    const nowMs = Date.now();
    noteTimes = noteTimes.filter(t => nowMs - t < 60000);
    if (noteTimes.length >= 12) return res.status(429).json({ error: 'too many notes, slow down' });
    noteTimes.push(nowMs);
    const note = {
      id: uid(),
      text: String(b.text).trim(),
      kind: b.kind || 'task',           // 'task' | 'shoe'
      shoeId: b.shoeId || null,
      shoeLabel: b.shoeLabel || null,
      by: b.by || 'Manager',
      done: false, doneBy: null, doneAt: null,
      createdAt: new Date().toISOString(),
    };
    state.notes.unshift(note);
    if (state.notes.length > 500) state.notes.length = 500;
    persist('notes.json'); bump();

    // WhatsApp blast to employees (best effort, don't block the response long)
    let delivery = [];
    // 💵 A PAYOUT note = an employee just clocked out on the pay screen. Instead of a generic
    // "new task", message THAT employee directly with tonight's expected float so Jess is
    // already primed and waiting for their float photo (Rodney 2026-07-17).
    const payoutFloat = /💵 PAYOUT/.test(note.text) ? /float should now hold \$([0-9]+(?:\.[0-9]+)?)/.exec(note.text) : null;
    if (payoutFloat) {
      const floatShould = parseFloat(payoutFloat[1]);
      const empDigits = String((state.employees || {})[note.by] || '').replace(/[^0-9]/g, '');
      const floatMsg = `🌙 Nice work today, ${note.by}! 👏\n\nTonight's float should come to *$${floatShould.toFixed(2)}*. Whenever you're ready, spread it on the table and snap me a quick photo right here 📸 — I'll count it up and close you out. 💵`;
      if (empDigits) { try { const ok = await waSend(empDigits, floatMsg); delivery = [{ name: note.by, floatRequest: true, ok }]; } catch (_) {} }
      sendPush(`Float time, ${note.by}`, `Tonight's float should be $${floatShould.toFixed(2)} — send Kiki a photo to close out`, '/').catch(() => {});
    } else {
      const label = note.kind === 'shoe' && note.shoeLabel ? `\n👟 ${note.shoeLabel}` : '';
      const msg = `📋 New task from ${note.by}:\n${note.text}${label}\n\nOpen the app to see it. ✅`;
      try { delivery = await blastEmployees(msg, note.by); } catch (_) {}
      // Web push to installed staff phones (works when the app is closed).
      const pushBody = note.kind === 'shoe' && note.shoeLabel ? `${note.text} — ${note.shoeLabel}` : note.text;
      sendPush(`New task from ${note.by}`, pushBody, '/').catch(() => {});
    }
    res.json({ note, delivery });
  });

  // Register a device for web push (called by the website after a staff member
  // allows notifications). Dedupes by endpoint so re-subscribing is harmless.
  app.post('/shop/push/subscribe', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const sub = b.sub || b.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'no subscription' });
    sub.by = b.by || 'staff';
    sub.at = new Date().toISOString();
    state.subs = (state.subs || []).filter((s) => s.endpoint !== sub.endpoint);
    state.subs.push(sub);
    if (state.subs.length > 200) state.subs = state.subs.slice(-200);
    persist('subs.json');
    res.json({ ok: true, count: state.subs.length, pushEnabled: !!webpush });
  });

  // Re-seed a note that already exists on a device but is missing on the server
  // (e.g. after a restart). Idempotent, and does NOT fire WhatsApp again.
  app.post('/shop/note/restore', (req, res) => {
    if (!auth(req, res)) return;
    const n = (req.body && req.body.note) || null;
    if (!n || !n.id) return res.status(400).json({ error: 'bad note' });
    if (!state.notes.some(x => x.id === n.id)) {
      state.notes.unshift(n);
      state.notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      if (state.notes.length > 500) state.notes.length = 500;
      persist('notes.json'); bump();
    }
    res.json({ ok: true });
  });

  app.post('/shop/note/done', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const n = state.notes.find(x => x.id === b.id);
    if (!n) return res.status(404).json({ error: 'not found' });
    n.done = !!(b.done == null ? true : b.done);
    n.doneBy = n.done ? (b.by || 'Employee') : null;
    n.doneAt = n.done ? new Date().toISOString() : null;
    persist('notes.json'); bump();
    res.json({ note: n });
  });

  app.post('/shop/note/delete', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const before = state.notes.length;
    state.notes = state.notes.filter(x => x.id !== b.id);
    if (state.notes.length !== before) { persist('notes.json'); bump(); }
    res.json({ ok: true });
  });

  // ---- Employees (so the server knows who to WhatsApp) ----
  app.post('/shop/employees', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    if (b.numbers && typeof b.numbers === 'object') {
      // merge: union of names, a non-empty incoming number replaces a blank one
      Object.keys(b.numbers).forEach(function (n) {
        if (state.deletedStaff.includes(n)) return; // never re-add a removed staffer
        if (b.numbers[n] || !state.employees[n]) state.employees[n] = b.numbers[n];
      });
      persist('employees.json'); bump();
    }
    res.json({ employees: state.employees });
  });

  // ---- Login accounts + roles (so a staffer added on one phone appears on all) ----
  // Merge, never clobber: union of names; a non-empty value wins over a blank.
  app.post('/shop/accounts', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    function mergeInto(target, src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) {
        if (state.deletedStaff.includes(k)) return; // never re-add a removed staffer
        if (src[k] || !target[k]) target[k] = src[k];
      });
    }
    mergeInto(state.accounts, b.accounts);
    mergeInto(state.roles, b.roles);
    mergeInto(state.employees, b.numbers);
    persist('accounts.json'); persist('roles.json'); persist('employees.json'); bump();
    res.json({ accounts: state.accounts, roles: state.roles, employees: state.employees });
  });

  // ── 🔐 SERVER-VERIFIED STAFF LOGIN ────────────────────────────────────────────
  // The website used to keep the login pattern ONLY in the browser's localStorage, so it
  // asked "set your pattern (first time)" on every new device/address and ANYONE could set
  // one and walk in. Now the pattern is verified HERE (hashed + salted, never plaintext) so
  // it's the same on every device and can't be reset by opening a fresh browser.
  function hashPattern(pattern, salt) {
    return crypto.createHash('sha256').update(String(salt) + '|' + String(pattern)).digest('hex');
  }
  const loginFails = new Map(); // name -> { n, until } — simple brute-force throttle
  const MASTER_PIN = process.env.STAFF_MASTER_PIN || ''; // optional owner recovery pattern (set in Railway)
  app.post('/shop/login', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const pattern = String(b.pattern || '');
    if (!name || !pattern) return res.json({ ok: false, error: 'name and pattern required' });
    // throttle: 6 wrong tries → locked 60s
    const f = loginFails.get(name);
    if (f && f.until > Date.now()) return res.json({ ok: false, locked: true, error: 'Too many tries — wait a minute.' });
    // owner recovery: a master PIN set in Railway always works (and never gets stored/created here)
    if (MASTER_PIN && pattern === MASTER_PIN) { loginFails.delete(name); return res.json({ ok: true, master: true }); }
    const rec = state.logins[name];
    if (!rec || !rec.hash) {
      // No pattern on file for this name yet.
      if (b.set === true) {
        const salt = crypto.randomBytes(8).toString('hex');
        state.logins[name] = { hash: hashPattern(pattern, salt), salt, setAt: new Date().toISOString() };
        persist('logins.json');
        loginFails.delete(name);
        return res.json({ ok: true, firstTime: true });
      }
      return res.json({ ok: false, needSetup: true }); // tell the site to run its "draw twice" setup
    }
    const good = hashPattern(pattern, rec.salt) === rec.hash;
    if (good) { loginFails.delete(name); return res.json({ ok: true }); }
    const n = ((f && f.n) || 0) + 1;
    loginFails.set(name, { n, until: n >= 6 ? Date.now() + 60000 : 0 });
    return res.json({ ok: false });
  });
  // Manager reset: clear a staffer's pattern so they can set a fresh one (needs the shop key).
  app.post('/shop/login/clear', (req, res) => {
    if (!auth(req, res)) return;
    const name = String((req.body && req.body.name) || '').trim();
    if (name && state.logins[name]) { delete state.logins[name]; persist('logins.json'); }
    loginFails.delete(name);
    res.json({ ok: true });
  });

  // ---- Remove a staff member entirely (name → gone from accounts/roles/employees) ----
  // The add endpoints only merge, so there was no way to delete a staffer (e.g. old test
  // accounts). Accepts { name } or { names: [...] } and wipes each from all three maps.
  app.post('/shop/staff/delete', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const names = Array.isArray(b.names) ? b.names : (b.name ? [b.name] : []);
    names.forEach(function (n) {
      n = String(n);
      delete state.accounts[n];
      delete state.roles[n];
      delete state.employees[n];
      if (!state.deletedStaff.includes(n)) state.deletedStaff.push(n); // tombstone so no device re-adds it
    });
    if (names.length) { persist('accounts.json'); persist('roles.json'); persist('employees.json'); persist('deletedStaff.json'); bump(); }
    res.json({ ok: true, removed: names, deletedStaff: state.deletedStaff, accounts: state.accounts, roles: state.roles, employees: state.employees });
  });

  // ---- Sales (append; deviceId+id dedupe) ----
  app.post('/shop/sale', (req, res) => {
    if (!auth(req, res)) return;
    const s = (req.body && req.body.sale) || null;
    if (!s || s.id == null) return res.status(400).json({ error: 'bad sale' });
    if (!state.sales.some(x => x.id === s.id)) {
      state.sales.unshift(s);
      if (state.sales.length > MAX_SALES) state.sales.length = MAX_SALES;
      persist('sales.json'); bump();
    }
    res.json({ ok: true, count: state.sales.length });
  });

  // Void/reverse a sale — remove it from the shared register by id.
  app.post('/shop/sale/void', (req, res) => {
    if (!auth(req, res)) return;
    const id = req.body && req.body.id;
    if (id == null) return res.status(400).json({ error: 'no id' });
    const before = state.sales.length;
    state.sales = state.sales.filter(x => String(x.id) !== String(id));
    // Drop any pinned payment proof for a voided sale so it doesn't orphan on disk.
    if (state.proofs && state.proofs[String(id)]) { delete state.proofs[String(id)]; persist('proofs.json'); }
    if (state.sales.length !== before) { persist('sales.json'); bump(); }
    res.json({ ok: true, removed: before - state.sales.length, count: state.sales.length });
  });

  // Serve a sale's pinned payment-proof screenshot. Auth is via ?key= so a plain
  // <img> tag on the website can load it. Returns the raw image bytes, or 404 if none.
  app.get('/shop/proof/:saleId', (req, res) => {
    if (!auth(req, res)) return;
    const p = state.proofs[String(req.params.saleId)];
    if (!p || !p.data) return res.status(404).json({ error: 'no proof for this sale' });
    try {
      const buf = Buffer.from(p.data, 'base64');
      res.set('Content-Type', p.media_type || 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=86400');
      res.send(buf);
    } catch (e) { res.status(500).json({ error: 'decode failed' }); }
  });

  // ---- Activity log (append; id dedupe) ----
  app.post('/shop/log', (req, res) => {
    if (!auth(req, res)) return;
    const e = (req.body && req.body.entry) || null;
    if (!e || e.id == null) return res.status(400).json({ error: 'bad entry' });
    if (!state.log.some(x => x.id === e.id)) {
      state.log.unshift(e);
      if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
      persist('log.json'); bump();
    }
    res.json({ ok: true });
  });

  // Remove one or more log entries by id (cleanup of bad/duplicate activity rows).
  app.post('/shop/log/delete', (req, res) => {
    if (!auth(req, res)) return;
    let ids = (req.body && req.body.ids) || (req.body && req.body.id != null ? [req.body.id] : []);
    if (!Array.isArray(ids)) ids = [ids];
    const set = {}; ids.forEach(i => { set[String(i)] = true; });
    const before = state.log.length;
    state.log = state.log.filter(x => !set[String(x.id)]);
    if (state.log.length !== before) { persist('log.json'); bump(); }
    res.json({ ok: true, removed: before - state.log.length });
  });

  // ---- Inventory (upsert by id; delete) ----
  app.post('/shop/shoe', (req, res) => {
    if (!auth(req, res)) return;
    const sh = (req.body && req.body.shoe) || null;
    if (!sh || sh.id == null) return res.status(400).json({ error: 'bad shoe' });
    // NEVER resurrect a deleted shoe: if it's tombstoned, reject the push. This is
    // the key guard — a device with stale data can otherwise re-add a deleted shoe.
    if (state.deleted.includes(sh.id)) return res.json({ ok: true, skipped: 'deleted' });
    if (!Array.isArray(state.shoes)) state.shoes = [];
    const i = state.shoes.findIndex(x => x.id === sh.id);
    if (i > -1) {
      // NEWEST-WINS: refuse a push that is OLDER than what we already store. This is the
      // hard lock that stops a stale device from reverting prices/stock on the server —
      // the exact thing that reverted the whole inventory.
      // ALSO refuse a TIMELESS push (no updatedAt at all) from overwriting a shoe we already
      // hold. A timeless push comes from an OLD cached copy of the app; it used to tie
      // (0 === 0) against a timeless stored shoe and clobber a real edit. Now it can only ADD
      // brand-new shoes, never overwrite an existing one. This closes the last revert hole.
      const exT = (state.shoes[i].updatedAt || state.shoes[i].createdAt || 0);
      const inT = (sh.updatedAt || sh.createdAt || 0);
      if (inT === 0 || inT < exT) {
        // A SALE MUST NEVER BE DROPPED (2026-07-14, the Foamposite revert): a timeless/older
        // push that only SHRINKS stock — same-or-fewer sizes and/or flips sold ON — is a human
        // marking a sale on a phone running an old cached app. Silently skipping it meant the
        // sale "reverted" and the bot kept offering a sold shoe. Accept JUST the shrink (sizes /
        // sold flag), keep everything else (price, name edits) from the newer stored copy, and
        // stamp it with server time. GROWTH (sizes reappearing, un-solding, price changes) from
        // a stale push stays blocked — that's the classic resurrection bug this lock exists for.
        const ex = state.shoes[i];
        const count = (arr) => (Array.isArray(arr) ? arr : []).reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
        const inC = count(sh.sizes), exC = count(ex.sizes);
        const subset = Object.keys(inC).every(s => inC[s] <= (exC[s] || 0));
        const fewer = (Array.isArray(sh.sizes) ? sh.sizes.length : 0) < (Array.isArray(ex.sizes) ? ex.sizes.length : 0);
        const soldFlip = !!sh.sold && !ex.sold;
        if (subset && (fewer || soldFlip)) {
          state.shoes[i] = Object.assign({}, ex, { sizes: sh.sizes, sold: !!sh.sold || !!ex.sold, updatedAt: Date.now() });
          persist('shoes.json'); bump();
          return res.json({ ok: true, accepted: 'shrink-from-stale-app' });
        }
        return res.json({ ok: true, skipped: 'stale' });
      }
      state.shoes[i] = sh;
    } else state.shoes.push(sh);
    persist('shoes.json'); bump();
    res.json({ ok: true });
  });

  // Replace the whole inventory at once (used for first upload / bulk sync)
  app.post('/shop/shoes', (req, res) => {
    if (!auth(req, res)) return;
    const arr = (req.body && req.body.shoes) || null;
    if (!Array.isArray(arr)) return res.status(400).json({ error: 'bad shoes' });
    // SAFETY BACKUP before overwriting the whole inventory. A stale-device bulk push has
    // wiped everything before, so keep timestamped snapshots we can always restore from.
    try {
      if (Array.isArray(state.shoes) && state.shoes.length) {
        const bdir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(bdir, { recursive: true });
        fs.writeFileSync(path.join(bdir, 'shoes-' + Date.now() + '.json'), JSON.stringify(state.shoes));
        const olds = fs.readdirSync(bdir).filter(f => f.startsWith('shoes-')).sort();
        for (const f of olds.slice(0, -40)) { try { fs.unlinkSync(path.join(bdir, f)); } catch (_) {} }
      }
    } catch (e) { console.error('[shop] pre-bulk backup failed:', e.message); }
    const incoming = arr.filter(s => s && !state.deleted.includes(s.id));
    const before = Array.isArray(state.shoes) ? state.shoes.length : 0;
    // NEWEST-WINS MERGE (was a blind full replace — a stale device's bulk push could wipe or
    // revert everything). Start from what's already stored, then apply each incoming shoe ONLY
    // if it isn't older than the stored copy. Never drop a stored shoe here: real deletions go
    // through /shop/shoe/delete + the deleted graveyard, so a stale bulk can't erase live stock.
    const byId = {};
    (Array.isArray(state.shoes) ? state.shoes : []).forEach(s => {
      if (s && s.id != null && !state.deleted.includes(s.id)) byId[s.id] = s;
    });
    let applied = 0, keptNewer = 0;
    incoming.forEach(s => {
      const ex = byId[s.id];
      const exT = ex ? (ex.updatedAt || ex.createdAt || 0) : -1;
      const inT = (s.updatedAt || s.createdAt || 0);
      // Brand-new shoe (not stored yet) → add it. An EXISTING shoe is only overwritten by a
      // push that carries a REAL timestamp and isn't older (inT > 0 && inT >= exT). A TIMELESS
      // bulk push — an OLD cached copy of the app dumping the whole catalog — can no longer
      // clobber a stored shoe. That timeless tie was the last hole that reverted live edits.
      if (!ex) { byId[s.id] = s; applied++; }
      else if (inT > 0 && inT >= exT) { byId[s.id] = s; applied++; }
      else { keptNewer++; }
    });
    const next = Object.keys(byId).map(k => byId[k]);
    console.log('[shop] /shop/shoes MERGE:', before, '→', next.length, 'shoes (applied ' + applied + ', kept-newer ' + keptNewer + ')');
    state.shoes = next;
    persist('shoes.json'); bump();
    res.json({ ok: true, count: state.shoes.length });
  });

  app.post('/shop/shoe/delete', (req, res) => {
    if (!auth(req, res)) return;
    const id = req.body && req.body.id;
    if (id == null) return res.status(400).json({ error: 'bad id' });
    if (Array.isArray(state.shoes)) state.shoes = state.shoes.filter(x => x.id !== id);
    if (!state.deleted.includes(id)) state.deleted.push(id);
    persist('shoes.json'); persist('deleted.json'); bump();
    res.json({ ok: true });
  });

  // Bulk-assert a device's deletion graveyard. The website re-pushes its local
  // deleted ids here on every load, so a deletion made anywhere is re-learned by
  // the server even after a restart that lost runtime data — deletes can never
  // come back. MERGES (never shrinks) and also drops those shoes from inventory.
  app.post('/shop/deleted', (req, res) => {
    if (!auth(req, res)) return;
    const ids = (req.body && req.body.ids) || [];
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'bad ids' });
    let changed = false;
    for (const id of ids) {
      if (id == null) continue;
      if (!state.deleted.includes(id)) { state.deleted.push(id); changed = true; }
    }
    if (Array.isArray(state.shoes)) {
      const before = state.shoes.length;
      state.shoes = state.shoes.filter(x => !state.deleted.includes(x.id));
      if (state.shoes.length !== before) changed = true;
    }
    if (changed) { persist('shoes.json'); persist('deleted.json'); bump(); }
    res.json({ ok: true, deleted: state.deleted.length });
  });

  console.log('[shop] mounted: /shop/state /shop/note(s) /shop/sale /shop/log /shop/shoe(s) — key set:', SHOP_KEY !== 'plug242' ? 'custom' : 'default');
}

// Live inventory accessors so the bot's shoe search can respect what the website
// has marked sold / deleted (the website pushes catalog shoe updates to /shop/shoe
// as {id, sizes, sold, price}). Returns whatever the in-memory state currently has.
function getShoes() { return Array.isArray(state.shoes) ? state.shoes : []; }
function getDeleted() { return Array.isArray(state.deleted) ? state.deleted : []; }

module.exports = { mount, blastEmployees, addAlert, getShoes, getDeleted, recordStaffSale, recordStaffRestock, attachSaleProof, getProof, getEmployees: () => state.employees, getSales: () => (Array.isArray(state.sales) ? state.sales : []), getNotes: () => (Array.isArray(state.notes) ? state.notes : []) };
