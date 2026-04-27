const fs = require('fs');
const html = fs.readFileSync('public/schedule.html', 'utf8');

const checks = [
  // Polling state declarations
  ['activeOpPollHandle declared', /let activeOpPollHandle = null/.test(html)],
  ['activeOpHeartbeatHandle declared', /let activeOpHeartbeatHandle = null/.test(html)],
  ['activeOpSnapshot declared', /let activeOpSnapshot = null/.test(html)],

  // pollActiveOperation function
  ['pollActiveOperation defined as async', /async function pollActiveOperation\(\)/.test(html)],
  ['BUG FIX: operations accessed as MAP not via .find()', /res\.data\.operations\['background-cycle'\]/.test(html)],
  ['BUG FIX: no .find() left on res.data.operations', !/res\.data\.operations\.find\(/.test(html)],
  ['polling triggers SSE when none open with bgOp.operationId', /pollActiveOperation[\s\S]{0,1500}connectSSE\(bgOp\.operationId\)/.test(html)],

  // renderActiveOperationCard function
  ['renderActiveOperationCard defined', /function renderActiveOperationCard\(op\)/.test(html)],
  ['truncates operationId to 8 chars (D-10)', /\.substring\(0,\s*8\)/.test(html)],
  ['sets ISO tooltip on operationId', /idEl\.title = op\.operationId/.test(html)],
  ['uses formatRelative for startedAt', /formatRelative\(op\.startedAt\)/.test(html)],
  ['"Inicializando ciclo…" placeholder for empty stepProgress', /stepEl\.textContent = 'Inicializando ciclo…'/.test(html)],
  ['searches LAST entry without finishedAt (D-08)', /for \(let i = sp\.length - 1; i >= 0; i--\)\s*\{\s*if \(!sp\[i\]\.finishedAt\)/.test(html)],
  ['shows "(completado)" when no active step', /\(completado\)/.test(html)],

  // hideActiveOperationCard function
  ['hideActiveOperationCard defined', /function hideActiveOperationCard\(\)/.test(html)],
  ['hide closes evtSource', /hideActiveOperationCard[\s\S]{0,400}evtSource\.close\(\)/.test(html)],

  // Heartbeat ticker
  ['refreshActiveOperationHeartbeat defined', /function refreshActiveOperationHeartbeat\(\)/.test(html)],
  ['heartbeat refresh skips API call (uses snapshot)', /refreshActiveOperationHeartbeat[\s\S]{0,200}activeOpSnapshot/.test(html)],

  // Lifecycle wiring
  ['polling setInterval(5000)', /setInterval\(pollActiveOperation,\s*5000\)/.test(html)],
  ['heartbeat setInterval(1000)', /setInterval\(refreshActiveOperationHeartbeat,\s*1000\)/.test(html)],
  ['both intervals started in DOMContentLoaded', /DOMContentLoaded[\s\S]{0,1200}activeOpPollHandle = setInterval[\s\S]{0,400}activeOpHeartbeatHandle = setInterval/.test(html)],
  ['initial pollActiveOperation call in DOMContentLoaded (mid-cycle reload coverage)', /DOMContentLoaded[\s\S]{0,1000}await pollActiveOperation\(\);/.test(html)],
  ['beforeunload clears activeOpPollHandle', /beforeunload[\s\S]{0,400}clearInterval\(activeOpPollHandle\)/.test(html)],
  ['beforeunload clears activeOpHeartbeatHandle', /clearInterval\(activeOpHeartbeatHandle\)/.test(html)],

  // Confirm Task 2a deletions still hold
  ['old detectRunningOperation NOT reintroduced', !/async function detectRunningOperation\(\)/.test(html)],
  // Strip JSDoc/comment lines before searching — JSDoc intentionally references the historical bug pattern.
  // We only care that no EXECUTABLE .find() call survives on the operations map.
  ['no .find() on operations anywhere (executable code, comments stripped)', (function () {
    const stripped = html
      .split('\n')
      .filter(line => !/^\s*\*/.test(line) && !/^\s*\/\//.test(line))
      .join('\n');
    return !/operations\.find\(/.test(stripped);
  })()],
  ['no leftover "if (bgTask.status === \'running\') { await detectRunningOperation"', !/if \(bgTask\.status === 'running'\)\s*\{\s*await detectRunningOperation\(\);/.test(html)],

  // Existing structure preserved
  ['connectSSE function still present', /function connectSSE\(operationId\)/.test(html)],
  ['triggerCycle function still present', /async function triggerCycle\(\)/.test(html)],
];

let pass = 0;
checks.forEach(([name, ok]) => { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; });
console.log(pass + '/' + checks.length + ' checks passed');
if (pass < checks.length) process.exit(1);
