const fs = require('fs');
const src = fs.readFileSync('src/services/CronScheduler.js', 'utf8');
const checks = [
  ['startStep wraps startChildProcess with null tenant', /operationManager\.startStep\('background-cycle',\s*'startChildProcess',\s*null\)/.test(src)],
  ['endStep in finally with __scpError', /operationManager\.endStep\('background-cycle',\s*'startChildProcess',\s*null,\s*\{\s*error:\s*__scpError\s*\}\)/.test(src)],
  ['await startChildProcess inside the new inner try', /try\s*\{[\s\S]{0,300}operationManager\.startStep\([^)]*startChildProcess[^)]*\);[\s\S]{0,200}await startChildProcess\(\)/.test(src)],
  ['catch captures + re-throws', /__scpError = scpErr\.message \|\| String\(scpErr\);[\s\S]{0,40}throw scpErr/.test(src)],
  ['forResponse call NOT instrumented with startStep here', !/startStep\([^)]*forResponse/.test(src)],
  ['existing acquireLock still present', /operationManager\.acquireLock\('background-cycle'/.test(src)],
  ['existing releaseLock in outer finally still present', /operationManager\.releaseLock\('background-cycle'\)/.test(src)],
  ['existing addHistory still present', /operationManager\.addHistory\(/.test(src)],
  ['lifecycle handlers untouched (4 task.on calls)', (src.match(/task\.on\(/g) || []).length === 4],
];
let pass = 0;
checks.forEach(([name, ok]) => { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; });
console.log(pass + '/' + checks.length + ' checks passed');
if (pass < checks.length) process.exit(1);
