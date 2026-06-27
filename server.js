const express = require('express');
const cors = require('cors');
const catalog = require('./catalog.json');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Keyword scoring ───────────────────────────────────────────────────────────

function tokenize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function extractSize(tokens) {
  // Patterns: "size 8", "size 8.5", standalone "8", "8.5", "9.5"
  const sizeWords = ['size', 'sz', 'in'];
  for (let i = 0; i < tokens.length; i++) {
    if (sizeWords.includes(tokens[i]) && tokens[i + 1]) {
      const n = parseFloat(tokens[i + 1]);
      if (!isNaN(n) && n >= 3 && n <= 20) return String(n % 1 === 0 ? n : n.toFixed(1)).replace('.0','');
    }
    const n = parseFloat(tokens[i]);
    if (!isNaN(n) && n >= 3 && n <= 20 && String(n).replace('.0','') === tokens[i].replace(/\.0$/, '')) {
      return String(n % 1 === 0 ? n : n.toFixed(1)).replace('.0','');
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
  const raw = (req.body && (req.body.message || req.body.query || req.body.text)) || '';
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
  req.body = { message: req.query.q || '' };
  // Re-route to POST handler logic inline
  const raw = req.query.q || '';
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
