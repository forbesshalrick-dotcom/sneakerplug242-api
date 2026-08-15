/* ==========================================================================
   garments.js — the catalogue in front of the designer.

   Rodney, 15 Aug 2026, holding Printify and Printful up next to our print shop:
   "It's supposed to start off like a professional store — you can pick shirt,
   t-shirt, hoodie, jacket, pants, women's, men's. Then different types of
   t-shirts, cotton blend, regular cotton, stretch. You pick that, then you go
   to the page where you pick the colour and the type of printing, DTG, DTFlex
   or embroidery. Then press start designing."

   He is describing the funnel every print-on-demand store has and ours did not:
   we dropped people straight into a canvas with no idea what they were printing
   on. This is that funnel.

   The garments are DRAWN, not photographed. A real store shoots every colourway;
   we cannot, and a catalogue of stock photos in the wrong colours looks worse
   than no photos. An SVG silhouette renders in whatever colour is picked, costs
   nothing to load on a weak signal, and never shows the wrong shade.
   ========================================================================== */

window.Garments = (function () {
  "use strict";

  /* ---- the shapes ------------------------------------------------------- */
  /* One path per garment, drawn once and tinted per colour. Kept deliberately
     simple: at catalogue size, detail reads as noise. */
  var SHAPES = {
    tee:
      'M62 34 L96 18 Q128 34 160 18 L194 34 L214 70 L186 86 L180 214 Q128 224 76 214 L70 86 L42 70 Z',
    longsleeve:
      'M62 34 L96 18 Q128 34 160 18 L194 34 L226 96 L206 178 L184 172 L180 214 Q128 224 76 214 L72 172 L50 178 L30 96 Z',
    hoodie:
      'M62 40 L96 20 Q128 46 160 20 L194 40 L220 100 L198 176 L180 214 Q128 226 76 214 L58 176 L36 100 Z ' +
      'M100 20 Q128 62 156 20 Q128 4 100 20 Z',
    sweatshirt:
      'M62 38 L96 20 Q128 40 160 20 L194 38 L222 98 L200 172 L182 198 Q128 210 74 198 L56 172 L34 98 Z',
    polo:
      'M62 34 L96 18 Q128 34 160 18 L194 34 L214 70 L186 86 L180 214 Q128 224 76 214 L70 86 L42 70 Z ' +
      'M112 20 L128 62 L144 20 L138 16 L128 44 L118 16 Z',
    tank:
      'M88 22 Q104 16 116 22 Q128 40 140 22 Q152 16 168 22 L182 74 L178 214 Q128 224 78 214 L74 74 Z',
    cap:
      'M40 148 Q40 66 128 66 Q216 66 216 148 L204 156 Q128 140 52 156 Z M204 150 L246 168 L244 182 L200 168 Z',
    tote:
      'M64 76 L192 76 L200 224 L56 224 Z M96 76 Q96 30 128 30 Q160 30 160 76'
  };

  /* ---- what the shop sells ---------------------------------------------- */
  /* Prices are per shirt at the smallest run, so the ladder further down the
     page still governs the real quote. */
  var CATALOGUE = [
    { id: 'tee-classic',   cat: 'tees',      shape: 'tee',
      name: 'Classic cotton tee',      spec: '100% ring-spun cotton · 4.5oz',
      blurb: 'The one most orders are. Holds a print well and washes hard.',
      from: 22, sizes: ['S','M','L','XL','2XL','3XL'], tech: ['DTG','DTFlex','Embroidery'] },

    { id: 'tee-blend',     cat: 'tees',      shape: 'tee',
      name: 'Cotton blend tee',        spec: '52% cotton / 48% poly · 4.2oz',
      blurb: 'Softer and lighter. Better for full-colour photo prints.',
      from: 24, sizes: ['S','M','L','XL','2XL','3XL'], tech: ['DTG','DTFlex'] },

    { id: 'tee-stretch',   cat: 'tees',      shape: 'tee',
      name: 'Stretch performance tee', spec: 'Poly-spandex · moisture wicking',
      blurb: 'For teams and anything played in the sun.',
      from: 28, sizes: ['S','M','L','XL','2XL'], tech: ['DTFlex'] },

    { id: 'tee-womens',    cat: 'womens',    shape: 'tee',
      name: "Women's relaxed tee",     spec: 'Ring-spun cotton · relaxed cut',
      blurb: 'Cut for a woman rather than a small men’s.',
      from: 24, sizes: ['XS','S','M','L','XL','2XL'], tech: ['DTG','DTFlex'] },

    { id: 'tank-womens',   cat: 'womens',    shape: 'tank',
      name: "Women's racerback tank",  spec: 'Cotton-poly · racerback',
      blurb: 'Summer events, gyms, giveaways.',
      from: 23, sizes: ['XS','S','M','L','XL'], tech: ['DTG'] },

    { id: 'polo-pique',    cat: 'shirts',    shape: 'polo',
      name: 'Piqué polo',              spec: 'Cotton piqué · three-button',
      blurb: 'Staff uniforms. Embroidery on the chest looks proper here.',
      from: 38, sizes: ['S','M','L','XL','2XL','3XL'], tech: ['Embroidery','DTFlex'] },

    { id: 'ls-tee',        cat: 'shirts',    shape: 'longsleeve',
      name: 'Long sleeve tee',         spec: 'Ring-spun cotton · 5.3oz',
      blurb: 'Sleeve prints are the reason to pick this one.',
      from: 30, sizes: ['S','M','L','XL','2XL'], tech: ['DTG','DTFlex'] },

    { id: 'hoodie-pull',   cat: 'hoodies',   shape: 'hoodie',
      name: 'Pullover hoodie',         spec: 'Cotton-poly fleece · 8oz',
      blurb: 'The one that sells at events. Heavy, keeps its shape.',
      from: 62, sizes: ['S','M','L','XL','2XL','3XL'], tech: ['DTG','DTFlex','Embroidery'] },

    { id: 'crew-sweat',    cat: 'hoodies',   shape: 'sweatshirt',
      name: 'Crewneck sweatshirt',     spec: 'Cotton-poly fleece · 8oz',
      blurb: 'Same weight as the hoodie without the hood.',
      from: 54, sizes: ['S','M','L','XL','2XL'], tech: ['DTG','Embroidery'] },

    { id: 'cap-6panel',    cat: 'accessories', shape: 'cap',
      name: 'Six-panel cap',           spec: 'Structured · adjustable strap',
      blurb: 'Embroidery only — ink does not sit right on a cap.',
      from: 32, sizes: ['One size'], tech: ['Embroidery'] },

    { id: 'tote-canvas',   cat: 'accessories', shape: 'tote',
      name: 'Canvas tote',             spec: '10oz cotton canvas',
      blurb: 'Cheap per unit, and people actually keep them.',
      from: 26, sizes: ['One size'], tech: ['DTG','DTFlex'] }
  ];

  var CATS = [
    { id: 'all',         label: 'Everything' },
    { id: 'tees',        label: 'T-shirts' },
    { id: 'shirts',      label: 'Shirts & polos' },
    { id: 'hoodies',     label: 'Hoodies & sweats' },
    { id: 'womens',      label: "Women's" },
    { id: 'accessories', label: 'Caps & bags' }
  ];

  /* Garment colours. Deliberately the ones a Bahamian shop actually orders —
     a wall of 64 swatches is a supplier's problem, not a customer's. */
  var COLOURS = [
    { name: 'White',      hex: '#FFFFFF', ink: '#14100E' },
    { name: 'Black',      hex: '#1A1A1A', ink: '#FFFFFF' },
    { name: 'Sport grey', hex: '#B9B9B4', ink: '#14100E' },
    { name: 'Navy',       hex: '#1F2E4D', ink: '#FFFFFF' },
    { name: 'Royal',      hex: '#2C5AA8', ink: '#FFFFFF' },
    { name: 'Red',        hex: '#B3252B', ink: '#FFFFFF' },
    { name: 'Sand',       hex: '#D9CBB3', ink: '#14100E' },
    { name: 'Forest',     hex: '#2C4A38', ink: '#FFFFFF' },
    { name: 'Maroon',     hex: '#5C1F2B', ink: '#FFFFFF' },
    { name: 'Gold',       hex: '#D9A625', ink: '#14100E' }
  ];

  /* What each printing method costs on top, and when to use it. The bot quotes
     from the same numbers, so the page and the conversation can never disagree. */
  var TECH = {
    'DTG':        { add: 0,  label: 'DTG printing',
                    note: 'Ink straight into the fabric. Best for full-colour and photos. Softest finish.' },
    'DTFlex':     { add: 3,  label: 'DTFlex transfer',
                    note: 'Vinyl transfer. Brightest colour, stands up to washing, works on performance fabric.' },
    'Embroidery': { add: 9,  label: 'Embroidery',
                    note: 'Stitched, not printed. The one that reads as expensive — caps, polos, chest logos.' }
  };

  function svg(shape, hex, size) {
    var s = size || 256;
    return '<svg viewBox="0 0 256 256" width="' + s + '" height="' + s + '" role="img" aria-hidden="true">' +
             '<path d="' + SHAPES[shape] + '" fill="' + hex + '" stroke="rgba(0,0,0,.28)" stroke-width="2.5" ' +
             'stroke-linejoin="round"/>' +
           '</svg>';
  }

  return {
    catalogue: CATALOGUE, cats: CATS, colours: COLOURS, tech: TECH,
    shapes: SHAPES, svg: svg,
    byId: function (id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return null; }
  };
})();
