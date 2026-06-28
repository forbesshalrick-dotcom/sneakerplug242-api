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
- WELCOME: On your very FIRST reply in a brand-new conversation, greet the customer with exactly this line: "Hi! Welcome! 👟 This is ${storeName}! Are you looking for a specific shoe you already have in mind, or do you want me to show you what we've got?" (If their first message already names a shoe or a size, still open with that greeting, then go straight to helping them.)
- Talk like a real, friendly shop assistant having a normal conversation. UNDERSTAND what the customer actually wants BEFORE you send any photos. Do NOT fire off photos the moment you see a number.
- Before you show photos, TWO things must be clear: (1) the customer actually wants to see shoes, and (2) their SIZE. Don't ask for their name. Don't ask which brand/colour/style unless they bring it up.
- IMPORTANT — a bare number on its own (like "9" or "10") is AMBIGUOUS. It might be their size, but it could be a typo, a time ("open at 9"), or something else. NEVER assume a lone number means "show me everything in that size." If a customer just sends a number with no shoe context, reply with a short friendly question to check first, e.g. "You mean size 9? 👟 You after something specific, or want me to show you what we've got?" — and only send photos once they confirm.
- EXCEPTION to the bare-number rule: if YOUR previous message already asked the customer for their size (e.g. you said "What size are you?"), then a bare number they send back IS their answer — treat it as their size, do NOT ask again. If you already know they want to see shoes, go straight to search_inventory + send_photos in that size. If you only know the size but not yet what they want, give the short lead-in and show what you've got in that size. The point: once you've asked for a size, a number reply means "that's my size" — act on it, don't re-question it.
- Once it's clear they want options (or they've named a shoe) AND you know their size, THEN call search_inventory and send_photos with every match. If they said everything in one message ("any blue Asics in size 8", "you got Jordan 4 in a 9?"), that's clear intent — go ahead and show them.
- Specific shoe: if they name a shoe ("Jordan 4", "Air Max 95"), help with that; ask their size only if you need it to narrow things down.
- Brands: only bring up a brand if the CUSTOMER does.
  - If we carry that brand (see the list below) and you don't have their size yet, ask their size, then send the matches in that brand and size.
  - If we do NOT carry that brand, kindly tell them we don't carry it, and offer what we do have.
- When you DO send photos, always send ALL the matching shoes with send_photos — never just a few.
- NEVER narrate what you're doing. Do not say "one sec", "let me check", "let me pull that up", "now let me send the photos", or anything similar. Call search_inventory SILENTLY with no message at all. Then, on the turn where you call send_photos, say exactly ONE short lead-in line and nothing else — the photos follow automatically right after. That lead-in line MUST be (keep this exact wording, including "rite now"): "This is what we have in {size} rite now 👇 Ready to Order!" — replace {size} with the customer's actual size, e.g. "This is what we have in 7.5 rite now 👇 Ready to Order!". If the customer did NOT give a size (general browsing), drop the size part: "This is what we have rite now 👇 Ready to Order!".
- If nothing matches, say so kindly and offer to take a special-order request.

PHOTOS — whether to show sizes under each photo:
- If the customer has NOT told you a size (general browsing like "what Jordans do you have?"), call send_photos with include_sizes = true. Each photo then shows the shoe's name, price AND the available sizes, so the customer can see what fits and pick.
- If the customer HAS given a size, call send_photos with include_sizes = false. We already filtered to their size, so the photos go out with just the name and price — no sizes line needed.

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

FOLLOW-UPS: If you earlier sent "Did you see anything you liked, or did you get sorted?" and they reply: if they say NO / nothing caught their eye → reply "Okay, no worries! Maybe next time. Have a good day! 👟". If they say YES / they liked something → reply "Nice! Can you send me a screenshot or reply to the photo you liked so I can sort it out for you? 📸".

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
        size: { type: 'string', description: 'Size to filter by, e.g. "9" or "10.5". Only returns shoes available in this size.' },
        brand: { type: 'string', description: 'Brand, e.g. "Jordan", "Nike", "Asics", "New Balance".' },
        color: { type: 'string', description: 'A colour/style word, e.g. "white", "black", "red".' },
        query: { type: 'string', description: 'Free text such as a model or nickname, e.g. "Jordan 4" or "Air Max 95".' },
      },
    },
  },
  {
    name: 'send_photos',
    description: "Send the customer a photo of each shoe over WhatsApp. Pass the ids from search_inventory. Send ALL the matching shoes. A short closing message with the website link is added automatically after the photos.",
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Shoe ids to send photos for.' },
        include_sizes: { type: 'boolean', description: 'true = show name, price AND available sizes under each photo (use when the customer has NOT given a size / is just browsing). false = show only name and price (use when the customer already gave a size, since we filtered to it). Defaults to true.' },
      },
      required: ['ids'],
    },
  },
];

function searchInventory({ size, brand, color, query } = {}) {
  let rows = catalog.map((s, id) => ({ s, id }));
  if (size != null && String(size).trim()) {
    const want = String(parseFloat(size));
    rows = rows.filter(({ s }) => s.sizesRaw.some(x => String(parseFloat(x)) === want));
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
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2 || /\d/.test(w));
    rows = rows.filter(({ s }) => {
      const hay = `${s.name} ${s.brand} ${s.nickname || ''} ${s.color || ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  return rows.map(({ s, id }) => ({ id, name: displayName(s), price: `$${s.price}`, sizes: sizesOf(s), color: s.color, brand: s.brand }));
}

async function sendShoePhotos(sub, ids, token, includeSizes = true) {
  const chosen = (ids || []).map(id => catalog[id]).filter(s => s && s.image);
  const messages = [];
  for (const s of chosen) {
    const caption = includeSizes
      ? `${displayName(s)} — $${s.price}\nSizes: ${sizesOf(s)}`   // browsing: show sizes
      : `${displayName(s)} — $${s.price}`;                         // already filtered by size
    messages.push({ type: 'image', url: s.image, caption });
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const slice = messages.slice(i, i + CHUNK);
    try { await sendChunk(sub, slice, token); sent += slice.length; } catch (e) { /* keep going */ }
  }
  // Always close with the website prompt once photos have actually gone out.
  if (sent > 0) {
    try { await sendChunk(sub, [{ type: 'text', text: END_OF_PHOTOS_MSG }], token); } catch (e) { /* non-fatal */ }
  }
  return { sent, requested: (ids || []).length };
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

  for (let step = 0; step < 6; step++) {
    const { ok, status, data } = await callClaude(history, system);
    if (!ok) {
      record(req, { endpoint: 'chat-error', sub, status, body: JSON.stringify(data).slice(0, 300) });
      await sendChunk(sub, [{ type: 'text', text: "Sorry, I'm having a little hiccup 🤕 try again in a sec." }], token).catch(() => {});
      return;
    }
    history.push({ role: 'assistant', content: data.content });
    const toolUses = data.content.filter(b => b.type === 'tool_use');
    // Stay quiet while searching: only speak on the photo turn (one short lead-in)
    // or on a final text-only turn — kills filler like "let me pull those up".
    const searchingOnly = toolUses.some(t => t.name === 'search_inventory')
      && !toolUses.some(t => t.name === 'send_photos');
    if (!searchingOnly) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text.trim()) {
          await sendChunk(sub, [{ type: 'text', text: block.text.trim() }], token).catch(() => {});
        }
      }
    }
    if (!toolUses.length) break;
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      if (tu.name === 'search_inventory') result = { shoes: searchInventory(tu.input || {}) };
      else if (tu.name === 'send_photos') {
        const inp = tu.input || {};
        const includeSizes = inp.include_sizes !== false; // default true
        result = await sendShoePhotos(sub, inp.ids, token, includeSizes);
        if (result.sent > 0) scheduleFollowUp(sub, token); // nudge 10 min later if they go quiet
      }
      else result = { error: 'unknown_tool' };
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    history.push({ role: 'user', content: toolResults });
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

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
