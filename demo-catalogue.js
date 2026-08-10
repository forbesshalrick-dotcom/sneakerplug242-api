/* ============================================================================
   demo-catalogue.js — what each demo business actually sells.

   Rodney, 9 Aug 2026: "kiki is very smart, she can easily replace tennis
   options with food options thats on the menu already, or cars that are
   available for rent on the rental website."

   That is the whole idea. Kiki's real skill is not the shoes — it is the
   move: search a live list, send a photo album with a short code under each
   picture, let the customer answer with two characters instead of a
   description. Swap the list and the same machine sells chicken, tables,
   treatments, cars or islands.

   So each business gets a catalogue instead of a paragraph. The bot searches
   THIS, and the prices it quotes come from HERE — which also means a price can
   never drift away from what is printed on the page, because there is one list.

   img is relative to the demo page the widget is sitting on. An item without
   an img still shows up in a search and can still be sold; it just goes out as
   a line of text rather than a picture.

   ⚠️ Never attach a photo to an item it is not actually a photo of. That rule
   came from labelling a Ford as a Toyota on the car rental page.
   ============================================================================ */

'use strict';

const CATALOGUE = {

  bfc: [
    { id: 1, name: '1 — The Two-Piece',    price: 9.50,  cat: 'chicken',   img: 'img/m1.webp', tags: 'two piece chicken small solo lunch cheap' },
    { id: 2, name: '2 — Family Bucket',    price: 34.00, cat: 'chicken',   img: 'img/m2.webp', tags: 'family bucket four people share big group' },
    { id: 3, name: '3 — The Sunday Plate', price: 14.00, cat: 'chicken',   img: 'img/m3.webp', tags: 'sunday plate dinner full meal' },
    { id: 4, name: '4 — Crispy Sandwich',  price: 11.00, cat: 'sandwich',  img: 'img/m4.webp', tags: 'crispy sandwich burger bun handheld' },
    { id: 5, name: '5 — Sticky Wings',     price: 13.50, cat: 'wings',     img: 'img/m5.webp', tags: 'sticky wings bbq jerk saucy' },
    { id: 6, name: '6 — Loaded Fries',     price: 8.50,  cat: 'sides',     img: 'img/m6.webp', tags: 'loaded fries cheese snack cheap vegetarian without chicken' },
    { id: 7, name: '7 — Wing Party',       price: 29.00, cat: 'wings',     img: 'img/m7.webp', tags: 'wing party eight people share big group crowd' },
    { id: 8, name: '8 — Lil Chick',        price: 6.50,  cat: 'kids',      img: 'img/m8.webp', tags: 'lil chick kids meal child small cheapest' }
  ],

  restaurant: [
    { id: 1, name: 'Snapper crudo',     price: 38, cat: 'first',  img: 'img/dish-4.webp', tags: 'snapper crudo raw fish light first course seafood' },
    { id: 2, name: 'Hand-rolled pasta', price: 46, cat: 'main',   img: 'img/dish-2.webp', tags: 'pasta hand rolled lobster vegetarian option main' },
    { id: 3, name: 'Whole grouper',     price: 52, cat: 'main',   img: 'img/dish-1.webp', tags: 'grouper whole fish seafood main local' },
    { id: 4, name: 'Aged beef',         price: 64, cat: 'main',   img: 'img/dish-3.webp', tags: 'aged beef steak meat main heaviest' },
    { id: 5, name: 'Dark chocolate',    price: 18, cat: 'dessert', img: 'img/dish-5.webp', tags: 'dark chocolate guava dessert sweet pudding' }
  ],

  salon: [
    /* photos are of the actual rooms and treatments they belong to */
    { id: 1,  name: 'Cut & finish',       price: 95,  mins: 60,  cat: 'hair',    img: 'img/room-1.webp',  tags: 'cut finish trim wash style haircut blow dry' },
    { id: 2,  name: 'Colour & gloss',     price: 180, mins: 150, cat: 'hair',    img: 'img/s-floor.webp', tags: 'colour color gloss dye dyed tint highlights' },
    { id: 3,  name: 'Keratin smoothing',  price: 260, mins: 210, cat: 'hair',    tags: 'keratin smoothing straighten frizz relaxer' },
    { id: 4,  name: 'Knotless braiding',  price: 200, mins: 300, cat: 'hair',    tags: 'braids braiding knotless plait cornrow' },
    { id: 5,  name: 'Signature facial',   price: 140, mins: 75,  cat: 'skin',    img: 'img/s-facial.webp', tags: 'facial signature skin face glow' },
    { id: 6,  name: 'Dermaplane',         price: 120, mins: 45,  cat: 'skin',    tags: 'dermaplane shave exfoliate skin face' },
    { id: 7,  name: 'LED light therapy',  price: 90,  mins: 30,  cat: 'skin',    tags: 'led light therapy acne quick cheapest skin' },
    { id: 8,  name: 'Chemical peel',      price: 165, mins: 60,  cat: 'skin',    tags: 'chemical peel resurface skin' },
    { id: 9,  name: 'Swedish 60',         price: 130, mins: 60,  cat: 'massage', tags: 'swedish massage relax 60 hour gentle' },
    { id: 10, name: 'Deep tissue 90',     price: 190, mins: 90,  cat: 'massage', tags: 'deep tissue massage 90 knots sports firm' },
    { id: 11, name: 'Hot stone 90',       price: 210, mins: 90,  cat: 'massage', img: 'img/still-2.webp', tags: 'hot stone massage 90 warm' },
    { id: 12, name: 'Prenatal 60',        price: 140, mins: 60,  cat: 'massage', tags: 'prenatal pregnant expecting massage side lying' },
    { id: 13, name: 'Reflexology 45',     price: 95,  mins: 45,  cat: 'massage', tags: 'reflexology feet foot 45' },
    { id: 14, name: 'Half-day retreat',   price: 420, mins: 240, cat: 'ritual',  img: 'img/s-sauna.webp', tags: 'half day retreat sauna pool whole day package' },
    { id: 15, name: 'Couples ritual',     price: 560, mins: 150, cat: 'ritual',  tags: 'couples ritual two people together partner anniversary' },
    { id: 16, name: 'Bridal morning',     price: 380, mins: 180, cat: 'ritual',  tags: 'bridal wedding bride morning party' }
  ],

  'car-rental': [
    { id: 1, name: 'Nissan March',   price: 50,  cat: 'small',  img: 'img/car-march.webp',    tags: 'nissan march small cheap economy gas town parking cheapest' },
    { id: 2, name: 'Honda Fit',      price: 55,  cat: 'small',  img: 'img/car-fit.webp',      tags: 'honda fit hatchback boot luggage popular most booked' },
    { id: 3, name: 'Toyota Corolla', price: 65,  cat: 'saloon', img: 'img/car-corolla.webp',  tags: 'toyota corolla full size sedan comfortable week family' },
    { id: 4, name: 'Jeep Wrangler',  price: 95,  cat: '4x4',    img: 'img/car-wrangler.webp', tags: 'jeep wrangler 4x4 soft top beach back road offroad fun' },
    { id: 5, name: 'Crew pickup',    price: 110, cat: 'truck',  img: 'img/car-pickup.webp',   tags: 'crew pickup truck tray cab contractor moving boat haul' }
  ],

  estate: [
    { id: 1, name: 'Over-water pavilion, private cay', price: 14500000, cat: 'cay',      img: 'img/p1.webp', tags: 'over water pavilion private cay island turquoise exuma' },
    { id: 2, name: 'Pavilion house, Exuma',            price: 8900000,  cat: 'cay',      img: 'img/p2.webp', tags: 'pavilion still water exuma modern architectural' },
    { id: 3, name: 'Palm court villa, Harbour Island',  price: 6750000,  cat: 'villa',    img: 'img/p3.webp', tags: 'harbour island palms pool sunset villa' },
    { id: 4, name: 'Terraced estate, Eleuthera',        price: 11200000, cat: 'estate',   img: 'img/p4.webp', tags: 'eleuthera terraced guest wing estate large family' },
    { id: 5, name: 'Cliff terrace residence',           price: 9400000,  cat: 'villa',    img: 'img/p5.webp', tags: 'cliff terrace above pool residence view' },
    { id: 6, name: 'Garden house, Harbour Island',      price: 4800000,  cat: 'villa',    img: 'img/p6.webp', tags: 'garden tropical planting harbour island smaller entry' }
  ],

  /* The print shop sells a service, not a shelf of things — the shirt itself is
     built on the page in the designer. The catalogue is the price ladder, which
     is what people actually ask about. */
  'print-shop': [
    { id: 1, name: '1–9 shirts',   price: 22, cat: 'tier', tags: 'one single few small order sample under ten no minimum' },
    { id: 2, name: '10–24 shirts', price: 18, cat: 'tier', tags: 'ten dozen twelve team small group' },
    { id: 3, name: '25–49 shirts', price: 15, cat: 'tier', tags: 'twenty five thirty forty class staff' },
    { id: 4, name: '50+ shirts',   price: 12, cat: 'tier', tags: 'fifty hundred bulk big run cheapest event' }
  ]
};

/* ── searching it ───────────────────────────────────────────────────────────
   Deliberately forgiving, the way Kiki's is: every word the customer used is
   scored against the name, the category and the tag list, and a near-miss on
   spelling still counts. A search that finds nothing is nearly always a query
   that was too narrow, so a single matching word is enough to surface an item. */

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();
}

function close(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4);        // dye/dyed, braid/braiding, wing/wings
}

function search(demo, { query, cat, max_price, min_price } = {}) {
  let items = (CATALOGUE[demo] || []).slice();

  if (cat) items = items.filter(i => norm(i.cat) === norm(cat));
  if (max_price != null) items = items.filter(i => i.price <= max_price);
  if (min_price != null) items = items.filter(i => i.price >= min_price);

  const words = norm(query).split(' ').filter(w => w.length > 1);
  if (!words.length) return items;

  const scored = items.map(i => {
    const hay = norm(i.name + ' ' + (i.cat || '') + ' ' + (i.tags || '')).split(' ');
    let hits = 0;
    words.forEach(w => { if (hay.some(h => close(w, h))) hits++; });
    return { i, hits };
  }).filter(x => x.hits > 0);

  scored.sort((a, b) => b.hits - a.hits || a.i.price - b.i.price);
  return scored.map(x => x.i);
}

function byIds(demo, ids) {
  const list = CATALOGUE[demo] || [];
  return (ids || []).map(id => list.find(i => i.id === id)).filter(Boolean);
}

module.exports = { CATALOGUE, search, byIds };
