// shop.js — shared "brain" for the SNEAKERPLUG242 web app.
// Stores notes/tasks, sales, activity log and inventory in one place so every
// employee phone sees the same data. Persists to a Railway volume (/data) so it
// survives restarts. Sends WhatsApp alerts to employees on new notes via ManyChat.

const fs = require('fs');
const path = require('path');

// Shared key the website sends with every request. It lives in the (public)
// client JS so it's a gate against random scanners, not a strong secret — the
// note endpoint is also rate-limited below to blunt abuse.
const SHOP_KEY = process.env.SHOP_KEY || 'sp242-shopkey-7Kq9wTm';
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

// Add a note to the shared board programmatically (e.g. a delivery-ready alert
// from the bot), so it shows on the website's Tasks for whoever's on duty.
// Does NOT fire the employee WhatsApp blast — the caller handles any messaging.
function addAlert(text, by) {
  const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const note = {
    id: uid, text: String(text || '').trim(), kind: 'task',
    shoeId: null, shoeLabel: null, by: by || 'Jess 🤖',
    done: false, doneBy: null, doneAt: null, createdAt: new Date().toISOString(),
  };
  if (!note.text) return null;
  state.notes.unshift(note);
  if (state.notes.length > 500) state.notes.length = 500;
  persist('notes.json'); bump();
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
    const label = note.kind === 'shoe' && note.shoeLabel ? `\n👟 ${note.shoeLabel}` : '';
    const msg = `📋 New task from ${note.by}:\n${note.text}${label}\n\nOpen the app to see it. ✅`;
    let delivery = [];
    try { delivery = await blastEmployees(msg, note.by); } catch (_) {}
    res.json({ note, delivery });
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
        if (src[k] || !target[k]) target[k] = src[k];
      });
    }
    mergeInto(state.accounts, b.accounts);
    mergeInto(state.roles, b.roles);
    mergeInto(state.employees, b.numbers);
    persist('accounts.json'); persist('roles.json'); persist('employees.json'); bump();
    res.json({ accounts: state.accounts, roles: state.roles, employees: state.employees });
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
    if (i > -1) state.shoes[i] = sh; else state.shoes.push(sh);
    persist('shoes.json'); bump();
    res.json({ ok: true });
  });

  // Replace the whole inventory at once (used for first upload / bulk sync)
  app.post('/shop/shoes', (req, res) => {
    if (!auth(req, res)) return;
    const arr = (req.body && req.body.shoes) || null;
    if (!Array.isArray(arr)) return res.status(400).json({ error: 'bad shoes' });
    // Drop any tombstoned shoes so a bulk push can't bring deletions back.
    state.shoes = arr.filter(s => s && !state.deleted.includes(s.id));
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

module.exports = { mount, blastEmployees, addAlert, getShoes, getDeleted };
