const express = require('express');
const cors = require('cors');
const catalog = require('./catalog.json');

// Each shoe is a 360° spin (frames 0..35). The stored "-thumb" image is frame 0.
// Per-shoe side-profile overrides live in FRAME_OVERRIDES below: any shoe id not
// listed uses frame 0; listed shoes use their chosen frame number. (Rodney picks
// the ones that need a different angle.)
const FRAME_OVERRIDES = {
  // Jordans
  'jordan4pizza001': 13,
  'jordan4pink001': 13,
  'jordan4blackred002': 10,
  'jordan4allred001': 6,
  'jordan11volt001': 11,
  'jordan4milblue001': 13,
  'jordan4gum001': 13,
  'jordan11black001': 12,
  'jordan11royalblue001': 22,
  'jordan4bblured001': 23,
  'jordan6blackred001': 20,
  // Nike Air Max / Plus / Dunk / Mule / VaporMax
  'nikemuleblack001': 2,
  'airmaxplus3001': 16,
  'vapormaxevo001': 35,
  'nikedunkhigh001': 28,
  'airmaxpluswpur001': 17,
  'airmax95bkyel001': 18,
  'airmax97cheet001': 18,
  'airmaxplusgrb001': 17,
  'airmaxplusptn001': 10,
  'airmax90grn001': 17,
  'airmax90brn001': 17,
  'airmaxplusbkbr001': 10,
  'airmax90bkyel001': 10,
  'airmaxpluspkwht001': 10,
  'airmax95bkbl001': 26,
  'nikemulewhite001': 12,
  // New shoes p41–p74
  'p41': 16,
  'p49': 2,
  'p50': 13,
  'p51': 19,
  'p52': 1,
  'p53': 1,
  'p54': 1,
  'p55': 1,
  'p57': 1,
  'p59': 1,
  'p60': 1,
  'p61': 4,
  'p63': 4,
  'p64': 1,
  'p65': 1,
  'p67': 1,
  'p69': 1,
  'p70': 1,
  'p71': 19,
  // Asics
  'asicsgrnsil001': 1,
  'asicsbrnwht001': 1,
  'asicsgrncream001': 1,
  'asicsdkblue001': 1,
  // New Balance
  'nb9060white001': 31,
  'nb740pinksilv001': 1,
  // Jordan 5 (size 10.5 list — frame 0 wasn't a clean side profile; 19 was tilted)
  'jordan5blue001': 9,
};
for (const s of catalog) {
  if (!s.image) continue;
  const frame = FRAME_OVERRIDES[s.id] != null ? FRAME_OVERRIDES[s.id] : 0;
  s.image = s.image.replace(/-thumb\.(jpe?g|png|webp)$/i, `-${frame}.$1`);
}

const app = express();
app.use(cors());
app.set('trust proxy', true); // Railway runs behind a proxy → correct https in self-built links

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

// Keys that are metadata, NOT the customer's message — never treat their values
// as the search text in the catch-all fallbacks below.
const NON_MESSAGE_KEYS = new Set(['name', 'full_name', 'fullname', 'first_name',
  'firstname', 'last_name', 'lastname', 'store', 'contact_name', 'token',
  'contact_id', 'subscriber_id', 'subscriberid', 'contactid', 'user_id',
  'audio_url', 'voice_url', 'voice', 'audio', 'attachment_url', 'media_url',
  'file_url', 'last_audio_url', 'attachment', 'url']);

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
    // Any non-empty string value anywhere (1 level deep), skipping metadata keys
    for (const o of objs) {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && !isJunk(v) && !NON_MESSAGE_KEYS.has(k.toLowerCase())) return v.trim();
      }
    }
    // Keyless form post: "jordan 4" arrived with a form Content-Type and parsed
    // to { "jordan 4": "" } — the text is the key itself.
    for (const k of Object.keys(b)) {
      if (b[k] === '' && /[a-z]/i.test(k) && !isJunk(k) && !NON_MESSAGE_KEYS.has(k.toLowerCase())) return k.trim();
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

// Bounded Levenshtein edit distance — bails out early (returns max+1) the moment
// it's clear the distance exceeds `max`. Used for typo-tolerant search ("thundr"
// → "thunder", "jordon" → "jordan", "cment" → "cement").
function levenshtein(a, b, max = 2) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[bl];
}

// Does query word `w` match anywhere in the haystack? Forgiving of plurals and
// typos so colorway/nickname searches ("yellow thunder", "bred", "cement") land
// even when misspelled. `hay` is the joined lowercase text, `hayWords` its tokens.
function wordMatches(hay, hayWords, w) {
  if (hay.includes(w)) return true;                                          // direct substring (covers partials: "bred" in "bred reimagined")
  if (w.endsWith('s') && w.length > 3 && hay.includes(w.slice(0, -1))) return true;  // plural → singular ("thunders" → "thunder")
  if (hay.includes(w + 's')) return true;                                    // singular → plural
  if (w.length >= 5) {                                                       // typo tolerance (5+ chars only — a 4-letter word like "bred" is 1 edit from "red", causing false hits)
    const tol = w.length >= 7 ? 2 : 1;
    for (const hw of hayWords) {
      if (Math.abs(hw.length - w.length) <= tol && levenshtein(w, hw, tol) <= tol) return true;
    }
  }
  return false;
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

// Which store the message came from (each ManyChat flow sends a constant "store"),
// used to greet with the right shop name.
function getStore(req) {
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  for (const src of srcs) {
    if (src.store != null && !isJunk(src.store)) return String(src.store).trim();
  }
  return null;
}

// The customer's saved name (ManyChat sends it), used for name-based greetings.
function getName(req) {
  const keys = ['name', 'full_name', 'fullName', 'first_name', 'firstName', 'contact_name'];
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  for (const src of srcs) for (const k of keys) {
    if (src[k] != null && !isJunk(src[k])) return String(src[k]).trim();
  }
  return null;
}

// A voice-note / audio file URL, if the message was a voice note. ManyChat hands
// us the attachment URL; we transcribe it (Whisper) and treat it like typed text.
function getAudioUrl(req) {
  const keys = ['audio_url', 'voice_url', 'voice', 'audio', 'attachment_url',
    'media_url', 'file_url', 'last_audio_url', 'attachment', 'url'];
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  for (const src of srcs) for (const k of keys) {
    const v = src[k];
    if (v == null || isJunk(v)) continue;
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s)) return s;
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

// ── Claude-powered conversational assistant (/chat) ───────────────────────────
// ManyChat relays EVERY customer message here. We run Claude (with an inventory
// search tool and a photo-sending tool), keep a short per-customer memory, and
// push Claude's replies + the shoe photos back through ManyChat's Sending API.
// Needs ANTHROPIC_API_KEY (Claude) in the env and a ManyChat token (header).
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';

const BRANDS = [...new Set(catalog.map(s => s.brand))];
const ALL_SIZES = [...new Set(catalog.flatMap(s => s.sizesRaw.map(x => parseFloat(x))))].sort((a, b) => a - b);
const SIZE_RANGE = ALL_SIZES.length ? `${ALL_SIZES[0]}–${ALL_SIZES[ALL_SIZES.length - 1]}` : 'various';

const STORE_DEFAULT = 'THE PLUG 242';
const WEBSITE = '242plug.netlify.app';
const FOLLOWUP_MS = Number(process.env.FOLLOWUP_MS) || 10 * 60 * 1000; // 10 minutes
const END_OF_PHOTOS_MSG = `There's the photos! 👟 If you want to check out even more, visit our website and search what you need in the search bar. 👉 ${WEBSITE}`;
const FOLLOWUP_MSG = 'Hey! Just following up 😊 Did you see anything you liked, or did you get sorted?';

function buildSystemPrompt({ store, name } = {}) {
  const storeName = store || STORE_DEFAULT;
  const who = name && name.trim() ? name.trim() : '';
  return `You are the friendly WhatsApp shopping assistant for ${storeName}, a sneaker store in The Bahamas.

How to chat:
- This is WhatsApp. Keep EVERY reply short and natural — a sentence or two, casual, at most a couple of emojis. Never write paragraphs.
- WELCOME: On your very FIRST reply in a brand-new conversation, greet the customer with exactly this line: "Hi! Welcome! 👟 This is ${storeName}! You can browse everything on our website 👉 ${WEBSITE} — or tell me right here: are you looking for a specific shoe you already have in mind, or do you want me to show you what we've got?" (If their first message already names a shoe or a size, still open with that greeting, then go straight to helping them.)
- Talk like a real, friendly shop assistant having a normal conversation. Do NOT fire off photos the moment you see a number — but do NOT interrogate them either.
- NEVER ask the customer whether they're "looking for something specific" or have "anything specific in mind", and never ask "what kind of shoe are you after". Don't make them name a model. Your DEFAULT move is simply to offer to show what we have, e.g. "Want me to show you what we've got in {size}? 👟" (or without the size if they haven't given one). Only dig into a specific shoe/brand/colour if THEY bring it up first.
- Before you show photos, just TWO things need to be clear: (1) they actually want to see shoes, and (2) their SIZE. Don't ask for their name.
- Ask only ONE short question at a time. Never stack two questions in one message — pick the single most useful one and send just that.
- SHOWING BEATS ASKING: if you'd otherwise be guessing WHICH shoes the customer means (e.g. which colourway, which exact model, or you're just not sure), don't keep asking — once you know their size, just send the photos of the likely matches and let them verify and pick from the pictures. A photo they can say "yes that one" to is better than another question.
- ALWAYS REPLY — NEVER GO SILENT (IMPORTANT): Every customer message must get a reply. Never end your turn having sent them nothing. If a customer asks to SEE shoes — "show me some Jordan 1s", "what Jordans you got?", "show me the New Balance", "lemme see what you have" — immediately call search_inventory for that brand/model and then send_photos of what we have. You do NOT need their size first to show them. After you call search_inventory you MUST follow through the same conversation: either send_photos of the results, or (only if the search truly came back empty) tell them kindly we don't have it and offer a special order. Never stop after searching without showing or saying anything.
- PHOTOS THE CUSTOMER SENDS (IMPORTANT): You CANNOT see images. If a customer sends or forwards a photo, or points at a picture instead of naming the shoe — "I want this", "I want this in a size 9", "this one", "the yellow one", "the pair in the pic", "how much for this" — do NOT ask them for a screenshot and do NOT say you'll "sort it out" from the photo. You can't see it. Instead, EVERY photo we send has the shoe's NAME printed right under it, so ask them to read it off, in one short friendly line, e.g. "Love it! 😍 What's the name on the photo? It's right under the pic 👟". Once they tell you the name, call search_inventory with that name and continue normally. If they already gave a size (like "in a size 9"), remember it and use it — don't ask for the size again.
- IMPORTANT — a bare number on its own (like "9" or "10") is AMBIGUOUS. It might be their size, but it could be a typo, a time ("open at 9"), or something else. NEVER assume a lone number means "show me everything in that size." If a customer just sends a number with no shoe context, reply with a short friendly question to check first, e.g. "You mean size 9? 👟 Want me to show you what we've got?" — and only send photos once they confirm.
- EXCEPTION to the bare-number rule: if YOUR previous message already asked the customer for their size (e.g. you said "What size are you?"), then a bare number they send back IS their answer — treat it as their size, do NOT ask again. If you already know they want to see shoes, go straight to search_inventory + send_photos in that size. If you only know the size but not yet what they want, give the short lead-in and show what you've got in that size. The point: once you've asked for a size, a number reply means "that's my size" — act on it, don't re-question it.
- Once it's clear they want options (or they've named a shoe) AND you know their size, THEN call search_inventory and send_photos with every match. If they said everything in one message ("any blue Asics in size 8", "you got Jordan 4 in a 9?"), that's clear intent — go ahead and show them.
- Specific shoe: if they name a shoe ("Jordan 4", "Air Max 95"), help with that; ask their size only if you need it to narrow things down.
- COLORWAYS & NICKNAMES (IMPORTANT): Shoes are often asked for by their colourway nickname, sometimes with a colour word in front — "yellow thunder", "white thunder", "red thunder", "bred", "cement", "royal", "panda", "pizza", "lightning". ALWAYS look these up with search_inventory before you ever say we don't have something — pass the customer's words straight through as the query (e.g. query = "yellow thunder", or "white thunder"). The search already looks across each shoe's name, nickname AND colour and is forgiving of typos/odd spellings ("thundr", "jordon", "cment"), so trust it. NEVER tell a customer we don't carry a colourway based on your own guess — only say it's out of stock if search_inventory genuinely returns nothing. If they pair a colour with a nickname, just include both words in the query; you don't need to split them into the colour field.
- Brands: only bring up a brand if the CUSTOMER does.
  - If we carry that brand (see the list below) and you don't have their size yet, ask their size, then send the matches in that brand and size.
  - If we do NOT carry that brand, kindly tell them we don't carry it, and offer what we do have.
- SHOW OPTIONS AS PHOTOS (don't list model names in text): When the customer has narrowed to a group but still needs to pick WHICH model or colourway — e.g. they say "the grey New Balance" / "the gray ones" and we carry the 1000, 9060 and 2002, or "show me your Jordan 4s" — do NOT just type the model names and ask them to choose. Instead call search_inventory for that group and send_photos of the options, so the customer SEES each one with its name, price and sizes labelled right under the picture (that label is automatic). This looks far more professional than a plain text list. You do NOT need their size first to show options — they pick the model from the photos, then you sort their size out after. Use include_sizes = true. For THIS options case, your single lead-in line frames them as a choice instead of the usual "rite now / Ready to Order" line — e.g. "Here's the grey New Balance we've got 👇 Which one you like?" or "Here's our Jordan 4s 👇 Which one catches your eye?". (If the group turns out to be just one shoe, skip the question and simply show it.)
- CONFIRM A NAMED SHOE WITH ITS PHOTO (IMPORTANT): Whenever you tell the customer about ONE specific shoe — its price, or that we have it (e.g. they ask "how much for the Gamma Blue 11?" and you find it) — do NOT answer in words only. Call send_photos for that shoe so they SEE the exact pair; its name, price and sizes print right under the photo, which confirms you both mean the same one. Put your short confirming line in the send_photos lead_in (e.g. lead_in = "Got it! The Air Jordan 11 (Gamma Blue) is $180 👇"). Showing the pair always beats just describing it — a customer should never have to take your word for which shoe it is.
- When you DO send photos, always send ALL the matching shoes with send_photos — never just a few.
- NEVER narrate what you're doing. Do not say "one sec", "let me check", "let me pull that up", "now let me send the photos", or anything similar. Call search_inventory SILENTLY with no message at all. Your ONE short lead-in line MUST be passed as the send_photos lead_in argument — NOT typed as a separate message. The system puts it right before the photos so the 👇 points down at them. Do NOT also write any other text on the turn you call send_photos. In the "SHOW OPTIONS AS PHOTOS" case above, that lead_in is your choice-framing line (e.g. "Here's the grey New Balance we've got 👇 Which one you like?"). In every other case the lead_in MUST keep this exact shape (including "rite now"): "This is what we have in {what} rite now 👇 Ready to Order!". Fill {what} with the BEST short description of what the customer actually asked for, using ALL the useful info they gave — colour, brand or model, and/or size. Pick the most meaningful descriptor, don't just default to the size: if they asked for "grey" and the matches are all their one size, say "This is what we have in grey rite now 👇 Ready to Order!"; if they only gave a size, use that, e.g. "This is what we have in 7.5 rite now 👇 Ready to Order!"; you can combine them when it reads naturally, e.g. "grey size 8". If the customer gave NO useful descriptor (general browsing), drop the "in {what}" part: "This is what we have rite now 👇 Ready to Order!".
- If nothing matches, say so kindly and offer to take a special-order request.

PHOTOS — how labels work (handled automatically, you don't set a flag):
- SMALL option sets (about a dozen shoes or fewer — e.g. "what you got in grey/red/yellow", a colourway, a brand group): the system automatically prints each shoe's NAME, price and sizes in a little note right under its photo. So the customer sees exactly what each pic is and what sizes it comes in.
- BIG sets (more than ~12 shoes): the photos go out album-style with no per-photo note (like flipping through a catalogue), then the closing message + the 10-minute follow-up ("did you see anything you liked?") do the work. This keeps a huge drop from being one giant wall of text.
- You don't choose between these — just call send_photos with ALL the matches and the system picks the right style by how many there are.
- Because small sets are labelled, if a customer points at a picture from one, you can ask them to read its name off (see "PHOTOS THE CUSTOMER SENDS"). If it was from a big album with no label, just ask them to describe it (colour/model) or reply to that photo.

SIZES — ranges, two sizes, and matching (IMPORTANT — never ask the customer to pick one size in these cases, and never send the same shoe twice):
- TWO SIZES, intent unclear: if a customer names two different sizes (e.g. "5.5 and 10.5") and you genuinely can't tell whether they want matching pairs (both sizes) or to see each size separately, ask exactly ONE short question and NOTHING else: "Hey! Are you looking for matching shoes in both sizes, or do you want to see what we've got in each size? 👟". Do NOT also ask what kind of shoe or anything specific. Once they answer, go straight to the matching or grouped flow below. (If they already made it clear — e.g. they said "matching" — skip the question and act.)
- SIZE RANGE — "9.5 to 10", "9.5-10", "anywhere from 9 to 10", "between 9 and 10": the customer will take anything in that range. Call search_inventory ONCE with sizes = every size in the range (e.g. ["9.5","10"]) and size_match = "any". Then send_photos with all those ids as one flat list and include_sizes = true (so they see which size each pair is). One photo per shoe — if a shoe comes in both sizes it still only goes out once. Pass lead_in = "This is what we have in your sizes rite now 👇 Ready to Order!".
- TWO DIFFERENT SIZES to compare — "show me a 7 and a 9", "size 5 and size 10" (and NOT the word "match"): keep them grouped by size. Call search_inventory once per size, then call send_photos ONCE using the groups parameter — one group per size, each with a label and that size's ids, e.g. groups = [ {label:"Here's what we have in size 5 👇", ids:[...]}, {label:"Now here's size 10 👇", ids:[...]} ]. The labels and photos go out grouped and in order. When you use groups, do NOT also type a separate lead-in line — the labels are the lead-ins. Use include_sizes = false.
- MATCHING shoes for two people — "I need matching shoes in size 9 and size 7", "matching pairs in a 9 and a 7", or clearly two people who want the same shoe in different sizes: they only want shoes that come in BOTH sizes. Call search_inventory with sizes = ["9","7"] and size_match = "all" (returns only shoes available in every one of those sizes). Then send_photos with those ids as a flat list, include_sizes = false, and lead_in = "Here are the shoes we have in both size 7 and size 9 so you can match 👇" (use their actual two sizes). If nothing comes in both sizes, tell them kindly we don't have a match in both right now and offer a special order.

You also answer these common questions yourself, in your own short friendly words (do NOT call a tool for these):

PAYMENT: If they ask about payment, tell them: we accept cash only, no cards right now, but bank transfer is available if they need it. Then ask which bank they prefer — Scotiabank or CIBC — and send the matching details:
- Scotiabank → "Scotiabank 🏦\nAccount #: 201727284\nTransit #: 09766\nName: Rodney Munnings"
- CIBC → "CIBC 🏦\nAccount #: 004005357\nTransit #: 70045\nName: Rodney Munnings"

SHIPPING: If they ask about shipping, tell them: yes we ship to ALL the Family Islands! Boat is $10 flat rate (only on certain sailing days, not every day). Plane is $35 (goes every day, charged by weight). Then ask whether they prefer Boat or Plane. Once they choose, ask them to confirm the island name, plus the full name and phone number of the person receiving it.

LOCATION: If they ask where you're located, tell them: we're on Carmichael Road West, but we're mobile and delivery-only — we'll come to your nearest spot. 📍

BAHAMIAN "COMING" PHRASING (IMPORTANT — locals often ask questions with no question mark):
- "you coming", "you coming bro", "you reaching", "wen you coming", "how long" → this means "ARE YOU COMING for the delivery / how soon?" They want to know you're on the way. Reply that yes you're coming / sorting their delivery, and ask for the details you still need (what shoe + size if you don't have them yet, and where to meet). Do NOT just recite the location line at them.
- "I coming", "im coming", "coming", "i reach", "im here", "outside", "by the car" → this means the customer has ARRIVED at the meet-up spot and is walking over to collect their delivery. Treat it as "I'm here to receive my order." Reply with a short friendly acknowledgement like "Alright, I see you! 👀 Come through 👟" — do NOT treat this as a new shoe request or ask for their size again.
- Rule of thumb: "YOU coming" = they're asking about you / the delivery arriving. "I/Im coming" or just "coming" = they've arrived and are coming to you. When unsure, ask one short clarifying question rather than guessing.

SPECIAL CONTACTS:
- If the customer's message is just the name "Rodney" (spelled R-O-D-N-E-Y), it's probably Rodney's mom. First reply ONLY with: "Hey! Is this Mommy? 😊" If she replies yes, then reply warmly: "Hi Mo! How are you doing? Love you. Hope everything is okay! 💛"
${who ? `- The customer's saved name is "${who}".\n` : ''}- If the customer's saved name is exactly "Deashinique", greet her with: "Hey Deashinique! What's up? 👟" (always spell it exactly "Deashinique").

FOLLOW-UPS: If you earlier sent "Did you see anything you liked, or did you get sorted?" and they reply: if they say NO / nothing caught their eye → reply "Okay, no worries! Maybe next time. Have a good day! 👟". If they say YES / they liked something → ask them for the NAME on the photo (you can't see pictures), e.g. "Nice! 😍 What's the name on the one you liked? It's printed right under the photo 👟" — then look it up and help them order.

Our brands: ${BRANDS.join(', ')}. Sizes in stock: roughly ${SIZE_RANGE}. Currency is USD. Website: ${WEBSITE}.
Only ever mention shoes, prices and sizes that search_inventory returns — never invent anything.`;
}

const AI_TOOLS = [
  {
    name: 'search_inventory',
    description: 'Search the live shoe inventory. Combine any of size, brand, color/style or a free-text query. Returns matching shoes with id, name, price and available sizes. Always pass the size filter once the customer has given a size.',
    input_schema: {
      type: 'object',
      properties: {
        size: { type: 'string', description: 'A single size to filter by, e.g. "9" or "10.5". Only returns shoes available in this size.' },
        sizes: { type: 'array', items: { type: 'string' }, description: 'Use INSTEAD of "size" when the customer mentions more than one size. A size RANGE ("9.5 to 10") → list every size in it, e.g. ["9.5","10"]. MATCHING shoes for two people ("size 9 and size 7") → ["9","7"]. Pair with size_match.' },
        size_match: { type: 'string', enum: ['any', 'all'], description: 'How to apply "sizes". "any" (default) = shoe available in AT LEAST ONE of the sizes (use for a size RANGE — returns each shoe once, no duplicates). "all" = shoe available in EVERY listed size (use for MATCHING shoes that must come in both sizes).' },
        brand: { type: 'string', description: 'Brand, e.g. "Jordan", "Nike", "Asics", "New Balance".' },
        color: { type: 'string', description: 'A colour/style word, e.g. "white", "black", "red".' },
        query: { type: 'string', description: 'Free text — a model, nickname or colourway, e.g. "Jordan 4", "Air Max 95", "yellow thunder", "white thunder", "bred", "cement". Searches across each shoe\'s name, nickname AND colour, and tolerates typos/odd spellings ("thundr", "jordon", "cment"). Prefer putting a colour+nickname phrase here as one query rather than splitting it.' },
      },
    },
  },
  {
    name: 'send_photos',
    description: "Send the customer a photo of each shoe over WhatsApp. Pass the ids from search_inventory. Send ALL the matching shoes. A short closing message with the website link is added automatically after the photos. Never send the same shoe twice.",
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Shoe ids to send photos for, as one flat list. Use this for a single size, a size RANGE, or MATCHING shoes.' },
        lead_in: { type: 'string', description: 'Your ONE short lead-in line, e.g. "This is what we have in 8 rite now 👇 Ready to Order!". The system sends it RIGHT BEFORE the photos so the 👇 points at them. ALWAYS pass it here — do NOT type it as a separate message. (When only ONE shoe is being sent, the system automatically skips this line and just sends the labelled photo — so still pass it; it is dropped when not needed.) Leave empty only when using groups (the group labels are the lead-ins).' },
        groups: {
          type: 'array',
          description: 'Use INSTEAD of "ids" ONLY when the customer asked for two different sizes to compare and you want them kept separate by size. One entry per size, sent in order: a label shown to the customer, then that size\'s photos.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short header shown before this size\'s photos, e.g. "Here\'s what we have in size 5 👇".' },
              ids: { type: 'array', items: { type: 'integer' }, description: 'Shoe ids available in this size.' },
            },
            required: ['ids'],
          },
        },
        include_sizes: { type: 'boolean', description: 'true = show name, price AND available sizes under each photo (use when the customer has NOT given a size / is just browsing, or for a size RANGE so they see which size each pair has). false = show only name and price (use when the customer gave one exact size, or for matching/grouped sends). Defaults to true.' },
      },
    },
  },
];

function searchInventory({ size, sizes, size_match, brand, color, query } = {}) {
  let rows = catalog.map((s, id) => ({ s, id }));
  // Build the size filter from either `size` (one) or `sizes` (a list, e.g. a
  // range "9.5 to 10" or matching "9 and 7"). Normalise each to a clean number
  // string and drop junk/duplicates.
  const sizeList = [...new Set(
    []
      .concat(Array.isArray(sizes) ? sizes : (sizes != null ? [sizes] : []))
      .concat(size != null ? [size] : [])
      .map(x => String(parseFloat(x)))
      .filter(x => x && x !== 'NaN')
  )];
  if (sizeList.length) {
    const has = (s, want) => s.sizesRaw.some(x => String(parseFloat(x)) === want);
    if (String(size_match).toLowerCase() === 'all') {
      // MATCHING: keep only shoes available in EVERY listed size.
      rows = rows.filter(({ s }) => sizeList.every(w => has(s, w)));
    } else {
      // RANGE / "any": keep shoes available in AT LEAST ONE listed size.
      // catalog has one row per shoe, so the result is already deduped.
      rows = rows.filter(({ s }) => sizeList.some(w => has(s, w)));
    }
  }
  if (brand && brand.trim()) {
    const b = brand.toLowerCase();
    rows = rows.filter(({ s }) => s.brand.toLowerCase().includes(b) || b.includes(s.brand.toLowerCase()));
  }
  if (color && color.trim()) {
    const c = color.toLowerCase();
    rows = rows.filter(({ s }) => `${s.color || ''} ${s.nickname || ''} ${s.name}`.toLowerCase().includes(c));
  }
  if (query && query.trim()) {
    // Filler words that shouldn't gate a match (so "red AND black thunderS" still finds "Red Thunder").
    const STOP = new Set(['and', 'the', 'a', 'an', 'in', 'of', 'with', 'for', 'me', 'i', 'im',
      'need', 'want', 'looking', 'you', 'your', 'got', 'have', 'has', 'some', 'pair', 'pairs',
      'shoe', 'shoes', 'sneaker', 'sneakers', 'size', 'sizes', 'please', 'plz', 'do', 'any',
      'show', 'see', 'them', 'one', 'ones', 'pls', 'get', 'wan', 'wanna']);
    const words = query.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/)
      .filter(w => w && !STOP.has(w))
      .filter(w => w.length >= 2 || /\d/.test(w))
      // "4s" / "11s" are model numbers said with an s ("Jordan 4s") → treat as "4" / "11".
      .map(w => /^\d+s$/.test(w) ? w.slice(0, -1) : w);
    rows = rows.filter(({ s }) => {
      const hay = `${s.name} ${s.brand} ${s.nickname || ''} ${s.color || ''}`.toLowerCase();
      const hayWords = hay.split(/[^a-z0-9.]+/).filter(Boolean);
      return words.every(w => wordMatches(hay, hayWords, w));
    });
  }
  return rows.map(({ s, id }) => ({ id, name: displayName(s), price: `$${s.price}`, sizes: sizesOf(s), color: s.color, brand: s.brand }));
}

// Small "options" sets (this many photos or fewer) get a label under EACH photo
// (name + price + sizes), so the customer sees what each one is and what sizes it
// comes in. Bigger sets go out album-style (bare photos) — the customer skims
// them like a catalogue and the 10-min follow-up asks if anything caught their eye.
const LABELED_MAX = 12;

async function sendShoePhotos(sub, ids, token, includeSizes = true, groups = null, leadIn = '') {
  // WhatsApp images carry NO caption (ManyChat drops it), so the label has to be
  // its own text bubble sent right after the photo. That also stops WhatsApp from
  // clumping the photos into one album, so each pic shows with its label beneath.
  const labelText = (s) => `${displayName(s)} — $${s.price}\n📏 ${sizesOf(s)}`;
  const dedupe = (idList) => {
    const seen = new Set();
    return (idList || []).filter(id => !seen.has(id) && seen.add(id))
      .map(id => catalog[id]).filter(s => s && s.image);
  };
  let sent = 0, requested = 0;

  const totalPhotos = (Array.isArray(groups) && groups.length)
    ? groups.reduce((n, g) => n + dedupe(g.ids).length, 0)
    : dedupe(ids).length;
  const showLabels = totalPhotos <= LABELED_MAX; // small set → label each; big set → album

  // Lead-in line goes out FIRST so the 👇 points down at the photos that follow —
  // but ONLY when there's more than one photo. For a single picture its own label
  // already says it all, so we skip the lead-in.
  if (totalPhotos > 1 && leadIn && String(leadIn).trim()) {
    try { await sendChunk(sub, [{ type: 'text', text: String(leadIn).trim() }], token); } catch (e) { /* non-fatal */ }
  }

  const sendBatch = async (messages) => {
    for (let i = 0; i < messages.length; i += CHUNK) {
      const slice = messages.slice(i, i + CHUNK);
      try { await sendChunk(sub, slice, token); sent += slice.filter(m => m.type === 'image').length; }
      catch (e) { /* keep going */ }
    }
  };

  // One shoe → its photo immediately followed by its label bubble (when labelling).
  const photoWithLabel = (s) => showLabels
    ? [{ type: 'image', url: s.image }, { type: 'text', text: labelText(s) }]
    : [{ type: 'image', url: s.image }];

  if (Array.isArray(groups) && groups.length) {
    // Grouped by size: a size header, then that size's photos (each labelled when small).
    for (const g of groups) {
      const chosen = dedupe(g.ids);
      requested += (g.ids || []).length;
      if (!chosen.length) continue;
      const msgs = [];
      if (g.label && String(g.label).trim()) msgs.push({ type: 'text', text: String(g.label).trim() });
      for (const s of chosen) msgs.push(...photoWithLabel(s));
      await sendBatch(msgs);
    }
  } else {
    // Flat list (single size, range, or matching).
    const chosen = dedupe(ids);
    requested = (ids || []).length;
    const msgs = [];
    for (const s of chosen) msgs.push(...photoWithLabel(s));
    await sendBatch(msgs);
  }

  // Always close with the website prompt once photos have actually gone out.
  if (sent > 0) {
    try { await sendChunk(sub, [{ type: 'text', text: END_OF_PHOTOS_MSG }], token); } catch (e) { /* non-fatal */ }
  }
  return { sent, requested };
}

// ── Voice notes → text (OpenAI Whisper) ───────────────────────────────────────
// Claude can't hear audio, so when a customer sends a WhatsApp voice note we
// download the audio file ManyChat points us at and transcribe it with Whisper,
// then feed the text into the normal chat. Needs OPENAI_API_KEY in the env.
const WHISPER_API = 'https://api.openai.com/v1/audio/transcriptions';
async function transcribeAudio(url) {
  if (!process.env.OPENAI_API_KEY) return null;
  const audio = await fetch(url);
  if (!audio.ok) return null;
  const buf = Buffer.from(await audio.arrayBuffer());
  // WhatsApp voice notes are ogg/opus; the filename extension tells Whisper the format.
  const form = new FormData();
  form.append('file', new Blob([buf]), 'voice.ogg');
  form.append('model', 'whisper-1');
  const r = await fetch(WHISPER_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
    body: form,
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return data && data.text ? String(data.text).trim() : null;
}

async function callClaude(messages, system) {
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 1024, system: system || buildSystemPrompt(), tools: AI_TOOLS, messages }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

const convos = new Map();    // subscriberId -> message history
const chatLocks = new Map(); // subscriberId -> in-flight promise (serialises a customer's messages)
const followUps = new Map(); // subscriberId -> pending 10-minute follow-up timer

// Schedule the "did you see anything you liked?" nudge for 10 min after we send
// shoes. Resets if called again. Cancelled (clearFollowUp) when the customer
// messages again — so we only nudge customers who went quiet.
function scheduleFollowUp(sub, token) {
  clearFollowUp(sub);
  const handle = setTimeout(async () => {
    followUps.delete(sub);
    try {
      await sendChunk(sub, [{ type: 'text', text: FOLLOWUP_MSG }], token);
      const h = convos.get(sub) || [];
      h.push({ role: 'assistant', content: FOLLOWUP_MSG }); // so Claude knows it asked
      convos.set(sub, trimHistory(h));
    } catch (e) { /* non-fatal */ }
  }, FOLLOWUP_MS);
  if (handle.unref) handle.unref();
  followUps.set(sub, handle);
}
function clearFollowUp(sub) {
  const h = followUps.get(sub);
  if (h) { clearTimeout(h); followUps.delete(sub); }
}

// Keep memory bounded without splitting a tool_use/tool_result pair: trim to a
// window that begins on a genuine customer text turn.
function trimHistory(h, maxLen = 24) {
  if (h.length <= maxLen) return h;
  let start = h.length - maxLen;
  while (start < h.length && !(h[start].role === 'user' && typeof h[start].content === 'string')) start++;
  return start < h.length ? h.slice(start) : h.slice(-2);
}

async function runChat(req, sub, userText, token, ctx = {}) {
  const system = buildSystemPrompt({ store: ctx.store, name: ctx.name });
  const history = convos.get(sub) || [];
  history.push({ role: 'user', content: userText });

  // The customer MUST always get a reply. Track whether we actually sent them
  // anything this turn; if a turn somehow ends with nothing sent (model fumbled,
  // a send failed, etc.), we send a recovery line at the end instead of going silent.
  let sentToCustomer = false;
  try {
  for (let step = 0; step < 6; step++) {
    const { ok, status, data } = await callClaude(history, system);
    if (!ok) {
      record(req, { endpoint: 'chat-error', sub, status, body: JSON.stringify(data).slice(0, 300) });
      await sendChunk(sub, [{ type: 'text', text: "Sorry, I'm having a little hiccup 🤕 try again in a sec." }], token).catch(() => {});
      return;
    }
    history.push({ role: 'assistant', content: data.content });
    const toolUses = data.content.filter(b => b.type === 'tool_use');
    const sendPhotosTU = toolUses.find(t => t.name === 'send_photos');
    const turnText = data.content.filter(b => b.type === 'text' && b.text.trim())
      .map(b => b.text.trim()).join('\n');
    // Stay quiet while searching. On a send_photos turn, DON'T send the text here —
    // it's handed to sendShoePhotos as the lead-in so it lands RIGHT BEFORE the
    // photos (👇 points at them), no matter how the model sequences its turns.
    const searchingOnly = toolUses.some(t => t.name === 'search_inventory') && !sendPhotosTU;
    if (!searchingOnly && !sendPhotosTU && turnText) {
      await sendChunk(sub, [{ type: 'text', text: turnText }], token).catch(() => {});
      sentToCustomer = true;
    }
    if (!toolUses.length) break;
    let photosSent = false;
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      if (tu.name === 'search_inventory') result = { shoes: searchInventory(tu.input || {}) };
      else if (tu.name === 'send_photos') {
        const inp = tu.input || {};
        const includeSizes = inp.include_sizes !== false; // default true
        // Lead-in: prefer an explicit lead_in arg, else any text the model wrote this turn.
        const leadIn = (inp.lead_in && String(inp.lead_in).trim()) ? String(inp.lead_in).trim() : turnText;
        result = await sendShoePhotos(sub, inp.ids, token, includeSizes, inp.groups, leadIn);
        if (result.sent > 0) { scheduleFollowUp(sub, token); photosSent = true; sentToCustomer = true; } // nudge 10 min later if quiet
      }
      else result = { error: 'unknown_tool' };
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    history.push({ role: 'user', content: toolResults });
    // Photos (and the auto closing message) are out — stop here so the model can't
    // append a trailing lead-in AFTER the photos on the next turn.
    if (photosSent) break;
  }
  } catch (e) {
    record(req, { endpoint: 'chat-loop-error', sub, error: String(e && e.stack || e).slice(0, 300) });
  }
  // SAFETY NET: never leave the customer hanging. If the whole turn produced no
  // message to them (model fumbled, every send failed, or it errored mid-loop),
  // send a friendly recovery line so they always get a reply.
  if (!sentToCustomer) {
    record(req, { endpoint: 'chat-fallback', sub, userText });
    await sendChunk(sub, [{ type: 'text', text: "Sorry, that didn't come through right 🙈 Tell me the shoe (and your size if you have one) and I'll pull it right up 👟" }], token).catch(() => {});
  }
  convos.set(sub, trimHistory(history));
}

function handleChat(req, res) {
  const userText = extractQuery(req);
  const audioUrl = getAudioUrl(req);
  const sub = getContactId(req);
  const token = getToken(req);
  const store = getStore(req);
  const name = getName(req);
  record(req, { endpoint: 'chat', extractedQuery: userText, audioUrl, sub, store, name, hasToken: !!token, hasAI: !!process.env.ANTHROPIC_API_KEY });

  res.json({ ok: true }); // answer ManyChat instantly; do the AI work in the background

  if (!process.env.ANTHROPIC_API_KEY) { record(req, { endpoint: 'chat-skip', reason: 'no ANTHROPIC_API_KEY' }); return; }
  if (!token || !sub) return;
  if (!userText.trim() && !audioUrl) return; // nothing to act on

  clearFollowUp(sub); // they're talking to us again — cancel any pending nudge

  const prev = chatLocks.get(sub) || Promise.resolve();
  const next = prev.then(async () => {
    let text = userText;
    // Voice note with no typed text: transcribe it first, then chat as normal.
    if (!text.trim() && audioUrl) {
      const t = await transcribeAudio(audioUrl).catch(() => null);
      record(req, { endpoint: 'voice-transcribe', sub, audioUrl, transcript: t, hasOpenAI: !!process.env.OPENAI_API_KEY });
      if (!t) {
        await sendChunk(sub, [{ type: 'text', text: "Sorry, I couldn't quite catch that voice note 🙉 mind typing it or sending it again?" }], token).catch(() => {});
        return;
      }
      text = t;
    }
    return runChat(req, sub, text, token, { store, name });
  }).catch(e => record(req, { endpoint: 'chat-crash', sub, error: String(e).slice(0, 200) }));
  chatLocks.set(sub, next);
}
app.post('/chat', handleChat);
app.get('/chat', handleChat);
// Alias: the ManyChat flow points here (it was simplest to edit "send-photos" -> "send-chat").
app.post('/send-chat', handleChat);
app.get('/send-chat', handleChat);

// Live delivery tracking (driver GPS → customer + manager watch a map).
require('./delivery').mount(app);

// Shared shop "brain": notes/tasks, sales, log, inventory synced across devices
// + WhatsApp alerts to employees on new notes.
require('./shop').mount(app);

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
