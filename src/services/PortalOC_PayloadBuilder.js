// src/services/PortalOC_PayloadBuilder.js

const { runQuery } = require('../utils/SQLServerConnection');
const { getCurrentDateString } = require('../utils/TimezoneHelper');
const { logGenerator } = require('../utils/LogGenerator');
const { groupOrdersByNumber } = require('../utils/OC_GroupOrdersByNumber');
const { parseExternPurchaseOrders } = require('../utils/parseExternPurchaseOrders');
const { validateExternPurchaseOrder } = require('../models/PurchaseOrder');

/**
 * Service for building Portal de Proveedores payloads
 * Shared between creation and update operations
 */
class PortalOCPayloadBuilder {
    constructor(config) {
        this.databases = config.databases;
        this.externalIds = config.externalIds;
        this.addressConfig = config.addressConfig;
    }

    /**
     * Get purchase orders data from Sage with optional quantity adjustments
     * @param {number} dbIndex - Database index
     * @param {string} whereCondition - Additional WHERE condition for SQL
     * @param {boolean} adjustForCancellations - If true, adjusts quantities for cancellations
     * @returns {Array} Purchase order records
     */
    async getPurchaseOrdersData(dbIndex, whereCondition = '', adjustForCancellations = false) {
        const today = getCurrentDateString();
        const database = this.databases[dbIndex];
        const externalId = this.externalIds[dbIndex];

        // Prepare location skip filter
        const skipIdentifiers = this.addressConfig.ADDRESS_IDENTIFIERS_SKIP.split(',')
            .map(id => id.trim()).filter(id => id.length > 0);
        const skipCondition = skipIdentifiers.length > 0 
            ? `AND B.[LOCATION] NOT IN (${skipIdentifiers.map(id => `'${id}'`).join(',')})` 
            : '';

        // Adjust quantity field based on cancellations
        const quantityField = adjustForCancellations 
            ? '(B.SQORDERED - B.OQCANCELED)' 
            : 'B.SQORDERED';

        const sql = `
        SELECT 
          'ACCEPTED' as ACCEPTANCE_STATUS,
          ISNULL(RTRIM(F.CITY),'${this.addressConfig.DEFAULT_ADDRESS_CITY}') as [ADDRESSES_CITY],
          ISNULL(RTRIM(F.COUNTRY),'${this.addressConfig.DEFAULT_ADDRESS_COUNTRY}') as [ADDRESSES_COUNTRY],
          '' as [ADDRESSES_EXTERIOR_NUMBER],
          ISNULL(RTRIM(F.[LOCATION]),'${this.addressConfig.DEFAULT_ADDRESS_IDENTIFIER}') as [ADDRESSES_IDENTIFIER],
          '' as [ADDRESSES_INTERIOR_NUMBER],
          ISNULL(RTRIM(F.ADDRESS2),'${this.addressConfig.DEFAULT_ADDRESS_MUNICIPALITY}') as [ADDRESSES_MUNICIPALITY],
          ISNULL(RTRIM(F.[STATE]),'${this.addressConfig.DEFAULT_ADDRESS_STATE}') as [ADDRESSES_STATE],
          ISNULL(RTRIM(F.ADDRESS1),'${this.addressConfig.DEFAULT_ADDRESS_STREET}') as [ADDRESSES_STREET],
          '' as [ADDRESSES_SUBURB],
          'SHIPPING' as [ADDRESSES_TYPE],
          ISNULL(RTRIM(F.ZIP),'${this.addressConfig.DEFAULT_ADDRESS_ZIP}') as [ADDRESSES_ZIP],
          'F' + LEFT(
            (SELECT RTRIM(VDESC)
               FROM ${database}.dbo.CSOPTFD
              WHERE OPTFIELD = 'METODOPAGO'
                AND VALUE    = E2.[VALUE]
            ), 2
          ) as [CFDI_PAYMENT_FORM],
          '' as [CFDI_PAYMENT_METHOD],
          UPPER(RTRIM(C2.[VALUE])) as [CFDI_USE],
          RTRIM(A.DESCRIPTIO) + ' ' + RTRIM(A.COMMENT) as [COMMENTS],
          '${externalId}' as [COMPANY_EXTERNAL_ID],
          CASE WHEN RTRIM(A.CURRENCY)='MXP' THEN 'MXN' ELSE RTRIM(A.CURRENCY) END as [CURRENCY],
          CAST(
            SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
            SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
            SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
          AS DATE) as [DATE],
          RTRIM(A.FOBPOINT) as [DELIVERY_CONTACT],
          CASE WHEN A.EXPARRIVAL=0 THEN
            CAST(
              SUBSTRING(CAST(A.[DATE] AS VARCHAR),1,4) + '-' +
              SUBSTRING(CAST(A.[DATE] AS VARCHAR),5,2) + '-' +
              SUBSTRING(CAST(A.[DATE] AS VARCHAR),7,2)
            AS DATE)
          ELSE
            CAST(
              SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),1,4) + '-' +
              SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),5,2) + '-' +
              SUBSTRING(CAST(A.EXPARRIVAL AS VARCHAR),7,2)
            AS DATE)
          END as [DELIVERY_DATE],
          A.RATE as [EXCHANGE_RATE],
          RTRIM(A.PONUMBER) as [EXTERNAL_ID],
          '' as [LINES_BUDGET_ID],
          '' as [LINES_BUDGET_LINE_EXTERNAL_ID],
          RTRIM(B.ITEMNO) as [LINES_CODE],
          '' as [LINES_COMMENTS],
          RTRIM(B.ITEMDESC) as [LINES_DESCRIPTION],
          B.PORLSEQ as [LINES_EXTERNAL_ID],
          '' as [LINES_METADATA],
          ROW_NUMBER() OVER (PARTITION BY A.PONUMBER ORDER BY B.PORLREV) as [LINES_NUM],
          B.UNITCOST as [LINES_PRICE],
          ${quantityField} as [LINES_QUANTITY],
          '' as [LINES_REQUISITION_LINE_ID],
          B.EXTENDED as [LINES_SUBTOTAL],
          B.EXTENDED as [LINES_TOTAL],
          RTRIM(B.ORDERUNIT) as [LINES_UNIT_OF_MEASURE],
          0 as [LINES_VAT_TAXES_AMOUNT],
          '' as [LINES_VAT_TAXES_CODE],
          '' as [LINES_VAT_TAXES_EXTERNAL_CODE],
          0 as [LINES_VAT_TAXES_RATE],
          0 as [LINES_WITHHOLDING_TAXES_AMOUNT],
          '' as [LINES_WITHHOLDING_TAXES_CODE],
          '' as [LINES_WITHHOLDING_TAXES_EXTERNAL_CODE],
          0 as [LINES_WITHHOLDING_TAXES_RATE],
          'AFE' as [METADATA_KEY_01],
          RTRIM(C1.[VALUE]) as [METADATA_VALUE_01],
          'REQUISICION' as [METADATA_KEY_02],
          RTRIM(A.RQNNUMBER) as [METADATA_VALUE_02],
          'CONDICIONES' as [METADATA_KEY_03],
          RTRIM(A.TERMSCODE) as [METADATA_VALUE_03],
          'USUARIO_DE_COMPRA' as [METADATA_KEY_04],
          RTRIM(A.FOBPOINT) as [METADATA_VALUE_04],
          RTRIM(A.PONUMBER) as [NUM],
          RTRIM(A.VDCODE) as [PROVIDER_EXTERNAL_ID],
          RTRIM(A.REFERENCE) as [REFERENCE],
          RTRIM(A1.ENTEREDBY) as [REQUESTED_BY_CONTACT],
          0 as [REQUISITION_NUMBER],
          'OPEN' as [STATUS],
          A.EXTENDED as [SUBTOTAL],
          A.DOCTOTAL as [TOTAL],
          (
            (CASE WHEN A.TXEXCLUDE1<0 THEN 0 ELSE A.TXEXCLUDE1 END) +
            (CASE WHEN A.TXEXCLUDE2<0 THEN 0 ELSE A.TXEXCLUDE2 END) +
            (CASE WHEN A.TXEXCLUDE3<0 THEN 0 ELSE A.TXEXCLUDE3 END) +
            (CASE WHEN A.TXEXCLUDE4<0 THEN 0 ELSE A.TXEXCLUDE4 END) +
            (CASE WHEN A.TXEXCLUDE5<0 THEN 0 ELSE A.TXEXCLUDE5 END)
          ) as [VAT_SUM],
          ISNULL(RTRIM(B.[LOCATION]),'') as [WAREHOUSE],
          (
            (CASE WHEN A.TXEXCLUDE1>0 THEN 0 ELSE A.TXEXCLUDE1 END) +
            (CASE WHEN A.TXEXCLUDE2>0 THEN 0 ELSE A.TXEXCLUDE2 END) +
            (CASE WHEN A.TXEXCLUDE3>0 THEN 0 ELSE A.TXEXCLUDE3 END) +
            (CASE WHEN A.TXEXCLUDE4>0 THEN 0 ELSE A.TXEXCLUDE4 END) +
            (CASE WHEN A.TXEXCLUDE5>0 THEN 0 ELSE A.TXEXCLUDE5 END)
          ) as [WITHHOLD_TAX_SUM]
        FROM ${database}.dbo.POPORH1 A
        LEFT OUTER JOIN ${database}.dbo.POPORH2 A1
          ON A.PORHSEQ = A1.PORHSEQ
        LEFT OUTER JOIN ${database}.dbo.POPORL B
          ON A.PORHSEQ = B.PORHSEQ
        LEFT OUTER JOIN ${database}.dbo.POPORHO C1
          ON A.PORHSEQ = C1.PORHSEQ
         AND C1.OPTFIELD = 'AFE'
        LEFT OUTER JOIN ${database}.dbo.POPORHO C2
          ON A.PORHSEQ = C2.PORHSEQ
         AND C2.OPTFIELD = 'USOCFDI'
        LEFT OUTER JOIN ${database}.dbo.APVEN D
          ON A.VDCODE = D.VENDORID
        LEFT OUTER JOIN ${database}.dbo.APVENO E1
          ON D.VENDORID = E1.VENDORID
         AND E1.OPTFIELD = 'FORMAPAGO'
        LEFT OUTER JOIN ${database}.dbo.APVENO E2
          ON D.VENDORID = E2.VENDORID
         AND E2.OPTFIELD = 'METODOPAGO'
        LEFT OUTER JOIN ${database}.dbo.APVENO E3
          ON D.VENDORID = E3.VENDORID
         AND E3.OPTFIELD = 'PROVIDERID'
        LEFT OUTER JOIN ${database}.dbo.ICLOC F
          ON B.[LOCATION] = F.[LOCATION]
        LEFT OUTER JOIN Autorizaciones_electronicas.dbo.Autoriza_OC X
          ON A.PONUMBER = X.PONumber
        WHERE
          X.Autorizada = 1
          AND X.Empresa = '${database}'
          AND (
            SELECT MAX(Fecha)
              FROM Autorizaciones_electronicas.dbo.Autoriza_OC_detalle
             WHERE Empresa = '${database}'
               AND PONumber = X.PONumber
          ) >= '${today}'
          ${skipCondition}
          ${whereCondition}
        ORDER BY A.PONUMBER, B.PORLREV
        `;

        const { recordset } = await runQuery(sql, database);
        return recordset;
    }

    /**
     * Convert raw database records to Portal de Proveedores payload format
     * @param {Array} records - Raw database records
     * @param {Object} options - Options for payload generation
     * @returns {Array} Array of formatted purchase order payloads
     */
    async buildPayloads(records, options = {}) {
        const { filterZeroQuantities = false } = options;

        // Group records by purchase order number
        const groupedPurchaseOrders = groupOrdersByNumber(records);
        
        // Parse and validate each purchase order
        const purchaseOrders = parseExternPurchaseOrders(groupedPurchaseOrders);
        
        const validatedOrders = [];
        for (const po of purchaseOrders) {
            // Filter out lines with zero quantities if requested
            if (filterZeroQuantities) {
                po.lines = po.lines.filter(line => line.quantity > 0);
                
                // Skip orders with no valid lines
                if (po.lines.length === 0) {
                    logGenerator('PortalOC_PayloadBuilder', 'warn', 
                        `[SKIP] Order ${po.external_id} has no lines with quantity > 0`);
                    continue;
                }

                // Recalculate totals based on remaining lines
                po.subtotal = po.lines.reduce((sum, line) => sum + line.subtotal, 0);
                po.total = po.lines.reduce((sum, line) => sum + line.total, 0);
            }

            // Validate the purchase order
            const validation = validateExternPurchaseOrder(po);
            if (validation.isValid) {
                validatedOrders.push(po);
            } else {
                logGenerator('PortalOC_PayloadBuilder', 'error', 
                    `[VALIDATION] Order ${po.external_id} failed validation: ${validation.errors.join(', ')}`);
            }
        }

        return validatedOrders;
    }

    /**
     * Get purchase orders for creation (new orders)
     * @param {number} dbIndex - Database index
     * @returns {Array} New purchase order payloads
     */
    async getNewOrderPayloads(dbIndex) {
        const today = getCurrentDateString();
        
        const whereCondition = `
          AND NOT EXISTS (
            SELECT 1 FROM dbo.fesaOCFocaltec
            WHERE ocSage = A.PONUMBER
              AND idDatabase = '${this.databases[dbIndex]}'
              AND status <> 'ERROR'
          )
        `;

        const records = await this.getPurchaseOrdersData(dbIndex, whereCondition);
        return await this.buildPayloads(records);
    }

    /**
     * Get purchase orders for updates (partial cancellations)
     * @param {number} dbIndex - Database index
     * @returns {Array} Updated purchase order payloads
     */
    async getUpdatedOrderPayloads(dbIndex) {
        const whereCondition = `
          AND (SELECT SUM(B2.OQCANCELED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ) > 0
          AND (SELECT SUM(B2.OQCANCELED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ) < 
              (SELECT SUM(B2.SQORDERED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ)
          AND EXISTS (
            SELECT 1 FROM dbo.fesaOCFocaltec
            WHERE ocSage = A.PONUMBER
              AND idDatabase = '${this.databases[dbIndex]}'
              AND status = 'POSTED'
          )
        `;

        const records = await this.getPurchaseOrdersData(dbIndex, whereCondition, true);
        return await this.buildPayloads(records, { filterZeroQuantities: true });
    }

    /**
     * Get purchase orders for cancellation (fully cancelled)
     * @param {number} dbIndex - Database index
     * @returns {Array} Purchase order numbers to cancel
     */
    async getOrdersToCancel(dbIndex) {
        const whereCondition = `
          AND (SELECT SUM(B2.OQCANCELED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ) = 
              (SELECT SUM(B2.SQORDERED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ)
          AND (SELECT SUM(B2.SQORDERED) FROM ${this.databases[dbIndex]}.dbo.POPORL B2 WHERE B2.PORHSEQ = A.PORHSEQ) > 0
          AND EXISTS (
            SELECT 1 FROM dbo.fesaOCFocaltec
            WHERE ocSage = A.PONUMBER
              AND idDatabase = '${this.databases[dbIndex]}'
              AND status = 'POSTED'
          )
        `;

        const records = await this.getPurchaseOrdersData(dbIndex, whereCondition);
        const orderNumbers = [...new Set(records.map(record => record.EXTERNAL_ID))];
        return orderNumbers;
    }
}

module.exports = {
    PortalOCPayloadBuilder
};