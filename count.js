#!/usr/bin/env node
/**
 * count.js — the ONLY sanctioned way to write a physical stock count.
 *
 * WHY THIS EXISTS (Rodney, 2026-08-15). For weeks stock appeared to "revert": he would
 * count a shoe off the shelf, be told it was saved, and days later the old numbers were
 * back. Everyone (me included) blamed a revert bug and kept hardening the server against
 * stale devices. The audit trail finally settled it: for the black Asics the server had
 * THREE writes ever — a sale on Aug 9, that phone's stale echo, and nothing else until the
 * repair. The count was never reverted. It never arrived. Zero refusals fired across the
 * whole trail; the guards had nothing to block.
 *
 * The real failure is that writing and believing you wrote are two different things, and
 * nothing forced them to agree. `POST /shop/shoe` answers `{ok:true}` for SIX different
 * outcomes — including three that store nothing at all (`skipped: deleted|stale|
 * resurrection-guard`) and one that silently drops sizes (stripRevertedSizes). A caller
 * that checks `if (res.ok)` — every caller — cannot tell a save from a refusal.
 *
 * So this tool never trusts the response. It writes, reads the shoe BACK off the server,
 * and compares size for size. It exits non-zero and prints LOUDLY if they differ. Success
 * here means the server was queried afterwards and agreed — nothing weaker counts.
 *
 *   node count.js <shoeId> 7 7 7.5 8 8 8.5          # sizes, one per PAIR
 *   node count.js <shoeId> --dry                    # show what would change, write nothing
 *
 * Sizes are always MEN'S, one entry per pair, exactly as stored (see the Aug 4 count notes:
 * women's are converted on the way in; a literal "W8" would parseFloat to NaN and make the
 * pair invisible and unsellable).
 */

const KEY = process.env.SHOP_KEY || 'sp242-shop-c988c5711bf067dccccc85b55fc14fde';
const BASE = process.env.SHOP_API || 'https://sneakerplug242-api-production.up.railway.app';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const [id, ...rawSizes] = argv.filter(a => a !== '--dry');
const sizes = rawSizes.map(s => String(s).trim()).filter(Boolean);

if (!id || (!sizes.length && !dry)) {
  console.error('usage: node count.js <shoeId> <size> <size> ...   (one entry per pair)');
  console.error('       node count.js <shoeId> --dry               (show current, write nothing)');
  process.exit(2);
}

// Reject anything that would not survive the schema, before it can poison the record.
const bad = sizes.filter(s => !/^\d{1,2}(\.5)?$/.test(s));
if (bad.length) {
  console.error('❌ these are not valid men\'s sizes: ' + bad.join(', '));
  console.error('   sizes must look like 7, 7.5, 11 — no "W8", no ranges, no letters.');
  process.exit(2);
}

const tally = (arr) => (arr || []).reduce((m, s) => (m[String(s)] = (m[String(s)] || 0) + 1, m), {});
const fmt = (t) => Object.keys(t).sort((a, b) => parseFloat(a) - parseFloat(b))
  .map(s => `  ${String(s).padStart(5)} × ${t[s]}`).join('\n');

const get = async () => {
  const r = await fetch(`${BASE}/shop/state?key=${KEY}`);
  if (!r.ok) throw new Error(`GET /shop/state failed: HTTP ${r.status}`);
  const st = await r.json();
  return (st.shoes || []).find(x => String(x.id) === String(id)) || null;
};

(async () => {
  const before = await get();
  if (!before) {
    console.error(`❌ no shoe with id "${id}" in the live shop state. Check the id — nothing was written.`);
    process.exit(1);
  }

  const beforeT = tally(before.sizes);
  console.log(`\n👟 ${id} — currently ${(before.sizes || []).length} pairs on the server`);
  console.log(fmt(beforeT) || '  (none)');
  console.log(`   last updated: ${before.updatedAt ? new Date(before.updatedAt).toISOString() : 'never'}`);

  if (dry) {
    console.log('\n(--dry: nothing written)');
    return;
  }

  const afterT = tally(sizes);
  console.log(`\n📝 writing ${sizes.length} pairs`);
  console.log(fmt(afterT));

  // _manualEdit:true is REQUIRED on a physical count. Without it stripRevertedSizes treats
  // any size that grew as a stale device replaying old data and silently clamps it — a real
  // restock and a revert look identical by pattern alone, so a human count has to say so.
  // updatedAt must be present and fresh or the newest-wins lock refuses the push outright
  // (inT === 0 is treated as a timeless push from an old cached app and skipped).
  const shoe = Object.assign({}, before, {
    _catalog: true,
    sizes,
    sizesRaw: sizes.slice(),
    sold: false,
    updatedAt: Date.now(),
    _manualEdit: true,
  });

  const res = await fetch(`${BASE}/shop/shoe?key=${KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shoe }),
  });
  const body = await res.json().catch(() => ({}));

  // The response is INFORMATION, never proof. `{ok:true, skipped:'stale'}` means nothing
  // was stored; so does `{ok:true, skipped:'deleted'}`. Print whatever it claims, then go
  // and check for ourselves.
  console.log(`\n↩️  server said: HTTP ${res.status} ${JSON.stringify(body)}`);
  if (body && body.skipped) {
    console.error(`\n❌ REFUSED — the server stored NOTHING (reason: ${body.skipped}).`);
    if (body.skipped === 'deleted') console.error('   This shoe is tombstoned. Undelete it before counting it.');
    if (body.skipped === 'stale')   console.error('   The push looked older than what is stored. Check the clock on this machine.');
    process.exit(1);
  }

  // ── the part that actually matters ──────────────────────────────────────────
  await new Promise(r => setTimeout(r, 1200));
  const after = await get();
  const gotT = tally(after && after.sizes);

  const sizesSeen = [...new Set([...Object.keys(afterT), ...Object.keys(gotT)])]
    .sort((a, b) => parseFloat(a) - parseFloat(b));
  const diffs = sizesSeen.filter(s => (afterT[s] || 0) !== (gotT[s] || 0));

  if (diffs.length) {
    console.error('\n❌❌ WRITE DID NOT LAND AS SENT — the server disagrees:');
    diffs.forEach(s => console.error(`     size ${s}: sent ${afterT[s] || 0}, server has ${gotT[s] || 0}`));
    console.error('   DO NOT report this count as saved. Check /shop/audit?id=' + id);
    process.exit(1);
  }

  // Mark it verified so next.js can pick up where we left off across sessions. Only ever
  // written AFTER the read-back agreed — a shoe is never "done" on the strength of a reply.
  try {
    const fs = require('fs'), path = require('path');
    const P = path.join(process.env.HOME, 'sp242-count-progress.json');
    let prog; try { prog = JSON.parse(fs.readFileSync(P, 'utf8')); }
    catch (_) { prog = { startedAt: new Date().toISOString(), done: {} }; }
    prog.done[id] = { at: new Date().toISOString(), pairs: (after.sizes || []).length };
    fs.writeFileSync(P, JSON.stringify(prog, null, 1));
  } catch (e) { console.error('   (could not update the count progress file: ' + e.message + ')'); }

  console.log(`\n✅ VERIFIED — read back off the server, ${(after.sizes || []).length} pairs, every size matches.`);
  console.log(fmt(gotT));
  console.log(`   stamped: ${new Date(after.updatedAt).toISOString()}`);

  // Show what actually moved, so a silently-skipped size can't hide inside a matching total.
  const moved = [...new Set([...Object.keys(beforeT), ...Object.keys(gotT)])]
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .filter(s => (beforeT[s] || 0) !== (gotT[s] || 0));
  if (moved.length) {
    console.log('\n📊 changed vs before:');
    moved.forEach(s => console.log(`     size ${s}: ${beforeT[s] || 0} → ${gotT[s] || 0}`));
  } else {
    console.log('\n📊 no change — the server already held exactly this.');
  }
})().catch(e => {
  console.error('\n❌ ' + e.message + '\n   Nothing can be assumed saved. Run again.');
  process.exit(1);
});
