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

  /* ---- the language switch -----------------------------------------------
     Rodney's ask: prove the multilingual claim instead of describing it. The
     button cycles English → Spanish → Haitian Creole and every tab, header,
     timeline label and message changes at once. Product names, codes and
     prices never change — that is Kiki's rule, and it is also just true. */
  var LANGS = [
    { id: "en", label: "English",         next: "Spanish" },
    { id: "es", label: "Español",         next: "Haitian Creole" },
    { id: "ht", label: "Kreyòl Ayisyen",  next: "English" }
  ];
  var langIndex = 0;
  function lang() { return LANGS[langIndex].id; }

  /* pick the translation for the current language, fall back to English */
  function say(obj, key) {
    var id = lang();
    if (id === "en") return obj[key];
    var suffix = id === "es" ? "Es" : "Ht";
    return obj[key + suffix] || obj[key];
  }

  var DEMOS = {
    trades: [
      {
        tab: "Restaurant", tabEs: "Restaurante", tabHt: "Restoran",
        header: "Friday 10:38 pm &nbsp;·&nbsp; kitchen closes at 11",
        headerEs: "Viernes 10:38 pm &nbsp;·&nbsp; la cocina cierra a las 11",
        headerHt: "Vandredi 10:38 pm &nbsp;·&nbsp; kizin nan fèmen a 11è",
        lines: [
          { side: "in", text: "y'all still open?", textEs: "¿siguen abiertos?", textHt: "nou ouvè toujou?", stamp: "10:38 pm" },
          { side: "out", text: "Twenty minutes left on the kitchen — here's what's still going 👇", textEs: "Veinte minutos más de cocina — esto es lo que queda 👇", textHt: "Ven minit ankò nan kizin nan — men sa ki rete 👇", stamp: "10:38 pm", think: 800 },
          { album: [
              { img: "assets/img/hero/food-1.webp", label: "A1", name: "Snapper crudo", price: "$38" },
              { img: "assets/img/hero/food-2.webp", label: "A2", name: "Hand-rolled pasta", price: "$46" },
              { img: "assets/img/hero/food-3.webp", label: "A3", name: "Aged beef", price: "$64" }
            ] },
          { side: "in", text: "A3 for 2", textEs: "A3 para 2", textHt: "A3 pou 2", stamp: "10:40 pm" },
          { side: "out", text: "2 × aged beef, $128. Ready in about 25 minutes. Pay now or when you collect?", textEs: "2 × res madurada, $128. Listo en unos 25 minutos. ¿Paga ahora o al recoger?", textHt: "2 × vyann bèf, $128. L ap pare nan 25 minit. Ou vle peye kounye a oswa lè w vin chèche l?", stamp: "10:40 pm", think: 900 },
          { side: "in", text: "what do you accept", textEs: "qué aceptan", textHt: "ki sa nou aksepte", stamp: "10:41 pm" },
          { side: "out", text: "Card on our site, CIBC or Scotiabank transfer, or cash at the door — whichever's easiest.", textEs: "Tarjeta en nuestra web, transferencia CIBC o Scotiabank, o efectivo en la puerta — lo que le sea más fácil.", textHt: "Kat sou sit nou an, transfè CIBC oswa Scotiabank, oswa kach nan pòt la — sa ki pi fasil pou ou.", stamp: "10:41 pm", think: 800 },
          { side: "in", text: "scotia", textEs: "scotia", textHt: "scotia", stamp: "10:41 pm" },
          { side: "out", text: "Scotiabank 👍 Blue Hole Ltd, account 8033-1174. Send the receipt back here and I'll have it boxed and waiting.", textEs: "Scotiabank 👍 Blue Hole Ltd, cuenta 8033-1174. Mándeme el recibo por aquí y se lo dejo empacado y listo.", textHt: "Scotiabank 👍 Blue Hole Ltd, kont 8033-1174. Voye resi a isit la epi m ap mete l nan bwat ap tann ou.", stamp: "10:41 pm", think: 900 },
          { side: "in", text: "sent it", textEs: "ya lo mandé", textHt: "mwen voye l", stamp: "10:44 pm" },
          { side: "out", text: "Got it — payment in ✅ Kitchen has your order. I'll message you the moment it's ready.", textEs: "Recibido — pago confirmado ✅ La cocina ya tiene su pedido. Le aviso apenas esté listo.", textHt: "Mwen jwenn li — peman an antre ✅ Kizin nan gen kòmand ou an. M ap voye mesaj kou l pare.", stamp: "10:44 pm", think: 800 },
          { gap: "25 minutes later", gapEs: "25 minutos después", gapHt: "25 minit apre" },
          { side: "out", text: "Ready 🍽 come to the kitchen door and somebody will bring it straight out.", textEs: "Listo 🍽 venga a la puerta de la cocina y alguien se lo saca enseguida.", textHt: "Li pare 🍽 vin nan pòt kizin nan epi yon moun ap pote l ba ou.", stamp: "11:06 pm", think: 800 }
        ]
      },
      {
        tab: "Fast food", tabEs: "Comida rápida", tabHt: "Manje rapid",
        header: "Saturday 1:47 am &nbsp;·&nbsp; last orders",
        headerEs: "Sábado 1:47 am &nbsp;·&nbsp; últimos pedidos",
        headerHt: "Samdi 1:47 am &nbsp;·&nbsp; dènye kòmand",
        lines: [
          { side: "in", text: "wa y'all still open", textEs: "siguen abiertos?", textHt: "nou ouvè toujou", stamp: "1:47 am" },
          { side: "out", text: "Till 2 🍗 kitchen takes its last order in about ten minutes. Here's the board 👇", textEs: "Hasta las 2 🍗 la cocina toma el último pedido en unos diez minutos. Aquí está el menú 👇", textHt: "Jiska 2è 🍗 kizin nan pran dènye kòmand nan dis minit. Men tablo a 👇", stamp: "1:47 am", think: 800 },
          { album: [
              { img: "assets/img/hero/bfc-1.webp", label: "A2", name: "Family Bucket", price: "$34" },
              { img: "assets/img/hero/bfc-2.webp", label: "A5", name: "Sticky Wings", price: "$13.50" },
              { img: "assets/img/hero/bfc-3.webp", label: "A7", name: "Wing Party", price: "$29" }
            ] },
          { side: "in", text: "a 5 and a 7, fries with both, sea breeze", textEs: "un 5 y un 7, papas con los dos, sea breeze", textHt: "yon 5 ak yon 7, fri ak tou de, sea breeze", stamp: "1:49 am" },
          { side: "out", text: "Got it — Sticky Wings and a Wing Party, both fries. BBQ or jerk on the wings?", textEs: "Anotado — Sticky Wings y un Wing Party, los dos con papas. ¿BBQ o jerk en las alitas?", textHt: "Mwen jwenn li — Sticky Wings ak yon Wing Party, tou de ak fri. BBQ oswa jerk sou zèl yo?", stamp: "1:49 am", think: 900 },
          { side: "in", text: "jerk", textEs: "jerk", textHt: "jerk", stamp: "1:50 am" },
          { side: "out", text: "$49.00 with delivery 🛵 Sea Breeze is a big area though — drop me a pin 📍 so the driver comes straight to you.", textEs: "$49.00 con entrega 🛵 pero Sea Breeze es grande — mándeme su ubicación 📍 para que el chofer llegue directo.", textHt: "$49.00 ak livrezon 🛵 men Sea Breeze gwo — voye pin ou 📍 pou chofè a vin dirèk kote ou.", stamp: "1:50 am", think: 900 },
          { side: "in", text: "📍 Location", textEs: "📍 Ubicación", textHt: "📍 Kote", stamp: "1:50 am" },
          { side: "out", text: "Got you — off Prince Charles by the pink church. Kitchen's on it. Cash to the driver or transfer now?", textEs: "Ya la tengo — por Prince Charles, junto a la iglesia rosada. La cocina va. ¿Efectivo al chofer o transferencia ahora?", textHt: "Mwen jwenn li — bò Prince Charles kot legliz woz la. Kizin nan ap travay. Kach bay chofè a oswa transfè kounye a?", stamp: "1:50 am", think: 900 },
          { side: "in", text: "cash", textEs: "efectivo", textHt: "kach", stamp: "1:51 am" },
          { gap: "order in &nbsp;·&nbsp; 9 minutes later", gapEs: "pedido hecho &nbsp;·&nbsp; 9 minutos después", gapHt: "kòmand antre &nbsp;·&nbsp; 9 minit apre" },
          { side: "out", text: "Food's boxed and the driver just pulled off 🛵 $49 cash — he'll call you when he's outside.", textEs: "Ya está empacado y el chofer acaba de salir 🛵 $49 en efectivo — le llama cuando esté afuera.", textHt: "Manje a nan bwat epi chofè a fèk pati 🛵 $49 kach — l ap rele ou lè l deyò a.", stamp: "1:59 am", think: 800 }
        ]
      },
      {
        tab: "Salon", tabEs: "Salón", tabHt: "Salon",
        header: "Sunday 7:04 am &nbsp;·&nbsp; salon closed",
        headerEs: "Domingo 7:04 am &nbsp;·&nbsp; salón cerrado",
        headerHt: "Dimanch 7:04 am &nbsp;·&nbsp; salon fèmen",
        lines: [
          { side: "in", text: "yall open today?", textEs: "¿abren hoy?", textHt: "nou ouvè jodi a?", stamp: "7:04 am" },
          { side: "out", text: "Closed Sundays — Tuesday 9am is open though. Here's what we do 👇", textEs: "Cerramos los domingos — pero el martes a las 9 está libre. Esto es lo que hacemos 👇", textHt: "Nou fèmen dimanch — men madi 9è gen plas. Men sa nou fè 👇", stamp: "7:04 am", think: 900 },
          { album: [
              { img: "assets/img/hero/salon-1.webp", label: "A1", name: "Colour & gloss", price: "$180" },
              { img: "assets/img/hero/salon-2.webp", label: "A2", name: "Signature facial", price: "$140" },
              { img: "assets/img/hero/salon-3.webp", label: "A3", name: "Hot stone 90", price: "$210" }
            ] },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 20 minutes later", gapEs: "sin respuesta &nbsp;·&nbsp; seguimiento, 20 minutos después", gapHt: "pa gen repons &nbsp;·&nbsp; swivi, 20 minit apre" },
          { side: "out", text: "No rush at all 🌿 whenever you're ready, send me the code and I'll hold Tuesday for you.", textEs: "Sin prisa 🌿 cuando esté lista, mándeme el código y le guardo el martes.", textHt: "Pa gen prese 🌿 lè ou pare, voye kòd la ban mwen epi m ap kenbe madi a pou ou.", stamp: "7:26 am", think: 900 },
          { side: "in", text: "A1 tuesday", textEs: "A1 martes", textHt: "A1 madi", stamp: "7:27 am" },
          { side: "out", text: "Booked — colour & gloss, Tuesday 9am with Keva 💫 A $45 deposit makes it a priority reservation. Card on our website, CIBC or Scotiabank?", textEs: "Reservado — color y brillo, martes 9am con Keva 💫 Un depósito de $45 la hace reserva prioritaria. ¿Tarjeta en la web, CIBC o Scotiabank?", textHt: "Rezève — koulè ak gloss, madi 9è ak Keva 💫 Yon depo $45 fè l vin yon rezèvasyon prioritè. Kat sou sit la, CIBC oswa Scotiabank?", stamp: "7:27 am", think: 1000 },
          { side: "in", text: "scotia", textEs: "scotia", textHt: "scotia", stamp: "7:28 am" },
          { side: "out", text: "Scotiabank 👍 Sunset Hair & Spa · account 800471629. Send the screenshot back here and I'll lock Tuesday in.", textEs: "Scotiabank 👍 Sunset Hair & Spa · cuenta 800471629. Mándeme la captura por aquí y le fijo el martes.", textHt: "Scotiabank 👍 Sunset Hair & Spa · kont 800471629. Voye foto a isit la epi m ap fikse madi a.", stamp: "7:28 am", think: 900 },
          { side: "in", text: "[receipt]", textEs: "[recibo]", textHt: "[resi]", stamp: "7:31 am" },
          { side: "out", text: "Got it ✅ Deposit received, Tuesday 9am is yours. I'll remind you Monday evening.", textEs: "Recibido ✅ Depósito confirmado, el martes 9am es suyo. Le recuerdo el lunes por la noche.", textHt: "Mwen jwenn li ✅ Depo a antre, madi 9è se pou ou. M ap raple ou lendi swa.", stamp: "7:31 am", think: 900 }
        ]
      },
      {
        tab: "Car hire", tabEs: "Alquiler de autos", tabHt: "Lwe machin",
        header: "Wednesday 2:40 pm &nbsp;·&nbsp; counter is slammed",
        headerEs: "Miércoles 2:40 pm &nbsp;·&nbsp; el mostrador a tope",
        headerHt: "Mèkredi 2:40 pm &nbsp;·&nbsp; kontwa a chaje",
        lines: [
          { side: "in", text: "you got anything for the week?", textEs: "¿tienen algo para la semana?", textHt: "nou gen anyen pou semèn nan?", stamp: "2:40 pm" },
          { side: "out", text: "Yes — this is what's on the lot today 👇", textEs: "Sí — esto es lo que hay hoy en el lote 👇", textHt: "Wi — men sa ki sou lakou a jodi a 👇", stamp: "2:40 pm", think: 900 },
          { album: [
              { img: "assets/img/hero/car-1.webp", label: "A1", name: "Honda Fit", price: "$55/day" },
              { img: "assets/img/hero/car-2.webp", label: "A2", name: "Toyota Corolla", price: "$65/day" },
              { img: "assets/img/hero/car-3.webp", label: "A3", name: "Jeep Wrangler", price: "$95/day" }
            ] },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 11 minutes later", gapEs: "sin respuesta &nbsp;·&nbsp; seguimiento, 11 minutos después", gapHt: "pa gen repons &nbsp;·&nbsp; swivi, 11 minit apre" },
          { side: "out", text: "Still looking? 🚗 Send the code and I'll hold it — we bring it to you and collect it after, $15 flat.", textEs: "¿Sigue buscando? 🚗 Mándeme el código y se lo aparto — se lo llevamos y lo recogemos después, $15 fijo.", textHt: "W ap chèche toujou? 🚗 Voye kòd la epi m ap kenbe l — nou pote l ba ou epi nou vin pran l apre, $15 fiks.", stamp: "2:52 pm", think: 900 },
          { side: "in", text: "A2 for 5 days, bring it to my house", textEs: "A2 por 5 días, tráiganlo a mi casa", textHt: "A2 pou 5 jou, pote l lakay mwen", stamp: "2:53 pm" },
          { side: "out", text: "Held ✅ Corolla, 5 days, delivered and collected — $340 all in. How you prefer to pay? Card on our site, CIBC or Scotiabank.", textEs: "Apartado ✅ Corolla, 5 días, entregado y recogido — $340 todo incluido. ¿Cómo prefiere pagar? Tarjeta en la web, CIBC o Scotiabank.", textHt: "Kenbe ✅ Corolla, 5 jou, livre epi ranmase — $340 tou konprann. Kijan ou pito peye? Kat sou sit la, CIBC oswa Scotiabank.", stamp: "2:53 pm", think: 1000 },
          { side: "in", text: "you accept island luck?", textEs: "¿aceptan island luck?", textHt: "nou aksepte island luck?", stamp: "2:54 pm" },
          { side: "out", text: "Yes we do 👍 Island Luck — name Out Island Auto, account 448192. Send the receipt back here and I'll confirm right away.", textEs: "Sí lo aceptamos 👍 Island Luck — nombre Out Island Auto, cuenta 448192. Mándeme el recibo por aquí y se lo confirmo enseguida.", textHt: "Wi nou aksepte l 👍 Island Luck — non Out Island Auto, kont 448192. Voye resi a isit la epi m ap konfime l touswit.", stamp: "2:54 pm", think: 900 },
          { gap: "no receipt yet &nbsp;·&nbsp; follow-up, 40 minutes later", gapEs: "aún sin recibo &nbsp;·&nbsp; seguimiento, 40 minutos después", gapHt: "poko gen resi &nbsp;·&nbsp; swivi, 40 minit apre" },
          { side: "out", text: "No rush 🚗 just checking the Corolla's still yours — it's held till the end of the day, then it goes back on the lot.", textEs: "Sin prisa 🚗 solo confirmo que el Corolla sigue siendo suyo — se lo guardo hasta el final del día, después vuelve al lote.", textHt: "Pa gen prese 🚗 m ap tcheke si Corolla a se pou ou toujou — nou kenbe l jiska fen jounen an, apre sa l tounen sou lakou a.", stamp: "3:34 pm", think: 900 },
          { side: "in", text: "[receipt]", textEs: "[recibo]", textHt: "[resi]", stamp: "3:36 pm" },
          { side: "out", text: "Payment in ✅ Keys are set aside in your name. Friday 8am at your place — the driver calls when he's outside.", textEs: "Pago recibido ✅ Las llaves quedan apartadas a su nombre. Viernes 8am en su casa — el chofer llama cuando esté afuera.", textHt: "Peman an antre ✅ Kle yo mete apa nan non ou. Vandredi 8è lakay ou — chofè a rele lè l deyò a.", stamp: "3:36 pm", think: 900 }
        ]
      },
      {
        tab: "Ride share", tabEs: "Transporte", tabHt: "Transpò",
        header: "Sunday 1:12 am &nbsp;·&nbsp; nobody at the desk",
        headerEs: "Domingo 1:12 am &nbsp;·&nbsp; nadie en el mostrador",
        headerHt: "Dimanch 1:12 am &nbsp;·&nbsp; pèsonn nan biwo a",
        lines: [
          { side: "in", text: "how much from the airport to atlantis", textEs: "cuánto del aeropuerto a atlantis", textHt: "konbyen soti ayewopò a pou atlantis", stamp: "1:12 am" },
          { side: "out", text: "Airport Run to Atlantis is $33 flat, about 26 min 🚗 We meet you at arrivals — got a flight number?", textEs: "El Airport Run a Atlantis es $33 fijo, unos 26 min 🚗 Lo esperamos en llegadas — ¿tiene número de vuelo?", textHt: "Airport Run pou Atlantis se $33 fiks, anviwon 26 minit 🚗 Nou rankontre ou nan arive — ou gen nimewo vòl la?", stamp: "1:12 am", think: 900 },
          { side: "in", text: "yeah BA253", textEs: "sí BA253", textHt: "wi BA253", stamp: "1:13 am" },
          { side: "out", text: "Tracking it — if you're late the car waits. Sending one now.", textEs: "Lo estoy siguiendo — si se retrasa, el auto espera. Le mando uno ahora.", textHt: "M ap swiv li — si w an reta machin nan ap tann. M ap voye youn kounye a.", stamp: "1:13 am", think: 800 },
          { side: "out", text: "Car's on the way ✅ Marlon, red Toyota Corolla, plate 242-1487. 3 minutes away.", textEs: "Auto en camino ✅ Marlon, Toyota Corolla rojo, placa 242-1487. A 3 minutos.", textHt: "Machin nan ap vini ✅ Marlon, Toyota Corolla wouj, plak 242-1487. 3 minit.", stamp: "1:14 am", think: 900 },
          { gap: "5 minutes later", gapEs: "5 minutos después", gapHt: "5 minit apre" },
          { side: "out", text: "He's caught a bit of traffic — give him two more minutes 🙏 he's nearly there.", textEs: "Agarró un poco de tráfico — dele dos minutos más 🙏 ya casi llega.", textHt: "Li pran yon ti trafik — ba li de minit ankò 🙏 li prèske rive.", stamp: "1:19 am", think: 800 },
          { side: "out", text: "He's outside now — red Corolla, 242-1487, by the arrivals doors 🚗", textEs: "Ya está afuera — Corolla rojo, 242-1487, junto a las puertas de llegadas 🚗", textHt: "Li deyò a kounye a — Corolla wouj, 242-1487, bò pòt arive yo 🚗", stamp: "1:22 am", think: 800 },
          { gap: "trip finished &nbsp;·&nbsp; follow-up, 40 minutes later", gapEs: "viaje terminado &nbsp;·&nbsp; seguimiento, 40 minutos después", gapHt: "vwayaj fini &nbsp;·&nbsp; swivi, 40 minit apre" },
          { side: "out", text: "Hope Marlon got you there safe 🙏 $33 paid, receipt's in the app. Want me to book the run back to the airport now?", textEs: "Espero que Marlon lo haya llevado bien 🙏 $33 pagados, el recibo está en la app. ¿Le reservo ya el regreso al aeropuerto?", textHt: "M espere Marlon mennen ou byen 🙏 $33 peye, resi a nan app la. Ou vle m rezève retou a nan ayewopò a kounye a?", stamp: "2:02 am", think: 900 }
        ]
      },
      {
        tab: "Shipping", tabEs: "Envíos", tabHt: "Ekspedisyon",
        header: "Tuesday 6:12 pm &nbsp;·&nbsp; counter closed at 5",
        headerEs: "Martes 6:12 pm &nbsp;·&nbsp; el mostrador cerró a las 5",
        headerHt: "Madi 6:12 pm &nbsp;·&nbsp; kontwa a fèmen a 5è",
        lines: [
          /* The forwarder speaks FIRST. A customer waiting on a package they
             already paid for does not want a portal — they want to be told it
             arrived, and to see it. So: the photo of the actual box, then the
             one thing customs needs. */
          { side: "out", text: "Your box landed in Miami 📦 S242-4471, 9 lb — going on Friday's air run.", textEs: "Su caja llegó a Miami 📦 S242-4471, 9 lb — sale en el vuelo del viernes.", textHt: "Bwat ou a rive Miami 📦 S242-4471, 9 lb — l ap pati nan vòl vandredi a.", stamp: "6:12 pm", think: 900 },
          { photo: { img: "assets/img/hero/ship-parcel.webp", alt: "The package that arrived, labelled S242-4471", cap: "Photographed at the Miami warehouse", capEs: "Fotografiado en el almacén de Miami", capHt: "Foto pran nan depo Miami an" } },
          { side: "out", text: "One thing before customs 🧾 snap the order page from Amazon — the bit with the price — and send it here. I clear it for you so you're not standing at customs yourself.", textEs: "Una cosa antes de aduana 🧾 tome una captura de la página del pedido de Amazon — la parte con el precio — y mándela aquí. Yo lo despacho por usted para que no tenga que ir a aduana.", textHt: "Yon bagay anvan ladwàn 🧾 pran yon foto paj kòmand Amazon an — pati ki gen pri a — epi voye l isit la. M ap dedouane l pou ou pou ou pa bezwen kanpe nan ladwàn.", stamp: "6:13 pm", think: 1000 },
          { gap: "no reply &nbsp;·&nbsp; follow-up, next morning", gapEs: "sin respuesta &nbsp;·&nbsp; seguimiento, a la mañana siguiente", gapHt: "pa gen repons &nbsp;·&nbsp; swivi, nan denmen maten" },
          { side: "out", text: "Morning 🙂 still need that receipt for S242-4471. Without it customs values the box themselves, and that's nearly always dearer.", textEs: "Buenos días 🙂 todavía necesito ese recibo del S242-4471. Sin él, aduana le pone el valor por su cuenta, y eso casi siempre sale más caro.", textHt: "Bonjou 🙂 mwen bezwen resi a pou S242-4471 toujou. San li, ladwàn pral bay bwat la yon valè poukont yo, epi sa prèske toujou pi chè.", stamp: "8:40 am", think: 900 },
          { side: "in", text: "[screenshot]", textEs: "[captura]", textHt: "[foto ekran]", stamp: "8:52 am" },
          { side: "out", text: "Perfect 👍 that's all I need. Cleared and paid: freight $31.50 plus $15 clearing. Bay Street from 8am, or I send it to you for $12.", textEs: "Perfecto 👍 con eso basta. Despachado y pagado: flete $31.50 más $15 de despacho. Bay Street desde las 8am, o se lo mando por $12.", textHt: "Bon 👍 se sa mwen bezwen. Dedouane epi peye: fre $31.50 plis $15 dedouanman. Bay Street apati 8è, oswa m voye l ba ou pou $12.", stamp: "8:52 am", think: 1000 },
          { side: "in", text: "send it", textEs: "mándelo", textHt: "voye l", stamp: "8:54 am" },
          { side: "out", text: "Done. One thing — first collection needs a government photo ID 🪪 passport, licence or NIB card. Just the once.", textEs: "Hecho. Una cosa — la primera recogida necesita una identificación oficial con foto 🪪 pasaporte, licencia o tarjeta NIB. Solo esa vez.", textHt: "Fini. Yon bagay — premye ranmasaj la bezwen yon idantifikasyon gouvènman ak foto 🪪 paspò, lisans oswa kat NIB. Se yon sèl fwa.", stamp: "8:54 am", think: 900 },
          { gap: "same day &nbsp;·&nbsp; 2:20 pm", gapEs: "el mismo día &nbsp;·&nbsp; 2:20 pm", gapHt: "menm jou a &nbsp;·&nbsp; 2:20 pm" },
          { side: "out", text: "On the van 🚚 the driver will call you when he's close — no tracking number for a local run, he just rings you.", textEs: "Ya va en la camioneta 🚚 el chofer le llama cuando esté cerca — no hay número de rastreo para una entrega local, simplemente le llama.", textHt: "Li nan kamyonèt la 🚚 chofè a ap rele ou lè l pre — pa gen nimewo swivi pou yon livrezon lokal, l ap jis rele ou.", stamp: "2:20 pm", think: 900 }
        ]
      },
      {
        tab: "Print shop", tabEs: "Imprenta", tabHt: "Enprimri",
        header: "Monday 8:12 pm &nbsp;·&nbsp; shop closed",
        headerEs: "Lunes 8:12 pm &nbsp;·&nbsp; taller cerrado",
        headerHt: "Lendi 8:12 pm &nbsp;·&nbsp; boutik la fèmen",
        lines: [
          { side: "in", text: "30 shirts by wednesday possible?", textEs: "¿30 camisas para el miércoles?", textHt: "30 chemiz pou mèkredi posib?", stamp: "8:12 pm" },
          { side: "out", text: "Wednesday's under 48 hours from when we open, so that's rush — 25% on top. Doable though. 30 shirts puts you at $15 each.", textEs: "El miércoles queda a menos de 48 horas desde que abrimos, así que es urgente — 25% extra. Pero se puede. 30 camisas le sale a $15 cada una.", textHt: "Mèkredi mwens pase 48 èdtan apati lè nou ouvri, kidonk se prese — 25% anplis. Men li fèzab. 30 chemiz mete ou nan $15 chak.", stamp: "8:12 pm", think: 1000 },
          { side: "in", text: "front and back", textEs: "frente y espalda", textHt: "devan ak dèyè", stamp: "8:14 pm" },
          { side: "out", text: "Front and back is $4 more a shirt. So $570 all in, ready Wednesday. Send the artwork or build it on the site and I'll get you on the run.", textEs: "Frente y espalda son $4 más por camisa. Así que $570 todo incluido, listo el miércoles. Mande el arte o armelo en la web y lo meto en la tanda.", textHt: "Devan ak dèyè se $4 anplis pou chak chemiz. Donk $570 tou konprann, pare mèkredi. Voye desen an oswa fè l sou sit la epi m ap mete ou nan kouri a.", stamp: "8:14 pm", think: 1000 },
          { gap: "artwork in &nbsp;·&nbsp; next morning", gapEs: "arte recibido &nbsp;·&nbsp; a la mañana siguiente", gapHt: "desen an rive &nbsp;·&nbsp; nan denmen maten" },
          { side: "out", text: "Proof's ready 👀 nothing touches a shirt until you say yes.", textEs: "La prueba está lista 👀 nada toca una camisa hasta que usted diga que sí.", textHt: "Prèv la pare 👀 anyen p ap touche yon chemiz jiskaske ou di wi.", stamp: "9:20 am", think: 900 },
          { photo: { img: "assets/img/hero/print-proof.webp", alt: "Digital proof — front and back of the shirt", cap: "Front and back · 30 shirts · not printed yet", capEs: "Frente y espalda · 30 camisas · aún sin imprimir", capHt: "Devan ak dèyè · 30 chemiz · poko enprime" } },
          { gap: "no reply &nbsp;·&nbsp; follow-up, 3 hours later", gapEs: "sin respuesta &nbsp;·&nbsp; seguimiento, 3 horas después", gapHt: "pa gen repons &nbsp;·&nbsp; swivi, 3 èdtan apre" },
          { side: "out", text: "Still need a yes on that proof 🖨 the press is free this afternoon — after that Wednesday gets tight.", textEs: "Todavía necesito el visto bueno de esa prueba 🖨 la prensa está libre esta tarde — después de eso el miércoles se aprieta.", textHt: "Mwen bezwen yon wi sou prèv sa a toujou 🖨 près la lib apremidi a — apre sa mèkredi vin sere.", stamp: "12:18 pm", think: 900 },
          { side: "in", text: "yes go ahead", textEs: "sí, adelante", textHt: "wi ale", stamp: "12:25 pm" },
          { side: "out", text: "On the press 🔥 30 shirts, front and back, $570. Ready Wednesday — I'll message you when they're boxed.", textEs: "En la prensa 🔥 30 camisas, frente y espalda, $570. Listas el miércoles — le aviso cuando estén empacadas.", textHt: "Nan près la 🔥 30 chemiz, devan ak dèyè, $570. Pare mèkredi — m ap voye mesaj lè yo nan bwat.", stamp: "12:25 pm", think: 900 }
        ]
      },
      {
        tab: "Real estate", tabEs: "Bienes raíces", tabHt: "Imobilye",
        header: "Thursday 10:48 pm &nbsp;·&nbsp; office closed at nine",
        headerEs: "Jueves 10:48 pm &nbsp;·&nbsp; la oficina cerró a las nueve",
        headerHt: "Jedi 10:48 pm &nbsp;·&nbsp; biwo a fèmen a nevè",
        lines: [
          { side: "in", text: "looking for a private cay, under 10", textEs: "busco un cayo privado, menos de 10", textHt: "m ap chèche yon ti zile prive, anba 10", stamp: "10:48 pm" },
          { side: "out", text: "Two in the portfolio fit that. One is not published anywhere.", textEs: "Dos de la cartera encajan. Uno no está publicado en ninguna parte.", textHt: "De nan pòtfèy la kadre ak sa. Youn pa pibliye okenn kote.", stamp: "10:48 pm", think: 1000 },
          { album: [
              { img: "assets/img/hero/est-1.webp", label: "A1", name: "Over-water pavilion", price: "$14.5m" },
              { img: "assets/img/hero/est-2.webp", label: "A2", name: "Palm court villa", price: "$6.75m" },
              { img: "assets/img/hero/est-3.webp", label: "A3", name: "Cliff terrace", price: "$9.4m" }
            ] },
          { side: "in", text: "the unpublished one", textEs: "el que no está publicado", textHt: "sa ki pa pibliye a", stamp: "10:51 pm" },
          { side: "out", text: "That one is released under NDA only. I can have a partner send it across tomorrow morning, or arrange a viewing — there is a boat for the cays.", textEs: "Ese solo se entrega bajo acuerdo de confidencialidad. Un socio se lo puede mandar mañana por la mañana, o le organizo una visita — hay barco para los cayos.", textHt: "Sa a bay sèlman anba yon akò konfidansyalite. Yon patnè ka voye l ba ou demen maten, oswa m ka òganize yon vizit — gen yon bato pou ti zile yo.", stamp: "10:51 pm", think: 1100 },
          { side: "in", text: "send the NDA", textEs: "mándeme el acuerdo", textHt: "voye akò a", stamp: "10:53 pm" },
          { side: "out", text: "Of course. What is the best email for it? I will have a partner send it across first thing.", textEs: "Por supuesto. ¿Cuál es el mejor correo para enviarlo? Un socio se lo manda a primera hora.", textHt: "Byen si. Ki pi bon imel pou voye l? Yon patnè ap voye l ba ou byen bonè.", stamp: "10:53 pm", think: 1000 },
          { side: "in",  text: "[email address]", textEs: "[correo]", textHt: "[adrès imel]", stamp: "10:55 pm" },
          { side: "out", text: "Sent 📄 A partner will call once it is back — he handles the cays himself.", textEs: "Enviado 📄 Un socio le llamará en cuanto vuelva firmado — él lleva los cayos personalmente.", textHt: "Voye 📄 Yon patnè ap rele ou lè l tounen — se li menm ki okipe ti zile yo.", stamp: "10:55 pm", think: 900 },
          { gap: "not signed &nbsp;·&nbsp; follow-up, next afternoon", gapEs: "sin firmar &nbsp;·&nbsp; seguimiento, a la tarde siguiente", gapHt: "pa siyen &nbsp;·&nbsp; swivi, nan denmen apremidi" },
          { side: "out", text: "No pressure at all. The NDA is still open, and the boat goes out Thursday if you would rather see it before reading anything.", textEs: "Sin ninguna presión. El acuerdo sigue abierto, y el barco sale el jueves si prefiere verlo antes de leer nada.", textHt: "Pa gen okenn presyon. Akò a louvri toujou, epi bato a soti jedi si ou ta pito wè l anvan ou li anyen.", stamp: "2:40 pm", think: 1000 }
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
        b.textContent = say(c, "tab");
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
        var s = document.createElement("span"); s.textContent = it.name + " · " + it.price;  // names and prices never translate
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
        c.textContent = say(it, "cap");
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
      if (line.gap) return gapOf(say(line, "gap"));
      var el = document.createElement("div");
      el.className = "msg " + line.side;
      var body = document.createElement("span");
      body.textContent = say(line, "text");
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

    /* One button, three states. Pressing it re-labels every tab and replays the
       conversation you are already on, in the new language — so the visitor
       watches their own trade switch, not a generic sample. */
    var langBtn = document.getElementById("lang-switch");
    if (langBtn) {
      langBtn.addEventListener("click", function () {
        langIndex = (langIndex + 1) % LANGS.length;
        var L = LANGS[langIndex];
        langBtn.textContent = L.next;
        langBtn.setAttribute("data-lang", L.id);
        var note = document.getElementById("lang-now");
        if (note) note.textContent = L.label;
        tabs.forEach(function (t, i) { t.textContent = say(convos[i], "tab"); });
        play(active);                     // replay this trade in the new language
      });
    }

    function play(index) {
      active = index;
      timers.forEach(clearTimeout);
      timers = [];

      var convo = convos[index];
      chat.innerHTML = "";
      chat.appendChild(header(say(convo, "header")));

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

  /* ---- 5. the quote page -------------------------------------------------
     Somebody who has just spent five minutes arguing with the BFC bot should
     not land on a blank form. The demo tells us which build they were looking
     at, so the page opens with that price, and offers the three ways people
     actually start: message now, be called back, or answer the long form. */
  var BUILDS = {
    "bfc":         { name: "Fast food — BFC",            simple: "B$1,800", simpleMo: "B$150/month", ai: "B$5,900", aiMo: "B$250/month" },
    "salon":       { name: "Spa & salon — Verandah House", simple: "B$3,500", simpleMo: "B$150/month", ai: "B$8,400", aiMo: "B$300/month" },
    "restaurant":  { name: "Restaurant — Blue Hole",      simple: "B$3,200", simpleMo: "B$150/month", ai: "B$8,200", aiMo: "B$300/month" },
    "car-rental":  { name: "Car rental — Out Island Auto", simple: "B$2,800", simpleMo: "B$150/month", ai: "B$7,200", aiMo: "B$250/month" },
    "estate":      { name: "Real estate — Fitzwilliam & Cay", simple: "B$4,400", simpleMo: "B$150/month", ai: "B$8,900", aiMo: "B$350/month" },
    "print-shop":  { name: "T-shirt printing — Press 242", simple: "B$5,000", simpleMo: "B$200/month", ai: "B$8,200", aiMo: "B$300/month" },
    "freight":     { name: "Shipping — Ship242",          simple: "B$4,800", simpleMo: "B$150/month", ai: "B$8,800", aiMo: "B$350/month" },
    "rideshare":   { name: "Ride share — Ryde 242",       simple: "B$4,400", simpleMo: "B$150/month", ai: "B$8,600", aiMo: "B$400/month" }
  };

  (function quotePage() {
    var card = document.getElementById("quote-card");
    if (!card) return;
    var which = (location.search.match(/[?&]demo=([a-z-]+)/) || [])[1];
    var b = which && BUILDS[which];

    if (b) {
      card.hidden = false;
      var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
      set("q-name", b.name);
      set("q-simple", b.simple); set("q-simple-mo", "+ " + b.simpleMo);
      set("q-ai", b.ai);         set("q-ai-mo", "+ " + b.aiMo);
      set("q-title", "That build, priced.");
      set("q-lead", "This is the exact site you were just using, with what it costs. Pick how you would like to start.");

      /* the WhatsApp message already says which one they mean — they should
         never have to explain what they were looking at */
      var wa = document.getElementById("wa-link");
      if (wa) {
        wa.href = "https://wa.me/12424481632?text=" +
          encodeURIComponent("Hi — I was looking at the " + b.name + " demo (" + b.simple + " simple / " + b.ai + " with AI). I'd like to talk about one for my business.");
      }
    }

    /* the call-back form: three fields, straight to WhatsApp so it is in writing */
    var cf = document.getElementById("call-form");
    if (cf) {
      cf.addEventListener("submit", function (e) {
        e.preventDefault();
        var g = function (n) { var el = cf.elements[n]; return el && el.value ? el.value.trim() : ""; };
        var lines = [
          "Please call me back.",
          "",
          "Name: " + g("cbname"),
          "Business: " + g("cbbiz"),
          "Number: " + g("cbnum")
        ];
        if (b) lines.push("Looking at: " + b.name + " (" + b.simple + " / " + b.ai + ")");
        window.open("https://wa.me/" + cf.dataset.number + "?text=" + encodeURIComponent(lines.join("\n")), "_blank", "noopener");
        var done = document.getElementById("call-done");
        if (done) { done.hidden = false; done.focus(); }
      });
    }
  })();
})();
