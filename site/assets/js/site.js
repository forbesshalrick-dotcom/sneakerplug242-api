/* Nightshift — site behaviour.
   Four jobs: the mobile nav, the hero conversation, the contact form, and a
   one-line page counter. Everything is optional — nothing here is required for
   the page to work. */

(function () {
  "use strict";

  /* ---- 1. mobile nav ---------------------------------------------------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", String(!open));
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.textContent = open ? "Menu" : "Close";
    });
  }

  /* ---- 2. the hero conversation ----------------------------------------- */
  /* The home page shows three different trades, because the visitor is a
     restaurant or a salon, not a sneaker shop. The case study keeps the
     sneaker conversation — that page is the proof, so it has to be ours. */

  /* Each one shows the two moves that actually earn the money: it puts the
     PICTURES up with a code under each, and when the customer goes quiet it
     follows up by itself. A wall of text never sold anybody anything. */

  var DEMOS = {
    trades: [
      {
        tab: "Restaurant",
        header: "Friday 10:38 pm &nbsp;·&nbsp; kitchen closes at 11",
        lines: [
          { side: "in",  text: "y'all still open?", stamp: "10:38 pm" },
          { side: "out", text: "Twenty minutes left on the kitchen — here's what's still going 👇", stamp: "10:38 pm", think: 800 },
          { album: [
              { img: "assets/img/hero/food-1.webp", label: "A1", name: "Snapper crudo", price: "$38" },
              { img: "assets/img/hero/food-2.webp", label: "A2", name: "Hand-rolled pasta", price: "$46" },
              { img: "assets/img/hero/food-3.webp", label: "A3", name: "Aged beef", price: "$64" }
            ] },
          { side: "in",  text: "A3 for 2", stamp: "10:40 pm" },
          { side: "out", text: "2 × aged beef, $128. Ready in about 25 minutes. Pay now or when you collect?", stamp: "10:40 pm", think: 900 },
          { side: "in",  text: "what do you accept", stamp: "10:41 pm" },
          { side: "out", text: "Card on our site, CIBC or Scotiabank transfer, or cash at the door — whichever's easiest.", stamp: "10:41 pm", think: 800 },
          { side: "in",  text: "scotia", stamp: "10:41 pm" },
          { side: "out", text: "Scotiabank 👍 Blue Hole Ltd, account 8033-1174. Send the receipt back here and I'll have it boxed and waiting.", stamp: "10:41 pm", think: 900 },
          { side: "in",  text: "sent it", stamp: "10:44 pm" },
          { side: "out", text: "Got it — payment in ✅ Kitchen has your order. I'll message you the moment it's ready.", stamp: "10:44 pm", think: 800 },
          { gap: "25 minutes later" },
          { side: "out", text: "Ready 🍽 come to the kitchen door and somebody will bring it straight out.", stamp: "11:06 pm", think: 800 }
        ]
      },
      {
        tab: "Fast food",
        header: "Saturday 1:47 am &nbsp;·&nbsp; last orders",
        lines: [
          { side: "in",  text: "wa y'all still open", stamp: "1:47 am" },
          { side: "out", text: "Till 2 🍗 kitchen takes its last order in about ten minutes. Here's the board 👇", stamp: "1:47 am", think: 800 },
          { album: [
              { img: "assets/img/hero/bfc-1.webp", label: "A2", name: "Family Bucket", price: "$34" },
              { img: "assets/img/hero/bfc-2.webp", label: "A5", name: "Sticky Wings", price: "$13.50" },
              { img: "assets/img/hero/bfc-3.webp", label: "A7", name: "Wing Party", price: "$29" }
            ] },
          { side: "in",  text: "a 5 and a 7, fries with both, sea breeze", stamp: "1:49 am" },
          { side: "out", text: "Got it — Sticky Wings and a Wing Party, both fries. BBQ or jerk on the wings?", stamp: "1:49 am", think: 900 },
          { side: "in",  text: "jerk", stamp: "1:50 am" },
          { side: "out", text: "$49.00 with delivery 🛵 Sea Breeze is a big area though — drop me a pin 📍 so the driver comes straight to you.", stamp: "1:50 am", think: 900 },
          { side: "in",  text: "📍 Location", stamp: "1:50 am" },
          { side: "out", text: "Got you — off Prince Charles by the pink church. Kitchen's on it. Cash to the driver or transfer now?", stamp: "1:50 am", think: 900 },
          { side: "in",  text: "cash", stamp: "1:51 am" },
          { gap: "order in &nbsp;·&nbsp; 9 minutes later" },
          { side: "out", text: "Food's boxed and the driver just pulled off 🛵 $49 cash — he'll call you when he's outside.", stamp: "1:59 am", think: 800 }
        ]
      },
      {
        tab: "Salon",
        header: "Sunday 7:04 am &nbsp;·&nbsp; salon closed",
        lines: [
          { side: "in",  text: "yall open today?", stamp: "7:04 am" },
          { side: "out", text: "Closed Sundays — Tuesday 9am is open though. Here's what we do 👇", stamp: "7:04 am", think: 900 },
          { album: [
              { img: "assets/img/hero/salon-1.webp", label: "A1", name: "Colour & gloss", price: "$180" },
              { img: "assets/img/hero/salon-2.webp", label: "A2", name: "Signature facial", price: "$140" },
              { img: "assets/img/hero/salon-3.webp", label: "A3", name: "Hot stone 90", price: "$210" }
            ] },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 20 minutes later" },
          { side: "out", text: "No rush at all 🌿 whenever you're ready, send me the code and I'll hold Tuesday for you.", stamp: "7:26 am", think: 900 },
          { side: "in",  text: "A1 tuesday", stamp: "7:27 am" },
          { side: "out", text: "Booked — colour & gloss, Tuesday 9am with Keva 💫 A $45 deposit makes it a priority reservation. Card on our website, CIBC or Scotiabank?", stamp: "7:27 am", think: 1000 },
          { side: "in",  text: "scotia", stamp: "7:28 am" },
          { side: "out", text: "Scotiabank 👍 Sunset Hair & Spa · account 800471629. Send the screenshot back here and I'll lock Tuesday in.", stamp: "7:28 am", think: 900 },
          { side: "in",  text: "[receipt]", stamp: "7:31 am" },
          { side: "out", text: "Got it ✅ Deposit received, Tuesday 9am is yours. I'll remind you Monday evening.", stamp: "7:31 am", think: 900 }
        ]
      },
      {
        tab: "Car hire",
        header: "Wednesday 2:40 pm &nbsp;·&nbsp; counter is slammed",
        lines: [
          { side: "in",  text: "you got anything for the week?", stamp: "2:40 pm" },
          { side: "out", text: "Yes — this is what's on the lot today 👇", stamp: "2:40 pm", think: 900 },
          { album: [
              { img: "assets/img/hero/car-1.webp", label: "A1", name: "Honda Fit", price: "$55/day" },
              { img: "assets/img/hero/car-2.webp", label: "A2", name: "Toyota Corolla", price: "$65/day" },
              { img: "assets/img/hero/car-3.webp", label: "A3", name: "Jeep Wrangler", price: "$95/day" }
            ] },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 11 minutes later" },
          { side: "out", text: "Still looking? 🚗 Send the code and I'll hold it — we bring it to you and collect it after, $15 flat.", stamp: "2:52 pm", think: 900 },
          { side: "in",  text: "A2 for 5 days, bring it to my house", stamp: "2:53 pm" },
          { side: "out", text: "Held ✅ Corolla, 5 days, delivered and collected — $340 all in. How you prefer to pay? Card on our site, CIBC or Scotiabank.", stamp: "2:53 pm", think: 1000 },
          { side: "in",  text: "you accept island luck?", stamp: "2:54 pm" },
          { side: "out", text: "Yes we do 👍 Island Luck — name Out Island Auto, account 448192. Send the receipt back here and I'll confirm right away.", stamp: "2:54 pm", think: 900 },
          { gap: "no receipt yet &nbsp;·&nbsp; follow-up, 40 minutes later" },
          { side: "out", text: "No rush 🚗 just checking the Corolla's still yours — it's held till the end of the day, then it goes back on the lot.", stamp: "3:34 pm", think: 900 },
          { side: "in",  text: "[receipt]", stamp: "3:36 pm" },
          { side: "out", text: "Payment in ✅ Keys are set aside in your name. Friday 8am at your place — the driver calls when he's outside.", stamp: "3:36 pm", think: 900 }
        ]
      },
      {
        tab: "Ride share",
        header: "Sunday 1:12 am &nbsp;·&nbsp; nobody at the desk",
        lines: [
          { side: "in",  text: "how much from the airport to atlantis", stamp: "1:12 am" },
          { side: "out", text: "Airport Run to Atlantis is $33 flat, about 26 min 🚗 We meet you at arrivals — got a flight number?", stamp: "1:12 am", think: 900 },
          { side: "in",  text: "yeah BA253", stamp: "1:13 am" },
          { side: "out", text: "Tracking it — if you're late the car waits. Sending one now.", stamp: "1:13 am", think: 800 },
          { side: "out", text: "Car's on the way ✅ Marlon, red Toyota Corolla, plate 242-1487. 3 minutes away.", stamp: "1:14 am", think: 900 },
          { gap: "5 minutes later" },
          { side: "out", text: "He's caught a bit of traffic — give him two more minutes 🙏 he's nearly there.", stamp: "1:19 am", think: 800 },
          { side: "out", text: "He's outside now — red Corolla, 242-1487, by the arrivals doors 🚗", stamp: "1:22 am", think: 800 },
          { gap: "trip finished &nbsp;·&nbsp; follow-up, 40 minutes later" },
          { side: "out", text: "Hope Marlon got you there safe 🙏 $33 paid, receipt's in the app. Want me to book the run back to the airport now?", stamp: "2:02 am", think: 900 }
        ]
      },
      {
        tab: "Shipping",
        header: "Tuesday 6:12 pm &nbsp;·&nbsp; counter closed at 5",
        lines: [
          /* The forwarder speaks FIRST. A customer waiting on a package they
             already paid for does not want a portal — they want to be told it
             arrived, and to see it. So: the photo of the actual box, then the
             one thing customs needs. */
          { side: "out", text: "Your box landed in Miami 📦 S242-4471, 9 lb — going on Friday's air run.", stamp: "6:12 pm", think: 900 },
          { photo: { img: "assets/img/hero/ship-parcel.webp", alt: "The package that arrived, labelled S242-4471", cap: "Photographed at the Miami warehouse" } },
          { side: "out", text: "One thing before customs 🧾 snap the order page from Amazon — the bit with the price — and send it here. I clear it for you so you're not standing at customs yourself.", stamp: "6:13 pm", think: 1000 },
          { gap: "no reply &nbsp;·&nbsp; follow-up, next morning" },
          { side: "out", text: "Morning 🙂 still need that receipt for S242-4471. Without it customs values the box themselves, and that's nearly always dearer.", stamp: "8:40 am", think: 900 },
          { side: "in",  text: "[screenshot]", stamp: "8:52 am" },
          { side: "out", text: "Perfect 👍 that's all I need. Cleared and paid: freight $31.50 plus $15 clearing. Bay Street from 8am, or I send it to you for $12.", stamp: "8:52 am", think: 1000 },
          { side: "in",  text: "send it", stamp: "8:54 am" },
          { side: "out", text: "Done. One thing — first collection needs a government photo ID 🪪 passport, licence or NIB card. Just the once.", stamp: "8:54 am", think: 900 },
          { gap: "same day &nbsp;·&nbsp; 2:20 pm" },
          { side: "out", text: "On the van 🚚 the driver will call you when he's close — no tracking number for a local run, he just rings you.", stamp: "2:20 pm", think: 900 }
        ]
      },
      {
        tab: "Print shop",
        header: "Monday 8:12 pm &nbsp;·&nbsp; shop closed",
        lines: [
          { side: "in",  text: "30 shirts by wednesday possible?", stamp: "8:12 pm" },
          { side: "out", text: "Wednesday's under 48 hours from when we open, so that's rush — 25% on top. Doable though. 30 shirts puts you at $15 each.", stamp: "8:12 pm", think: 1000 },
          { side: "in",  text: "front and back", stamp: "8:14 pm" },
          { side: "out", text: "Front and back is $4 more a shirt. So $570 all in, ready Wednesday. Send the artwork or build it on the site and I'll get you on the run.", stamp: "8:14 pm", think: 1000 },
          { gap: "artwork in &nbsp;·&nbsp; next morning" },
          { side: "out", text: "Digital proof coming over now 👀 nothing touches a shirt until you say yes.", stamp: "9:20 am", think: 900 },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 3 hours later" },
          { side: "out", text: "Still need a yes on that proof 🖨 the press is free this afternoon — after that Wednesday gets tight.", stamp: "12:18 pm", think: 900 },
          { side: "in",  text: "yes go ahead", stamp: "12:25 pm" },
          { side: "out", text: "On the press 🔥 30 shirts, front and back, $570. Ready Wednesday — I'll message you when they're boxed.", stamp: "12:25 pm", think: 900 }
        ]
      },
      {
        tab: "Real estate",
        header: "Thursday 10:48 pm &nbsp;·&nbsp; office closed at nine",
        lines: [
          { side: "in",  text: "looking for a private cay, under 10", stamp: "10:48 pm" },
          { side: "out", text: "Two in the portfolio fit that. One is not published anywhere.", stamp: "10:48 pm", think: 1000 },
          { album: [
              { img: "assets/img/hero/est-1.webp", label: "A1", name: "Over-water pavilion", price: "$14.5m" },
              { img: "assets/img/hero/est-2.webp", label: "A2", name: "Palm court villa", price: "$6.75m" },
              { img: "assets/img/hero/est-3.webp", label: "A3", name: "Cliff terrace", price: "$9.4m" }
            ] },
          { side: "in",  text: "the unpublished one", stamp: "10:51 pm" },
          { side: "out", text: "That one is released under NDA only. I can have a partner send it across tomorrow morning, or arrange a viewing — there is a boat for the cays.", stamp: "10:51 pm", think: 1100 },
          { side: "in",  text: "send the NDA", stamp: "10:53 pm" },
          { side: "out", text: "Sent to your email. A partner will call once it is back — he handles the cays himself.", stamp: "10:53 pm", think: 1000 },
          { gap: "not signed &nbsp;·&nbsp; follow-up, next afternoon" },
          { side: "out", text: "No pressure at all. The NDA is still open, and the boat goes out Thursday if you would rather see it before reading anything.", stamp: "2:40 pm", think: 1000 }
        ]
      }
    ],
    sneakers: [
      {
        header: "Live &nbsp;·&nbsp; 2:14 am &nbsp;·&nbsp; nobody awake",
        lines: [
          { side: "in",  text: "yo you have F6 in a 10?", stamp: "2:14 am" },
          { side: "out", text: "Yes — F6, Jordan 4 Military Black. Size 10 in stock. $185.", stamp: "2:14 am", think: 900 },
          { side: "in",  text: "aight I want it", stamp: "2:15 am" },
          { side: "out", text: "Locked in 👌 Sending bank details now. Delivery today — Nassau is free.", stamp: "2:15 am", think: 1100 }
        ]
      }
    ]
  };

  var chat = document.getElementById("chat");
  if (chat) {
    var convos = DEMOS[chat.dataset.demo] || DEMOS.sneakers;
    var tabStrip = document.querySelector(".chat-tabs");
    var tabs = [];

    /* The strip is written by the data, not by hand — there are eight trades
       now and the markup only ever listed three. Adding a ninth is one entry
       in DEMOS, nothing else. */
    if (tabStrip && convos.length && convos[0].tab) {
      tabStrip.innerHTML = "";
      convos.forEach(function (c, i) {
        var b = document.createElement("button");
        b.className = "chat-tab";
        b.type = "button";
        b.textContent = c.tab;
        b.setAttribute("aria-pressed", String(i === 0));
        b.setAttribute("data-convo", String(i));
        tabStrip.appendChild(b);
        tabs.push(b);
      });
    } else {
      tabs = Array.prototype.slice.call(document.querySelectorAll(".chat-tab"));
    }
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var timers = [];

    function header(html) {
      var hd = document.createElement("div");
      hd.className = "chat-hd";
      hd.innerHTML = '<span class="live-dot"></span> ' + html;
      return hd;
    }

    /* the photo options, with a short code under each — the customer answers
       with two characters instead of describing what they want */
    function albumOf(items) {
      var wrap = document.createElement("div");
      wrap.className = "chat-album";
      items.forEach(function (it) {
        var fig = document.createElement("figure");
        var im = document.createElement("img");
        im.src = it.img; im.alt = it.name; im.width = 190; im.height = 190; im.loading = "lazy"; im.decoding = "async";
        var cap = document.createElement("figcaption");
        var b = document.createElement("b"); b.textContent = it.label;
        var s = document.createElement("span"); s.textContent = it.name + " · " + it.price;
        cap.appendChild(b); cap.appendChild(s);
        fig.appendChild(im); fig.appendChild(cap);
        wrap.appendChild(fig);
      });
      chat.appendChild(wrap);
      follow();
    }

    /* One photo on its own, not a 3-up album. The forwarder sends a picture of
       the actual box that landed, which is the moment a customer relaxes. */
    function photoOf(it) {
      var fig = document.createElement("figure");
      fig.className = "chat-photo";
      var im = document.createElement("img");
      im.src = it.img; im.alt = it.alt || ""; im.width = 380; im.height = 380;
      im.loading = "lazy"; im.decoding = "async";
      fig.appendChild(im);
      if (it.cap) {
        var c = document.createElement("figcaption");
        c.textContent = it.cap;
        fig.appendChild(c);
      }
      chat.appendChild(fig);
      follow();
    }

    /* the silence. This is the bit business owners recognise instantly —
       the customer stops replying, and normally that is where the sale dies. */
    function gapOf(html) {
      var g = document.createElement("p");
      g.className = "chat-gap";
      g.innerHTML = html;
      chat.appendChild(g);
      follow();
    }

    function bubble(line) {
      if (line.album) return albumOf(line.album);
      if (line.photo) return photoOf(line.photo);
      if (line.gap) return gapOf(line.gap);
      var el = document.createElement("div");
      el.className = "msg " + line.side;
      var body = document.createElement("span");
      body.textContent = line.text;
      el.appendChild(body);
      if (line.stamp) {
        var stamp = document.createElement("span");
        stamp.className = "stamp";
        stamp.textContent = line.stamp;
        el.appendChild(stamp);
      }
      chat.appendChild(el);
      follow();
    }

    /* keep the newest line in view as the thread grows, the way a phone does */
    function follow() {
      chat.scrollTop = chat.scrollHeight;
    }

    var active = 0;

    function play(index) {
      active = index;
      timers.forEach(clearTimeout);
      timers = [];

      var convo = convos[index];
      chat.innerHTML = "";
      chat.appendChild(header(convo.header));

      tabs.forEach(function (t, i) {
        t.setAttribute("aria-pressed", String(i === index));
      });
      /* on a phone the strip scrolls, so drag the live tab into view */
      if (tabs[index] && tabStrip && tabStrip.scrollWidth > tabStrip.clientWidth) {
        var t = tabs[index], strip = tabStrip;
        var left = t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2;
        strip.scrollTo({ left: Math.max(0, left), behavior: reduced ? "auto" : "smooth" });
      }

      if (reduced) {
        convo.lines.forEach(bubble);
        return;
      }

      var i = 0;
      var step = function () {
        if (i >= convo.lines.length) return;
        var line = convo.lines[i++];

        /* let the silence sit for a second — that pause IS the pitch */
        if (line.gap) {
          bubble(line);
          timers.push(setTimeout(step, 1400));
          return;
        }
        if (line.album || line.photo) {
          bubble(line);
          timers.push(setTimeout(step, 1100));
          return;
        }
        if (line.side === "out" && line.think) {
          var dots = document.createElement("div");
          dots.className = "typing";
          dots.setAttribute("aria-hidden", "true");
          dots.innerHTML = "<i></i><i></i><i></i>";
          chat.appendChild(dots);
          follow();
          timers.push(setTimeout(function () {
            dots.remove();
            bubble(line);
            timers.push(setTimeout(step, 850));
          }, line.think));
        } else {
          bubble(line);
          timers.push(setTimeout(step, 700));
        }
      };
      timers.push(setTimeout(step, 400));
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        play(parseInt(tab.dataset.convo, 10) || 0);
      });
    });


    /* Swipe the conversation to change trade. A visitor on a phone should be
       able to flick through the eight the way they flick through anything
       else — the tab strip alone means hunting for a small target. */
    (function () {
      var x0 = null, y0 = null, locked = false;
      chat.addEventListener("touchstart", function (e) {
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; locked = false;
      }, { passive: true });
      chat.addEventListener("touchmove", function (e) {
        if (x0 === null || locked) return;
        var dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
        /* only claim the gesture once it is clearly sideways, so scrolling
           the page down the screen still works normally */
        if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) {
          locked = true;
          go(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
      chat.addEventListener("touchend", function () { x0 = null; }, { passive: true });

      chat.setAttribute("tabindex", "0");
      chat.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      });

      function go(d) {
        var next = (active + d + convos.length) % convos.length;
        play(next);
      }
    })();

    play(0);
  }

  /* ---- 3. contact form -------------------------------------------------- */
  /* No server. The form composes a WhatsApp message and hands it to the
     phone, so an inquiry lands in the same inbox as everything else.
     If the page is ever hosted on Netlify the form POSTs normally instead. */
  var form = document.getElementById("start-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      if (form.getAttribute("data-mode") !== "whatsapp") return;
      e.preventDefault();

      if (form.querySelector(".hp input").value) return; // bot filled the honeypot

      var get = function (name) {
        var el = form.elements[name];
        return el && el.value ? el.value.trim() : "";
      };

      var parts = [
        "Hi, I'd like to talk about a website for my business.",
        "",
        "Business: " + get("business"),
        "Name: " + get("name"),
        "What I sell: " + get("sells"),
        "Where orders come from now: " + get("channel"),
        "Budget range: " + get("budget"),
        "Biggest headache: " + get("pain")
      ];

      var url = "https://wa.me/" + form.dataset.number +
                "?text=" + encodeURIComponent(parts.join("\n"));
      window.open(url, "_blank", "noopener");

      var done = document.getElementById("form-done");
      if (done) {
        done.hidden = false;
        done.focus();
      }
    });
  }
  /* ---- 4. the page counter ---------------------------------------------- */
  /* One beacon per page view to our own server. No cookie, no third-party
     script, nothing that can block the page — it is fire-and-forget, and if the
     endpoint is down nobody ever knows. See visits.js on the API for what is
     actually stored (short answer: a count, and a number that stands in for a
     visitor for one day). */
  var PX = "https://242plug.com/px";

  function px(payload) {
    try {
      payload.p = payload.p || location.pathname;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(PX, new Blob([body], { type: "application/json" }));
      } else {
        fetch(PX, { method: "POST", headers: { "Content-Type": "application/json" },
                    body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* never worth breaking a page over */ }
  }

  px({ r: document.referrer || "" });
  window.nsCount = px;               // demo pages call this for their own events

  /* Which demo somebody actually opened is the number worth having — it says
     which trade to chase next. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href*='demos/']");
    if (!a) return;
    var m = a.getAttribute("href").match(/demos\/([a-z-]+)\//);
    if (m) px({ e: "open-demo", d: m[1] });
  }, true);
})();
