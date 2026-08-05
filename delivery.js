// ── Live delivery tracking ────────────────────────────────────────────────────
// A driver opens /driver on their phone, enters the customer's name + WhatsApp +
// address, taps "Out for delivery". Their phone then shares GPS every few seconds.
// The customer and the manager get a /track/<id> link (a live map) by WhatsApp.
//
// Storage is in-memory (resets if the server restarts) — fine for a first version.
// WhatsApp auto-send is best-effort via ManyChat (needs MANYCHAT_TOKEN env); the
// driver page always also shows tap-to-send WhatsApp buttons as a reliable backup.

const deliveries = new Map(); // id -> { id, customer, phone, address, dest, driver, status, createdAt, updatedAt }

const DRIVER_CODE = process.env.DRIVER_CODE || '242';            // simple driver login code
const MANAGER_WA = (process.env.MANAGER_WA || '').replace(/[^0-9]/g, ''); // manager's WhatsApp, digits only

function genId() {
  return Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
}
function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
function distKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function etaMin(driver, dest) {
  const d = distKm(driver, dest);
  if (d == null) return null;
  return Math.max(1, Math.round((d / 25) * 60)); // assume ~25 km/h city driving
}

// Free geocoding (OpenStreetMap Nominatim) — turns an address into lat/lng.
async function geocode(address) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(address + ', Bahamas'), { headers: { 'User-Agent': 'ThePlug242-Delivery/1.0' } });
    const j = await r.json();
    if (Array.isArray(j) && j[0]) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), label: j[0].display_name };
  } catch (_) { /* ignore */ }
  return null;
}

// Best-effort WhatsApp send through ManyChat (find subscriber by phone, then send text).
// 🔑 See the same note in shop.js: MANYCHAT_TOKEN is not set on Railway, so this was
// silently failing — meaning the customer's live delivery-tracking link never sent and
// the driver page's tap-to-send buttons were carrying the whole feature (Rodney
// 2026-08-05). server.js passes down a live token learned from inbound webhooks.
let _fallbackToken = null;
function setFallbackToken(t) { if (t) _fallbackToken = t; }
async function waSend(phoneDigits, text) {
  const token = process.env.MANYCHAT_TOKEN || _fallbackToken;
  if (!token || !phoneDigits) return false;
  try {
    const f = await fetch('https://api.manychat.com/fb/subscriber/findBySystemField?phone=' +
      encodeURIComponent('+' + phoneDigits), { headers: { Authorization: `Bearer ${token}` } });
    const fj = await f.json();
    const d = fj && fj.data;
    const sub = d && (d.id || (Array.isArray(d) && d[0] && d[0].id));
    if (!sub) return false;
    const r = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriber_id: sub, data: { version: 'v2', content: { type: 'whatsapp', messages: [{ type: 'text', text }] } } }),
    });
    return r.ok;
  } catch (_) { return false; }
}

function publicState(d) {
  return {
    id: d.id, customer: d.customer, status: d.status,
    driver: d.driver || null, dest: d.dest || null,
    eta: d.driver && d.dest ? etaMin(d.driver, d.dest) : null,
    arrived: d.driver && d.dest ? (distKm(d.driver, d.dest) <= 0.08) : false, // within ~80m
    updatedAt: d.updatedAt || null,
  };
}

// ── HTML pages (placeholders replaced server-side; client JS left untouched) ──
const DRIVER_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>THE PLUG 242 — Driver</title>
<style>
body{font-family:-apple-system,Arial,sans-serif;margin:0;background:#111;color:#fff}
.wrap{max-width:460px;margin:0 auto;padding:18px}
h1{font-size:20px;margin:6px 0 16px}
label{display:block;font-size:13px;margin:12px 0 4px;color:#bbb}
input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #333;background:#1c1c1c;color:#fff;font-size:16px}
button{width:100%;padding:16px;border:0;border-radius:12px;font-size:17px;font-weight:700;margin-top:16px}
.go{background:#16a34a;color:#fff}.stop{background:#dc2626;color:#fff}
.send{background:#25d366;color:#063;display:block;text-align:center;text-decoration:none;padding:14px;border-radius:12px;margin-top:10px;font-weight:700}
.muted{color:#888;font-size:13px}.live{background:#053; padding:12px;border-radius:10px;margin-top:14px}
.dot{height:10px;width:10px;background:#16a34a;border-radius:50%;display:inline-block;margin-right:6px;animation:b 1s infinite}
@keyframes b{50%{opacity:.3}}
</style></head><body><div class="wrap">
<h1>🛵 THE PLUG 242 — Driver</h1>
<div id="form">
  <label>Driver code</label><input id="code" placeholder="Enter code">
  <label>Customer name</label><input id="customer" placeholder="e.g. John">
  <label>Customer WhatsApp number</label><input id="phone" placeholder="e.g. 1242XXXXXXX" inputmode="tel">
  <label>Delivery address</label><input id="address" placeholder="e.g. Carmichael Rd, Nassau">
  <button class="go" id="start">Out for delivery 🚀</button>
  <p class="muted" id="err"></p>
</div>
<div id="livebox" style="display:none">
  <div class="live"><span class="dot"></span><b>You're live</b> — sharing your location.<div class="muted" id="stat"></div></div>
  <a class="send" id="sendCust" target="_blank">📲 Send link to customer</a>
  <a class="send" id="sendMgr" target="_blank" style="display:none">📲 Send link to manager</a>
  <button class="stop" id="done">Delivered ✅</button>
  <p class="muted">Keep this page open until you tap Delivered.</p>
</div>
<script>
var BASE="__BASE__", MGR="__MANAGER_WA__", id=null, watch=null, last=0;
function $(x){return document.getElementById(x)}
$("start").onclick=async function(){
  $("err").textContent="";
  var body={code:$("code").value.trim(),customer:$("customer").value.trim(),phone:$("phone").value.replace(/[^0-9]/g,''),address:$("address").value.trim()};
  if(!body.customer||!body.phone){$("err").textContent="Add the customer name and number.";return}
  $("start").textContent="Starting…";$("start").disabled=true;
  // Geocode the address here on the phone (Nominatim allows normal devices), send coords.
  if(body.address){try{
    var g=await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(body.address+", Bahamas"));
    var gj=await g.json(); if(gj&&gj[0])body.dest={lat:parseFloat(gj[0].lat),lng:parseFloat(gj[0].lon)};
  }catch(e){}}
  try{
    var r=await fetch(BASE+"/delivery/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    var j=await r.json();
    if(!j.ok){$("err").textContent=j.error||"Could not start.";$("start").textContent="Out for delivery 🚀";$("start").disabled=false;return}
    id=j.id; localStorage.setItem("driverCode",body.code);
    var link=BASE+"/track/"+id;
    var msg="Your THE PLUG 242 order is on the way! 🛵 Track your delivery live here: "+link;
    $("sendCust").href="https://wa.me/"+body.phone+"?text="+encodeURIComponent(msg);
    if(MGR){$("sendMgr").style.display="block";$("sendMgr").href="https://wa.me/"+MGR+"?text="+encodeURIComponent("Delivery to "+body.customer+" is out. Track: "+link)}
    $("form").style.display="none";$("livebox").style.display="block";
    startGps();
  }catch(e){$("err").textContent="Network error.";$("start").textContent="Out for delivery 🚀";$("start").disabled=false}
};
function startGps(){
  if(!navigator.geolocation){$("stat").textContent="This phone can't share GPS.";return}
  watch=navigator.geolocation.watchPosition(function(p){
    var now=Date.now(); if(now-last<4000)return; last=now;
    var lat=p.coords.latitude,lng=p.coords.longitude;
    $("stat").textContent="Location updated "+new Date().toLocaleTimeString();
    fetch(BASE+"/delivery/"+id+"/loc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:lat,lng:lng})});
  },function(e){$("stat").textContent="Location permission needed — tap allow."},{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}
$("done").onclick=async function(){
  if(watch!=null)navigator.geolocation.clearWatch(watch);
  await fetch(BASE+"/delivery/"+id+"/done",{method:"POST"});
  document.body.innerHTML='<div class="wrap"><h1>✅ Delivered</h1><p>Nice work! You can close this page.</p></div>';
};
(function(){var c=localStorage.getItem("driverCode");if(c)$("code").value=c})();
</script></div></body></html>`;

const TRACK_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Track your delivery — THE PLUG 242</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
body{margin:0;font-family:-apple-system,Arial,sans-serif}
#bar{background:#111;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}
#bar b{font-size:16px}#eta{margin-left:auto;background:#16a34a;padding:6px 10px;border-radius:20px;font-size:13px;font-weight:700}
#map{height:calc(100vh - 92px)}
#note{background:#f5f5f5;color:#333;padding:10px 14px;font-size:13px;text-align:center}
.arr{background:#16a34a !important}
</style></head><body>
<div id="bar">🛵 <b>THE PLUG 242</b> <span id="eta">Locating…</span></div>
<div id="map"></div>
<div id="note">Your driver's live location updates automatically.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var BASE="__BASE__", ID="__ID__", map, dMark, hMark, fitted=false;
map=L.map('map').setView([25.05,-77.35],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
var bikeIcon=L.divIcon({html:'<div style="font-size:28px">🛵</div>',className:'',iconSize:[28,28],iconAnchor:[14,14]});
var homeIcon=L.divIcon({html:'<div style="font-size:26px">📍</div>',className:'',iconSize:[26,26],iconAnchor:[13,26]});
async function tick(){
  try{
    var r=await fetch(BASE+"/delivery/"+ID+"/state");var s=await r.json();
    if(!s.ok){document.getElementById('eta').textContent="Not found";return}
    if(s.dest){if(!hMark)hMark=L.marker([s.dest.lat,s.dest.lng],{icon:homeIcon}).addTo(map).bindPopup("Delivery address");}
    if(s.driver){
      var ll=[s.driver.lat,s.driver.lng];
      if(!dMark)dMark=L.marker(ll,{icon:bikeIcon}).addTo(map).bindPopup("Your driver");else dMark.setLatLng(ll);
      if(!fitted){var pts=[ll];if(s.dest)pts.push([s.dest.lat,s.dest.lng]);map.fitBounds(pts,{padding:[60,60],maxZoom:15});fitted=true;}
    }
    var e=document.getElementById('eta');
    if(s.status==='delivered'){e.textContent="Delivered ✅";e.className='arr';document.getElementById('note').textContent="Your order has been delivered. Enjoy! 👟";}
    else if(s.arrived){e.textContent="Driver has arrived! 🎉";e.className='arr';}
    else if(s.eta!=null){e.textContent="~"+s.eta+" min away";}
    else if(s.driver){e.textContent="On the way 🛵";}
    else{e.textContent="Waiting for driver…";}
  }catch(err){}
}
tick();setInterval(tick,4000);
</script></body></html>`;

function mount(app) {
  app.get('/driver', (req, res) => {
    res.set('Content-Type', 'text/html').send(
      DRIVER_HTML.replace(/__BASE__/g, baseUrl(req)).replace(/__MANAGER_WA__/g, MANAGER_WA));
  });

  app.get('/track/:id', (req, res) => {
    res.set('Content-Type', 'text/html').send(
      TRACK_HTML.replace(/__BASE__/g, baseUrl(req)).replace(/__ID__/g, req.params.id));
  });

  app.post('/delivery/start', async (req, res) => {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    if (String(b.code || '') !== DRIVER_CODE) return res.json({ ok: false, error: 'Wrong driver code.' });
    if (!b.customer || !b.phone) return res.json({ ok: false, error: 'Customer name and number required.' });
    const id = genId();
    // Prefer coords the driver's phone already resolved; fall back to server geocode.
    let dest = (b.dest && b.dest.lat != null && b.dest.lng != null)
      ? { lat: parseFloat(b.dest.lat), lng: parseFloat(b.dest.lng) } : null;
    if (!dest && b.address) dest = await geocode(b.address);
    const d = { id, customer: String(b.customer), phone: String(b.phone).replace(/[^0-9]/g, ''),
      address: b.address || '', dest, driver: null, status: 'active', createdAt: Date.now(), updatedAt: Date.now() };
    deliveries.set(id, d);
    const link = `${baseUrl(req)}/track/${id}`;
    // Best-effort WhatsApp auto-send (backup = tap-to-send buttons on the driver page).
    waSend(d.phone, `Your THE PLUG 242 order is on the way! 🛵 Track it live: ${link}`).catch(() => {});
    if (MANAGER_WA) waSend(MANAGER_WA, `🛵 Delivery to ${d.customer} is out for delivery. Track: ${link}`).catch(() => {});
    res.json({ ok: true, id, trackUrl: link });
  });

  app.post('/delivery/:id/loc', (req, res) => {
    const d = deliveries.get(req.params.id);
    if (!d) return res.json({ ok: false });
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
    if (!isNaN(lat) && !isNaN(lng)) { d.driver = { lat, lng }; d.updatedAt = Date.now(); }
    res.json({ ok: true });
  });

  app.get('/delivery/:id/state', (req, res) => {
    const d = deliveries.get(req.params.id);
    if (!d) return res.json({ ok: false });
    res.json({ ok: true, ...publicState(d) });
  });

  app.post('/delivery/:id/done', (req, res) => {
    const d = deliveries.get(req.params.id);
    if (d) { d.status = 'delivered'; d.updatedAt = Date.now(); }
    res.json({ ok: true });
  });
}

module.exports = { mount, setFallbackToken };
