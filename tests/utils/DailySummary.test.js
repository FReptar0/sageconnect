// tests/utils/DailySummary.test.js
// Fase 20.7 (D-01, D-05 a D-09, D-29): agenda del resumen diario con relojes simulados,
// validación del estado del día y ayudantes de fecha de src/utils/DailySummary.js.

// Doble de config VACÍO, declarado antes de cualquier require. Es el conjunto exacto de llaves
// que necesitan los planes 20.7-02 y 20.7-04: la parte A del módulo no lee config, y desde la
// parte B el módulo cargará EomNotification, que solo requiere config al cargar y no lee
// ninguna llave fuera de buildEomEmailHtml, que el resumen nunca llama. Un objeto vacío no
// inventa valores: si algún módulo de la cadena empezara a leer config al cargar, esta suite
// fallaría al requerirlo en vez de pasar con un valor inventado.
jest.mock('../../src/config', () => ({}));

const DailySummary = require('../../src/utils/DailySummary');

const {
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
} = DailySummary;

// Constructores en hora local, igual que getCurrentDate(): sus campos locales son la hora de
// TIMEZONE. Índice de mes 10 = noviembre; D = 2026-11-03.
const D = '2026-11-03';
const D_PLUS_1 = '2026-11-04';
const D_MINUS_1 = '2026-11-02';
const at = (day, hour, minute, second = 0) => new Date(2026, 10, day, hour, minute, second);

const SUMMARY_CFG = { enabled: true, hour: 23, minute: 45 };
const CLOSED = { todayISO: null, yesterdayISO: null, ops: [] };

const MISSING = { status: 'missing' };
const CORRUPT = { status: 'corrupt' };
const ok = (data) => ({ status: 'ok', data });
const pendingState = (date, attempts = []) => ({ date, status: 'pending', attempts });
const failedAttempt = (stamp) => ({ at: stamp, delivered: false, error: 'connect ECONNREFUSED 127.0.0.1:25' });

function decide(now, today, yesterday) {
    return decideDailySummaryAction({ now, summaryCfg: SUMMARY_CFG, today, yesterday });
}

describe('constantes de D-29', () => {
    test('MAX_ATTEMPTS = 4, RETRY_OFFSETS_MIN = [60, 240, 720] congelado y ROW_CAP = 100', () => {
        expect(MAX_ATTEMPTS).toBe(4);
        expect(RETRY_OFFSETS_MIN).toEqual([60, 240, 720]);
        expect(Object.isFrozen(RETRY_OFFSETS_MIN)).toBe(true);
        expect(ROW_CAP).toBe(100);
    });
});

describe('fechas en TIMEZONE con accesores locales', () => {
    test('localDateISO toma la fecha local, también en el último segundo del día', () => {
        expect(localDateISO(at(3, 23, 59, 59))).toBe('2026-11-03');
        expect(localDateISO(at(4, 0, 0))).toBe('2026-11-04');
        expect(localDateISO(new Date(2026, 0, 5, 7, 8))).toBe('2026-01-05');
    });

    test('localDateISO devuelve null ante algo que no es un Date válido', () => {
        expect(localDateISO(new Date(NaN))).toBeNull();
        expect(localDateISO('2026-11-03')).toBeNull();
        expect(localDateISO(undefined)).toBeNull();
        expect(localDateISO(null)).toBeNull();
    });

    test('localStamp arma YYYY-MM-DDTHH:MM:SS, hora de pared sin zona', () => {
        expect(localStamp(at(3, 23, 45, 7))).toBe('2026-11-03T23:45:07');
        expect(localStamp(new Date(2026, 0, 5, 7, 8, 9))).toBe('2026-01-05T07:08:09');
        expect(localStamp(new Date(NaN))).toBeNull();
        expect(localStamp('2026-11-03T23:45:00')).toBeNull();
    });

    test('parseStamp regresa el mismo instante local que localStamp escribió', () => {
        const parsed = parseStamp('2026-11-03T23:45:00');
        expect(parsed).toBeInstanceOf(Date);
        expect(parsed.getTime()).toBe(at(3, 23, 45, 0).getTime());
        expect(localStamp(parsed)).toBe('2026-11-03T23:45:00');
    });

    test('parseStamp rechaza fechas imposibles y cualquier otro formato', () => {
        expect(parseStamp('2026-02-30T10:00:00')).toBeNull();
        expect(parseStamp('2026-11-03T24:00:00')).toBeNull();
        expect(parseStamp('2026-11-03T23:60:00')).toBeNull();
        expect(parseStamp('2026-11-03T23:45:00Z')).toBeNull();
        expect(parseStamp('2026-11-03T23:45:00.000')).toBeNull();
        expect(parseStamp('2026-11-03 23:45:00')).toBeNull();
        expect(parseStamp('2026-11-03T23:45')).toBeNull();
        expect(parseStamp('')).toBeNull();
        expect(parseStamp(null)).toBeNull();
        expect(parseStamp(undefined)).toBeNull();
        expect(parseStamp(at(3, 23, 45).getTime())).toBeNull();
    });

    test('isIsoDate exige el formato exacto y una fecha real del calendario', () => {
        expect(isIsoDate('2026-11-03')).toBe(true);
        expect(isIsoDate('2026-02-29')).toBe(false);
        expect(isIsoDate('2028-02-29')).toBe(true);
        expect(isIsoDate('2026-11-31')).toBe(false);
        expect(isIsoDate('2026-13-01')).toBe(false);
        expect(isIsoDate("2026-11-03'; DROP")).toBe(false);
        expect(isIsoDate('2026-11-3')).toBe(false);
        expect(isIsoDate(' 2026-11-03')).toBe(false);
        expect(isIsoDate('2026-11-03\n')).toBe(false);
        expect(isIsoDate(null)).toBe(false);
        expect(isIsoDate(20261103)).toBe(false);
    });

    test('addDaysISO cruza fin de mes, fin de año y años bisiestos con aritmética UTC', () => {
        expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
        expect(addDaysISO('2028-03-01', -1)).toBe('2028-02-29');
        expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
        expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysISO('2026-11-03', -30)).toBe('2026-10-04');
        expect(addDaysISO('2026-11-03', 0)).toBe('2026-11-03');
    });

    test('addDaysISO devuelve null ante una fecha o un desplazamiento inválidos', () => {
        expect(addDaysISO('2026-02-29', 1)).toBeNull();
        expect(addDaysISO('no es fecha', 1)).toBeNull();
        expect(addDaysISO(null, 1)).toBeNull();
        expect(addDaysISO('2026-11-03', 1.5)).toBeNull();
        expect(addDaysISO('2026-11-03', '1')).toBeNull();
    });
});

describe('isValidDayState', () => {
    const fail1 = failedAttempt('2026-11-03T23:45:00');

    test('acepta los tres estados bien formados', () => {
        expect(isValidDayState(pendingState(D), D)).toBe(true);
        expect(isValidDayState(pendingState(D, [fail1, { at: '2026-11-04T00:45:00', delivered: null, error: null }]), D)).toBe(true);
        expect(isValidDayState({ date: D, status: 'delivered', attempts: [fail1, { at: '2026-11-04T00:45:00', delivered: true, error: null }] }, D)).toBe(true);
        expect(isValidDayState({ date: D, status: 'abandoned', attempts: [], reason: 'state-corrupt' }, D)).toBe(true);
        expect(isValidDayState({ date: D, status: 'abandoned', attempts: [fail1, fail1, fail1, fail1], reason: 'max-attempts' }, D)).toBe(true);
    });

    test.each([
        ['fecha distinta', pendingState(D_MINUS_1)],
        ['estado desconocido', { date: D, status: 'sent', attempts: [] }],
        ['attempts que no es arreglo', { date: D, status: 'pending', attempts: {} }],
        ['attempts ausente', { date: D, status: 'pending' }],
        ['5 intentos', pendingState(D, [fail1, fail1, fail1, fail1, fail1])],
        ['at inválido', pendingState(D, [{ at: '2026-02-30T10:00:00', delivered: false, error: null }])],
        ['at ausente', pendingState(D, [{ delivered: false, error: null }])],
        ['delivered que no es true, false ni null', pendingState(D, [{ at: '2026-11-03T23:45:00', delivered: 'true', error: null }])],
        ['delivered ausente', pendingState(D, [{ at: '2026-11-03T23:45:00', error: null }])],
        ['intento que no es objeto', pendingState(D, [null])],
        ['pending con un intento entregado', pendingState(D, [{ at: '2026-11-03T23:45:00', delivered: true, error: null }])],
        ['delivered cuyo último intento no es true', { date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }, fail1] }],
        ['delivered sin intentos', { date: D, status: 'delivered', attempts: [] }],
        ['abandoned sin reason', { date: D, status: 'abandoned', attempts: [] }],
        ['abandoned con reason vacío', { date: D, status: 'abandoned', attempts: [], reason: '' }],
        ['abandoned con reason que no es texto', { date: D, status: 'abandoned', attempts: [], reason: 4 }],
        ['null', null],
        ['arreglo', []],
        ['texto', 'pending'],
    ])('rechaza: %s', (_name, data) => {
        expect(isValidDayState(data, D)).toBe(false);
    });

    test('rechaza una fecha esperada que no es fecha, aunque coincida con la del estado', () => {
        expect(isValidDayState(pendingState('ayer'), 'ayer')).toBe(false);
    });
});

describe('decideDailySummaryAction: fail-closed (D-06 paso 1)', () => {
    // Con hoy y ayer ausentes a las 23:45, una compuerta abierta crearía el estado de hoy y lo
    // intentaría: cualquier operación aquí delataría una compuerta que no cierra.
    test.each([
        ['apagado', { enabled: false, hour: 23, minute: 45 }],
        ['enabled como texto', { enabled: 'true', hour: 23, minute: 45 }],
        ['enabled ausente', { hour: 23, minute: 45 }],
        ['summaryCfg nulo', null],
        ['summaryCfg que no es objeto', 'enabled'],
        ['hora decimal', { enabled: true, hour: 23.5, minute: 45 }],
        ['hora como texto', { enabled: true, hour: '23', minute: 45 }],
        ['hora 24', { enabled: true, hour: 24, minute: 0 }],
        ['hora negativa', { enabled: true, hour: -1, minute: 0 }],
        ['minuto 60', { enabled: true, hour: 23, minute: 60 }],
        ['minuto ausente', { enabled: true, hour: 23 }],
        ['minuto NaN', { enabled: true, hour: 23, minute: NaN }],
    ])('%s → sin operaciones', (_name, summaryCfg) => {
        expect(decideDailySummaryAction({ now: at(3, 23, 45), summaryCfg, today: MISSING, yesterday: MISSING })).toEqual(CLOSED);
    });

    test('summaryCfg ausente → sin operaciones', () => {
        expect(decideDailySummaryAction({ now: at(3, 23, 45), today: MISSING, yesterday: MISSING })).toEqual(CLOSED);
    });

    test('now inválido → sin operaciones', () => {
        expect(decide(new Date(NaN), MISSING, MISSING)).toEqual(CLOSED);
        expect(decide('2026-11-03T23:45:00', MISSING, MISSING)).toEqual(CLOSED);
        expect(decide(at(3, 23, 45).getTime(), MISSING, MISSING)).toEqual(CLOSED);
        expect(decide(undefined, MISSING, MISSING)).toEqual(CLOSED);
    });

    test('sin argumento o con null → sin operaciones y sin lanzar', () => {
        expect(decideDailySummaryAction()).toEqual(CLOSED);
        expect(decideDailySummaryAction(null)).toEqual(CLOSED);
    });
});

describe('decideDailySummaryAction: RD-01, un resumen por día a partir de la hora (D-05, D-09)', () => {
    test('00:00 de D con hoy y ayer ausentes → solo crea el estado de D, sin intento', () => {
        expect(decide(at(3, 0, 0), MISSING, MISSING)).toEqual({
            todayISO: D,
            yesterdayISO: D_MINUS_1,
            ops: [{ type: 'create', date: D }],
        });
    });

    test('23:30 de D con hoy pending sin intentos → nada', () => {
        expect(decide(at(3, 23, 30), ok(pendingState(D)), MISSING)).toEqual({ todayISO: D, yesterdayISO: D_MINUS_1, ops: [] });
    });

    test('23:44:59 de D → todavía nada', () => {
        expect(decide(at(3, 23, 44, 59), ok(pendingState(D)), MISSING).ops).toEqual([]);
    });

    test('23:45 de D → intento 1 de D', () => {
        expect(decide(at(3, 23, 45), ok(pendingState(D)), MISSING)).toEqual({
            todayISO: D,
            yesterdayISO: D_MINUS_1,
            ops: [{ type: 'attempt', date: D, attemptNumber: 1 }],
        });
    });

    test('23:50 de D con un intento a las 23:45:00 → nada', () => {
        const today = ok(pendingState(D, [failedAttempt('2026-11-03T23:45:00')]));
        expect(decide(at(3, 23, 50), today, MISSING).ops).toEqual([]);
    });

    test('primera ejecución encendida del día después de la hora → crea D y lo intenta', () => {
        expect(decide(at(3, 23, 50), MISSING, MISSING).ops).toEqual([
            { type: 'create', date: D },
            { type: 'attempt', date: D, attemptNumber: 1 },
        ]);
    });

    test.each([
        [0, 0],
        [10, 30],
        [23, 45],
        [23, 59],
    ])('hoy delivered → nada a las %i:%i', (hour, minute) => {
        const today = ok({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
        expect(decide(at(3, hour, minute), today, MISSING).ops).toEqual([]);
    });

    test('hoy abandoned → nada después de la hora', () => {
        const today = ok({ date: D, status: 'abandoned', attempts: [], reason: 'state-corrupt' });
        expect(decide(at(3, 23, 45), today, MISSING).ops).toEqual([]);
    });

    test('la hora se compara con hora y minuto: con 07:05, las 07:04 no y las 07:05 y las 08:00 sí', () => {
        const summaryCfg = { enabled: true, hour: 7, minute: 5 };
        const run = (hour, minute) => decideDailySummaryAction({
            now: at(3, hour, minute),
            summaryCfg,
            today: ok(pendingState(D)),
            yesterday: MISSING,
        }).ops;
        expect(run(7, 4)).toEqual([]);
        expect(run(7, 5)).toEqual([{ type: 'attempt', date: D, attemptNumber: 1 }]);
        expect(run(8, 0)).toEqual([{ type: 'attempt', date: D, attemptNumber: 1 }]);
    });
});

describe('decideDailySummaryAction: RD-02, reposición al día siguiente y solo ese (D-05, D-06)', () => {
    test('(a) 00:00 de D+1, hoy ausente y ayer pending sin intentos → crea D+1 e intenta D', () => {
        expect(decide(at(4, 0, 0), MISSING, ok(pendingState(D)))).toEqual({
            todayISO: D_PLUS_1,
            yesterdayISO: D,
            ops: [
                { type: 'create', date: D_PLUS_1 },
                { type: 'attempt', date: D, attemptNumber: 1 },
            ],
        });
    });

    test('(b) 23:45 de D+1 con ayer pending y 2 intentos → abandona D con next-summary-due e intenta D+1', () => {
        const yesterday = ok(pendingState(D, [failedAttempt('2026-11-03T23:45:00'), failedAttempt('2026-11-04T00:45:00')]));
        expect(decide(at(4, 23, 45), ok(pendingState(D_PLUS_1)), yesterday)).toEqual({
            todayISO: D_PLUS_1,
            yesterdayISO: D,
            ops: [
                { type: 'abandon', date: D, reason: 'next-summary-due', attempts: 2 },
                { type: 'attempt', date: D_PLUS_1, attemptNumber: 1 },
            ],
        });
    });

    test.each([
        [0, 0],
        [8, 0],
        [23, 44],
        [23, 45],
        [23, 59],
    ])('(c) ayer ausente → ninguna operación sobre ayer a las %i:%i', (hour, minute) => {
        const { ops } = decide(at(4, hour, minute), ok(pendingState(D_PLUS_1)), MISSING);
        expect(ops.filter((op) => op.date !== D_PLUS_1)).toEqual([]);
    });

    test('(d) 10:30 de D+1 con hoy y ayer ausentes → solo crea D+1: encender a media mañana no manda el de ayer', () => {
        expect(decide(at(4, 10, 30), MISSING, MISSING)).toEqual({
            todayISO: D_PLUS_1,
            yesterdayISO: D,
            ops: [{ type: 'create', date: D_PLUS_1 }],
        });
    });

    test('antes de la hora, ayer delivered o abandoned no es objetivo', () => {
        const delivered = ok({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
        const abandoned = ok({ date: D, status: 'abandoned', attempts: [], reason: 'state-corrupt' });
        expect(decide(at(4, 0, 0), ok(pendingState(D_PLUS_1)), delivered).ops).toEqual([]);
        expect(decide(at(4, 0, 0), ok(pendingState(D_PLUS_1)), abandoned).ops).toEqual([]);
    });

    test('después de la hora, ayer delivered no se abandona', () => {
        const delivered = ok({ date: D, status: 'delivered', attempts: [{ at: '2026-11-03T23:45:00', delivered: true, error: null }] });
        expect(decide(at(4, 23, 45), ok(pendingState(D_PLUS_1)), delivered).ops).toEqual([
            { type: 'attempt', date: D_PLUS_1, attemptNumber: 1 },
        ]);
    });
});

describe('decideDailySummaryAction: RD-03, a lo más 4 intentos por día resumido (D-07)', () => {
    // Simula al despachador del plan 20.7-07 sobre un almacén en memoria: cada ejecución lee los
    // dos estados (validados como lo hará readDayState), pide la decisión y aplica las
    // operaciones en orden. Cada intento se sella con localStamp(now), el reloj de la ejecución.
    function simulateEvery15Min({ runs, deliver }) {
        const store = { [D]: pendingState(D) };
        const read = (iso) => {
            if (!Object.prototype.hasOwnProperty.call(store, iso)) {
                return MISSING;
            }
            return isValidDayState(store[iso], iso) ? ok(store[iso]) : CORRUPT;
        };
        const timeline = [];
        const foreignDates = [];
        let maxAttemptOpsPerRun = 0;
        let lastStamp = null;
        for (let k = 0; k < runs; k += 1) {
            const now = at(3, 23, 45 + 15 * k);
            const todayISO = localDateISO(now);
            const result = decide(now, read(todayISO), read(addDaysISO(todayISO, -1)));
            const stamp = localStamp(now);
            lastStamp = stamp;
            maxAttemptOpsPerRun = Math.max(maxAttemptOpsPerRun, result.ops.filter((op) => op.type === 'attempt').length);
            for (const op of result.ops) {
                timeline.push({ stamp, ...op });
                if (op.date !== result.todayISO && op.date !== result.yesterdayISO) {
                    foreignDates.push(op.date);
                }
                if (op.type === 'create') {
                    store[op.date] = pendingState(op.date);
                } else if (op.type === 'abandon') {
                    store[op.date] = { ...store[op.date], status: 'abandoned', reason: op.reason };
                } else if (op.type === 'attempt') {
                    const delivered = deliver(op.attemptNumber) === true;
                    const prev = store[op.date];
                    store[op.date] = {
                        ...prev,
                        status: delivered ? 'delivered' : 'pending',
                        attempts: [...prev.attempts, { at: stamp, delivered, error: delivered ? null : 'connect ECONNREFUSED 127.0.0.1:25' }],
                    };
                }
            }
        }
        return { store, timeline, foreignDates, maxAttemptOpsPerRun, lastStamp };
    }

    test('correo siempre caído, cada 15 min de las 23:45 de D a las 23:30 de D+1 → 4 intentos de D y un abandono max-attempts', () => {
        const { store, timeline, foreignDates, maxAttemptOpsPerRun, lastStamp } = simulateEvery15Min({ runs: 96, deliver: () => false });

        expect(lastStamp).toBe('2026-11-04T23:30:00');
        const attemptsOfD = timeline.filter((entry) => entry.type === 'attempt' && entry.date === D);
        expect(attemptsOfD.map((entry) => entry.stamp)).toEqual([
            '2026-11-03T23:45:00',
            '2026-11-04T00:45:00',
            '2026-11-04T03:45:00',
            '2026-11-04T11:45:00',
        ]);
        expect(attemptsOfD.map((entry) => entry.attemptNumber)).toEqual([1, 2, 3, 4]);
        expect(timeline).toEqual([
            { stamp: '2026-11-03T23:45:00', type: 'attempt', date: D, attemptNumber: 1 },
            { stamp: '2026-11-04T00:00:00', type: 'create', date: D_PLUS_1 },
            { stamp: '2026-11-04T00:45:00', type: 'attempt', date: D, attemptNumber: 2 },
            { stamp: '2026-11-04T03:45:00', type: 'attempt', date: D, attemptNumber: 3 },
            { stamp: '2026-11-04T11:45:00', type: 'attempt', date: D, attemptNumber: 4 },
            { stamp: '2026-11-04T12:00:00', type: 'abandon', date: D, reason: 'max-attempts', attempts: 4 },
        ]);
        expect(store[D]).toMatchObject({ status: 'abandoned', reason: 'max-attempts' });
        expect(store[D].attempts).toHaveLength(MAX_ATTEMPTS);
        expect(store[D_PLUS_1]).toEqual(pendingState(D_PLUS_1));
        expect(foreignDates).toEqual([]);
        expect(maxAttemptOpsPerRun).toBe(1);
    });

    test('con el primer intento entregado ya no hay más intentos ni abandono', () => {
        const { store, timeline } = simulateEvery15Min({ runs: 96, deliver: (attemptNumber) => attemptNumber === 1 });

        expect(timeline).toEqual([
            { stamp: '2026-11-03T23:45:00', type: 'attempt', date: D, attemptNumber: 1 },
            { stamp: '2026-11-04T00:00:00', type: 'create', date: D_PLUS_1 },
        ]);
        expect(store[D].status).toBe('delivered');
    });

    test('las esperas se miden desde el PRIMER intento y se cumplen al minuto exacto', () => {
        const today = ok(pendingState(D_PLUS_1));
        const one = ok(pendingState(D, [failedAttempt('2026-11-03T23:45:00')]));
        expect(decide(at(4, 0, 44, 59), today, one).ops).toEqual([]);
        expect(decide(at(4, 0, 45), today, one).ops).toEqual([{ type: 'attempt', date: D, attemptNumber: 2 }]);

        // El segundo intento salió tarde (01:30); el tercero sigue contando desde las 23:45.
        const two = ok(pendingState(D, [failedAttempt('2026-11-03T23:45:00'), failedAttempt('2026-11-04T01:30:00')]));
        expect(decide(at(4, 3, 44), today, two).ops).toEqual([]);
        expect(decide(at(4, 3, 45), today, two).ops).toEqual([{ type: 'attempt', date: D, attemptNumber: 3 }]);
    });

    test('4 intentos con el estado aún pending (caída entre las dos escrituras) → abandona con max-attempts', () => {
        const attempts = [
            failedAttempt('2026-11-03T23:45:00'),
            failedAttempt('2026-11-04T00:45:00'),
            failedAttempt('2026-11-04T03:45:00'),
            { at: '2026-11-04T11:45:00', delivered: null, error: null },
        ];
        expect(decide(at(4, 12, 0), ok(pendingState(D_PLUS_1)), ok(pendingState(D, attempts))).ops).toEqual([
            { type: 'abandon', date: D, reason: 'max-attempts', attempts: 4 },
        ]);
    });
});

describe('decideDailySummaryAction: estado dañado nunca provoca un envío (D-07, T-20.7-06)', () => {
    test('hoy corrupt a las 23:45 → abandona D con state-corrupt y no intenta', () => {
        expect(decide(at(3, 23, 45), CORRUPT, MISSING)).toEqual({
            todayISO: D,
            yesterdayISO: D_MINUS_1,
            ops: [{ type: 'abandon', date: D, reason: 'state-corrupt', attempts: 0 }],
        });
    });

    test('hoy corrupt antes de la hora no detiene la reposición de ayer', () => {
        expect(decide(at(3, 0, 0), CORRUPT, ok(pendingState(D_MINUS_1))).ops).toEqual([
            { type: 'abandon', date: D, reason: 'state-corrupt', attempts: 0 },
            { type: 'attempt', date: D_MINUS_1, attemptNumber: 1 },
        ]);
    });

    test('ayer corrupt antes de la hora → abandona D-1 con state-corrupt', () => {
        expect(decide(at(3, 10, 30), ok(pendingState(D)), CORRUPT).ops).toEqual([
            { type: 'abandon', date: D_MINUS_1, reason: 'state-corrupt', attempts: 0 },
        ]);
    });

    test('ayer corrupt después de la hora → nada sobre ayer; hoy se intenta', () => {
        expect(decide(at(3, 23, 45), ok(pendingState(D)), CORRUPT).ops).toEqual([
            { type: 'attempt', date: D, attemptNumber: 1 },
        ]);
    });

    test('un ok que no pasa isValidDayState cuenta como corrupt', () => {
        const abandonToday = [{ type: 'abandon', date: D, reason: 'state-corrupt', attempts: 0 }];
        const fail1 = failedAttempt('2026-11-03T23:45:00');
        expect(decide(at(3, 23, 45), ok(pendingState(D_MINUS_1)), MISSING).ops).toEqual(abandonToday);
        expect(decide(at(3, 23, 45), ok(pendingState(D, [fail1, fail1, fail1, fail1, fail1])), MISSING).ops).toEqual(abandonToday);
        expect(decide(at(3, 23, 45), ok(pendingState(D, [{ at: '2026-11-03T23:45:00', delivered: true, error: null }])), MISSING).ops).toEqual(abandonToday);
        expect(decide(at(3, 23, 45), ok(null), MISSING).ops).toEqual(abandonToday);
    });

    test('una envoltura de estado que no se reconoce cuenta como corrupt', () => {
        const abandonToday = [{ type: 'abandon', date: D, reason: 'state-corrupt', attempts: 0 }];
        expect(decide(at(3, 23, 45), { status: 'otro' }, MISSING).ops).toEqual(abandonToday);
        expect(decide(at(3, 23, 45), undefined, MISSING).ops).toEqual(abandonToday);
        expect(decide(at(3, 23, 45), 'missing', MISSING).ops).toEqual(abandonToday);
    });
});

describe('sanitizeLogText (D-34, T-20.7-08)', () => {
    test('nulo, ausente, vacío o solo espacios → sin detalle', () => {
        expect(sanitizeLogText(null)).toBe('sin detalle');
        expect(sanitizeLogText(undefined)).toBe('sin detalle');
        expect(sanitizeLogText('')).toBe('sin detalle');
        expect(sanitizeLogText('   ')).toBe('sin detalle');
        expect(sanitizeLogText('\n\t ')).toBe('sin detalle');
    });

    test('colapsa los espacios en blanco, quita las orillas y recorta a 200 por omisión', () => {
        expect(sanitizeLogText('  uno\n dos\t\ttres  ')).toBe('uno dos tres');
        expect(sanitizeLogText('x'.repeat(250))).toBe('x'.repeat(200));
    });

    test('respeta un tope explícito; uno inválido vuelve a 200', () => {
        expect(sanitizeLogText('abcdef', 3)).toBe('abc');
        expect(sanitizeLogText('x'.repeat(250), 0)).toBe('x'.repeat(200));
    });

    test('convierte a texto y nunca lanza', () => {
        expect(sanitizeLogText(1827)).toBe('1827');
        const hostile = { toString() { throw new Error('boom'); } };
        expect(sanitizeLogText(hostile)).toBe('sin detalle');
    });
});

describe('formatNotificationStatusLine: línea de arranque (D-32, D-40)', () => {
    const ALL_OFF_NO_TIME = '[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=n/a';

    // Copia del doble de config de tests/services/cron-scheduler.test.js, que llama initScheduler()
    // sin `notifications` ni `eom`. Solo `paths.logs` cambia, a un valor relativo, para no dejar
    // rutas absolutas en el repo; la línea de arranque no lo lee.
    const CRON_SCHEDULER_CFG = {
        schedule: {
            cronExpression: '*/15 * * * *',
            operationDelayMs: 1000,
        },
        app: {
            timezone: 'America/Mexico_City',
        },
        portal: {
            tenants: [{ id: 'T1' }, { id: 'T2' }],
        },
        database: { user: 'test', password: 'test', server: 'localhost', database: 'TEST' },
        paths: { logs: 'logs' },
    };

    function notificationsCfg({ poAlert, eom, paymentReport, dailySummary, hour = 23, minute = 45 }) {
        return {
            notifications: {
                poAlert: { enabled: poAlert },
                paymentReport: { enabled: paymentReport, hour: 18, lookbackDays: 365 },
                dailySummary: { enabled: dailySummary, hour, minute },
            },
            eom: { notificationHour: 18, notificationEnabled: eom },
        };
    }

    test('los cuatro apagados con 23:45 → el texto exacto de D-32', () => {
        const cfg = notificationsCfg({ poAlert: false, eom: false, paymentReport: false, dailySummary: false });
        expect(formatNotificationStatusLine(cfg)).toBe('[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=23:45');
    });

    test('los cuatro encendidos con 7:05 → on y la hora con dos dígitos', () => {
        const cfg = notificationsCfg({ poAlert: true, eom: true, paymentReport: true, dailySummary: true, hour: 7, minute: 5 });
        expect(formatNotificationStatusLine(cfg)).toBe('[NOTIFICATIONS] po-alert=on eom=on payment-report=on daily-summary=on daily-summary-time=07:05');
    });

    test('cada interruptor sale de su propia llave', () => {
        const only = (name) => notificationsCfg({ poAlert: false, eom: false, paymentReport: false, dailySummary: false, [name]: true });
        expect(formatNotificationStatusLine(only('poAlert'))).toBe('[NOTIFICATIONS] po-alert=on eom=off payment-report=off daily-summary=off daily-summary-time=23:45');
        expect(formatNotificationStatusLine(only('eom'))).toBe('[NOTIFICATIONS] po-alert=off eom=on payment-report=off daily-summary=off daily-summary-time=23:45');
        expect(formatNotificationStatusLine(only('paymentReport'))).toBe('[NOTIFICATIONS] po-alert=off eom=off payment-report=on daily-summary=off daily-summary-time=23:45');
        expect(formatNotificationStatusLine(only('dailySummary'))).toBe('[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=on daily-summary-time=23:45');
    });

    test.each([
        ['{}', {}],
        ['undefined', undefined],
        ['null', null],
        ['el doble de cron-scheduler.test.js, sin notifications ni eom', CRON_SCHEDULER_CFG],
    ])('%s → todos off y daily-summary-time=n/a, sin lanzar', (_name, cfg) => {
        expect(formatNotificationStatusLine(cfg)).toBe(ALL_OFF_NO_TIME);
    });

    test("un 'true' de texto cuenta como off: solo === true enciende", () => {
        const cfg = notificationsCfg({ poAlert: 'true', eom: 'true', paymentReport: 'true', dailySummary: 'true' });
        expect(formatNotificationStatusLine(cfg)).toBe('[NOTIFICATIONS] po-alert=off eom=off payment-report=off daily-summary=off daily-summary-time=23:45');
    });

    test('una hora o un minuto fuera de rango salen como n/a', () => {
        const withTime = (hour, minute) => formatNotificationStatusLine(notificationsCfg({ poAlert: false, eom: false, paymentReport: false, dailySummary: false, hour, minute }));
        expect(withTime(24, 0)).toBe(ALL_OFF_NO_TIME);
        expect(withTime(23, 60)).toBe(ALL_OFF_NO_TIME);
        expect(withTime('23', 45)).toBe(ALL_OFF_NO_TIME);
        expect(withTime(23, null)).toBe(ALL_OFF_NO_TIME);
        // Sin la llave del minuto (el ayudante pondría 45 por omisión, así que se arma a mano).
        expect(formatNotificationStatusLine({ notifications: { dailySummary: { enabled: false, hour: 23 } } })).toBe(ALL_OFF_NO_TIME);
    });

    test('una config que lanza al leerse → status=unreadable, sin lanzar', () => {
        const hostile = { get notifications() { throw new Error('boom'); } };
        expect(formatNotificationStatusLine(hostile)).toBe('[NOTIFICATIONS] status=unreadable');
    });
});

describe('formatAttemptLogLine: una línea por intento (D-34)', () => {
    const COUNTS = { ocUploaded: 12, paymentsUploaded: 30, ocPending: 3, paymentsPending: 2, lastDay: 1 };

    test('entregado → el texto exacto, sin err=', () => {
        const line = formatAttemptLogLine({ dateISO: '2026-11-03', attemptNumber: 1, delivered: true, counts: COUNTS, incomplete: false, error: null });
        expect(line).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=true oc-uploaded=12 payments-uploaded=30 oc-pending=3 payments-pending=2 last-day=1 incomplete=false');
    });

    test('no entregado con un error de tres renglones y 500 caracteres → sent=false y err= colapsado a 200', () => {
        const error = 'a'.repeat(100) + '\n\n' + 'b'.repeat(100) + '\n' + 'c'.repeat(297);
        expect(error).toHaveLength(500);
        const expectedErr = 'a'.repeat(100) + ' ' + 'b'.repeat(99);
        expect(expectedErr).toHaveLength(200);

        const line = formatAttemptLogLine({ dateISO: '2026-11-03', attemptNumber: 2, delivered: false, counts: COUNTS, incomplete: true, error });
        expect(line).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=2/4 sent=false oc-uploaded=12 payments-uploaded=30 oc-pending=3 payments-pending=2 last-day=1 incomplete=true err=' + expectedErr);
        expect(line).not.toMatch(/\n/);
    });

    test('cualquier delivered distinto de true cuenta como no entregado (S-2)', () => {
        const base = { dateISO: '2026-11-03', attemptNumber: 3, counts: COUNTS, incomplete: false, error: 'connect ECONNREFUSED 127.0.0.1:25' };
        const tail = ' sent=false oc-uploaded=12 payments-uploaded=30 oc-pending=3 payments-pending=2 last-day=1 incomplete=false err=connect ECONNREFUSED 127.0.0.1:25';
        expect(formatAttemptLogLine({ ...base, delivered: null })).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=3/4' + tail);
        expect(formatAttemptLogLine({ ...base, delivered: 1 })).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=3/4' + tail);
        expect(formatAttemptLogLine({ ...base, delivered: 'true' })).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=3/4' + tail);
    });

    test('no entregado sin mensaje → err=sin detalle', () => {
        const line = formatAttemptLogLine({ dateISO: '2026-11-03', attemptNumber: 4, delivered: false, counts: COUNTS, incomplete: false });
        expect(line).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=4/4 sent=false oc-uploaded=12 payments-uploaded=30 oc-pending=3 payments-pending=2 last-day=1 incomplete=false err=sin detalle');
    });

    test('cifras null o ausentes → n/a', () => {
        const line = formatAttemptLogLine({ dateISO: '2026-11-03', attemptNumber: 1, delivered: true, counts: { ocUploaded: null, paymentsUploaded: 30, ocPending: undefined }, incomplete: true });
        expect(line).toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=true oc-uploaded=n/a payments-uploaded=30 oc-pending=n/a payments-pending=n/a last-day=n/a incomplete=true');
        expect(formatAttemptLogLine({ dateISO: '2026-11-03', attemptNumber: 1, delivered: true, counts: null, incomplete: false }))
            .toBe('[DAILY-SUMMARY] date=2026-11-03 attempt=1/4 sent=true oc-uploaded=n/a payments-uploaded=n/a oc-pending=n/a payments-pending=n/a last-day=n/a incomplete=false');
    });

    test('sin argumento no lanza y todo sale n/a', () => {
        expect(formatAttemptLogLine()).toBe('[DAILY-SUMMARY] date=n/a attempt=n/a/4 sent=false oc-uploaded=n/a payments-uploaded=n/a oc-pending=n/a payments-pending=n/a last-day=n/a incomplete=n/a err=sin detalle');
    });
});

describe('formatAbandonLogLine y formatClockWarnLine (D-34, D-35)', () => {
    test('abandono → el texto exacto, con las tres razones', () => {
        expect(formatAbandonLogLine({ dateISO: '2026-11-02', reason: 'next-summary-due', attempts: 2 }))
            .toBe('[DAILY-SUMMARY-ABANDON] date=2026-11-02 reason=next-summary-due attempts=2');
        expect(formatAbandonLogLine({ dateISO: '2026-11-03', reason: 'max-attempts', attempts: 4 }))
            .toBe('[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=max-attempts attempts=4');
        expect(formatAbandonLogLine({ dateISO: '2026-11-03', reason: 'state-corrupt', attempts: 0 }))
            .toBe('[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=state-corrupt attempts=0');
    });

    test('abandono con entrada incompleta o un motivo que no es una clave → n/a, sin lanzar', () => {
        expect(formatAbandonLogLine()).toBe('[DAILY-SUMMARY-ABANDON] date=n/a reason=n/a attempts=n/a');
        expect(formatAbandonLogLine({ dateISO: '2026-11-03', reason: 'max attempts\nfin', attempts: 4 }))
            .toBe('[DAILY-SUMMARY-ABANDON] date=2026-11-03 reason=n/a attempts=4');
    });

    test('diferencia de relojes → el texto exacto de D-35', () => {
        expect(formatClockWarnLine('2026-11-03', '2026-11-04')).toBe('[DAILY-SUMMARY-CLOCK] tz-date=2026-11-03 sql-date=2026-11-04');
    });

    test('relojes que no son fecha → n/a, sin lanzar', () => {
        expect(formatClockWarnLine(null, 'x\ny')).toBe('[DAILY-SUMMARY-CLOCK] tz-date=n/a sql-date=n/a');
    });
});

describe('exports del módulo', () => {
    const CONTRACT_EXPORTS = [
        'MAX_ATTEMPTS',
        'RETRY_OFFSETS_MIN',
        'ROW_CAP',
        'localDateISO',
        'localStamp',
        'parseStamp',
        'isIsoDate',
        'addDaysISO',
        'isValidDayState',
        'decideDailySummaryAction',
        'sanitizeLogText',
        'formatNotificationStatusLine',
        'formatAttemptLogLine',
        'formatAbandonLogLine',
        'formatClockWarnLine',
    ];

    test('exporta los 15 nombres del contrato; lo que sume el plan 20.7-04 no rompe este caso', () => {
        expect(CONTRACT_EXPORTS).toHaveLength(15);
        expect(Object.keys(DailySummary)).toEqual(expect.arrayContaining(CONTRACT_EXPORTS));
    });
});
