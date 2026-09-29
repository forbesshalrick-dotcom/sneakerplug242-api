/* ==========================================================================
   shopfront.js — the three screens in front of the designer.

     1  CATALOGUE   pick a category, see the garments
     2  PRODUCT     colour, printing method, sizes, price — then Start designing
     3  hands off to ShirtDesigner with the colour already applied

   Everything happens on one page; there is no navigation to lose. A shop owner
   evaluating this on a phone at midnight should never wait for a page load.
   ========================================================================== */

window.Shopfront = (function () {
  "use strict";

  var G = window.Garments;
  var state = { cat: 'all', product: null, colour: G.colours[0], tech: 'DTG', sizes: {}, qty: 25 };
  var els = {};
  var onDesign = null;

  function money(n) { return 'B$' + Number(n).toFixed(2).replace(/\.00$/, ''); }

  /* the price ladder the rest of the page and the bot already quote from */
  function unit() {
    var base = state.product ? state.product.from : 22;
    var q = state.qty;
    var off = q >= 50 ? 10 : q >= 25 ? 7 : q >= 10 ? 4 : 0;
    return Math.max(base - off, 8) + (G.tech[state.tech] ? G.tech[state.tech].add : 0);
  }

  function totalSizes() {
    var n = 0; for (var k in state.sizes) n += state.sizes[k] || 0; return n;
  }

  /* ---- 1. the catalogue ------------------------------------------------- */
  function renderCats() {
    els.cats.innerHTML = '';
    G.cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cat-chip'; b.textContent = c.label;
      b.setAttribute('aria-pressed', String(state.cat === c.id));
      b.addEventListener('click', function () { state.cat = c.id; renderCats(); renderGrid(); });
      els.cats.appendChild(b);
    });
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    G.catalogue
      .filter(function (p) { return state.cat === 'all' || p.cat === state.cat; })
      .forEach(function (p) {
        var card = document.createElement('button');
        card.type = 'button'; card.className = 'gcard';
        card.innerHTML =
          '<span class="gcard-shot">' + G.svg(p.shape, '#E8E3DA', 170) + '</span>' +
          '<span class="gcard-name">' + p.name + '</span>' +
          '<span class="gcard-spec">' + p.spec + '</span>' +
          '<span class="gcard-foot"><b>from ' + money(p.from) + '</b>' +
            '<span>' + p.sizes.length + ' size' + (p.sizes.length > 1 ? 's' : '') + ' · ' + p.tech.length + ' method' + (p.tech.length > 1 ? 's' : '') + '</span></span>';
        card.addEventListener('click', function () { open(p); });
        els.grid.appendChild(card);
      });
  }

  /* ---- 2. the product ---------------------------------------------------- */
  function open(p) {
    state.product = p;
    state.colour = G.colours[0];
    state.tech = p.tech[0];
    state.sizes = {};
    els.cat_screen.hidden = true;
    els.prod_screen.hidden = false;
    renderProduct();
    els.prod_screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function back() {
    els.prod_screen.hidden = true;
    els.cat_screen.hidden = false;
    els.cat_screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderProduct() {
    var p = state.product;
    els.shot.innerHTML = G.svg(p.shape, state.colour.hex, 300);
    els.pname.textContent = p.name;
    els.pspec.textContent = p.spec;
    els.pblurb.textContent = p.blurb;

    /* colours */
    els.swatches.innerHTML = '';
    G.colours.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch';
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-pressed', String(c.name === state.colour.name));
      b.addEventListener('click', function () { state.colour = c; renderProduct(); });
      els.swatches.appendChild(b);
    });
    els.cname.textContent = state.colour.name;

    /* printing method — only the ones this garment can take */
    els.techs.innerHTML = '';
    p.tech.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tech';
      b.setAttribute('aria-pressed', String(t === state.tech));
      b.innerHTML = '<b>' + G.tech[t].label + '</b><span>' + G.tech[t].note + '</span>' +
                    '<em>' + (G.tech[t].add ? '+ ' + money(G.tech[t].add) + ' a shirt' : 'included') + '</em>';
      b.addEventListener('click', function () { state.tech = t; renderProduct(); });
      els.techs.appendChild(b);
    });

    /* sizes — a real order is a spread, not one number */
    els.sizes.innerHTML = '';
    p.sizes.forEach(function (sz) {
      var row = document.createElement('div');
      row.className = 'sizerow';
      row.innerHTML = '<span>' + sz + '</span>';
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.value = String(state.sizes[sz] || 0);
      inp.setAttribute('aria-label', 'How many in ' + sz);
      inp.addEventListener('input', function () {
        state.sizes[sz] = Math.max(0, parseInt(inp.value || '0', 10));
        state.qty = totalSizes() || 25;
        priceOut();
      });
      row.appendChild(inp);
      els.sizes.appendChild(row);
    });

    priceOut();
  }

  function priceOut() {
    var n = totalSizes();
    var u = unit();
    els.unit.textContent = money(u);
    els.qty.textContent = n ? n + ' shirt' + (n === 1 ? '' : 's') : 'pick your sizes';
    els.total.textContent = n ? money(u * n) : '—';
    els.breaks.textContent = n
      ? (n >= 50 ? 'Best price — 50+' : n >= 25 ? 'Next break at 50' : n >= 10 ? 'Next break at 25' : 'Next break at 10')
      : 'Price drops at 10, 25 and 50';
  }

  /* ---- 3. hand off to the designer -------------------------------------- */
  function startDesigning() {
    if (onDesign) onDesign({
      product: state.product, colour: state.colour, tech: state.tech,
      sizes: state.sizes, qty: totalSizes(), unit: unit(), total: unit() * totalSizes()
    });
  }

  function init(opts) {
    ['cats','grid','cat_screen','prod_screen','shot','pname','pspec','pblurb',
     'swatches','cname','techs','sizes','unit','qty','total','breaks'].forEach(function (k) {
      els[k] = document.getElementById(opts[k]);
    });
    onDesign = opts.onDesign || null;
    var b = document.getElementById(opts.back); if (b) b.addEventListener('click', back);
    var d = document.getElementById(opts.design); if (d) d.addEventListener('click', startDesigning);
    renderCats(); renderGrid();
  }

  return { init: init, state: function () { return state; } };
})();
