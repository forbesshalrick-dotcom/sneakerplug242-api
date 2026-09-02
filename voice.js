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
        begin_message: "Hello, good day. How can I help you?",
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
          for_who: { type: 'string', description: 'Say "womens" for a womens size.' },
        }, ['query', 'size']),
        tool('price_check', 'How much a shoe costs.', {
          query: { type: 'string', description: 'The shoe they named.' },
        }, ['query']),
        tool('shop_info', 'Delivery, island shipping, payment, how shoes fit, where we are, hours.', {
          topic: { type: 'string', description: 'What they asked about, in their own words.' },
        }, ['topic']),
        tool('take_message', 'ALWAYS call before the call ends if the caller wants anything. Sends it to the owner on WhatsApp.', {
          name: { type: 'string', description: 'Caller name.' },
          phone: { type: 'string', description: 'Their number, read back to them to confirm.' },
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
        const top = found.slice(0, 4);
        return {
          count: found.length,
          total_found: found.length,
          shoes: top.map(s => ({ name: s.name, price: spokenPrice(s.price), sizes: spokenSizes(s.sizes), color: s.color })),
          say: `${found.length === 1 ? 'I have one' : `I have ${found.length}`}. ${top.map(s => `${s.name}, ${spokenPrice(s.price)}, ${spokenSizes(s.sizes)}`).join('. ')}.`
             + ` The pictures are the part that sells it though — message this same number on WhatsApp and I will send them straight over.`,
        };
      }

      // "How much is the Air Max 97?" — price only, no size hunt.
      case 'price_check': {
        const found = searchInventory({ query: args.query || args.shoe || '' });
        if (!found.length) return { found: false, say: 'I cannot find that one. What colour was it?' };
        const prices = [...new Set(found.map(s => spokenPrice(s.price)))];
        return {
          found: true,
          say: prices.length === 1
            ? `That one is ${prices[0]}.`
            : `Those run from ${prices[0]} to ${prices[prices.length - 1]}, depending on the colour.`,
        };
      }

      // "You got it in a 10?" — a yes/no on one shoe in one size.
      case 'size_check': {
        const womens = /women|lady|ladies|female|girl/i.test(String(args.for_who || args.gender || ''));
        const raw = parseFloat(args.size);
        const size = womens ? toMens(raw) : raw;
        const found = searchInventory({ query: args.query || args.shoe || '', size: isNaN(size) ? undefined : size });
        if (found.length) {
          return { in_stock: true, say: `Yes, I have that in your size. ${found[0].name}, ${spokenPrice(found[0].price)}.` };
        }
        const anySize = searchInventory({ query: args.query || args.shoe || '' });
        if (anySize.length) {
          return {
            in_stock: false,
            say: `Not in that size, but I have it in ${spokenSizes(anySize[0].sizes, true)}. In Nassau the driver brings two sizes so you can try both at the door and keep the one that fits.`,
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
        const num = prettyPhone(args.phone || c.from);
        const want = String(args.what_they_want || args.message || '').trim();
        c.message = { who, num, want };
        const text = `📞 *PHONE CALL — ${c.line || 'shop line'}*\n`
                   + `👤 ${who}\n📱 ${num}\n`
                   + (want ? `👟 ${want}\n` : '')
                   + `\nKiki answered the call. They are waiting to hear back.`;
        try { await waSendManager(text); } catch (_) { /* the alert is logged either way */ }
        return { saved: true, say: `Got it. I have passed that straight to the owner and someone will reach out to you shortly.` };
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

NEVER LEAVE THE LINE SILENT
Silence makes people think the call dropped and hang up. So:
- While they are talking, make small sounds back — "mm-hm", "right", "ok", "I hear you".
- The MOMENT you go to look stock up, say out loud first: "1 min, let me check that for you".
  Say it BEFORE the tool, not after.
- If a lookup is taking a while, fill it: "still looking…", "bear with me one sec".
- If you are thinking, a small "uhm" or "so…" is better than nothing.
Never go more than about two seconds without a sound.

THE ONE THING A CALL IS FOR
Photos sell the shoes and you cannot send photos down a phone line. So your job is to answer
their question honestly, then move them to WhatsApp on this same number, or take a message.
Do not try to close a whole sale out loud.

WHAT YOU MUST NEVER DO
- Never invent a shoe, a price, or a size. If check_stock did not return it, we do not have it.
- Never promise a special order. We sell what is on the shelf.
- Never send a caller to friends, Google or reviews to work out their size. We bring two sizes.
- Never quote island shipping unless THEY say they are on another island. Plain "delivery"
  means Nassau, free, pay the driver at the door.
- Never take a card number, a bank detail or a password over the phone.

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

YOUR TOOLS
- check_stock — what we have. Pass brand, colour, shoe name and size if they gave any.
- size_check — they named one shoe and one size and want a yes or no.
- price_check — they only want the price.
- shop_info — delivery, islands, payment, fit, where we are, hours.
- take_message — ALWAYS call this before the call ends if they want anything at all. Get their
  name and confirm their number back to them.

OPENING
You answer the phone the way a person does, not the way a company does. Just:
"Hello, good day. How can I help you?"
Never open with a big welcome, never announce the shop name, never say "welcome to" anything.
If they ask who they reached, THEN tell them SNEAKERPLUG242 and that you are Kiki.

CLOSING
Confirm what happens next in one line, then: "Message this same number on WhatsApp and I'll
send you the pictures right now."`;

module.exports = {
  mountVoice, VOICE_PROMPT, VOICE_KEY, VOICE_LINES,
  VOICE_AGENT_CONFIG, TOOL_FILLERS, FILLERS_WHILE_LISTENING,
  spokenPrice, spokenSizes, toMens, prettyPhone,
};
