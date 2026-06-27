const express = require('express');
const cors = require('cors');
const catalog = require('./catalog.json');

const app = express();
app.use(cors());

// Accept the customer's text no matter how ManyChat (or anything else) sends it:
// JSON (application/json), form-encoded, and — for any other or missing
// Content-Type — a raw text/plain body. Each parser skips a request a previous
// one already handled, so text() only catches what json()/urlencoded() didn't.
const saveRaw = (req, res, buf) => { if (buf && buf.length) req.rawBody = buf.toString().trim(); };
app.use(express.json({ strict: false, verify: saveRaw }));
app.use(express.urlencoded({ extended: true, verify: saveRaw }));
app.use(express.text({ type: () => true, verify: saveRaw }));
// If JSON parsing fails (e.g. ManyChat sends raw text labelled as application/json),
// don't 500 — keep the raw string so extractQuery can still read it.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    req.body = (err.body !== undefined ? err.body : '');
    return next();
  }
  next(err);
});

const PORT = process.env.PORT || 3000;

// Pull the search text out of the request, however it arrived:
// query params (?q= / ?message=), a JSON/form field under any common name,
// a raw text/plain body, or — as a last resort — the first string value present.
function extractQuery(req) {
  const FIELDS = ['message', 'query', 'text', 'q', 'input', 'msg',
                  'last_text_input', 'lastTextInput', 'body', 'question'];

  if (req.query) {
    for (const k of FIELDS) {
      const v = req.query[k];
      if (v != null && String(v).trim()) return String(v);
    }
  }

  const b = req.body;
  if (b == null) return '';
  if (typeof b === 'string') return b;                 // raw text/plain body
  if (typeof b === 'object') {
    for (const k of FIELDS) {
      if (b[k] != null && String(b[k]).trim()) return String(b[k]);
    }
    // Fallback: ManyChat sent the text under some unexpected key — grab the
    // first non-empty string value in the object.
    for (const v of Object.values(b)) {
      if (typeof v === 'string' && v.trim()) return v;
    }
    // Keyless form post (body arrived as "jordan 4" with a form Content-Type,
    // so it parsed to { "jordan 4": "" }) — the text is the key itself.
    for (const k of Object.keys(b)) {
      if (!FIELDS.includes(k.toLowerCase()) && b[k] === '' && /[a-z]/i.test(k)) return k;
    }
  }
  // Last resort: the raw request body as it arrived, but ignore structural
  // JSON like "{}" / "[]" so an empty payload still gets the friendly greeting.
  if (req.rawBody && req.rawBody.trim() && !/^[\[{]/.test(req.rawBody.trim())) return req.rawBody;
  return '';
}

// ── Keyword scoring ───────────────────────────────────────────────────────────

function tokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function extractSize(tokens) {
  // A shoe size only counts when it's stated unambiguously, in one of two forms:
  //   1. Right after a size word:  "size 9", "sz 9.5", "in 10"
  //   2. A standalone half size:   "8.5", "9.5"  (no model number ends in .5)
  // A bare whole number like "4" or "11" is NOT treated as a size — those are
  // almost always model numbers ("Jordan 4", "Jordan 11"). Reading them as sizes
  // was filtering every real result out, so model searches returned nothing.
  const sizeWords = ['size', 'sz', 'in'];
  const fmt = n => String(n % 1 === 0 ? n : n.toFixed(1)).replace('.0', '');

  // 1. Number stated right after a size word (this wins over a standalone half size)
  for (let i = 0; i < tokens.length; i++) {
    if (sizeWords.includes(tokens[i]) && tokens[i + 1]) {
      const n = parseFloat(tokens[i + 1]);
      if (!isNaN(n) && n >= 3 && n <= 20) return fmt(n);
    }
  }
  // 2. Standalone half size, e.g. "9.5"
  for (const t of tokens) {
    if (/^\d{1,2}\.5$/.test(t)) {
      const n = parseFloat(t);
      if (n >= 3 && n <= 20) return fmt(n);
    }
  }
  return null;
}

// Brand-specific keywords that uniquely identify the brand (no shared words)
const BRAND_KEYWORDS = {
  'jordan':      ['jordan', 'aj', 'jumpman'],
  'nike':        ['nike'],
  'asics':       ['asics'],
  'new balance': ['newbalance', 'nb', 'balance', '1906', '9060', '1000', '550', '740'],
};

function scoreShoe(shoe, tokens, sizeFilter) {
  let score = 0;

  // Brand match — only fires on brand-specific words, never on shared words like "air"
  const brandKey = shoe.brand.toLowerCase();
  for (const [brand, keywords] of Object.entries(BRAND_KEYWORDS)) {
    if (brandKey.includes(brand)) {
      if (keywords.some(kw => tokens.includes(kw))) {
        score += 3;
      }
    }
  }

  // Model keywords in query → name
  const modelWords = tokenize(shoe.name);
  for (const mt of modelWords) {
    if (mt.length >= 3 && tokens.includes(mt)) score += 2;
  }

  // Nickname match (exact or partial)
  if (shoe.nickname) {
    const nickTokens = tokenize(shoe.nickname);
    for (const nt of nickTokens) {
      if (nt.length >= 3 && tokens.includes(nt)) score += 4;
    }
  }

  // Color match
  const colorTokens = tokenize(shoe.color);
  for (const ct of colorTokens) {
    if (ct.length >= 3 && tokens.includes(ct)) score += 2;
  }

  // Number match (model numbers like "4", "11", "95", "97", "270", "550", "740", "1906", "9060")
  const numericModelTokens = tokenize(shoe.name).filter(t => /^\d+$/.test(t));
  for (const nm of numericModelTokens) {
    if (tokens.includes(nm)) score += 3;
  }

  // Size filter: if a size was requested, only return shoes that have it
  if (sizeFilter !== null) {
    const hasSize = shoe.sizesRaw.some(s => {
      const sv = String(parseFloat(s));
      const fv = String(parseFloat(sizeFilter));
      return sv === fv;
    });
    if (!hasSize) return 0;
    score += 1;
  }

  return score;
}

function formatShoeMessage(shoe) {
  const unique = [...new Set(shoe.sizesRaw.map(s => parseFloat(s)))].sort((a,b)=>a-b);
  const sizeStr = unique.map(s => s % 1 === 0 ? String(s) : s.toFixed(1)).join(', ');
  const displayName = shoe.nickname
    ? `${shoe.name} (${shoe.nickname})`
    : shoe.name;

  return `👟 *${displayName}*\n🎨 ${shoe.color}\n💰 $${shoe.price}\n📏 Sizes: ${sizeStr}`;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', shoes: catalog.length });
});

app.post('/lookup', (req, res) => {
  const raw = extractQuery(req);
  if (!raw.trim()) {
    return res.json({
      found: false,
      count: 0,
      shoes: [],
      message: "Hi! Ask me what you're looking for. Example: *Do you have Jordan 4 in size 9?*",
    });
  }

  const tokens = tokenize(raw);
  const sizeFilter = extractSize(tokens);

  const scored = catalog
    .map(shoe => ({ shoe, score: scoreShoe(shoe, tokens, sizeFilter) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    const noResultMsg = sizeFilter
      ? `Sorry, I don't have anything in size *${sizeFilter}* matching that right now. I'll keep an eye out! 👀`
      : `Hmm, I don't have that in stock right now. DM me for special orders! 📲`;
    return res.json({
      found: false,
      count: 0,
      shoes: [],
      message: noResultMsg,
      image_1: null, image_2: null, image_3: null,
    });
  }

  const shoeList = scored.map(x => x.shoe);
  const lines = shoeList.map(formatShoeMessage);

  let message;
  if (shoeList.length === 1) {
    message = `Yes! Here's what I have:\n\n${lines[0]}`;
  } else {
    message = `Found ${shoeList.length} options:\n\n` + lines.join('\n\n');
  }

  // Flatten for ManyChat field mapping
  const response = {
    found: true,
    count: shoeList.length,
    message,
    shoes: shoeList.map(s => ({
      name: s.nickname ? `${s.name} (${s.nickname})` : s.name,
      brand: s.brand,
      color: s.color,
      price: `$${s.price}`,
      sizes: [...new Set(s.sizesRaw.map(x => parseFloat(x)))].sort((a,b)=>a-b).map(n => n%1===0?String(n):n.toFixed(1)).join(', '),
      image: s.image,
    })),
    // Top-level flattened fields for easy ManyChat mapping
    shoe_1_name:  shoeList[0] ? (shoeList[0].nickname ? `${shoeList[0].name} (${shoeList[0].nickname})` : shoeList[0].name) : '',
    shoe_1_price: shoeList[0] ? `$${shoeList[0].price}` : '',
    shoe_1_sizes: shoeList[0] ? ([...new Set(shoeList[0].sizesRaw.map(x=>parseFloat(x)))].sort((a,b)=>a-b).map(n=>n%1===0?String(n):n.toFixed(1)).join(', ')) : '',
    shoe_1_color: shoeList[0] ? shoeList[0].color : '',
    image_1: shoeList[0] ? shoeList[0].image : null,
    shoe_2_name:  shoeList[1] ? (shoeList[1].nickname ? `${shoeList[1].name} (${shoeList[1].nickname})` : shoeList[1].name) : '',
    shoe_2_price: shoeList[1] ? `$${shoeList[1].price}` : '',
    image_2: shoeList[1] ? shoeList[1].image : null,
    shoe_3_name:  shoeList[2] ? (shoeList[2].nickname ? `${shoeList[2].name} (${shoeList[2].nickname})` : shoeList[2].name) : '',
    shoe_3_price: shoeList[2] ? `$${shoeList[2].price}` : '',
    image_3: shoeList[2] ? shoeList[2].image : null,
  };

  res.json(response);
});

// GET version (useful for testing in browser)
app.get('/lookup', (req, res) => {
  const raw = extractQuery(req);
  if (!raw.trim()) return res.json({ found: false, message: 'Provide ?q=your+question' });

  const tokens = tokenize(raw);
  const sizeFilter = extractSize(tokens);
  const scored = catalog
    .map(shoe => ({ shoe, score: scoreShoe(shoe, tokens, sizeFilter) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return res.json({ found: false, count: 0, message: 'No matches found.' });

  res.json({
    found: true,
    count: scored.length,
    results: scored.map(x => ({
      name: x.shoe.name,
      nickname: x.shoe.nickname,
      color: x.shoe.color,
      price: x.shoe.price,
      sizes: x.shoe.sizes,
      image: x.shoe.image,
      score: x.score,
    })),
  });
});

app.listen(PORT, () => {
  console.log(`Sneaker lookup API running on port ${PORT}`);
  console.log(`${catalog.length} shoes loaded`);
});
