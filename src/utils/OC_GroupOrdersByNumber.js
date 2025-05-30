/**
 * Agrupa un arreglo de filas planas en órdenes con su array de líneas,
 * usando el campo NUM como clave y devolviendo el array ordenado por NUM.
 *
 * @param {Array<Object>} rows – resultado.recordset de runQuery()
 * @returns {Array<Object>} – arreglo de órdenes, cada una con .lines[]
 */
function groupOrdersByNumber(rows) {
    const ordersMap = {};

    rows.forEach(r => {
        // usar NUM (A.PONUMBER) como clave, limpiando espacios
        const key = (r.NUM ?? '').toString().trim();

        if (!ordersMap[key]) {
            // inicializar la orden sin los campos de línea
            const order = {};
            Object.entries(r).forEach(([col, val]) => {
                if (!col.startsWith('LINES_')) {
                    order[col.toLowerCase()] =
                        typeof val === 'string' ? val.trim() : val;
                }
            });
            order.lines = [];
            ordersMap[key] = order;
        }

        // extraer solo los campos de la línea
        const line = {};
        Object.entries(r).forEach(([col, val]) => {
            if (col.startsWith('LINES_')) {
                const field = col.slice('LINES_'.length).toLowerCase();
                line[field] = typeof val === 'string' ? val.trim() : val;
            }
        });

        ordersMap[key].lines.push(line);
    });

    // convertir a array y ordenar por el campo num
    return Object.values(ordersMap)
        .sort((a, b) => {
            const na = (a.num ?? '').toString();
            const nb = (b.num ?? '').toString();
            return na.localeCompare(nb);
        });
}

module.exports = {
    groupOrdersByNumber
};
