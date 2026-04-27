const fs = require('fs');
const html = fs.readFileSync('public/schedule.html', 'utf8');

const checks = [
  // Card HTML present
  ['new card id active-operation-card present', /id="active-operation-card"/.test(html)],
  ['card title "Operación en curso"', /Operación en curso/.test(html)],
  ['card initial display:none inline style', /id="active-operation-card"[^>]*style="display: none;"/.test(html)],
  ['active-op-id element with title attribute (value not locked)', /id="active-op-id"[^>]*title=/.test(html)],
  ['active-op-elapsed element', /id="active-op-elapsed"/.test(html)],
  ['active-op-step element with placeholder', /id="active-op-step">Inicializando ciclo…/.test(html)],
  ['fa-play-circle icon in card header', /fa-play-circle/.test(html)],

  // Positional ordering: card BETWEEN Ciclo de Fondo (status-badge) and Progreso en Tiempo Real (timeline)
  ['card placed between Ciclo de Fondo and Progreso en Tiempo Real',
    html.indexOf('id="status-badge"') < html.indexOf('id="active-operation-card"') &&
    html.indexOf('id="active-operation-card"') < html.indexOf('id="timeline"')],

  // STEP_LABELS extension
  ['startChildProcess label added to STEP_LABELS', /startChildProcess:\s*'Importar CFDIs \(proceso hijo\)'/.test(html)],
  ['STEP_LABELS still has all 7 original step keys', /buildProviders:[\s\S]{0,200}downloadCFDI:[\s\S]{0,200}checkPayments:[\s\S]{0,200}uploadPayments:[\s\S]{0,200}createPurchaseOrders:[\s\S]{0,200}processOrderChanges:[\s\S]{0,200}closePurchaseOrders:/.test(html)],

  // Bug elimination
  ['old detectRunningOperation function removed', !/async function detectRunningOperation\(\)/.test(html)],
  ['old detectRunningOperation banner comment removed', !/Auto-detect Running Operations/.test(html)],
  ['buggy operations.find() call gone', !/operations\.find\(/.test(html)],
  ['buggy "if (bgTask.status === \'running\')" block removed', !/if \(bgTask\.status === 'running'\)\s*\{\s*await detectRunningOperation\(\);/.test(html)],

  // Existing structure preserved
  ['Ciclo de Fondo card still present', /Ciclo de Fondo/.test(html)],
  ['Progreso en Tiempo Real card still present', /Progreso en Tiempo Real/.test(html)],
  ['Historial de Ejecuciones card still present', /Historial de Ejecuciones/.test(html)],
  ['connectSSE function still present', /function connectSSE\(operationId\)/.test(html)],
  ['triggerCycle function still present', /async function triggerCycle\(\)/.test(html)],
  ['loadScheduleData function still present', /async function loadScheduleData\(\)/.test(html)],
];

let pass = 0;
checks.forEach(([name, ok]) => { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; });
console.log(pass + '/' + checks.length + ' checks passed');
if (pass < checks.length) process.exit(1);
