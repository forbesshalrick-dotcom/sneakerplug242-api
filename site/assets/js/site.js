/* Nightshift — site behaviour.
   Three jobs: the mobile nav, the hero conversation, the contact form.
   Everything is optional — nothing here is required for the page to work. */

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
          { gap: "no reply &nbsp;·&nbsp; 20 minutes later" },
          { side: "out", text: "No rush at all 🌿 whenever you're ready, send me the code and I'll hold Tuesday for you.", stamp: "7:26 am", think: 900 },
          { side: "in",  text: "A1 tuesday", stamp: "7:27 am" },
          { side: "out", text: "Booked — colour & gloss, Tuesday 9am with Keva. A $45 deposit makes it a priority reservation, sending the details now.", stamp: "7:27 am", think: 1000 }
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
          { gap: "no reply &nbsp;·&nbsp; 11 minutes later" },
          { side: "out", text: "Still looking? 🚗 Send the code and I'll hold it — we bring it to you and collect it after, $15 flat.", stamp: "2:52 pm", think: 900 },
          { side: "in",  text: "A2 for 5 days, bring it to my house. island luck", stamp: "2:53 pm" },
          { side: "out", text: "Held — Corolla, 5 days, delivered and collected. $340 all in. Island Luck: name Out Island Auto, account 448192.", stamp: "2:53 pm", think: 1000 }
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
          { side: "out", text: "He's caught a bit of traffic — give him two more minutes 🙏 he's nearly there.", stamp: "1:19 am", think: 800 }
        ]
      },
      {
        tab: "Shipping",
        header: "Tuesday 9:31 pm &nbsp;·&nbsp; counter closed at 5",
        lines: [
          { side: "in",  text: "is my package here yet? S242-4471", stamp: "9:31 pm" },
          { side: "out", text: "Cleared and ready ✅ 9 lb, air freight $31.50 plus $15 clearing. We're shut now — come by Bay Street from 8am, or I can send it to you for $12.", stamp: "9:31 pm", think: 1000 },
          { side: "in",  text: "send it", stamp: "9:32 pm" },
          { side: "out", text: "Done. One thing — first collection needs a government photo ID 🪪 passport, licence or NIB card. Just the once.", stamp: "9:32 pm", think: 900 },
          { gap: "next morning &nbsp;·&nbsp; 10:04 am" },
          { side: "out", text: "On the van 🚚 the driver will call you when he's close — no tracking number for a local run, he just rings you.", stamp: "10:04 am", think: 900 }
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
          { side: "out", text: "Digital proof coming over now 👀 nothing touches a shirt until you say yes.", stamp: "9:20 am", think: 900 }
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
          { side: "out", text: "That one is released under NDA only. I can have a partner send it across tomorrow morning, or arrange a viewing — there is a boat for the cays.", stamp: "10:51 pm", think: 1100 }
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
        if (line.album) {
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
})();
