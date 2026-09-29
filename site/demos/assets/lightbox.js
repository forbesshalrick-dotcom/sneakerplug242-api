/* ==========================================================================
   Lightbox — click any gallery image and it fills the screen.

   Opt in by putting data-lightbox="<group>" on an <img> (or on a wrapper that
   contains one). Everything in the same group becomes one set you can page
   through with the arrows, the keyboard or a swipe.
   ========================================================================== */

(function () {
  "use strict";

  var groups = {};      // name -> [{src, cap}]
  var box, imgEl, capEl, countEl, current = [], index = 0, lastFocus = null;

  function build() {
    if (box) return;
    box = document.createElement("div");
    box.className = "lb";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Image viewer");
    box.innerHTML =
      '<button class="lb-x" type="button" aria-label="Close viewer">&times;</button>' +
      '<button class="lb-nav lb-prev" type="button" aria-label="Previous image">&#8249;</button>' +
      '<figure class="lb-stage"><img alt=""><figcaption></figcaption></figure>' +
      '<button class="lb-nav lb-next" type="button" aria-label="Next image">&#8250;</button>' +
      '<span class="lb-count" aria-hidden="true"></span>';
    document.body.appendChild(box);

    imgEl = box.querySelector("img");
    capEl = box.querySelector("figcaption");
    countEl = box.querySelector(".lb-count");

    box.querySelector(".lb-x").addEventListener("click", close);
    box.querySelector(".lb-prev").addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
    box.querySelector(".lb-next").addEventListener("click", function (e) { e.stopPropagation(); step(1); });
    box.addEventListener("click", function (e) { if (e.target === box || e.target.classList.contains("lb-stage")) close(); });

    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("on")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });

    // swipe on a phone
    var x0 = null;
    box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
      x0 = null;
    }, { passive: true });
  }

  function show(i) {
    index = (i + current.length) % current.length;
    var it = current[index];
    imgEl.classList.remove("in");
    var pre = new Image();
    pre.onload = function () {
      imgEl.src = it.src;
      imgEl.alt = it.cap || "";
      capEl.textContent = it.cap || "";
      countEl.textContent = (index + 1) + " / " + current.length;
      requestAnimationFrame(function () { imgEl.classList.add("in"); });
    };
    pre.src = it.src;
    var many = current.length > 1;
    box.querySelector(".lb-prev").hidden = !many;
    box.querySelector(".lb-next").hidden = !many;
    countEl.hidden = !many;
  }

  function step(d) { show(index + d); }

  function open(group, i) {
    build();
    current = groups[group] || [];
    if (!current.length) return;
    lastFocus = document.activeElement;
    box.classList.add("on");
    document.documentElement.style.overflow = "hidden";
    show(i);
    box.querySelector(".lb-x").focus();
  }

  function close() {
    box.classList.remove("on");
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function collect() {
    groups = {};
    document.querySelectorAll("[data-lightbox]").forEach(function (node) {
      var g = node.dataset.lightbox;
      var img = node.tagName === "IMG" ? node : node.querySelector("img");
      if (!img) return;
      var full = node.dataset.full || img.currentSrc || img.src;
      var cap = node.dataset.caption ||
                (node.querySelector && node.querySelector("figcaption") ? node.querySelector("figcaption").textContent.trim() : "") ||
                img.alt || "";
      groups[g] = groups[g] || [];
      var i = groups[g].length;
      groups[g].push({ src: full, cap: cap });

      var trigger = node;
      trigger.style.cursor = "zoom-in";
      if (!trigger.hasAttribute("tabindex") && !/^(A|BUTTON)$/.test(trigger.tagName)) trigger.tabIndex = 0;
      if (!trigger.hasAttribute("role") && !/^(A|BUTTON)$/.test(trigger.tagName)) trigger.setAttribute("role", "button");
      if (!trigger.hasAttribute("aria-label")) trigger.setAttribute("aria-label", "Open " + (cap || "image") + " full screen");

      trigger.addEventListener("click", function (e) { e.preventDefault(); open(g, i); });
      trigger.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(g, i); }
      });
    });
  }

  window.Lightbox = { open: open, refresh: collect };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", collect);
  else collect();
})();
