// src/utils/parseExternPurchaseOrders.js

/**
 * Extrae dinámicamente todos los pares metadata_key_N / metadata_value_N
 * de un objeto PO agrupado.
 */
function extractMetadata(po) {
    return Object.keys(po)
        // buscamos solo las claves que empiecen por "metadata_key_"
        .filter(k => /^metadata_key_\d+$/.test(k))
        // ordenamos por el número N
        .sort((a, b) => {
            const na = Number(a.split('_').pop());
            const nb = Number(b.split('_').pop());
            return na - nb;
        })
        // mapeamos a { key, value }
        .map(keyName => {
            const idx = keyName.split('_').pop();
            const valueName = `metadata_value_${idx}`;
            const key = po[keyName];
            const value = po[valueName];
            return { key, value };
        })
        // filtramos entradas sin key o sin value
        .filter(m => m.key != null && m.key !== '');
}

/**
 * Toma un PO agrupado (output de groupOrdersByNumber)
 * y lo transforma al formato esperado por Joi/externPurchaseOrderRequest.
 */
function parseExternPurchaseOrder(po) {
    const addresses = [{
        city: po.addresses_city,
        country: po.addresses_country,
        exterior_number: po.addresses_exterior_number,
        identifier: po.addresses_identifier,
        interior_number: po.addresses_interior_number,
        municipality: po.addresses_municipality,
        state: po.addresses_state,
        street: po.addresses_street,
        suburb: po.addresses_suburb,
        type: po.addresses_type,
        zip_code: po.addresses_zip
    }];

    const metadata = extractMetadata(po);

    const lines = po.lines.map(line => ({
        budget_id: line.budget_id || '',
        budget_line_external_id: line.budget_line_external_id || '',

        code: String(line.code).trim(),
        description: String(line.description).trim(),
        external_id: String(line.external_id),
        num: line.num,

        quantity: line.quantity,
        unit_of_measure: line.unit_of_measure?.trim() || '',
        price: line.price,
        subtotal: line.subtotal,
        total: line.total,

        comments: line.comments || '',
        metadata: Array.isArray(line.metadata) ? line.metadata : [],

        vat_taxes: (Array.isArray(line.vat_taxes) ? line.vat_taxes : []).map(v => ({
            code: v.code,
            external_code: v.external_code,
            rate: v.rate,
            amount: v.amount,
            type: v.type
        })),

        withholding_taxes: (Array.isArray(line.withholding_taxes) ? line.withholding_taxes : []).map(w => ({
            code: w.code,
            external_code: w.external_code,
            rate: w.rate,
            amount: w.amount
        })),

        requisition_line_id: line.requisition_line_id || null
    }));

    return {
        acceptance_status: po.acceptance_status,
        company_external_id: po.company_external_id,
        exchange_rate: po.exchange_rate,
        reference: po.reference,
        external_id: po.external_id,
        num: po.num,
        status: po.status,

        date: po.date,
        delivery_date: po.delivery_date,
        delivery_contact: po.delivery_contact,
        requested_by_contact: po.requested_by_contact,

        cfdi_payment_form: po.cfdi_payment_form,
        cfdi_payment_method: po.cfdi_payment_method,
        cfdi_use: po.cfdi_use,

        comments: po.comments,
        currency: po.currency,

        addresses,
        lines,
        metadata,

        subtotal: po.subtotal,
        total: po.total,
        vat_sum: po.vat_sum,
        withhold_tax_sum: po.withhold_tax_sum,

        warehouse: po.warehouse,
        provider_external_id: po.provider_external_id,
        requisition_number: po.requisition_number
    };
}

/**
 * Transforma un arreglo de POs agrupados
 * al formato listo para validar/enviar.
 */
function parseExternPurchaseOrders(groupedOrders) {
    return groupedOrders.map(parseExternPurchaseOrder);
}

module.exports = {
    extractMetadata,
    parseExternPurchaseOrder,
    parseExternPurchaseOrders
};
