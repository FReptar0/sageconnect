const fs = require('fs');
const src = fs.readFileSync('public/js/shared.js', 'utf8');

// Structural checks
const checks = [
  ['formatRelative function declared', /function formatRelative\(isoString\)/.test(src)],
  ['returns "No disponible" on null/empty', /if \(!isoString\) return 'No disponible'/.test(src)],
  ['handles seconds (< 60)', /'hace ' \+ totalSeconds \+ 's'/.test(src)],
  ['handles minutes (< 60)', /'hace ' \+ totalMinutes \+ 'm ' \+ seconds \+ 's'/.test(src)],
  ['handles hours (< 24)', /'hace ' \+ totalHours \+ 'h ' \+ minutes \+ 'm'/.test(src)],
  ['handles days', /'hace ' \+ totalDays \+ 'd ' \+ hours \+ 'h'/.test(src)],
  ['guards against NaN', /Number\.isNaN\(past\)/.test(src)],
  ['guards against future timestamps', /'en el futuro'/.test(src)],
  ['formatDateTime still present', /function formatDateTime\(isoString\)/.test(src)],
  ['formatCurrency still present', /function formatCurrency\(amount\)/.test(src)],
  ['initPage still present', /async function initPage\(activePage\)/.test(src)],
];
let pass = 0;
checks.forEach(([name, ok]) => { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; });

// Behavioral check: load the file via Function constructor in a sandbox-ish way and call formatRelative
// We strip out the parts that touch DOM/fetch to avoid side effects in node.
try {
  const sandbox = { Date, Math, Number, console };
  const fnSource = src.match(/function formatRelative[\s\S]*?\n\}\n/)[0];
  const fn = new Function('Date', 'Math', 'Number', fnSource + 'return formatRelative;')(Date, Math, Number);
  const oneMinAgo = new Date(Date.now() - 65000).toISOString();
  const result = fn(oneMinAgo);
  const ok = /^hace 1m \d+s$/.test(result);
  console.log(ok ? 'PASS' : 'FAIL', 'behavioral: 65s ago → "hace 1m Xs" (got: ' + result + ')');
  if (ok) pass++;
  checks.push(['behavioral']);
} catch (e) {
  console.log('FAIL behavioral check threw:', e.message);
  checks.push(['behavioral']);
}

console.log(pass + '/' + checks.length + ' checks passed');
if (pass < checks.length) process.exit(1);
