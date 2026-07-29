/**
 * Guardas estructurales del cableado de la sonda de existencia en el portal.
 * Fase 20.3 — RETRY-D2, RETRY-D4, RETRY-D6, RETRY-D7, RETRY-D8 (CONTEXT D-01, D-02, D-06).
 *
 * Por qué son aserciones sobre el TEXTO del fuente y no casos con dobles en tiempo de ejecución
 * (patrón S-6): todo lo que se prueba aquí es la AUSENCIA de código — que no se emite ninguna
 * sentencia de actualización contra la tabla de control, que no se añadió ninguna primitiva
 * retenida, que la firma de runQuery no se movió, que el conjunto de etiquetas no creció. Una
 * ausencia no se puede probar ejercitando el módulo: un doble que nunca recibe la llamada prohibida
 * hace que la aserción pase por construcción, es decir, es una tautología. Leer el fuente literal es
 * la única forma de que la guarda detecte la regresión que existe para detectar.
 *
 * Precedente hermano en este repo: tests/utils/GetProviders.test.js:65-73, que a su vez espeja
 * tests/services/CronScheduler.timeout-listener.test.js:297-303.
 *
 * Alcance de ESTE archivo por ahora: solo estructura. Los casos de comportamiento que recorren la
 * tabla de seis filas del despacho (found/absent/cancelled/unknown/ambiguous y la línea de resumen)
 * llegan con el plan 20.3-04 y se añaden como un SEGUNDO bloque describe al final, debajo de éste.
 */

const { describe, test, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

const CONTROLLER_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controller', 'PortalOC_Creator.js'), 'utf8');
const PROBE_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'GetPurchaseOrders.js'), 'utf8');
const SQLCONN_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'utils', 'SQLServerConnection.js'), 'utf8');

const countOf = (src, re) => (src.match(re) || []).length;

describe('PortalOC_Creator — guardas estructurales de la sonda de existencia (Fase 20.3)', () => {

    test('Guarda 1 (RETRY-D6, aceptación #12): ningún camino de código actualiza la tabla de control', () => {
        // El detect-and-seed del runbook de acuse perdido SIEMBRA una fila nueva; jamás reescribe
        // las históricas. En producción hay 3,313 filas ERROR acumuladas, no hay staging y no hay
        // rollback: una actualización masiva mal apuntada no se deshace. La guarda es case-insensitive
        // para que ni `update` en minúscula pase.
        expect(CONTROLLER_SRC).not.toMatch(/UPDATE\s+fesa\.dbo\.fesaOCFocaltec/i);
    });

    test('Guarda 2 (CLAUDE.md §6 #2): cuatro sitios de escritura y los cuatro pasan el literal FESA', () => {
        // Tres preexistentes (fallo de Joi, POST exitoso, POST fallido) más el de reconciliación.
        // Si este número sube sin que suba el de abajo, alguien añadió una escritura que va a caer en
        // la base por defecto de runQuery en vez de en FESA — el modo de falla exacto de PR #16, que
        // rompió 7 llamadores al cambiar un valor por defecto implícito.
        expect(countOf(CONTROLLER_SRC, /INSERT INTO fesa\.dbo\.fesaOCFocaltec/g)).toBe(4);
        expect(countOf(CONTROLLER_SRC, /runQuery\([A-Za-z]+,\s*'FESA'\)/g)).toBe(4);
        // La única llamada restante del archivo es el SELECT por tenant, que pasa databases[index].
        // El valor por defecto implícito no debe aparecer nunca escrito en este controlador.
        expect(CONTROLLER_SRC).not.toMatch(/config\.database\.database/);
    });

    test('Guarda 3 (CONTEXT D-01): la sonda corre ANTES de la validación Joi', () => {
        // El camino de fallo de Joi inserta una fila ERROR. Preguntarle al portal después de eso
        // significaría fabricar exactamente el ruido que esta fase existe para eliminar, y además
        // inflaría el propio errorCount que abre la compuerta — un bucle que se realimenta.
        // Se comparan las formas de LLAMADA, no los identificadores pelados: si se compararan los
        // identificadores, la línea de require del inicio del archivo satisfaría la guarda sola.
        const probeAt = CONTROLLER_SRC.indexOf('getPurchaseOrderByExternalId(');
        const joiAt = CONTROLLER_SRC.indexOf('validateExternPurchaseOrder(po)');
        expect(probeAt).toBeGreaterThan(-1);
        expect(joiAt).toBeGreaterThan(-1);
        expect(probeAt).toBeLessThan(joiAt);
    });

    test('Guarda 4 (CLAUDE.md §3, aceptación #14): no se añadió ninguna primitiva always-on', () => {
        // El servicio no termina entre ticks del cron, así que cualquier temporizador, listener o
        // colección en scope de módulo crece sin cota para siempre. El lookup de errorCount es un Map
        // function-scoped: se comprueba que la PRIMERA aparición de `new Map(` esté DESPUÉS de la
        // declaración de la función, que es la diferencia entre "se recolecta al retornar" y "vive lo
        // que viva el proceso".
        expect(CONTROLLER_SRC).not.toMatch(/setInterval/);
        expect(CONTROLLER_SRC).not.toMatch(/setTimeout/);
        expect(CONTROLLER_SRC).not.toMatch(/new Set\(/);
        expect(CONTROLLER_SRC).not.toMatch(/\.addListener\(/);
        const mapAt = CONTROLLER_SRC.indexOf('new Map(');
        const fnAt = CONTROLLER_SRC.indexOf('async function createPurchaseOrders');
        expect(mapAt).toBeGreaterThan(-1);
        expect(fnAt).toBeGreaterThan(-1);
        expect(mapAt).toBeGreaterThan(fnAt);
    });

    test('Guarda 5 (aceptación #13): la firma de runQuery sigue intacta y sigue sin parametrizar', () => {
        // El punto es la INMUTABILIDAD de la firma, no su formato concreto: runQuery lo comparte todo
        // el codebase y cambiar su valor por defecto es la trampa documentada de CLAUDE.md §6 #2.
        // Esta fase resuelve la inyección aguas arriba (la forma de 24 hexadecimales validada dentro
        // de la propia sonda), justamente para no tener que tocar esta utilería compartida.
        expect(SQLCONN_SRC).toMatch(/async function runQuery\(query, database = config\.database\.database\)/);
        // La ausencia de enlace de parámetros es la PREMISA de la guarda de valor de RETRY-D8. Si algún
        // día aparece, la guarda de forma deja de ser la única defensa y este comentario deja de ser
        // cierto — que es exactamente cuando conviene que esta aserción falle y obligue a releerlo.
        expect(SQLCONN_SRC).not.toMatch(/request\.input\(/);
    });

    test('Guarda 6 (CLAUDE.md §9): la sonda se requiere y se llama exactamente una vez', () => {
        // Un solo sitio de llamada dentro del bucle acota el gasto HTTP a un GET por OC ya fallida y
        // por tick. Si se duplicara el sitio de llamada, el primer tick tras el despliegue podría
        // desbordar el techo de 5 minutos de STEP_TIMEOUT_MS contra el rezago acumulado de ERRORes.
        expect(CONTROLLER_SRC).toMatch(/require\(['"]\.\.\/utils\/GetPurchaseOrders['"]\)/);
        expect(countOf(CONTROLLER_SRC, /getPurchaseOrderByExternalId\(/g)).toBe(1);
    });

    test('Guarda 7 (RETRY-D2, con el alcance corregido): el camino de OCs no usa id_type', () => {
        // La aceptación original del SPEC decía "id_type=EXTERNAL no aparece en ninguna parte de src/".
        // Eso era insatisfacible desde el día uno: src/scripts/payment-status-check.js:10 y :78 ya lo
        // usan contra el endpoint de PAGOS, que esta fase no toca. La guarda se acota al camino de
        // órdenes de compra, que es lo que el requisito quiere decir en realidad: la existencia se lee
        // del cuerpo de un 200 filtrado por external id, no de un endpoint de búsqueda por tipo de id.
        expect(CONTROLLER_SRC).not.toMatch(/id_type/);
        expect(PROBE_SRC).not.toMatch(/id_type/);
    });

    test('Guarda 8 (RETRY-D2): un solo external id por petición, sin lotes', () => {
        // Preguntar por una OC a la vez es lo que hace que "el portal no contestó" sea imposible de
        // confundir con "la OC no existe". Un lote separado por comas devolvería un 200 parcial del que
        // no se puede deducir la ausencia de cada id individual — y esa confusión es precisamente la
        // que produce el POST duplicado que esta fase elimina.
        expect(countOf(PROBE_SRC, /external_ids=/g)).toBe(1);
        expect(PROBE_SRC).not.toMatch(/external_ids=\$\{[^}]*join\(/);
    });

    test('Guarda 9 (CONTEXT D-06): exactamente dos etiquetas, y el resultado viaja en un campo', () => {
        // D-06: el desenlace va en un campo `result=`, NO en la etiqueta. Así el conjunto de etiquetas
        // no puede crecer conforme se añaden ramas, y el operador tiene un solo prefijo que buscar.
        // La aserción negativa es la que hace el trabajo: prohíbe cualquier etiqueta hermana del estilo
        // [PORTAL-CHECK-FOUND] o [PORTAL-CHECK-SKIP], dejando pasar únicamente la de resumen.
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK\]/);
        expect(CONTROLLER_SRC).toMatch(/\[PORTAL-CHECK-SUMMARY\]/);
        expect(CONTROLLER_SRC).not.toMatch(/\[PORTAL-CHECK-(?!SUMMARY)[A-Z-]+\]/);
    });
});
