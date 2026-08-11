/* ==========================================================================
   DemoBot — the order-taking bot used by all four preview sites.

   It is a small state machine, not a canned animation: the visitor really
   answers, the answers really accumulate, and a real total gets printed at
   the end. That is the whole sales argument, so it has to actually work.

   Each demo supplies its own steps and its own summarise() — the engine
   knows nothing about cars, food, hair or t-shirts.
   ========================================================================== */

window.DemoBot = (function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function money(cur, n) {
    return cur + Number(n).toFixed(2).replace(/\.00$/, "");
  }

  function start(cfg) {
    var root = document.querySelector(cfg.mount);
    if (!root) return;

    var log, chips, entry, input;
    var answers = {};
    var stepIndex = 0;
    var busy = false;

    /* ---- build the shell ------------------------------------------------ */
    function build() {
      root.innerHTML = "";

      var hd = el("div", "bot-hd");
      hd.appendChild(el("span", "dot"));
      hd.appendChild(el("span", null, cfg.botName || "Assistant"));
      var sub = el("span", "sub", cfg.channel || "WhatsApp");
      hd.appendChild(sub);

      log = el("div", "bot-log");
      log.setAttribute("role", "log");
      log.setAttribute("aria-live", "polite");
      log.setAttribute("aria-label", "Conversation with the ordering assistant");

      chips = el("div", "bot-chips");

      entry = el("form", "bot-entry");
      input = el("input");
      input.type = "text";
      input.placeholder = "Type a message…";
      input.setAttribute("aria-label", "Type a message to the assistant");
      /* not "send" — that is the name of the dispatcher below, and a local
         var here would shadow it inside this very handler */
      var sendBtn = el("button", null, "Send");
      sendBtn.type = "submit";
      entry.appendChild(input);
      entry.appendChild(sendBtn);
      entry.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text || busy) return;
        input.value = "";
        send(text);
      });

      root.appendChild(hd);
      root.appendChild(log);
      root.appendChild(chips);
      root.appendChild(entry);
    }

    /* ---- saying things -------------------------------------------------- */
    function bubble(side, html) {
      var m = el("div", "bot-msg " + side);
      m.innerHTML = html;
      log.appendChild(m);
      log.scrollTop = log.scrollHeight;
      return m;
    }

    function say(html, delay) {
      return new Promise(function (resolve) {
        if (reduced) { bubble("out", html); return resolve(); }
        busy = true;
        var t = el("div", "bot-typing");
        t.setAttribute("aria-hidden", "true");
        t.innerHTML = "<i></i><i></i><i></i>";
        log.appendChild(t);
        log.scrollTop = log.scrollHeight;
        setTimeout(function () {
          t.remove();
          bubble("out", html);
          busy = false;
          resolve();
        }, delay || 620);
      });
    }

    /* One photo, one label underneath — the same mechanic the real bot uses,
       so a customer answers with two characters instead of a description. */
    function album(items) {
      var wrap = el("div", "bot-album");
      items.forEach(function (it) {
        var fig = el("figure");
        /* not everything has a photo — a treatment or a price tier still gets
           a code so it can be picked, it just goes out as a labelled row */
        if (it.img) {
          var im = document.createElement("img");
          im.src = it.img; im.alt = it.name || it.label; im.loading = "lazy";
          fig.appendChild(im);
        } else {
          fig.appendChild(el("div", "no-shot", "—"));
        }
        var cap = el("figcaption");
        cap.appendChild(el("b", null, it.label));
        cap.appendChild(el("span", null, (it.name || "") + (it.price != null ? " · " + money(cfg.currency || "B$", it.price) : "")));
        fig.appendChild(cap);
        wrap.appendChild(fig);
      });
      log.appendChild(wrap);
      log.scrollTop = log.scrollHeight;
    }

    function sayAll(list) {
      return list.reduce(function (chain, html) {
        return chain.then(function () { return say(html); });
      }, Promise.resolve());
    }

    /* ==== the brain ======================================================
       When cfg.ai is set the bot stops being a lookup table and talks to the
       same model the real store runs on. The old rule engine below stays put
       as a safety net: if the endpoint is slow, capped or unreachable, the
       demo quietly carries on instead of dying in front of a client. */

    var AI = cfg.ai
      ? { demo: cfg.ai, url: (cfg.aiUrl || "https://242plug.com") + "/demo-chat", live: true }
      : null;
    var history = [];

    /* Dots that stay up for as long as the answer takes, rather than a fixed
       fake pause. Returns the function that takes them down again. */
    function thinking() {
      if (reduced) return function () {};
      busy = true;
      var t = el("div", "bot-typing");
      t.setAttribute("aria-hidden", "true");
      t.innerHTML = "<i></i><i></i><i></i>";
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
      return function () { t.remove(); busy = false; };
    }

    function suggestChips(list) {
      chips.innerHTML = "";
      (list || []).forEach(function (label) {
        var b = el("button", "bot-chip");
        b.type = "button";
        b.appendChild(el("span", null, label));
        b.addEventListener("click", function () { if (!busy) aiTurn(label); });
        chips.appendChild(b);
      });
      if (!list || !list.length) input.focus();
    }

    function quoteCard(q) {
      var card = el("div", "bot-order");
      card.appendChild(el("h4", null, q.title || "Your order"));
      var dl = el("dl");
      (q.rows || []).forEach(function (r) {
        var row = el("div", "row");
        row.appendChild(el("dt", null, r.label));
        row.appendChild(el("dd", null, r.value));
        dl.appendChild(row);
      });
      if (q.total) {
        var t = el("div", "row total");
        t.appendChild(el("dt", null, "Total"));
        t.appendChild(el("dd", null, q.total));
        dl.appendChild(t);
      }
      card.appendChild(dl);
      if (q.note) card.appendChild(el("p", "note", q.note));
      log.appendChild(card);
      log.scrollTop = log.scrollHeight;
    }

    /* One turn of a real conversation. */
    function aiTurn(text) {
      bubble("in", escapeHtml(text));
      history.push({ role: "user", content: text });
      chips.innerHTML = "";

      var stop = thinking();
      var giveUp = setTimeout(function () { stop(); fallBack(text); }, 20000);

      fetch(AI.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo: AI.demo, messages: history.slice(-30) })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          clearTimeout(giveUp);
          stop();
          if (!res.ok || !res.d || !res.d.ok || !res.d.reply) { fallBack(text); return; }

          history.push({ role: "assistant", content: res.d.reply });
          bubble("out", escapeHtml(res.d.reply));

          /* the line, then the pictures with a code under each — the same
             mechanic the real store uses, so a customer answers with two
             characters instead of describing what they want */
          if (res.d.album && res.d.album.length) {
            album(res.d.album);
            history.push({
              role: "assistant",
              content: "[sent photos: " + res.d.album.map(function (a) {
                return a.label + "=" + a.name;
              }).join(", ") + "]"
            });
          }

          if (res.d.quote && res.d.quote.ready) {
            quoteCard(res.d.quote);
            chips.innerHTML = "";
            var again = el("button", "bot-restart", "↺ Run it again");
            again.type = "button";
            again.addEventListener("click", run);
            log.appendChild(again);
            log.scrollTop = log.scrollHeight;
            return;
          }
          suggestChips(res.d.suggest);
        })
        .catch(function () { clearTimeout(giveUp); stop(); fallBack(text); });
    }

    /* The endpoint let us down. Hand the same message to the rule engine and
       never try the network again this session — one stumble, not a stutter. */
    function fallBack(text) {
      AI.live = false;
      history.pop();                       // the rules re-echo it themselves
      var lastIn = log.querySelectorAll(".bot-msg.in");
      if (lastIn.length) lastIn[lastIn.length - 1].remove();
      typed(text);
    }

    /* ---- steps ---------------------------------------------------------- */
    function currentStep() { return cfg.steps[stepIndex]; }

    function askStep() {
      var step = currentStep();
      if (!step) return finish();

      /* a step can opt out of itself — this is what lets one bot run two
         different paths (a table booking vs a collection order) without a
         second engine */
      if (step.when && !step.when(answers)) { stepIndex++; return askStep(); }

      /* already answered — a single sentence can fill several steps at once */
      if (!step.multi && answers[step.key] != null) { stepIndex++; return askStep(); }

      if (step.multi && !answers[step.key]) answers[step.key] = [];

      var prompt = typeof step.ask === "function" ? step.ask(answers) : step.ask;
      say(prompt).then(function () {
        if (step.album) album(typeof step.album === "function" ? step.album(answers) : step.album);
        renderChips(step);
      });
    }

    function renderChips(step) {
      chips.innerHTML = "";
      if (!step.options) { input.focus(); return; }

      var opts = typeof step.options === "function" ? step.options(answers) : step.options;

      opts.forEach(function (opt) {
        var b = el("button", "bot-chip");
        b.type = "button";
        b.appendChild(el("span", null, opt.label));
        if (opt.price != null && opt.price > 0) {
          b.appendChild(el("span", " p", " " + money(cfg.currency || "B$", opt.price)));
        }
        b.addEventListener("click", function () {
          if (busy) return;
          choose(step, opt);
        });
        chips.appendChild(b);
      });

      if (step.multi) {
        var done = el("button", "bot-chip");
        done.type = "button";
        done.style.borderStyle = "dashed";
        done.textContent = step.doneLabel || "That's everything";
        done.addEventListener("click", function () {
          if (busy) return;
          if (!answers[step.key].length && step.requireOne) {
            say("Pick at least one first 🙂").then(function () { renderChips(step); });
            return;
          }
          bubble("in", escapeHtml(step.doneLabel || "That's everything"));
          chips.innerHTML = "";
          stepIndex++;
          askStep();
        });
        chips.appendChild(done);
      }
    }

    function choose(step, opt, silent) {
      if (!silent) bubble("in", escapeHtml(opt.label));   // already echoed if they typed it
      chips.innerHTML = "";

      if (step.multi) {
        answers[step.key].push(opt);
        var ack = step.ack ? step.ack(opt, answers) : "Added.";
        say(ack, 480).then(function () { renderChips(step); });
        return;
      }

      answers[step.key] = opt;
      stepIndex++;
      askStep();
    }

    /* ---- understanding what a person actually typed ---------------------- */
    /* A customer says "hello" or "what's on the menu?" long before they say
       "2". Barking the same instruction back at them is the fastest way to
       look like a broken robot, so the order of business is: understand the
       answer, else answer the question, else be polite about it. */

    var STOP = { the:1, a:1, an:1, of:1, for:1, and:1, to:1, is:1, it:1, my:1,
                 i:1, you:1, me:1, we:1, do:1, does:1, can:1, want:1, like:1,
                 please:1, some:1, that:1, this:1, one:1, get:1, have:1, got:1 };
    var NUMW = { one:"1", two:"2", three:"3", four:"4", five:"5",
                 six:"6", seven:"7", eight:"8", nine:"9", ten:"10" };
    var WORDNUM = {};
    for (var _w in NUMW) WORDNUM[NUMW[_w]] = _w;

    function norm(s) {
      /* fold accents first — otherwise "renee" never matches "Renée" */
      return String(s)
        .normalize ? String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                       .toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
                   : String(s).toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }
    function digitsOf(s) { return norm(s).match(/\d+/g) || []; }
    function words(s) {
      return norm(s).split(" ").filter(function (w) { return w.length > 1 && !STOP[w]; });
    }

    /* loose stem compare: delivered/delivery, bucket/buckets, wing/wings */
    function sameWord(a, b) {
      if (a === b) return true;
      var n = Math.min(a.length, b.length);
      if (n < 4) return false;
      var k = Math.min(n, 5);
      return a.slice(0, k) === b.slice(0, k);
    }

    function score(text, label) {
      var t = norm(text), l = norm(label);
      if (!t || !l) return 0;
      if (t === l) return 100;

      /* a label that starts with a number: "2 — Family Bucket", "2:00 pm".
         Compare leading digit runs so "2pm" and "number 2" both land. */
      var td = digitsOf(text), ld = digitsOf(label);
      if (td.length && ld.length && /^\d/.test(l) && td[0] === ld[0]) return 96;

      var num = td.length ? td[0] : null;
      if (!num) {
        for (var w in NUMW) { if (new RegExp("\\b" + w + "\\b").test(t)) { num = NUMW[w]; break; } }
      }
      if (num && new RegExp("^" + num + "\\b").test(l)) return 96;
      /* "2" should also find an option spelled "Two" or "Just one" */
      if (num && WORDNUM[num] && new RegExp("\\b" + WORDNUM[num] + "\\b").test(l)) return 92;

      if (l.indexOf(t) > -1 || t.indexOf(l) > -1) return 84;

      var lw = words(label), tw = words(text), hit = 0;
      lw.forEach(function (x) {
        for (var i = 0; i < tw.length; i++) { if (sameWord(x, tw[i])) { hit++; return; } }
      });
      if (!hit) return 0;
      /* every word of the label present is strong evidence, which is what
         lets a whole sentence fill several answers at once */
      return 42 + hit * 16 + (hit === lw.length ? 25 : 0);
    }

    function bestOption(text, opts) {
      var best = null, bestScore = 0;
      opts.forEach(function (o) {
        var sc = score(text, o.label);
        if (sc > bestScore) { bestScore = sc; best = o; }
      });
      return bestScore >= 56 ? best : null;
    }

    /* things every business gets asked, whatever it sells */
    var COURTESY = [
      { re:/^(hi|hey+|hello+|yo+|hiya|sup|wa?ssup|(good |gud )?(morning|afternoon|evening|day)|greetings|howdy|hola)\b/,
        a:["Hey 👋","Hello 👋","Hey there 👋","Good to hear from you 👋"] },
      { re:/(thank|thanks|thx|appreciate|bless)/,
        a:["Any time 🙏","You're welcome!","No problem 🙏"] },
      { re:/(who is this|are you a (bot|robot|human|person)|is this a (real )?person|am i talking to)/,
        a:["I'm the assistant that answers this number — I can do the whole thing here, and I'll pass you to one of the team the moment you need a person."] },
      { re:/(speak|talk) to (a )?(human|person|someone|somebody|manager|owner|agent)|real person/,
        a:["Of course — I'll flag this to the team now and somebody will pick it up 👤 Anything you want me to pass on?"] },
      { re:/(stupid|useless|annoying|rubbish|dumb|not working|makes no sense|frustrat)/,
        a:["Sorry — that's on me, not you 🙏 Let me get a person on this. In the meantime, tell me in your own words what you're after and I'll do my best."] },
      { re:/(help|confused|don'?t understand|how (does|do) (this|it) work|what do i do)/,
        a:["No problem — you can tap any of the buttons below, or just type it however you like and I'll work it out."] },
      { re:/^(bye|goodbye|see you|later|cheers|nvm|never ?mind)\b/,
        a:["No worries at all — message any time 👋"] },
      { re:/(how much|price|cost|expensive)/,
        a:["Prices are all on this page, and I'll total everything up before you commit to anything."] }
    ];

    var FALLBACK = [
      "I didn't quite catch that one 🙂 Tap any option below and I'll take it from there.",
      "Sorry, that one's past me — but the buttons below will sort it in a second.",
      "Still not with you, my fault. Pick one below, or say it a different way and I'll try again."
    ];
    var fbIndex = 0, misses = 0;

    function pick(list) { return list[Math.floor(fbIndex % list.length)]; }

    /* Re-ask the actual question rather than nudging at them. "Anyway —
       whenever you're ready 👇" is filler; "What number you want?" is service. */
    var LEAD = ["So — ", "Right — ", "Anyway, ", "Now, ", ""];
    var leadIndex = 0;

    function shortAsk(step) {
      var a = step.short || (typeof step.ask === "function" ? step.ask(answers) : step.ask);
      return String(a || "").trim();
    }

    /* merge: greeting and question in one bubble, the way a person types it.
       Longer answers get their own bubble, then the question follows. */
    function answerAndResume(reply, step, merge) {
      misses = 0;
      var q = shortAsk(step);
      if (merge) {
        say(q ? reply + " " + q : reply).then(function () { renderChips(step); });
        return;
      }
      say(reply)
        .then(function () {
          if (!q) return;
          var lead = LEAD[leadIndex++ % LEAD.length];
          return say(lead + q.charAt(0).toLowerCase() + q.slice(1), 520);
        })
        .then(function () { renderChips(step); });
    }

    /* "2 family buckets delivered to sea breeze" should not need four
       questions. Look ahead and fill any step this sentence clearly answers —
       high bar only, so a stray word never books something by accident. */
    /* Look-ahead scores on WORDS only — never on numbers. A digit can mean a
       menu number, a quantity or a time, so letting it fill a second step is
       how a bot ends up ordering something nobody asked for. */
    function scoreWords(text, label) {
      var lw = words(label), tw = words(text), hit = 0;
      if (!lw.length || !tw.length) return 0;
      lw.forEach(function (x) {
        for (var i = 0; i < tw.length; i++) { if (sameWord(x, tw[i])) { hit++; return; } }
      });
      if (hit !== lw.length) return 0;          // every word of the label, or nothing
      return 42 + hit * 16 + 25;
    }

    /* every option a message names, not just the best one */
    function allMatches(text, opts) {
      var found = [], nums = norm(text).match(/\d+/g) || [];
      opts.forEach(function (o) {
        var lead = (norm(o.label).match(/^\d+/) || [])[0];
        if (lead && nums.indexOf(lead) > -1) found.push(o);
      });
      opts.forEach(function (o) {
        if (found.indexOf(o) > -1) return;
        if (scoreWords(text, o.label) >= 80) found.push(o);
      });
      return found;
    }

    function autofill(text, from) {
      var filled = [];
      if (!cfg.steps) return filled;
      /* scoreWords ignores numbers and demands every word of the label, so a
         single unambiguous word is safe to act on */
      if (!words(text).length) return filled;
      for (var i = from; i < cfg.steps.length; i++) {
        var st = cfg.steps[i];
        if (st.multi || st.free) continue;
        if (answers[st.key] != null) continue;
        try { if (st.when && !st.when(answers)) continue; } catch (e) { continue; }
        var opts;
        try { opts = typeof st.options === "function" ? st.options(answers) : st.options; }
        catch (e) { continue; }
        if (!opts || !opts.length) continue;
        var best = null, bestScore = 0;
        opts.forEach(function (o) {
          var sc = scoreWords(text, o.label);
          if (sc > bestScore) { bestScore = sc; best = o; }
        });
        if (best && bestScore >= 80) {
          answers[st.key] = best;
          filled.push(best.label);
        }
      }
      return filled;
    }

    function listOf(a) {
      if (a.length === 1) return a[0];
      return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
    }

    function typed(text) {
      bubble("in", escapeHtml(text));
      var step = currentStep();
      if (!step) { say(cfg.afterDone || "That order is already in — tap restart to run it again."); return; }

      var opts = step.options
        ? (typeof step.options === "function" ? step.options(answers) : step.options)
        : null;

      /* 0. some sentences must never be mistaken for an answer. "I want 2
         different orders" contains a 2, but it is not the quantity. */
      var intent = (cfg.intents || []).filter(function (k) { return k.re.test(norm(text)); })[0];
      if (intent) {
        misses = 0;
        if (intent.set) { try { intent.set(answers); } catch (e) {} }
        answerAndResume(intent.reply, step, false);
        return;
      }

      /* on a free-text step the customer's own words win — the chips there
         are only examples, so "Sea Breeze off Prince Charles" stays whole */
      if (step.free && words(text).length > 1) {
        answers[step.key] = { label: text, value: text, price: 0 };
        chips.innerHTML = ""; misses = 0; stepIndex++; askStep(); return;
      }

      /* 1. is it an answer? The "done" button is a candidate too — otherwise
         "just the treatment" scores against *Scalp treatment* and adds it. */
      if (opts) {
        var pool = opts.slice();
        if (step.multi) pool.push({ label: step.doneLabel || "That's everything", __done: true });
        var hit = bestOption(text, pool);
        if (hit && hit.__done) { chips.innerHTML = ""; misses = 0; stepIndex++; askStep(); return; }

        /* "a 5 and a 7" is two items, not one. On a multi step take every
           option the message names. */
        if (step.multi) {
          var many = allMatches(text, opts);
          if (many.length > 1) {
            chips.innerHTML = ""; misses = 0;
            many.forEach(function (o) { answers[step.key].push(o); });
            say(listOf(many.map(function (o) { return o.label; })) + " ✓ Anything else?", 620)
              .then(function () { renderChips(step); });
            return;
          }
        }

        if (hit) {
          chips.innerHTML = ""; misses = 0;
          if (step.multi) { choose(step, hit, true); return; }
          answers[step.key] = hit;
          var extra = autofill(text, stepIndex + 1);
          stepIndex++;
          var wordy = words(text).length >= 3;      // a sentence, not a tap
          if (extra.length) {
            say("Got it — " + listOf([hit.label].concat(extra)) + " ✓", 560).then(askStep);
          } else if (wordy) {
            say("Got it — " + hit.label + " ✓", 520).then(askStep);
          } else {
            askStep();
          }
          return;
        }
      }
      if (step.multi && /^(done|thats? (it|all|everything)|nothing else|no more|finished|no)\b/.test(norm(text))) {
        chips.innerHTML = ""; misses = 0; stepIndex++; askStep(); return;
      }

      /* 2. "you deliver?" is a question, "delivery" is an answer. Same word,
         opposite intent — so a question mark or an opening verb decides which
         gets priority. */
      var asking = /\?\s*$/.test(text) ||
        /^(do|does|did|can|could|would|will|what|whats|when|where|how|is|are|any|got|you got|u got|who|why)\b/.test(norm(text));
      var known = (cfg.knows || []).filter(function (k) { return k.re.test(norm(text)); })[0];

      if (asking && known) { answerAndResume(known.a, step, false); return; }

      /* people also answer whichever question they feel like answering */
      var ahead = autofill(text, stepIndex + 1);
      if (ahead.length) { answerAndResume("Noted — " + listOf(ahead) + " ✓", step, true); return; }

      if (known) { answerAndResume(known.a, step, false); return; }

      /* 3. is it just being human? */
      var civil = COURTESY.filter(function (c) { return c.re.test(norm(text)); })[0];
      if (civil) {
        fbIndex++;
        answerAndResume(civil.a[fbIndex % civil.a.length], step, true);
        return;
      }

      /* 4. free-text steps take whatever they were given */
      if (step.free) {
        answers[step.key] = { label: text, value: text, price: 0 };
        chips.innerHTML = "";
        misses = 0;
        stepIndex++;
        askStep();
        return;
      }

      /* 5. politely, and never the same words twice in a row */
      misses++;
      fbIndex++;
      if (misses >= 3) {
        misses = 0;
        say("I'm clearly not getting this one 🙏 Let me put a person on it — someone from the team will jump in. You can still tap an option below in the meantime.")
          .then(function () { renderChips(step); });
        return;
      }
      say(step.retry && misses === 1 ? step.retry : pick(FALLBACK))
        .then(function () { renderChips(step); });
    }

    /* ---- the end -------------------------------------------------------- */
    function finish() {
      chips.innerHTML = "";
      var out = cfg.summarise(answers);
      var cur = cfg.currency || "B$";

      sayAll(out.before || ["Let me read that back to you."]).then(function () {
        var card = el("div", "bot-order");
        card.appendChild(el("h4", null, out.title || "Your order"));

        var dl = el("dl");
        out.rows.forEach(function (r) {
          var row = el("div", "row");
          row.appendChild(el("dt", null, r.label));
          row.appendChild(el("dd", null, r.value));
          dl.appendChild(row);
        });
        if (out.total != null) {
          var t = el("div", "row total");
          t.appendChild(el("dt", null, out.totalLabel || "Total"));
          t.appendChild(el("dd", null, money(cur, out.total)));
          dl.appendChild(t);
        }
        card.appendChild(dl);
        if (out.note) card.appendChild(el("p", "note", out.note));
        log.appendChild(card);
        log.scrollTop = log.scrollHeight;

        return say(out.closing || "Want me to lock that in?");
      }).then(function () {
        var again = el("button", "bot-restart", "↺ Run it again");
        again.type = "button";
        again.addEventListener("click", run);
        log.appendChild(again);
        log.scrollTop = log.scrollHeight;
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    /* ---- go ------------------------------------------------------------- */
    /* Everything the customer types comes through here, so there is one place
       that decides whether the brain or the rules answer it. */
    function send(text) {
      if (AI && AI.live) aiTurn(text);
      else typed(text);
    }

    function run() {
      answers = {};
      stepIndex = 0;
      busy = false;
      history = [];
      if (AI) AI.live = true;
      build();

      var hello = cfg.greeting || ["Hey! What can I get you?"];
      sayAll(hello).then(function () {
        if (!AI) return askStep();

        /* The greeting is local so the first paint is instant and costs
           nothing — the model is told what it opened with. */
        history.push({ role: "assistant", content: hello.join(" ") });

        /* Openers come from the first step, which is already written in the
           customer's language. After this the model suggests its own. */
        var first = cfg.steps && cfg.steps[0];
        var opts = first && first.options
          ? (typeof first.options === "function" ? first.options(answers) : first.options)
          : [];
        suggestChips(opts.slice(0, 4).map(function (o) { return o.label; }));
      });
    }

    run();
    return { restart: run, answers: function () { return answers; } };
  }

  return { start: start };
})();
