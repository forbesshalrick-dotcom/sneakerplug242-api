#!/usr/bin/env node
/**
 * ok.js — mark shoes as EYEBALLED-CORRECT during the full shelf count (Rodney, 2026-08-15).
 *
 * WHY: reading 336 shoes out loud one at a time is the slow way round — Rodney has the shop
 * page in front of him and can scroll it. Most shoes are already right. So he scrolls a
 * section, tells me only what's WRONG, and everything else in that section gets marked
 * verified here. Wrong ones go through count.js, which writes and reads back.
 *
 * This does NOT touch stock — it only records "he compared this to the shelf and it matched".
 * That's the whole point of the count: shelf and system agreeing, confirmed by a human.
 *
 *   node ok.js co548 c0349 co492        # mark these ids checked-and-correct
 *   node ok.js --brand Jordan           # mark every remaining Jordan correct
 *   node ok.js --brand Jordan --except co492 c0355
 *   node ok.js --undo co492             # put one back on the list
 */

const KEY = process.env.SHOP_KEY || 'sp242-shop-c988c5711bf067dccccc85b55fc14fde';
const BASE = process.env.SHOP_API || 'https://sneakerplug242-api-production.up.railway.app';
const fs = require('fs');
const path = require('path');
const PROGRESS = path.join(process.env.HOME, 'sp242-count-progress.json');

const argv = process.argv.slice(2);
const grab = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : null; };
const brand = grab('--brand');
const undo = argv.includes('--undo');
const exceptAt = argv.indexOf('--except');
const except = exceptAt > -1 ? argv.slice(exceptAt + 1).filter(a => !a.startsWith('--')) : [];
const plainIds = argv.filter((a, n) => !a.startsWith('--')
  && argv[n - 1] !== '--brand'
  && (exceptAt === -1 || n < exceptAt));

const load = () => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); }
  catch (_) { return { startedAt: new Date().toISOString(), done: {} }; } };

(async () => {
  const prog = load();
  prog.done = prog.done || {};

  if (undo) {
    plainIds.forEach(id => { delete prog.done[id]; console.log(`↩️  ${id} put back on the list`); });
    fs.writeFileSync(PROGRESS, JSON.stringify(prog, null, 1));
    return;
  }

  const st = await (await fetch(`${BASE}/shop/state?key=${KEY}`)).json();
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
  const list = Array.isArray(cat) ? cat : (cat.shoes || cat.items);
  const byId = {}; list.forEach(c => byId[c.id] = c);
  const live = {}; (st.shoes || []).forEach(x => live[x.id] = x);

  let ids = plainIds;
  if (brand) {
    ids = (st.shoes || [])
      .filter(x => !x.sold && (x.sizes || []).length > 0)
      .filter(x => new RegExp(brand, 'i').test((byId[x.id] || {}).brand || ''))
      .filter(x => !prog.done[x.id])
      .map(x => x.id);
  }
  ids = ids.filter(id => !except.includes(id));

  if (!ids.length) { console.log('nothing to mark — check the ids or the --brand name'); process.exit(2); }

  let n = 0;
  ids.forEach(id => {
    const shoe = live[id];
    if (!shoe) { console.log(`⚠️  ${id} — not in the live shop state, skipped`); return; }
    prog.done[id] = { at: new Date().toISOString(), pairs: (shoe.sizes || []).length, how: 'eyeballed-correct' };
    n++;
  });
  fs.writeFileSync(PROGRESS, JSON.stringify(prog, null, 1));

  const total = (st.shoes || []).filter(x => !x.sold && (x.sizes || []).length > 0).length;
  const done = Object.keys(prog.done).length;
  console.log(`✅ marked ${n} shoe(s) checked-and-correct.`);
  if (except.length) console.log(`   left OFF the list to fix: ${except.join(', ')}`);
  console.log(`📊 ${done} of ${total} verified — ${total - done} to go.`);
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
