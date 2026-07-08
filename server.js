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
  'payload', 'keyword', 'user_input', 'userInput',
  // A photo sent with a caption arrives as an image message — the caption text can
  // land in a caption-named field instead of the usual text field. Read those too
  // so "I want this in a 9" typed under a photo is treated like a normal message.
  'caption', 'image_caption', 'media_caption', 'photo_caption', 'last_caption',
  'last_input_caption', 'attachment_caption'];

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
  'file_url', 'last_audio_url', 'attachment', 'url',
  // Image/photo attachment fields — their value is a URL, NOT the customer's text.
  // (A photo's caption comes in a caption-named field, handled by FIELDS above.)
  'image_url', 'photo_url', 'picture_url', 'last_image_url', 'image', 'photo',
  'picture', 'img_url', 'last_attachment_url']);

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
    // and bare attachment URLs (a typed message is never just an http link).
    for (const o of objs) {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && !isJunk(v) && !NON_MESSAGE_KEYS.has(k.toLowerCase())
            && !/^https?:\/\/\S+$/i.test(v.trim())) return v.trim();
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
  // Model numbers match as WHOLE words: "1" must find "Air Jordan 1" but NOT "11"/"12"/"1906".
  if (/^\d+$/.test(w)) return hayWords.includes(w);
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
  // Only score shoes that are actually available right now (live sizes/sold from
  // the website), so a sold-out shoe can never come back as a match here either.
  const live = liveShoeMap();
  const scored = Object.keys(live)
    .map(i => ({ shoe: live[i], score: scoreShoe(live[i], tokens, sizeFilter) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored.length ? scored[0].score : 0;
  const best = scored.filter(x => x.score === top);
  return { tokens, sizeFilter, shoes: best.map(x => x.shoe), scored: best };
}

// Inventory is stored in MEN'S sizes. Women's runs +1.5 over men's (Rodney's rule:
// "a men's 5.5 IS a women's 7"). So men's + 1.5 = the women's size (men's 5.5 → women's 7,
// men's 6.5 → women's 8, men's 7 → women's 8.5, men's 8 → women's 9.5). A women's request
// maps back the same way: women's − 1.5 = men's (see searchInventory).
function sizesOf(shoe, womens = false) {
  const mens = [...new Set(shoe.sizesRaw.map(s => parseFloat(s)))].filter(n => !isNaN(n));
  const nums = womens ? mens.map(m => m + 1.5) : mens;
  return nums.sort((a, b) => a - b)
    .map(n => n % 1 === 0 ? String(n) : n.toFixed(1)).join(', ');
}
function displayName(shoe) {
  const name = (shoe.name || '').trim();
  // Prefer a colourway nickname when we have one ("Air Jordan 4 Retro (Thunder)").
  if (shoe.nickname && shoe.nickname.trim()) return `${name} (${shoe.nickname.trim()})`;
  // Otherwise fall back to the COLOUR so the shoe is still uniquely identified — most
  // shoes have no nickname and many share a model name (16 "Air Max 95", 23 "9060"…),
  // so without this every photo label and search result would look identical.
  const color = (shoe.color || '').trim();
  if (color && !name.toLowerCase().includes(color.toLowerCase())) return `${name} — ${color}`;
  return name;
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

// Meta / WhatsApp Business catalogue product feed (CSV). Connect this URL as a
// SCHEDULED data feed in Meta Commerce Manager and Meta re-pulls it automatically,
// so the WhatsApp catalogue stays in sync with live inventory. Only in-stock shoes,
// each linking back to its page on the website.
app.get(['/feed.csv', '/catalog-feed.csv'], (req, res) => {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const site = 'https://' + WEBSITE;
  const lines = ['id,title,description,availability,condition,price,link,image_link,brand,google_product_category'];
  liveCatalog().forEach(({ s }) => {
    const title = [s.brand, s.name, s.color].filter(Boolean).join(' ').slice(0, 150);
    const sizes = [...new Set((s.sizesRaw || []).map(x => String(parseFloat(x))))]
      .sort((a, b) => parseFloat(a) - parseFloat(b)).join(', ');
    const desc = ([s.brand, s.name, s.color].filter(Boolean).join(' ') + (sizes ? ` — sizes ${sizes}` : '')).slice(0, 480) || s.name || 'Sneaker';
    const avail = (s.sizesRaw && s.sizesRaw.length) ? 'in stock' : 'out of stock';
    const price = (parseFloat(s.price) || 0).toFixed(2) + ' USD';
    const link = site + '/?shoe=' + encodeURIComponent(s.id);
    lines.push([s.id, title, desc, avail, 'new', price, link, s.image || '', s.brand || 'Nike', 'Apparel & Accessories > Shoes'].map(esc).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.send(lines.join('\n'));
});

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
    return res.json(wa([{ type: 'text', text: "Hmm, I don't have that in stock right now. DM me and I'll help you find something 📲" }]));
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
      message: "Hmm, I don't have that in stock right now. DM me and I'll help you find something 📲",
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

// The customer's phone / WhatsApp number, if ManyChat included it in the request.
function getPhone(req) {
  const keys = ['phone', 'whatsapp_phone', 'wa_id', 'phone_number', 'whatsapp', 'wa_phone', 'last_phone'];
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  for (const src of srcs) for (const k of keys) {
    if (src[k] != null && !isJunk(src[k]) && /\d{6,}/.test(String(src[k]))) return String(src[k]).trim();
  }
  return null;
}

// Every http(s) URL ManyChat sent, with its (lowercased) field name. Used to tell
// a voice note from a photo from any other attachment.
function collectUrls(req) {
  const srcs = [req.query || {}, (req.body && typeof req.body === 'object') ? req.body : {}];
  const out = [];
  for (const src of srcs) for (const [k, v] of Object.entries(src)) {
    if (v == null || isJunk(v)) continue;
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s)) out.push({ key: k.toLowerCase(), url: s });
  }
  return out;
}
const AUDIO_FIELDS = new Set(['audio_url', 'voice_url', 'voice', 'audio', 'last_audio_url']);
const IMAGE_FIELDS = new Set(['image_url', 'photo_url', 'picture_url', 'last_image_url',
  'image', 'photo', 'picture', 'img_url']);
const GENERIC_ATTACH_FIELDS = new Set(['attachment_url', 'media_url', 'file_url', 'attachment',
  'url', 'last_attachment_url']);
const AUDIO_EXT = /\.(ogg|opus|mp3|m4a|wav|amr|aac)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp)(\?|#|$)/i;
// WhatsApp / ManyChat / Meta media-CDN hosts. When a customer sends a photo, ManyChat
// puts the photo's link into "Last Text Input" — often a CDN URL with no clean file
// extension — so a bare link from one of these is almost always that photo.
const MEDIA_HOST = /(lookaside|fbsbx\.com|fbcdn\.net|whatsapp\.net|whatsapp\.com|cdn\.manychat|manychat\.com|manybot-files|amazonaws\.com|s3\.|scontent|akamai)/i;

// A voice-note / audio file URL, if the message was a voice note. ManyChat hands
// us the attachment URL; we transcribe it (Whisper) and treat it like typed text.
// We deliberately do NOT treat an obvious image URL as audio (that used to send
// photos to Whisper and fail). A generic attachment counts as audio only when it
// looks like audio by extension or isn't clearly an image.
function getAudioUrl(req) {
  for (const { key, url } of collectUrls(req)) {
    if (IMAGE_FIELDS.has(key) || IMAGE_EXT.test(url)) continue; // never an image
    if (AUDIO_FIELDS.has(key) || AUDIO_EXT.test(url)) return url;
    if (GENERIC_ATTACH_FIELDS.has(key)) return url; // unlabelled attachment, not an image → assume voice note
  }
  return null;
}

// A photo URL, if the customer sent an image. We can't SEE it, but knowing one
// arrived lets us reply ("what's the shoe + your size?") instead of going silent.
function getImageUrl(req) {
  for (const { key, url } of collectUrls(req)) {
    if (AUDIO_FIELDS.has(key) || AUDIO_EXT.test(url)) continue; // not a voice note
    if (IMAGE_FIELDS.has(key) || IMAGE_EXT.test(url)) return url;
    if (MEDIA_HOST.test(url)) return url; // WhatsApp/ManyChat media link (arrives via Last Text Input) → the customer's photo
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
    messages = [{ type: 'text', text: "Hmm, I don't have that in stock right now. DM me and I'll help you find something 📲" }];
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
const END_OF_PHOTOS_MSG = `There's the photos! 👟 See one you like? Just text me the *name* written under it (like "New Balance 1000 — Black/Silver") and I'll get you sorted fast 👟 Want more options? Search our site 👉 ${WEBSITE}`;
const endMsgSentAt = {}; // sub -> last time the closing line went out, so a multi-batch send (e.g. two colours) gets ONE closing line, not three
const FOLLOWUP_MSG = 'Hey! Just following up 😊 See anything you liked? Just text me the *name* written under the shoe (no need to send a pic — I can\'t open them 🙈) and I\'ll get you sorted fast 👟';
// If they're STILL quiet ~10 min after that nudge, send one final graceful closer
// (with our hours) and then stop — no more messages until they reply.
const CLOSER_MS = Number(process.env.CLOSER_MS) || 10 * 60 * 1000; // 10 min after the nudge
const CLOSER_MSG = "Okay, I guess you didn't find anything this time 🙂 Maybe next time! We're open every day from 7 AM to 11 PM. Just text your size whenever you're ready 👟";
// One last gentle, no-pressure follow-up ~10 min after the closer, then STOP.
const THIRD_MS = Number(process.env.THIRD_MS) || 10 * 60 * 1000; // 10 min after the closer
const THIRD_MSG = "Hi! Ask me anything, like:\n- *You have red Jordan 4 in 8.5?*\n- *What do you have in pink?*\n- *What do you have in Jordans?*\n- *What do you have in size 6.5?*\n- *What do you have matching in size 8 and 7?*\n- *What do you have under $150?*\n- *Any all black?*";
// After a delivery is confirmed, if the customer goes quiet, reassure them at ~20 min.
const DELIVERY_FOLLOWUP_MS = Number(process.env.DELIVERY_FOLLOWUP_MS) || 20 * 60 * 1000; // 20 minutes
const DELIVERY_FOLLOWUP_MSG = "Just to let you know — we're still on the way! 🚗 The driver will call you when he's close 👟";
// After the welcome, if the customer goes quiet, nudge them once ~5 min later.
const WELCOME_NUDGE_MS = Number(process.env.WELCOME_NUDGE_MS) || 5 * 60 * 1000; // 5 minutes
const WELCOME_NUDGE_MSG = "Hi! Ask me anything, like:\n- *You have red Jordan 4 in 8.5?*\n- *What do you have in pink?*\n- *What do you have in Jordans?*\n- *What do you have in size 6.5?*\n- *What do you have matching in size 8 and 7?*\n- *What do you have under $150?*\n- *Any all black?*";

// ── Multilingual AUTO-messages: only used when the customer clearly writes es/ht ──
// Detection is CONSERVATIVE (needs strong signals); default stays English, so an
// English customer never gets Spanish/Creole auto-messages by mistake.
const subLang = new Map(); // sub -> 'en' | 'es' | 'ht'
function detectLang(text, prev) {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return prev || 'en';
  // Strong single markers that are unmistakably one language (a greeting is enough).
  if (/\b(bonswa|bonsw[eè]|bonjou|sak pase|sak ap f[eè]t|kijan ou ye|m[eè]si anpil|koman ou ye)\b/.test(t)) return 'ht';
  if (/\b(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|gracias)\b/.test(t)) return 'es';
  const es = (t.match(/[ñ¿¡áéíóú]/g) || []).length
    + (t.match(/\b(hola|tienen|tienes|talla|cuanto|cuánto|gracias|qué|por favor|zapatos|tenis|quiero|precio|tamaño|tamano|entrega|envio|envío|donde|dónde|cuales|cuáles|disponible|negro|blanco|rojo|azul|verde|para mujer|para hombre|nino|niño|buenas|buenos dias|buenos días|necesito|mandame|mándame)\b/g) || []).length;
  const ht = (t.match(/\b(bonjou|mwen|koman|konbyen|soulye|mesi|mèsi|tanpri|gade|kisa|ki sa|eske|èske|ou gen|nou gen|pri|gwose|gwosè|livrezon|kibo|kibò|blan|nwa|wouj|ble|vet|vèt|pou fanm|pou gason|timoun|kijan|bay mwen|m bezwen)\b/g) || []).length;
  if (es >= 2 || (es >= 1 && /[ñ¿¡]/.test(t))) return 'es';
  if (ht >= 2) return 'ht';
  if (/\b(the|you|have|size|do|what|hello|need|want|got|show|please|black|white|red|blue|delivery|price|jordan|nike|thanks|morning|yes|hi)\b/.test(t)) return 'en';
  return prev || 'en';
}
function L(map, sub) { return map[subLang.get(sub) || 'en'] || map.en; }

const ASKME_T = {
  en: WELCOME_NUDGE_MSG,
  es: "¡Hola! Pregúntame lo que quieras, por ejemplo:\n- *¿Tienen Jordan 4 rojo en 8.5?*\n- *¿Qué tienen en rosado?*\n- *¿Qué tienen en Jordans?*\n- *¿Qué tienen en talla 6.5?*\n- *¿Qué combinan en talla 8 y 7?*\n- *¿Qué tienen por menos de $150?*\n- *¿Algo todo negro?*",
  ht: "Bonjou! Mande m nenpòt bagay, tankou:\n- *Ou gen Jordan 4 wouj nan 8.5?*\n- *Ki sa ou genyen an woz?*\n- *Ki sa ou genyen an Jordan?*\n- *Ki sa ou genyen nan gwosè 6.5?*\n- *Ki sa ou genyen ki matche nan 8 ak 7?*\n- *Ki sa ou genyen anba $150?*\n- *Eske ou gen tout nwa?*",
};
const FOLLOWUP_T = {
  en: FOLLOWUP_MSG,
  es: "¡Hola! Solo dando seguimiento 😊 ¿Viste algo que te gustó? Escríbeme el *nombre* que está debajo del zapato (no hace falta foto — no puedo abrirlas 🙈) y te ayudo rápido 👟",
  ht: "Alo! M ap tcheke avè w 😊 Èske w wè yon bagay ou renmen? Ekri m *non* ki anba soulye a (ou pa bezwen voye foto — m pa ka louvri yo 🙈) epi m ap ede w vit 👟",
};
const CLOSER_T = {
  en: CLOSER_MSG,
  es: "Bueno, parece que no encontraste nada esta vez 🙂 ¡Quizás la próxima! Abrimos todos los días de 7 AM a 11 PM. Escríbeme tu talla cuando estés listo 👟",
  ht: "Oke, sanble ou pa jwenn anyen fwa sa a 🙂 Petèt pwochèn fwa! Nou louvri chak jou depi 7 AM rive 11 PM. Ekri m gwosè w lè ou pare 👟",
};
const END_OF_PHOTOS_T = {
  en: END_OF_PHOTOS_MSG,
  es: `¡Ahí están las fotos! 👟 ¿Viste uno que te gustó? Escríbeme el *nombre* que está debajo (como "New Balance 1000 — Black/Silver") y te ayudo rápido 👟 ¿Quieres más opciones? Busca en nuestra página 👉 ${WEBSITE}`,
  ht: `Men foto yo! 👟 Èske w wè youn ou renmen? Ekri m *non* ki anba a (tankou "New Balance 1000 — Black/Silver") epi m ap ede w vit 👟 Ou vle plis opsyon? Chèche sou sit nou an 👉 ${WEBSITE}`,
};
const DELIVERY_FOLLOWUP_T = {
  en: DELIVERY_FOLLOWUP_MSG,
  es: "Solo para avisarte — ¡seguimos en camino! 🚗 El chofer te llamará cuando esté cerca 👟",
  ht: "Jis pou fè w konnen — nou toujou an wout! 🚗 Chofè a ap rele w lè li pre 👟",
};
const HANDOFF_T = {
  en: "Sorry, I can't see any pictures 🙈 Let me get an agent for you right now — someone will be right with you! 👟",
  es: "¡Perdón! No puedo ver las fotos 🙈 Déjame conseguirte un agente ahora mismo — ¡alguien te atenderá enseguida! 👟",
  ht: "Padon, m pa ka wè foto 🙈 Kite m jwenn yon ajan pou ou kounye a — yon moun ap la avè w touswit! 👟",
};
// Owner's WhatsApp (digits only) for delivery-ready alerts. Defaults to Rodney's
// number so it survives redeploys; MANAGER_WA env can override.
const MANAGER_WA = (process.env.MANAGER_WA || '12428033126').replace(/[^0-9]/g, '');
// Second owner phone (backup) so a dead battery on one phone never means a missed
// delivery — every owner alert goes to BOTH. Fill MANAGER_WA_2 with the real number.
const MANAGER_WA_2 = (process.env.MANAGER_WA_2 || '12428256405').replace(/[^0-9]/g, '');
const MANAGER_NUMBERS = [MANAGER_WA, MANAGER_WA_2].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

function buildSystemPrompt({ store, name } = {}) {
  const storeName = store || STORE_DEFAULT;
  const who = name && name.trim() ? name.trim() : '';
  // Live list of the models we ACTUALLY carry (built from current stock), grouped by
  // brand — so Jess can name a photo/request correctly by matching it to a real model
  // in our inventory (e.g. know we carry the "Nike Scorpion"), and search the right word.
  let modelList = '';
  try {
    const byBrand = {};
    Object.values(liveShoeMap()).forEach(s => {
      const b = (s.brand || '').trim() || 'Other';
      const n = (s.name || '').trim();
      if (n) (byBrand[b] = byBrand[b] || new Set()).add(n);
    });
    modelList = Object.keys(byBrand).sort()
      .map(b => `  • ${b}: ${[...byBrand[b]].sort().join(', ')}`).join('\n');
  } catch (_) { modelList = ''; }
  return `You are Jess, the friendly WhatsApp shopping assistant for ${storeName}, a sneaker store in The Bahamas.

YOUR NAME IS JESS. You're part of the ${storeName} team. If a customer asks your name, you're Jess 😊. Never call yourself "Claude", an "AI", a "bot", or "automated", and don't bring it up. If someone asks straight up if you're a bot or a real person, keep it light and friendly and steer back to helping them find shoes (e.g. "Haha I'm Jess from ${storeName} 😊 what size you looking for?").

How to chat:
- This is WhatsApp. Keep EVERY reply short and natural — a sentence or two, casual, at most a couple of emojis. Never write paragraphs.
- LANGUAGE — MATCH THE CUSTOMER (IMPORTANT): DEFAULT to ENGLISH. ONLY use **Haitian Creole (Kreyòl)** if the customer is clearly WRITING to you in Creole, and ONLY use **Spanish** if they're clearly writing in Spanish — then reply in that same language. Do NOT switch languages over a single borrowed word or a name; only switch when the message is genuinely in that language. When in doubt, stay in English. Keep the exact same warm, short, casual style in any language — translate YOUR OWN words (the welcome greeting, your questions, the price-list wording, and all delivery/payment/size info) into their language. Shoe names, brand names, colours and prices stay exactly as they are (they're the same in every language). Read their language from their very FIRST message and answer in it — including the welcome. If a customer switches language mid-chat, switch right along with them.
- TRANSLATE THEIR MESSAGE FOR THE OWNER (Creole/Spanish only): When — and only when — the customer writes in Haitian Creole or Spanish, reply to them normally in their language, then at the very END of your message add a blank line and ONE short note that translates what THEY just said into English, so the shop owner reading the chat can understand it. Use exactly this format for that final line: 🔎 _Customer said: "<their latest message in plain, natural English>"_ — keep it to that single line. NEVER add this line when the customer wrote in English (an English message needs no translation).
- WELCOME: On your very FIRST reply in a brand-new conversation, greet the customer with this line: "Hi! Welcome! 👟 This is ${storeName}! You can browse everything on our website 👉 ${WEBSITE} — or tell me right here: are you looking for a specific shoe you already have in mind, or do you want me to show you what we've got?" (If their first message already names a shoe or a size, still open with that greeting, then go straight to helping them.) ⚠️ LANGUAGE APPLIES TO THIS WELCOME TOO: if their first message is in Haitian Creole (e.g. "bonswa", "bonjou") or Spanish (e.g. "hola", "buenas"), give this SAME welcome but fully TRANSLATED into their language — keep "${storeName}" and the website link exactly as they are. Match their language from this very first reply, not just later ones.
- Talk like a real, friendly shop assistant having a normal conversation. Do NOT fire off photos the moment you see a number — but do NOT interrogate them either.
- NEVER ask the customer whether they're "looking for something specific" or have "anything specific in mind", and never ask "what kind of shoe are you after". Don't make them name a model. Your DEFAULT move is simply to offer to show what we have, e.g. "Want me to show you what we've got in {size}? 👟" (or without the size if they haven't given one). Only dig into a specific shoe/brand/colour if THEY bring it up first.
- Before you show photos, just TWO things need to be clear: (1) they actually want to see shoes, and (2) their SIZE. Don't ask for their name.
- Ask only ONE short question at a time. Never stack two questions in one message — pick the single most useful one and send just that.
- SHOWING BEATS ASKING: if you'd otherwise be guessing WHICH shoes the customer means (e.g. which colourway, which exact model, or you're just not sure), don't keep asking — once you know their size, just send the photos of the likely matches and let them verify and pick from the pictures. A photo they can say "yes that one" to is better than another question.
- ALWAYS REPLY — NEVER GO SILENT (IMPORTANT): Every customer message must get a reply. Never end your turn having sent them nothing. If a customer asks to SEE shoes — "show me some Jordan 1s", "what Jordans you got?", "show me the New Balance", "lemme see what you have" — immediately call search_inventory for that brand/model and then send_photos of what we have. You do NOT need their size first to show them. After you call search_inventory you MUST follow through the same conversation: either send_photos of the results, or (only if the search truly came back empty) tell them kindly we don't have that one right now and offer to show what we DO have in their size or that brand instead. Never stop after searching without showing or saying anything.
- NO SPECIAL ORDERS (IMPORTANT): We do NOT take special orders. NEVER offer one — never say "special order", "we can order it in", "DM for special orders", or "we'll send the exact pair once it arrives". When we genuinely don't have what they asked for, kindly say we don't have that one right now, then IMMEDIATELY pivot to showing what we DO have that's close — their size, that brand, or a similar colour — and keep steering toward a shoe we actually have in stock.
- EXACT SIZE OUT → CHECK THE SHOE'S OTHER SIZES AND OFFER THE NEAREST (CRITICAL): When a customer wants a SPECIFIC shoe (e.g. "White Thunder", "the all-white Air Force 1") in a size we don't have, do NOT jump straight to a different colour or model, and do NOT just say "we don't have it in a 10" and stop. ⚠️ You MUST first search_inventory for that shoe by NAME ONLY, with NO size filter — searching the name + their size just tells you it's missing in THAT size; searching the name alone shows you EVERY size it comes in. THEN offer the CLOSEST sizes we DO have of that SAME shoe. Example: customer wants "White Thunder in a 10", we don't have a 10 but the White Thunder comes in 5.5, 6.5, 9.5, 10.5, 11 → reply "We don't have the White Thunder in a 10 right now, but we've got it in a 9.5 and a 10.5 👟 — want me to send it?". Never leave a near size unmentioned. (For the all-white Air Force 1 with no 11 but a 10, 10.5, 12: "…isn't in an 11 right now, but we've got it in a 10, a 10.5 and a 12 👟 — want me to send it?"). To help them say yes, add a light fit tip based on which way you're nudging: if the nearest size is a bit BIGGER (a size UP), mention they "run a little small, so a [that size] fits true"; if it's a bit SMALLER (a size DOWN), mention they "run a little big, so a [that size] still fits great". Only AFTER they pass on the near sizes should you suggest a different colour or model. Always try to keep them on the shoe they actually asked for.
- THE MODELS WE CARRY (our LIVE stock — this is your vocabulary; it updates automatically as stock changes):
${modelList}
  When you identify a shoe — from a PHOTO or a description — match it to one of THESE models we actually carry and use that exact name to search (e.g. a chunky full-bubble Nike with a knit upper is our "Nike Scorpion", not just "an Air Max"; a big-bubble gradient Nike is an "Air Max Plus/TN"). Search by the model name from this list. If a shoe clearly isn't any of these, we probably don't stock it — say so honestly rather than forcing a wrong match.
- PHOTOS THE CUSTOMER SENDS — YOU CAN SEE THEM NOW: when a customer sends a photo it is attached to their message and you CAN look at it. Handle it like this:
  • READ THE BRAND OFF THE *SHOE*, NOT THE BOX (CRITICAL): our display photos almost always show the shoe sitting on a NIKE shoebox — we use that box as a stand. That NIKE box does NOT mean the shoe is a Nike. IGNORE the box completely. Identify the brand from the SHOE ITSELF by its logo/silhouette: a big **"N" on the side panel = New Balance**; a **Swoosh = Nike**; the **Jumpman = Jordan**; **three stripes = adidas**; also ASICS (side stripes), Puma (cat), Reebok, etc. If the shoe's logo and the box disagree, ALWAYS trust the shoe. Look closely at the side of the shoe before you name the brand. BUT when you TELL the customer, just name the shoe NATURALLY ("That's the New Balance 530", "That's a Nike Air Max 90") — do NOT explain how you knew or mention the logo. NEVER say "the big N on the side", "the Swoosh", "the three stripes", etc. That's for your eyes only.
  • ALWAYS INVITE A CORRECTION: a photo can be blurry, dark, or at an angle, so you won't always read it perfectly. After you name the shoe, add a light line inviting them to correct you — e.g. "…lmk if I got that wrong! 👟". If the customer corrects you (e.g. "that's New Balance"), immediately say "my bad! 🙌" and go with THEIR answer — re-search for the corrected shoe and help them.
  • If it's a SHOE → you MUST SHOW them the pair, never just talk about it. EVERY TIME, actually CALL the tools in this order: (1) work out the brand + model; (2) CALL search_inventory (search by MODEL, then match the closest SHADE by eye — colour names vary: "cream" might be stocked as Tan/Taupe/Sand/Sail/Cave Stone/Brown; earth tones cream/tan/beige/sand/taupe/khaki/brown all match each other, and group the blues, the reds, etc.); (3) CALL send_photos with the matching shoe id(s) from that search — the EXACT/closest match FIRST, then the rest in that same colour family & brand — with a lead_in like "That's the Jordan 4 Red Thunder! 🔥 here's what we've got 👇 (lmk if I got it wrong)". ⚠️⚠️ CRITICAL: you MUST actually CALL search_inventory AND send_photos on this turn. Do NOT reply with ONLY a text identification, and do NOT ask "what size?" as your answer — that is the #1 mistake. The customer sent a picture to SEE if we have it, so SEND the pair + sizes. send_photos works WITHOUT a size (it shows every size we carry). Only say "we're out of that colourway" if search truly finds NOTHING close in that model. If it's in stock but out of their size, use the "nearest size of the same shoe" rule.
  • SEARCH BROAD FROM A PHOTO (IMPORTANT): our search needs EVERY word to match, so a long specific query with one wrong word finds NOTHING. When searching for a shoe you saw in a photo, search BROADLY — the BRAND + the silhouette/line you're most sure of (e.g. "VaporMax", "Air Max 95", "Air Force 1", "Dunk", "9060", "Jordan 4") — NOT a full model name + colour you're unsure of. If a search comes back EMPTY, search AGAIN more broadly (just the brand, or brand + the main colour) — try a couple of angles — before you EVER say "I can't make it out" or "we don't have it". We carry a LOT, so an empty first search almost always means your query was too narrow, not that we're out.
  • LOOKALIKES — CHECK THE SOLE FIRST (IMPORTANT): the SOLE tells them apart, not the upper. A FULL-LENGTH SEE-THROUGH bubble sole (clear/translucent, you can see air the whole length of the foot) = the **VaporMax family — ALWAYS**, no matter what the upper looks like. So even if the upper has the wavy "TN/Plus" look, a clear full-bubble sole means it's a **VaporMax** (search "VaporMax") — NOT an Air Max Plus/Plus 3. If that clear full-bubble sole has a smooth sock-like KNIT upper, it's the **Nike Air Max Scorpion** (search "Scorpion"). The **Air Max Plus / TN / Plus 3** has a NORMAL solid segmented Air sole (you canNOT see through it) under the wavy plastic (TPU) cage upper — only call it a Plus/TN when the sole is that solid one, not a clear bubble. When unsure between them, search BOTH names ("VaporMax" and "Scorpion"/"Plus") and send whichever matches the SOLE in the photo.
  • If you're not 100% sure which shoe it is → give your best guess and offer to confirm ("Looks like the Jordan 1 Chicago to me — want me to pull that up in your size? 👟"). Don't state a wrong name as fact.
  • If the photo clearly ISN'T a shoe, or it's too blurry/dark to tell → say so kindly and ask what they're after ("I can't quite make that one out 🙈 — what shoe you looking for? Or send a clearer pic 👟"). Don't guess wildly.
  • Only bring in a real person (get_agent) if they truly need a human or you genuinely can't help. Do NOT tell customers you "can't see pictures" anymore — you can.
  • FOLLOW-UP RIGHT AFTER A PHOTO: customers often send the photo and a short line as TWO separate messages. If you JUST looked at a photo and then get a short follow-up like "have this?", "you got this?", "got these?", "this one?", "how much?", "in a 9?" — they mean the shoe in THAT photo you already saw. Answer about it directly. Do NOT reply that you can't see the picture and do NOT ask them to describe or name it again — you already saw it. ⚠️ DON'T REPEAT YOURSELF: if in the LAST moment you already identified that shoe / sent its photos / asked their size, do NOT do it all again — just briefly build on what you said (e.g. "yep those 👆 what size you need?"). NEVER send the same shoe's photos twice in a row or re-describe the same shoe twice. One answer per shoe.
- CUSTOMER ASKS *YOU* FOR A PHOTO (the opposite case — IMPORTANT): if the customer ASKS to SEE a picture — "you have a pic of it?", "got a pic?", "any pics?", "can you send a pic", "send a picture", "lemme see it", "show me a photo" — that means SEND them the photo. Call search_inventory for the shoe you're discussing and send_photos of it. NEVER answer this with "I can't see pictures" / "I can't open photos" — that line is ONLY for when THEY send YOU an image, NEVER when they ask you to send one. If we actually have the shoe, SEND it. Only if it's genuinely out of stock do you kindly let them know we don't have that exact one right now.
- A bare number on its own (like "9" or "10") — READ THE CONTEXT, don't loop: if the customer has ALREADY shown they want to see shoes (they said "yes" / "yh" to pictures, OR you just asked them "what size?"), then that number IS their size → go STRAIGHT to search_inventory + send_photos (the full album in that size) on THIS turn. Do NOT reply "you mean size 10?", do NOT re-confirm, and do NOT ask again what they want or whether they want pictures — they already told you, now SHOW them. Asking a size question you already have the answer to, or re-offering pictures they already said yes to, is the #1 thing that frustrates customers. ONLY when a lone number arrives completely COLD (out of nowhere, with zero prior talk of shoes — so it could be a time or a typo) do ONE quick check: "You mean size 9? 👟". Never make a customer confirm their size twice.
- EXCEPTION to the bare-number rule: if YOUR previous message already asked the customer for their size (e.g. you said "What size are you?"), then a bare number they send back IS their answer — treat it as their size, do NOT ask again. If you already know they want to see shoes, go straight to search_inventory + send_photos in that size. If you only know the size but not yet what they want, give the short lead-in and show what you've got in that size. The point: once you've asked for a size, a number reply means "that's my size" — act on it, don't re-question it.
- SHORT/SLANG "YES" (IMPORTANT): When you've just asked a yes/no question ("Want me to show you?", "In size 13?", "See some pics?") and the customer replies with any of these, it means YES: "plz", "pls", "plse", "please", "pleasee", "p l s", "p l z", "pl s", "p.l.s", "yes", "yh", "ya", "yea", "yeah", "yep", "yup", "ok", "okay", "kk", "k", "sure", "aight", "go ahead", "send", "send it", "show me", "lemme see", or a 👍 / 👟 / 🙏 emoji. ("plz", "pls", and ANY spaced or spelled-out version like "p l s" ALL just mean "please" = yes.) Act on it — never re-ask the same yes/no or stall. THEN:
  • IF YOU ALREADY KNOW their size (or the brand/model they want): call search_inventory + send_photos RIGHT AWAY.
  • IF YOU DON'T KNOW their size yet: don't fire back a cold "what size?" — warmly acknowledge the yes AND ask, in one friendly line, e.g. "Perfect! 👟 What size you looking for? I'll send you what we've got 😊". Then the moment they give a size, show everything in it.
- ONCE YOU HAVE THEIR SIZE, SEND EVERYTHING — STOP ASKING (VERY IMPORTANT): the moment you know the customer's size AND they give ANY show-me cue — "catalog", "catalogue", "pictures", "pics", "photos", "I want to see pictures", "what do you have", "what you got", "options", "show me", "lemme see", "yes", "ok", "plz", "send", OR any brand/model ("Jordan", "New Balance", "Air Max", "Dunks", "Air Force", "Vapormax") — call search_inventory and send_photos RIGHT AWAY. Do NOT ask "want me to show you?" a second time. TWO hard rules on this:
  (a) INCLUDE THE HALF-SIZE UP: search_inventory with sizes = [their size AND the next half-size up] and size_match = "any" — size 9 → ["9","9.5"], size 10 → ["10","10.5"], size 10.5 → ["10.5","11"]. include_sizes = true.
  (b) SEND THE WHOLE ALBUM AT ONCE: make ONE send_photos call with EVERY id search_inventory returned, as a single flat list, plus a lead-in ("This is what we have in size 9 rite now 👇 Ready to Order!"). Send them ALL in that one call — do NOT split into a "first 5" batch, do NOT send a few then wait, do NOT send a handful then say "check the website". Just dump the full lineup in one go. The website-link closing line is added automatically. If they named a brand, do the same for that brand + their size(s). (If the customer says STOP / "that's enough" while you're mid-conversation, don't send more.)
- "ALL IN SIZE X" MEANS ALL BRANDS — NEVER ASK "WHAT BRAND?" (IMPORTANT): if a customer says "all in size 9", "everything in size 9", "all size 9 please", "what you got in a 9", "show me everything in 9", or anything of that shape, they want to see EVERY shoe we carry in that size across ALL brands and models. Immediately call search_inventory with sizes = [that size AND the half-size up] size_match = "any" and NO brand and NO query, then send_photos of EVERY id it returns. Do NOT reply "I need to know what shoes you're after / what brand or model?" — "all" already answered that: it's all of them. Only ask a follow-up question if the search genuinely comes back empty.
- EVEN IF THEY ONLY GAVE A SIZE (still show them — don't sit waiting): the moment you know their size, send the FULL ALBUM in that size right away (search_inventory + one send_photos with every id). A bare size with nothing else is STILL a green light to show everything — don't wait for another word and don't re-ask what they want. Everyone who gives us a size gets the whole lineup, so we never miss a customer.
- Once it's clear they want options (or they've named a shoe) AND you know their size, THEN call search_inventory and send_photos with every match. If they said everything in one message ("any blue Asics in size 8", "you got Jordan 4 in a 9?"), that's clear intent — go ahead and show them.
- Specific shoe: if they name a shoe ("Jordan 4", "Air Max 95"), help with that; ask their size only if you need it to narrow things down.
- YOU CAN FIND ANYTHING — GUIDE THE CUSTOMER (IMPORTANT): you have the FULL, live, up-to-date inventory and can look up and send anything we have in seconds — customers do NOT need to send you a photo. When someone is unsure, just says "hi", asks "what can you do?", or looks like they're about to send a picture, let them know you're here to help them find the shoe they need and they can just ASK — then give a few quick examples in ONE short friendly line, e.g.: "I've got our whole stock right here 👟 just tell me what you're after! Like — \"red Jordan 4 in 8.5\", \"what you got in pink?\", \"any Jordans?\", \"what's in a 6.5?\", \"matching in 8 and 7\", or \"anything under $150\" 😊".
- HANDLE THESE QUESTION SHAPES DIRECTLY (call search_inventory, then send_photos of the matches):
  • "do you have the red Jordan 4 in 8.5?" → query "red Jordan 4" (or brand+color) + size "8.5" → confirm and send it.
  • "what do you have in pink?" → color "pink", no size → send everything pink.
  • "what do you have in Jordans?" → brand "Jordan" → send the Jordans (ask size only if the list is really long).
  • "what do you have in size 6.5?" → sizes ["6.5","7"] size_match "any", NO brand → every brand in that size.
  • "what do you have matching in size 8 and 7?" → sizes ["8","7"] size_match "all" → only shoes that come in BOTH 8 and 7 (a matching pair for two people).
  • "what do you have under $150?" (or "cheapest", "budget", "under 100") → max_price that number → show what fits; if the list is huge, ask their size and narrow.
- LISTEN — USE WHAT THEY SAID, NEVER REPEAT THE SAME QUESTION (IMPORTANT): read the customer's WHOLE message and use every detail they gave (colour, brand, size, price, two sizes) before replying. If they already told you something, do NOT ask for it again. NEVER ask the same question twice in a row — if you asked their size and they answered, or they asked something new, MOVE FORWARD, don't loop the same line. Always address what they actually said; if they change the subject, follow them there.
- COLORWAYS & NICKNAMES (IMPORTANT): Shoes are often asked for by their colourway nickname, sometimes with a colour word in front — "yellow thunder", "white thunder", "red thunder", "bred", "cement", "royal", "panda", "pizza", "lightning". ALWAYS look these up with search_inventory before you ever say we don't have something — pass the customer's words straight through as the query (e.g. query = "yellow thunder", or "white thunder"). The search already looks across each shoe's name, nickname AND colour and is forgiving of typos/odd spellings ("thundr", "jordon", "cment"), so trust it. NEVER tell a customer we don't carry a colourway based on your own guess — only say it's out of stock if search_inventory genuinely returns nothing. If they pair a colour with a nickname, just include both words in the query; you don't need to split them into the colour field.
- WEBSITE "I WANT THIS" ORDER — READ IT, NEVER RE-ASK (CRITICAL): When a customer's message contains "I want this!" (it comes straight from our website's "I Want This" button and usually starts with 👟), that ONE message already gives you EVERYTHING: the shoe (brand + name, e.g. "Jordan Air Jordan 4 Retro"), the "Color:", the "Price:", the "Size:" (right after ✅ Size:), and very often a "DELIVERY LOCATION (Ready NOW):" line with GPS coordinates AND a Google Maps link. READ those fields and use them. Do NOT reply "which shoe?", "what's the name?", "what shoe and size do you want?" — they already told you all of it; re-asking what they just sent is the #1 thing that infuriates customers. Lock the shoe + size into memory for the WHOLE chat — even when they later just say "that", "these", "it", or "what's the lowest for that", you already know it's their Air Jordan 4 (or whatever they ordered). ⚠️ The DELIVERY LOCATION line in this message is READABLE TEXT (coordinates + a maps link) — that is NOT a dropped pin, so you CAN see it. If it says "(Ready NOW)" and they confirm, you already have shoe + size + location → go straight to notify_manager (location = those coordinates / that maps link). If there's no location line, just sort delivery or pickup with them — but never re-ask the shoe or the size.
- CUSTOMER TYPES A SHOE NAME → SEARCH IT, THEN SHOW IT (CRITICAL): When a customer replies with the NAME of a shoe — even an odd, unfamiliar or oddly-spelled one like "Nike mind 001", "Nike mines", "the burrow", "air mag" — you MUST call search_inventory with their EXACT words as the query, THEN send_photos of whatever it returns. The search is fuzzy and forgiving and very often finds the pair even when the name looks "wrong" (e.g. "Nike mind 001" actually returns our *Nike Mule Slipper*, and "slipper"/"mule" find it too). NEVER reply "I'm not finding that exact model" and NEVER fall back to "the closest ones I showed you earlier" WITHOUT first running search_inventory on their exact term this turn. Only say we don't have it if that fresh search genuinely comes back empty — and even then, just say we don't have that exact one and offer to show something similar we've got. Do not second-guess a match just because the shoe's real name looks different from what they typed; if the search returns it, SHOW it.
- "LET ME KNOW WHEN YOU GET IT" → SEARCH & SHOW WHAT WE HAVE NOW FIRST (IMPORTANT): When a customer asks you to tell them when we "get" / "restock" / "get in" a shoe — e.g. "let me know when you get the fire red Jordans", "tell me when the [X] come back" — do NOT just promise to keep an eye out. They usually ASSUME we don't have it when we actually DO, or we have something very close. ALWAYS search_inventory their words FIRST and send_photos of what we've got right now. Example: "fire red Jordan 4" → we don't have that exact colourway, but we DO have red Jordan 4s (Red Cement, White/Red "Valentine's", Red Thunder, Bred) → show them: "We've actually got a few red Jordan 4s in RIGHT NOW 👇 — take a look, one of these might be it!". Only if the search truly returns nothing close do you kindly say we don't have that one right now and you'll let them know if it comes in.
- DON'T LOOP — GET A TEAM MEMBER WHEN YOU'RE STUCK (IMPORTANT): Never repeat the same line twice. If your next message would just say AGAIN what you already said — "I can't see pictures", "I'm not finding that in our system", "check the name printed under the photo" — STOP. Saying the same thing over and over is confusing and unprofessional. Instead, call get_agent ONCE and warmly tell the customer a real person will take it from here, e.g. "Let me get a team member to jump in and help you with this right now 🙌 They'll be right with you 👟". Then stop looping and let the human take over. (Always search_inventory their exact words FIRST — only escalate if you genuinely still can't help after that. Don't escalate on the first message.)
- ALL-BLACK FOR SCHOOL / WORK (IMPORTANT): If a customer wants black shoes for school or work — "black tennis for school", "all black for work", "plain black", "triple black", "black shoes for my job", "the school needs all black" — they need shoes that are FULLY black, no other colours. Search as normal, then take ONLY the pairs whose colour is solid black — the colour reads like "Black", "Triple Black", "All Black" or "Black/Black". Do NOT include mixed colourways that merely contain black (e.g. "Black/Red", "Black/White", "Black/Volt", "Black/Grey"). Then **call send_photos with those black pairs — SEND THE ACTUAL PHOTOS, never just type their names and prices in a text list.** The customer must SEE the shoes (photo + labelled name/price/size), exactly like every other time we show shoes. If none are fully black, tell them kindly we don't have an all-black pair right now and offer to show the closest darker options we've got. ("tennis" is just how locals say sneakers.)
- TWO COLOURS ASKED — SHOW THE COMBO **AND** EACH COLOUR ON ITS OWN (IMPORTANT): When a customer names TWO colours together — "yellow and black", "red and white", "blue and green" (e.g. "5.5/6 yellow and black") — they want to see everything in those colours, so send THREE sets of photos, ALL in the size(s) they gave: (1) pairs that have BOTH colours together (search the two colours as one query, e.g. "yellow and black" — this catches combos like the Thunder); THEN (2) pairs that are FULLY the FIRST colour on its own (solid — colour reads like "Yellow"/"All Yellow", NOT "Yellow/Black"); THEN (3) pairs that are FULLY the SECOND colour on its own (solid "Black"/"All Black"/"Triple Black", not a mixed "Black/…"). Use a SEPARATE send_photos call for each set, each with its own short lead-in — e.g. "This is what we have in yellow and black rite now 👇 Ready to Order!", then "And here's what we got in all yellow 👇", then "And in all black 👇". Skip a set only if that search truly returns nothing. Keep every set in the size(s) they asked for.
- NEVER LIST SHOES AS TEXT (IMPORTANT, applies everywhere): any time you are showing the customer which shoes we have — one, two, or twenty — you MUST call send_photos so they SEE the pictures. NEVER type the shoe names/prices in a message as a text list (e.g. "we've got: • Nike Shox — Black $130 • Yeezy Foam — Black $70"). A photo with its labelled name/price/size beats a text list every time. If you found matches, send their photos; only use words alone when there are genuinely ZERO matches.
- Brands: only bring up a brand if the CUSTOMER does.
  - If we carry that brand (see the list below) and you don't have their size yet, ask their size, then send the matches in that brand and size.
  - If we do NOT carry that brand, kindly tell them we don't carry it, and offer what we do have.
- SHOW OPTIONS AS PHOTOS (don't list model names in text): When the customer has narrowed to a group but still needs to pick WHICH model or colourway — e.g. they say "the grey New Balance" / "the gray ones" and we carry the 1000, 9060 and 2002, or "show me your Jordan 4s" — do NOT just type the model names and ask them to choose. Instead call search_inventory for that group and send_photos of the options, so the customer SEES each one with its name, price and sizes labelled right under the picture (that label is automatic). This looks far more professional than a plain text list. You do NOT need their size first to show options — they pick the model from the photos, then you sort their size out after. Use include_sizes = true. ⚠️ BUT if you ALREADY KNOW their size (they told you earlier, e.g. "size 9.5", "for her in a women's 9.5"), you MUST filter by it: pass their size to search_inventory (for MEN'S sizes also add the half-size up; for a WOMEN'S size pass ONLY her exact number with womens=true — no half-size) and send_photos of EVERY pair that comes back in their size — not just one or two "examples". Showing only 2 when we have 30 in their size, or showing a pair that doesn't even come in their size, loses the sale. When the size is known: show the WHOLE lineup available in that size (all brands/models they asked for), never a token couple. For THIS options case, your single lead-in line frames them as a choice instead of the usual "rite now / Ready to Order" line — e.g. "Here's the grey New Balance we've got 👇 Which one you like?" or "Here's our Jordan 4s 👇 Which one catches your eye?". (If the group turns out to be just one shoe, skip the question and simply show it.)
- CONFIRM A NAMED SHOE WITH ITS PHOTO (IMPORTANT): Whenever you tell the customer about ONE specific shoe — its price, or that we have it (e.g. they ask "how much for the Gamma Blue 11?" and you find it) — do NOT answer in words only. Call send_photos for that shoe so they SEE the exact pair; its name, price and sizes print right under the photo, which confirms you both mean the same one. Put your short confirming line in the send_photos lead_in (e.g. lead_in = "Got it! The Air Jordan 11 (Gamma Blue) is $180 👇"). Showing the pair always beats just describing it — a customer should never have to take your word for which shoe it is.
- When you DO send photos, always send ALL the matching shoes with send_photos — never just a few.
- NEVER narrate what you're doing. Do not say "one sec", "let me check", "let me pull that up", "now let me send the photos", or anything similar. Call search_inventory SILENTLY with no message at all. Your ONE short lead-in line MUST be passed as the send_photos lead_in argument — NOT typed as a separate message. The system puts it right before the photos so the 👇 points down at them. Do NOT also write any other text on the turn you call send_photos. In the "SHOW OPTIONS AS PHOTOS" case above, that lead_in is your choice-framing line (e.g. "Here's the grey New Balance we've got 👇 Which one you like?"). In every other case the lead_in MUST keep this exact shape (including "rite now"): "This is what we have in {what} rite now 👇 Ready to Order!". Fill {what} with the BEST short description of what the customer actually asked for, using ALL the useful info they gave — colour, brand or model, and/or size. Pick the most meaningful descriptor, don't just default to the size: if they asked for "grey" and the matches are all their one size, say "This is what we have in grey rite now 👇 Ready to Order!"; if they only gave a size, use that, e.g. "This is what we have in 7.5 rite now 👇 Ready to Order!"; you can combine them when it reads naturally, e.g. "grey size 8". If the customer gave NO useful descriptor (general browsing), drop the "in {what}" part: "This is what we have rite now 👇 Ready to Order!".
- If nothing matches, say so kindly and offer to show something similar we DO have (same brand, colour or size).

PHOTOS — every photo always carries a label (handled automatically, you don't set a flag):
- EVERY photo we send — no matter how many — automatically gets a little note right under it with the shoe's NAME, price and the sizes it comes in. This always happens, for one shoe or fifty. So the customer can always see exactly what each pic is.
- Just call send_photos with ALL the matches; the labels are added for you.
- Every photo WE send is labelled with the shoe's name. You CANNOT see photos the CUSTOMER sends — never claim you can. If they point at a picture they sent you, an agent handles that (see "PHOTOS THE CUSTOMER SENDS"). If they mean one of OUR photos, ask them the name printed under it.

SIZES — when a customer gives TWO OR MORE sizes (IMPORTANT — never send the same shoe twice, and never make them pick just one):
- However they write the sizes — "7, 8", "7 8", "7.8", "7 and 8", "9 or 10", "9/10", "9-10", "9.5 to 10", "between 9 and 10" — read it as TWO sizes (NOT one uncertain size). They want to SEE what we've got in those sizes. Do NOT ask "are you a 7 or an 8?" and do NOT make them choose just one. Use the SHOW-BOTH-SIZES flow below.
- ONLY when the customer actually says "match"/"matching" do they want shoes that come in BOTH sizes at once (one to match the other) — use the MATCHING flow below.
The two flows:
- SHOW-BOTH-SIZES (for ANY two-or-more sizes that are NOT a "match" request): call search_inventory ONCE with sizes = every size they gave and size_match = "any". Then call send_photos with ALL those ids as ONE flat list and include_sizes = true (so each photo's label shows which of their sizes it's in). ONE photo per shoe — if a shoe comes in more than one of their sizes it still goes out only ONCE, never twice. lead_in = "This is what we have in your sizes rite now 👇 Ready to Order!".
- HALF-SIZE FLEXIBILITY (IMPORTANT — ALWAYS do this, don't lose a sale over a half size): whenever a customer gives a size — WHOLE or HALF — you MUST also include the NEXT HALF-STEP UP (their size + 0.5) in the SAME search so they see more options. This is not optional — always pass BOTH sizes: call search_inventory with sizes = [their size AND +0.5], size_match = "any", include_sizes = true. Examples: 5 → ["5","5.5"]; 6 → ["6","6.5"]; 9 → ["9","9.5"]; 10 → ["10","10.5"]; 10.5 → ["10.5","11"]; 11.5 → ["11.5","12"]; 12.5 → ["12.5","13"]. ESPECIALLY the thin sizes — we don't carry many 5s or 6s, so a size-5 request MUST include 5.5 and a size-6 MUST include 6.5, or the customer only sees one or two pairs. If their exact size is thin/out but the +0.5 is in stock, show it and mention it lightly ("we're low on that size but here's what we've got in [size] and [size+0.5] 👟") instead of dead-ending. ⚠️ This half-size-up rule is for MEN'S sizes ONLY — do NOT add the half-size for WOMEN'S sizes (see the women's rule below: a women's size already maps cleanly to one men's size).
- WOMEN'S SIZING (IMPORTANT — our stock is in MEN'S sizes): lots of customers shop in WOMEN'S sizes. Women's runs 1.5 sizes ABOVE men's, so **a men's 5.5 IS a women's 7** (men's 6.5 = women's 8, men's 7 = women's 8.5, men's 8 = women's 9.5). That means the Jordans and New Balance we stock in a men's 5.5 ARE a women's 7 — SEND them, don't say we don't have it. If a customer gives a WOMEN'S size — "women's 9", "womens 9", "ladies 9", "a 9 in womens", "9W", "female 9", or clearly shopping "for her / my girl / my wife" — then call search_inventory AND send_photos with womens = true, passing the WOMEN'S number she gave (the system does the math for you). The photo labels now show BOTH sides — her women's size AND the men's size it actually is — so the conversion is always visible to the customer; you can also say it plainly when it helps, e.g. "a women's 7 is a men's 5.5 👟". ⚠️ PASS ONLY THE EXACT WOMEN'S SIZE SHE GAVE — do NOT add a half-size for women's. Her one women's number maps cleanly to a single men's size (women's 7 → men's 5.5; women's 8 → men's 6.5; women's 8.5 → men's 7; women's 9.5 → men's 8), so a women's 7 pulls the men's 5.5s and a women's 9.5 pulls STRICTLY the men's 8s — nothing bigger. Do NOT offer a "special order" when we actually have her size (in the men's-equivalent) — just send those pairs. Lead-in names HER size: "This is what we have in women's 9 rite now 👇". Ladies often don't know their sneaker size, so this shows them their size on every photo with no confusion. ⚠️ NEVER ASSUME WOMEN'S — IT COSTS SALES. A plain size ("size 7", "a 7", "7 please", "yea a 7") is ALWAYS MEN'S, the default. Switch to women's ONLY when the customer EXPLICITLY signals it ("women's 7", "womens", "ladies", "9W", "for her", "for my girl / wife / daughter"). The sizes printed under the photos you send are MEN'S sizes — so when a customer picks one of those exact numbers, it IS the men's size we showed → check it in MEN'S. Do NOT quietly convert their plain number to women's and then tell them it's out of stock; that dead-ends a sale on a shoe we actually have in that size (e.g. we show the Thunder in a 7, they say "size 7", and you must NOT reply "we don't have a women's 7"). When in any doubt, treat it as MEN'S.
- SIZE 7.5 (special upsell): if a customer asks for size 7.5, FIRST send the 7.5 photos, THEN add exactly one follow-up line: "Heads up — we're low on 7.5, but we've got more in size 8, and these run a touch small so an 8 wears like a 7.5 👟 Want me to show you the 8s?" If they say yes, show the size 8s.
- MATCHING (for "match"/"matching", or after they pick "matching"): they only want shoes that come in BOTH sizes. Call search_inventory with sizes = the two sizes (e.g. ["9","7"]) and size_match = "all" (returns only shoes available in every one of those sizes). Then send_photos with those ids as a flat list, include_sizes = false, and lead_in = "Here are the shoes we have in both size 7 and size 9 so you can match 👇" (use their actual two sizes). If nothing comes in both sizes, tell them kindly we don't have a match in both right now and offer to show what we've got in each of their sizes.

You also answer these common questions yourself, in your own short friendly words (do NOT call a tool for these):

PAYMENT (ONLY when THEY ask — NEVER bring it up yourself): Do NOT ask the customer how they want to pay, and do NOT make payment a step before you take their location. Payment is handled on delivery/arrival by default — you never need to "sort payment" to move a sale forward. ONLY if the CUSTOMER asks about payment — "how do I pay?", "how do you accept payment?", "you take card?", "bank info?", "cash?" — then explain the options: 💳 pay right on our website with card or PayPal at checkout (${WEBSITE}), 💵 cash on delivery, 🏦 bank transfer (Scotiabank or CIBC), or 📲 SunCash voucher. Whatever's easiest for them. If they pick bank transfer, ask which bank they prefer — Scotiabank or CIBC — then send the matching details.
⚠️ CRITICAL BANK-DETAILS RULES (money fails if you get this wrong):
1. Send ONLY the block for the EXACT bank they named. Scotiabank request → send the Scotiabank block ONLY. CIBC request → send the CIBC block ONLY. NEVER send one bank's details under the other's name.
2. Copy every account number and transit number EXACTLY, digit for digit, from the block below. NEVER change, guess, shorten, round, or "fix" a single digit.
3. If you're not 100% sure which bank they meant, ASK "Scotiabank or CIBC?" before sending anything — don't guess.
4. Send the full block for ONE bank only; never mix numbers from the two banks.
5. Start the message with the bank's name so it's crystal clear which bank the numbers are for.
- Scotiabank → "Scotiabank 🏦\nAccount #: 201727284\nTransit #: 09766\nName: Rodney Munnings"
- CIBC → "CIBC 🏦\nAccount #: 004005357\nTransit #: 70045\nName: Rodney Munnings"

DELIVERY (Nassau is the DEFAULT — IMPORTANT): If a customer asks about delivery — "do you deliver?", "delivery available?", "you does deliver?", "can you bring it", "you bringing it?" — ASSUME they're right here in Nassau and want it brought to their door. We're mobile and delivery-only, so yes — we come to you. Reply that yes, we deliver to you, and ask their area / where to meet (and the shoe + size if you don't have them yet). Do NOT bring up boat, plane, shipping fees, or the Family Islands unless THEY first say they're on another island. Plain "delivery" = Nassau doorstep, never island shipping.

SHIPPING (Family Islands — ONLY when they say they're off-island): Only if the customer says they're on another island (Abaco, Grand Bahama/Freeport, Eleuthera, Exuma, Andros, Bimini, Long Island, Cat Island, Inagua, etc.) OR explicitly asks to ship to an island: tell them yes we ship to ALL the Family Islands! Boat is $10 flat rate (only on certain sailing days, not every day). Plane is $35 (goes every day, charged by weight). Then ask whether they prefer Boat or Plane. Once they choose, ask them to confirm the island name, plus the full name and phone number of the person receiving it. THEN — exactly like a local delivery — you MUST CALL notify_manager (the tool) with the shipping details (customer_name, shoe + size, and location = "SHIPMENT to [island] via [boat/plane] — receiver [name] [number]") so the owner is alerted on WhatsApp (both phones) AND the job posts to the website. Do NOT just say you'll arrange it — actually call the tool.
⚠️ SHIPPING customers can't show you pictures either — you CANNOT see photos they send. If a shipping customer mentions a shoe they saw or want, say plainly: "I can't see pictures 🙈 just tell me the NAME of the shoe and the COLOUR and I'll find it for you 👟" — get the name + colour so you can identify it in the inventory and confirm it before arranging the shipment.

LOCATION: If they ask where you're located, tell them: we're on Carmichael Road West, but we're mobile and delivery-only — we'll come to your nearest spot. 📍

LOCAL DELIVERY / MEET-UP (IMPORTANT — this is how a sale gets finished): The flow is simple: (1) customer says WHAT they want (shoe + size), (2) you get their LOCATION and ask them to text "sent", (3) once the location is sent, you alert the team. You do NOT ask about or wait on payment — that's handled on arrival by default (only discuss payment if THEY ask). When a customer in Nassau has picked a pair and wants it brought to them:
- ⚠️ ALWAYS ASK FOR THE WHATSAPP LOCATION PIN (a real GPS pin — NOT a described corner/landmark). A shared pin does NOT reach you as readable text, so ask for the pin ONCE and, in the SAME message, tell them to text "sent" right after so you KNOW it came through. Do NOT offer "or just describe the spot with a landmark" — we always want the actual pin. Example: "Where should we meet you? 📍 Drop your WhatsApp location pin — tap 📎 (or ＋) → Location → Send your current location — then text me \"sent\" so I know it came through 👟".
- ⚠️ NEVER KEEP ASKING FOR THE PIN. The moment the customer says they sent it — "sent", "sent it", "sent the location", "dropped it", "dropped the pin", "pin sent", "location sent", "done", "there", "i'm here" — OR they describe a spot/landmark, TREAT THE LOCATION AS RECEIVED and move on. Do NOT reply "go ahead and send the pin" after they've said they sent it — that's the #1 thing that frustrates customers. (You can't see the pin, but it's sitting in the chat for the driver to open.)
- Once the location is sent/described: call notify_manager (name, shoe + size, and location = the landmark they gave OR "customer dropped a WhatsApp location pin in the chat — open the chat to see it"). Include price/payment ONLY if the customer actually brought it up — otherwise leave those blank (payment is handled on arrival). Then reply warmly, EXACTLY in this spirit: "Perfect! 🙌 The driver's heading out shortly and he'll give you a call when he's close 👟". Do NOT invent an exact ETA or say "I'm on my way" yourself — you're alerting the team, not driving.
- AFTER the delivery is confirmed (you've already called notify_manager) — if the customer messages again asking "how long / you coming / where's the driver / you reaching?" — do NOT re-ask for their location or the order details. Say: "Let me call the driver now to see how far he is! 🚗 He'll be right with you 👟". (The system also auto-sends a "we're still on the way!" reassurance if they go quiet for a while.)
- FUTURE / SCHEDULED orders (IMPORTANT — don't be pushy): if the customer wants it on a LATER day or time (e.g. "Sunday", "Monday", "tomorrow", "next week", "later", "this weekend") — do NOT press them for the location pin right now, and do NOT keep saying you're "just waiting on the pin". Warmly lock in the day, then tell them they can send their WhatsApp location WHENEVER they're ready — even on the same day they want it — and we'll come as soon as possible. Say it once, relaxed, then let THEM come back to you. Only call notify_manager once they actually drop the location and say they're ready to receive — never before.

BAHAMIAN "COMING" PHRASING (IMPORTANT — locals often ask questions with no question mark):
- "you coming", "you coming bro", "you reaching", "wen you coming", "how long" → this means "ARE YOU COMING for the delivery / how soon?" They want to know you're on the way. Reply that yes you're coming / sorting their delivery, and ask for the details you still need (what shoe + size if you don't have them yet, and where to meet). Do NOT just recite the location line at them.
- "I coming", "im coming", "coming", "i reach", "im here", "outside", "by the car" → this means the customer has ARRIVED at the meet-up spot and is walking over to collect their delivery. Treat it as "I'm here to receive my order." Reply with a short friendly acknowledgement like "Alright, I see you! 👀 Come through 👟" — do NOT treat this as a new shoe request or ask for their size again.
- Rule of thumb: "YOU coming" = they're asking about you / the delivery arriving. "I/Im coming" or just "coming" = they've arrived and are coming to you. When unsure, ask one short clarifying question rather than guessing.
- "noted", "note", "noted 👍", "gotcha", "respect", "bet", "aight", "cool cool", "ok cool", "say less" → this is just the customer ACKNOWLEDGING you / a friendly end-of-chat "gotcha" (very Bahamian). It is NOT a request to add or leave a note, and NOT a shoe or a size. Do NOT reply "What's the note?" or ask what they mean. Just give a warm, short closer like "👍 Anytime! We're here whenever you're ready 👟" and let the chat rest.

SPECIAL CONTACTS:
- If the customer's message is just the name "Rodney" (spelled R-O-D-N-E-Y), it's probably Rodney's mom. First reply ONLY with: "Hey! Is this Mommy? 😊" If she replies yes, then reply warmly: "Hi Mo! How are you doing? Love you. Hope everything is okay! 💛"
${who ? `- The customer's saved name is "${who}".\n` : ''}- If the customer's saved name is exactly "Deashinique", greet her with: "Hey Deashinique! What's up? 👟" (always spell it exactly "Deashinique").

FOLLOW-UPS: If you earlier sent "Did you see anything you liked, or did you get sorted?" and they reply: if they say NO / nothing caught their eye → reply "Okay, no worries! Maybe next time. Have a good day! 👟". If they say YES / they liked something → ask them for the NAME on the photo (you can't see pictures), e.g. "Nice! 😍 What's the name on the one you liked? It's printed right under the photo 👟" — then look it up and help them order.

Our brands: ${BRANDS.join(', ')}. Sizes in stock: roughly ${SIZE_RANGE}. Currency is USD. Website: ${WEBSITE}.
PRICE LIST — when a customer asks about prices in GENERAL ("how much are your sneakers", "how much y'all charge", "price list", "how much for a pair", "what's the prices", "prices?"), do NOT give a vague range like "$70 to $250". Send this EXACT list (keep the emojis and the *bold* stars — WhatsApp shows them bold), then ask their size:
👟 *${storeName.toUpperCase()} — PRICE LIST* 👟

👑 Air Force 1 — *$120*
👟 Air Jordan 1 — *$120*
🐐 Air Jordans (4, 5, 11, etc.) — *$180*
🏃 Nike Roshe — *$50*
🔥 Nike Dunk High — *SALE $60* 🔥
🐊 Crocs — *$65*
🦂 Nike Scorpion — *$70*
☁️ Yeezy Foam — *$70*
👟 Nike Dunk Low — *$120*
💨 Air Max / VaporMax — *$120*
🌀 Air Max 95 — *$130*
⚡ New Balance / ASICS — *$130*
💎 Rare & Limited — up to *$250*

Then add ONE line: "Tell me your size 👟 and I'll send pics of what we got!". IMPORTANT: if they ask the price of ONE SPECIFIC shoe, give THAT shoe's exact price from search_inventory instead of the whole list.
⚠️ JORDAN PRICING (know this cold): Air Jordan **1s are $120** — every Jordan 1 colourway and style (Jordan 1 High, Low, Retro — all of them). Every OTHER Air Jordan (Jordan 3, 4, 5, 11, 13, Tatum, etc.) is **$180**, any colour or style. So if a customer asks the price of a Jordan — INCLUDING one you can't find in stock or a colour you're not sure we carry (e.g. "how much for the blue and white Jordan?") — quote it from this rule: a Jordan 1 = $120, any other Jordan = $180. Never tell a customer a Jordan "isn't showing up" or that you can't price it.
Only ever mention shoes, prices and sizes that search_inventory returns — never invent anything (the Jordan pricing rule above is the one known exception, so you can always quote a Jordan: $120 for a Jordan 1, $180 for any other).`;
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
        max_price: { type: 'number', description: 'Only shoes at or below this price. Use for "under $150", "cheaper than 100", "budget", "cheapest", "anything under X". Pass just the number (150).' },
        min_price: { type: 'number', description: 'Only shoes at or above this price. Use for "over $100" or a price range (with max_price).' },
        query: { type: 'string', description: 'Free text — a model, nickname or colourway, e.g. "Jordan 4", "Air Max 95", "yellow thunder", "white thunder", "bred", "cement". Searches across each shoe\'s name, nickname AND colour, and tolerates typos/odd spellings ("thundr", "jordon", "cment"). Prefer putting a colour+nickname phrase here as one query rather than splitting it.' },
        womens: { type: 'boolean', description: 'Set true when the customer is giving a WOMEN\'S size ("women\'s 9", "ladies 9", "a 9 in womens", "for her"). Pass the WOMEN\'S size numbers in size/sizes as-is; the search maps them to the right men\'s stock automatically (men\'s 7 = women\'s 8 & 8.5, men\'s 8 = women\'s 9 & 9.5, etc.). Default false = men\'s sizing.' },
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
        womens: { type: 'boolean', description: 'Set true when showing photos to a customer shopping in WOMEN\'S sizes. The size labels under each photo are then shown in WOMEN\'S sizing (each men\'s size appears as its two women\'s sizes — men\'s 7 shows as "8, 8.5") so she sees HER size, not the men\'s number. Use include_sizes = true with this so the converted sizes actually show. Default false.' },
      },
    },
  },
  {
    name: 'notify_manager',
    description: "Alert the shop owner + team that a sale is READY to deliver/hand off. You MUST actually CALL this tool (not just SAY the driver is coming) the moment the customer has (1) told you WHAT they want (shoe + size), AND (2) given their location OR said they sent it — a dropped WhatsApp pin, OR a message like \"sent\" / \"sent the location\" / \"dropped it\" (you CAN'T see the pin, so trust them when they say they sent it). Payment is NOT required to call this — it's handled on arrival. ⚠️ CRITICAL: NEVER type \"the driver is heading out\" / \"someone will be there shortly\" / \"letting the team know\" WITHOUT calling this tool on the SAME turn — if you skip the tool, the team gets NO alert and the customer waits for nobody. It pings the owner on WhatsApp (both phones) and posts the job to the shop website. Do NOT call it for a plain question, or before the customer is ready to receive.",
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: "The customer's name, if known." },
        customer_phone: { type: 'string', description: "The customer's callback number IF they typed one in the chat (e.g. 'call me at 359-1234'). Leave blank otherwise — the system fills in their WhatsApp number automatically." },
        shoe: { type: 'string', description: 'The shoe(s) they are buying — colour/model.' },
        size: { type: 'string', description: 'Their size.' },
        price: { type: 'string', description: 'Agreed total, e.g. "$240".' },
        payment: { type: 'string', description: 'How they are paying: website/card, cash, which bank transfer, or SunCash.' },
        location: { type: 'string', description: "The customer's meet-up spot / address exactly as they gave it. Mention if they dropped a pin." },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_agent',
    description: "Hand the chat off to a REAL human team member. Call this ONCE when you're stuck or going in circles — e.g. you've already tried and still can't find the shoe or answer them, or your next message would just REPEAT something you already said (\"I can't see pictures\", \"I'm not finding that in the system\", \"check the name under the photo\"). Repeating yourself frustrates customers — instead, call this and a team member is alerted to jump into the chat (it pings the owner + on-duty staff on WhatsApp and posts to the website Tasks board). After calling it, warmly tell the customer a team member will help them shortly, and STOP looping. Do NOT call it on the very first message, and do NOT call it for anything you can still handle yourself — ALWAYS search_inventory their exact words first; only escalate if you still genuinely can't help. Never call it twice in a row.",
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: "One short line on what the customer needs and where you got stuck, e.g. \"wants 'Nike mind 001 black' in size 11 but I can't confirm which pair\"." },
      },
    },
  },
];

// Shorthand customers actually use that isn't in a shoe's stored text. We fold
// these into the searchable haystack so "NB 9060", "TN", "AJ 4" all land:
//   NB = New Balance · TN = Air Max Plus · AJ/Jordans = (Air) Jordan.
function aliasTokens(s) {
  const out = [];
  const brand = (s.brand || '').toLowerCase();
  const name = (s.name || '').toLowerCase();
  if (brand.includes('new balance')) out.push('nb');
  if (brand.includes('jordan') || name.includes('jordan')) out.push('aj', 'jordans', 'js', 'jays', 'retro', 'retros');
  if (name.includes('air max plus')) out.push('tn');
  if (name.includes('air force')) out.push('forces', 'force', 'af1', 'af');
  return out;
}

// The static catalog.json never changes, but the website marks shoes/sizes sold
// (and deletes shoes) in the shared /shop backend. Overlay that live data so the
// bot never offers something that's already gone. A shoe is hidden entirely when
// it's deleted, flagged sold, or has no sizes left; otherwise we swap in the
// live size list/price. Shoes the website hasn't touched fall through unchanged.
// Keyed by ORIGINAL catalog index → the live-adjusted shoe (sizes/price swapped
// in from the website). Only AVAILABLE shoes are in the map; deleted / sold /
// no-sizes-left shoes are left out entirely. sendShoePhotos and searchInventory
// both look shoes up by catalog index, so the index must stay the key.
function liveShoeMap() {
  let overrides = {}, deleted = {};
  try {
    require('./shop').getShoes().forEach(s => { if (s && s.id != null) overrides[s.id] = s; });
    require('./shop').getDeleted().forEach(id => { deleted[id] = true; });
  } catch (_) { /* shop not ready — fall back to the static catalog */ }
  const map = {};
  catalog.forEach((s, id) => {
    if (deleted[s.id]) return;                          // deleted on the website
    const ov = overrides[s.id];
    let sizesRaw = s.sizesRaw, price = s.price, sold = false;
    const nameOv = {};  // AUTO-SYNC: the website's live name/color/nickname/brand edits
    if (ov) {
      if (Array.isArray(ov.sizes)) sizesRaw = ov.sizes;
      if (ov.price != null) price = ov.price;
      if (ov.sold) sold = true;
      // The app pushes catalog-shoe edits (rename/recolor/nickname) as `_ov`; apply them
      // so Jess reflects them instantly — no need to hand-edit catalog.json anymore.
      if (ov._ov && typeof ov._ov === 'object') {
        ['brand', 'name', 'color', 'nickname'].forEach(f => {
          if (ov._ov[f] != null && String(ov._ov[f]).trim() !== '') nameOv[f] = ov._ov[f];
        });
      }
    }
    if (sold || !sizesRaw || sizesRaw.length === 0) return; // out of stock — never offer it
    map[id] = Object.assign({}, s, { sizesRaw, price }, nameOv);
  });
  return map;
}
function liveCatalog() {
  const m = liveShoeMap();
  return Object.keys(m).map(id => ({ s: m[id], id: +id }));
}

function searchInventory({ size, sizes, size_match, brand, color, query, womens, max_price, min_price } = {}) {
  let rows = liveCatalog();
  // Build the size filter from either `size` (one) or `sizes` (a list, e.g. a
  // range "9.5 to 10" or matching "9 and 7"). Normalise each to a clean number
  // string and drop junk/duplicates. When womens=true the customer gives WOMEN'S
  // sizes but stock is in men's: women's − 1.5 = men's (women's 7 → men's 5.5,
  // women's 8 → men's 6.5, women's 9.5 → men's 8). "A men's 5.5 is a women's 7."
  const sizeList = [...new Set(
    []
      .concat(Array.isArray(sizes) ? sizes : (sizes != null ? [sizes] : []))
      .concat(size != null ? [size] : [])
      .map(x => { const n = parseFloat(x); return isNaN(n) ? '' : String(womens ? n - 1.5 : n); })
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
    rows = rows.filter(({ s }) => {
      const sb = s.brand.toLowerCase();
      return sb.includes(b) || b.includes(sb) || aliasTokens(s).includes(b);  // "NB"/"TN"/"AJ" as a brand param still match
    });
  }
  if (color && color.trim()) {
    const c = color.toLowerCase();
    rows = rows.filter(({ s }) => `${s.color || ''} ${s.nickname || ''} ${s.name}`.toLowerCase().includes(c));
  }
  // Price filter: "under $150" → max_price 150; "over $100" → min_price 100; a range uses both.
  const maxP = parseFloat(max_price), minP = parseFloat(min_price);
  if (!isNaN(maxP)) rows = rows.filter(({ s }) => (parseFloat(s.price) || 0) <= maxP);
  if (!isNaN(minP)) rows = rows.filter(({ s }) => (parseFloat(s.price) || 0) >= minP);
  if (query && query.trim()) {
    // Filler words that shouldn't gate a match (so "red AND black thunderS" still finds "Red Thunder").
    const STOP = new Set(['and', 'the', 'a', 'an', 'in', 'of', 'with', 'for', 'me', 'i', 'im',
      'need', 'want', 'looking', 'you', 'your', 'got', 'have', 'has', 'some', 'pair', 'pairs',
      'shoe', 'shoes', 'sneaker', 'sneakers', 'size', 'sizes', 'please', 'plz', 'do', 'any',
      'show', 'see', 'them', 'one', 'ones', 'pls', 'get', 'wan', 'wanna', 'all']);
    // Normalise possessive shorthand so "J's"/"Js" → "js" (Jordans) survives tokenizing.
    const words = query.toLowerCase().replace(/\bj'?s\b/g, ' js ').replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/)
      .filter(w => w && !STOP.has(w))
      .filter(w => w.length >= 2 || /\d/.test(w))
      // "4s" / "11s" are model numbers said with an s ("Jordan 4s") → treat as "4" / "11".
      .map(w => /^\d+s$/.test(w) ? w.slice(0, -1) : w);
    rows = rows.filter(({ s }) => {
      const hay = `${s.name} ${s.brand} ${s.nickname || ''} ${s.color || ''} ${aliasTokens(s).join(' ')}`.toLowerCase();
      const hayWords = hay.split(/[^a-z0-9.]+/).filter(Boolean);
      return words.every(w => wordMatches(hay, hayWords, w));
    });
  }
  return rows.map(({ s, id }) => ({ id, name: displayName(s), price: `$${s.price}`, sizes: sizesOf(s), color: s.color, brand: s.brand }));
}

async function sendShoePhotos(sub, ids, token, includeSizes = true, groups = null, leadIn = '', womens = false) {
  // WhatsApp images carry NO caption (ManyChat drops it), so the label has to be
  // its own text bubble sent right after the photo. That also stops WhatsApp from
  // clumping the photos into one album, so each pic shows with its label beneath.
  // womens=true → show BOTH sides of the conversion so she sees her women's size
  // AND the men's size it actually is ("a men's 5.5 is a women's 7"), no confusion.
  const labelText = (s) => {
    const sizeLine = womens
      ? `📏 women's ${sizesOf(s, true)}  ·  men's ${sizesOf(s, false)}`
      : `📏 ${sizesOf(s, false)}`;
    return `${displayName(s)} — $${s.price}\n${sizeLine}`;
  };
  // Look shoes up through the LIVE map so labels show current sizes and anything
  // marked sold/deleted on the website is dropped even if it slipped into `ids`.
  const live = liveShoeMap();
  // dedupe against a shared `seen` set so the SAME shoe never goes out twice —
  // not within one list, and not across size groups (a shoe in both size 7 and
  // size 8 is sent once, with its label still showing every size it comes in).
  const dedupe = (idList, seen) => {
    const s = seen || new Set();
    return (idList || []).filter(id => !s.has(id) && s.add(id))
      .map(id => live[id]).filter(x => x && x.image);
  };
  let sent = 0, requested = 0;

  const totalPhotos = (Array.isArray(groups) && groups.length)
    ? (() => { const seen = new Set(); return groups.reduce((n, g) => n + dedupe(g.ids, seen).length, 0); })()
    : dedupe(ids).length;
  // ALWAYS label every photo (name + price + sizes) — no matter how many — so the
  // customer can always read the shoe's name off the pic and tell us which one.
  const showLabels = true;

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
    const seenAcrossGroups = new Set(); // a shoe shown in an earlier size group is skipped later
    for (const g of groups) {
      const chosen = dedupe(g.ids, seenAcrossGroups);
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

  // Close with the "text me the name" prompt once photos have gone out — but only
  // ONCE per burst: a two-colour request fires 3 send_photos calls back-to-back, and
  // we don't want the closing line repeated 3×. Send it at most once per 45s per sub.
  if (sent > 0) {
    const now = Date.now();
    if (!endMsgSentAt[sub] || now - endMsgSentAt[sub] > 45000) {
      endMsgSentAt[sub] = now;
      try { await sendChunk(sub, [{ type: 'text', text: L(END_OF_PHOTOS_T, sub) }], token); } catch (e) { /* non-fatal */ }
    }
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

async function callClaude(messages, system, toolChoice) {
  const body = { model: AI_MODEL, max_tokens: 1024, system: system || buildSystemPrompt(), tools: AI_TOOLS, messages };
  if (toolChoice) body.tool_choice = toolChoice; // e.g. force a search on the first move of a photo
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

// Fetch a customer's photo and return it as a base64 image block so Claude (Haiku 4.5,
// which has vision) can actually SEE it and identify the shoe. Returns null on any
// problem (bad URL, not an image, too big, timeout) so the caller can fall back to
// asking for the name instead of crashing the turn.
async function fetchImageBase64(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), redirect: 'follow' });
    if (!r.ok) return null;
    let ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return null;          // Anthropic ~5MB cap
    if (!/^image\/(jpeg|png|gif|webp)$/.test(ct)) {
      // sniff common magic bytes when the header is missing/wrong
      if (buf[0] === 0xFF && buf[1] === 0xD8) ct = 'image/jpeg';
      else if (buf[0] === 0x89 && buf[1] === 0x50) ct = 'image/png';
      else if (buf[0] === 0x47 && buf[1] === 0x49) ct = 'image/gif';
      else if (buf[8] === 0x57 && buf[9] === 0x45) ct = 'image/webp';
      else return null;
    }
    return { media_type: ct, data: buf.toString('base64') };
  } catch (_) { return null; }
}

const convos = new Map();    // subscriberId -> message history
const chatLocks = new Map(); // subscriberId -> in-flight promise (serialises a customer's messages)
const recentImageSeen = new Map(); // "sub|imageUrl" -> ts, to skip the same photo arriving twice
const recentlySent = new Map();    // sub -> {ts, names:[]} of shoes we JUST showed, so if the customer sends one of those pics BACK we recognise it as that exact shoe
const followUps = new Map(); // subscriberId -> pending 10-minute follow-up timer

// ── Manual control panel (/console) support ───────────────────────────────────
// So Rodney can tell the bot "send size 8 to this customer" from a private page.
// We remember who recently messaged (to list them) and each account's token IN
// MEMORY ONLY (never logged, never written to disk) so the panel can send through
// the right account automatically.
const recentCustomers = new Map(); // sub -> {sub, name, store, lastText, at}
const storeTokens = new Map();     // store name -> latest ManyChat token seen for it
let lastToken = null;              // most-recent token of any account (fallback)
function rememberCustomer(sub, name, store, text, token) {
  if (sub && token) {
    recentCustomers.set(sub, { sub, name: name || '', store: store || '', lastText: (text || '').slice(0, 80), at: new Date().toISOString() });
    if (recentCustomers.size > 80) { const first = recentCustomers.keys().next().value; recentCustomers.delete(first); }
    if (store) storeTokens.set(store, token);
    lastToken = token;
  }
}

// Schedule the "did you see anything you liked?" nudge for 10 min after we send
// shoes. Resets if called again. Cancelled (clearFollowUp) when the customer
// messages again — so we only nudge customers who went quiet.
// Generic "nudge the customer if they go quiet" timer. One pending nudge per
// customer (a new one replaces the old); cleared the moment they message again.
function scheduleNudge(sub, token, text, ms, next) {
  clearFollowUp(sub);
  const handle = setTimeout(async () => {
    followUps.delete(sub);
    // Register the follow-on stage (e.g. the closing message) BEFORE we send/await
    // this one. Sending takes a moment, and the nudge invites a reply — if we waited
    // until after the send to schedule the closer, a customer who replies during that
    // window couldn't cancel it (clearFollowUp would find nothing) and would still get
    // the closer. Scheduling first (synchronously) means their reply always cancels it.
    // It only fires if the customer stays quiet; after the last stage there's no `next`.
    if (next && next.text) scheduleNudge(sub, token, next.text, next.ms, next.next);
    try {
      await sendChunk(sub, [{ type: 'text', text }], token);
      const h = convos.get(sub) || [];
      h.push({ role: 'assistant', content: text }); // so Claude knows it asked
      convos.set(sub, trimHistory(h));
    } catch (e) { /* non-fatal */ }
  }, ms);
  if (handle.unref) handle.unref();
  followUps.set(sub, handle);
}
// 10-min "did you see anything you liked?" after photos.
function scheduleFollowUp(sub, token) { scheduleNudge(sub, token, L(FOLLOWUP_T, sub), FOLLOWUP_MS, { text: L(CLOSER_T, sub), ms: CLOSER_MS, next: { text: L(ASKME_T, sub), ms: THIRD_MS } }); }
// 5-min "how can we help? want pictures?" after the welcome if they go quiet.
function scheduleWelcomeNudge(sub, token) { scheduleNudge(sub, token, L(ASKME_T, sub), WELCOME_NUDGE_MS); }

// Ping the owner's WhatsApp with a delivery-ready alert. Uses the live chat's
// own ManyChat token (the customer's account) — the owner just needs to have
// messaged that account once so they're a subscriber. Best-effort.
async function waSendManager(text, token) {
  if (!MANAGER_NUMBERS.length || !token) return false;
  let anyOk = false;
  for (const num of MANAGER_NUMBERS) {           // send to EVERY owner phone, not just one
    try {
      const sub = await findSubscriberByPhone(num, token);
      if (!sub) continue;
      await sendChunk(sub, [{ type: 'text', text }], token);
      anyOk = true;
    } catch (_) { /* try the next number */ }
  }
  return anyOk;
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

async function runChat(req, sub, userText, token, ctx = {}, image = null) {
  const system = buildSystemPrompt({ store: ctx.store, name: ctx.name });
  const history = convos.get(sub) || [];
  const wasNewConvo = history.length === 0; // their very first message → we reply with the welcome
  // When the customer sent a photo, attach it as an image block so Claude can SEE it.
  // If we JUST showed this customer some shoes, tell Claude — because customers often
  // forward one of OUR pics back to say "I want this one", and Jess should recognise it
  // as that exact shoe rather than trying to identify it from scratch.
  let photoNote = (userText && userText.trim()) ? userText : '(The customer sent this photo of a shoe — identify it and help them.)';
  if (image) {
    const rs = recentlySent.get(sub);
    if (rs && rs.names && rs.names.length && (Date.now() - rs.ts) < 45 * 60 * 1000) {
      photoNote += `\n\n[Context for you: in the last little while you SENT this customer photos of these shoes from our catalog — ${rs.names.join('; ')}. Customers often send one of those pics straight BACK to mean "I want this one." So if the photo they just sent looks like one of those, it IS that exact shoe from our stock: confirm it by name and move to their size. Only if it clearly ISN'T one of those, identify it fresh.]`;
    }
  }
  const userMsg = {
    role: 'user',
    content: image
      ? [ { type: 'text', text: photoNote },
          { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } } ]
      : userText,
  };
  history.push(userMsg);

  // The customer MUST always get a reply. Track whether we actually sent them
  // anything this turn; if a turn somehow ends with nothing sent (model fumbled,
  // a send failed, etc.), we send a recovery line at the end instead of going silent.
  let sentToCustomer = false;
  let photosSentRun = false; // did any photos go out this turn?
  let lastText = '';         // last non-empty reply Claude wrote (safety net if nothing lands)
  let lastSearchCount = 0;   // # results from the latest search — used to force a send on a photo
  try {
  for (let step = 0; step < 6; step++) {
    // On the FIRST move of a photo turn, FORCE Jess to search inventory — so she can't
    // answer "what size?" or "we're out" without actually looking first. This is the
    // reliable, low-risk way to make photo replies show the pair (no re-loop/hang).
    // Photo turns: force her to LOOK, then SHOW. Step 0 = search. If that search found
    // matches, step 1 = send them. If it came back empty (often a too-narrow / wrong
    // model-name search), step 1 = search AGAIN (the prompt tells her to broaden), then
    // step 2 = send if that found anything. Guarded so she never sends with 0 results.
    const forceTool = (image && !photosSentRun && step === 0) ? { type: 'tool', name: 'search_inventory' }
      : (image && !photosSentRun && step === 1 && lastSearchCount > 0) ? { type: 'tool', name: 'send_photos' }
      : (image && !photosSentRun && step === 1 && lastSearchCount === 0) ? { type: 'tool', name: 'search_inventory' }
      : (image && !photosSentRun && step === 2 && lastSearchCount > 0) ? { type: 'tool', name: 'send_photos' }
      : undefined;
    const { ok, status, data } = await callClaude(history, system, forceTool);
    if (!ok) {
      record(req, { endpoint: 'chat-error', sub, status, body: JSON.stringify(data).slice(0, 300) });
      await sendChunk(sub, [{ type: 'text', text: "Sorry, I'm having a little hiccup 🤕 try again in a sec." }], token).catch(() => {});
      return;
    }
    history.push({ role: 'assistant', content: data.content });
    // Once Claude has seen the photo, drop the heavy base64 from history so the rest
    // of the tool-loop (and future turns) stay light and we never re-send a photo.
    if (image && step === 0 && Array.isArray(userMsg.content)) {
      userMsg.content = (userText && userText.trim()) ? userText : '(customer sent a photo of a shoe)';
    }
    const toolUses = data.content.filter(b => b.type === 'tool_use');
    const sendPhotosTU = toolUses.find(t => t.name === 'send_photos');
    const turnText = data.content.filter(b => b.type === 'text' && b.text.trim())
      .map(b => b.text.trim()).join('\n');
    if (turnText) lastText = turnText; // remember it in case nothing else lands
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
      if (tu.name === 'search_inventory') { const found = searchInventory(tu.input || {}); lastSearchCount = found.length; result = { shoes: found }; }
      else if (tu.name === 'send_photos') {
        const inp = tu.input || {};
        const includeSizes = inp.include_sizes !== false; // default true
        // Lead-in: prefer an explicit lead_in arg, else any text the model wrote this turn.
        const leadIn = (inp.lead_in && String(inp.lead_in).trim()) ? String(inp.lead_in).trim() : turnText;
        result = await sendShoePhotos(sub, inp.ids, token, includeSizes, inp.groups, leadIn, inp.womens === true);
        if (result.sent > 0) { scheduleFollowUp(sub, token); photosSent = true; photosSentRun = true; sentToCustomer = true; } // nudge 10 min later if quiet
        // Remember which shoes we just showed this customer, so if they send one of
        // THESE pics back to us ("I want this one"), we recognise it as that exact shoe.
        try {
          const liveM = liveShoeMap();
          const shownIds = (Array.isArray(inp.groups) && inp.groups.length)
            ? inp.groups.flatMap(g => g.ids || [])
            : (inp.ids || []);
          const names = shownIds.map(id => liveM[id]).filter(Boolean).map(displayName);
          if (names.length) recentlySent.set(sub, { ts: Date.now(), names: [...new Set(names)].slice(0, 25) });
        } catch (_) {}
      }
      else if (tu.name === 'notify_manager') {
        const inp = tu.input || {};
        // Pull the customer's WhatsApp number so staff can call/message them for the
        // drop-off. Prefer what Jess passed or the request field; else ask ManyChat.
        let custPhone = inp.customer_phone || getPhone(req);
        if (!custPhone) { try { custPhone = await getSubscriberPhone(sub, token); } catch (_) {} }
        custPhone = custPhone ? ('+' + String(custPhone).replace(/[^0-9]/g, '')) : '';
        const lines = [
          '🛵 *DELIVERY READY* — please facilitate',
          inp.customer_name ? `👤 ${inp.customer_name}` : null,
          custPhone ? `📞 ${custPhone}  (wa.me/${custPhone.replace(/[^0-9]/g,'')})` : null,
          inp.shoe ? `👟 ${inp.shoe}${inp.size ? ` — size ${inp.size}` : ''}` : (inp.size ? `👟 size ${inp.size}` : null),
          inp.price ? `💰 ${inp.price}${inp.payment ? ` (${inp.payment})` : ''}` : (inp.payment ? `💰 ${inp.payment}` : null),
          `📍 ${inp.location || '(no location given)'}`,
          ctx.store ? `🏬 ${ctx.store}` : null,
        ].filter(Boolean).join('\n');
        let waOk = false;
        try { waOk = await waSendManager(lines, token); } catch (_) {}
        try { require('./shop').addAlert(lines, 'Jess 🤖'); } catch (_) {} // shows on the website Tasks board
        // Also best-effort WhatsApp every on-duty staff number so whoever's around gets it
        // (each still subject to WhatsApp's 24h window). MANYCHAT_TOKEN drives the send.
        let staffWa = [];
        try { staffWa = await require('./shop').blastEmployees(lines, null); } catch (_) {}
        const staffOk = Array.isArray(staffWa) && staffWa.some(r => r && r.ok);
        record(req, { endpoint: 'notify-manager', sub, store: ctx.store, waOk, staffWa, staffOk });
        // Delivery is now in motion — if the customer goes quiet, auto-reassure them
        // at ~20 min ("still on the way!"). Any reply from them cancels it (and Jess
        // then offers to call the driver). Reuses the one-pending-nudge timer.
        try { scheduleNudge(sub, token, L(DELIVERY_FOLLOWUP_T, sub), DELIVERY_FOLLOWUP_MS); } catch (_) {}
        result = { ok: true, owner_alerted_whatsapp: waOk, posted_to_website: true };
      }
      else if (tu.name === 'get_agent') {
        const inp = tu.input || {};
        // Grab the customer's WhatsApp number so the team member can reach them fast.
        let custPhone = getPhone(req);
        if (!custPhone) { try { custPhone = await getSubscriberPhone(sub, token); } catch (_) {} }
        custPhone = custPhone ? ('+' + String(custPhone).replace(/[^0-9]/g, '')) : '';
        const lines = [
          '🙋 *CUSTOMER NEEDS A TEAM MEMBER* — please jump into the chat',
          inp.reason ? `📝 ${inp.reason}` : null,
          custPhone ? `📞 ${custPhone}  (wa.me/${custPhone.replace(/[^0-9]/g,'')})` : null,
          ctx.store ? `🏬 ${ctx.store}` : null,
        ].filter(Boolean).join('\n');
        let waOk = false;
        try { waOk = await waSendManager(lines, token); } catch (_) {}
        try { require('./shop').addAlert(lines, 'Jess 🤖'); } catch (_) {} // website Tasks board
        let staffWa = [];
        try { staffWa = await require('./shop').blastEmployees(lines, null); } catch (_) {}
        const staffOk = Array.isArray(staffWa) && staffWa.some(r => r && r.ok);
        record(req, { endpoint: 'get-agent', sub, store: ctx.store, waOk, staffOk });
        result = { ok: true, agent_alerted: true };
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
    // If Claude actually WROTE a reply this turn but it got swallowed (it searched, or
    // tried to send photos but nothing landed), send THAT — so a photo ID like "That's
    // the ASICS!" still reaches the customer instead of a blank "didn't come through".
    record(req, { endpoint: 'chat-fallback', sub, userText, hadText: !!lastText, hadImage: !!image });
    const fb = lastText || (image
      ? "That's a clean pair 👀 — what size you looking for and I'll pull up what we've got 👟"
      : "Sorry, that didn't come through right 🙈 Tell me the shoe (and your size if you have one) and I'll pull it right up 👟");
    await sendChunk(sub, [{ type: 'text', text: fb }], token).catch(() => {});
    sentToCustomer = true;
  }
  // If this was their first message (we just sent the welcome) and we didn't send
  // photos, nudge once ~5 min later in case they go quiet. Cancelled if they reply.
  if (wasNewConvo && sentToCustomer && !photosSentRun) {
    scheduleWelcomeNudge(sub, token);
  }
  convos.set(sub, trimHistory(history));
}

function handleChat(req, res) {
  const userText = extractQuery(req);
  const audioUrl = getAudioUrl(req);
  let imageUrl = getImageUrl(req);
  // A message that is JUST a bare link (no other words) and isn't audio is almost
  // always the customer's photo arriving via Last Text Input. Catch it even if the
  // link's host/extension wasn't recognised above, so Jess looks at the picture
  // instead of reading a raw URL out loud.
  if (!imageUrl && !audioUrl) {
    const t = (userText || '').trim();
    if (/^https?:\/\/\S+$/i.test(t) && !AUDIO_EXT.test(t)) imageUrl = t;
  }
  const sub = getContactId(req);
  const token = getToken(req);
  const store = getStore(req);
  const name = getName(req);
  record(req, { endpoint: 'chat', extractedQuery: userText, audioUrl, imageUrl, sub, store, name, hasToken: !!token, hasAI: !!process.env.ANTHROPIC_API_KEY });
  rememberCustomer(sub, name, store, userText, token); // for the /console control panel
  // Track the customer's language (conservative; English by default) so the automatic
  // nudges/handoff go out in Creole/Spanish only when they clearly speak it.
  if (sub && userText) { try { subLang.set(sub, detectLang(userText, subLang.get(sub))); } catch (_) {} }

  res.json({ ok: true }); // answer ManyChat instantly; do the AI work in the background

  if (!process.env.ANTHROPIC_API_KEY) { record(req, { endpoint: 'chat-skip', reason: 'no ANTHROPIC_API_KEY' }); return; }
  if (!token || !sub) return;
  // A photo (with OR without a caption), a voice note, or text ALL count as a
  // message we must answer. Only truly empty pings (no text, no photo, no audio)
  // are ignored, so the bot never goes silent on a real customer message.
  if (!userText.trim() && !audioUrl && !imageUrl) return;

  // Dedupe photos: the SAME image can hit us twice in quick succession (a
  // Default-Reply / ManyChat quirk). If we just handled this exact photo for this
  // customer, skip the duplicate so Jess doesn't answer the same picture twice.
  if (imageUrl) {
    const k = sub + '|' + imageUrl;
    const prevSeen = recentImageSeen.get(k);
    if (prevSeen && (Date.now() - prevSeen) < 60000) {
      record(req, { endpoint: 'photo-dupe-skip', sub, imageUrl });
      return;
    }
    recentImageSeen.set(k, Date.now());
    if (recentImageSeen.size > 200) { const f = recentImageSeen.keys().next().value; recentImageSeen.delete(f); }
  }

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
    // Customer sent a PHOTO (its link arrives via Last Text Input). Download it and let
    // Jess actually LOOK at it — she identifies the shoe and searches inventory. Only if
    // the photo won't download do we fall back to the honest apology + agent hand-off.
    let photo = null;
    if (imageUrl) {
      record(req, { endpoint: 'photo-in', sub, imageUrl });
      // The link usually IS the whole "text" — don't feed a raw URL to Claude as words.
      if (text.trim() === imageUrl.trim()) text = '';
      photo = await fetchImageBase64(imageUrl).catch(() => null);
      if (!photo) {
        record(req, { endpoint: 'photo-handoff', sub, imageUrl });
        await sendChunk(sub, [{ type: 'text', text: L(HANDOFF_T, sub) }], token).catch(() => {});
        let custPhone = getPhone(req);
        if (!custPhone) { try { custPhone = await getSubscriberPhone(sub, token); } catch (_) {} }
        custPhone = custPhone ? ('+' + String(custPhone).replace(/[^0-9]/g, '')) : '';
        const alert = [
          "📸 *CUSTOMER SENT A PHOTO — needs an agent* (Jess couldn't open the image)",
          name ? `👤 ${name}` : null,
          custPhone ? `📞 ${custPhone}  (wa.me/${custPhone.replace(/[^0-9]/g, '')})` : null,
          store ? `🏬 ${store}` : null,
          '👉 Please jump into the chat and help them 🙏',
        ].filter(Boolean).join('\n');
        try { await waSendManager(alert, token); } catch (_) {}
        try { require('./shop').addAlert(alert, 'Jess 🤖'); } catch (_) {}
        try { await require('./shop').blastEmployees(alert, null); } catch (_) {}
        return;
      }
    }
    return runChat(req, sub, text, token, { store, name }, photo);
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

// ── Manual control panel (/console) ───────────────────────────────────────────
// A private, key-gated page where Rodney picks a customer (or types their number)
// and tells the bot what to send — for when a customer asks and the bot didn't
// catch it. Reuses searchInventory + sendShoePhotos + each account's own token
// (captured from live chat traffic, so the right account is used automatically).
const CONSOLE_KEY = process.env.CONSOLE_KEY || 'jess242';

// Ask ManyChat for a subscriber's saved WhatsApp/phone number by their id.
async function getSubscriberPhone(sub, token) {
  const id = String(sub || '').replace(/[^0-9]/g, '');
  if (!id || !token) return null;
  try {
    const f = await fetch('https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=' + encodeURIComponent(id),
      { headers: { Authorization: `Bearer ${token}` } });
    const fj = await f.json();
    const d = fj && fj.data;
    if (!d) return null;
    return d.whatsapp_phone || d.phone || (d.whatsapp_id ? String(d.whatsapp_id) : null) || null;
  } catch (_) { return null; }
}

async function findSubscriberByPhone(phone, token) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits || !token) return null;
  try {
    const f = await fetch('https://api.manychat.com/fb/subscriber/findBySystemField?phone=' +
      encodeURIComponent('+' + digits), { headers: { Authorization: `Bearer ${token}` } });
    const fj = await f.json();
    const d = fj && fj.data;
    return (d && (d.id || (Array.isArray(d) && d[0] && d[0].id))) || null;
  } catch (_) { return null; }
}

function consoleAuth(req, res) {
  const key = req.query.key || req.get('x-console-key') || (req.body && req.body.key);
  if (key !== CONSOLE_KEY) { res.status(401).json({ error: 'bad key' }); return false; }
  return true;
}

// List of recent customers + which accounts we have a token for (no tokens leaked).
app.get('/console/recent', (req, res) => {
  if (!consoleAuth(req, res)) return;
  const customers = [...recentCustomers.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
  res.json({ customers, stores: [...storeTokens.keys()], hasEnvToken: !!process.env.MANYCHAT_TOKEN });
});

// Send shoes to a customer: { sub | phone, store?, size?, brand?, color?, query? }.
app.post('/console/send', async (req, res) => {
  if (!consoleAuth(req, res)) return;
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  let sub = b.sub ? String(b.sub).replace(/[^0-9]/g, '') : '';
  const store = b.store || (sub && recentCustomers.get(sub) && recentCustomers.get(sub).store) || '';

  // Pick the right account token: the customer's own account first, then the
  // chosen store, then the most recent token, then the env var.
  const token = (sub && recentCustomers.get(sub) && storeTokens.get(recentCustomers.get(sub).store))
    || (store && storeTokens.get(store)) || lastToken || process.env.MANYCHAT_TOKEN || null;
  if (!token) return res.json({ ok: false, error: 'No ManyChat token yet. Have a customer message the bot once (so the server learns the account key), then try again.' });

  if (!sub && b.phone) {
    sub = await findSubscriberByPhone(b.phone, token);
    if (!sub) return res.json({ ok: false, error: 'No customer found for that number on this account. Have they messaged this WhatsApp before? Try picking them from the list instead.' });
  }
  if (!sub) return res.json({ ok: false, error: 'Pick a customer or enter their WhatsApp number.' });

  const results = searchInventory({ size: b.size, brand: b.brand, color: b.color, query: b.query });
  if (!results.length) return res.json({ ok: false, error: 'No shoes matched that — nothing was sent. Try different words.', found: 0 });
  const ids = results.map(r => r.id);

  const pieces = [];
  if (b.color) pieces.push(String(b.color).trim());
  if (b.brand) pieces.push(String(b.brand).trim());
  if (b.query) pieces.push(String(b.query).trim());
  if (b.size) pieces.push(`size ${String(b.size).trim()}`);
  const what = pieces.join(' ').trim();
  const leadIn = what
    ? `This is what we have in ${what} rite now 👇 Ready to Order!`
    : `This is what we have rite now 👇 Ready to Order!`;

  try {
    const r = await sendShoePhotos(sub, ids, token, true, null, leadIn);
    if (r.sent > 0) scheduleFollowUp(sub, token);
    record(req, { endpoint: 'console-send', sub, store, what, found: results.length, sent: r.sent });
    res.json({ ok: true, found: results.length, sent: r.sent, sub, store });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

app.get('/console', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jess — Send Shoes</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1115;color:#e7e9ee}
  .wrap{max-width:520px;margin:0 auto;padding:16px}
  h1{font-size:20px;margin:8px 0 2px} .sub{color:#9aa3b2;font-size:13px;margin-bottom:14px}
  .card{background:#1a1e27;border:1px solid #2a3140;border-radius:14px;padding:14px;margin-bottom:14px}
  label{display:block;font-size:12px;color:#9aa3b2;margin:10px 0 4px}
  input,select{width:100%;padding:11px;border-radius:10px;border:1px solid #2a3140;background:#11151d;color:#e7e9ee;font-size:15px}
  .row{display:flex;gap:8px} .row>div{flex:1}
  button{width:100%;padding:14px;border:0;border-radius:12px;background:#2f6df6;color:#fff;font-size:16px;font-weight:600;margin-top:14px}
  button:active{opacity:.8}
  .cust{padding:10px;border:1px solid #2a3140;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .cust b{font-size:14px} .cust small{color:#9aa3b2;display:block}
  .pick{background:#23314d;border:0;color:#cfe0ff;padding:8px 12px;border-radius:8px;width:auto;margin:0;font-size:13px}
  .banner{background:#3a2a12;border:1px solid #6b4f1f;color:#ffd79a;font-size:13px;border-radius:10px;padding:10px;margin-bottom:14px}
  .sel{outline:2px solid #2f6df6} #status{font-size:14px;margin-top:10px;min-height:20px}
  .ok{color:#7ee0a2} .err{color:#ff9a9a}
</style></head><body><div class="wrap">
<h1>🟢 Jess — Send Shoes</h1>
<div class="sub">Pick a customer (or type their number), choose what to send, hit Send.</div>
<div class="banner">⚠️ This sends real WhatsApp photos to the customer. Test with YOUR own number first.</div>

<div class="card">
  <label>Recent customers <span id="refresh" style="float:right;color:#2f6df6">↻ refresh</span></label>
  <div id="list">Loading…</div>
</div>

<div class="card">
  <label>…or type a WhatsApp number (with country code, e.g. 1242…)</label>
  <input id="phone" placeholder="12426547898" inputmode="numeric">
  <label>Account (only needed when typing a number)</label>
  <select id="store"><option value="">Auto</option></select>

  <div class="row">
    <div><label>Size</label><input id="size" placeholder="8"></div>
    <div><label>Colour</label><input id="color" placeholder="grey"></div>
  </div>
  <div class="row">
    <div><label>Brand</label><input id="brand" placeholder="New Balance"></div>
    <div><label>Search words</label><input id="query" placeholder="red thunder"></div>
  </div>
  <button id="send">Send to customer</button>
  <div id="status"></div>
</div>

<script>
  var KEY = new URLSearchParams(location.search).get('key') || '';
  var selectedSub = '', selectedStore = '';
  function q(id){return document.getElementById(id)}
  function load(){
    fetch('/console/recent?key='+encodeURIComponent(KEY)).then(r=>r.json()).then(function(d){
      if(d.error){q('list').innerHTML='<span class="err">'+d.error+'</span>';return}
      var s=q('store'); s.innerHTML='<option value="">Auto</option>'+(d.stores||[]).map(function(x){return '<option>'+x+'</option>'}).join('');
      if(!d.customers||!d.customers.length){q('list').innerHTML='<small>No customers yet. Once someone messages the bot they\\'ll show here.</small>';return}
      q('list').innerHTML=d.customers.map(function(c){
        return '<div class="cust" data-sub="'+c.sub+'" data-store="'+(c.store||'')+'"><div><b>'+(c.name||'(no name)')+'</b><small>'+(c.store||'')+' · '+(c.lastText||'')+'</small></div><button class="pick">Pick</button></div>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.cust'),function(el){
        el.querySelector('.pick').onclick=function(){
          selectedSub=el.getAttribute('data-sub');selectedStore=el.getAttribute('data-store');
          Array.prototype.forEach.call(document.querySelectorAll('.cust'),function(x){x.classList.remove('sel')});
          el.classList.add('sel');q('phone').value='';
          q('status').textContent='Selected: '+el.querySelector('b').textContent;
          q('status').className='';
        };
      });
    });
  }
  q('refresh').onclick=load;
  q('phone').oninput=function(){selectedSub='';selectedStore='';Array.prototype.forEach.call(document.querySelectorAll('.cust'),function(x){x.classList.remove('sel')});};
  q('send').onclick=function(){
    var body={key:KEY,size:q('size').value,color:q('color').value,brand:q('brand').value,query:q('query').value};
    if(selectedSub){body.sub=selectedSub;body.store=selectedStore;}
    else if(q('phone').value.trim()){body.phone=q('phone').value.trim();body.store=q('store').value;}
    else {q('status').textContent='Pick a customer or type a number first.';q('status').className='err';return;}
    if(!body.size&&!body.color&&!body.brand&&!body.query){q('status').textContent='Tell me what to send (size, colour, brand or search words).';q('status').className='err';return;}
    if(!confirm('Send these shoes to the customer now?'))return;
    q('status').textContent='Sending…';q('status').className='';
    fetch('/console/send?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(r=>r.json()).then(function(d){
        if(d.ok){q('status').textContent='✅ Sent '+d.sent+' photo(s) (found '+d.found+').';q('status').className='ok';}
        else {q('status').textContent='⚠️ '+(d.error||'Failed');q('status').className='err';}
      }).catch(function(e){q('status').textContent='⚠️ '+e;q('status').className='err';});
  };
  load();
</script>
</div></body></html>`);
});

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
