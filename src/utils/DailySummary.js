// Fase 20.7 (D-01): agenda del resumen diario de reintentos sin éxito, validación del estado de
// cada día resumido y formateadores de la línea de arranque y de la bitácora (D-32, D-34, D-35).
// Parte B (plan 20.7-04): el motivo de cada documento, la ventana y la marca de último día
// calculadas contra el día resumido, el modelo del correo con sus cifras y sus notas, y el HTML
// y el asunto (D-13 a D-15, D-17, D-19, D-23 a D-28).
//
// Módulo sin I/O: no lee ni escribe disco, no abre red y no guarda estado de módulo; lo único a
// nivel de módulo son constantes inmutables (CLAUDE.md §3). Su único require es EomNotification,
// de donde importa el escapado en vez de copiarlo (D-02). Ese módulo carga la config al cargarse,
// así que las pruebas lo cargan con un doble de config. El reloj entra como argumento: `now` es
// el Date que arma getCurrentDate() de TimezoneHelper, cuyos campos LOCALES son la hora de pared
// de TIMEZONE. Por eso cada fecha y cada sello se arman con los accesores locales, nunca
// convirtiendo el instante a UTC, y ninguna función lee un segundo reloj (20.6 D-08). Las fechas
// sin hora (el día resumido, la autorización de una OC, el AUDTDATE de un pago) se comparan como
// texto YYYY-MM-DD, con aritmética UTC.

const { escapeHtml } = require('./EomNotification');

// D-29 y D-07: tope de intentos por día resumido. Un SMTP que acepta el mensaje y falla después
// convierte cada reintento en un duplicado en el buzón del operador (20.6 D-10); con 4, el peor
// caso son 4 copias.
const MAX_ATTEMPTS = 4;

// D-29 y D-07: espera, en minutos contados desde el intento ANTERIOR, para el 2.º, el 3.º y el 4.º
// (WR-03 de la revisión; antes se contaban desde el primero, con 60, 240 y 720). Con ejecuciones
// regulares dan el mismo calendario: cubren una caída del correo de toda la noche (23:45, 00:45,
// 03:45 y 11:45) y terminan antes de la hora del resumen siguiente. Tras un hueco de ejecuciones
// (servicio apagado, candado retenido) conservan el espaciado: contadas desde el primero, vencían a
// la vez y salían en ráfaga cada 15 minutos contra el buzón del operador (20.6 D-10). Es constante
// del código y no del .env, para no sumar perillas.
const RETRY_OFFSETS_MIN = Object.freeze([60, 180, 480]);

// D-29 y D-24: renglones por sección del correo; el resto se anuncia con el comando de la vista
// previa (RD-11).
const ROW_CAP = 100;

/**
 * Fecha `YYYY-MM-DD` tomada de los accesores locales del Date. Para un Date de
 * getCurrentDate() es la fecha en TIMEZONE, la misma que nombra las carpetas de bitácora.
 *
 * @param {Date} date
 * @returns {string|null} `null` si no es un Date válido.
 */
function localDateISO(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }
    const yyyy = String(date.getFullYear()).padStart(4, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Sello `YYYY-MM-DDTHH:MM:SS` con la hora de pared de TIMEZONE, sin zona. Es el `at` de cada
 * intento en el estado del día.
 *
 * @param {Date} date
 * @returns {string|null} `null` si no es un Date válido.
 */
function localStamp(date) {
    const day = localDateISO(date);
    if (day === null) {
        return null;
    }
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${day}T${hh}:${mi}:${ss}`;
}

/**
 * Inverso de `localStamp`: arma el Date con el constructor local a partir del formato exacto.
 *
 * @param {string} text
 * @returns {Date|null} `null` si el texto no casa con el formato o no regresa idéntico por
 *   `localStamp` (un 30 de febrero, una hora 24).
 */
function parseStamp(text) {
    if (typeof text !== 'string') {
        return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if (match === null) {
        return null;
    }
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day, hour, minute, second);
    // Ida y vuelta: el constructor desborda un campo imposible hacia otra fecha, y entonces el
    // texto que sale ya no es el que entró.
    return localStamp(date) === text ? date : null;
}

/**
 * `true` solo para un texto `YYYY-MM-DD` que además es una fecha real del calendario.
 * La comprobación de ida y vuelta usa aritmética UTC sobre la fecha sin hora.
 *
 * @param {*} text
 * @returns {boolean}
 */
function isIsoDate(text) {
    if (typeof text !== 'string') {
        return false;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (match === null) {
        return false;
    }
    const [year, month, day] = match.slice(1).map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return probe.getUTCFullYear() === year
        && probe.getUTCMonth() === month - 1
        && probe.getUTCDate() === day;
}

/**
 * Suma `n` días a una fecha `YYYY-MM-DD` con aritmética UTC sobre la fecha sin hora, así que
 * ningún cambio de horario del sistema la mueve.
 *
 * @param {string} iso
 * @param {number} n - Entero; negativo para restar.
 * @returns {string|null} `null` si `iso` no es una fecha válida o `n` no es entero.
 */
function addDaysISO(iso, n) {
    if (!isIsoDate(iso) || !Number.isInteger(n)) {
        return null;
    }
    const [year, month, day] = iso.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + n));
    const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
    const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Valida el estado de un día resumido tal como se lee de disco (D-04):
 * `{ date, status: 'pending'|'delivered'|'abandoned', attempts: [{ at, delivered, error }], reason? }`.
 *
 * Exige: objeto no nulo y no arreglo; `date === dateISO`; un `status` conocido; `attempts`
 * arreglo de a lo más `MAX_ATTEMPTS`; cada intento objeto con `at` que acepta `parseStamp` y
 * `delivered` en `true`, `false` o `null` (D-08: `null` es un intento anotado antes de enviar);
 * un `pending` sin ningún intento entregado; un `delivered` cuyo último intento se entregó; y un
 * `abandoned` con `reason` de texto no vacío. Todo lo demás es un estado dañado (T-20.7-06).
 *
 * @param {*} data
 * @param {string} dateISO - La fecha que le corresponde a ese archivo.
 * @returns {boolean}
 */
function isValidDayState(data, dateISO) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    if (!isIsoDate(dateISO) || data.date !== dateISO) {
        return false;
    }
    if (data.status !== 'pending' && data.status !== 'delivered' && data.status !== 'abandoned') {
        return false;
    }
    if (!Array.isArray(data.attempts) || data.attempts.length > MAX_ATTEMPTS) {
        return false;
    }
    for (const attempt of data.attempts) {
        if (!attempt || typeof attempt !== 'object') {
            return false;
        }
        if (parseStamp(attempt.at) === null) {
            return false;
        }
        if (attempt.delivered !== true && attempt.delivered !== false && attempt.delivered !== null) {
            return false;
        }
    }
    if (data.status === 'pending' && data.attempts.some((attempt) => attempt.delivered === true)) {
        return false;
    }
    if (data.status === 'delivered') {
        const last = data.attempts[data.attempts.length - 1];
        if (!last || last.delivered !== true) {
            return false;
        }
    }
    if (data.status === 'abandoned' && (typeof data.reason !== 'string' || data.reason.length === 0)) {
        return false;
    }
    return true;
}

// Clasifica la envoltura que entrega el despachador: `missing`, `ok`, `unreadable` o `corrupt`.
// Un `ok` se vuelve a validar aquí y cualquier forma no reconocida cuenta como dañada, así que lo
// que no se puede probar válido nunca llega a ser objetivo de un envío. `unreadable` es una
// lectura que falló por E/S (WR-01): no dice nada del contenido, así que ese día no se toca en
// esta ejecución, ni para abandonarlo ni para intentarlo.
function classifyDayState(read, dateISO) {
    if (read && read.status === 'missing') {
        return 'missing';
    }
    if (read && read.status === 'unreadable') {
        return 'unreadable';
    }
    if (read && read.status === 'ok' && isValidDayState(read.data, dateISO)) {
        return 'ok';
    }
    return 'corrupt';
}

// D-07: la operación que toca sobre el día objetivo, que siempre llega pendiente. Cada espera se
// cuenta desde el intento ANTERIOR (WR-03), con el `now` de esta ejecución contra el sello que dejó
// ese intento: los dos salen del mismo reloj.
function nextAttemptOp(dateISO, state, now) {
    const n = state.attempts.length;
    if (n >= MAX_ATTEMPTS) {
        return { type: 'abandon', date: dateISO, reason: 'max-attempts', attempts: n };
    }
    if (n === 0) {
        return { type: 'attempt', date: dateISO, attemptNumber: 1 };
    }
    const previous = parseStamp(state.attempts[n - 1].at);
    if (previous === null) {
        return { type: 'abandon', date: dateISO, reason: 'state-corrupt', attempts: n };
    }
    const elapsedMin = (now.getTime() - previous.getTime()) / 60000;
    if (elapsedMin >= RETRY_OFFSETS_MIN[n - 1]) {
        return { type: 'attempt', date: dateISO, attemptNumber: n + 1 };
    }
    return null;
}

/**
 * Decide qué toca hacer con el resumen diario en esta ejecución (D-06). Pura: recibe el reloj
 * y los dos estados ya leídos, y devuelve una lista ORDENADA de operaciones que el despachador
 * aplica tal cual.
 *
 * Orden de la decisión:
 *   1. Fail-closed, como shouldDispatchPaymentReport: config que no es objeto, `enabled` distinto
 *      de `true`, `now` inválido, u hora y minuto que no son enteros en rango → ninguna operación
 *      y sin fechas.
 *   2. Hoy ausente → `create` (D-05: la primera ejecución encendida del día crea su estado; un
 *      día sin estado no debe nada). Hoy dañado → `abandon` con `state-corrupt`, y hoy no es
 *      objetivo. Hoy ilegible (`unreadable`, WR-01) → ninguna operación sobre hoy.
 *   3. A partir de la hora, comparada con hora y minuto del inicio de la ejecución (D-09): ayer
 *      pendiente → `abandon` con `next-summary-due`, y el objetivo es hoy si sigue pendiente.
 *      Antes de la hora: ayer dañado → `abandon` con `state-corrupt`; ayer pendiente → es el
 *      objetivo. Ayer ausente o ilegible nunca produce operaciones y ningún día anterior a ayer
 *      se mira.
 *   4. Con un objetivo de `n` intentos: `n >= MAX_ATTEMPTS` → `abandon` con `max-attempts`;
 *      `n === 0` → `attempt` 1; si no, `attempt` n+1 solo cuando ya pasaron
 *      `RETRY_OFFSETS_MIN[n - 1]` minutos desde el intento anterior (WR-03).
 *
 * Un estado `ok` se vuelve a validar con `isValidDayState`: uno de otra fecha o incoherente se
 * trata como dañado y nunca provoca un envío (T-20.7-06). Un día cuya lectura falló por E/S
 * (`unreadable`) no se trata como dañado: abandonarlo lo perdería para siempre por una falla
 * pasajera, así que no recibe ninguna operación y la ejecución siguiente lo vuelve a leer (WR-01).
 *
 * @param {{now: Date, summaryCfg: {enabled: boolean, hour: number, minute: number},
 *          today: {status: string, data?: object}, yesterday: {status: string, data?: object}}} input
 *   `summaryCfg` es `config.notifications.dailySummary`; `today` y `yesterday` son
 *   `{ status: 'missing' }`, `{ status: 'ok', data }`, `{ status: 'unreadable', error }` o
 *   `{ status: 'corrupt' }`.
 * @returns {{todayISO: string|null, yesterdayISO: string|null, ops: object[]}} Las operaciones son
 *   `{ type: 'create', date }`, `{ type: 'abandon', date, reason, attempts }` con `reason` en
 *   `next-summary-due`, `max-attempts` o `state-corrupt`, y `{ type: 'attempt', date,
 *   attemptNumber }`. A lo más un `attempt` por llamada.
 */
function decideDailySummaryAction(input) {
    const { now, summaryCfg, today, yesterday } = (input && typeof input === 'object') ? input : {};
    const closed = { todayISO: null, yesterdayISO: null, ops: [] };

    if (!summaryCfg || typeof summaryCfg !== 'object') {
        return closed;
    }
    if (summaryCfg.enabled !== true) {
        return closed;
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        return closed;
    }
    const { hour, minute } = summaryCfg;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return closed;
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        return closed;
    }

    const todayISO = localDateISO(now);
    const yesterdayISO = addDaysISO(todayISO, -1);
    const afterHour = now.getHours() > hour
        || (now.getHours() === hour && now.getMinutes() >= minute);
    const ops = [];

    const todayKind = classifyDayState(today, todayISO);
    let todayState = null;
    if (todayKind === 'missing') {
        ops.push({ type: 'create', date: todayISO });
        todayState = { status: 'pending', attempts: [] };
    } else if (todayKind === 'corrupt') {
        ops.push({ type: 'abandon', date: todayISO, reason: 'state-corrupt', attempts: 0 });
    } else if (todayKind === 'ok') {
        todayState = today.data;
    }
    // `unreadable` (WR-01): hoy no recibe ninguna operación en esta ejecución.

    const yesterdayKind = classifyDayState(yesterday, yesterdayISO);
    const yesterdayPending = yesterdayKind === 'ok' && yesterday.data.status === 'pending';
    let targetISO = null;
    let targetState = null;
    if (afterHour) {
        if (yesterdayPending) {
            ops.push({ type: 'abandon', date: yesterdayISO, reason: 'next-summary-due', attempts: yesterday.data.attempts.length });
        }
        if (todayState !== null && todayState.status === 'pending') {
            targetISO = todayISO;
            targetState = todayState;
        }
    } else if (yesterdayKind === 'corrupt') {
        ops.push({ type: 'abandon', date: yesterdayISO, reason: 'state-corrupt', attempts: 0 });
    } else if (yesterdayPending) {
        targetISO = yesterdayISO;
        targetState = yesterday.data;
    }

    if (targetState !== null) {
        const op = nextAttemptOp(targetISO, targetState, now);
        if (op !== null) {
            ops.push(op);
        }
    }

    return { todayISO, yesterdayISO, ops };
}

/**
 * Texto apto para una línea de bitácora (S-3): espacios en blanco colapsados, sin orillas y
 * recortado a `max` caracteres, para que un mensaje de varios renglones no arrastre contexto a
 * la bitácora (T-20.7-08). Mismo saneado que el `err=` del aviso inmediato de OCs en
 * PortalOC_Creator.
 *
 * @param {*} value - Normalmente el mensaje del transporte de correo.
 * @param {number} [max=200] - Entero positivo; cualquier otro valor vuelve a 200.
 * @returns {string} `sin detalle` si viene vacío, nulo o no se puede convertir a texto.
 */
function sanitizeLogText(value, max = 200) {
    const limit = Number.isInteger(max) && max > 0 ? max : 200;
    try {
        const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
        return text.length === 0 ? 'sin detalle' : text.slice(0, limit);
    } catch (_err) {
        return 'sin detalle';
    }
}

// Valores de una línea clave=valor: lo que no tiene la forma esperada sale `n/a`, así ningún
// valor puede partir la línea ni colar un renglón nuevo.
function logDate(value) {
    return isIsoDate(value) ? value : 'n/a';
}

function logCount(value) {
    return Number.isFinite(value) ? String(value) : 'n/a';
}

function logInteger(value) {
    return Number.isInteger(value) ? String(value) : 'n/a';
}

/**
 * Línea de arranque con el estado de los cuatro avisos y la hora del resumen (D-32):
 * `po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=23:45`
 * detrás de la etiqueta NOTIFICATIONS.
 *
 * Solo `=== true` enciende; cualquier otro valor, incluido el texto 'true', sale `off`. La
 * llama initScheduler() con la config del servicio, y hay suites que la cargan con dobles sin
 * `notifications` ni `eom` (D-40). Por eso todo se lee con encadenamiento opcional, una llave
 * ausente cuenta como apagada, la hora sale `n/a` si no es válida, y el cuerpo va dentro de un
 * try/catch: la línea de arranque nunca lanza.
 *
 * @param {object} cfg - El objeto de config completo.
 * @returns {string}
 */
function formatNotificationStatusLine(cfg) {
    try {
        const onOff = (value) => (value === true ? 'on' : 'off');
        const daily = cfg?.notifications?.dailySummary;
        const hour = daily?.hour;
        const minute = daily?.minute;
        const validTime = Number.isInteger(hour) && hour >= 0 && hour <= 23
            && Number.isInteger(minute) && minute >= 0 && minute <= 59;
        const time = validTime
            ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
            : 'n/a';
        return '[NOTIFICATIONS]'
            + ` po-alert=${onOff(cfg?.notifications?.poAlert?.enabled)}`
            + ` eom=${onOff(cfg?.eom?.notificationEnabled)}`
            + ` payment-report=${onOff(cfg?.notifications?.paymentReport?.enabled)}`
            + ` daily-summary=${onOff(daily?.enabled)}`
            + ` daily-summary-time=${time}`;
    } catch (_err) {
        return '[NOTIFICATIONS] status=unreadable';
    }
}

/**
 * Línea de bitácora de un intento del resumen, una sola por intento (D-34):
 * `date=2026-11-03 attempt=1/4 sent=true oc-uploaded=12 payments-uploaded=30 oc-pending=3
 * payments-pending=2 last-day=1 incomplete=false` detrás de la etiqueta DAILY-SUMMARY.
 *
 * `sent` es `true` solo con `delivered === true` (S-2). Si no se entregó, agrega `err=` con el
 * mensaje del transporte saneado y acotado a 200 caracteres. Una cifra nula o ausente sale `n/a`.
 *
 * @param {{dateISO: string, attemptNumber: number, delivered: (boolean|null), counts: object,
 *          incomplete: boolean, error: *}} entry - `counts` lleva `ocUploaded`,
 *   `paymentsUploaded`, `ocPending`, `paymentsPending` y `lastDay`.
 * @returns {string}
 */
function formatAttemptLogLine(entry) {
    const { dateISO, attemptNumber, delivered, counts, incomplete, error } = (entry && typeof entry === 'object') ? entry : {};
    const c = (counts && typeof counts === 'object') ? counts : {};
    const sent = delivered === true;
    const parts = [
        '[DAILY-SUMMARY]',
        `date=${logDate(dateISO)}`,
        `attempt=${logInteger(attemptNumber)}/${MAX_ATTEMPTS}`,
        `sent=${sent}`,
        `oc-uploaded=${logCount(c.ocUploaded)}`,
        `payments-uploaded=${logCount(c.paymentsUploaded)}`,
        `oc-pending=${logCount(c.ocPending)}`,
        `payments-pending=${logCount(c.paymentsPending)}`,
        `last-day=${logCount(c.lastDay)}`,
        `incomplete=${typeof incomplete === 'boolean' ? incomplete : 'n/a'}`,
    ];
    if (!sent) {
        parts.push(`err=${sanitizeLogText(error)}`);
    }
    return parts.join(' ');
}

/**
 * Línea de bitácora del abandono de un día (D-34, RD-02 y RD-03):
 * `date=2026-11-02 reason=next-summary-due attempts=2` detrás de la etiqueta DAILY-SUMMARY-ABANDON.
 *
 * @param {{dateISO: string, reason: string, attempts: number}} entry - `reason` es una clave
 *   como `next-summary-due`, `max-attempts` o `state-corrupt`; cualquier otra forma sale `n/a`.
 * @returns {string}
 */
function formatAbandonLogLine(entry) {
    const { dateISO, reason, attempts } = (entry && typeof entry === 'object') ? entry : {};
    const safeReason = typeof reason === 'string' && /^[a-z]+(-[a-z]+)*$/.test(reason) ? reason : 'n/a';
    return `[DAILY-SUMMARY-ABANDON] date=${logDate(dateISO)} reason=${safeReason} attempts=${logInteger(attempts)}`;
}

/**
 * Línea de aviso cuando la fecha de SQL Server no coincide con la de TIMEZONE (D-35):
 * `tz-date=2026-11-03 sql-date=2026-11-04` detrás de la etiqueta DAILY-SUMMARY-CLOCK.
 *
 * @param {string} tzDate - El día resumido, en TIMEZONE.
 * @param {string} sqlDate - La fecha que devolvió la consulta de OCs.
 * @returns {string}
 */
function formatClockWarnLine(tzDate, sqlDate) {
    return `[DAILY-SUMMARY-CLOCK] tz-date=${logDate(tzDate)} sql-date=${logDate(sqlDate)}`;
}

// ---------------------------------------------------------------------------------------------
// Parte B: motivos, ventana, marca de último día y modelo del correo.
// ---------------------------------------------------------------------------------------------

/**
 * Motivo de una OC sin éxito, sacado de su última fila ERROR del día (D-13):
 *   - `isValidation` 1, la fila del sitio de validación con idFocaltec vacío → «Validación de datos»;
 *   - un texto que empieza con `<dígitos>: ` → «Portal <código>»;
 *   - un texto que empieza con `undefined: `, el portal respondió sin código → «Respuesta del
 *     portal sin código»;
 *   - cualquier otro texto, de red o de tiempo agotado → «Sin respuesta del portal».
 *
 * @param {{isValidation: (number|boolean), lastError: (string|null)}} row
 * @returns {{key: string, title: string}}
 */
function classifyOcReason(row) {
    const { isValidation, lastError } = (row && typeof row === 'object') ? row : {};
    if (isValidation === 1 || isValidation === true) {
        return { key: 'validation', title: 'Validación de datos' };
    }
    const text = typeof lastError === 'string' ? lastError : '';
    const portal = /^(\d+): /.exec(text);
    if (portal !== null) {
        return { key: `portal-${portal[1]}`, title: `Portal ${portal[1]}` };
    }
    if (text.startsWith('undefined: ')) {
        return { key: 'portal-no-code', title: 'Respuesta del portal sin código' };
    }
    return { key: 'no-response', title: 'Sin respuesta del portal' };
}

/**
 * Grupo de un pago que el portal no aceptó (RD-06): `rejected` va por su código («Portal 1827»,
 * o «Portal sin código» si no lo trae) y `no-response` va a «Sin respuesta del portal». Ningún
 * código se trata como «sin acción»: el 1827 dice que alguna factura ya está pagada, no todas.
 *
 * @param {object} entry - Una entrada del registro de pagos (D-16).
 * @returns {{key: string, title: string}|null} `null` si el resultado no es un rechazo ni un
 *   intento sin respuesta.
 */
function classifyPaymentRejection(entry) {
    const outcome = (entry && typeof entry === 'object') ? entry.outcome : undefined;
    if (outcome === 'no-response') {
        return { key: 'no-response', title: 'Sin respuesta del portal' };
    }
    if (outcome !== 'rejected') {
        return null;
    }
    const code = entry.code == null ? '' : String(entry.code).trim();
    if (code.length === 0) {
        return { key: 'portal-no-code', title: 'Portal sin código' };
    }
    return { key: `portal-${code}`, title: `Portal ${code}` };
}

// D-15: borde inferior de la ventana `last_n_days`, contado contra el día resumido y nunca contra
// el día en que corre el envío. Así una reposición al día siguiente conserva los renglones de
// último día (PATTERNS, Advertencia C). `null` si el alcance es otro o los días no son un entero
// no negativo.
function lookbackBorder(dayISO, retry) {
    if (!retry || typeof retry !== 'object' || retry.scope !== 'last_n_days') {
        return null;
    }
    if (!Number.isInteger(retry.lookbackDays) || retry.lookbackDays < 0) {
        return null;
    }
    return addDaysISO(dayISO, -retry.lookbackDays);
}

/**
 * ¿La fecha del documento cae dentro de la ventana de reintentos del día resumido? Es la misma
 * semántica que el filtro de ventana del ciclo (RetryPolicy), pero medida contra `dayISO` (D-15):
 * con `last_n_days`, fecha >= D − N; con `current_month`, el mismo mes que D. Compara texto
 * `YYYY-MM-DD`.
 *
 * @param {string|null} docDateISO - La autorización de la OC o el AUDTDATE del pago.
 * @param {string} dayISO - El día resumido.
 * @param {{scope: string, lookbackDays?: number}} retry - `config.retry`.
 * @returns {boolean} `false` ante una fecha inválida o un alcance desconocido.
 */
function isWithinRetryWindow(docDateISO, dayISO, retry) {
    if (!isIsoDate(docDateISO) || !isIsoDate(dayISO) || !retry || typeof retry !== 'object') {
        return false;
    }
    if (retry.scope === 'current_month') {
        return docDateISO.slice(0, 7) === dayISO.slice(0, 7);
    }
    const border = lookbackBorder(dayISO, retry);
    return border !== null && docDateISO >= border;
}

/**
 * ¿Es el último día de reintento automático del documento (RD-08)? Un solo cálculo para OCs y
 * pagos (D-15): con `last_n_days`, la fecha es exactamente D − N, porque mañana el borde avanza y
 * la deja fuera; con `current_month`, D es el último día de su mes (un día después cambia de mes)
 * y todo el mes sale de la ventana mañana.
 *
 * @param {string|null} docDateISO
 * @param {string} dayISO
 * @param {{scope: string, lookbackDays?: number}} retry
 * @returns {boolean} `false` fuera de la ventana, ante entrada inválida o con alcance desconocido.
 */
function isLastRetryDay(docDateISO, dayISO, retry) {
    if (!isWithinRetryWindow(docDateISO, dayISO, retry)) {
        return false;
    }
    if (retry.scope === 'current_month') {
        return addDaysISO(dayISO, 1).slice(0, 7) !== dayISO.slice(0, 7);
    }
    return docDateISO === lookbackBorder(dayISO, retry);
}

// Una config de reintentos con la que se puede calcular la ventana. Sin ella el modelo no lista
// OCs y lo dice en una nota, en lugar de presentar el día como sin pendientes (D-27).
function isUsableRetry(retry) {
    if (!retry || typeof retry !== 'object') {
        return false;
    }
    if (retry.scope === 'current_month') {
        return true;
    }
    return retry.scope === 'last_n_days' && Number.isInteger(retry.lookbackDays) && retry.lookbackDays >= 0;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

// Compara por código de carácter, sin depender del idioma del sistema: el orden del correo es el
// mismo en cualquier servidor y el fixture puede fijarlo byte a byte.
function compareText(a, b) {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

// D-24: llave de orden de un renglón. Primero los de último día, luego la fecha más vieja (los
// que no traen fecha al final), luego el documento y la empresa.
function sortKey(lastDay, date, doc, tenant) {
    return {
        lastDay: lastDay === true,
        date: isIsoDate(date) ? date : null,
        doc: doc == null ? '' : String(doc),
        tenant: tenant == null ? '' : String(tenant),
    };
}

function compareSortKeys(a, b) {
    if (a.lastDay !== b.lastDay) {
        return a.lastDay ? -1 : 1;
    }
    if (a.date !== b.date) {
        if (a.date === null) {
            return 1;
        }
        if (b.date === null) {
            return -1;
        }
        return compareText(a.date, b.date);
    }
    return compareText(a.doc, b.doc) || compareText(a.tenant, b.tenant);
}

// Copia ordenada de `items` con la llave que `keyOf` saca de cada uno.
function sortedBy(items, keyOf) {
    return items
        .map((item) => ({ item, key: keyOf(item) }))
        .sort((a, b) => compareSortKeys(a.key, b.key))
        .map((entry) => entry.item);
}

function oldestDate(payments) {
    let oldest = null;
    for (const payment of payments) {
        if (isIsoDate(payment.fechaRegistro) && (oldest === null || payment.fechaRegistro < oldest)) {
            oldest = payment.fechaRegistro;
        }
    }
    return oldest;
}

// Llave de orden de cualquier renglón del modelo. El de un proveedor sin ID se ordena con la
// fecha más vieja de sus pagos y con el proveedor como documento (D-24).
function rowSortKey(row) {
    if (Array.isArray(row.payments)) {
        return sortKey(row.lastDay, oldestDate(row.payments), row.vendor, row.tenant);
    }
    if (hasOwn(row, 'idOrPo')) {
        return sortKey(row.lastDay, row.fechaAuth, row.idOrPo, row.tenant);
    }
    return sortKey(row.lastDay, row.fechaRegistro, row.docnbr, row.tenant);
}

// Agrega un renglón al grupo de su motivo, y crea el grupo la primera vez.
function addToGroup(groups, reason, row) {
    if (!hasOwn(groups, reason.key)) {
        groups[reason.key] = { key: reason.key, title: reason.title, rows: [] };
    }
    groups[reason.key].rows.push(row);
}

// D-24: los grupos van del más grande al más chico y, empatados, por título; sus renglones, con
// rowSortKey.
function sortedGroups(groups) {
    return Object.keys(groups)
        .map((key) => ({ key, title: groups[key].title, rows: sortedBy(groups[key].rows, rowSortKey) }))
        .sort((a, b) => (b.rows.length - a.rows.length) || compareText(a.title, b.title) || compareText(a.key, b.key));
}

// El texto de un error dentro de una nota: en un renglón, acotado y sin punto final, porque la
// nota pone el suyo.
function noteDetail(error) {
    const text = sanitizeLogText(error, 200).replace(/\.+$/, '');
    return text.length === 0 ? 'sin detalle' : text;
}

// D-27: una nota por cada fuente que falló, con la empresa y el error. Se escapa al renderizar.
function sourceFailureNote(failure) {
    const tenant = failure.tenant == null ? 'una empresa' : String(failure.tenant);
    const detail = noteDetail(failure.error);
    if (failure.source === 'oc-errors') {
        return `No se pudieron leer las OCs con error de ${tenant}: ${detail}.`;
    }
    if (failure.source === 'oc-uploaded') {
        return `No se pudieron contar las OCs subidas de ${tenant}: ${detail}.`;
    }
    if (failure.source === 'payments-control') {
        return `No se pudo leer la tabla de control de pagos de ${tenant}: ${detail}. Algunos pagos de la lista pudieron subirse después.`;
    }
    return `No se pudo leer una fuente de datos de ${tenant} (${sanitizeLogText(failure.source, 50)}): ${detail}.`;
}

// El registro tal como lo entregó readPaymentDayLedger, revalidado aquí: una envoltura que no se
// reconoce, o un `ok` de otra fecha, de otra versión o sin empresas, cuenta como ilegible, igual
// que en la agenda (T-20.7-06). Devuelve `data` o `null`.
function readableLedgerData(ledger, dateISO) {
    if (!ledger || typeof ledger !== 'object' || ledger.status !== 'ok') {
        return null;
    }
    const data = ledger.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }
    if (data.version !== 1 || data.date !== dateISO) {
        return null;
    }
    if (!data.tenants || typeof data.tenants !== 'object' || Array.isArray(data.tenants)) {
        return null;
    }
    return data;
}

// D-19: la hora del reinicio sale del recoveredAt que vive en la RAÍZ del registro, con la forma
// de localStamp; su `HH:MM` es el tramo 11-16.
function recoveredNote(recoveredAt) {
    if (parseStamp(recoveredAt) === null) {
        return 'Datos de pagos incompletos: el registro se reinició.';
    }
    return `Datos de pagos incompletos: el registro se reinició a las ${recoveredAt.slice(11, 16)}.`;
}

function queryFailuresNote(tenant, entry) {
    const runs = Number.isInteger(entry.runs) ? String(entry.runs) : '?';
    const base = `La consulta de pagos de ${tenant} falló en ${entry.queryFailures} de ${runs} corridas del día`;
    if (entry.lastQueryError == null) {
        return `${base}.`;
    }
    return `${base} (último error: ${noteDetail(entry.lastQueryError)}).`;
}

// WR-05 (D-27): la subida de pagos de la empresa se interrumpió (el catch externo de
// uploadPayments) en algunas corridas: los pagos que faltaban no se intentaron, así que el día no
// se puede presentar como limpio.
function runFailuresNote(tenant, entry) {
    const runs = Number.isInteger(entry.runs) ? String(entry.runs) : '?';
    const base = `La subida de pagos de ${tenant} se interrumpió en ${entry.runFailures} de ${runs} corridas del día`;
    if (entry.lastRunError == null) {
        return `${base}.`;
    }
    return `${base} (último error: ${noteDetail(entry.lastRunError)}).`;
}

// D-14: los NoPagoSage de la empresa como diccionario de textos recortados, o `null` si su tabla
// de control no se leyó y el cruce no es posible. Acepta un arreglo o un Set.
function controlSetOf(controlByTenant, tenant) {
    if (!controlByTenant || typeof controlByTenant !== 'object' || !hasOwn(controlByTenant, tenant)) {
        return null;
    }
    const value = controlByTenant[tenant];
    if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Set]') {
        return null;
    }
    const known = Object.create(null);
    for (const item of value) {
        if (item != null) {
            known[String(item).trim()] = true;
        }
    }
    return known;
}

function isLedgerOutcome(outcome) {
    return ['uploaded', 'rejected', 'no-response', 'no-provider-id', 'missing-uuid', 'no-invoices'].includes(outcome);
}

// D-12: OCs subidas de las empresas cuya cuenta se pudo leer; `null` si ninguna respondió.
function sumUploaded(byTenant) {
    if (!byTenant || typeof byTenant !== 'object') {
        return null;
    }
    let total = null;
    for (const value of Object.values(byTenant)) {
        if (Number.isFinite(value)) {
            total = (total === null ? 0 : total) + value;
        }
    }
    return total;
}

// OCs del día dentro de la ventana del día resumido, agrupadas por motivo (RD-05, D-13, D-15).
// `pending` es null cuando no se puede saber: la ventana no se puede calcular, o todas las
// empresas configuradas fallaron su consulta de OCs.
function collectOcs(ocRows, dateISO, retry, tenants, failures) {
    const out = { groups: Object.create(null), pending: null, lastDay: 0 };
    const failed = Object.create(null);
    for (const failure of failures) {
        if (failure.source === 'oc-errors') {
            failed[String(failure.tenant)] = true;
        }
    }
    if (!isUsableRetry(retry) || (tenants.length > 0 && tenants.every((tenant) => failed[tenant] === true))) {
        return out;
    }
    out.pending = 0;
    for (const row of Array.isArray(ocRows) ? ocRows : []) {
        if (!row || typeof row !== 'object' || !isWithinRetryWindow(row.fechaAuth, dateISO, retry)) {
            continue;
        }
        const lastDay = isLastRetryDay(row.fechaAuth, dateISO, retry);
        addToGroup(out.groups, classifyOcReason(row), {
            tenant: row.tenant ?? null,
            idOrPo: row.idOrPo ?? null,
            fechaAuth: row.fechaAuth,
            attemptsToday: row.attemptsToday ?? null,
            lastError: row.lastError ?? null,
            lastDay,
        });
        out.pending += 1;
        if (lastDay) {
            out.lastDay += 1;
        }
    }
    return out;
}

// Lleva un pago pendiente a su sección: los rechazos y los intentos sin respuesta van a «Pagos
// rechazados por el portal»; lo detenido por datos de Sage va a su propia sección, con el
// proveedor sin ID agregado en un renglón por empresa y proveedor (RD-07, D-17).
function addPendingPayment(out, tenant, docnbr, entry, lastDay) {
    const vendor = entry.vendor ?? null;
    const fechaRegistro = entry.fechaRegistro ?? null;
    const rejection = classifyPaymentRejection(entry);
    if (rejection !== null) {
        addToGroup(out.rejected, rejection, {
            tenant,
            docnbr,
            vendor,
            fechaRegistro,
            attempts: entry.attempts ?? null,
            description: entry.description ?? null,
            lastDay,
        });
        return;
    }
    if (entry.outcome === 'no-provider-id') {
        const vendorKey = `${tenant}\u0000${vendor === null ? '' : String(vendor)}`;
        if (!hasOwn(out.vendorRows, vendorKey)) {
            out.vendorRows[vendorKey] = { tenant, vendor, payments: [], lastDay: false };
            addToGroup(out.sage, { key: 'no-provider-id', title: 'Proveedores sin ID del portal' }, out.vendorRows[vendorKey]);
        }
        const row = out.vendorRows[vendorKey];
        row.payments.push({ docnbr, fechaRegistro, lastDay });
        row.lastDay = row.lastDay || lastDay;
        return;
    }
    if (entry.outcome === 'missing-uuid') {
        addToGroup(out.sage, { key: 'missing-uuid', title: 'Pagos con facturas sin UUID' }, {
            tenant,
            docnbr,
            vendor,
            invoices: Array.isArray(entry.invoices) ? entry.invoices.slice() : [],
            fechaRegistro,
            lastDay,
        });
        return;
    }
    addToGroup(out.sage, { key: 'no-invoices', title: 'Pagos sin facturas en Sage' }, {
        tenant,
        docnbr,
        vendor,
        detail: entry.description ?? null,
        fechaRegistro,
        lastDay,
    });
}

// Pagos del registro del día (D-14, D-17, D-19), solo con un registro legible. Lo subido se
// cuenta; un fallo cuyo DOCNBR ya tiene fila en la tabla de control de su empresa, de cualquier
// estado, no está pendiente; los demás fallos sí. Lo que falta se dice en `notes`, incluidas las
// consultas de encabezados que fallaron (D-27) y las corridas que se interrumpieron (WR-05).
function collectPayments(ledger, dateISO, retry, tenants, controlByTenant, failures, notes) {
    const out = {
        rejected: Object.create(null),
        sage: Object.create(null),
        vendorRows: Object.create(null),
        uploaded: null,
        pending: null,
        lastDay: 0,
    };
    const data = readableLedgerData(ledger, dateISO);
    if (data === null) {
        notes.push(ledger && ledger.status === 'missing'
            ? 'Sin datos de pagos de ese día: no hay registro de la subida de pagos.'
            : 'Sin datos de pagos de ese día: el registro de pagos no se pudo leer.');
        return out;
    }
    if (data.recoveredAt !== undefined && data.recoveredAt !== null) {
        notes.push(recoveredNote(data.recoveredAt));
    }
    for (const tenant of tenants) {
        if (!hasOwn(data.tenants, tenant)) {
            notes.push(`Sin datos de pagos de ${tenant} ese día.`);
        }
    }
    const controlFailed = Object.create(null);
    for (const failure of failures) {
        if (failure.source === 'payments-control') {
            controlFailed[String(failure.tenant)] = true;
        }
    }

    const pendingKeys = Object.create(null);
    const uncrossed = [];
    let uploaded = 0;
    let unrecognized = 0;
    for (const tenant of Object.keys(data.tenants)) {
        const tenantEntry = data.tenants[tenant];
        if (!tenantEntry || typeof tenantEntry !== 'object' || !tenantEntry.payments || typeof tenantEntry.payments !== 'object') {
            unrecognized += 1;
            continue;
        }
        if (Number.isInteger(tenantEntry.queryFailures) && tenantEntry.queryFailures > 0) {
            notes.push(queryFailuresNote(tenant, tenantEntry));
        }
        if (Number.isInteger(tenantEntry.runFailures) && tenantEntry.runFailures > 0) {
            notes.push(runFailuresNote(tenant, tenantEntry));
        }
        const control = controlSetOf(controlByTenant, tenant);
        let tenantPending = 0;
        for (const docnbr of Object.keys(tenantEntry.payments)) {
            const entry = tenantEntry.payments[docnbr];
            if (!entry || typeof entry !== 'object' || !isLedgerOutcome(entry.outcome)) {
                unrecognized += 1;
                continue;
            }
            if (entry.outcome === 'uploaded') {
                uploaded += 1;
                continue;
            }
            if (control !== null && control[docnbr.trim()] === true) {
                continue;
            }
            const lastDay = isLastRetryDay(entry.fechaRegistro, dateISO, retry);
            pendingKeys[`${tenant}\u0000${docnbr}`] = true;
            tenantPending += 1;
            if (lastDay) {
                out.lastDay += 1;
            }
            addPendingPayment(out, tenant, docnbr, entry, lastDay);
        }
        // Sin tabla de control leída y sin una falla que ya lo diga, el cruce no se hizo.
        if (tenantPending > 0 && control === null && controlFailed[tenant] !== true) {
            uncrossed.push(tenant);
        }
    }
    if (unrecognized > 0) {
        notes.push(unrecognized === 1
            ? 'Datos de pagos incompletos: 1 entrada del registro no se reconoció.'
            : `Datos de pagos incompletos: ${unrecognized} entradas del registro no se reconocieron.`);
    }
    for (const tenant of uncrossed) {
        notes.push(`No se cruzaron los pagos de ${tenant} con la tabla de control: algunos pagos de la lista pudieron subirse después.`);
    }
    for (const row of Object.values(out.vendorRows)) {
        row.payments = sortedBy(row.payments, (payment) => sortKey(payment.lastDay, payment.fechaRegistro, payment.docnbr, ''));
    }
    out.uploaded = uploaded;
    out.pending = Object.keys(pendingKeys).length;
    return out;
}

/**
 * Arma el modelo del correo del día resumido (D-23 a D-27). Pura y sin reloj: recibe lo que la
 * recolección del plan 20.7-06 ya leyó de SQL y del registro de pagos.
 *
 * @param {object} input
 * @param {string} input.dateISO - El día resumido. Si no pasa isIsoDate, lanza: es un error de
 *   programación, porque la recolección ya la validó.
 * @param {{scope: string, lookbackDays?: number}} input.retry - `config.retry`. Si con ella no se
 *   puede calcular la ventana, no se listan OCs, `ocPending` es null y queda una nota.
 * @param {string[]} input.tenants - Las bases configuradas, en orden.
 * @param {object[]} input.ocRows - `{ tenant, idOrPo, attemptsToday, lastError, isValidation,
 *   fechaAuth }`, con `fechaAuth` como texto `YYYY-MM-DD` o null.
 * @param {Object<string, number>} input.ocUploadedByTenant - Solo las empresas cuya cuenta se leyó.
 * @param {{status: string, data: (object|null)}} input.ledger - El valor de readPaymentDayLedger,
 *   con `recoveredAt` en la raíz de `data` si el registro se reinició.
 * @param {Object<string, (string[]|Set<string>)>} input.controlByTenant - NoPagoSage por empresa,
 *   solo de las empresas cuya tabla de control se leyó.
 * @param {object[]} input.sourceFailures - `{ tenant, source, error }`, con `source` en
 *   `oc-errors`, `oc-uploaded` o `payments-control`.
 * @param {object|null} input.clock - `{ sqlDate, sqlNow, sqlOffsetMin }`; se copia tal cual.
 * @returns {{dateISO: string, counts: object, sections: object, notes: string[],
 *            incomplete: boolean, pendingTotal: number, clock: (object|null)}}
 *   - `counts = { ocUploaded, paymentsUploaded, ocPending, paymentsPending, lastDay }`, cada una
 *     número o null cuando su fuente no existe. `paymentsPending` cuenta pagos DISTINTOS por
 *     empresa y DOCNBR en todas las agrupaciones de pagos, nunca renglones: un proveedor sin ID
 *     suma los pagos que bloquea. `lastDay` cuenta documentos marcados, OCs y pagos.
 *   - `sections = { oc, rejected, sage }`, cada una `{ title, groups: [{ key, title, rows }] }`,
 *     con grupos y renglones ya ordenados (D-24). El tope de renglones se aplica al renderizar.
 *   - `notes`: textos en español SIN escapar; `incomplete` es `notes.length > 0`.
 *   - `pendingTotal` = OCs pendientes + pagos pendientes, con null como 0: el N del asunto (D-25).
 */
function buildDailySummaryModel(input) {
    const src = (input && typeof input === 'object') ? input : {};
    const { dateISO, retry } = src;
    if (!isIsoDate(dateISO)) {
        throw new TypeError('buildDailySummaryModel: dateISO debe ser una fecha YYYY-MM-DD válida');
    }
    const tenants = Array.isArray(src.tenants)
        ? src.tenants.filter((tenant) => typeof tenant === 'string' && tenant.length > 0)
        : [];
    const failures = Array.isArray(src.sourceFailures)
        ? src.sourceFailures.filter((failure) => failure && typeof failure === 'object')
        : [];

    const notes = [];
    if (!isUsableRetry(retry)) {
        notes.push('No se aplicó la ventana de reintentos porque su configuración no es válida: no se listan OCs ni se marca el último día de reintento.');
    }
    for (const failure of failures) {
        notes.push(sourceFailureNote(failure));
    }

    const oc = collectOcs(src.ocRows, dateISO, retry, tenants, failures);
    const payments = collectPayments(src.ledger, dateISO, retry, tenants, src.controlByTenant, failures, notes);
    const lastDay = (oc.pending === null && payments.pending === null) ? null : oc.lastDay + payments.lastDay;

    return {
        dateISO,
        counts: {
            ocUploaded: sumUploaded(src.ocUploadedByTenant),
            paymentsUploaded: payments.uploaded,
            ocPending: oc.pending,
            paymentsPending: payments.pending,
            lastDay,
        },
        sections: {
            oc: { title: 'OCs sin subir', groups: sortedGroups(oc.groups) },
            rejected: { title: 'Pagos rechazados por el portal', groups: sortedGroups(payments.rejected) },
            sage: { title: 'Pagos detenidos por datos de Sage', groups: sortedGroups(payments.sage) },
        },
        notes,
        incomplete: notes.length > 0,
        pendingTotal: (oc.pending ?? 0) + (payments.pending ?? 0),
        clock: src.clock === undefined ? null : src.clock,
    };
}

/**
 * Línea de cifras del correo (D-25): «El 2026-11-03 se subieron 12 OCs y 30 pagos; quedaron sin
 * subir 3 OCs y 2 pagos (1 en su último día de reintento automático).» Dice la fecha y no «hoy»,
 * porque la reposición llega al día siguiente. Una cifra null sale «OCs sin datos» o «pagos sin
 * datos», y el paréntesis del último día solo va si hay alguno. Texto plano: se escapa al
 * renderizar.
 *
 * @param {object} model - El valor de buildDailySummaryModel.
 * @returns {string}
 */
function formatCountsLine(model) {
    const m = (model && typeof model === 'object') ? model : {};
    const c = (m.counts && typeof m.counts === 'object') ? m.counts : {};
    const ocs = (n) => {
        if (!Number.isFinite(n)) {
            return 'OCs sin datos';
        }
        return n === 1 ? '1 OC' : `${n} OCs`;
    };
    const pagos = (n) => {
        if (!Number.isFinite(n)) {
            return 'pagos sin datos';
        }
        return n === 1 ? '1 pago' : `${n} pagos`;
    };
    const date = isIsoDate(m.dateISO) ? m.dateISO : 'n/a';
    const tail = Number.isFinite(c.lastDay) && c.lastDay > 0
        ? ` (${c.lastDay} en su último día de reintento automático)`
        : '';
    return `El ${date} se subieron ${ocs(c.ocUploaded)} y ${pagos(c.paymentsUploaded)}; `
        + `quedaron sin subir ${ocs(c.ocPending)} y ${pagos(c.paymentsPending)}${tail}.`;
}

// ---------------------------------------------------------------------------------------------
// Parte B: HTML y asunto del correo.
// ---------------------------------------------------------------------------------------------

// D-24: caracteres de un texto libre por celda; es el mismo recorte del correo de cierre de mes.
const CELL_TEXT_MAX = 100;

// D-26: el comando que muestra el detalle completo de un día, en lugar de enlaces al panel.
function previewCommand(dateISO) {
    return `node src/scripts/daily-summary-preview.js --date ${dateISO}`;
}

// El N del asunto y la decisión de pintar las secciones: solo un entero positivo cuenta.
function pendingCount(model) {
    return Number.isInteger(model.pendingTotal) && model.pendingTotal > 0 ? model.pendingTotal : 0;
}

// Alguna fuente falló o faltó (D-27): lo dice la bandera del modelo o cualquier nota.
function isIncomplete(model) {
    return model.incomplete === true || (Array.isArray(model.notes) && model.notes.length > 0);
}

// Una celda con su valor escapado; un valor ausente sale vacío.
function cellText(value) {
    return value == null ? '' : escapeHtml(value);
}

// D-23: la marca de último día va pegada a la fecha o, en las secciones de Sage, al pago.
function markedCell(value, lastDay) {
    return `${cellText(value)}${lastDay === true ? ' · último día' : ''}`;
}

// Texto libre de una celda (D-24). Con el tope se recorta a CELL_TEXT_MAX caracteres más «…»
// ANTES de escapar, para no partir una entidad; la vista previa lo deja completo. Quien llama
// escapa el resultado.
function clipText(value, capped) {
    const text = value == null ? '' : String(value);
    return capped && text.length > CELL_TEXT_MAX ? text.slice(0, CELL_TEXT_MAX) + '…' : text;
}

// Los pagos que bloquea un proveedor sin ID, con la marca junto a cada uno.
function blockedPaymentsText(payments) {
    return (Array.isArray(payments) ? payments : [])
        .map((payment) => `${payment.docnbr == null ? '' : String(payment.docnbr)}${payment.lastDay === true ? ' · último día' : ''}`)
        .join(', ');
}

// D-23: encabezado y celdas de cada tabla. Las de OCs y de rechazos llevan número de renglón;
// las tres de datos de Sage, no.
function tableSpec(sectionKey, groupKey) {
    if (sectionKey === 'oc') {
        return {
            header: '<th>#</th><th>Tenant</th><th>OC</th><th>Fecha autorización</th><th>Intentos del día</th><th>Último error</th>',
            cells: (row, index, capped) => `<td>${escapeHtml(index + 1)}</td>`
                + `<td>${cellText(row.tenant)}</td>`
                + `<td>${cellText(row.idOrPo)}</td>`
                + `<td>${markedCell(row.fechaAuth, row.lastDay)}</td>`
                + `<td>${cellText(row.attemptsToday)}</td>`
                + `<td>${escapeHtml(clipText(row.lastError, capped))}</td>`,
        };
    }
    if (sectionKey === 'rejected') {
        return {
            header: '<th>#</th><th>Tenant</th><th>Pago</th><th>Proveedor</th><th>Fecha de registro en Sage</th><th>Intentos del día</th><th>Respuesta del portal</th>',
            cells: (row, index, capped) => `<td>${escapeHtml(index + 1)}</td>`
                + `<td>${cellText(row.tenant)}</td>`
                + `<td>${cellText(row.docnbr)}</td>`
                + `<td>${cellText(row.vendor)}</td>`
                + `<td>${markedCell(row.fechaRegistro, row.lastDay)}</td>`
                + `<td>${cellText(row.attempts)}</td>`
                + `<td>${escapeHtml(clipText(row.description, capped))}</td>`,
        };
    }
    if (groupKey === 'no-provider-id') {
        return {
            header: '<th>Tenant</th><th>Proveedor</th><th>Pagos que bloquea</th>',
            cells: (row, _index, capped) => `<td>${cellText(row.tenant)}</td>`
                + `<td>${cellText(row.vendor)}</td>`
                + `<td>${escapeHtml(clipText(blockedPaymentsText(row.payments), capped))}</td>`,
        };
    }
    if (groupKey === 'missing-uuid') {
        return {
            header: '<th>Tenant</th><th>Pago</th><th>Proveedor</th><th>Facturas sin UUID</th>',
            cells: (row, _index, capped) => `<td>${cellText(row.tenant)}</td>`
                + `<td>${markedCell(row.docnbr, row.lastDay)}</td>`
                + `<td>${cellText(row.vendor)}</td>`
                + `<td>${escapeHtml(clipText(Array.isArray(row.invoices) ? row.invoices.join(', ') : '', capped))}</td>`,
        };
    }
    return {
        header: '<th>Tenant</th><th>Pago</th><th>Proveedor</th><th>Detalle</th>',
        cells: (row, _index, capped) => `<td>${cellText(row.tenant)}</td>`
            + `<td>${markedCell(row.docnbr, row.lastDay)}</td>`
            + `<td>${cellText(row.vendor)}</td>`
            + `<td>${escapeHtml(clipText(row.detail, capped))}</td>`,
    };
}

// La tabla con el estilo del correo de cierre de mes: thead y tbody en renglones propios.
function pushTable(lines, spec, rows, capped) {
    lines.push('<table border="1" cellspacing="0" cellpadding="4">');
    lines.push('  <thead>');
    lines.push('    <tr>');
    lines.push(`      ${spec.header}`);
    lines.push('    </tr>');
    lines.push('  </thead>');
    lines.push('  <tbody>');
    rows.forEach((row, index) => {
        lines.push(`    <tr>${spec.cells(row, index, capped)}</tr>`);
    });
    lines.push('  </tbody>');
    lines.push('</table>');
}

// Una sección del correo (D-23, D-24, RD-11). Con el tope caben a lo más ROW_CAP renglones,
// repartidos en el orden de los grupos; los grupos que se quedan sin renglones se nombran, y lo
// que no cupo se anuncia con el comando de la vista previa. `unknown` dice que la fuente de la
// sección no existe: entonces la sección dice «Sin datos.» y nunca «Ninguno.» (D-27).
function pushSection(lines, sectionKey, section, fallbackTitle, unknown, capped, command) {
    const title = (section && typeof section.title === 'string') ? section.title : fallbackTitle;
    const groups = (section && Array.isArray(section.groups)) ? section.groups : [];
    lines.push(`<h2>${escapeHtml(title)}</h2>`);
    if (groups.length === 0) {
        lines.push(unknown ? '<p>Sin datos.</p>' : '<p>Ninguno.</p>');
        return;
    }
    let room = capped ? ROW_CAP : Infinity;
    let hidden = 0;
    const withoutRows = [];
    for (const group of groups) {
        const rows = Array.isArray(group.rows) ? group.rows : [];
        const shown = Math.min(room, rows.length);
        room -= shown;
        hidden += rows.length - shown;
        if (shown === 0) {
            withoutRows.push(`${group.title} (${rows.length})`);
            continue;
        }
        lines.push(`<h3>${escapeHtml(group.title)} (${escapeHtml(rows.length)})</h3>`);
        pushTable(lines, tableSpec(sectionKey, group.key), rows.slice(0, shown), capped);
    }
    if (withoutRows.length > 0) {
        lines.push(`<p>Grupos sin renglones en este correo: ${withoutRows.map((label) => escapeHtml(label)).join(', ')}.</p>`);
    }
    if (hidden > 0) {
        const more = hidden === 1 ? '1 renglón más' : `${hidden} renglones más`;
        lines.push(`<p>Y ${escapeHtml(more)} en esta sección. Detalle completo: <code>${escapeHtml(command)}</code></p>`);
    }
}

/**
 * HTML del correo del día resumido (D-23 a D-28). Copia el estilo de buildEomEmailHtml (un
 * arreglo de renglones, la tabla border=1 cellspacing=0 cellpadding=4, thead y tbody en
 * renglones propios y un salto de línea al final) sin extenderla (D-02), y no lleva enlaces
 * (D-26): el pie trae el comando de la vista previa.
 *
 * Toda interpolación dinámica pasa por escapeHtml (D-28, T-20-14): la fecha, las cifras, las
 * notas, los títulos con código, la empresa, los documentos, el proveedor, las fechas, los
 * intentos y los textos del portal.
 *
 * Con el tope, que es el correo: a lo más ROW_CAP renglones por sección y los textos libres
 * recortados a 100 caracteres. Con `cap: false`, que es la vista previa (D-36): todo, sin
 * recortes ni leyendas, y un pie que dice que no se envió correo. Solo un `false` explícito quita
 * el tope; cualquier otro valor deja el correo acotado (T-20.7-18).
 *
 * Sin pendientes, en lugar de las secciones va «Sin pendientes» (RD-09), o, si alguna fuente
 * falló o faltó, un párrafo que dice que los datos están incompletos (D-27).
 *
 * @param {object} model - El valor de buildDailySummaryModel.
 * @param {{cap?: boolean}} [options] - `{ cap = true }`.
 * @returns {string}
 */
function buildDailySummaryHtml(model, options = {}) {
    const capped = !(options && typeof options === 'object' && options.cap === false);
    const m = (model && typeof model === 'object') ? model : {};
    const dateISO = isIsoDate(m.dateISO) ? m.dateISO : 'n/a';
    const notes = Array.isArray(m.notes) ? m.notes : [];
    const sections = (m.sections && typeof m.sections === 'object') ? m.sections : {};
    const counts = (m.counts && typeof m.counts === 'object') ? m.counts : {};
    const command = previewCommand(dateISO);

    const lines = [];
    lines.push(`<h1>SageConnect: Resumen del día ${escapeHtml(dateISO)}</h1>`);
    lines.push(`<p>${escapeHtml(formatCountsLine(m))}</p>`);
    for (const note of notes) {
        lines.push(`<p><em>${escapeHtml(note)}</em></p>`);
    }

    const hasRows = ['oc', 'rejected', 'sage'].some((key) => sections[key]
        && Array.isArray(sections[key].groups)
        && sections[key].groups.some((group) => Array.isArray(group.rows) && group.rows.length > 0));
    if (pendingCount(m) > 0 || hasRows) {
        pushSection(lines, 'oc', sections.oc, 'OCs sin subir', counts.ocPending === null, capped, command);
        pushSection(lines, 'rejected', sections.rejected, 'Pagos rechazados por el portal', counts.paymentsPending === null, capped, command);
        pushSection(lines, 'sage', sections.sage, 'Pagos detenidos por datos de Sage', counts.paymentsPending === null, capped, command);
    } else if (isIncomplete(m)) {
        lines.push('<p>No se encontraron pendientes, pero los datos están incompletos: revise las notas de arriba.</p>');
    } else {
        lines.push('<p>Sin pendientes</p>');
    }

    if (capped) {
        lines.push(`<p>Detalle completo, sin tope de renglones: <code>${escapeHtml(command)}</code></p>`);
    } else {
        lines.push('<p>Vista previa sin tope de renglones ni recorte de textos. No se envió ningún correo.</p>');
    }
    return lines.join('\n') + '\n';
}

/**
 * Asunto del correo (D-25): `[SageConnect] Resumen del día YYYY-MM-DD — N sin subir`. Con N en 0
 * dice `— datos incompletos` si alguna fuente falló o faltó (D-27), y `— sin pendientes` si no.
 * El guion es el largo (U+2014), como en los asuntos del cierre de mes y de la quincena. Es texto
 * plano de una cabecera de correo y no se escapa (S-7).
 *
 * @param {object} model - El valor de buildDailySummaryModel.
 * @returns {string}
 */
function buildDailySummarySubject(model) {
    const m = (model && typeof model === 'object') ? model : {};
    const date = isIsoDate(m.dateISO) ? m.dateISO : 'n/a';
    const pending = pendingCount(m);
    let tail;
    if (pending > 0) {
        tail = `${pending} sin subir`;
    } else if (isIncomplete(m)) {
        tail = 'datos incompletos';
    } else {
        tail = 'sin pendientes';
    }
    return `[SageConnect] Resumen del día ${date} — ${tail}`;
}

module.exports = {
    MAX_ATTEMPTS,
    RETRY_OFFSETS_MIN,
    ROW_CAP,
    localDateISO,
    localStamp,
    parseStamp,
    isIsoDate,
    addDaysISO,
    isValidDayState,
    decideDailySummaryAction,
    sanitizeLogText,
    formatNotificationStatusLine,
    formatAttemptLogLine,
    formatAbandonLogLine,
    formatClockWarnLine,
    classifyOcReason,
    classifyPaymentRejection,
    isWithinRetryWindow,
    isLastRetryDay,
    buildDailySummaryModel,
    formatCountsLine,
    buildDailySummaryHtml,
    buildDailySummarySubject,
};
