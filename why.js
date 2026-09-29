#!/usr/bin/env node
/**
 * why.js — "this shoe is wrong, what actually happened to it?" (Rodney, 2026-08-15)
 *
 * WHY: for weeks a shoe would look wrong and there was no way to tell WHICH of the possible
 * causes it was — a revert, a stale phone, a sale, or a count that never arrived. They all
 * look the same from the shop page. In particular a LOST COUNT is indistinguishable from a
 * same-total swap: he recounts the same physical shelf, so the total is usually already about
 * right and only individual sizes change. If that write never lands, what he sees afterwards
 * is "sizes vanished and appeared, total unchanged" — exactly what a revert looks like.
 *
 * This prints every write the server ever accepted or refused for one shoe, in plain English,
 * so the answer is evidence instead of a theory. Run it the MOMENT something looks wrong —
 * the audit holds 3000 writes and busy days roll it over fast.
 *
 *   node why.js asicsblk001
 *   node why.js asicsblk001 --sales     # also list recorded sales of this shoe
 */

const KEY = process.env.SHOP_KEY || 'sp242-shop-c988c5711bf067dccccc85b55fc14fde';
const BASE = process.env.SHOP_API || 'https://sneakerplug242-api-production.up.railway.app';

const argv = process.argv.slice(2);
const withSales = argv.includes('--sales');
const id = argv.find(a => !a.startsWith('--'));
if (!id) { console.error('usage: node why.js <shoeId> [--sales]'); process.exit(2); }

const tally = (a) => (a || []).reduce((m, s) => (m[String(s)] = (m[String(s)] || 0) + 1, m), {});
const nassau = (s) => new Date(s).toLocaleString('en-US', { timeZone: 'America/Nassau' });

// Plain-English for each decision the server can make. The whole point: three of these
// store NOTHING and still answer {ok:true}, which is how a count gets lost silently.
const MEANING = {
  'accepted': '✅ WROTE IT — this change went in',
  'added': '✅ ADDED — first time this shoe reached the server',
  'shrink-from-stale-app': '⚠️  PART-ACCEPTED — an old phone marked a sale; only the shrink was taken',
  'skipped-stale': '❌ REFUSED, NOTHING STORED — the push looked older than what we hold',
  'skipped-deleted': '❌ REFUSED, NOTHING STORED — this shoe is deleted/tombstoned',
  'resurrection-guard': '❌ REFUSED, NOTHING STORED — first push claimed more stock than the catalog',
  'deleted': '🗑️  DELETED',
  'bulk': '✅ WROTE IT (bulk push)',
};

(async () => {
  const a = await (await fetch(`${BASE}/shop/audit?key=${KEY}&id=${encodeURIComponent(id)}&limit=1000`)).json();
  const rows = a.rows || [];
  const st = await (await fetch(`${BASE}/shop/state?key=${KEY}`)).json();
  const shoe = (st.shoes || []).find(x => String(x.id) === String(id));

  console.log(`\n👟 ${id}`);
  if (shoe) {
    const t = tally(shoe.sizes);
    console.log(`   right now: ${shoe.sizes.length} pairs — ` +
      Object.keys(t).sort((x, y) => parseFloat(x) - parseFloat(y)).map(s => `${s}×${t[s]}`).join('  '));
    console.log(`   last changed: ${shoe.updatedAt ? nassau(shoe.updatedAt) : 'never'}`);
  } else console.log('   ⚠️  not in the live shop state at all');

  console.log(`\n📜 ${rows.length} write(s) on record (the audit holds the last ${a.total} across all shoes).`);
  if (!rows.length) {
    console.log('\n   ⚠️  NOTHING. No write has touched this shoe inside the audit window.');
    console.log('   If you counted it recently and it still looks wrong, the count NEVER ARRIVED —');
    console.log('   it was not reverted. Re-do it with:  node count.js ' + id + ' <sizes…>');
    return;
  }

  rows.forEach(r => {
    const B = tally(r.beforeSizes), A = tally(r.afterSizes);
    const keys = [...new Set([...Object.keys(B), ...Object.keys(A)])].sort((x, y) => parseFloat(x) - parseFloat(y));
    const moved = keys.filter(k => (A[k] || 0) !== (B[k] || 0));
    const bn = (r.beforeSizes || []).length, an = (r.afterSizes || []).length;
    console.log(`\n── ${nassau(r.at)}`);
    console.log(`   ${MEANING[r.decision] || r.decision}${r.via ? '   [' + r.via + ']' : ''}`);
    if (r.why) console.log(`   reason: ${r.why}`);
    console.log(`   total ${bn} → ${an}${bn === an && moved.length ? '   ⚠️  SAME TOTAL but sizes moved' : ''}`);
    if (moved.length) console.log('   ' + moved.map(k => {
      const d = (A[k] || 0) - (B[k] || 0);
      return `${k}: ${B[k] || 0}→${A[k] || 0}${d > 0 ? ' (+' + d + ')' : ' (' + d + ')'}`;
    }).join('   '));
    if (r.revertBlocked) console.log(`   🛡️  revert blocked on size ${r.revertBlocked.join(', ')}`);
    if (r.restockKept) console.log(`   🧱 restock protected on size ${r.restockKept.join(', ')}`);
    const src = r.src || {};
    console.log(`   from ${src.ip || '?'}${src.ua ? ' · ' + src.ua.slice(0, 42) : ''}${src.by ? ' · ' + src.by : ''}`);
  });

  if (withSales) {
    const mine = (st.sales || []).filter(s => String(s.shoeId) === String(id));
    console.log(`\n💰 ${mine.length} recorded sale(s) of this shoe:`);
    mine.forEach(s => console.log(`   ${s.dateStr || s.date} ${s.timeStr || ''} — size ${s.size} — $${s.price}${s.soldBy ? ' — ' + s.soldBy : ''}`));
  }

  console.log('\nReading it: every ❌ line stored NOTHING even though the server answered "ok".');
  console.log('A shoe that looks wrong with no ✅ since your count means the count never landed.');
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
