/* ==========================================================================
   Shirt designer — canvas customiser for the print-shop demo.

   Four views (front / back / left / right), each with its own artwork, and
   the artwork is dragged into position rather than dropped in a fixed slot.
   Whatever the visitor builds is published to window.SHIRT so the ordering
   bot can price the sides that actually have print on them.
   ========================================================================== */

window.ShirtDesigner = (function () {
  "use strict";

  var SHIRTS = {
    White:  { fill:"#FFFFFF", stroke:"#D6D6D6", shade:"rgba(0,0,0,.07)", ink:"#111111" },
    Black:  { fill:"#1A1A1A", stroke:"#000000", shade:"rgba(0,0,0,.35)", ink:"#FFFFFF" },
    Navy:   { fill:"#1F3358", stroke:"#16264A", shade:"rgba(0,0,0,.3)",  ink:"#FFFFFF" },
    Red:    { fill:"#B32222", stroke:"#8E1B1B", shade:"rgba(0,0,0,.28)", ink:"#FFFFFF" },
    Sand:   { fill:"#D9C7A7", stroke:"#BFAA88", shade:"rgba(0,0,0,.12)", ink:"#3A2E1C" },
    Forest: { fill:"#22402F", stroke:"#182C21", shade:"rgba(0,0,0,.3)",  ink:"#FFFFFF" }
  };

  var FONTS = {
    Anton:     '400 SIZEpx "Anton", Impact, sans-serif',
    Archivo:   '700 SIZEpx "Archivo", sans-serif',
    Cormorant: '600 SIZEpx "Cormorant", Georgia, serif',
    Mono:      '600 SIZEpx "Plex Mono", ui-monospace, monospace'
  };

  var VIEWS = ["front", "back", "left", "right"];
  var W = 360, H = 430;

  /* print windows differ per view — you cannot print across a side seam */
  var AREA = {
    front: { x:106, y:150, w:148, h:170 },
    back:  { x:106, y:140, w:148, h:190 },
    left:  { x:136, y:154, w:88, h:126 },
    right: { x:136, y:154, w:88, h:126 }
  };

  function blankView(view) {
    var a = AREA[view];
    return { text: view === "front" ? "ISLAND BUILT" : "", font:"Anton", size: (view==="left"||view==="right") ? 20 : 28,
             ink:"#FFFFFF", graphic: view === "front" ? "242 badge" : "None",
             gscale:1, x:a.x + a.w / 2, y:a.y + a.h / 2 };
  }

  var state = { shirt:"Black", view:"front", views:{} };
  VIEWS.forEach(function (v) { state.views[v] = blankView(v); });

  var canvas, ctx, dragging = false, grab = {x:0,y:0}, lastBox = null, onChange = null;

  function cur() { return state.views[state.view]; }

  /* ---------- garment silhouettes ---------- */
  function bodyPath(c, back) {
    c.beginPath();
    c.moveTo(130, 52);
    c.lineTo(95, 62);
    c.lineTo(38, 110);
    c.lineTo(62, 176);
    c.lineTo(95, 158);
    c.lineTo(95, 400);
    c.lineTo(265, 400);
    c.lineTo(265, 158);
    c.lineTo(298, 176);
    c.lineTo(322, 110);
    c.lineTo(265, 62);
    c.lineTo(230, 52);
    if (back) c.quadraticCurveTo(180, 74, 130, 52);      // shallow back neck
    else      c.quadraticCurveTo(180, 96, 130, 52);      // deeper front neck
    c.closePath();
  }

  /* The sleeve panel, laid flat — not a side profile of the whole shirt.
     A true side-on tee is an unreadable sliver, and the sleeve is the thing
     you actually print on anyway, so this is what real mockups show. */
  function sleevePath(c, dir) {
    c.save();
    if (dir === "right") { c.translate(W, 0); c.scale(-1, 1); }
    c.beginPath();
    c.moveTo(104, 132);
    c.quadraticCurveTo(180, 100, 256, 132);   // shoulder seam
    c.lineTo(238, 306);                       // underarm seam
    c.quadraticCurveTo(180, 328, 122, 306);   // cuff
    c.closePath();
    c.restore();
  }

  function drawGarment() {
    var s = SHIRTS[state.shirt];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#F3F3F3";
    ctx.fillRect(0, 0, W, H);

    var side = state.view === "left" || state.view === "right";
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.2)"; ctx.shadowBlur = 20; ctx.shadowOffsetY = 7;
    if (side) sleevePath(ctx, state.view); else bodyPath(ctx, state.view === "back");
    ctx.fillStyle = s.fill; ctx.fill();
    ctx.restore();

    if (side) sleevePath(ctx, state.view); else bodyPath(ctx, state.view === "back");
    ctx.strokeStyle = s.stroke; ctx.lineWidth = 1.5; ctx.stroke();

    if (!side) {                                   // collar
      ctx.beginPath();
      if (state.view === "back") { ctx.moveTo(133,56); ctx.quadraticCurveTo(180,78,227,56); }
      else                        { ctx.moveTo(133,56); ctx.quadraticCurveTo(180,102,227,56); }
      ctx.strokeStyle = s.stroke; ctx.lineWidth = 3; ctx.stroke();
    }

    ctx.save();                                    // fabric folds
    ctx.globalAlpha = .5; ctx.strokeStyle = s.shade; ctx.lineWidth = 9;
    if (side) { ctx.beginPath(); ctx.moveTo(150,160); ctx.lineTo(146,296); ctx.stroke(); }
    else {
      ctx.beginPath(); ctx.moveTo(112,210); ctx.lineTo(104,388); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(248,210); ctx.lineTo(256,388); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- artwork ---------- */
  function drawGraphic(cx, cy, r, ink) {
    ctx.save();
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    ctx.lineWidth = 3 * (r / 30); ctx.lineCap = "round"; ctx.lineJoin = "round";
    var g = cur().graphic;

    if (g === "242 badge") {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.8, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = '400 ' + (r*0.86) + 'px "Anton", Impact, sans-serif';
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("242", cx, cy + 1);

    } else if (g === "Palm") {
      ctx.beginPath(); ctx.moveTo(cx, cy + r);
      ctx.quadraticCurveTo(cx - r*0.13, cy + r*0.13, cx + r*0.07, cy - r*0.4);
      ctx.stroke();
      for (var i=0;i<5;i++){
        var a = -Math.PI/2 + (i-2)*0.55;
        ctx.beginPath(); ctx.moveTo(cx + r*0.07, cy - r*0.4);
        ctx.quadraticCurveTo(cx + r*0.07 + Math.cos(a)*r*0.73, cy - r*0.4 + Math.sin(a)*r*0.73,
                             cx + r*0.07 + Math.cos(a)*r*1.13, cy - r*0.4 + Math.sin(a)*r*1.13 + r*0.33);
        ctx.stroke();
      }

    } else if (g === "Waves") {
      for (var w=0; w<3; w++){
        var y = cy - r*0.47 + w*r*0.47;
        ctx.beginPath(); ctx.moveTo(cx - r*1.13, y);
        ctx.bezierCurveTo(cx - r*0.57, y - r*0.33, cx - r*0.57, y + r*0.33, cx, y);
        ctx.bezierCurveTo(cx + r*0.57, y - r*0.33, cx + r*0.57, y + r*0.33, cx + r*1.13, y);
        ctx.stroke();
      }

    } else if (g === "Star") {
      ctx.beginPath();
      for (var p=0;p<10;p++){
        var rad = p%2===0 ? r : r*0.43;
        var ang = -Math.PI/2 + p*Math.PI/5;
        var px = cx + Math.cos(ang)*rad, py = cy + Math.sin(ang)*rad;
        p===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill();

    } else if (g === "Conch") {
      ctx.beginPath();
      ctx.moveTo(cx - r*0.9, cy + r*0.5);
      ctx.quadraticCurveTo(cx - r*0.2, cy - r*1.1, cx + r*0.9, cy - r*0.2);
      ctx.quadraticCurveTo(cx + r*0.4, cy + r*0.9, cx - r*0.9, cy + r*0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r*0.35, cy + r*0.42);
      ctx.quadraticCurveTo(cx + r*0.05, cy - r*0.35, cx + r*0.55, cy - r*0.1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function wrap(text, maxWidth) {
    var words = text.split(/\s+/), lines = [], line = "";
    words.forEach(function (word) {
      var test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function drawArtwork() {
    var d = cur(), a = AREA[state.view];
    var hasG = d.graphic !== "None";
    var r = 26 * d.gscale;
    var text = (d.text || "").trim();

    ctx.font = FONTS[d.font].replace("SIZE", d.size);
    var lines = text ? wrap(text, a.w - 8) : [];
    var lh = d.size * 1.12;
    var textH = lines.length * lh;
    var gap = (hasG && lines.length) ? 10 : 0;
    var blockH = (hasG ? r*2 : 0) + gap + textH;
    var widest = 0;
    lines.forEach(function (l){ widest = Math.max(widest, ctx.measureText(l).width); });
    var blockW = Math.max(hasG ? r*2 : 0, widest);

    var top = d.y - blockH/2;

    if (hasG) { drawGraphic(d.x, top + r, r, d.ink); top += r*2 + gap; }
    if (lines.length) {
      ctx.fillStyle = d.ink; ctx.textAlign = "center"; ctx.textBaseline = "top";
      lines.forEach(function (l, i){ ctx.fillText(l, d.x, top + i*lh); });
    }

    lastBox = { x: d.x - blockW/2 - 10, y: d.y - blockH/2 - 10,
                w: blockW + 20, h: blockH + 20 };

    if (dragging || canvas.matches(":focus-visible")) {   // show the print window while moving
      ctx.save();
      ctx.strokeStyle = "rgba(255,230,0,.9)"; ctx.setLineDash([5,4]); ctx.lineWidth = 1.4;
      ctx.strokeRect(a.x, a.y, a.w, a.h);
      ctx.restore();
    }
  }

  function draw() {
    drawGarment();
    drawArtwork();
    publish();
    if (onChange) onChange();
  }

  function publish() {
    var sides = {};
    VIEWS.forEach(function (v) {
      var d = state.views[v];
      var printed = (d.text || "").trim() !== "" || d.graphic !== "None";
      if (printed) sides[v] = { text:(d.text||"").trim(), font:d.font, graphic:d.graphic, ink:d.ink };
    });
    window.SHIRT = { shirt: state.shirt, sides: sides, sideCount: Object.keys(sides).length };
  }

  /* ---------- dragging ---------- */
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function clamp() {
    var d = cur(), a = AREA[state.view];
    d.x = Math.max(a.x + 12, Math.min(a.x + a.w - 12, d.x));
    d.y = Math.max(a.y + 12, Math.min(a.y + a.h - 12, d.y));
  }

  function initDrag() {
    canvas.addEventListener("pointerdown", function (e) {
      var p = pos(e);
      if (!lastBox) return;
      if (p.x >= lastBox.x && p.x <= lastBox.x + lastBox.w &&
          p.y >= lastBox.y && p.y <= lastBox.y + lastBox.h) {
        dragging = true;
        grab.x = p.x - cur().x; grab.y = p.y - cur().y;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
        draw();
      }
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = pos(e);
      if (dragging) {
        cur().x = p.x - grab.x; cur().y = p.y - grab.y;
        clamp(); draw();
      } else if (lastBox) {
        var over = p.x >= lastBox.x && p.x <= lastBox.x + lastBox.w &&
                   p.y >= lastBox.y && p.y <= lastBox.y + lastBox.h;
        canvas.style.cursor = over ? "grab" : "default";
      }
    });
    ["pointerup","pointercancel"].forEach(function (ev) {
      canvas.addEventListener(ev, function () {
        if (!dragging) return;
        dragging = false; canvas.style.cursor = "grab"; draw();
      });
    });
    // keyboard: nudge the artwork so this is usable without a mouse
    canvas.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 10 : 2, d = cur(), used = true;
      if (e.key === "ArrowLeft") d.x -= step;
      else if (e.key === "ArrowRight") d.x += step;
      else if (e.key === "ArrowUp") d.y -= step;
      else if (e.key === "ArrowDown") d.y += step;
      else used = false;
      if (used) { e.preventDefault(); clamp(); draw(); }
    });
  }

  /* ---------- controls ---------- */
  function syncControls() {
    var d = cur();
    var t = document.querySelector("#shirt-text");   if (t) t.value = d.text;
    var f = document.querySelector("#shirt-font");   if (f) f.value = d.font;
    var z = document.querySelector("#shirt-size");   if (z) z.value = d.size;
    var g = document.querySelector("#shirt-gscale"); if (g) g.value = d.gscale;
    document.querySelectorAll("[data-ink]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.ink.toLowerCase() === d.ink.toLowerCase()));
    });
    document.querySelectorAll("[data-graphic]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.graphic === d.graphic));
    });
    document.querySelectorAll("[data-view]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    });
    document.querySelectorAll("[data-shirt]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.shirt === state.shirt));
    });
  }

  function init(opts) {
    canvas = document.querySelector(opts.canvas);
    if (!canvas) return;
    onChange = opts.onChange || null;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.maxWidth = W + "px"; canvas.style.height = "auto";
    canvas.tabIndex = 0;
    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    document.querySelectorAll("[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { state.view = b.dataset.view; syncControls(); draw(); });
    });
    document.querySelectorAll("[data-shirt]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.shirt = b.dataset.shirt;
        var auto = SHIRTS[state.shirt].ink;
        VIEWS.forEach(function (v) { state.views[v].ink = auto; });
        syncControls(); draw();
      });
    });
    document.querySelectorAll("[data-ink]").forEach(function (b) {
      b.addEventListener("click", function () { cur().ink = b.dataset.ink; syncControls(); draw(); });
    });
    document.querySelectorAll("[data-graphic]").forEach(function (b) {
      b.addEventListener("click", function () { cur().graphic = b.dataset.graphic; syncControls(); draw(); });
    });

    var t = document.querySelector(opts.text);
    if (t) t.addEventListener("input", function () { cur().text = t.value; draw(); });
    var f = document.querySelector(opts.font);
    if (f) f.addEventListener("change", function () { cur().font = f.value; draw(); });
    var z = document.querySelector(opts.size);
    if (z) z.addEventListener("input", function () { cur().size = Number(z.value); draw(); });
    var g = document.querySelector(opts.gscale);
    if (g) g.addEventListener("input", function () { cur().gscale = Number(g.value); draw(); });

    var centre = document.querySelector(opts.centre);
    if (centre) centre.addEventListener("click", function () {
      var a = AREA[state.view], d = cur();
      d.x = a.x + a.w/2; d.y = a.y + a.h/2; draw();
    });
    var copy = document.querySelector(opts.copy);
    if (copy) copy.addEventListener("click", function () {
      var src = state.views.front, tgt = state.views.back;
      tgt.text = src.text; tgt.font = src.font; tgt.size = src.size;
      tgt.ink = src.ink; tgt.graphic = src.graphic; tgt.gscale = src.gscale;
      state.view = "back"; syncControls(); draw();
    });
    var clear = document.querySelector(opts.clear);
    if (clear) clear.addEventListener("click", function () {
      state.views[state.view] = blankView(state.view);
      state.views[state.view].text = "";
      state.views[state.view].graphic = "None";
      syncControls(); draw();
    });

    initDrag();
    syncControls();
    draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }

  return { init: init, state: function () { return state; } };
})();
