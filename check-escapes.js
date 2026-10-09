#!/usr/bin/env node
/* 🔤 \U0001xxxx IS NOT A JAVASCRIPT ESCAPE, AND CUSTOMERS READ THE DIFFERENCE.
 *
 * Python writes "\U0001f45f" for 👟. JavaScript has no \U - it drops the backslash and prints
 * the rest, so a customer receives:
 *
 *     ASAP U0001f45f we lining it up now
 *
 * This has now happened TWICE in two days, both times because a reply string was written into
 * server.js from a Python patch. The first round went out to real customers for hours; the
 * second was caught by the other session reading my diff. Nobody can be trusted to remember a
 * rule like this at 2am, so it is checked instead.
 *
 * Comments are left alone - they read fine and the history in them is worth keeping. Only
 * \U0001 inside live code is an error.  Run: node check-escapes.js [files...]
 */
const fs = require('fs');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['server.js'];
let bad = 0;
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  src.split('\n').forEach((line, i) => {
    if (!/\\U0001/.test(line)) return;
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;   // a comment
    bad++;
    console.error(`${f}:${i + 1}  \\U0001 is not a JS escape - use \\u{1xxxx}`);
    console.error(`    ${t.slice(0, 140)}`);
  });
}
if (bad) {
  console.error(`\n✗ ${bad} broken emoji escape${bad === 1 ? '' : 's'}. In JS: \\u{1f45f} not \\U0001f45f.`);
  process.exit(1);
}
console.log('✓ no broken emoji escapes');
