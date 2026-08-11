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
        header: "Friday 11:52 pm &nbsp;·&nbsp; kitchen closed",
        lines: [
          { side: "in",  text: "what y'all have tonight?", stamp: "11:52 pm" },
          { side: "out", text: "Kitchen shut at 11 — but here's tomorrow's menu, and I can put you first 👇", stamp: "11:52 pm", think: 900 },
          { album: [
              { img: "assets/img/hero/food-1.webp", label: "A1", name: "Snapper crudo", price: "$38" },
              { img: "assets/img/hero/food-2.webp", label: "A2", name: "Hand-rolled pasta", price: "$46" },
              { img: "assets/img/hero/food-3.webp", label: "A3", name: "Aged beef", price: "$64" }
            ] },
          { gap: "no reply &nbsp;·&nbsp; 14 minutes later" },
          { side: "out", text: "Still there? 😊 Just send me the code under the one you want and I'll hold it for tomorrow.", stamp: "12:06 am", think: 900 },
          { side: "in",  text: "A3 for 2", stamp: "12:07 am" },
          { side: "out", text: "Held — 2 × aged beef, $128, collection 8pm tomorrow. I'll message you when they're up.", stamp: "12:07 am", think: 1000 }
        ]
      },
      {
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
          { side: "out", text: "Booked — colour & gloss, Tuesday 9am with Keva. $45 deposit holds the room, sending details now.", stamp: "7:27 am", think: 1000 }
        ]
      },
      {
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
          { side: "out", text: "Still looking? 🚗 Send the code and I'll hold it — airport pickup is $15.", stamp: "2:52 pm", think: 900 },
          { side: "in",  text: "A2 for 5 days from the airport", stamp: "2:53 pm" },
          { side: "out", text: "Held — Corolla, 5 days, airport pickup. $340 all in. Confirmation coming now.", stamp: "2:53 pm", think: 1000 }
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
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".chat-tab"));
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

    function play(index) {
      timers.forEach(clearTimeout);
      timers = [];

      var convo = convos[index];
      chat.innerHTML = "";
      chat.appendChild(header(convo.header));

      tabs.forEach(function (t, i) {
        t.setAttribute("aria-pressed", String(i === index));
      });

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
