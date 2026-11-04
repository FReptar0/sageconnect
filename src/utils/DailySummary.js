// Fase 20.7 (D-01): agenda del resumen diario de reintentos sin éxito y validación del estado
// de cada día resumido.
//
// Módulo puro: no lee ni escribe disco, no abre red y no carga los módulos de archivos ni de
// rutas de Node. Tampoco guarda estado de módulo: lo único a nivel de módulo son constantes
// inmutables (CLAUDE.md §3). El reloj entra como argumento: `now` es el Date que arma
// getCurrentDate() de TimezoneHelper, cuyos campos LOCALES son la hora de pared de TIMEZONE.
// Por eso cada fecha y cada sello se arman con los accesores locales, nunca convirtiendo el
// instante a UTC, y ninguna función lee un segundo reloj (20.6 D-08).

// D-29 y D-07: tope de intentos por día resumido. Un SMTP que acepta el mensaje y falla después
// convierte cada reintento en un duplicado en el buzón del operador (20.6 D-10); con 4, el peor
// caso son 4 copias.
const MAX_ATTEMPTS = 4;

// D-29 y D-07: espera, en minutos contados desde el PRIMER intento, para el 2.º, el 3.º y el 4.º.
// Cubren una caída del correo de toda la noche (23:45, 00:45, 03:45 y 11:45) y terminan antes
// de la hora del resumen siguiente. Es constante del código y no del .env, para no sumar perillas.
const RETRY_OFFSETS_MIN = Object.freeze([60, 240, 720]);

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

// Clasifica la envoltura que entrega el despachador: `missing`, `ok` o `corrupt`. Un `ok` se
// vuelve a validar aquí y cualquier forma no reconocida cuenta como dañada, así que lo que no se
// puede probar válido nunca llega a ser objetivo de un envío.
function classifyDayState(read, dateISO) {
    if (read && read.status === 'missing') {
        return 'missing';
    }
    if (read && read.status === 'ok' && isValidDayState(read.data, dateISO)) {
        return 'ok';
    }
    return 'corrupt';
}

// D-07: la operación que toca sobre el día objetivo, que siempre llega pendiente. Las esperas se
// cuentan desde el primer intento, con el `now` de esta ejecución contra el sello que dejó la
// primera: los dos salen del mismo reloj.
function nextAttemptOp(dateISO, state, now) {
    const n = state.attempts.length;
    if (n >= MAX_ATTEMPTS) {
        return { type: 'abandon', date: dateISO, reason: 'max-attempts', attempts: n };
    }
    if (n === 0) {
        return { type: 'attempt', date: dateISO, attemptNumber: 1 };
    }
    const first = parseStamp(state.attempts[0].at);
    if (first === null) {
        return { type: 'abandon', date: dateISO, reason: 'state-corrupt', attempts: n };
    }
    const elapsedMin = (now.getTime() - first.getTime()) / 60000;
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
 *      objetivo.
 *   3. A partir de la hora, comparada con hora y minuto del inicio de la ejecución (D-09): ayer
 *      pendiente → `abandon` con `next-summary-due`, y el objetivo es hoy si sigue pendiente.
 *      Antes de la hora: ayer dañado → `abandon` con `state-corrupt`; ayer pendiente → es el
 *      objetivo. Ayer ausente nunca produce operaciones y ningún día anterior a ayer se mira.
 *   4. Con un objetivo de `n` intentos: `n >= MAX_ATTEMPTS` → `abandon` con `max-attempts`;
 *      `n === 0` → `attempt` 1; si no, `attempt` n+1 solo cuando ya pasaron
 *      `RETRY_OFFSETS_MIN[n - 1]` minutos desde el primer intento.
 *
 * Un estado `ok` se vuelve a validar con `isValidDayState`: uno ilegible, de otra fecha o
 * incoherente se trata como dañado y nunca provoca un envío (T-20.7-06).
 *
 * @param {{now: Date, summaryCfg: {enabled: boolean, hour: number, minute: number},
 *          today: {status: string, data?: object}, yesterday: {status: string, data?: object}}} input
 *   `summaryCfg` es `config.notifications.dailySummary`; `today` y `yesterday` son
 *   `{ status: 'missing' }`, `{ status: 'ok', data }` o `{ status: 'corrupt' }`.
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
    } else {
        todayState = today.data;
    }

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
};
