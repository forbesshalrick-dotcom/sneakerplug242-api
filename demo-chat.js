/* ============================================================================
   /demo-chat — the brain behind the agency preview bots.

   The preview sites used to run a lookup table: scan the customer's message for
   keywords, paste back a canned paragraph. That is why asking "how much is the
   deposit?" returned the whole insurance speech, and asking twice returned it
   word for word a second time. It was never reading the question.

   This endpoint puts the same model behind those bots that Kiki uses on the
   real store. It reads the message, remembers what it already said, answers in
   its own words, and hands back a finished quote when the order is done.

   Two things are deliberate:

   1. The business facts live HERE, not in the browser. If the page could post
      its own instructions, anyone could point this endpoint at whatever they
      wanted and spend Rodney's Anthropic credit on it. The page sends a demo
      name from a fixed list; the server owns the rest.

   2. Every limit is a hard stop, not a warning — per-visitor, per-day, and a
      short answer length. When a limit is hit the widget quietly falls back to
      the old rule engine, so a demo never dies in front of a client.
   ============================================================================ */

'use strict';

const { HOUSE_RULES } = require('./bot-core');
const { search, byIds } = require('./demo-catalogue');

const API = 'https://api.anthropic.com/v1/messages';

/* Sonnet is the default because these demos ARE the sales pitch — a flat reply
   costs more than the tokens do. A whole conversation lands well under a cent.
   Set DEMO_AI_MODEL=claude-haiku-4-5 on Railway to halve that if it ever bites. */
const MODEL = process.env.DEMO_AI_MODEL || 'claude-sonnet-5';

const MAX_TURNS      = Number(process.env.DEMO_MAX_TURNS)   || 40;    // messages kept per conversation
const MAX_CHARS      = Number(process.env.DEMO_MAX_CHARS)   || 500;   // per customer message
const PER_IP_MSGS    = Number(process.env.DEMO_PER_IP)      || 40;    // per visitor
const PER_IP_WINDOW  = Number(process.env.DEMO_IP_WINDOW)   || 15 * 60 * 1000;
const DAILY_CAP      = Number(process.env.DEMO_DAILY_CAP)   || 1200;  // replies per day, whole site

/* ── the businesses ─────────────────────────────────────────────────────────
   Each block is the whole world the bot is allowed to know. Prices and rules
   match what is printed on the demo page, so the bot never quotes a number the
   customer cannot see for themselves. */

const SHOPS = {

  'car-rental': {
    name: 'Out Island Auto',
    who: 'a car rental company in Nassau, Bahamas',
    facts: `
FLEET — daily rate, all automatic unless noted:
  Nissan March   B$50   5 seats, small, cheap on gas, easy to park downtown
  Honda Fit      B$55   5 seats, surprising boot space, our most-booked car
  Toyota Corolla B$65   5 seats, full size, comfortable for a week of driving
  Jeep Wrangler  B$95   4x4, soft top, 4 seats, built for back roads and beach
  Crew pickup    B$110  5 seats and a tray, for contractors, movers, boat runs

COLLECTION: airport (LPIA) B$15 · your hotel B$20 · our downtown office free.
EXTRAS, all per day: full insurance B$18 · child seat B$8 · extra driver B$10 · GPS B$5.
DEPOSIT: a B$200 refundable hold goes on the card at collection. That is the deposit —
  it is not the insurance, and it comes back.
INSURANCE: basic cover is included in the rate. Full insurance is B$18 a day and drops
  the excess to zero.
FUEL: full to full, nothing to pay if it comes back the way it left.
MILEAGE: unlimited on every vehicle, no catch.
LICENCE: a home licence is fine up to three months; we photograph it at collection.
AGE: 21 and over. Under 25 there is a B$10 a day young-driver surcharge.
ISLANDS: vehicles stay on New Providence. Going to another island — we arrange a car
  waiting at the other end.
HOURS: seven till nine daily, and we meet late flights by arrangement with a flight number.
ROADSIDE: 24 hour, included.`,
    voice: 'Straight and practical, like the guy at the counter who wants you on the road in ten minutes. Short sentences. No flourish. He knows the cars.',
    needs: 'vehicle, how many days, where they are collecting from, any extras, and the start date',
    quoteTitle: 'Booking quote'
  },

  bfc: {
    name: 'BFC — Bahamas Fried Chicken',
    who: 'a fast food chicken shop in Nassau, Bahamas',
    facts: `
COMBOS — every one comes with a side and a drink:
  1  The Two-Piece    B$9.50
  2  Family Bucket    B$34.00   feeds about four
  3  The Sunday Plate B$14.00
  4  Crispy Sandwich  B$11.00
  5  Sticky Wings     B$13.50
  6  Loaded Fries     B$8.50
  7  Wing Party       B$29.00   feeds about eight
  8  Lil Chick        B$6.50    kids meal

SIDES — one per combo is included: fries (free) · peas n rice (free) · coleslaw (free)
  · mac n cheese +B$1.50 · fried plantain +B$1.00
EXTRAS: extra side B$3 · extra biscuit B$1.50 · hot sauce B$0.50 · upsize the drink B$2
DELIVERY: B$6 anywhere on the mainland, 35–45 minutes. Collection free, about 12 minutes.
BRANCHES: Carmichael · Mackey Street · Cable Beach · Marathon · Prince Charles · JFK
HOURS: open till 2am, seven days. Last order about ten minutes before close.
PAYMENT: cash on collection, or bank transfer.
HEAT: mild or spicy on any chicken. Wings come BBQ or jerk.
VEGETARIAN: it is a chicken shop — loaded fries can go without the chicken, and the
  sides stand on their own.
BIG ORDERS: over about eight people, take the headcount and pass it to a person.`,
    voice: "Fast, friendly, island. Slang is fine — 'bout, lemme, y'all. An emoji here and there. You are shouting over a fryer, so keep it tight.",
    needs: 'which combos and how many, the side for each, any extras, pickup or delivery, then the branch or the address',
    quoteTitle: 'Your order'
  },

  restaurant: {
    name: 'Blue Hole',
    who: 'a fine-dining restaurant on the western shore of New Providence, Bahamas',
    facts: `
THE MENU: one tasting menu, seven courses, written each morning around whatever came
  off the boat. B$185 a head.
TONIGHT'S BOARD: snapper crudo B$38 · hand-rolled pasta B$46 · aged beef B$64 ·
  dark chocolate B$18. (Those are the collection prices; at a table it is the set menu.)
PAIRINGS, per head: wine B$95 · non-alcoholic B$55 · none B$0. Corkage B$60 a bottle.
SEATING: one seating a night at seven, Tuesday through Saturday. Closed Sunday, Monday.
  The terrace holds 26.
COLLECTION: from the kitchen door at 6:30, 8:00 or 9:30 pm.
DIET: tell the kitchen at booking — shellfish, nut, vegetarian, no pork, gluten free.
  They would rather know now than at the table.
DRESS: smart-casual. No jacket needed, it is a terrace over the water.
PARKING: on site, valet from six.
CHILDREN: over twelve in the dining room. Under twelve, suggest the collection menu.
WHERE: western shore, about twenty minutes from town. A pin goes out once booked.`,
    voice: 'Composed and understated. Precise, never gushing. No slang, no pet names, no exclamation marks, at most one emoji in a whole conversation. You are the person who runs a very good dining room and does not need to sell it.',
    needs: 'a table or collection; for a table the number of guests, the night, the pairing, any dietary notes and a name; for collection the dishes, the time and a name',
    quoteTitle: 'Reservation'
  },

  salon: {
    name: 'Verandah House',
    who: 'a spa and salon in Nassau, Bahamas',
    facts: `
HAIR:            cut & finish B$95 (60m) · colour & gloss B$180 (2h30) ·
                 keratin smoothing B$260 (3h30) · knotless braiding B$200 (5h)
SKIN:            signature facial B$140 (75m) · dermaplane B$120 (45m) ·
                 LED light therapy B$90 (30m) · chemical peel B$165 (60m)
MASSAGE & BODY:  Swedish 60 B$130 · deep tissue 90 B$190 · hot stone 90 B$210 ·
                 prenatal 60 B$140 · reflexology 45 B$95
RITUALS:         half-day retreat B$420 (4h) · couples ritual B$560 (2h30) ·
                 bridal morning B$380 (3h)
ADD-ONS: scalp treatment B$40 · foot ritual B$45 · aromatherapy upgrade B$25 ·
  extra 30 minutes B$60
THERAPISTS: Keva, Renée, Tanya, or whoever is free.
APPOINTMENT TIMES are 9:00am, 11:30am, 2:00pm and 4:30pm. Which of those are actually
  free is in the diary at the end of this brief — never guess from this list.
HOURS: Tuesday to Saturday nine till six, late Thursdays till eight. Closed Sunday, Monday.
DEPOSIT: 25% holds the room and comes off the final bill. Card, cash or transfer on the day.
CANCELLING: free up to 24 hours before; inside that the deposit moves to another day.
WALK-INS: taken when there is a gap, but the rooms are usually booked.
PRENATAL: side-lying, 60 minutes, B$140 — tell the therapist how far along.
MEN: welcome; about a third of massage, skin and barbering is men.
VOUCHERS: any amount or any treatment, no expiry.
PARKING: in the yard behind the house, through the side gate.`,
    voice: 'Calm and unhurried, the way the room feels. Gentle, never rushed, never pushy. A little warmth, no gushing.',
    needs: 'which treatment, any add-ons, which therapist, and the day and time',
    quoteTitle: 'Your appointment'
  },

  estate: {
    name: 'Fitzwilliam & Cay',
    who: 'a private real estate brokerage handling luxury Bahamian island property',
    facts: `
PORTFOLIO: eleven properties. Several are not published anywhere and dossiers are
  released under NDA only.
LEVELS we work at: up to B$5m · B$5m–10m · B$10m–20m · above B$20m.
ISLANDS: Exuma, Harbour Island, Eleuthera, private cays.
FEES: the seller pays our commission, so there is no fee to a buyer. Government stamp
  duty and legal costs are separate and set out in writing before anything is signed.
FINANCING: local and international banks lend, typically 60–70% for non-residents.
  We introduce two we work with regularly.
RESIDENCY: a purchase above B$750,000 supports a permanent residency application. We put
  the client with a Bahamian attorney early — not something to handle informally.
VIEWINGS: arranged privately, usually within a week. Several can be grouped into one
  visit, and there is a boat for the cays.
RENTAL INCOME: most of the portfolio rents at high season. Actual figures are shared
  under NDA rather than estimated.
PROCESS: introduction, viewings, then an offer through the buyer's attorney. Title,
  permits and Crown land questions are handled in-house.
REACH US: four people in the office, somebody answers until nine, seven days.
  A partner replies personally within four business hours.
TONE: this is a discreet brokerage. Never pushy, never salesy. Short, precise sentences.`,
    voice: 'Discreet and exact. Short sentences. Never salesy, never enthusiastic, no emoji at all. You are a broker whose clients value silence. If something needs an attorney, say so.',
    needs: 'whether it is a residence, an investment or a private island; the level; the island; how much space; the timeframe; how they would like the introduction; and a name',
    quoteTitle: 'Your brief'
  },

  'print-shop': {
    name: 'Press 242',
    who: 'a t-shirt printing shop on Mackey Street, Nassau, Bahamas',
    facts: `
PRICE PER SHIRT drops with quantity: 1–9 B$22 · 10–24 B$18 · 25–49 B$15 · 50+ B$12.
  No minimum — one shirt is fine.
EXTRA PRINTED SIDES: B$4 per side per shirt (front, back, left sleeve, right sleeve).
TURNAROUND: standard five working days. Rush is 48 hours for 25% on top.
SIZES: small, medium, large, XL, 2XL, 3XL, plus kids and a women's cut. Mix sizes across
  the run at no extra cost. Always talk sizes in clothing words — small, medium, large —
  never in numbers.
ARTWORK: send a PNG, PDF or vector and we set it up free. Or build it on the page — the
  designer above does front, back and both sleeves.
INK: up to four colours in the price on screen printing. Full-colour photo prints go DTG,
  same money at these quantities.
PROOF: always. A digital proof goes out and nothing hits a shirt until it is approved.
DELIVERY: collection from the shop on Mackey Street, or anywhere on the island for B$8.
OTHER GARMENTS: hoodies, polos, caps and totes print the same way.`,
    voice: 'A maker who talks in quantities and turnaround. Practical, no fuss, gives you the number and the date. Friendly but busy.',
    needs: 'how many shirts, which sizes, what is going on the shirt and on how many sides, and how fast they need them',
    quoteTitle: 'Print quote'
  }
};

/* ── the clock and the diary ────────────────────────────────────────────────
   A bot with no clock cannot answer "are you available now?" — it can only
   change the subject, and changing the subject is what makes a bot sound like
   a bot. So every request carries the real Nassau date and time, whether the
   place is open at this minute, and a diary of what is genuinely free.

   The diary is invented, but it is invented the SAME WAY every time for a
   given day, so the bot never contradicts itself inside a conversation and
   two people looking at the demo on the same afternoon see the same thing. */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* index 0 = Sunday. [openHour, closeHour]; a close past 24 means after midnight. */
const CLOCK = {
  'car-rental': { hours: [[7,21],[7,21],[7,21],[7,21],[7,21],[7,21],[7,21]] },
  bfc:          { hours: [[10,26],[10,26],[10,26],[10,26],[10,26],[10,26],[10,26]] },
  restaurant:   { hours: [null,null,[10,22],[10,22],[10,22],[10,22],[10,22]] },
  salon:        { hours: [null,null,[9,18],[9,18],[9,20],[9,18],[9,18]],
                  slots: ['9:00 am', '11:30 am', '2:00 pm', '4:30 pm'] },
  estate:       { hours: [[8,21],[8,21],[8,21],[8,21],[8,21],[8,21],[8,21]] },
  'print-shop': { hours: [null,[9,17],[9,17],[9,17],[9,17],[9,17],[9,13]] }
};

function nassau() {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Nassau', weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
  }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  const h24 = new Date().toLocaleString('en-US', { timeZone: 'America/Nassau', hour: '2-digit', hour12: false });
  return {
    dow: DAYS.indexOf(p.weekday),
    weekday: p.weekday,
    date: `${p.weekday} ${p.day} ${p.month} ${p.year}`,
    time: `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`,
    hour: parseInt(h24, 10) || 0
  };
}

/* stable pseudo-random, so the same day always yields the same diary */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

function hhmm(h) {
  const x = h % 24;
  const ap = x < 12 ? 'am' : 'pm';
  const t = x % 12 === 0 ? 12 : x % 12;
  return `${t}${ap}`;
}

function liveBlock(key, shop) {
  const c = CLOCK[key];
  const n = nassau();
  const today = c.hours[n.dow];
  const open = !!today && n.hour >= today[0] && n.hour < today[1];

  const out = [
    `RIGHT NOW it is ${n.time} on ${n.date} in Nassau.`,
    open
      ? `You ARE open right now — today ${hhmm(today[0])} to ${hhmm(today[1])}.`
      : today
        ? `You are CLOSED at this minute. Today's hours are ${hhmm(today[0])} to ${hhmm(today[1])}.`
        : `You are CLOSED today — ${n.weekday} is not a working day.`
  ];

  /* the next day the doors are actually open */
  if (!open) {
    for (let i = 1; i <= 7; i++) {
      const d = (n.dow + i) % 7;
      if (c.hours[d]) { out.push(`Next open: ${DAYS[d]} from ${hhmm(c.hours[d][0])}.`); break; }
    }
  }

  /* what is genuinely free — this is the difference between "let me check"
     and an answer */
  if (key === 'salon') {
    const lines = [];
    for (let i = 0; i < 7 && lines.length < 5; i++) {
      const d = (n.dow + i) % 7;
      if (!c.hours[d]) continue;
      const free = c.slots.filter(s => {
        if (i === 0 && parseInt(s, 10) + (/pm/.test(s) && parseInt(s, 10) !== 12 ? 12 : 0) <= n.hour) return false;
        return seeded(key + n.date + DAYS[d] + s + i) > 0.42;
      });
      lines.push(`  ${i === 0 ? 'Today' : DAYS[d]}: ${free.length ? free.join(', ') : 'fully booked'}`);
    }
    out.push('DIARY — these are the rooms actually free. Quote them directly, do not say you will check:');
    out.push(...lines);
    const t = lines[0] || '';
    if (/Today/.test(t) && /fully booked/.test(t)) out.push('Nothing left today. Say so plainly and offer the next real slot.');
  }

  if (key === 'car-rental') {
    const fleet = ['Nissan March', 'Honda Fit', 'Toyota Corolla', 'Jeep Wrangler', 'Crew pickup'];
    const onLot = fleet.filter(v => seeded(key + n.date + v) > 0.25);
    out.push(`ON THE LOT TODAY: ${onLot.length ? onLot.join(', ') : 'nothing until tomorrow'}.`);
    const out_ = fleet.filter(v => onLot.indexOf(v) < 0);
    if (out_.length) out.push(`OUT UNTIL TOMORROW: ${out_.join(', ')} — offer the nearest thing on the lot instead.`);
  }

  if (key === 'restaurant') {
    const nights = [];
    for (let i = 0; i < 7 && nights.length < 4; i++) {
      const d = (n.dow + i) % 7;
      if (!c.hours[d]) continue;
      const seats = Math.round(seeded(key + n.date + DAYS[d]) * 26);
      nights.push(`  ${i === 0 ? 'Tonight' : DAYS[d]}: ${seats < 3 ? 'full' : seats + ' of 26 seats left'}`);
    }
    out.push('THE BOOK — seats left at the seven o\'clock seating:');
    out.push(...nights);
  }

  if (key === 'bfc') {
    const wait = 15 + Math.round(seeded(key + n.date + n.hour) * 30);
    out.push(open
      ? `KITCHEN RIGHT NOW: about ${wait} minutes on delivery, ${Math.round(wait / 3)} on collection.`
      : 'Kitchen is shut — take the order for when you open if they want.');
  }

  if (key === 'print-shop') {
    const busy = seeded(key + n.date) > 0.5;
    out.push(busy
      ? 'THE PRESS: busy week. Standard is running six days, and rush slots for 48 hours are nearly gone — only two left.'
      : 'THE PRESS: running clear. Standard is five days as normal and rush slots are open.');
  }

  return out.join('\n');
}

/* ── how it is told to behave ─────────────────────────────────────────────── */

function systemPrompt(shop) {
  return `You are the person answering WhatsApp for ${shop.name}, ${shop.who}. You are not
a menu and not a form. You are the one who actually works here.
${HOUSE_RULES}
YOUR VOICE — this is what makes you THIS place and not a customer service department
${shop.voice}
Sound like where you actually are: the yard, the fryer, the terrace, the lot. No
corporate padding, no "I'd be happy to assist you", no "great question".

WHAT YOU KNOW
${shop.facts}

THE CLOCK IS AT THE BOTTOM OF THIS BRIEF AND IT IS REAL — USE IT
You are given the real date, the real time, and what is genuinely free right now.
"Are you available now?" is a question with an answer: either yes and here is the
slot, or no and here is why and here is the next one. Never answer a question about
now by asking what day they were thinking. And never say you will "check" something
the diary already answers — the diary IS the check, so give them the answer.

TAKING THE ORDER
You are working towards: ${shop.needs}. Get there naturally over the conversation —
do not fire the whole list at them at once, and do not restart from the top when they
ask a question mid-way. Once you genuinely have everything, and only then, fill in the
quote and read it back.

YOUR TWO TOOLS — THIS IS HOW YOU ACTUALLY SELL
You do not recite the list from memory. You have the real one.
  search_catalogue — every time somebody asks what you have, what something costs,
    whether you do a thing, or what you would recommend. Search it EVERY time, even
    if you searched something similar a minute ago. It is forgiving: a single word
    is enough, so search broad. An empty result nearly always means your search was
    too narrow, so try a wider word before you ever tell somebody you do not have it.
  send_photos — put the actual pictures in front of them with a short code under
    each one. This is your best move. The moment somebody wants to see what you
    have, send the pictures instead of describing them — a picture they can point
    at beats another question every time. Then they answer with the code, like "A2",
    and you know exactly what they mean.
Send the WHOLE set that matches, not a shortened pick of two, and never ask
permission first — if they asked to see what you have, showing them IS the answer.

WHAT YOU SEND BACK each turn:
  reply    — what you say. Plain text. No markdown, no bullet lists.
  suggest  — up to 4 very short things they might tap next (2–4 words each, like
             "Honda Fit" or "How much deposit?"). Leave the list empty if buttons
             would not help right now.
  quote    — ready:false until the order is genuinely complete. When it is complete,
             ready:true with the line items, and your reply should read it back and
             ask them to confirm. Money is written like "B$285.00".`;
}

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggest: { type: 'array', items: { type: 'string' } },
    quote: {
      type: 'object',
      properties: {
        ready: { type: 'boolean' },
        title: { type: 'string' },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, value: { type: 'string' } },
            required: ['label', 'value'],
            additionalProperties: false
          }
        },
        total: { type: 'string' },
        note: { type: 'string' }
      },
      required: ['ready', 'title', 'rows', 'total', 'note'],
      additionalProperties: false
    }
  },
  required: ['reply', 'suggest', 'quote'],
  additionalProperties: false
};

/* ── the tools ──────────────────────────────────────────────────────────────
   The same two moves Kiki has, with the shoes swapped out: look in the real
   list, then put the pictures on screen with a code under each. */

const TOOLS = [
  {
    name: 'search_catalogue',
    description: 'Search what this business actually sells. Returns id, name and price for each match. Use it EVERY time somebody asks what you have, what something costs, or what you would suggest — never answer from memory. It is forgiving about spelling and a single word is enough, so search BROAD. If it comes back empty, try a wider word before telling anyone you do not have something.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What they are after, in their own words — "dye my hair", "something for the kids", "4x4", "wings for a crowd". Put the whole phrase here.' },
        cat: { type: 'string', description: 'Optional category to narrow to, if you already know it from an earlier search.' },
        max_price: { type: 'number', description: 'Only things at or under this. Use for "under 100", "cheapest", "on a budget".' },
        min_price: { type: 'number', description: 'Only things at or above this.' }
      }
    }
  },
  {
    name: 'send_photos',
    description: 'Show the customer the actual pictures, with a short code under each one so they can pick by typing two characters. Pass the ids from search_catalogue. Send them ALL — do not trim the list to two and do not ask permission first. Anything without a picture is listed as text automatically, so it is still safe to include.',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, description: 'Every id from the search that matches what they asked for.' },
        lead_in: { type: 'string', description: 'Your one short line that goes right before the pictures, e.g. "Here is what we do in colour 👇". Keep it to a sentence.' }
      },
      required: ['ids']
    }
  }
];

function runTool(demo, name, input) {
  if (name === 'search_catalogue') {
    const found = search(demo, input || {});
    if (!found.length) return { found: 0, note: 'Nothing matched. Search a wider word before saying you do not have it.' };
    return {
      found: found.length,
      items: found.map(i => ({
        id: i.id, name: i.name, price: i.price,
        ...(i.mins ? { minutes: i.mins } : {}),
        hasPhoto: !!i.img
      }))
    };
  }

  if (name === 'send_photos') {
    const items = byIds(demo, (input && input.ids) || []);
    if (!items.length) return { sent: 0, note: 'None of those ids exist. Search again and use the ids it returns.' };
    /* the codes go A1, A2 … exactly like the real store's albums */
    const album = items.map((i, n) => ({
      label: 'A' + (n + 1),
      name: i.name,
      price: i.price,
      img: i.img || null
    }));
    return { sent: album.length, album, note: 'The pictures are on their screen now with these codes under them. Do not list them again in your reply — just say your one line and let them pick a code.' };
  }

  return { error: 'unknown tool' };
}

/* ── the limits ───────────────────────────────────────────────────────────── */

const seen = new Map();               // ip -> { n, resetAt }
let day = today(), used = 0;

function today() { return new Date().toISOString().slice(0, 10); }

function overIpLimit(ip) {
  const now = Date.now();
  const row = seen.get(ip);
  if (!row || now > row.resetAt) { seen.set(ip, { n: 1, resetAt: now + PER_IP_WINDOW }); return false; }
  row.n++;
  if (seen.size > 5000) for (const [k, v] of seen) if (now > v.resetAt) seen.delete(k);
  return row.n > PER_IP_MSGS;
}

function overDailyCap() {
  if (today() !== day) { day = today(); used = 0; }
  return used >= DAILY_CAP;
}

/* ── the route ────────────────────────────────────────────────────────────── */

function mount(app) {
  app.post('/demo-chat', async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(503).json({ ok: false, reason: 'no-key' });

    const body = req.body || {};
    const shop = SHOPS[String(body.demo || '')];
    if (!shop) return res.status(400).json({ ok: false, reason: 'unknown-demo' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket?.remoteAddress || 'unknown';
    if (overIpLimit(ip))  return res.status(429).json({ ok: false, reason: 'slow-down' });
    if (overDailyCap())   return res.status(429).json({ ok: false, reason: 'daily-cap' });

    /* Only the roles and the text survive — nothing else from the page is trusted. */
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-MAX_TURNS)
      .map(m => ({
        role: m && m.role === 'assistant' ? 'assistant' : 'user',
        content: String((m && m.content) || '').slice(0, MAX_CHARS)
      }))
      .filter(m => m.content.trim());

    if (!messages.length) return res.status(400).json({ ok: false, reason: 'empty' });
    if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: 'Hello' });

    used++;

    const demo = String(body.demo);

    try {
      /* The tool loop: the model looks in the catalogue, we hand back what is
         really in it, and it decides what to say. Three rounds is plenty —
         search, send the pictures, answer — and it stops the loop running away
         on somebody else's money. */
      let album = null, usedIn = 0, usedOut = 0, data = null;

      for (let round = 0; round < 3; round++) {
        const r = await fetch(API, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 900,
            /* The clock and the diary sit AFTER the cache breakpoint on purpose —
               they change every minute, and anything above a breakpoint that moves
               throws the cached prefix away and bills the lot again. */
            system: [
              { type: 'text', text: systemPrompt(shop), cache_control: { type: 'ephemeral' } },
              { type: 'text', text: liveBlock(demo, shop) }
            ],
            thinking: { type: 'disabled' },      // a chat reply, not a research task
            tools: TOOLS,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
            messages
          })
        });

        data = await r.json();

        if (!r.ok) {
          console.error('[demo-chat]', r.status, JSON.stringify(data).slice(0, 300));
          return res.status(502).json({ ok: false, reason: 'upstream', status: r.status });
        }
        if (data.stop_reason === 'refusal') {
          return res.json({ ok: true, reply: 'Let me get one of the team on that one 🙏', suggest: [], quote: { ready: false } });
        }

        usedIn  += (data.usage && data.usage.input_tokens)  || 0;
        usedOut += (data.usage && data.usage.output_tokens) || 0;

        const calls = (data.content || []).filter(b => b.type === 'tool_use');
        if (!calls.length) break;                    // it is done looking; the answer is in hand

        messages.push({ role: 'assistant', content: data.content });
        messages.push({
          role: 'user',
          content: calls.map(c => {
            const result = runTool(demo, c.name, c.input);
            if (result.album) album = result.album;  // hold it back for the widget
            const forModel = Object.assign({}, result);
            delete forModel.album;                   // the model needs the count, not the payload
            return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(forModel) };
          })
        });
      }

      const text = ((data && data.content) || []).filter(b => b.type === 'text').map(b => b.text).join('');
      let out;
      try { out = JSON.parse(text); }
      catch (_) { return res.status(502).json({ ok: false, reason: 'bad-json' }); }

      res.json({
        ok: true,
        reply: String(out.reply || '').trim(),
        suggest: (out.suggest || []).slice(0, 4).map(s => String(s).slice(0, 40)),
        album: album,
        quote: out.quote && out.quote.ready
          ? { ready: true, title: out.quote.title || shop.quoteTitle, rows: out.quote.rows || [],
              total: out.quote.total || '', note: out.quote.note || '' }
          : { ready: false },
        usage: { in: usedIn, out: usedOut }
      });

    } catch (e) {
      console.error('[demo-chat] threw', e && e.message);
      res.status(502).json({ ok: false, reason: 'threw' });
    }
  });

  /* A quick health check so a dead key is obvious without opening a demo. */
  app.get('/demo-chat/health', (_req, res) => {
    res.json({
      ok: true,
      model: MODEL,
      hasKey: !!process.env.ANTHROPIC_API_KEY,
      demos: Object.keys(SHOPS),
      today: day, usedToday: used, dailyCap: DAILY_CAP
    });
  });
}

module.exports = { mount, SHOPS, liveBlock, nassau };
