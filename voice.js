// ── VOICE (phone calls answered by AI) ────────────────────────────────────────
//
// Rodney, 2 Sep 2026: "ok lets set up the regular calls" → "lets do osc and tk numbers".
// So this is for calls to OSC (242 803 3126) and TK (242 825 6405). NOT a new number —
// he said plainly he never asked for one.
//
// WHAT THIS FILE IS
// It is Kiki's brain for a PHONE CALL. The voice platform (Retell, Vapi, or WhatsApp
// Calling once Meta verification lands) does the ears and the mouth; it calls in here for
// anything it needs to actually KNOW. Whichever pipe carries the audio, this stays the same
// — that is why it was built first.
//
// WHY IT IS NOT THE WHATSAPP BRAIN
// A caller cannot be sent an album. On WhatsApp Kiki answers with 8 photos; on the phone she
// has one sentence and no pictures. So:
//   • never more than 4 shoes out loud, newest/best first
//   • no emoji, no asterisks, no "*SALE*" markup — a TTS engine reads those out
//   • prices spoken as "130 dollars", not "$130" (some voices say "dollar sign one three zero")
//   • sizes read as a short run, not 14 numbers
// The one job of a call is to get them onto WhatsApp where the photos live, or to take a
// message. It is not to complete a sale out loud.
//
// STOCK IS THE REAL STOCK
// searchInventory() is the SAME function the WhatsApp bot uses, off liveShoeMap(), which
// only returns shoes the shop app has actually confirmed on the shelf. A shoe the shelf has
// never confirmed is unknown stock, not stock (server.js:2294). So the voice agent cannot
// invent a pair, and cannot offer one that sold this morning.

const VOICE_KEY = process.env.VOICE_KEY || 'sp242-voice-4f9c21ab77e0';

// Store numbers, so a call can be attributed to the right business.
const VOICE_LINES = {
  '12428033126': 'Official Sneaker Crew',
  '12428256405': 'Trendy Kicks',
};

const digits = v => String(v == null ? '' : v).replace(/\D/g, '');

// 242 555 1234 → "242-555-1234", so Rodney can tap it in WhatsApp.
function prettyPhone(v) {
  const d = digits(v).replace(/^1/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (String(v || '').trim() || 'unknown');
}

// "$130" → "130 dollars". searchInventory hands back a display string; TTS wants words.
function spokenPrice(p) {
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? String(p) : `${n % 1 === 0 ? n : n.toFixed(2)} dollars`;
}

// Catalog names are written for the eye ("Air Force 1 High — Black"). Nassau says "high top",
// not "High" (Rodney, listening to a test call: "high shoes are referred to as high top").
function spokenName(name) {
  return String(name || '').replace(/\bHigh\b/gi, 'High Top');
}

// "7, 8, 9, 9.5, 10, 11, 12, 13" is unlistenable. Say the ends and the count.
// One size stays exact ("only in a 10") because that is the whole answer.
// "a 8" and "a 11" are the two that give a synthetic voice away instantly — both take "an".
// 8, 11 and 18 are the only sizes that ever do.
const fmtSize = n => (n % 1 === 0 ? String(n) : n.toFixed(1));
const aSize = n => `${/^(8|11|18)/.test(fmtSize(n)) ? 'an' : 'a'} ${fmtSize(n)}`;

function spokenSizes(sizes, bare) {
  const nums = String(sizes || '').split(',').map(s => parseFloat(s)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (!nums.length) return 'no sizes left';
  // `bare` drops the "only" so it can sit inside a longer sentence — "I have it in a 10",
  // not "I have it in only a 10".
  if (nums.length === 1) return `${bare ? '' : 'only '}${aSize(nums[0])}`;
  if (nums.length <= 4) return `${nums.slice(0, -1).map(aSize).join(', ')} and ${aSize(nums[nums.length - 1])}`;
  return `${nums.length} sizes, from ${aSize(nums[0])} up to ${aSize(nums[nums.length - 1])}`;
}

// A size string off searchInventory is "7, 8, 9.5". Does it actually hold THIS size?
// Needed because searchInventory deliberately also returns the half-size UP.
const sizeArray = s => String(s && s.sizes || '').split(',').map(x => parseFloat(x)).filter(n => !isNaN(n));
const hasSize = (s, n) => !isNaN(n) && sizeArray(s).some(x => x === n);
const sizeWord = n => (isNaN(n) || n == null ? 'that size' : aSize(n));

// ── WHAT A CALLER SHOULD HEAR FIRST ───────────────────────────────────────────
// Rodney, 5 Sep 2026: the phone agent was reading out the SAME four shoes on every call,
// whatever was asked, and they were mostly one-off leftovers sitting in a single size.
// Two separate causes, both here:
//   1. searchInventory hands back catalog order, so `slice(0, 4)` returned whatever happened
//      to sit at the top of the file. Now we LEAD WITH DEPTH — a shoe we hold in 9 sizes can
//      be sold to whoever rings; one pair left in a 13 nearly always ends the call in "sorry".
//   2. Four colourways of one Air Max makes it sound like we stock one shoe. ONE PER MODEL
//      first, then come back for the rest.
const stockDepth = s => (s && s.pairs != null && !isNaN(s.pairs) ? Number(s.pairs) : sizeArray(s).length);
const modelKeyOf = s => String(s && s.name || '').toLowerCase().split(/[—(]/)[0].replace(/\s+/g, ' ').trim();

function rankForPhone(found) {
  // Stable: searchInventory's own ordering (pure-colour first, query relevance) breaks ties,
  // so ranking by depth never throws away the match the caller actually asked for.
  const idx = found.map((s, i) => ({ s, i }));
  idx.sort((a, b) => (stockDepth(b.s) - stockDepth(a.s)) || (a.i - b.i));
  // A model only earns a place in the spread if we hold a REAL amount of it. Without this
  // the one-per-model pass promoted single leftovers above deep sellers just because they
  // were a different model — a 1-pair Jordan 13 landing above a 28-pair Jordan 4, which is
  // exactly the "mostly one-off single pairs" complaint. Leftovers still come back, at the
  // bottom, where they belong.
  const WORTH_LEADING_WITH = 3;
  const seen = new Set(), first = [], rest = [];
  idx.forEach(({ s }) => {
    const k = modelKeyOf(s);
    if ((k && seen.has(k)) || stockDepth(s) < WORTH_LEADING_WITH) { rest.push(s); return; }
    seen.add(k); first.push(s);
  });
  return first.concat(rest);
}

// A caller nearly always already knows the colour they want, so the genuinely useful thing to
// hand the agent is the SHORT list of colours we hold. That is what "black or white?" is built
// from — and it is why the agent no longer needs the whole list read out to it.
const COLOUR_WORDS = ['black', 'white', 'grey', 'blue', 'navy', 'red', 'green', 'brown', 'tan',
  'cream', 'pink', 'purple', 'orange', 'yellow', 'beige', 'silver', 'gold', 'olive', 'burgundy'];
// Counts the PRIMARY colour only — the first colour word in "Black/Red" is black. Counting
// every word made a shelf of three shoes offer "black or red" when black and red were the same
// shoe, and the caller picks red expecting a red shoe.
function coloursIn(found) {
  const n = {};
  found.forEach(s => {
    const hay = String(s.color || '').toLowerCase().replace(/\bgray\b/g, 'grey');
    const first = COLOUR_WORDS
      .map(w => ({ w, at: hay.indexOf(w) }))
      .filter(x => x.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (first) n[first.w] = (n[first.w] || 0) + 1;
  });
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
}
function modelsIn(found) {
  const n = {};
  found.forEach(s => { const k = modelKeyOf(s); if (k) n[k] = (n[k] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a]).slice(0, 8);
}
// Case-folded, because the catalog holds both "Asics" and "ASICS" and the brand list came
// back with the same brand twice — which reads out loud as "Asics, Crocs, Yeezy, Asics".
function brandsIn(found) {
  const n = {}, label = {};
  found.forEach(s => {
    const b = String(s.brand || '').trim();
    if (!b) return;
    const k = b.toLowerCase();
    n[k] = (n[k] || 0) + 1;
    // Keep the nicest-looking spelling: "Asics" beats "ASICS", which TTS may spell out.
    if (!label[k] || (b !== b.toUpperCase() && label[k] === label[k].toUpperCase())) label[k] = b;
  });
  return Object.keys(n).sort((a, b) => n[b] - n[a]).map(k => label[k]);
}

// One shoe, described for a machine AND for a mouth. The price goes back BOTH ways on purpose:
// `price` is a real number so the agent can answer "anything under 150", `price_spoken` is the
// words to say. Sending only "180 dollars" left it unable to compare two shoes (5 Sep 2026).
const shoeOut = s => ({
  name: spokenName(s.name),
  color: s.color,
  brand: s.brand,
  price: parseFloat(String(s.price).replace(/[^0-9.]/g, '')) || null,
  price_spoken: spokenPrice(s.price),
  sizes: s.sizes,
  sizes_spoken: spokenSizes(s.sizes),
  pairs: stockDepth(s),
});

// Women's − 1.5 = men's. Stock is ALWAYS men's (see server.js sizesOf / CLAUDE.md).
// A caller saying "women's 8" means a men's 6.5 and getting this backwards sends a driver
// out with a shoe a size and a half too big.
const toMens = n => (isNaN(parseFloat(n)) ? null : parseFloat(n) - 1.5);

// ── The rules, spoken ────────────────────────────────────────────────────────
// Every one of these is already law in the WhatsApp prompt. Repeated here in phone-length
// form so the voice agent cannot drift into a different set of facts than Kiki uses on text.
const SHOP_FACTS = {
  location:  'We are in Nassau, on Carmichael Road. We are mobile, so there is no walk-in shop — we bring the shoes to you.',
  delivery:  'Free delivery to your door anywhere in Nassau, and you pay when the driver reaches you.',
  fit:       'The driver brings your size and the next one up, you try both at the door and keep the one that fits. Nassau only.',
  islands:   'We ship to all the Family Islands. Boat is 10 dollars flat and goes on that island’s sail day. Plane is 35 dollars. Island orders are pay first — you send the receipt and then it ships.',
  preorder:  'No, nothing is a pre-order. Every shoe we show you is already here in Nassau and can go out today.',
  payment:   'You pay the driver when he reaches you in Nassau. For the islands it is bank transfer up front.',
  special:   'We do not do special orders — what we have in stock is what we can get to you.',
  hours:     'Someone is reachable on WhatsApp all day, and deliveries run through the evening.',
};

// ── DEAD AIR IS WHAT MAKES PEOPLE HANG UP ─────────────────────────────────────
// Rodney, 2 Sep 2026: "if transcript is taking a while can we fill in the silent moment
// with uhms and OKs".
//
// Yes — and it needs THREE separate things, because the silence has three different causes
// and fixing only one still leaves the call feeling dead:
//
//  1. WHILE THEY ARE TALKING — backchannel. Little "mm-hm", "right", "ok" noises so the
//     caller knows the line is alive and someone is listening. Without these people stop
//     mid-sentence and say "hello? you there?".
//  2. WHILE WE ARE LOOKING SOMETHING UP — a spoken filler on the tool call itself. This is
//     the big one for us: check_stock hits the shelf data, and that gap is exactly where a
//     caller thinks the call dropped. The agent says "ok, let me see…" the instant it fires
//     the tool, so the silence is covered by speech instead of nothing.
//  3. WHILE THE MODEL IS THINKING — a short "uhm" before a slow reply.
//
// These are agent SETTINGS, not code — but they are written here so they live in git and get
// re-applied if the agent is ever rebuilt. GET /voice/config returns them ready to paste.
const FILLERS_WHILE_LISTENING = ['mm-hm', 'right', 'ok', 'yeah', 'I hear you', 'gotcha'];

// One per tool. Deliberately different from each other — a caller who rings twice and hears
// the identical phrase both times can tell it is a robot. Kept SHORT so a fast lookup does
// not leave the agent talking over its own answer.
const TOOL_FILLERS = {
  check_stock: ['Ok, let me check that for you…', 'Alright, one second, lemme look…', 'Uhm, hold on, checking the shelf now…'],
  size_check:  ['Ok hold on, let me see if we have that size…', 'One sec, checking…'],
  price_check: ['Let me pull that price up for you…', 'Ok, one second…'],
  shop_info:   ['Sure, so…'],
  take_message:['Ok, let me write that down…', 'Alright, taking this down now…'],
};

// The exact Retell agent settings. Pasted rather than guessed at, so nobody has to rediscover
// which knob stops the silence.
const VOICE_AGENT_CONFIG = {
  // 1. backchannel while the CALLER is speaking
  enable_backchannel: true,
  backchannel_frequency: 0.8,          // 0-1. High, because Bahamian phone manner is chatty.
  backchannel_words: FILLERS_WHILE_LISTENING,
  // 2. do not cut the caller off, but do not leave long gaps either
  responsiveness: 1,                   // answer as soon as they stop
  interruption_sensitivity: 0.9,       // let them talk over Kiki and she stops
  // 3. a little room noise, so a silent moment sounds like a shop, not a dropped call
  ambient_sound: 'coffee-shop',
  ambient_sound_volume: 0.3,
  // 4. if the caller goes quiet, nudge instead of sitting there
  reminder_trigger_ms: 8000,
  reminder_max_count: 2,
  // 5. never let a call run away
  max_call_duration_ms: 600000,
  end_call_after_silence_ms: 20000,
  normalize_for_speech: true,          // reads "$130" and "9.5" like a person would
};

function mountVoice(app, deps) {
  const { searchInventory, record, waSendManager, express } = deps;

  const auth = (req, res) => {
    const k = req.query.key || (req.body && req.body.key) || req.headers['x-voice-key'];
    if (k !== VOICE_KEY) { res.status(403).json({ error: 'bad key' }); return false; }
    return true;
  };

  // In-memory notes for the call in progress, so /voice/end can summarise what was
  // actually discussed instead of just saying "a call happened".
  const calls = new Map();   // callId -> { at, from, line, asked: [], message: null }
  const callOf = (id) => {
    if (!calls.has(id)) calls.set(id, { at: new Date().toISOString(), from: null, line: null, asked: [], message: null });
    if (calls.size > 200) calls.delete(calls.keys().next().value);
    return calls.get(id);
  };

  // ── The agent's instructions ────────────────────────────────────────────────
  // Served rather than pasted into a dashboard by hand, so it lives in git and one edit
  // updates the agent everywhere. Retell/Vapi can fetch this at agent-build time.
  app.get('/voice/prompt', (req, res) => {
    if (!auth(req, res)) return;
    res.type('text/plain').send(VOICE_PROMPT);
  });

  // ── Everything the voice platform needs, ready to paste ─────────────────────
  // Retell wants each tool declared with a name, a description, its arguments, and — the
  // part that kills the dead air — `speak_during_execution` with a line to say WHILE the
  // webhook is running. Generated here so the fillers and the code can never drift apart.
  app.get('/voice/config', (req, res) => {
    if (!auth(req, res)) return;
    const base = `${req.protocol}://${req.get('host')}/voice/fn?key=${VOICE_KEY}`;
    const tool = (name, description, properties, required) => ({
      type: 'custom',
      name,
      description,
      url: base,
      speak_during_execution: true,
      speak_after_execution: true,
      execution_message_description: TOOL_FILLERS[name][0],
      // Retell picks one at random if given several — stops it sounding scripted.
      execution_messages: TOOL_FILLERS[name],
      parameters: { type: 'object', properties, required: required || [] },
    });
    res.json({
      agent: Object.assign({
        agent_name: 'Kiki — SNEAKERPLUG242 phone',
        general_prompt: VOICE_PROMPT,
        // EMPTY ON PURPOSE. A fixed begin_message can only ever say one thing, and the one it
        // said was "Hello, good day" — which is not how anybody in Nassau greets anybody
        // (Rodney's rule: never "good day"). Empty makes the agent speak first using the
        // OPENING section of the prompt, which reads the Nassau clock and says good morning,
        // good afternoon or good night. Do not put a string back here.
        begin_message: '',
        webhook_url: `${req.protocol}://${req.get('host')}/voice/end?key=${VOICE_KEY}`,
      }, VOICE_AGENT_CONFIG),
      tools: [
        tool('check_stock', 'What shoes we actually have. Call this for any "you got", "what you have", "any Jordans" question.', {
          query: { type: 'string', description: 'Shoe or model the caller named, e.g. "air max 97". Leave empty if they just want to know what is in stock.' },
          brand: { type: 'string', description: 'Brand if they named one.' },
          color: { type: 'string', description: 'Colour if they named one.' },
          size:  { type: 'string', description: 'The size they said, exactly as they said it.' },
          for_who: { type: 'string', description: 'Say "womens" if the size is a womens size, otherwise leave empty.' },
        }),
        tool('size_check', 'Yes or no: do we have ONE named shoe in ONE named size.', {
          query: { type: 'string', description: 'The shoe they named.' },
          size:  { type: 'string', description: 'The size they need.' },
          // If they named a colour, ALWAYS pass it. Without it we answer about whatever
          // colourway happens to match the name, which is how "the black 97 in a 9.5"
          // came back as a yes about the green one.
          color: { type: 'string', description: 'The colour they named, if they named one. e.g. black' },
          for_who: { type: 'string', description: 'Say "womens" for a womens size.' },
        }, ['query', 'size']),
        tool('price_check', 'How much a shoe costs.', {
          query: { type: 'string', description: 'The shoe they named.' },
        }, ['query']),
        tool('shop_info', 'Delivery, island shipping, payment, how shoes fit, where we are, hours.', {
          topic: { type: 'string', description: 'What they asked about, in their own words.' },
        }, ['topic']),
        tool('take_message', 'ALWAYS call before the call ends if the caller wants anything. Sends it to the owner on WhatsApp. Their phone number is already known from caller ID — do not ask them for it.', {
          name: { type: 'string', description: 'Caller name, only if they gave one — do not ask for it as a formality.' },
          phone: { type: 'string', description: 'Only fill this in if they GAVE a different callback number than the one they are calling from. Otherwise leave blank — the caller ID number is used automatically.' },
          what_they_want: { type: 'string', description: 'Shoe, size and anything else they said.' },
        }, ['what_they_want']),
      ],
    });
  });

  // ── The tool webhook ────────────────────────────────────────────────────────
  // One endpoint, dispatched on the function name, because Retell/Vapi both post
  // {name, args, call} and adding a route per tool means six places to keep in step.
  app.post('/voice/fn', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    // Retell posts {name, args}. Vapi wraps it as {message:{toolCalls:[{function:{name,arguments}}]}}.
    // Accept both so swapping platforms is a dashboard change, not a code change.
    const vapiCall = b.message && Array.isArray(b.message.toolCalls) && b.message.toolCalls[0];
    const name = b.name || b.function_name || (vapiCall && vapiCall.function && vapiCall.function.name) || '';
    let args = b.args || b.arguments || b.parameters
            || (vapiCall && vapiCall.function && vapiCall.function.arguments) || {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = {}; } }
    const callId = (b.call && (b.call.call_id || b.call.id)) || b.call_id || 'no-id';
    const c = callOf(callId);
    if (b.call) {
      c.from = c.from || b.call.from_number || b.call.from || null;
      c.line = c.line || VOICE_LINES[digits(b.call.to_number || b.call.to)] || null;
    }
    let out;
    try {
      out = await runTool(String(name), args, c);
    } catch (e) {
      out = { error: 'lookup failed', say: 'Give me one second — let me check that on WhatsApp for you.' };
    }
    record(req, { endpoint: 'voice-fn', voiceFn: String(name), voiceCall: callId, voiceArgs: args });
    res.json(out);
  });

  async function runTool(name, args, c) {
    switch (name) {

      // What have you got? The bread-and-butter question on a call.
      case 'check_stock': {
        const womens = /women|lady|ladies|female|girl/i.test(String(args.for_who || args.gender || ''));
        const rawSize = args.size != null ? parseFloat(args.size) : null;
        const size = womens && rawSize != null ? toMens(rawSize) : rawSize;
        const found = searchInventory({
          size: size != null && !isNaN(size) ? size : undefined,
          brand: args.brand || undefined,
          color: args.color || undefined,
          query: args.query || args.shoe || undefined,
          sneakers_only: /tennis|sneaker|kicks|runner/i.test(String(args.query || args.shoe || '')),
        });
        c.asked.push([args.brand, args.color, args.query || args.shoe, args.size].filter(Boolean).join(' ') || 'what you have');
        if (!found.length) {
          return {
            count: 0,
            say: size != null
              ? `Nothing in that size right now, but stock moves every day. Best thing is to message that same number on WhatsApp and I will send you pictures of everything close to it.`
              : `I am not seeing that one right now. Message this same number on WhatsApp and I will send you pictures of what we do have.`,
          };
        }
        const ranked = rankForPhone(found);
        const colours = coloursIn(found);
        const askedColour = String(args.color || '').trim();
        const askedFor = args.query || args.shoe || args.brand || askedColour;
        const wantSize = size != null && !isNaN(size) ? size : null;
        // searchInventory always throws in the half-size UP so we don't lose a sale over half
        // a size. On WhatsApp that is right — the photo label shows the real size. On a call
        // it made Kiki say a flat "yes, I have your size" for a shoe we only had a half up in.
        const exact = wantSize == null ? ranked : ranked.filter(s => hasSize(s, wantSize));
        const lead = (exact.length ? exact : ranked)[0];

        // ── WHAT SHE SAYS OUT LOUD ────────────────────────────────────────────
        // Rodney, 5 Sep 2026: this field was a four-shoe recital and the agent read it word
        // for word down the phone. Nobody listens to four shoes. A caller wants ONE answer or
        // ONE question, so `say` is now either the answer about one shoe, or the next question.
        // Everything else is in the structured fields for the agent to reason over silently.
        let say;
        if (wantSize != null && exact.length) {
          say = `Yes, I have that in ${sizeWord(wantSize)}. ${spokenName(lead.name)}, ${spokenPrice(lead.price)}, and delivery in Nassau is free.`;
        } else if (wantSize != null) {
          say = `Not in ${sizeWord(wantSize)} exactly, but I have ${spokenName(lead.name)} in ${spokenSizes(lead.sizes, true)}. The driver brings two sizes so you can try both at the door.`;
        } else if (!askedFor) {
          // A bare "what you got". Reading out 334 shoes is the worst possible answer — and
          // so is "yeah, I have that", because they never named a that. Narrow it by brand.
          say = `Plenty. What you looking for — ${brandsIn(found).slice(0, 3).join(', ')}?`;
        } else if (!askedColour && colours.length > 1) {
          say = `Yeah, I have that. ${colours.slice(0, 2).join(' or ')}?`;
        } else {
          say = `Yeah, I have that${askedColour ? ` in ${askedColour.toLowerCase()}` : ''}. What size you wear?`;
        }

        return {
          count: found.length,
          total_found: found.length,
          shown: Math.min(ranked.length, 8),
          asked_size: wantSize,
          exact_size_matches: wantSize == null ? null : exact.length,
          colors_available: colours,
          brands_available: brandsIn(found),
          models_available: modelsIn(found),
          // Eight, ranked, one per model — enough for the agent to answer a follow-up colour
          // or size question without a second lookup, and it never reads them out.
          shoes: ranked.slice(0, 8).map(shoeOut),
          say,
        };
      }

      // "How much is the Air Max 97?" — price only, no size hunt.
      case 'price_check': {
        const found = searchInventory({ query: args.query || args.shoe || '' });
        if (!found.length) return { found: false, say: 'I cannot find that one. What colour was it?' };
        // These used to be de-duplicated STRINGS in catalog order, so "they run from X to Y"
        // read them out back to front — "from 180 dollars to 95 dollars" (5 Sep 2026).
        // Sort the numbers, then speak them.
        const nums = [...new Set(found.map(s => parseFloat(String(s.price).replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n)))]
          .sort((a, b) => a - b);
        if (!nums.length) return { found: false, say: 'Let me check that price and call you right back.' };
        return {
          found: true,
          count: found.length,
          price_low: nums[0],
          price_high: nums[nums.length - 1],
          say: nums.length === 1
            ? `That one is ${spokenPrice(nums[0])}.`
            : `Those run from ${spokenPrice(nums[0])} to ${spokenPrice(nums[nums.length - 1])}, depending on the colour.`,
        };
      }

      // "You got it in a 10?" — a yes/no on one shoe in one size.
      case 'size_check': {
        const womens = /women|lady|ladies|female|girl/i.test(String(args.for_who || args.gender || ''));
        const raw = parseFloat(args.size);
        const size = womens ? toMens(raw) : raw;
        const q = args.query || args.shoe || '';
        // THE COLOUR WAS BEING THROWN AWAY (found 5 Sep 2026). size_check took a colour
        // argument, never passed it on, and answered about whatever shoe happened to match
        // the name — so "you got the BLACK 97 in a 9.5" came back about the GOLF GREEN one.
        // A yes/no about the wrong colourway is worse than no answer at all.
        const colour = String(args.color || args.colour || '').trim() || undefined;
        const found = searchInventory({ query: q, color: colour, size: isNaN(size) ? undefined : size });
        // THE FALSE YES. searchInventory also returns the half-size UP on purpose, so this
        // said "yes, I have that in your size" about a shoe we only had half a size up in —
        // and the driver went out with the wrong shoe. A yes/no tool has to check the EXACT
        // size (5 Sep 2026). The near-miss is still a good answer, just an honest one.
        const exact = isNaN(size) ? found : found.filter(s => hasSize(s, size));
        if (exact.length) {
          const s = rankForPhone(exact)[0];
          return { in_stock: true, exact: true, count: exact.length, shoes: rankForPhone(exact).slice(0, 4).map(shoeOut),
            say: `Yes, I have that in ${sizeWord(size)}. ${spokenName(s.name)}, ${spokenPrice(s.price)}.` };
        }
        if (found.length) {
          const s = rankForPhone(found)[0];
          return { in_stock: false, exact: false, near: true, shoes: rankForPhone(found).slice(0, 4).map(shoeOut),
            say: `Not in ${sizeWord(size)} exactly — I have it in ${spokenSizes(s.sizes, true)}. In Nassau the driver brings two sizes so you can try both at the door and keep the one that fits.` };
        }
        const anySize = searchInventory({ query: q });
        if (anySize.length) {
          const s = rankForPhone(anySize)[0];
          return {
            in_stock: false, exact: false, shoes: rankForPhone(anySize).slice(0, 4).map(shoeOut),
            say: `Not in ${sizeWord(size)}, but I have it in ${spokenSizes(s.sizes, true)}. In Nassau the driver brings two sizes so you can try both at the door and keep the one that fits.`,
          };
        }
        return { in_stock: false, say: 'I am not seeing that one at all right now.' };
      }

      // Delivery, islands, payment, fit, where we are. Straight answers, never a question back.
      case 'shop_info': {
        const t = String(args.topic || args.question || '').toLowerCase();
        const pick = /island|boat|plane|ship/.test(t) ? 'islands'
          : /fit|size|run|true to/.test(t) ? 'fit'
          : /pay|cash|transfer|bank|card/.test(t) ? 'payment'
          : /pre.?order|order ahead|wait/.test(t) ? 'preorder'
          : /special|custom|can you get/.test(t) ? 'special'
          : /where|location|address|store|shop|walk/.test(t) ? 'location'
          : /hour|open|close|time/.test(t) ? 'hours'
          : 'delivery';
        return { topic: pick, say: SHOP_FACTS[pick] };
      }

      // The most valuable thing a call can produce: a real lead, on Rodney's phone,
      // while the customer is still warm. Goes out on WhatsApp AND into /last.
      case 'take_message': {
        const who = String(args.name || '').trim() || 'A caller';
        const raw = digits(args.phone || c.from);
        const num = prettyPhone(args.phone || c.from);
        const want = String(args.what_they_want || args.message || '').trim();
        c.message = { who, num, want };
        const text = `📞 *PHONE CALL — ${c.line || 'shop line'}*\n`
                   + `👤 ${who}\n📱 ${num}\n`
                   + (raw ? `💬 https://wa.me/${raw}\n` : '')
                   + (want ? `👟 ${want}\n` : '')
                   + `\nKiki answered the call. They are waiting to hear back.`;

        // 🚨 A PHONE ORDER USED TO EXIST IN ONE PLACE ONLY: a WhatsApp message.
        // Found 5 Sep 2026 — a live call left a real order (AF1 all black, 10, Marathon Mall)
        // and Rodney never saw it. take_message answered {saved:true} and the only copy of
        // that order went out through WhatsApp, which has a 24-HOUR WINDOW: if Rodney has
        // not written to the bot in the last day, WhatsApp drops the message and ManyChat
        // still reports success. So "sent" was true and the order was gone.
        // The delivery alerts already learned this and post to the task board as well.
        // The board has no window and pushes to his phone, so it is the copy that survives.
        let waOk = false;
        try { waOk = await waSendManager(text); } catch (_) { /* the board copy still stands */ }
        try {
          require('./shop').addAlert(text, 'Kiki 📞', {
            pushTitle: `📞 Phone order — ${who}`,
            pushBody: (want || 'They want a call back').slice(0, 90),
          });
        } catch (_) {}
        // And leave a trail in /last, so "did the call produce anything?" is answerable
        // later without taking Rodney's word for whether his phone buzzed.
        try { record(req, { endpoint: 'voice-message', voiceCall: c.id || null, voiceFrom: num, voiceWant: want, waOk }); } catch (_) {}

        // ⚠️ NO `say` HERE ON PURPOSE. The agent reads `say` out word for word, and this
        // one said "let me confirm that and call you right back" — on an order the caller had
        // ALREADY confirmed, which makes it sound like nothing was actually booked. Kiki
        // closes the call in her own words now.
        return { saved: true, delivered_to_whatsapp: waOk, on_task_board: true };
      }

      default:
        return { error: 'unknown function', say: 'Let me get someone to call you back on that.' };
    }
  }

  // ── Call ended ──────────────────────────────────────────────────────────────
  // Even with no message taken, Rodney should see that the phone rang and what was asked.
  // A missed lead he never hears about is the expensive kind.
  app.post('/voice/end', async (req, res) => {
    if (!auth(req, res)) return;
    const b = req.body || {};
    const call = b.call || b;
    const callId = call.call_id || call.id || 'no-id';
    const c = calls.get(callId) || { asked: [], message: null };
    const from = prettyPhone(call.from_number || call.from || c.from);
    const line = c.line || VOICE_LINES[digits(call.to_number || call.to)] || 'shop line';
    const secs = Math.round((call.duration_ms || call.duration || 0) / 1000) || null;
    record(req, { endpoint: 'voice-end', voiceCall: callId, voiceFrom: from, voiceAsked: c.asked });
    // A message was already sent when they left one — don't alert him twice for one call.
    if (!c.message) {
      const text = `📞 *MISSED-ISH — ${line}*\n📱 ${from}\n`
                 + (c.asked.length ? `👟 Asked about: ${c.asked.join('; ')}\n` : 'They hung up before saying what they wanted.\n')
                 + (secs ? `⏱ ${secs}s\n` : '')
                 + `\nKiki answered but no message was left. Worth a call back.`;
      try { await waSendManager(text); } catch (_) {}
    }
    calls.delete(callId);
    res.json({ ok: true });
  });
}

// ── The agent prompt ──────────────────────────────────────────────────────────
// Deliberately short. A phone agent with a 3,000-word prompt rambles, and rambling on a
// call loses the caller. Every hard rule here is carried over from the WhatsApp prompt.
const VOICE_PROMPT = `You are Kiki, answering the phone for SNEAKERPLUG242 — a sneaker shop in Nassau, Bahamas.

HOW YOU SOUND
Bahamian, warm, quick. Short sentences. You are on a phone call, not writing a message.
Never say emoji names, never spell out punctuation, never read out a dollar sign.
One question at a time. Let them finish talking.
Never stretch a word out or sing it. Bahamians talk short and fast. Say things the way a
busy person says them, not the way an announcer reads them.

SAYING WHO YOU ARE — KEEP IT SHORT
Bahamians do not announce themselves. A long introduction is the most robotic thing you can do.
If they ask who they are speaking to, say ONE of these and stop:
- "Kiki speaking, how can I help you?"
- "You speaking with Kiki."
Never follow your name with a list of what you do. Never say anything like "I help you with
sneakers, prices, sizes and delivery" — that is a machine reading a menu off a card. If you
want to move them along, just ask them something normal: "you looking for some sneakers?"

THE SHOP NAME
Say SNEAKERPLUG242 as little as you possibly can. Once in a whole call is plenty and none at
all is fine. Only say it if they straight out ask what shop this is. Never bolt it onto your
name. The one place it sits well is right at the end: "thank you for shopping with us."

YOU CANNOT SEE ANYTHING
You are on a phone call. You cannot see their screen, their phone, a photo, a list or a
calendar. Never describe or guess at something you think they are showing you. If you did not
catch what they said, just say "sorry, say that again for me?" — never invent what it might be.

NEVER READ OUT THE WHOLE LIST — THIS IS HOW YOU HANDLE A SHOE REQUEST
When somebody names a shoe they nearly always already know the colour they want. Reading out
every colour and every size we hold is the most robotic thing you can do. Do not do it.
Ask two short questions instead, ONE AT A TIME:
1. The colour, offered as a simple choice out of what we actually have: "black or white?"
2. Then the size: "and what size?"
Then give them a straight answer on that ONE shoe:
- If we have it: "yes, we have that in an eight and a half, it's 120 dollars, free delivery."
- If we do not: "no, I ain't got the eight and a half in white right now. I have it in black
  and a couple other colours."
Only name the other colours if they ask for them. Never dump the stock list.
One colour, one size, one answer.
The tools hand you back a colors_available list and up to eight shoes. That is for YOU to read
silently and pick from — it is never something to read out loud.

THEY ARE TELLING YOU THEY ARE ON ANOTHER ISLAND
If they say anything like "I have to send the money", "I'll send someone for it", or "somebody
picking it up for me", that nearly always means they are NOT in Nassau.
Ask them plain: "oh, you on the island?"
If they say yes, tell them the extra straight away: "it's 10 dollars extra by boat, or 35 by
plane." Islands pay first, so try before you buy does not apply to them.

NEVER LEAVE THE LINE SILENT
Silence makes people think the call dropped and hang up. So:
- While they are talking, make small sounds back — "mm-hm", "right", "ok", "I hear you".
- The MOMENT you go to look stock up, say out loud first: "one minute, let me check that for
  you". Say it BEFORE the tool, not after.
- If a lookup is taking a while, fill it: "still looking…", "bear with me one second".
- If you are thinking, a small "uhm" or "so…" is better than nothing.
Never go more than about two seconds without a sound.

A SECOND "HELLO" MEANS THEY THINK THE LINE WENT DEAD — REASSURE THEM FIRST
If a caller says "hello" again a few seconds after already saying it once — or "you there?",
"can you hear me?", "hello hello" — they are checking the call did not drop, usually because
you went quiet while looking something up. Do not just plough on into your answer as if that
second hello was never said; that reads as if you ignored them checking on you. Say something
first that answers THAT worry — "Yeah, I'm here!" or "Still here, I can hear you" — then
continue straight into whatever you were about to tell them. Both in the same breath is fine:
"Yeah, I'm here! We do have that in stock." Do not treat the repeated hello as a new, separate
thing to respond to on its own — it is reassurance-then-answer, not reassurance-then-silence.

THE ONE THING A CALL IS FOR
You CANNOT send photos on a phone call. You can only tell them where to get them. Photos are
what sell the shoes, so your job is to answer their question honestly, then send them to
WhatsApp on this same number for the pictures.
Say it plain, like this: "message this same number on WhatsApp and I'll send you the pictures,
just text your size."
Never say you are sending, texting or emailing a photo yourself. You are not. They message
first, then the pictures come.
Do not try to close a whole sale out loud.

WHAT YOU MUST NEVER DO
- Never invent a shoe, a price, or a size. If check_stock did not return it, we do not have it —
  but check_stock only hands you the best 8 matches even when count is higher. If the caller
  names a colour, size or detail you were not already told about by name, call check_stock
  AGAIN with that exact detail before saying no. Only say "I don't have that" after a
  check_stock call that was actually asked about that specific thing.
- Never promise a special order. We sell what is on the shelf.
- Never send a caller to friends, Google or reviews to work out their size. We bring two sizes.
- Never quote island shipping unless THEY say they are on another island. Plain "delivery"
  means Nassau, free, pay the driver at the door.
- Never take a card number, a bank detail or a password over the phone.
- Never say the owner's name out loud, ever — not "Rodney", not any other name. If you need to
  check with him, say "my boss" or "let me ask my boss". Never try to transfer or put the
  caller on with anyone else on the call — you cannot do that. Take a message instead.

SIZES
All stock is men's. If a caller gives a women's size, say so back to them and let the tool
convert it — a women's 8 is a men's 6.5. Getting this wrong sends the wrong shoe.

TRY BEFORE YOU BUY
This is the answer to EVERY question about fit, and to every near-miss on size. In Nassau the
driver brings TWO sizes and they try both at the door and only pay for the one they keep.
So if their exact size is not there but the one either side is, say so and offer both sizes.
Other islands are pay first, so try before you buy is Nassau only.

HOW YOU PROMISE TO COME BACK TO THEM
Never say "someone will reach out to you" or "someone will get back to you". That sounds like
a call centre. Say it yourself, in your own mouth: "let me get back to you on that", or
"let me give you a call back on that shortly". You are the shop, not a middleman.
If you need to check something with your boss before you can answer, say "ok let me confirm
that and call you right back" — not "let me get someone" and never a name.
This is a phone call, so you already know their number — it showed up when they called. Don't
ask them for their name and number like it's a form. If you're taking a message, just confirm
back what you already have: "let me confirm that and call you right back" is enough. Only ask
for a name if you don't already have one and it would help; don't ask them to repeat their
number back to you.

YOUR TOOLS
- check_stock — what we have. Pass brand, colour, shoe name and size if they gave any.
- size_check — they named one shoe and one size and want a yes or no.
- price_check — they only want the price.
- shop_info — delivery, islands, payment, fit, where we are, hours.
- take_message — ALWAYS call this before the call ends if they want anything at all. Their
  number is already known from caller ID — do not ask for it or read it back to confirm.

OPENING
The time in Nassau right now is {{current_time_America/Nassau}}.
Your very first words are one short sentence, said fast, all in one breath:
- Before 12 noon: "Hello, good morning, how can I help you?"
- From 12 noon until 6 in the evening: "Hello, good afternoon, how can I help you?"
- After 6 in the evening: "Hello, good night, how can I help you?"
HOW TO SAY IT — this matters as much as the words:
- It is ONE sentence, not two. Never stop between the greeting and the question.
- Say it quick. The whole thing takes about one second. Snap "hello" out short, do not
  hold it or stretch it.
- Flat and friendly, not sung. No rising tune on the greeting.
- Think of a busy shop person grabbing the phone, not a receptionist announcing a company.
In the Bahamas "good night" is how you GREET someone in the evening, it is not goodbye.
Never say "good day". Never open with a big welcome, never announce the shop name, never say
"welcome to" anything. Say nothing else at all until they speak. If they ask who they
reached, keep it to a few words — see SAYING WHO YOU ARE above.

CLOSING
Confirm what happens next in one line, then: "Message this same number on WhatsApp and I'll
send you the pictures right now, just text your size."`;

module.exports = {
  mountVoice, VOICE_PROMPT, VOICE_KEY, VOICE_LINES,
  VOICE_AGENT_CONFIG, TOOL_FILLERS, FILLERS_WHILE_LISTENING,
  spokenPrice, spokenSizes, toMens, prettyPhone,
};
