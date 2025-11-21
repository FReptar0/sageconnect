// tests/GetPaymentCFDI.test.js - Unit tests for Payment CFDI (Type P) fetching
const axios = require('axios');
require('dotenv').config({ path: '.env.credentials.focaltec' });
const { logGenerator } = require('../src/utils/LogGenerator');

const url = process.env.URL;
const tenantIds = process.env.TENANT_ID.split(',');
const apiKeys = process.env.API_KEY.split(',');
const apiSecrets = process.env.API_SECRET.split(',');

const urlBase = (index) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/cfdis`;
const urlPayments = (index, paymentId) => `${url}/api/1.0/extern/tenants/${tenantIds[index]}/payments/${paymentId}`;

async function getTypePTest(index) {
    const logFileName = 'GetTypePTest';
    let date = new Date();
    let dateFrom = new Date(date.setMonth(date.getMonth() - 1)).toISOString().slice(0, 7);
    let dateUntil = new Date().toISOString().slice(0, 10);

    try {
        const response = await axios.get(
            urlBase(index) +
            `?to=${dateUntil}` +
            `&from=${dateFrom}-01` +
            `&documentTypes=CFDI` +
            `&offset=0&pageSize=0` +
            `&cfdiType=PAYMENT_CFDI`,
            {
                headers: {
                    'PDPTenantKey': apiKeys[index],
                    'PDPTenantSecret': apiSecrets[index]
                }
            }
        );

        if (response.data.total === 0) {
            console.log('[INFO] No hay CFDI de tipo P');
            return [];
        }

        const data = [];
        for (const item of response.data.items) {
            if (!item.metadata.payment_info || item.metadata.payment_info.payments.length === 0) {
                if (item.payment_complement_info && item.payment_complement_info[0].payment_id) {
                    const paymentId = item.payment_complement_info[0].payment_id;
                    try {
                        const paymentResponse = await axios.get(
                            urlPayments(index, paymentId),
                            {
                                headers: {
                                    'PDPTenantKey': apiKeys[index],
                                    'PDPTenantSecret': apiSecrets[index]
                                }
                            }
                        );

                        if (paymentResponse.data) {
                            item.metadata.payment_info = {
                                payments: [
                                    {
                                        external_id: paymentResponse.data.external_id
                                    }
                                ]
                            };
                        }
                    } catch (error) {
                        console.log(`[ERROR] No se pudo obtener información del pago con ID ${paymentId}:`, error.message);
                        logGenerator(logFileName, 'error', `Error al obtener información del pago con ID ${paymentId}: ${error.message}`);
                        continue;
                    }
                } else {
                    console.log(`[INFO] UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos ni payment_id`);
                    logGenerator(logFileName, 'info', `UUID ${item.cfdi.timbre.uuid} eliminado por no tener pagos ni payment_id`);
                    continue;
                }
            }

            data.push(item);
        }

        console.log('[INFO] CFDI de tipo P procesados:', data);
        return data;
    } catch (error) {
        console.log('[ERROR] Error al obtener CFDI de tipo P:', error.message);
        logGenerator(logFileName, 'error', `Error al obtener CFDI de tipo P: ${error.message}`);
        return [];
    }
}

// Auto-execution commented out - use src/scripts/get-payment-cfdis.js for CLI execution
// (async () => {
//     const index = 0; // Cambiar según el tenant deseado
//     const result = await getTypePTest(index);
//     console.log('[RESULT] Resultado final:', JSON.stringify(result, null, 2));
// })();

const { describe, it, expect } = require('@jest/globals');

jest.mock('axios');

describe('getTypePTest', () => {
    it('debería devolver un array vacío si no hay CFDI de tipo P', async () => {
        axios.get.mockResolvedValueOnce({ data: { total: 0, items: [] } });

        const result = await getTypePTest(0);
        expect(result).toEqual([]);
    });

    it('debería procesar correctamente los CFDI de tipo P con información de pago', async () => {
        const mockData = {
            data: {
                total: 1,
                items: [
                    {
                        metadata: {
                            payment_info: {
                                payments: [{ external_id: '12345' }]
                            }
                        },
                        cfdi: {
                            timbre: {
                                uuid: 'uuid-12345'
                            }
                        }
                    }
                ]
            }
        };

        axios.get.mockResolvedValueOnce(mockData);

        const result = await getTypePTest(0);
        expect(result).toEqual(mockData.data.items);
    });

    it('debería manejar errores al obtener información de pagos', async () => {
        axios.get.mockRejectedValueOnce(new Error('Error de red'));

        const result = await getTypePTest(0);
        expect(result).toEqual([]);
    });
});
