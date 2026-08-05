// shop.js — shared "brain" for the SNEAKERPLUG242 web app.
// Stores notes/tasks, sales, activity log and inventory in one place so every
// employee phone sees the same data. Persists to a Railway volume (/data) so it
// survives restarts. Sends WhatsApp alerts to employees on new notes via ManyChat.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Base catalog (immutable) — used only as a resurrection guard: a device's FIRST-EVER
// push for a catalog shoe id must never claim more stock than the catalog's own baseline
// (see the /shop/shoe guard below, 2026-07-24: sold-out catalog items reappearing in stock).
let CATALOG_BASE = {};
try { require('./catalog.json').forEach(s => { if (s && s.id != null) CATALOG_BASE[s.id] = s; }); } catch (_) {}

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
  dateTasks: loadFile('dateTasks.json', {}), // { "YYYY-MM-DD": [{id,text,by,at}] } — queued into THAT evening's WhatsApp reminder (not an instant alert like notes/tasks above)
  // 🔍 SHOE AUDIT (Rodney 2026-07-29). The inventory "reverting" has been patched five
  // separate times and keeps coming back, because every fix was reasoned from a symptom
  // instead of a record. Nothing has ever written down WHAT actually changed a shoe. This
  // does: every write to /shop/shoe, /shop/shoes and /shop/shoe/delete is logged with the
  // before/after sizes, the decision the guards made, and where the request came from. Next
  // time a size reappears there is a fact to read instead of a theory to argue about.
  shoeAudit: loadFile('shoeAudit.json', []),
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

// ── shoe audit ───────────────────────────────────────────────────────────────
// Record EVERY attempted change to a shoe, accepted or not. `grew` is the one that
// matters most: a size count going UP is a size coming BACK — i.e. a revert. Kept to
// the last MAX_SHOE_AUDIT entries and persisted, so it survives a redeploy.
const MAX_SHOE_AUDIT = 3000;
const sizeCount = (arr) => (Array.isArray(arr) ? arr.length : 0);
function reqSource(req) {
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const ua = String(req.headers['user-agent'] || '').slice(0, 80);
    const by = (req.body && (req.body.by || req.body.clientId || (req.body.shoe && req.body.shoe.by))) || '';
    return { ip, ua, by: String(by).slice(0, 40) };
  } catch (_) { return {}; }
}
function auditShoe(req, id, decision, before, after, extra) {
  try {
    const b = before || null, a = after || null;
    const bN = sizeCount(b && b.sizes), aN = sizeCount(a && a.sizes);
    const entry = Object.assign({
      at: new Date().toISOString(),
      id: String(id),
      decision,                                  // accepted | added | skipped-stale | skipped-deleted | shrink-from-stale-app | resurrection-guard | bulk | deleted
      beforeSizes: b ? b.sizes : null,
      afterSizes: a ? a.sizes : null,
      beforeSold: b ? !!b.sold : null,
      afterSold: a ? !!a.sold : null,
      // 🚩 the revert signal: stock went UP, or a sold shoe came back to life
      grew: (decision === 'accepted' || decision === 'added' || decision === 'shrink-from-stale-app' || decision === 'bulk')
            && (aN > bN || (b && b.sold && a && !a.sold)),
      inT: (a && (a.updatedAt || a.createdAt)) || 0,
      exT: (b && (b.updatedAt || b.createdAt)) || 0,
      src: reqSource(req),
    }, extra || {});
    state.shoeAudit.unshift(entry);
    if (state.shoeAudit.length > MAX_SHOE_AUDIT) state.shoeAudit.length = MAX_SHOE_AUDIT;
    persist('shoeAudit.json');
    if (entry.grew) console.log('[shop] ⚠️ STOCK GREW', entry.id, JSON.stringify(entry.beforeSizes), '->', JSON.stringify(entry.afterSizes), entry.decision, JSON.stringify(entry.src));
    if (decision === 'accepted' || decision === 'added' || decision === 'shrink-from-stale-app' || decision === 'bulk') maybeAlertRevert(entry);
    return entry;
  } catch (_) { return null; }
}

// ── revert alarm ─────────────────────────────────────────────────────────────
// Stock going UP is not automatically wrong — Rodney adds new pairs all the time, and
// pinging him for that would be noise he'd learn to ignore. A REVERT is narrower and
// unmistakable: a size that was REMOVED from this very shoe within the last 48h has
// come BACK. That we can prove from the audit itself, so that's the only thing we shout
// about. (Rodney 2026-07-29, after years of reverts that nobody could catch in the act.)
const REVERT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const revertAlertAt = new Map();          // shoeId -> ts of last alert (don't nag)
const REVERT_ALERT_GAP_MS = 10 * 60 * 1000;
function shoeLabel(id) {
  const c = CATALOG_BASE[id];
  if (!c) return String(id);
  return [c.brand, c.name, c.color].filter(Boolean).join(' ').trim() || String(id);
}
function countSizes(arr) { return (Array.isArray(arr) ? arr : []).reduce((m, s) => (m[String(s)] = (m[String(s)] || 0) + 1, m), {}); }
function maybeAlertRevert(entry) {
  try {
    const beforeC = countSizes(entry.beforeSizes), afterC = countSizes(entry.afterSizes);
    const added = Object.keys(afterC).filter(s => afterC[s] > (beforeC[s] || 0));
    const lost  = Object.keys(beforeC).filter(s => (afterC[s] || 0) < beforeC[s]);
    const unSold = !!(entry.beforeSold && !entry.afterSold);
    if (!added.length && !lost.length && !unSold) return;
    // A revert runs in BOTH directions and the first build only caught one of them
    // (Rodney 2026-07-29: two Air Force 1s he'd raised to 2 pairs were quietly back at 1 —
    // an ADDITION that vanished, which the growth-only check would have missed entirely).
    //   cameBack  = a size he REMOVED in the last 48h is back   → the classic revert
    //   wentAway  = an amount he ADDED in the last 48h is gone  → his work being undone
    // Both are proven from the audit's own history, so neither is a guess. A plain sale
    // (stock he never recently added going down) still says nothing.
    const cutoff = Date.now() - REVERT_LOOKBACK_MS;
    const cameBack = [], wentAway = [];
    for (const row of state.shoeAudit) {
      if (row === entry || row.id !== entry.id) continue;
      if (new Date(row.at).getTime() < cutoff) break;   // audit is newest-first
      const bC = countSizes(row.beforeSizes), aC = countSizes(row.afterSizes);
      for (const s of added) if ((aC[s] || 0) < (bC[s] || 0) && !cameBack.includes(s)) cameBack.push(s);
      for (const s of lost)  if ((aC[s] || 0) > (bC[s] || 0) && !wentAway.includes(s)) wentAway.push(s);
    }
    if (!cameBack.length && !wentAway.length && !unSold) return;   // genuine restock or sale — stay quiet
    const last = revertAlertAt.get(entry.id) || 0;
    if (Date.now() - last < REVERT_ALERT_GAP_MS) return;
    revertAlertAt.set(entry.id, Date.now());
    const label = shoeLabel(entry.id);
    const what = [];
    if (cameBack.length) what.push('↩️ Size ' + cameBack.join(', ') + ' came BACK after you removed it');
    if (wentAway.length) what.push('❌ Size ' + wentAway.join(', ') + ' you added has DISAPPEARED');
    if (unSold) what.push('↩️ This shoe was marked SOLD and is now un-sold');
    const lines = [
      '🔁 *YOUR EDIT WAS UNDONE*',
      '👟 *' + label + '*  (' + entry.id + ')',
      what.join('\n'),
      '📋 Was: ' + JSON.stringify(entry.beforeSizes) + '\n   Now: ' + JSON.stringify(entry.afterSizes),
      '📱 From: ' + ((entry.src && entry.src.ip) || 'unknown') + ((entry.src && entry.src.ua) ? ' · ' + entry.src.ua.slice(0, 40) : ''),
      '🕒 ' + new Date(entry.at).toLocaleString('en-US', { timeZone: 'America/Nassau' }),
      '',
      'Check it: /shop/audit?key=…&id=' + entry.id,
    ];
    const text = lines.join('\n');
    const mgr = (state.employees && (state.employees.Manager || state.employees.manager)) || '';
    if (mgr) waSend(String(mgr).replace(/\D/g, ''), text).catch(() => {});
    sendPush('🔁 Your edit was undone', label + ' — ' + (cameBack.length ? 'size ' + cameBack.join(', ') + ' came back' : wentAway.length ? 'size ' + wentAway.join(', ') + ' disappeared' : 'un-sold'), '/').catch(() => {});
    console.log('[shop] 🔁 REVERT ALERT', entry.id, label, 'back:', cameBack.join(',') || '-', 'gone:', wentAway.join(',') || '-');
  } catch (e) { console.error('[shop] revert alert failed:', e.message); }
}

// ── revert GUARD (Rodney 2026-08-02) ─────────────────────────────────────────
// maybeAlertRevert above only ever SHOUTED after the fact — it could prove a size had
// been undone, but nothing stopped the undo from landing in the first place. The hole:
// "newest wins" trusts whatever timestamp a push carries, and a stale device that's been
// sitting open all day stamps Date.now() (NOW) at push time regardless of how old its
// DATA actually is — so a genuinely stale push always looks "newest" and sails straight
// through the one branch (`state.shoes[i] = sh`) that has zero content checks. Proven
// live: size 12 on an Air Max 95 sold at 12:02 AM, and by 5:35 PM it was back in stock —
// some device's stale copy pushed with a fresher clock than the sale itself.
// This runs BEFORE that trust is extended: for a push that's about to look "newest", any
// size that was deliberately REMOVED from this exact shoe within the lookback window and
// is now trying to reappear gets stripped back out — same signal maybeAlertRevert already
// proved reliable, just enforced instead of only reported.
function stripRevertedSizes(id, beforeShoe, incomingShoe) {
  if (!beforeShoe || !incomingShoe || !Array.isArray(incomingShoe.sizes)) return { shoe: incomingShoe, blocked: [] };
  const count = (arr) => (Array.isArray(arr) ? arr : []).reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
  const beforeC = count(beforeShoe.sizes), inC = count(incomingShoe.sizes);
  const grown = Object.keys(inC).filter(s => inC[s] > (beforeC[s] || 0));
  if (!grown.length) return { shoe: incomingShoe, blocked: [] };
  const cutoff = Date.now() - REVERT_LOOKBACK_MS;
  const cameBack = [];
  for (const row of state.shoeAudit) {
    if (row.id !== id) continue;
    if (new Date(row.at).getTime() < cutoff) break; // audit is newest-first
    const bC = count(row.beforeSizes), aC = count(row.afterSizes);
    for (const s of grown) if ((aC[s] || 0) < (bC[s] || 0) && !cameBack.includes(s)) cameBack.push(s);
  }
  if (!cameBack.length) return { shoe: incomingShoe, blocked: [] };
  // Clamp just the reverting sizes back to what's actually stored right now — every other
  // legitimate change in the push (other sizes, price, name edits) still goes through.
  const sizes = incomingShoe.sizes.slice();
  for (const s of cameBack) {
    let allow = beforeC[s] || 0, have = 0;
    for (let k = sizes.length - 1; k >= 0; k--) {
      if (String(sizes[k]) === String(s)) { have++; if (have > allow) sizes.splice(k, 1); }
    }
  }
  return { shoe: Object.assign({}, incomingShoe, { sizes }), blocked: cameBack };
}
function alertRevertBlocked(id, blockedSizes, before, after, req) {
  try {
    const last = revertAlertAt.get(id) || 0;
    if (Date.now() - last < REVERT_ALERT_GAP_MS) return;
    revertAlertAt.set(id, Date.now());
    const label = shoeLabel(id);
    const lines = [
      '🛡️ *REVERT BLOCKED*',
      '👟 *' + label + '*  (' + id + ')',
      '↩️ Size ' + blockedSizes.join(', ') + ' tried to come back after you sold/removed it — a stale device push, kept OUT of your live stock.',
      '📋 Stayed at: ' + JSON.stringify(before && before.sizes),
      '📱 From: ' + ((reqSource(req) && reqSource(req).ip) || 'unknown'),
      '🕒 ' + new Date().toLocaleString('en-US', { timeZone: 'America/Nassau' }),
    ];
    const text = lines.join('\n');
    const mgr = (state.employees && (state.employees.Manager || state.employees.manager)) || '';
    if (mgr) waSend(String(mgr).replace(/\D/g, ''), text).catch(() => {});
    sendPush('🛡️ Revert blocked', label + ' — size ' + blockedSizes.join(', ') + ' stayed sold', '/').catch(() => {});
    console.log('[shop] 🛡️ REVERT BLOCKED', id, label, 'sizes:', blockedSizes.join(','));
  } catch (e) { console.error('[shop] alertRevertBlocked failed:', e.message); }
}

// ── sale ↔ stock, tied atomically (Rodney 2026-08-02) ────────────────────────
// "Sales never get dropped because they're recorded separately — why can't inventory
// work the same way?" Because until now, recording a sale and shrinking the matching
// shoe's stock were two INDEPENDENT client pushes that could drift apart (one lands,
// the other doesn't, or lands and later gets overwritten). Do the stock side here too,
// server-side, on the server's own clock, in the same request that records the sale —
// so logging the sale IS what removes the pair. A client's own follow-up shoe push still
// arrives normally and just confirms the same state (see stripRevertedSizes above for
// what happens if a stale one tries to undo it instead).
function applySaleToStock(req, sale) {
  if (!Array.isArray(state.shoes) || sale.shoeId == null || sale.size == null) return;
  const i = state.shoes.findIndex(x => x.id === sale.shoeId);
  if (i < 0) return; // shoe not synced to the shop yet — nothing here to adjust
  const before = JSON.parse(JSON.stringify(state.shoes[i]));
  const sizes = Array.isArray(state.shoes[i].sizes) ? state.shoes[i].sizes.slice() : [];
  const idx = sizes.findIndex(x => String(x) === String(sale.size));
  if (idx === -1) return; // already reflects the sale — nothing to do
  sizes.splice(idx, 1);
  state.shoes[i] = Object.assign({}, state.shoes[i], { sizes, sold: sizes.length === 0 ? true : state.shoes[i].sold, updatedAt: Date.now() });
  persist('shoes.json'); bump();
  auditShoe(req, sale.shoeId, 'accepted', before, state.shoes[i], { via: 'sale' });
}
// Symmetric restock when a sale is voided — "that's the correct way to put a size back"
// (see the recovery note below) now actually does it, instead of relying on the client
// to separately push the shoe back to its pre-sale sizes.
function applyVoidToStock(req, sale) {
  if (!Array.isArray(state.shoes) || !sale || sale.shoeId == null || sale.size == null) return;
  const i = state.shoes.findIndex(x => x.id === sale.shoeId);
  if (i < 0) return;
  const before = JSON.parse(JSON.stringify(state.shoes[i]));
  const sizes = Array.isArray(state.shoes[i].sizes) ? state.shoes[i].sizes.slice() : [];
  sizes.push(sale.size);
  state.shoes[i] = Object.assign({}, state.shoes[i], { sizes, sold: false, updatedAt: Date.now() });
  persist('shoes.json'); bump();
  auditShoe(req, sale.shoeId, 'accepted', before, state.shoes[i], { via: 'void' });
}

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

// ── One-time RE-RECONCILE (Rodney 2026-08-02) ────────────────────────────────
// The revert bug was STILL landing right up until stripRevertedSizes/applySaleToStock
// shipped above — so stock it never got a chance to guard is still wrong on disk right
// now (an Air Max 95 Black/Blue sold size 12 at 12:02 AM, reverted back by 5:35 PM the
// same day). Re-run the exact same sales-vs-stock reconciliation as the v1 recovery,
// under a fresh marker so it fires once more on this deploy — it pulls EVERY shoe back
// in line with what sales.json actually says sold, not just this one pair, since sales
// were never the thing that went missing (see the revert-guard note above).
try {
  const marker2 = path.join(DATA_DIR, 'sold_recovered_v2.flag');
  if (!fs.existsSync(marker2)) {
    const n = applySoldFromSales();
    console.log('[shop] re-reconcile v2 (post-revert-guard): adjusted', n, 'shoes from', state.sales.length, 'sale records');
    if (n) persist('shoes.json');
    try { fs.writeFileSync(marker2, new Date().toISOString()); } catch (_) {}
  }
} catch (e) { console.error('[shop] v2 sold re-reconcile failed:', e.message); }

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
// 🔑 TOKEN FALLBACK (Rodney 2026-08-05). This only ever read MANYCHAT_TOKEN from the
// environment, and that env var is NOT set on Railway — so EVERY staff text alert that
// goes through here has been failing silently: the task-board blast, the revert alerts,
// float requests, and the customer's delivery-tracking link. Found it when a "post these
// 7 shoes" blast came back {Manager:false, Deashinique:false, Owner:false} while the photo
// sends (which use a different path) went out fine. The server already holds live ManyChat
// tokens learned from inbound webhooks — server.js hands one over via setFallbackToken, so
// these sends now work with or without the env var.
let _fallbackToken = null;
function setFallbackToken(t) { if (t) _fallbackToken = t; }
async function waSend(phoneDigits, text) {
  const token = process.env.MANYCHAT_TOKEN || _fallbackToken;
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

  // 🔍 Read the shoe audit — the record of what actually changed each shoe.
  //   /shop/audit?key=…              → most recent writes across all shoes
  //   /shop/audit?key=…&id=c0446     → just that shoe's history
  //   /shop/audit?key=…&grew=1       → ONLY the reverts (stock went up / un-sold)
  //   &limit=N                        → how many (default 100)
  app.get('/shop/audit', (req, res) => {
    if (!auth(req, res)) return;
    const id = req.query.id ? String(req.query.id) : '';
    const onlyGrew = req.query.grew === '1' || req.query.grew === 'true';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
    let rows = state.shoeAudit || [];
    if (id) rows = rows.filter(r => r.id === id);
    if (onlyGrew) rows = rows.filter(r => r.grew);
    res.json({
      total: (state.shoeAudit || []).length,
      grewTotal: (state.shoeAudit || []).filter(r => r.grew).length,
      returned: Math.min(rows.length, limit),
      rows: rows.slice(0, limit),
    });
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

  // ---- Date tasks (queued into a SPECIFIC evening's WhatsApp shift reminder,
  // alongside the 7 rotating social-media shoes — NOT an instant alert) ----
  app.get('/shop/date-tasks', (req, res) => {
    if (!auth(req, res)) return;
    const date = String(req.query.date || '').slice(0, 10);
    res.json({ ok: true, tasks: date ? getDateTasks(date) : (state.dateTasks || {}) });
  });
  app.post('/shop/date-task', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const date = String(b.date || '').slice(0, 10);
    const text = String(b.text || '').trim();
    if (!date || !text) return res.status(400).json({ error: 'date and text required' });
    const task = addDateTask(date, text, b.by);
    res.json({ ok: true, task });
  });
  app.post('/shop/date-task/delete', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const ok = deleteDateTask(String(b.date || '').slice(0, 10), b.id);
    res.json({ ok });
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
      // Shrink the matching shoe's stock right here, server-side — see applySaleToStock.
      try { applySaleToStock(req, s); } catch (e) { console.error('[shop] applySaleToStock failed:', e.message); }
    }
    res.json({ ok: true, count: state.sales.length });
  });

  // Void/reverse a sale — remove it from the shared register by id.
  app.post('/shop/sale/void', (req, res) => {
    if (!auth(req, res)) return;
    const id = req.body && req.body.id;
    if (id == null) return res.status(400).json({ error: 'no id' });
    const before = state.sales.length;
    const voided = state.sales.find(x => String(x.id) === String(id));
    state.sales = state.sales.filter(x => String(x.id) !== String(id));
    // Drop any pinned payment proof for a voided sale so it doesn't orphan on disk.
    if (state.proofs && state.proofs[String(id)]) { delete state.proofs[String(id)]; persist('proofs.json'); }
    if (state.sales.length !== before) {
      persist('sales.json'); bump();
      // Put the size back — see applyVoidToStock. This is now the ACTUAL restock, not
      // just a note saying voiding is "the correct way" while nothing enforced it.
      if (voided) { try { applyVoidToStock(req, voided); } catch (e) { console.error('[shop] applyVoidToStock failed:', e.message); } }
    }
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
    if (state.deleted.includes(sh.id)) { auditShoe(req, sh.id, 'skipped-deleted', null, sh); return res.json({ ok: true, skipped: 'deleted' }); }
    if (!Array.isArray(state.shoes)) state.shoes = [];
    const i = state.shoes.findIndex(x => x.id === sh.id);
    const _before = i > -1 ? JSON.parse(JSON.stringify(state.shoes[i])) : null;
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
          auditShoe(req, sh.id, 'shrink-from-stale-app', _before, state.shoes[i]);
          return res.json({ ok: true, accepted: 'shrink-from-stale-app' });
        }
        auditShoe(req, sh.id, 'skipped-stale', _before, sh, { why: inT === 0 ? 'no timestamp on the push' : 'push older than stored' });
        return res.json({ ok: true, skipped: 'stale' });
      }
      // Even a push that LOOKS newest can carry stale content (see stripRevertedSizes) —
      // strip out any size trying to reappear after it was deliberately removed before
      // trusting the rest of this "newer" push. EXCEPTION: a push flagged _manualEdit came
      // from a human who just typed this exact size list into the edit form and hit Save —
      // that's a deliberate restock, not a stale device, so it skips the strip entirely
      // (Rodney 2026-08-02: the guard was silently stripping a real restock of a size that
      // happened to have sold recently — indistinguishable from a revert by pattern alone,
      // so a genuine manual edit has to say so explicitly instead of being pattern-matched).
      // The flag itself never gets stored — it only ever applies to THIS one push.
      const isManualEdit = !!sh._manualEdit;
      if (sh._manualEdit != null) delete sh._manualEdit;
      const { shoe: safeShoe, blocked } = isManualEdit
        ? { shoe: sh, blocked: [] }
        : stripRevertedSizes(sh.id, state.shoes[i], sh);
      state.shoes[i] = safeShoe;
      auditShoe(req, sh.id, 'accepted', _before, safeShoe, blocked.length ? { revertBlocked: blocked } : (isManualEdit ? { via: 'manual-edit' } : undefined));
      if (blocked.length) alertRevertBlocked(sh.id, blocked, _before, safeShoe, req);
    } else {
      // FIRST-EVER PUSH FOR THIS ID — nothing to compare it against, so a stale device's
      // "everything looks fine" local copy would otherwise be accepted with zero checks
      // (2026-07-24: sold-out catalog items reappearing in stock). For a CATALOG shoe, refuse
      // a first push that claims MORE stock than the catalog's own immutable baseline — a
      // genuinely full-stock item never needed pushing in the first place, so this only ever
      // blocks a resurrection, never a real sale/edit (which always SHRINKS or matches stock).
      const base = sh._catalog ? CATALOG_BASE[sh.id] : null;
      if (base && Array.isArray(base.sizes)) {
        const count = (arr) => (Array.isArray(arr) ? arr : []).reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
        const baseC = count(base.sizes), inC = count(sh.sizes);
        const overStock = Object.keys(inC).some(s => inC[s] > (baseC[s] || 0));
        if (overStock) { auditShoe(req, sh.id, 'resurrection-guard', { sizes: base.sizes, sold: false }, sh, { why: 'first push claims more stock than the catalog baseline' }); return res.json({ ok: true, skipped: 'resurrection-guard' }); }
      }
      state.shoes.push(sh);
      auditShoe(req, sh.id, 'added', null, sh);
    }
    persist('shoes.json'); bump();
    res.json({ ok: true });
  });

  // 🔥 Put a shoe ON SALE (or take it off). Rodney wanted customers to SEE that a price is a
  // sale price rather than just a lower number (2026-07-29). Deliberately a flag + the old
  // price, NOT free text in the price box — the price must stay a real number or the sales
  // reports, totals and price searches all break.
  //   POST /shop/shoe/sale  { id, sale: true, price: 60, wasPrice: 120 }
  //   POST /shop/shoe/sale  { id, sale: false }          → back to a normal price
  // price/wasPrice are optional: leave wasPrice out and it remembers what the shoe costs now.
  app.post('/shop/shoe/sale', (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    if (b.id == null) return res.status(400).json({ error: 'bad id' });
    if (!Array.isArray(state.shoes)) state.shoes = [];
    const i = state.shoes.findIndex(x => String(x.id) === String(b.id));
    if (i < 0) return res.status(404).json({ error: 'shoe not found in shop state' });
    const cur = state.shoes[i];
    const on = b.sale !== false && b.sale !== 'false' && b.sale !== 0;
    const before = JSON.parse(JSON.stringify(cur));
    if (on) {
      // Remember what it USED to cost so the label can show it struck through.
      const oldPrice = (b.wasPrice != null) ? Number(b.wasPrice)
                     : (cur.wasPrice != null ? cur.wasPrice : cur.price);
      cur.sale = true;
      if (oldPrice != null && !isNaN(oldPrice)) cur.wasPrice = oldPrice;
      if (b.price != null && !isNaN(Number(b.price))) cur.price = Number(b.price);
    } else {
      cur.sale = false;
      // Coming OFF sale restores the pre-sale price unless a new one was given.
      if (b.price != null && !isNaN(Number(b.price))) cur.price = Number(b.price);
      else if (cur.wasPrice != null) cur.price = cur.wasPrice;
      delete cur.wasPrice;
    }
    cur.updatedAt = Date.now();
    persist('shoes.json'); bump();
    auditShoe(req, cur.id, 'accepted', before, cur, { via: on ? 'sale-on' : 'sale-off' });
    res.json({ ok: true, id: cur.id, sale: !!cur.sale, price: cur.price, wasPrice: cur.wasPrice || null });
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
      if (!ex) { byId[s.id] = s; applied++; auditShoe(req, s.id, 'added', null, s, { via: 'bulk' }); }
      else if (inT > 0 && inT >= exT) {
        // Same stale-but-fresh-looking-timestamp risk as the single-shoe path: strip any
        // size trying to come back from a recent removal before trusting this "newer" row.
        const { shoe: safeShoe, blocked } = stripRevertedSizes(s.id, ex, s);
        // Only log a bulk overwrite that actually CHANGES stock — a full catalog dump would
        // otherwise write hundreds of no-op rows and bury the signal.
        const changed = JSON.stringify(ex.sizes) !== JSON.stringify(safeShoe.sizes) || !!ex.sold !== !!safeShoe.sold;
        byId[s.id] = safeShoe; applied++;
        if (changed) auditShoe(req, s.id, 'bulk', ex, safeShoe, blocked.length ? { revertBlocked: blocked } : undefined);
        if (blocked.length) alertRevertBlocked(s.id, blocked, ex, safeShoe, req);
      }
      else { keptNewer++; if (JSON.stringify(ex.sizes) !== JSON.stringify(s.sizes)) auditShoe(req, s.id, 'skipped-stale', ex, s, { via: 'bulk', why: inT === 0 ? 'no timestamp on the push' : 'push older than stored' }); }
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

  // List what's currently tombstoned, with a label where we can figure one out (the
  // catalog baseline, or the shoe's audit history) — deleting only ever kept the bare
  // id, so this is how staff can even tell WHICH shoe an id refers to before deciding
  // whether to undelete it (Rodney 2026-08-02 — there was previously no way back at all
  // from an accidental delete, e.g. two real pairs mistaken for one duplicate listing).
  app.get('/shop/deleted-detail', (req, res) => {
    if (!auth(req, res)) return;
    const rows = (state.deleted || []).map(id => {
      const base = CATALOG_BASE[id] || null;
      let lastAudit = null;
      for (const row of state.shoeAudit) { if (row.id === id) { lastAudit = row; break; } } // newest-first
      return {
        id,
        label: base ? shoeLabel(id) : (lastAudit ? shoeLabel(id) : String(id)),
        recoverable: !!base, // only a catalog shoe has a baseline we can rebuild from
        lastSeenSizes: lastAudit ? lastAudit.beforeSizes : null,
        lastChangeAt: lastAudit ? lastAudit.at : null,
      };
    });
    res.json({ total: rows.length, rows });
  });

  // Undo an accidental delete. A catalog shoe (the vast majority) has an immutable
  // baseline in catalog.json we can rebuild from — sizes/price won't reflect whatever
  // was actually in stock the moment it got deleted (that data is gone, deleting never
  // kept a copy), but the listing itself comes back so staff can correct the count by
  // hand instead of re-creating the shoe from scratch. A non-catalog custom shoe has no
  // baseline to rebuild from — undeleting it only clears the tombstone so a device that
  // still has it cached locally can re-push it.
  app.post('/shop/shoe/undelete', (req, res) => {
    if (!auth(req, res)) return;
    const id = req.body && req.body.id;
    if (id == null) return res.status(400).json({ error: 'bad id' });
    const wasDeleted = state.deleted.includes(id);
    state.deleted = state.deleted.filter(x => x !== id);
    persist('deleted.json');
    let restored = false;
    if (!Array.isArray(state.shoes)) state.shoes = [];
    const already = state.shoes.some(x => x.id === id);
    const base = CATALOG_BASE[id];
    if (!already && base) {
      const shoe = Object.assign({}, base, { updatedAt: Date.now(), createdAt: Date.now(), sold: false });
      state.shoes.push(shoe);
      restored = true;
      auditShoe(req, id, 'added', null, shoe, { via: 'undelete' });
      persist('shoes.json');
    }
    bump();
    res.json({ ok: true, wasDeleted, restored, hasBaseline: !!base, alreadyPresent: already });
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

// Tasks queued for a SPECIFIC date's evening reminder (Rodney 2026-07-27) — added from
// the website's Tasks page, merged into that day's WhatsApp shift reminder alongside the
// 7 rotating shoes, instead of instantly alerting everyone like the notes above do.
function getDateTasks(dateKey) { return (state.dateTasks && state.dateTasks[dateKey]) || []; }
function addDateTask(dateKey, text, by) {
  if (!state.dateTasks || typeof state.dateTasks !== 'object') state.dateTasks = {};
  if (!Array.isArray(state.dateTasks[dateKey])) state.dateTasks[dateKey] = [];
  const task = { id: Date.now() + Math.random(), text: String(text).slice(0, 300), by: by || 'Manager', at: new Date().toISOString() };
  state.dateTasks[dateKey].push(task);
  persist('dateTasks.json'); bump();
  return task;
}
function deleteDateTask(dateKey, id) {
  if (!state.dateTasks || !Array.isArray(state.dateTasks[dateKey])) return false;
  const before = state.dateTasks[dateKey].length;
  state.dateTasks[dateKey] = state.dateTasks[dateKey].filter(t => String(t.id) !== String(id));
  persist('dateTasks.json'); bump();
  return state.dateTasks[dateKey].length !== before;
}

module.exports = { mount, setFallbackToken, blastEmployees, addAlert, getShoes, getDeleted, recordStaffSale, recordStaffRestock, attachSaleProof, getProof, getEmployees: () => state.employees, getSales: () => (Array.isArray(state.sales) ? state.sales : []), getNotes: () => (Array.isArray(state.notes) ? state.notes : []), getDateTasks };
