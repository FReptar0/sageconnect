// models/externPurchaseOrderRequest.js
const Joi = require('joi');

/** ------------------------------------------------------------------------
 * Esquema de direcciones (BatchAddressRequest)
 * ------------------------------------------------------------------------ */
const addressSchema = Joi.object({
    city: Joi.string().max(100).allow('', null),
    country: Joi.string().max(100).allow('', null),
    exterior_number: Joi.string().max(100).allow('', null),
    identifier: Joi.string().max(100).allow('', null),
    interior_number: Joi.string().max(100).allow('', null),
    municipality: Joi.string().max(100).allow('', null),
    state: Joi.string().max(100).allow('', null),
    street: Joi.string().max(100).required(),
    suburb: Joi.string().max(100).allow('', null),
    type: Joi.string().valid('BILLING', 'SHIPPING').required(),
    zip_code: Joi.string().pattern(/^\d{5}$/).allow('', null)
}).required();

/** ------------------------------------------------------------------------
 * Metadata genérico
 * ------------------------------------------------------------------------ */
const metadataSchema = Joi.object({
    key: Joi.string().required(),
    value: Joi.string().required()
});

/** ------------------------------------------------------------------------
 * Impuestos trasladados (vat_taxes)
 * ------------------------------------------------------------------------ */
const vatTaxSchema = Joi.object({
    code: Joi.string().required(),
    external_code: Joi.string().required(),
    rate: Joi.number().min(0).required(),
    amount: Joi.number().min(0).required(),
    type: Joi.string().valid('TRANSFERRED', 'WITHHELD').required()
});

/** ------------------------------------------------------------------------
 * Impuestos retenidos (withholding_taxes)
 * ------------------------------------------------------------------------ */
const withholdingTaxSchema = Joi.object({
    code: Joi.string().required(),
    external_code: Joi.string().required(),
    rate: Joi.number().min(0).required(),
    amount: Joi.number().min(0).required()
});

/** ------------------------------------------------------------------------
 * Cada línea de la orden (BatchPurchaseOrderLineRequest)
 * ------------------------------------------------------------------------ */
const lineItemSchema = Joi.object({
    budget_id: Joi.string().allow('', null),
    budget_line_external_id: Joi.string().allow('', null),

    code: Joi.string().required(),
    description: Joi.string().max(250).required(),
    external_id: Joi.string().required(),
    num: Joi.number().integer().allow(null),

    quantity: Joi.number().greater(0).required(),
    unit_of_measure: Joi.string().allow('', null),
    price: Joi.number().precision(2).min(0).required(),
    subtotal: Joi.number().precision(2).min(0).required(),
    total: Joi.number().precision(2).min(0).required(),

    comments: Joi.string().allow('', null),
    metadata: Joi.array().items(metadataSchema).default([]),

    vat_taxes: Joi.array().items(vatTaxSchema).default([]),
    withholding_taxes: Joi.array().items(withholdingTaxSchema).default([]),

    requisition_line_id: Joi.string().allow('', null)
}).required();

/** ------------------------------------------------------------------------
 * Esquema principal: ExternPurchaseOrderRequest
 * ------------------------------------------------------------------------ */
const externPurchaseOrderSchema = Joi.object({
    acceptance_status: Joi.string()
        .valid('ACCEPTED', 'REFUSED', 'PENDING_TO_REVIEW')
        .default('ACCEPTED'),
    company_external_id: Joi.string().allow('', null),
    exchange_rate: Joi.number().precision(6).min(0).allow(null),
    reference: Joi.string().max(100).allow('', null),

    external_id: Joi.string().required(),
    num: Joi.string().allow('', null),
    status: Joi.string()
        .valid('OPEN', 'CANCELLED', 'GENERATED', 'CLOSED')
        .required(),

    date: Joi.date().iso().required(),
    delivery_date: Joi.date().iso().required(),
    delivery_contact: Joi.string().required(),
    requested_by_contact: Joi.string().required(),

    cfdi_payment_form: Joi.string()
        .valid('F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F08',
            'F12', 'F13', 'F14', 'F15', 'F17', 'F23', 'F24',
            'F25', 'F26', 'F27', 'F28', 'F29', 'F30', 'F99')
        .allow('', null),
    cfdi_payment_method: Joi.string().valid('PPD', 'PUE').allow('', null),
    cfdi_use: Joi.string()
        .valid('G01', 'G02', 'G03', 'I01', 'I02', 'I03', 'I04',
            'I05', 'I06', 'I07', 'I08', 'D01', 'D02', 'D03',
            'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10',
            'P01')
        .allow('', null),

    comments: Joi.string().max(512).allow('', null),
    currency: Joi.string().length(3).required(),

    addresses: Joi.array().items(addressSchema).min(1).required(),
    lines: Joi.array().items(lineItemSchema).min(1).required(),

    metadata: Joi.array().items(metadataSchema).default([]),

    subtotal: Joi.number().precision(2).min(0).required(),
    total: Joi.number().precision(2).min(0).required(),
    vat_sum: Joi.number().precision(2).min(0).default(0),
    withhold_tax_sum: Joi.number().precision(2).default(0),

    warehouse: Joi.string().allow('', null),
    provider_external_id: Joi.string().max(50).required(),
    requisition_number: Joi.number().integer().allow(null)
})
    .required();

/**
 * Función de validación
 */
function validateExternPurchaseOrder(data) {
    const { value, error } = externPurchaseOrderSchema.validate(data, {
        abortEarly: false,
        convert: true
    });
    if (error) throw error;
    return value;
}

module.exports = {
    externPurchaseOrderSchema,
    validateExternPurchaseOrder
};
