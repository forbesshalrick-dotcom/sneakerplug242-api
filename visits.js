/* ============================================================================
   visits.js — a page counter for the agency site.

   Rodney is about to put the site in front of people and would otherwise have
   no idea whether anybody came, which demo they opened, or where they gave up.
   "Post it and hope" is not a plan.

   Deliberately NOT Google Analytics or Plausible:
     · no third-party script, so nothing to slow the page or get blocked
     · no cookie, so no consent banner on a site whose whole pitch is "simple"
     · no monthly fee, and no account to lose access to
     · same server the bots already run on, same /data volume as everything else

   What it stores is one line per day per path. The closest thing to a person is
   a number: IP + user agent + today's date, hashed with a secret that changes
   every midnight. That tells you "two different phones" without ever storing
   which two phones, and the hash cannot be walked back the next day because the
   salt is gone. Nothing here identifies anybody.
   ============================================================================ */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 120;
const MAX_PATHS = 400;   // a runaway URL generator cannot balloon the file

/* Same /data volume the rest of the server uses, so a redeploy does not wipe
   the numbers. Without a volume it still counts, it just forgets on restart. */
const FILE = (() => {
  try {
    for (const d of [process.env.DATA_DIR, '/data'].filter(Boolean)) {
      if (fs.existsSync(d)) return path.join(d, 'visits.json');
    }
  } catch (_) {}
  return null;
})();

let days = {};                                   // { '2026-08-14': {...} }
try {
  if (FILE && fs.existsSync(FILE)) days = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
} catch (_) { days = {}; }

let saveT = null;
function save() {
  if (!FILE) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(days)); } catch (_) {}
  }, 3000);
  if (saveT.unref) saveT.unref();
}

/* Nassau day, not UTC — a visit at 9pm Tuesday should read as Tuesday. */
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Nassau', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/* The salt rotates at midnight, so yesterday's hashes can never be matched to
   today's — the counter can tell you how many, never who, and not for long. */
let saltDay = '', salt = '';
function visitorId(ip, ua, day) {
  if (saltDay !== day) { saltDay = day; salt = crypto.randomBytes(16).toString('hex'); }
  return crypto.createHash('sha256').update(salt + '|' + ip + '|' + ua).digest('hex').slice(0, 16);
}

function blank() {
  return { views: 0, paths: {}, refs: {}, demos: {}, events: {}, seen: [] };
}

function bump(obj, key, cap) {
  if (!key) return;
  key = String(key).slice(0, 120);
  if (!(key in obj) && cap && Object.keys(obj).length >= cap) return;
  obj[key] = (obj[key] || 0) + 1;
}

function prune() {
  const keys = Object.keys(days).sort();
  while (keys.length > KEEP_DAYS) delete days[keys.shift()];
}

/* Where did they come from — the host only, never the full URL somebody was
   reading before they arrived. */
function refHost(r) {
  try {
    const h = new URL(String(r)).hostname.replace(/^www\./, '');
    return h || null;
  } catch (_) { return null; }
}

function mount(app) {
  app.post('/px', (req, res) => {
    /* Answer first, count after. A counter must never be able to slow a page
       down or, worse, break it. */
    res.status(204).end();
    try {
      const b = req.body || {};
      const day = today();
      const d = (days[day] = days[day] || blank());

      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      const ua = String(req.headers['user-agent'] || '').slice(0, 200);
      const id = visitorId(ip, ua, day);
      if (!d.seen.includes(id)) {
        if (d.seen.length < 20000) d.seen.push(id);
      }

      d.views++;
      bump(d.paths, String(b.p || '/').split('?')[0], MAX_PATHS);
      bump(d.refs, refHost(b.r), 100);
      if (b.d) bump(d.demos, b.d, 40);
      if (b.e) bump(d.events, b.e, 60);

      prune();
      save();
    } catch (_) { /* a counter is never worth an error */ }
  });

  /* The read side is private — visitor counts are Rodney's business, not the
     internet's. Set VISITS_TOKEN on Railway; without one the report is closed. */
  app.get('/px/report', (req, res) => {
    const want = process.env.VISITS_TOKEN;
    if (!want) return res.status(503).json({ ok: false, reason: 'no-token-set' });
    if (String(req.query.key || '') !== want) return res.status(403).json({ ok: false });

    const n = Math.min(Number(req.query.days) || 30, KEEP_DAYS);
    const keys = Object.keys(days).sort().slice(-n);
    const out = keys.map(k => {
      const d = days[k];
      return {
        day: k, views: d.views, visitors: d.seen.length,
        paths: top(d.paths), demos: top(d.demos), refs: top(d.refs), events: top(d.events)
      };
    });
    res.json({
      ok: true,
      totals: {
        views: out.reduce((a, x) => a + x.views, 0),
        visitors: out.reduce((a, x) => a + x.visitors, 0),   // per-day visitors, summed
        days: out.length
      },
      days: out
    });
  });

  function top(o, n = 12) {
    return Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
      .reduce((m, [k, v]) => (m[k] = v, m), {});
  }
}

module.exports = { mount };
