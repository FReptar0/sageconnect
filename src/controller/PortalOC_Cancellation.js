const axios = require('axios');
const dotenv = require('dotenv');

// carga las credenciales del portal de proveedores
const creds = dotenv.config({ path: '.env.credentials.focaltec' }).parsed;
const {
    TENANT_ID,
    API_KEY,
    API_SECRET,
    URL,
    DATABASES
} = creds;

// utilerías
const { runQuery } = require('../utils/SQLServerConnection');

// preparamos arrays de tenants/keys/etc.
const tenantIds = TENANT_ID.split(',');
const apiKeys = API_KEY.split(',');
const apiSecrets = API_SECRET.split(',');
const databases = DATABASES.split(',');


async function cancellationPurchaseOrders(index) {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // 1. Obtener órdenes de compra canceladas
    // TODO: Usar la query que Santiago nos pase el valor seran solo PONumbers
    const query = ``;

    let cancelledOrders;
    try {
        cancelledOrders = await runQuery(query, databases[index]);
    } catch (error) {
        console.error(`Error al ejecutar la consulta en el tenant ${tenantIds[index]}:`, error);
        return;
    }

    // 2. Comprobar si ya existe ese PONumber en fesaOCFocaltec
    for (let i = 0; i < cancelledOrders.length; i++) {
        const ponumber = cancelledOrders[i].PONUMBER.trim();

        const checkSql = `
      SELECT idFocaltec
      FROM dbo.fesaOCFocaltec
      WHERE ocSage    = '${ponumber}'
        AND idDatabase= '${databases[index]}'
        AND idFocaltec IS NOT NULL
        AND status = 'POSTED'
    `;

        let existingOrder;
        try {
            existingOrder = await runQuery(checkSql, databases[index]);
        } catch (error) {
            console.error(`Error al verificar la orden ${ponumber} en el tenant ${tenantIds[index]}:`, error);
            continue; // continuar con la siguiente orden
        }

        // 3. Si no existe, saltar a la siguiente orden
        if (existingOrder.length === 0) {
            console.log(`Orden ${ponumber} no encontrada en el tenant ${tenantIds[index]}, saltando...`);
            continue; // saltar a la siguiente orden
        }

        // 3.1 Cancelar en el portal de proveedores
        const endpoint = `${URL}/api/1.0/extern/tenants/${tenantIds[index]}/purchase-orders/${existingOrder[0].idFocaltec}/status`;
        const body = {
            status: 'CANCELLED'
        };

        try {
            const response = await axios.post(endpoint, body,
                {
                    headers: {
                        'PDPTenantKey': apiKeys[index],
                        'PDPTenantSecret': apiSecrets[index],
                        'Content-Type': 'application/json'
                    }
                })

            console.log(
                `📤 [${i + 1} / ${cancelledOrders.length}] PO ${ponumber} cancelada en el portal` +
                `▶ Status: ${response.status} ${response.statusText} - Tenant: ${tenantIds[index]}`
            )

        } catch (error) {
            console.error(`⚠ [${i + 1} / ${cancelledOrders.length}] Error al cancelar la PO ${ponumber} en el portal:`, error.message);
            console.error(`Detalles:`, error.response ? error.response.data : 'No response data');
            // Si hay un error al cancelar en el portal, no actualizamos la base de datos
            console.error(`La orden ${ponumber} no se actualizará a CANCELLED en la base de datos.`);
            continue; // continuar con la siguiente orden
        }

        // 3.2. Si la orden existe, actualizar el estado a 'CANCELLED'
        if (existingOrder.length > 0) {
            const updateSql = `
        UPDATE dbo.fesaOCFocaltec
        SET status = 'CANCELLED',
            lastUpdate = GETDATE()
        WHERE ocSage = '${ponumber}'
            AND idDatabase = '${databases[index]}'
            AND idFocaltec IS NOT NULL
            AND status = 'POSTED'
        `;

            try {
                await runQuery(updateSql, databases[index]);
                console.log(`Orden ${ponumber} actualizada a CANCELLED en el tenant ${tenantIds[index]}`);
            } catch (error) {
                console.error(`Error al actualizar la orden ${ponumber} en el tenant ${tenantIds[index]}:`, error);
            }

        }

    }
}

module.exports = {
    cancellationPurchaseOrders
};