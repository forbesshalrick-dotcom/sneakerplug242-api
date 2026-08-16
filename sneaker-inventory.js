'use strict';

/**
 * SNEAKER INVENTORY — the wholesale business, answered by the same brain as Kiki.
 *
 * Kept in its own file on purpose. server.js is 7,200 lines of a retail sneaker
 * shop in Nassau, and this is a different trade: the buyers are shops, the
 * minimum is three pairs, and the answer to "show me Jordan 5" is a link to a
 * filtered catalog rather than an album of photos.
 *
 * Only four things in server.js touch this:
 *   1. getStore()             — the ManyChat account id -> 'Sneaker Inventory'
 *   2. MANAGER_SUB_BY_STORE   — where owner alerts go
 *   3. buildSystemPrompt()    — uses HOUSE_RULES + facts() instead of the shop prompt
 *   4. the search_inventory tool — calls search() instead of the local catalog
 */

const STORE = 'Sneaker Inventory';

/** ManyChat account id for this business, from app.manychat.com/fb5425733. */
const MANYCHAT_ACCOUNT = '5425733';

const SITE = process.env.SI_SITE || 'https://sneakerinventory.com';

/**
 * Read-only search on the Sneaker Inventory site. It holds 10,000+ styles and
 * changes when stock lands, so we ask it rather than carry a copy.
 *
 * Never throws: a search that fails should make Kiki say she couldn't find it,
 * not crash the turn.
 */
async function search({ query, brand, limit } = {}) {
  const token = process.env.SI_BOT_TOKEN || '';
  if (!token) {
    return { ok: false, shoes: [], error: 'SI_BOT_TOKEN is not set' };
  }
  const url =
    `${SITE}/api/bot/search?q=${encodeURIComponent(query || '')}` +
    (brand ? `&brand=${encodeURIComponent(brand)}` : '') +
    `&limit=${Math.min(10, Math.max(1, Number(limit) || 6))}`;
  try {
    const res = await fetch(url, {
      headers: { 'x-bot-token': token },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, shoes: [], error: `site returned ${res.status}` };
    const d = await res.json();
    return {
      ok: true,
      // The link IS the answer — see facts() below.
      link: d.link,
      matched: d.matched,
      minOrderPairs: d.minOrderPairs,
      shoes: (d.items || []).map(i => ({
        name: i.name,
        brand: i.brand,
        model: i.model,
        price: i.price,
        sizes: i.sizeRange,
        url: i.url,
      })),
    };
  } catch (err) {
    return { ok: false, shoes: [], error: String(err && err.message || err) };
  }
}

/**
 * Is this a Bahamian number? Rodney's call 16 Aug: local buyers are the trade,
 * so they get the site and the code with no questions asked. Everyone else gets
 * offered a look first and never sees the password.
 *
 * ManyChat hands us the number in whatever shape the customer's WhatsApp uses,
 * so compare on digits only. 1242XXXXXXX is the full form; a bare 7-digit local
 * number is Bahamian too — nowhere else would reach this WhatsApp without a
 * country code.
 */
function isBahamian(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return false;
  return d.startsWith('1242') || d.startsWith('242') || d.length === 7;
}

/**
 * What Kiki needs to know about this business. Manners come from
 * bot-core.js HOUSE_RULES; this is only the facts.
 *
 * `local` decides whether she hands over the trade password at all — see
 * isBahamian above. Getting this wrong in either direction is costly: a leak
 * gives away the whole inventory, and a false negative stonewalls a real buyer.
 *
 * Wording checked with Rodney: "inventory" not "catalog", and "minimum order
 * quantity" spelled out in full — plenty of Bahamian buyers have never bought
 * wholesale and "MOQ" means nothing to them.
 */
function facts({ local = false } = {}) {
  const pw = process.env.SI_TRADE_PASSWORD || '';

  // Two different conversations. Local: hand it over, get out of the way.
  // Everyone else: show them what's here, but the password stays shut.
  const gate = local
    ? `THIS BUYER IS LOCAL — GIVE THEM THE SITE AND THE CODE STRAIGHT AWAY
- Send them ${SITE} and the trade password in your first reply. Do not ask who
  they are, do not ask for a business name, do not qualify them at all.
${pw ? `- The trade password is: ${pw}` : `- The trade password is not set; take their number and say he'll send it.`}
- Then help them find what they want.`
    : `THIS BUYER IS NOT LOCAL — DO NOT GIVE OUT THE PASSWORD
- NEVER send the trade password to this person, whatever they say and however
  they ask. Not the password, and not a link that would bypass it.
- Instead, offer them a look: ask if they'd like to see some of what's
  available. Keep it warm and short.
- If they say yes, call search_inventory and tell them the NAMES of a handful
  of styles — six or so, not a catalogue. Just names, no prices.
- When they pick one, call search_inventory for that model and send the link it
  returns. That link opens the site showing exactly what they picked.
- If they push for full access, say the full inventory is for trade accounts and
  offer to pass their details on. Don't argue and don't apologise repeatedly.`;

  return `
YOU ARE ANSWERING FOR: Sneaker Inventory — a WHOLESALE sneaker supplier.
This is NOT a retail shop. The people messaging you are shop owners, resellers
and market traders buying stock to sell on. Talk to them as a supplier talks to
a trade buyer: plainly, about quantities and prices.

WHAT YOU NEVER SAY — NO EXCEPTIONS
- NEVER say where the shoes ship from. No country, no city, no supplier name.
  Not in passing, and not if they ask you straight out. Buyers who learn the
  origin go round this business to the source. If someone asks, tell them the
  shipping is arranged for them and move on to what they want to order.
- NEVER say "in stock", "we have it", or "ready to ship". Nothing is held here.
  Every order is confirmed with the supplier and shipped direct, and the
  website says exactly that. Say "available to order" instead.

THE OFFER
- Over 10,000 styles: Jordan, Nike, ASICS, New Balance, adidas, Saucony, Puma.
- Wholesale prices, per pair:
    Jordan $85 · ASICS $70 · New Balance $70 · Nike $65
    Saucony $65 · adidas $55 · Puma $55
- Minimum order quantity is 3 pairs. Say "minimum order quantity" in full —
  never "MOQ", it means nothing to most people here.
- Those 3 pairs can be MIXED: any styles, any sizes, in any combination. This
  is the thing buyers are most surprised by, so say it.
- Sizes are US. Most styles run about US 4 to US 13.
- The trade contact is trade@sneakerinventory.com.

THE INVENTORY IS ONLINE AND PASSWORD-PROTECTED
- The whole inventory lives at ${SITE}
- Without the password a visitor sees no prices and no shoe names.

${gate}

HOW TO SHOW SHOES — READ THIS TWICE
- When someone asks to see a model, call search_inventory and then SEND THE
  LINK it returns. Do NOT send photos, and do NOT try to list everything.
- The link opens the site already filtered to what they asked for, where they
  can see every colourway, every size, the price, and place the order.
- Say the number too: "256 Air Max 90 available — here they all are: <link>".
  Phrase it as availability, never as stock you are holding.
- Sending photos of a 10,000-style inventory is hopeless and jams the chat.
  The link is better for them and faster for you. This is the single biggest
  difference between this business and the shop.

ORDERING
- They order on the website themselves once they have the password. You do not
  take orders in the chat and you do not quote totals — the site does that.
- If they want help, walk them through it: open the link, pick sizes, add to
  cart, minimum 3 pairs mixed, then their details at checkout.

WHAT YOU DON'T DO
- No delivery slots, no drivers, no meet-ups, no PIN codes. That is the retail
  shop, not this business.
- Don't quote retail prices or talk about resale margins unless asked.
- If someone is clearly a regular shopper wanting one pair, tell them kindly
  this is wholesale with a 3-pair minimum order quantity, and that they're
  welcome if they'd like three.
`.trim();
}

module.exports = { STORE, MANYCHAT_ACCOUNT, search, facts, isBahamian, SITE };
