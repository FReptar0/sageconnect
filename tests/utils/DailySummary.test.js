// tests/utils/DailySummary.test.js
// Fase 20.7 (D-01, D-05 a D-09, D-29): agenda del resumen diario con relojes simulados,
// validación del estado del día y ayudantes de fecha de src/utils/DailySummary.js.
// Parte B (plan 20.7-04, D-13 a D-15, D-17, D-19, D-23 a D-28): motivos, ventana y marca de
// último día contra el día resumido, el modelo del correo, la línea de cifras, el HTML y el asunto.

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
    classifyOcReason,
    classifyPaymentRejection,
    isWithinRetryWindow,
    isLastRetryDay,
    buildDailySummaryModel,
    formatCountsLine,
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

// ---------------------------------------------------------------------------------------------
// Parte B (plan 20.7-04). Mismo D = 2026-11-03, ventana de 30 días y la empresa COPDAT.
// ---------------------------------------------------------------------------------------------

const RETRY_30 = Object.freeze({ scope: 'last_n_days', lookbackDays: 30 });
const RETRY_MONTH = Object.freeze({ scope: 'current_month' });

// Un renglón tal como lo devuelve la consulta de OCs del plan 20.7-06.
function ocRow(overrides = {}) {
    return {
        tenant: 'COPDAT',
        idOrPo: 'PO0001',
        attemptsToday: 1,
        lastError: '1300: OC duplicada',
        isValidation: 0,
        fechaAuth: '2026-10-20',
        ...overrides,
    };
}

// Una entrada del registro de pagos con la forma de D-16 (plan 20.7-03).
function ledgerEntry(outcome, overrides = {}) {
    return {
        outcome,
        code: null,
        description: null,
        vendor: 'PROV01',
        fechaRegistro: '2026-10-20',
        attempts: 1,
        firstAt: '2026-11-03T08:00:00',
        lastAt: '2026-11-03T08:00:00',
        ...overrides,
    };
}

function tenantLedger(payments, overrides = {}) {
    return { runs: 4, lastRunAt: '2026-11-03T23:30:00', queryFailures: 0, lastQueryError: null, ...overrides, payments };
}

// El valor de readPaymentDayLedger con status ok. `root` agrega campos a la RAÍZ (recoveredAt).
function okLedger(tenants, root = {}, date = D) {
    return { status: 'ok', data: { version: 1, date, ...root, tenants } };
}

// Entrada completa del modelo para un día limpio: una empresa, sin OCs y un registro sin pagos.
function buildModel(overrides = {}) {
    const dateISO = overrides.dateISO || D;
    return buildDailySummaryModel({
        dateISO,
        retry: RETRY_30,
        tenants: ['COPDAT'],
        ocRows: [],
        ocUploadedByTenant: { COPDAT: 0 },
        ledger: okLedger({ COPDAT: tenantLedger({}) }, {}, dateISO),
        controlByTenant: { COPDAT: [] },
        sourceFailures: [],
        clock: null,
        ...overrides,
    });
}

const groupSummary = (section) => section.groups.map((group) => [group.title, group.rows.length]);
const allRows = (section) => section.groups.flatMap((group) => group.rows);

// Un proveedor sin ID que bloquea 3 pagos. Lo usan el conteo por documento y el asunto.
const PROVIDER_BLOCKS_3 = Object.freeze({
    PY0201: ledgerEntry('no-provider-id', { vendor: 'PROV20', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-21' }),
    PY0202: ledgerEntry('no-provider-id', { vendor: 'PROV20', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-22' }),
    PY0203: ledgerEntry('no-provider-id', { vendor: 'PROV20', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-23' }),
});

describe('classifyOcReason: los cuatro motivos de las OCs (D-13)', () => {
    test('idFocaltec vacío → validation / «Validación de datos»', () => {
        expect(classifyOcReason({ isValidation: 1 })).toEqual({ key: 'validation', title: 'Validación de datos' });
        expect(classifyOcReason({ isValidation: 1, lastError: '"provider_external_id" is required' })).toEqual({ key: 'validation', title: 'Validación de datos' });
    });

    test("'1300: OC duplicada' → portal-1300 / «Portal 1300»", () => {
        expect(classifyOcReason({ isValidation: 0, lastError: '1300: OC duplicada' })).toEqual({ key: 'portal-1300', title: 'Portal 1300' });
    });

    test("'undefined: undefined' → portal-no-code / «Respuesta del portal sin código»", () => {
        expect(classifyOcReason({ isValidation: 0, lastError: 'undefined: undefined' })).toEqual({ key: 'portal-no-code', title: 'Respuesta del portal sin código' });
    });

    test("'timeout of 30000ms exceeded' → no-response / «Sin respuesta del portal»", () => {
        expect(classifyOcReason({ isValidation: 0, lastError: 'timeout of 30000ms exceeded' })).toEqual({ key: 'no-response', title: 'Sin respuesta del portal' });
    });

    test('la marca de validación gana aunque el texto empiece con un código', () => {
        expect(classifyOcReason({ isValidation: 1, lastError: '1300: OC duplicada' }).key).toBe('validation');
        expect(classifyOcReason({ isValidation: true, lastError: '1300: OC duplicada' }).key).toBe('validation');
    });

    test('sin el espacio después de los dos puntos no es un código; un texto o una entrada nulos van a sin respuesta, sin lanzar', () => {
        expect(classifyOcReason({ isValidation: 0, lastError: '1300:OC duplicada' }).key).toBe('no-response');
        expect(classifyOcReason({ isValidation: 0, lastError: null }).key).toBe('no-response');
        expect(classifyOcReason(null).key).toBe('no-response');
        expect(classifyOcReason(undefined).key).toBe('no-response');
    });
});

describe('classifyPaymentRejection: rechazos por código y sin respuesta (RD-06)', () => {
    test('rejected → «Portal <código>»; el 1827 se agrupa como cualquier otro código, sin marca de «sin acción»', () => {
        const r1827 = classifyPaymentRejection(ledgerEntry('rejected', { code: '1827' }));
        expect(r1827).toEqual({ key: 'portal-1827', title: 'Portal 1827' });
        expect(JSON.stringify(r1827)).not.toMatch(/sin acci/i);
        expect(classifyPaymentRejection(ledgerEntry('rejected', { code: 'HTTP 502' }))).toEqual({ key: 'portal-HTTP 502', title: 'Portal HTTP 502' });
    });

    test('rejected sin código → «Portal sin código»', () => {
        for (const code of [null, undefined, '', '   ']) {
            expect(classifyPaymentRejection(ledgerEntry('rejected', { code }))).toEqual({ key: 'portal-no-code', title: 'Portal sin código' });
        }
    });

    test('no-response → «Sin respuesta del portal»', () => {
        expect(classifyPaymentRejection(ledgerEntry('no-response', { description: 'timeout of 30000ms exceeded' }))).toEqual({ key: 'no-response', title: 'Sin respuesta del portal' });
    });

    test('lo subido y lo detenido por datos de Sage no son rechazos → null', () => {
        for (const outcome of ['uploaded', 'no-provider-id', 'missing-uuid', 'no-invoices', 'otro']) {
            expect(classifyPaymentRejection(ledgerEntry(outcome))).toBeNull();
        }
        expect(classifyPaymentRejection(null)).toBeNull();
        expect(classifyPaymentRejection(undefined)).toBeNull();
    });
});

describe('isWithinRetryWindow e isLastRetryDay contra el día resumido (D-15, RD-08)', () => {
    test.each([
        ['2026-10-03', 'D−31', false, false],
        ['2026-10-04', 'D−30', true, true],
        ['2026-10-05', 'D−29', true, false],
        ['2026-11-03', 'D', true, false],
    ])('last_n_days 30: %s (%s) → dentro %s, último día %s', (doc, _label, within, lastDay) => {
        expect(isWithinRetryWindow(doc, D, RETRY_30)).toBe(within);
        expect(isLastRetryDay(doc, D, RETRY_30)).toBe(lastDay);
    });

    test('una fecha null queda fuera y nunca es último día', () => {
        expect(isWithinRetryWindow(null, D, RETRY_30)).toBe(false);
        expect(isLastRetryDay(null, D, RETRY_30)).toBe(false);
    });

    test('el borde cruza el año: con D = 2026-01-15 y 30 días es el 2025-12-16', () => {
        expect(isWithinRetryWindow('2025-12-15', '2026-01-15', RETRY_30)).toBe(false);
        expect(isLastRetryDay('2025-12-16', '2026-01-15', RETRY_30)).toBe(true);
    });

    test('current_month con D a mitad de mes: octubre queda fuera y ningún documento está en su último día', () => {
        expect(isWithinRetryWindow('2026-10-31', D, RETRY_MONTH)).toBe(false);
        expect(isWithinRetryWindow('2026-11-01', D, RETRY_MONTH)).toBe(true);
        expect(isLastRetryDay('2026-11-01', D, RETRY_MONTH)).toBe(false);
        expect(isLastRetryDay(D, D, RETRY_MONTH)).toBe(false);
    });

    test('current_month con D en el último día del mes: todo el mes lleva la marca y el mes anterior sigue fuera', () => {
        expect(isLastRetryDay('2026-11-01', '2026-11-30', RETRY_MONTH)).toBe(true);
        expect(isLastRetryDay('2026-11-30', '2026-11-30', RETRY_MONTH)).toBe(true);
        expect(isWithinRetryWindow('2026-10-31', '2026-11-30', RETRY_MONTH)).toBe(false);
        expect(isLastRetryDay('2026-10-31', '2026-11-30', RETRY_MONTH)).toBe(false);
        expect(isLastRetryDay('2026-02-10', '2026-02-28', RETRY_MONTH)).toBe(true);
        expect(isLastRetryDay('2026-12-01', '2026-12-31', RETRY_MONTH)).toBe(true);
    });

    test('entrada inválida o alcance desconocido → false en las dos', () => {
        const cases = [
            ['2026-10-20', D, { scope: 'otro', lookbackDays: 30 }],
            ['2026-10-20', D, null],
            ['2026-10-20', D, undefined],
            ['2026-10-20', D, { scope: 'last_n_days' }],
            ['2026-10-20', D, { scope: 'last_n_days', lookbackDays: 1.5 }],
            ['2026-10-20', D, { scope: 'last_n_days', lookbackDays: '30' }],
            ['2026-10-20', D, { scope: 'last_n_days', lookbackDays: -1 }],
            ['2026-10-20', 'ayer', RETRY_30],
            ['2026-10-20', null, RETRY_30],
            ['2026-11-01', '2026-11-03T23:45:00', RETRY_MONTH],
            ['2026-02-30', D, RETRY_30],
            ['20/10/2026', D, RETRY_30],
            [20261020, D, RETRY_30],
            ['2026-11-01', D, 'current_month'],
        ];
        for (const [doc, day, retry] of cases) {
            expect(isWithinRetryWindow(doc, day, retry)).toBe(false);
            expect(isLastRetryDay(doc, day, retry)).toBe(false);
        }
    });
});

describe('buildDailySummaryModel: OCs (RD-05, RD-08, D-13, D-15)', () => {
    test('RD-05: dos OCs con el mismo código y una de validación → «Portal 1300» con 2 renglones y «Validación de datos» con 1', () => {
        const model = buildModel({
            ocRows: [
                ocRow({ idOrPo: 'PO0001' }),
                ocRow({ idOrPo: 'PO0002', isValidation: 1, lastError: '"provider_external_id" is required' }),
                ocRow({ idOrPo: 'PO0003' }),
            ],
        });
        expect(model.sections.oc.title).toBe('OCs sin subir');
        expect(groupSummary(model.sections.oc)).toEqual([['Portal 1300', 2], ['Validación de datos', 1]]);
        expect(model.sections.oc.groups.map((group) => group.key)).toEqual(['portal-1300', 'validation']);
        expect(model.counts.ocPending).toBe(3);
    });

    test('cada renglón de OC lleva tenant, idOrPo, fechaAuth, attemptsToday, lastError y lastDay', () => {
        const model = buildModel({ ocRows: [ocRow({ attemptsToday: 4 })] });
        expect(model.sections.oc.groups[0].rows).toEqual([{
            tenant: 'COPDAT',
            idOrPo: 'PO0001',
            fechaAuth: '2026-10-20',
            attemptsToday: 4,
            lastError: '1300: OC duplicada',
            lastDay: false,
        }]);
    });

    test('la ventana se calcula contra el día resumido: D−31 y null quedan fuera, D−30 entra con marca y D−29 sin ella', () => {
        const model = buildModel({
            ocRows: [
                ocRow({ idOrPo: 'PO-31', fechaAuth: '2026-10-03' }),
                ocRow({ idOrPo: 'PO-30', fechaAuth: '2026-10-04' }),
                ocRow({ idOrPo: 'PO-29', fechaAuth: '2026-10-05' }),
                ocRow({ idOrPo: 'PO-NULL', fechaAuth: null }),
            ],
        });
        expect(allRows(model.sections.oc).map((row) => [row.idOrPo, row.lastDay])).toEqual([['PO-30', true], ['PO-29', false]]);
        expect(model.counts.ocPending).toBe(2);
    });

    test('RD-08: de dos renglones de hace 30 y 29 días solo el primero lleva la marca y el total de marcados es 1', () => {
        // El modelo no recibe la fecha de hoy: la ventana sale solo de dateISO, así que la
        // reposición del 2026-11-04 conserva el renglón del 2026-10-04 (Advertencia C).
        const model = buildModel({
            ocRows: [
                ocRow({ idOrPo: 'PO-29', fechaAuth: addDaysISO(D, -29) }),
                ocRow({ idOrPo: 'PO-30', fechaAuth: addDaysISO(D, -30) }),
            ],
        });
        expect(allRows(model.sections.oc).map((row) => [row.idOrPo, row.fechaAuth, row.lastDay])).toEqual([
            ['PO-30', '2026-10-04', true],
            ['PO-29', '2026-10-05', false],
        ]);
        expect(model.counts.lastDay).toBe(1);
    });

    test('current_month: con D = 2026-11-30 una OC de octubre queda fuera y las del mes llevan la marca', () => {
        const model = buildModel({
            dateISO: '2026-11-30',
            retry: RETRY_MONTH,
            ocRows: [
                ocRow({ idOrPo: 'PO-OCT', fechaAuth: '2026-10-31' }),
                ocRow({ idOrPo: 'PO-NOV1', fechaAuth: '2026-11-01' }),
                ocRow({ idOrPo: 'PO-NOV2', fechaAuth: '2026-11-20' }),
            ],
        });
        expect(allRows(model.sections.oc).map((row) => [row.idOrPo, row.lastDay])).toEqual([['PO-NOV1', true], ['PO-NOV2', true]]);
        expect(model.counts.lastDay).toBe(2);
    });

    test('una ventana de reintentos que no se reconoce no lista OCs: ocPending null y una nota, nunca «sin pendientes»', () => {
        const model = buildModel({ retry: { scope: 'otro' }, ocRows: [ocRow()] });
        expect(model.sections.oc.groups).toEqual([]);
        expect(model.counts.ocPending).toBeNull();
        expect(model.notes).toEqual(['No se aplicó la ventana de reintentos porque su configuración no es válida: no se listan OCs ni se marca el último día de reintento.']);
        expect(model.incomplete).toBe(true);
    });
});

describe('buildDailySummaryModel: pagos (RD-06, RD-07, D-14, D-17)', () => {
    test('RD-06: dos rechazos 1827 y uno 1800 → dos grupos de 2 y 1; lo subido y lo que ya tiene fila de control no aparecen', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY0001: ledgerEntry('rejected', { code: '1827', description: 'Alguna factura ya está pagada' }),
                    PY0002: ledgerEntry('rejected', { code: '1800', description: 'Cuenta bancaria no encontrada' }),
                    PY0003: ledgerEntry('rejected', { code: '1827', description: 'Alguna factura ya está pagada' }),
                    PY0004: ledgerEntry('uploaded'),
                    PY0005: ledgerEntry('rejected', { code: '1827', description: 'Alguna factura ya está pagada' }),
                }),
            }),
            controlByTenant: { COPDAT: ['PY0005'] },
        });
        expect(model.sections.rejected.title).toBe('Pagos rechazados por el portal');
        expect(groupSummary(model.sections.rejected)).toEqual([['Portal 1827', 2], ['Portal 1800', 1]]);
        expect(allRows(model.sections.rejected).map((row) => row.docnbr)).toEqual(['PY0001', 'PY0003', 'PY0002']);
        expect(model.counts.paymentsUploaded).toBe(1);
        expect(model.counts.paymentsPending).toBe(3);
    });

    test('D-14: un pago con fila de control no está pendiente aunque su último resultado sea un fallo, con arreglo o con Set', () => {
        const ledger = okLedger({
            COPDAT: tenantLedger({
                PY0005: ledgerEntry('rejected', { code: '1827' }),
                PY0006: ledgerEntry('no-response', { description: 'timeout of 30000ms exceeded' }),
                PY0007: ledgerEntry('no-provider-id', { vendor: 'PROV07' }),
            }),
        });
        for (const control of [['PY0005', 'PY0006 ', 'PY0007'], new Set(['PY0005', 'PY0006', 'PY0007'])]) {
            const model = buildModel({ ledger, controlByTenant: { COPDAT: control } });
            expect(model.sections.rejected.groups).toEqual([]);
            expect(model.sections.sage.groups).toEqual([]);
            expect(model.counts.paymentsPending).toBe(0);
        }
    });

    test('«Sin respuesta del portal» es su propio grupo; cada renglón lleva tenant, docnbr, vendor, fechaRegistro, attempts, description y lastDay', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY0011: ledgerEntry('no-response', { description: 'timeout of 30000ms exceeded', attempts: 3, vendor: 'PROV11' }),
                    PY0012: ledgerEntry('rejected', { code: '1800', description: 'Cuenta bancaria no encontrada' }),
                }),
            }),
        });
        expect(groupSummary(model.sections.rejected)).toEqual([['Portal 1800', 1], ['Sin respuesta del portal', 1]]);
        const noResponse = model.sections.rejected.groups.find((group) => group.key === 'no-response');
        expect(noResponse.rows).toEqual([{
            tenant: 'COPDAT',
            docnbr: 'PY0011',
            vendor: 'PROV11',
            fechaRegistro: '2026-10-20',
            attempts: 3,
            description: 'timeout of 30000ms exceeded',
            lastDay: false,
        }]);
    });

    test('RD-07: proveedor sin ID con 3 pagos → 1 renglón con sus 3 pagos; pago con 2 facturas sin UUID → 1 renglón; pago sin facturas → tercer grupo; ninguno entre los rechazos', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY0101: ledgerEntry('no-provider-id', { vendor: 'PROV09', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-12' }),
                    PY0102: ledgerEntry('no-provider-id', { vendor: 'PROV09', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-04' }),
                    PY0103: ledgerEntry('no-provider-id', { vendor: 'PROV09', description: 'Proveedor sin ID del portal', fechaRegistro: '2026-10-27' }),
                    PY0104: ledgerEntry('missing-uuid', { vendor: 'PROV10', description: '2 factura(s) sin UUID', invoices: ['FAC-0001', 'FAC-0002'], fechaRegistro: '2026-10-22' }),
                    PY0105: ledgerEntry('no-invoices', { vendor: 'PROV11', description: 'Sage no devolvió facturas para el pago', fechaRegistro: '2026-10-29' }),
                }),
            }),
        });
        const sage = model.sections.sage;
        expect(sage.title).toBe('Pagos detenidos por datos de Sage');
        const byKey = Object.fromEntries(sage.groups.map((group) => [group.key, group]));
        expect(Object.keys(byKey).sort()).toEqual(['missing-uuid', 'no-invoices', 'no-provider-id']);
        expect(byKey['no-provider-id'].title).toBe('Proveedores sin ID del portal');
        expect(byKey['no-provider-id'].rows).toEqual([{
            tenant: 'COPDAT',
            vendor: 'PROV09',
            payments: [
                { docnbr: 'PY0102', fechaRegistro: '2026-10-04', lastDay: true },
                { docnbr: 'PY0101', fechaRegistro: '2026-10-12', lastDay: false },
                { docnbr: 'PY0103', fechaRegistro: '2026-10-27', lastDay: false },
            ],
            lastDay: true,
        }]);
        expect(byKey['missing-uuid'].title).toBe('Pagos con facturas sin UUID');
        expect(byKey['missing-uuid'].rows).toEqual([{
            tenant: 'COPDAT',
            docnbr: 'PY0104',
            vendor: 'PROV10',
            invoices: ['FAC-0001', 'FAC-0002'],
            fechaRegistro: '2026-10-22',
            lastDay: false,
        }]);
        expect(byKey['no-invoices'].title).toBe('Pagos sin facturas en Sage');
        expect(byKey['no-invoices'].rows).toEqual([{
            tenant: 'COPDAT',
            docnbr: 'PY0105',
            vendor: 'PROV11',
            detail: 'Sage no devolvió facturas para el pago',
            fechaRegistro: '2026-10-29',
            lastDay: false,
        }]);
        expect(model.sections.rejected.groups).toEqual([]);
        expect(model.counts.paymentsPending).toBe(5);
    });

    test('pendientes por documento: un proveedor sin ID que bloquea 3 pagos suma 3, no su único renglón; con una OC más el total es 4', () => {
        const ledger = okLedger({ COPDAT: tenantLedger({ ...PROVIDER_BLOCKS_3 }) });
        const alone = buildModel({ ledger });
        expect(allRows(alone.sections.sage)).toHaveLength(1);
        expect(alone.counts.paymentsPending).toBe(3);
        expect(alone.pendingTotal).toBe(3);

        const withOc = buildModel({ ledger, ocRows: [ocRow()] });
        expect(withOc.counts.ocPending).toBe(1);
        expect(withOc.pendingTotal).toBe(4);
    });

    test('un pago rechazado con fila de control y uno subido no suman a paymentsPending', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    ...PROVIDER_BLOCKS_3,
                    PY0204: ledgerEntry('rejected', { code: '1827' }),
                    PY0205: ledgerEntry('uploaded'),
                }),
            }),
            controlByTenant: { COPDAT: ['PY0204'] },
        });
        expect(model.counts.paymentsPending).toBe(3);
        expect(model.counts.paymentsUploaded).toBe(1);
        expect(model.pendingTotal).toBe(3);
    });

    test('el mismo proveedor en dos empresas son dos renglones, y el mismo DOCNBR en dos empresas son dos pagos', () => {
        const model = buildModel({
            tenants: ['COPDAT', 'EMPRESA2'],
            ledger: okLedger({
                COPDAT: tenantLedger({ PY0001: ledgerEntry('no-provider-id', { vendor: 'PROV20' }) }),
                EMPRESA2: tenantLedger({ PY0001: ledgerEntry('no-provider-id', { vendor: 'PROV20' }) }),
            }),
            controlByTenant: { COPDAT: [], EMPRESA2: [] },
        });
        expect(allRows(model.sections.sage).map((row) => [row.tenant, row.vendor, row.payments.length])).toEqual([
            ['COPDAT', 'PROV20', 1],
            ['EMPRESA2', 'PROV20', 1],
        ]);
        expect(model.counts.paymentsPending).toBe(2);
    });

    test('counts.lastDay cuenta documentos marcados: OCs y pagos, incluidos los de cada proveedor', () => {
        const model = buildModel({
            ocRows: [ocRow({ idOrPo: 'PO0001', fechaAuth: '2026-10-04' }), ocRow({ idOrPo: 'PO0002', fechaAuth: '2026-10-05' })],
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY0001: ledgerEntry('rejected', { code: '1827', fechaRegistro: '2026-10-04' }),
                    PY0002: ledgerEntry('no-provider-id', { vendor: 'PROV30', fechaRegistro: '2026-10-04' }),
                    PY0003: ledgerEntry('no-provider-id', { vendor: 'PROV30', fechaRegistro: '2026-10-04' }),
                    PY0004: ledgerEntry('no-provider-id', { vendor: 'PROV30', fechaRegistro: '2026-10-10' }),
                }),
            }),
        });
        expect(model.counts.lastDay).toBe(4);
    });
});

describe('buildDailySummaryModel: cifras y notas de fuentes que faltan (RD-04, RD-09, D-19, D-25, D-27)', () => {
    test('RD-04: 12 OCs subidas, 3 sin éxito, 30 pagos subidos y 2 sin éxito → las cuatro cifras y la línea que las dice', () => {
        const payments = {};
        for (let i = 1; i <= 30; i += 1) {
            payments[`PY${String(i).padStart(4, '0')}`] = ledgerEntry('uploaded');
        }
        payments.PY9001 = ledgerEntry('rejected', { code: '1800', description: 'Cuenta bancaria no encontrada' });
        payments.PY9002 = ledgerEntry('no-response', { description: 'timeout of 30000ms exceeded' });
        const model = buildModel({
            ocUploadedByTenant: { COPDAT: 12 },
            ocRows: [ocRow({ idOrPo: 'PO0001' }), ocRow({ idOrPo: 'PO0002' }), ocRow({ idOrPo: 'PO0003', isValidation: 1 })],
            ledger: okLedger({ COPDAT: tenantLedger(payments) }),
        });
        expect(model.counts).toEqual({ ocUploaded: 12, paymentsUploaded: 30, ocPending: 3, paymentsPending: 2, lastDay: 0 });
        expect(model.pendingTotal).toBe(5);
        const line = formatCountsLine(model);
        for (const fragment of ['12 OCs', '30 pagos', '3 OCs', '2 pagos']) {
            expect(line).toContain(fragment);
        }
        expect(line).toBe('El 2026-11-03 se subieron 12 OCs y 30 pagos; quedaron sin subir 3 OCs y 2 pagos.');
    });

    test('formatCountsLine dice la fecha y no «hoy», «1 OC» y «1 pago» en singular, y la marca del último día solo si hay', () => {
        const model = buildModel({
            ocUploadedByTenant: { COPDAT: 1 },
            ocRows: [ocRow({ fechaAuth: '2026-10-04' })],
            ledger: okLedger({ COPDAT: tenantLedger({ PY0001: ledgerEntry('uploaded'), PY0002: ledgerEntry('rejected', { code: '1827' }) }) }),
        });
        const line = formatCountsLine(model);
        expect(line).toBe('El 2026-11-03 se subieron 1 OC y 1 pago; quedaron sin subir 1 OC y 1 pago (1 en su último día de reintento automático).');
        expect(line).not.toMatch(/hoy/i);
    });

    test('ocUploaded suma las empresas que respondieron', () => {
        const model = buildModel({
            tenants: ['COPDAT', 'EMPRESA2'],
            ocUploadedByTenant: { COPDAT: 12, EMPRESA2: 3 },
            ledger: okLedger({ COPDAT: tenantLedger({}), EMPRESA2: tenantLedger({}) }),
            controlByTenant: { COPDAT: [], EMPRESA2: [] },
        });
        expect(model.counts.ocUploaded).toBe(15);
    });

    test('RD-09: un día sin fallos no tiene notas y su total es 0', () => {
        const model = buildModel({
            ocUploadedByTenant: { COPDAT: 5 },
            ledger: okLedger({ COPDAT: tenantLedger({ PY0001: ledgerEntry('uploaded') }) }),
        });
        expect(model.notes).toEqual([]);
        expect(model.incomplete).toBe(false);
        expect(model.pendingTotal).toBe(0);
        expect(model.counts).toEqual({ ocUploaded: 5, paymentsUploaded: 1, ocPending: 0, paymentsPending: 0, lastDay: 0 });
    });

    test('registro ausente → «Sin datos de pagos de ese día: no hay registro de la subida de pagos.», con las cifras de pagos en null', () => {
        const model = buildModel({ ledger: { status: 'missing', data: null } });
        expect(model.notes).toEqual(['Sin datos de pagos de ese día: no hay registro de la subida de pagos.']);
        expect(model.incomplete).toBe(true);
        expect(model.counts.paymentsUploaded).toBeNull();
        expect(model.counts.paymentsPending).toBeNull();
        expect(model.sections.rejected.groups).toEqual([]);
        expect(model.sections.sage.groups).toEqual([]);
    });

    test('registro dañado → «Sin datos de pagos de ese día: el registro de pagos no se pudo leer.»', () => {
        const model = buildModel({ ledger: { status: 'corrupt', data: null, error: 'JSON inválido' } });
        expect(model.notes).toEqual(['Sin datos de pagos de ese día: el registro de pagos no se pudo leer.']);
        expect(model.counts.paymentsUploaded).toBeNull();
        expect(model.counts.paymentsPending).toBeNull();
    });

    test('un ok sin la forma del registro, o una envoltura que no se reconoce, cuenta como registro ilegible', () => {
        const unreadable = 'Sin datos de pagos de ese día: el registro de pagos no se pudo leer.';
        for (const ledger of [
            { status: 'otro' },
            undefined,
            null,
            { status: 'ok', data: null },
            okLedger({ COPDAT: tenantLedger({}) }, {}, D_MINUS_1),
            { status: 'ok', data: { version: 1, date: D, tenants: [] } },
            { status: 'ok', data: { version: 2, date: D, tenants: {} } },
        ]) {
            const model = buildModel({ ledger });
            expect(model.notes).toEqual([unreadable]);
            expect(model.counts.paymentsPending).toBeNull();
        }
    });

    test('recoveredAt en la RAÍZ → «Datos de pagos incompletos: el registro se reinició a las 14:07.» y los pagos se listan', () => {
        const model = buildModel({
            ledger: okLedger(
                { COPDAT: tenantLedger({ PY0001: ledgerEntry('rejected', { code: '1827' }) }) },
                { recoveredAt: '2026-11-03T14:07:00' },
            ),
        });
        expect(model.notes).toEqual(['Datos de pagos incompletos: el registro se reinició a las 14:07.']);
        expect(model.incomplete).toBe(true);
        expect(allRows(model.sections.rejected).map((row) => row.docnbr)).toEqual(['PY0001']);
        expect(model.counts.paymentsPending).toBe(1);
    });

    test('un recoveredAt dentro de una empresa no es el contrato y no produce nota', () => {
        const model = buildModel({ ledger: okLedger({ COPDAT: tenantLedger({}, { recoveredAt: '2026-11-03T14:07:00' }) }) });
        expect(model.notes).toEqual([]);
    });

    test('empresa configurada ausente del registro → «Sin datos de pagos de COPDAT ese día.»', () => {
        const model = buildModel({
            tenants: ['COPDAT', 'EMPRESA2'],
            ledger: okLedger({ EMPRESA2: tenantLedger({}) }),
            controlByTenant: { COPDAT: [], EMPRESA2: [] },
        });
        expect(model.notes).toEqual(['Sin datos de pagos de COPDAT ese día.']);
        expect(model.counts.paymentsPending).toBe(0);
        expect(model.incomplete).toBe(true);
    });

    test('queryFailures 2 de 5 corridas → una nota que lo dice, con el último error', () => {
        const model = buildModel({
            ledger: okLedger({ COPDAT: tenantLedger({}, { runs: 5, queryFailures: 2, lastQueryError: 'Timeout: Request failed to complete in 180000ms' }) }),
        });
        expect(model.notes).toEqual(['La consulta de pagos de COPDAT falló en 2 de 5 corridas del día (último error: Timeout: Request failed to complete in 180000ms).']);
        expect(model.notes[0]).toContain('2 de 5');
    });

    test('oc-errors fallida → nota con la empresa y el error; si fue la única empresa, ocPending es null', () => {
        const model = buildModel({ sourceFailures: [{ tenant: 'COPDAT', source: 'oc-errors', error: "Invalid object name 'Autoriza_OC'" }] });
        expect(model.notes).toEqual(["No se pudieron leer las OCs con error de COPDAT: Invalid object name 'Autoriza_OC'."]);
        expect(model.counts.ocPending).toBeNull();
        expect(model.incomplete).toBe(true);
    });

    test('oc-errors de una de dos empresas → ocPending cuenta las OCs de la otra', () => {
        const model = buildModel({
            tenants: ['COPDAT', 'EMPRESA2'],
            ocRows: [ocRow({ tenant: 'EMPRESA2', idOrPo: 'PO0009' })],
            ledger: okLedger({ COPDAT: tenantLedger({}), EMPRESA2: tenantLedger({}) }),
            controlByTenant: { COPDAT: [], EMPRESA2: [] },
            sourceFailures: [{ tenant: 'COPDAT', source: 'oc-errors', error: 'Login failed for user' }],
        });
        expect(model.counts.ocPending).toBe(1);
        expect(model.notes).toEqual(['No se pudieron leer las OCs con error de COPDAT: Login failed for user.']);
    });

    test('oc-uploaded fallida → nota; si ninguna empresa respondió, ocUploaded es null', () => {
        const model = buildModel({
            ocUploadedByTenant: {},
            sourceFailures: [{ tenant: 'COPDAT', source: 'oc-uploaded', error: 'Login failed for user' }],
        });
        expect(model.counts.ocUploaded).toBeNull();
        expect(model.notes).toEqual(['No se pudieron contar las OCs subidas de COPDAT: Login failed for user.']);
    });

    test('payments-control fallida → nota de que algunos pagos pudieron subirse después, y esos pagos sí se listan', () => {
        const model = buildModel({
            ledger: okLedger({ COPDAT: tenantLedger({ PY0001: ledgerEntry('rejected', { code: '1827' }) }) }),
            controlByTenant: {},
            sourceFailures: [{ tenant: 'COPDAT', source: 'payments-control', error: 'Connection lost' }],
        });
        expect(model.notes).toEqual(['No se pudo leer la tabla de control de pagos de COPDAT: Connection lost. Algunos pagos de la lista pudieron subirse después.']);
        expect(allRows(model.sections.rejected).map((row) => row.docnbr)).toEqual(['PY0001']);
        expect(model.counts.paymentsPending).toBe(1);
    });

    test('cifras null: registro ilegible y todas las cuentas de OCs fallidas → «pagos sin datos» y «OCs sin datos»', () => {
        const model = buildModel({
            ledger: { status: 'corrupt', data: null, error: 'JSON inválido' },
            ocUploadedByTenant: {},
            sourceFailures: [{ tenant: 'COPDAT', source: 'oc-uploaded', error: 'Login failed for user' }],
        });
        expect(model.counts).toEqual({ ocUploaded: null, paymentsUploaded: null, ocPending: 0, paymentsPending: null, lastDay: 0 });
        const line = formatCountsLine(model);
        expect(line).toContain('OCs sin datos');
        expect(line).toContain('pagos sin datos');
        expect(line).toBe('El 2026-11-03 se subieron OCs sin datos y pagos sin datos; quedaron sin subir 0 OCs y pagos sin datos.');

        const nothing = buildModel({
            ledger: { status: 'missing', data: null },
            ocUploadedByTenant: {},
            sourceFailures: [
                { tenant: 'COPDAT', source: 'oc-errors', error: 'Login failed for user' },
                { tenant: 'COPDAT', source: 'oc-uploaded', error: 'Login failed for user' },
            ],
        });
        expect(nothing.counts).toEqual({ ocUploaded: null, paymentsUploaded: null, ocPending: null, paymentsPending: null, lastDay: null });
        expect(nothing.pendingTotal).toBe(0);
        expect(formatCountsLine(nothing)).toBe('El 2026-11-03 se subieron OCs sin datos y pagos sin datos; quedaron sin subir OCs sin datos y pagos sin datos.');
    });

    test('las entradas del registro que no se reconocen quedan en una nota en vez de perderse en silencio', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY0001: ledgerEntry('otro'),
                    PY0002: null,
                    PY0003: ledgerEntry('rejected', { code: '1827' }),
                }),
                RARO: 'no es un objeto',
            }),
        });
        expect(model.notes).toEqual(['Datos de pagos incompletos: 3 entradas del registro no se reconocieron.']);
        expect(allRows(model.sections.rejected).map((row) => row.docnbr)).toEqual(['PY0003']);
    });

    test('una empresa del registro sin tabla de control leída y sin falla anotada → nota de que algunos pagos pudieron subirse después', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({}),
                EMPRESA9: tenantLedger({ PY0001: ledgerEntry('rejected', { code: '1827' }) }),
            }),
            controlByTenant: { COPDAT: [] },
        });
        expect(model.notes).toEqual(['No se cruzaron los pagos de EMPRESA9 con la tabla de control: algunos pagos de la lista pudieron subirse después.']);
        expect(allRows(model.sections.rejected).map((row) => [row.tenant, row.docnbr])).toEqual([['EMPRESA9', 'PY0001']]);
    });
});

describe('buildDailySummaryModel: orden de D-24', () => {
    test('en OCs: último día, luego la fecha más vieja, luego documento y empresa', () => {
        const model = buildModel({
            ocRows: [
                ocRow({ idOrPo: 'PO0', fechaAuth: '2026-10-20' }),
                ocRow({ idOrPo: 'PO2', fechaAuth: '2026-10-10' }),
                ocRow({ idOrPo: 'PO1', fechaAuth: '2026-10-10', tenant: 'EMPRESA2' }),
                ocRow({ idOrPo: 'PO1', fechaAuth: '2026-10-10' }),
                ocRow({ idOrPo: 'PO3', fechaAuth: '2026-10-04' }),
            ],
        });
        expect(allRows(model.sections.oc).map((row) => [row.idOrPo, row.tenant, row.lastDay])).toEqual([
            ['PO3', 'COPDAT', true],
            ['PO1', 'COPDAT', false],
            ['PO1', 'EMPRESA2', false],
            ['PO2', 'COPDAT', false],
            ['PO0', 'COPDAT', false],
        ]);
    });

    test('en pagos: el de último día (2026-10-20) va antes que dos sin marca del 2026-10-10, y esos dos por documento', () => {
        // En OCs el renglón de último día siempre es el más viejo, porque la ventana las filtra.
        // El registro de pagos no se filtra: un pago intentado ese día con otra ventana (por
        // ejemplo, tras cambiar RETRY_LOOKBACK_DAYS y reiniciar) puede quedar antes del borde.
        // Con D = 2026-11-19 y 30 días, el borde es el 2026-10-20.
        const day = '2026-11-19';
        const model = buildModel({
            dateISO: day,
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY2: ledgerEntry('rejected', { code: '1827', fechaRegistro: '2026-10-10' }),
                    PY3: ledgerEntry('rejected', { code: '1827', fechaRegistro: '2026-10-20' }),
                    PY1: ledgerEntry('rejected', { code: '1827', fechaRegistro: '2026-10-10' }),
                }),
            }, {}, day),
        });
        expect(allRows(model.sections.rejected).map((row) => [row.docnbr, row.lastDay])).toEqual([
            ['PY3', true],
            ['PY1', false],
            ['PY2', false],
        ]);
    });

    test('los grupos van del más grande al más chico y, empatados, por título', () => {
        const model = buildModel({
            ocRows: [
                ocRow({ idOrPo: 'PO1', isValidation: 1 }),
                ocRow({ idOrPo: 'PO2', isValidation: 1 }),
                ocRow({ idOrPo: 'PO3', lastError: 'timeout of 30000ms exceeded' }),
                ocRow({ idOrPo: 'PO4' }),
            ],
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY1: ledgerEntry('no-response', { description: 'socket hang up' }),
                    PY2: ledgerEntry('rejected', { code: '1800' }),
                    PY3: ledgerEntry('rejected', { code: '1827' }),
                    PY4: ledgerEntry('rejected', { code: '1827' }),
                }),
            }),
        });
        expect(groupSummary(model.sections.oc)).toEqual([['Validación de datos', 2], ['Portal 1300', 1], ['Sin respuesta del portal', 1]]);
        expect(groupSummary(model.sections.rejected)).toEqual([['Portal 1827', 2], ['Portal 1800', 1], ['Sin respuesta del portal', 1]]);
    });

    test('un pago sin fecha de registro va al final de su grupo', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PY1: ledgerEntry('rejected', { code: '1827', fechaRegistro: null }),
                    PY2: ledgerEntry('rejected', { code: '1827', fechaRegistro: '2026-10-25' }),
                }),
            }),
        });
        expect(allRows(model.sections.rejected).map((row) => row.docnbr)).toEqual(['PY2', 'PY1']);
    });

    test('en proveedores sin ID: los pagos de cada uno con el mismo criterio, y el renglón con su fecha más vieja', () => {
        const model = buildModel({
            ledger: okLedger({
                COPDAT: tenantLedger({
                    PYA1: ledgerEntry('no-provider-id', { vendor: 'PROVA', fechaRegistro: '2026-10-20' }),
                    PYB2: ledgerEntry('no-provider-id', { vendor: 'PROVB', fechaRegistro: '2026-10-25' }),
                    PYB1: ledgerEntry('no-provider-id', { vendor: 'PROVB', fechaRegistro: '2026-10-15' }),
                }),
            }),
        });
        expect(allRows(model.sections.sage).map((row) => [row.vendor, row.payments.map((payment) => payment.docnbr)])).toEqual([
            ['PROVB', ['PYB1', 'PYB2']],
            ['PROVA', ['PYA1']],
        ]);
    });
});

describe('buildDailySummaryModel: contrato', () => {
    test('devuelve dateISO, counts, sections, notes, incomplete, pendingTotal y clock, con las tres secciones', () => {
        const model = buildModel();
        expect(Object.keys(model).sort()).toEqual(['clock', 'counts', 'dateISO', 'incomplete', 'notes', 'pendingTotal', 'sections']);
        expect(Object.keys(model.counts).sort()).toEqual(['lastDay', 'ocPending', 'ocUploaded', 'paymentsPending', 'paymentsUploaded']);
        expect(Object.keys(model.sections)).toEqual(['oc', 'rejected', 'sage']);
        expect(model.dateISO).toBe(D);
    });

    test('clock se copia tal cual', () => {
        const clock = { sqlDate: '2026-11-03', sqlNow: '2026-11-03 23:45:01', sqlOffsetMin: -360 };
        expect(buildModel({ clock }).clock).toBe(clock);
        expect(buildModel({ clock: null }).clock).toBeNull();
    });

    test('una dateISO que no es una fecha válida lanza: es un error de programación', () => {
        expect(() => buildModel({ dateISO: '2026-02-30' })).toThrow(/dateISO/);
        expect(() => buildModel({ dateISO: "2026-11-03'; DROP TABLE x --" })).toThrow(/dateISO/);
        expect(() => buildDailySummaryModel({})).toThrow(/dateISO/);
        expect(() => buildDailySummaryModel()).toThrow(/dateISO/);
    });

    test('no muta su entrada', () => {
        const input = {
            dateISO: D,
            retry: { scope: 'last_n_days', lookbackDays: 30 },
            tenants: ['COPDAT'],
            ocRows: [ocRow({ idOrPo: 'PO2' }), ocRow({ idOrPo: 'PO1', fechaAuth: '2026-10-04' })],
            ocUploadedByTenant: { COPDAT: 2 },
            ledger: okLedger({ COPDAT: tenantLedger({ ...PROVIDER_BLOCKS_3, PY0001: ledgerEntry('rejected', { code: '1827' }) }) }),
            controlByTenant: { COPDAT: ['PY9999'] },
            sourceFailures: [{ tenant: 'COPDAT', source: 'oc-uploaded', error: 'Login failed for user' }],
            clock: null,
        };
        const before = JSON.stringify(input);
        buildDailySummaryModel(input);
        expect(JSON.stringify(input)).toBe(before);
    });
});
