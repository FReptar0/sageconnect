// RETRY-D1 / RETRY-D2 / RETRY-D8 (Phase 20.3): sonda de existencia en el portal para órdenes de
// compra. Es el PRIMER GET de purchase-orders del codebase — los doce call sites existentes son
// POST o PUT, así que hasta ahora la única fuente de "¿ya existe esta OC?" era la tabla de control
// local. Cuando el portal aceptó la OC pero se perdió el acuse, la tabla local queda toda en ERROR,
// el cron vuelve a hacer POST, el portal responde 409, se escribe otra fila ERROR y el ciclo se
// sostiene solo. Este helper es la segunda opinión que faltaba.
//
// Contrato de tres resultados discriminados (CONTEXT D-04): "portal inalcanzable" NUNCA puede
// leerse como "la OC no existe" — esa confusión es exactamente la que produce el POST duplicado.
// La guarda de forma sobre el id que devuelve el portal vive AQUÍ (CONTEXT D-05), no en el
// controlador, para que ningún consumidor pueda llegar a sostener un id malformado.

const config = require('../config');
const portalClient = require('./PortalClient');
const { logGenerator } = require('./LogGenerator');

const url = config.portal.url;

// Arrays para soportar múltiples tenants — mismo shape que GetProviders.js:9-11 y
// PortalOC_Creator.js:24-28. Son constantes evaluadas una sola vez al cargar el módulo, derivadas
// de config: no son caches, no crecen y no hay nada que liberar entre ticks (CLAUDE.md §3).
const tenantIds = config.portal.tenants.map(t => t.id);
const apiKeys = config.portal.tenants.map(t => t.key);
const apiSecrets = config.portal.tenants.map(t => t.secret);

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/purchase-orders`;

// Forma del idFocaltec que documenta el runbook de acuse perdido: 24 hexadecimales.
// SIN flag `g`, a propósito: RegExp.prototype.test sobre una regex global avanza y conserva
// lastIndex entre llamadas, y este proceso nunca termina entre ticks del cron (CLAUDE.md §3) —
// una llamada de cada dos devolvería false para un id perfectamente válido. Fallo silencioso,
// el enemigo documentado de este codebase.
const ID_FOCALTEC_SHAPE = /^[0-9a-fA-F]{24}$/;

/**
 * Pregunta al portal si ya tiene una orden de compra con este external id (RETRY-D1).
 *
 * Devuelve SIEMPRE uno de tres objetos discriminados. Nunca lanza, nunca devuelve un valor nulo:
 *
 *   { outcome: 'found',   id, status }  200 con exactamente un match exacto cuyo id pasa la guarda
 *                                       de forma. `status` es el valor crudo del portal, recortado
 *                                       y SIN normalizar: el enum es OPEN | CANCELLED | GENERATED |
 *                                       CLOSED y RETRY-D7 exige que un valor no reconocido se
 *                                       maneje explícito en el controlador, no que se difumine aquí.
 *   { outcome: 'absent' }               200 con un arreglo `items` y cero matches exactos. Sin
 *                                       ninguna otra clave.
 *   { outcome: 'unknown', reason }      todo lo demás. `reason` es una de cinco constantes cortas:
 *                                         'empty-external-id'  externalId vacío — NO se emitió HTTP
 *                                         'ambiguous'          200 con más de un match exacto
 *                                         'invalid-id'         200, un match, id fuera de forma
 *                                         'malformed-response' 200 cuyo cuerpo no trae un arreglo
 *                                                              `items`: no prueba ausencia
 *                                         'request-failed'     el GET se rechazó: 4xx, 5xx, corte de
 *                                                              red, expiración — CUALQUIER no-200
 *
 * RETRY-D2: un GET rechazado JAMÁS produce 'absent'. Solo un 200 cuyo arreglo `items` no traiga
 * ningún match exacto significa que la OC no está en el portal; un cuerpo sin ese arreglo tampoco
 * lo prueba. `getProviderByExternalId` colapsa todo eso en el mismo valor (GetProviders.js:87 y
 * :101) — esa es precisamente la conflación prohibida aquí.
 *
 * RETRY-D8 / CONTEXT D-05: el id del portal se valida contra la forma de 24 hexadecimales ANTES de
 * salir de esta función, así que ningún consumidor puede recibir un valor capaz de llegar a un
 * string SQL interpolado (runQuery no parametriza — CLAUDE.md §6 #1 y #2).
 *
 * Emite exactamente un GET por llamada, sin reintentos internos y sin fijar su propio límite de
 * espera: el singleton PortalClient aporta los 30 s de config.portal.httpTimeoutMs, y con eso la
 * invariante de defensa en profundidad de CLAUDE.md §9 se sostiene sola.
 *
 * @param {number} index - Índice del tenant a consultar.
 * @param {string} externalId - ocSage de la orden de compra; se recorta antes de usarse (nchar).
 * @returns {Promise<{outcome: string, id?: string, status?: string, reason?: string}>}
 */
async function getPurchaseOrderByExternalId(index, externalId) {
    const logFileName = 'GetPurchaseOrders';
    // S-3: el cuerpo entero va dentro del try. Una excepción aquí abortaría el tick del cron a
    // media tanda en un servicio always-on; el contrato es devolver un valor, nunca lanzar.
    try {
        const externalIdClean = (externalId || '').trim();
        if (!externalIdClean) {
            console.warn('[WARN] Empty externalId provided');
            logGenerator(logFileName, 'warn', 'Empty externalId provided');
            return { outcome: 'unknown', reason: 'empty-external-id' };
        }

        const response = await portalClient.get(
            urlBase(index) + `?external_ids=${encodeURIComponent(externalIdClean)}&pageSize=1&offset=0`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        // RETRY-D2, segunda mitad: un 200 cuyo cuerpo no trae un arreglo `items` no prueba ausencia
        // — no prueba nada. Colapsarlo con `|| []` lo convertía en 'absent', el ÚNICO desenlace que
        // autoriza el POST del controlador, así que una página de login servida tras un 302, un
        // sobre {code,description} con status 200 o un `items: null` junto a un `total: 7` producían
        // el mismo POST duplicado que esta fase existe para cortar. Fail-closed: si el cuerpo no es
        // legible, el desenlace es 'unknown'.
        const body = response && response.data;
        if (!body || !Array.isArray(body.items)) {
            console.warn(`[WARN] Malformed portal body for externalId: ${externalIdClean}`);
            logGenerator(logFileName, 'warn', `Malformed portal body for externalId: ${externalIdClean}`);
            return { outcome: 'unknown', reason: 'malformed-response' };
        }

        // Re-filtro exacto del lado del cliente: NO se lee response.data.total ni se confía en el
        // filtro del API (GetProviders.js:79-82 hace lo mismo deliberadamente, y RETRY-D2 lo exige).
        // Recortar AMBOS lados es load-bearing: ocSage es nchar rellenado con espacios y la consulta
        // del creador emite RTRIM(A.PONUMBER).
        const items = body.items;
        const exactMatches = items.filter(item => {
            const currentExternalId = (item.external_id || '').toString().trim();
            return currentExternalId === externalIdClean;
        });

        if (exactMatches.length === 0) {
            console.log(`[INFO] No purchase order found with externalId: ${externalIdClean}`);
            logGenerator(logFileName, 'info', `No purchase order found with externalId: ${externalIdClean}`);
            return { outcome: 'absent' };
        }

        // Con un tamaño de página de uno el portal no debería devolver dos items. La guarda se queda:
        // es la defensa contra un portal que ignore el parámetro, y es alcanzable en Jest. No es
        // código muerto.
        if (exactMatches.length > 1) {
            console.warn(`[WARN] Ambiguous purchase order search by externalId "${externalIdClean}": ${exactMatches.length} matches`);
            logGenerator(logFileName, 'warn', `Ambiguous purchase order search by externalId "${externalIdClean}": ${exactMatches.length} matches`);
            return { outcome: 'unknown', reason: 'ambiguous' };
        }

        const match = exactMatches[0];
        const foundId = String(match.id == null ? '' : match.id).trim();
        if (!ID_FOCALTEC_SHAPE.test(foundId)) {
            // T-20.3-06: NO se interpola el id rechazado. Es texto influenciable desde fuera y el
            // log de winston es la bitácora de auditoría; se registra la OC y el hecho, nada más.
            console.warn(`[WARN] Portal id shape check failed for externalId: ${externalIdClean}`);
            logGenerator(logFileName, 'warn', `Portal id shape check failed for externalId: ${externalIdClean}`);
            return { outcome: 'unknown', reason: 'invalid-id' };
        }

        // El status se recorta pero NO se normaliza a mayúsculas: normalizarlo convertiría en
        // silencio una variante no reconocida en una reconocida, justo lo que RETRY-D7 prohíbe.
        return {
            outcome: 'found',
            id: foundId,
            status: String(match.status == null ? '' : match.status).trim()
        };
    } catch (error) {
        const externalIdClean = (externalId || '').trim();
        // Defensa always-on: un rechazo con un valor sin `.message` haría estallar el propio catch
        // y la excepción escaparía del helper, matando el tick.
        const detail = (error && error.message) ? error.message : String(error);
        console.error(`[ERROR] Error fetching purchase order by externalId ${externalIdClean}:`, detail);
        logGenerator(logFileName, 'error', `Error fetching purchase order by externalId ${externalIdClean}: ${detail}`);
        // RETRY-D2: aquí NUNCA 'absent'. GetProviders.js:101 devuelve en este punto el mismo valor
        // que para "no encontrado"; esa conflación es la que esta fase existe para prohibir.
        return { outcome: 'unknown', reason: 'request-failed' };
    }
}

module.exports = { getPurchaseOrderByExternalId };
