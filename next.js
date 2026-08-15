#!/usr/bin/env node
/**
 * next.js — the worklist for the full physical count (Rodney, 2026-08-15).
 *
 * WHY: the Cave Stone proved the real problem isn't reverting, it's DRIFT — a size sat on
 * his shelf that the system never knew about, so Jess couldn't sell it and he couldn't
 * record it when he did. 22 of 339 shoes have ever been verified against the shelf. Until
 * shelf and system start from the same truth, no guard can keep them together.
 *
 * This prints the next shoes to walk, newest-risk first, with what the system currently
 * believes so he can compare against the box in his hand. Progress is written by count.js
 * to ~/sp242-count-progress.json, so this survives closing the chat.
 *
 *   node next.js                 # next 10 to count
 *   node next.js 25              # next 25
 *   node next.js --brand Jordan  # only that brand
 *   node next.js --left          # how many remain, by brand
 */

const KEY = process.env.SHOP_KEY || 'sp242-shop-c988c5711bf067dccccc85b55fc14fde';
const BASE = process.env.SHOP_API || 'https://sneakerplug242-api-production.up.railway.app';
const fs = require('fs');
const path = require('path');
const PROGRESS = path.join(process.env.HOME, 'sp242-count-progress.json');

const argv = process.argv.slice(2);
const brandArg = (() => { const i = argv.indexOf('--brand'); return i > -1 ? argv[i + 1] : null; })();
const onlyLeft = argv.includes('--left');
const limit = parseInt(argv.find(a => /^\d+$/.test(a)), 10) || 10;

const loadProgress = () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); }
  catch (_) { return { startedAt: new Date().toISOString(), done: {} }; }
};

(async () => {
  const st = await (await fetch(`${BASE}/shop/state?key=${KEY}`)).json();
  const catPath = path.join(__dirname, 'catalog.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  const list = Array.isArray(cat) ? cat : (cat.shoes || cat.items);
  const byId = {}; list.forEach(c => byId[c.id] = c);

  const prog = loadProgress();
  const done = prog.done || {};

  let shoes = (st.shoes || []).filter(x => !x.sold && (x.sizes || []).length > 0);
  if (brandArg) shoes = shoes.filter(x => new RegExp(brandArg, 'i').test((byId[x.id] || {}).brand || ''));

  const remaining = shoes.filter(x => !done[x.id]);

  if (onlyLeft) {
    const byBrand = {};
    remaining.forEach(x => { const b = (byId[x.id] || {}).brand || '?'; byBrand[b] = (byBrand[b] || 0) + 1; });
    const totalPairs = remaining.reduce((n, x) => n + x.sizes.length, 0);
    console.log(`\n📋 ${remaining.length} shoes left to count (${totalPairs} pairs). ${Object.keys(done).length} done.`);
    Object.entries(byBrand).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}  ${k}`));
    return;
  }

  // Order: group by brand then model name so he walks the shelf in a sensible run rather
  // than bouncing between boxes. Within that, biggest stock first — most to lose if wrong.
  const key = (x) => {
    const c = byId[x.id] || {};
    return `${c.brand || 'zz'}|${c.name || ''}|${c.color || ''}`;
  };
  remaining.sort((a, b) => key(a).localeCompare(key(b)) || b.sizes.length - a.sizes.length);

  const batch = remaining.slice(0, limit);
  console.log(`\n📋 ${remaining.length} shoes left. Next ${batch.length}:\n`);
  batch.forEach((x, n) => {
    const c = byId[x.id] || {};
    const t = {}; x.sizes.forEach(z => t[z] = (t[z] || 0) + 1);
    const sizes = Object.keys(t).sort((a, b) => parseFloat(a) - parseFloat(b))
      .map(s => `${s}×${t[s]}`).join('  ');
    const nick = c.nickname ? ` (${c.nickname})` : '';
    console.log(`${String(n + 1).padStart(3)}. ${c.brand || '?'} ${c.name || x.id}${nick} — ${c.color || ''}   $${x.price != null ? x.price : c.price}`);
    console.log(`     id: ${x.id}   system says ${x.sizes.length} pairs:  ${sizes}`);
    console.log('');
  });
  console.log('When he calls one out:  node count.js <id> <sizes…>');
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
