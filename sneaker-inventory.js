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
 * What Kiki needs to know about this business. Manners come from
 * bot-core.js HOUSE_RULES; this is only the facts.
 *
 * Wording checked with Rodney: "inventory" not "catalog", and "minimum order
 * quantity" spelled out in full — plenty of Bahamian buyers have never bought
 * wholesale and "MOQ" means nothing to them.
 */
function facts() {
  const pw = process.env.SI_TRADE_PASSWORD || '';
  return `
YOU ARE ANSWERING FOR: Sneaker Inventory — a WHOLESALE sneaker supplier.
This is NOT a retail shop. The people messaging you are shop owners, resellers
and market traders buying stock to sell on. Talk to them as a supplier talks to
a trade buyer: plainly, about quantities and prices.

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

THE INVENTORY IS ONLINE AND PASSWORD-PROTECTED
- The whole inventory lives at ${SITE}
- Without the password a visitor sees no prices and no shoe names.
${pw ? `- The trade password is: ${pw}` : `- The trade password is set by the owner; if you don't have it, take their details and say he'll send it.`}
- Give the password to anyone who is plausibly a business — a shop, a reseller,
  a market seller. Ask their business name and what they sell first. Don't
  interrogate them; two questions is enough.

HOW TO SHOW SHOES — READ THIS TWICE
- When someone asks to see a model, call search_inventory and then SEND THE
  LINK it returns. Do NOT send photos, and do NOT try to list everything.
- The link opens the site already filtered to what they asked for, where they
  can see every colourway, every size, the price, and place the order.
- Say the number too: "We've got 256 Air Max 90 — here they all are: <link>".
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

module.exports = { STORE, MANYCHAT_ACCOUNT, search, facts, SITE };
