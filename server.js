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

const SYSTEM_PROMPT = `You are the friendly WhatsApp shopping assistant for THE PLUG 242, a sneaker store.

How to chat:
- This is WhatsApp. Keep EVERY reply short and natural — a sentence or two, casual, at most a couple of emojis. Never write paragraphs.
- On a brand-new conversation, greet the customer and ask whether they're after a SPECIFIC shoe, or want OPTIONS to pick from.
- Specific shoe: ask which one, use search_inventory to find it, then call send_photos with the matches.
- Options, a style ("all white", "something clean"), or a brand ("what Asics you got?"): FIRST ask the customer's shoe SIZE. Do NOT ask for their name. Once you have the size, call search_inventory with that size (plus brand/color/style if given) and call send_photos with EVERY match.
- Always send ALL matching shoes with send_photos — never just a few.
- Each photo is sent automatically with the shoe's name, price and sizes, so your own text just needs a short lead-in like "Here's what we got in size 9 👇".
- If nothing matches, say so kindly and offer to take a special-order request.

Our brands: ${BRANDS.join(', ')}. Sizes in stock: roughly ${SIZE_RANGE}. Currency is USD.
Only ever mention shoes, prices and sizes that search_inventory returns — never invent anything.`;

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
    description: "Send the customer a photo of each shoe (its name, price and sizes are added under each photo) over WhatsApp. Pass the ids from search_inventory. Send ALL the matching shoes.",
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'integer' }, description: 'Shoe ids to send photos for.' } },
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

async function sendShoePhotos(sub, ids, token) {
  const chosen = (ids || []).map(id => catalog[id]).filter(s => s && s.image);
  const messages = [];
  for (const s of chosen) {
    messages.push({ type: 'image', url: s.image, caption: `${displayName(s)} — $${s.price}\n📏 ${sizesOf(s)}` });
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const slice = messages.slice(i, i + CHUNK);
    try { await sendChunk(sub, slice, token); sent += slice.length; } catch (e) { /* keep going */ }
  }
  return { sent, requested: (ids || []).length };
}

async function callClaude(messages) {
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 1024, system: SYSTEM_PROMPT, tools: AI_TOOLS, messages }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

const convos = new Map();    // subscriberId -> message history
const chatLocks = new Map(); // subscriberId -> in-flight promise (serialises a customer's messages)

// Keep memory bounded without splitting a tool_use/tool_result pair: trim to a
// window that begins on a genuine customer text turn.
function trimHistory(h, maxLen = 24) {
  if (h.length <= maxLen) return h;
  let start = h.length - maxLen;
  while (start < h.length && !(h[start].role === 'user' && typeof h[start].content === 'string')) start++;
  return start < h.length ? h.slice(start) : h.slice(-2);
}

async function runChat(req, sub, userText, token) {
  const history = convos.get(sub) || [];
  history.push({ role: 'user', content: userText });

  for (let step = 0; step < 6; step++) {
    const { ok, status, data } = await callClaude(history);
    if (!ok) {
      record(req, { endpoint: 'chat-error', sub, status, body: JSON.stringify(data).slice(0, 300) });
      await sendChunk(sub, [{ type: 'text', text: "Sorry, I'm having a little hiccup 🤕 try again in a sec." }], token).catch(() => {});
      return;
    }
    history.push({ role: 'assistant', content: data.content });
    for (const block of data.content) {
      if (block.type === 'text' && block.text.trim()) {
        await sendChunk(sub, [{ type: 'text', text: block.text.trim() }], token).catch(() => {});
      }
    }
    const toolUses = data.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) break;
    const toolResults = [];
    for (const tu of toolUses) {
      let result;
      if (tu.name === 'search_inventory') result = { shoes: searchInventory(tu.input || {}) };
      else if (tu.name === 'send_photos') result = await sendShoePhotos(sub, (tu.input || {}).ids, token);
      else result = { error: 'unknown_tool' };
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    history.push({ role: 'user', content: toolResults });
  }
  convos.set(sub, trimHistory(history));
}

function handleChat(req, res) {
  const userText = extractQuery(req);
  const sub = getContactId(req);
  const token = getToken(req);
  record(req, { endpoint: 'chat', extractedQuery: userText, sub, hasToken: !!token, hasAI: !!process.env.ANTHROPIC_API_KEY });

  res.json({ ok: true }); // answer ManyChat instantly; do the AI work in the background

  if (!process.env.ANTHROPIC_API_KEY) { record(req, { endpoint: 'chat-skip', reason: 'no ANTHROPIC_API_KEY' }); return; }
  if (!token || !sub || !userText.trim()) return;

  const prev = chatLocks.get(sub) || Promise.resolve();
  const next = prev.then(() => runChat(req, sub, userText, token))
    .catch(e => record(req, { endpoint: 'chat-crash', sub, error: String(e).slice(0, 200) }));
  chatLocks.set(sub, next);
}
app.post('/chat', handleChat);
app.get('/chat', handleChat);
// Alias: the ManyChat flow points here (it was simplest to edit "send-photos" -> "send-chat").
app.post('/send-chat', handleChat);
app.get('/send-chat', handleChat);

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
