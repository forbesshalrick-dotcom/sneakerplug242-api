const express = require('express');
const cors = require('cors');
const catalog = require('./catalog.json');

const app = express();
app.use(cors());

// ── Body parsing: accept the customer's text no matter how it arrives ─────────
// ManyChat (WhatsApp/IG/Messenger) can send JSON, form-encoded, or raw text with
// an unexpected/absent Content-Type. We keep the raw bytes and let every parser
// try, so extractQuery() below can read whatever actually came through.
const saveRaw = (req, res, buf) => { if (buf && buf.length) req.rawBody = buf.toString(); };
app.use(express.json({ strict: false, verify: saveRaw }));
app.use(express.urlencoded({ extended: true, verify: saveRaw }));
app.use(express.text({ type: () => true, verify: saveRaw }));
// If JSON parsing fails (e.g. raw text labelled application/json), don't 500 —
// keep the raw string so extractQuery can still read it.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    req.body = (err.body !== undefined ? err.body : '');
    return next();
  }
  next(err);
});

const PORT = process.env.PORT || 3000;

// ── Request recorder ──────────────────────────────────────────────────────────
// Keeps the last few raw requests in memory so we can SEE exactly what ManyChat
// sends. View at GET /last?key=plug242 . Purely diagnostic.
const DEBUG_KEY = 'plug242';
const recent = [];
function record(req, extra) {
  recent.unshift({
    at: new Date().toISOString(),
    method: req.method,
    path: req.path,
    contentType: req.headers['content-type'] || null,
    userAgent: req.headers['user-agent'] || null,
    query: req.query,
    rawBody: req.rawBody || null,
    parsedBody: req.body,
    ...extra,
  });
  if (recent.length > 25) recent.length = 25;
}

// ── Pull the customer's text out of the request, however it arrived ───────────
const FIELDS = ['message', 'query', 'text', 'q', 'input', 'msg', 'last_text_input',
  'last_input_text', 'lastTextInput', 'body', 'question', 'content', 'value',
  'payload', 'keyword', 'user_input', 'userInput'];

// A value is junk if it's empty or an unresolved ManyChat merge tag like
// "{{last_input_text}}" (means the bot was misconfigured and never filled it in).
function isJunk(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^\{\{.*\}\}$/.test(s)) return true;
  return false;
}

function extractQuery(req) {
  // 1. Query string (?q= / ?message= ...)
  if (req.query) {
    for (const k of FIELDS) if (!isJunk(req.query[k])) return String(req.query[k]).trim();
  }

  let b = req.body;

  // 2. Raw text/plain body
  if (typeof b === 'string') {
    const s = b.trim();
    if (s && !/^[[{]/.test(s) && !isJunk(s)) return s;
    try { b = JSON.parse(s); } catch (_) { /* not JSON, leave it */ }
  }

  // 3. Object body — check known fields, including one level of nesting
  if (b && typeof b === 'object') {
    const objs = [b];
    for (const v of Object.values(b)) if (v && typeof v === 'object') objs.push(v);

    for (const o of objs) {
      for (const k of FIELDS) if (!isJunk(o[k])) return String(o[k]).trim();
    }
    // Any non-empty string value anywhere (1 level deep)
    for (const o of objs) {
      for (const v of Object.values(o)) if (typeof v === 'string' && !isJunk(v)) return v.trim();
    }
    // Keyless form post: "jordan 4" arrived with a form Content-Type and parsed
    // to { "jordan 4": "" } — the text is the key itself.
    for (const k of Object.keys(b)) {
      if (b[k] === '' && /[a-z]/i.test(k) && !isJunk(k)) return k.trim();
    }
  }

  // 4. Last resort: the raw body as-is (ignore structural JSON like {} / [])
  if (req.rawBody && req.rawBody.trim() && !/^[[{]/.test(req.rawBody.trim()) && !isJunk(req.rawBody)) {
    return req.rawBody.trim();
  }
  return '';
}

// ── Keyword scoring ───────────────────────────────────────────────────────────
function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    // Split glued words like "jordan4" / "aj4" → "jordan 4" / "aj 4", so a URL
    // param or a no-space message still matches (leaves sizes like "9.5" alone).
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

function extractSize(tokens) {
  // A shoe size only counts when stated unambiguously:
  //   1. Right after a size word:  "size 9", "sz 9.5", "in 10"
  //   2. A standalone half size:   "8.5", "9.5"  (no model number ends in .5)
  // A bare whole number like "4" or "11" is NOT a size — those are model numbers
  // ("Jordan 4", "Jordan 11"); reading them as sizes filtered out every result.
  const sizeWords = ['size', 'sz', 'in'];
  const fmt = n => String(n % 1 === 0 ? n : n.toFixed(1)).replace('.0', '');

  for (let i = 0; i < tokens.length; i++) {
    if (sizeWords.includes(tokens[i]) && tokens[i + 1]) {
      const n = parseFloat(tokens[i + 1]);
      if (!isNaN(n) && n >= 3 && n <= 20) return fmt(n);
    }
  }
  for (const t of tokens) {
    if (/^\d{1,2}\.5$/.test(t)) {
      const n = parseFloat(t);
      if (n >= 3 && n <= 20) return fmt(n);
    }
  }
  return null;
}

const BRAND_KEYWORDS = {
  'jordan':      ['jordan', 'aj', 'jumpman'],
  'nike':        ['nike'],
  'asics':       ['asics'],
  'new balance': ['newbalance', 'nb', 'balance', '1906', '9060', '1000', '550', '740'],
};

function scoreShoe(shoe, tokens, sizeFilter) {
  let score = 0;

  const brandKey = shoe.brand.toLowerCase();
  for (const [brand, keywords] of Object.entries(BRAND_KEYWORDS)) {
    if (brandKey.includes(brand) && keywords.some(kw => tokens.includes(kw))) score += 3;
  }

  for (const mt of tokenize(shoe.name)) {
    if (mt.length >= 3 && tokens.includes(mt)) score += 2;
  }

  if (shoe.nickname) {
    for (const nt of tokenize(shoe.nickname)) {
      if (nt.length >= 3 && tokens.includes(nt)) score += 4;
    }
  }

  for (const ct of tokenize(shoe.color)) {
    if (ct.length >= 3 && tokens.includes(ct)) score += 2;
  }

  for (const nm of tokenize(shoe.name).filter(t => /^\d+$/.test(t))) {
    if (tokens.includes(nm)) score += 3;
  }

  if (sizeFilter !== null) {
    const hasSize = shoe.sizesRaw.some(s => String(parseFloat(s)) === String(parseFloat(sizeFilter)));
    if (!hasSize) return 0;
    score += 1;
  }

  return score;
}

// All shoes that match the query at its most specific level.
// We keep only the top-scoring tier so "Jordan 4" returns every Jordan 4 (not
// every Jordan). A broad query like "Jordan" scores all Jordans equally, so they
// all come back — which is the "show me everything you have" case.
function findMatches(raw) {
  const tokens = tokenize(raw);
  const sizeFilter = extractSize(tokens);
  const scored = catalog
    .map(shoe => ({ shoe, score: scoreShoe(shoe, tokens, sizeFilter) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.length ? scored[0].score : 0;
  const best = scored.filter(x => x.score === top);
  return { tokens, sizeFilter, shoes: best.map(x => x.shoe), scored: best };
}

function sizesOf(shoe) {
  return [...new Set(shoe.sizesRaw.map(s => parseFloat(s)))].sort((a, b) => a - b)
    .map(n => n % 1 === 0 ? String(n) : n.toFixed(1)).join(', ');
}
function displayName(shoe) {
  return shoe.nickname ? `${shoe.name} (${shoe.nickname})` : shoe.name;
}
function formatShoeMessage(shoe) {
  return `👟 *${displayName(shoe)}*\n🎨 ${shoe.color}\n💰 $${shoe.price}\n📏 Sizes: ${sizesOf(shoe)}`;
}

// ── WhatsApp dynamic-block helper ─────────────────────────────────────────────
// ManyChat renders this JSON directly. Hard limit: 10 messages per response.
const WA_MAX_MESSAGES = 10;
const wa = messages => ({ version: 'v2', content: { type: 'whatsapp', messages: messages.slice(0, WA_MAX_MESSAGES), actions: [] } });

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', shoes: catalog.length }));

// Diagnostic: see the last requests ManyChat sent.
app.get('/last', (req, res) => {
  if (req.query.key !== DEBUG_KEY) return res.status(403).json({ error: 'add ?key=plug242' });
  res.json({ count: recent.length, requests: recent });
});

// ── WhatsApp endpoint — returns a picture for EVERY matching shoe ──────────────
function handleWhatsApp(req, res) {
  const raw = extractQuery(req);
  const { shoes } = raw.trim() ? findMatches(raw) : { shoes: [] };
  record(req, { endpoint: 'whatsapp', extractedQuery: raw, matchCount: shoes.length });

  if (!raw.trim()) {
    return res.json(wa([{ type: 'text', text: 'Hi! 👋 What shoe are you looking for? e.g. *Jordan 4* or *Air Max 95*' }]));
  }
  if (!shoes.length) {
    return res.json(wa([{ type: 'text', text: "Hmm, I don't have that in stock right now. DM me for special orders! 📲" }]));
  }

  // One image per matching shoe. 10-message cap = 1 summary + up to 9 pictures.
  const maxPics = WA_MAX_MESSAGES - 1;
  const shown = shoes.slice(0, maxPics);
  const header = shoes.length === 1
    ? "Yes! Here's what I've got 👇"
    : `Found ${shoes.length} matches${shoes.length > maxPics ? ` — showing the first ${maxPics}` : ''} 👇`;
  const summary = header + '\n\n' + shown.map((s, i) =>
    `${i + 1}. *${displayName(s)}* — $${s.price}\n   📏 ${sizesOf(s)}`).join('\n');

  const messages = [{ type: 'text', text: summary }];
  for (const s of shown) if (s.image) messages.push({ type: 'image', url: s.image });
  res.json(wa(messages));
}
app.post('/whatsapp', handleWhatsApp);
app.get('/whatsapp', handleWhatsApp);

// ── Generic JSON lookup (field-mapping style) — returns ALL matches ───────────
function handleLookup(req, res) {
  const raw = extractQuery(req);
  const { shoes } = raw.trim() ? findMatches(raw) : { shoes: [] };
  record(req, { endpoint: 'lookup', extractedQuery: raw, matchCount: shoes.length });

  if (!raw.trim()) {
    return res.json({
      found: false, count: 0, shoes: [],
      message: "Hi! Ask me what you're looking for. Example: *Do you have Jordan 4 in size 9?*",
    });
  }
  if (!shoes.length) {
    return res.json({
      found: false, count: 0, shoes: [],
      message: "Hmm, I don't have that in stock right now. DM me for special orders! 📲",
      image_1: null, image_2: null, image_3: null,
    });
  }

  // Numbered summary so the list lines up with the photos sent after it.
  const numbered = shoes.map((s, i) =>
    `${i + 1}. *${displayName(s)}* — $${s.price}\n   📏 ${sizesOf(s)}`).join('\n');
  const message = shoes.length === 1
    ? `Yes! Here's what I've got 👇\n\n${numbered}`
    : `Found ${shoes.length} options 👇\n\n${numbered}`;

  const flat = {};
  shoes.forEach((s, i) => {
    const n = i + 1;
    flat[`shoe_${n}_name`] = displayName(s);
    flat[`shoe_${n}_price`] = `$${s.price}`;
    flat[`shoe_${n}_sizes`] = sizesOf(s);
    flat[`shoe_${n}_color`] = s.color;
    flat[`shoe_${n}_caption`] = `${i + 1}. ${displayName(s)} — $${s.price} | 📏 ${sizesOf(s)}`;
    flat[`image_${n}`] = s.image || null;
  });

  res.json({
    found: true,
    count: shoes.length,
    message,
    shoes: shoes.map(s => ({
      name: displayName(s), brand: s.brand, color: s.color,
      price: `$${s.price}`, sizes: sizesOf(s), image: s.image,
    })),
    images: shoes.map(s => s.image).filter(Boolean),
    ...flat,
  });
}
app.post('/lookup', handleLookup);
app.get('/lookup', handleLookup);

// ── Push the photos straight to the customer via ManyChat's Sending API ───────
// WhatsApp image blocks won't render a per-search (dynamic) photo, so instead the
// flow hands us the subscriber id and WE send the text + one image per matching
// shoe through ManyChat's back-end API. Works while the 24h customer-care window
// is open — always true the moment they search. Token comes from the
// MANYCHAT_TOKEN env var (set in Railway), or an Authorization header as fallback.
const MC_API = 'https://api.manychat.com/fb/sending/sendContent';
const MAX_PHOTOS = catalog.length;  // send a photo for EVERY matching shoe (capped only by total inventory)
const CHUNK = 10;               // ManyChat caps messages per content payload

function getContactId(req) {
  const keys = ['contact_id', 'subscriber_id', 'subscriberId', 'contactId', 'user_id'];
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  for (const src of srcs) for (const k of keys) {
    if (src[k] == null) continue;
    // ManyChat subscriber ids are numeric; strip any stray characters (e.g. a
    // leftover "{" if the merge tag in the URL was malformed) before using it.
    const cleaned = String(src[k]).replace(/[^0-9]/g, '');
    if (cleaned && !isJunk(cleaned)) return cleaned;
  }
  return null;
}

function getToken(req) {
  if (process.env.MANYCHAT_TOKEN) return process.env.MANYCHAT_TOKEN.trim();
  const h = req.headers['authorization'];
  if (h) return h.replace(/^Bearer\s+/i, '').trim();
  if (req.headers['x-mc-token']) return String(req.headers['x-mc-token']).trim();
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  if (b.token) return String(b.token).trim();
  return null;
}

async function sendChunk(subscriberId, messages, token) {
  const r = await fetch(MC_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: { version: 'v2', content: { type: 'whatsapp', messages } },
    }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body: body.slice(0, 300) };
}

async function handleSendPhotos(req, res) {
  const raw = extractQuery(req);
  const subscriberId = getContactId(req);
  const token = getToken(req);
  const { shoes } = raw.trim() ? findMatches(raw) : { shoes: [] };
  record(req, { endpoint: 'send-photos', extractedQuery: raw, matchCount: shoes.length, subscriberId, hasToken: !!token });

  if (!token) return res.json({ ok: false, error: 'no_token (set MANYCHAT_TOKEN)', sent: 0 });
  if (!subscriberId) return res.json({ ok: false, error: 'no_contact_id', sent: 0 });

  let messages;
  if (!raw.trim()) {
    messages = [{ type: 'text', text: 'Hi! 👋 What shoe are you looking for? e.g. *Jordan 4* or *Air Max 95*' }];
  } else if (!shoes.length) {
    messages = [{ type: 'text', text: "Hmm, I don't have that in stock right now. DM me for special orders! 📲" }];
  } else {
    const pics = shoes.filter(s => s.image).slice(0, MAX_PHOTOS);
    const numbered = shoes.map((s, i) => `${i + 1}. *${displayName(s)}* — $${s.price}\n   📏 ${sizesOf(s)}`).join('\n');
    const header = shoes.length === 1 ? "Yes! Here's what I've got 👇" : `Found ${shoes.length} 👇`;
    messages = [{ type: 'text', text: `${header}\n\n${numbered}` }];
    for (const s of pics) messages.push({ type: 'image', url: s.image });
  }

  // Reply to ManyChat IMMEDIATELY so its External Request doesn't time out (and
  // possibly retry, double-sending). The actual photos go out in the background
  // via the Sending API, which is independent of this response.
  res.json({ ok: true, queued: messages.length, count: shoes.length });

  (async () => {
    const results = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      try { results.push(await sendChunk(subscriberId, messages.slice(i, i + CHUNK), token)); }
      catch (e) { results.push({ ok: false, error: String(e).slice(0, 200) }); }
    }
    // Record the ManyChat Sending API outcome so /last shows why a send failed.
    record(req, { endpoint: 'send-result', subscriberId, sent: messages.length, sendResults: results });
  })();
}
app.post('/send-photos', handleSendPhotos);
app.get('/send-photos', handleSendPhotos);

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
