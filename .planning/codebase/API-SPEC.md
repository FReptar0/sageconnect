# Portal de Proveedores - API Specification Extract

**Source:** https://api-sandbox.portaldeproveedores.mx/v3/api-docs/integration-api
**API Name:** API de integraciones
**Extracted:** 2026-03-12

---

## Authentication (All Endpoints)

All endpoints require:
- **Header `PDPTenantKey`** (string, required): Key assigned to the consuming company
- **Header `PDPTenantSecret`** (string, required): Secret assigned to the consuming company
- **Path `tenantId`** (string, required): Company identifier

---

## 1. POST /api/1.0/batch/tenants/{tenantId}/payments

**Summary:** Genera los pagos especificados en el request (createPayments)
**Tag:** BatchPaymentApi

### Request Body: `BatchPaymentRequest`

```json
{
  "payments": [OnePaymentRequest]  // required, array
}
```

### OnePaymentRequest (each item in payments array)

| Field | Type | Required | Description |
|---|---|---|---|
| `cfdis` | array of `CfdiToPayExternRequest` | **YES** | Lista de los comprobantes a pagar, debe tener al menos un comprobante |
| `currency` | string | **YES** | Moneda del pago (ISO 4217) |
| `payment_date` | string (date-time) | **YES** | Fecha del pago. Formato yyyy-mm-dd |
| `total_amount` | number | **YES** | Cantidad pagada (depositada) en la cuenta del proveedor |
| `bank_account_id` | string | no | Id interno de PDP del tenant donde se realizo el pago. Si vacio, toma la primer cuenta |
| `comments` | string | no | Comentarios o notas acerca del pago |
| `external_id` | string | no | Identificador del pago en el ERP. Dos pagos con el mismo id marcaran error |
| `ignore_amounts` | boolean | no | Cuando true, salda los comprobantes sin importar cantidades. Cuando false, PDP valida montos y saldos |
| `operation_type` | string (enum) | no | Tipo de operacion: `TRANSFER`, `BANK_CHECK`, `CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `NOT_DEFINED`, `ANY` |
| `provider_external_id` | string | no | Identificador del proveedor en el ERP. Requerido si no se proporciona UUID de comprobante |
| `reference` | string | no | Referencia bancaria del pago |

### CfdiToPayExternRequest (each item in cfdis array)

| Field | Type | Required | Description |
|---|---|---|---|
| `uuid` | string | **YES** | Identificador fiscal del CFDI (folio fiscal). Requerido si no se envia identifier |
| `amount` | number | **YES** | Cantidad a pagar en la moneda del comprobante |
| `currency` | string | **YES** | Moneda en la que se descontara el saldo (ISO 4217) |
| `exchange_rate` | number | **YES** | Tipo de cambio. Si misma moneda = 1 |
| `payment_amount` | number | **YES** | Cantidad pagada en la moneda del campo payment_currency |
| `identifier` | string | no | Serie y Folio separados por espacio. Requerido si no se envia uuid |
| `document_type` | string (enum) | no | `CFDI`, `EXPENSES_ACCOUNT`, `HONORARIUM`, `FOREIGN`, `FOREIGN_CREDIT_NOTE`, `REFUND`, `ADVANCE_PAYMENT` |
| `payment_currency` | string | no | Moneda del pago |

### Response: `BatchPaymentResponse`

```json
{
  "id": "string",          // batch operation ID
  "results": [BatchResponseExternalPaymentResponse]  // array
}
```

### BatchResponseExternalPaymentResponse (each item in results array)

| Field | Type | Required | Description |
|---|---|---|---|
| `error_code` | integer (int32) | **YES** | Status de la peticion (0 = success) |
| `error_message` | string | **YES** | Descripcion de error |
| `id` | string | **YES** | Id externo. Example: "6046b54e8d2c344452f7346e" |
| `item` | `ExternalPaymentResponse` | **YES** | El objeto involucrado (the created payment) |

**IMPORTANT NOTE ON RESULTS ARRAY:** The spec defines `results` as an array of `BatchResponseExternalPaymentResponse`. The spec does NOT explicitly state that the results array length always matches the input payments array length. However, the structure (with per-item `error_code` and `error_message`) implies one result per input payment. Each result has its own error_code so individual payments can fail independently.

### ExternalPaymentResponse (the `item` field in each result)

| Field | Type | Description |
|---|---|---|
| `id` | string | Internal PDP payment ID |
| `external_id` | string | ERP payment identifier |
| `folio` | string | Payment folio |
| `serie` | string | Payment serie |
| `status` | string (enum) | `NO_NEED_PAYMENT_CFDI`, `PENDING_PAYMENT_CFDI`, `PENDING_PAYMENT_CFDI_HIDDEN`, `IN_REVIEW_PAYMENT_CFDI`, `PAYMENT_CFDI_ATTACHED`, `DELIVERED_ERP`, `FAILED`, `REJECTED_PAYMENT_CFDI` |
| `total_amount` | number | Total amount |
| `currency` | string | Currency |
| `exchange_rate` | number | Exchange rate |
| `payment_date` | string (date-time) | Payment date |
| `payment_form` | string (enum) | `F01`, `F02`, `F03`, `F04`, `F05`, `F06`, `F08`, `F12`-`F15`, `F17`, `F23`-`F31`, `F99` |
| `payment_method` | string (enum) | `PUE`, `PPD`, `PIP` |
| `operation_type` | string (enum) | Same enum as request |
| `reference` | string | Bank reference |
| `comments` | string | Comments |
| `provider_id` | string | PDP provider ID |
| `provider_name` | string | Provider name |
| `provider_external_id` | string | ERP provider ID |
| `company_id` | string | Company ID |
| `company_name` | string | Company name |
| `bank_account_id` | string | Bank account ID |
| `bank_account_name` | string | Bank account name |
| `target_bank_account_id` | string | Target bank account ID |
| `tenant_id` | string | Tenant ID |
| `user_id` | string | User ID |
| `payment_order_id` | string | Payment order ID |
| `payment_cfdi_id` | string | Payment CFDI ID |
| `count_cfdis` | string | Count of CFDIs |
| `count_lines` | integer (int64) | Count of lines |
| `comprobantes` | string | Comprobantes |
| `open` | boolean | Is open |
| `dummy` | boolean | Is dummy |
| `factoring` | boolean | Is factoring |
| `delivered_to_erp` | boolean | Delivered to ERP |
| `payment_cfdi_expired` | boolean | Payment CFDI expired |
| `custom_status` | string | Custom status |
| `operation_number` | integer (int64) | Operation number |
| `operation_file_url` | string | Operation file URL |
| `deadline_payment_cfdi` | string (date-time) | Deadline for payment CFDI |
| `cfdis` | array of `ExternPaymentCfdiResponse` | List of payment CFDIs |
| `lines` | array of `PaymentLine` | Payment lines |
| `list_cfdis` | array of `CfdiResponse` | Full CFDI objects |
| `missing_cfdis` | array of string | Missing CFDI IDs |
| `company` | `PaymentCompanyInfo` | Company info object |
| `provider` | `PaymentProviderInfo` | Provider info object |
| `payment_cfdi` | `PaymentCfdiInfo` | Payment CFDI info |
| `exchange_rate_dof` | `ExchangeRate` | DOF exchange rate |
| `rejection_request` | `RejectionRequest` | Rejection request |
| `rejection_request_user_name` | string | Rejection request user name |
| `provider_fiscal_status_response` | `ProviderFiscalStatusResponse` | Provider fiscal status |
| `payment_process_history` | array of `ExtendedFieldResponse` | Payment process history |

### ExternPaymentCfdiResponse (items in `cfdis` array of ExternalPaymentResponse)

| Field | Type | Description |
|---|---|---|
| `id` | string | CFDI ID |
| `uuid` | string | CFDI UUID |
| `cfdi` | string | CFDI reference |
| `identificador` | string | Identifier (serie + folio) |
| `serie` | string | Serie |
| `folio` | string | Folio |
| `currency` | string | Currency |
| `total` | number | Total amount |
| `total_mxn` | number | Total in MXN |
| `amount` | number | Amount paid |
| `payment_amount` | number | Payment amount |
| `payment_percentage` | number | Payment percentage |
| `balance_before` | number | Balance before payment |
| `balance_after` | number | Balance after payment |
| `exchange_rate` | number | Exchange rate |
| `reference_exchange_rate` | number | Reference exchange rate |
| `tolerance` | number | Tolerance |
| `instalment_number` | integer (int64) | Installment number |
| `included_previously` | boolean | Was included previously |
| `advance_payments` | array of `PaymentCfdi` | Advance payments |

### PaymentLine (items in `lines` array)

| Field | Type |
|---|---|
| `line_num` | integer (int32) |
| `payable_document_id` | string |
| `uuid` | string |
| `invoice_number` | string |
| `currency` | string |
| `amount` | number |
| `rate` | number |
| `balance_before_payment` | number |
| `balance_after_payment` | number |
| `installment` | integer (int32) |

### PaymentCompanyInfo

| Field | Type |
|---|---|
| `id` | string |
| `name` | string |
| `rfc` | string |
| `external_id` | string |

### PaymentProviderInfo

| Field | Type |
|---|---|
| `id` | string |
| `name` | string |
| `rfc` | string |
| `external_id` | string |

---

## 2. GET /api/1.0/extern/tenants/{tenantId}/providers

**Summary:** Lista los proveedores de la empresa (listProviders)
**Tag:** provider-api

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageSize` | integer (int32) | no | Tamano del conjunto de datos. Ej: pageSize=30 regresara 30 registros |
| `offset` | integer (int32) | no | Posicion inicial del conjunto. Ej: offset=20 regresara desde registro 20 |
| `externalId` | string | no | **Identificador del proveedor en el ERP** |
| `external_ids` | array of string | no | Arreglo de external_id. Uso: `&external_ids=ext1&external_ids=ext2` |
| `rfc` | string | no | RFC del proveedor |
| `name` | string | no | Razon social del proveedor |
| `ids` | array of string | no | Arreglo de IDs internos PDP. Uso: `&ids=id1&ids=id2` |
| `status` | string (enum) | no | `ENABLED`, `DISABLED` |
| `statusExpedient` | string | no | Status del expediente: `SENT`, `REJECTED`, `ACCEPTED`, `EDITED`, `NO_EXPEDIENT` |
| `type` | string | no | Tipo de proveedor: `REGULAR`, `CUSTOMS_AGENT`, `FOREIGN` |
| `emptyExternalId` | boolean | no | Cuando true, obtiene solo proveedores sin ID Externo |
| `hideBankInformation` | boolean | no | Cuando true, no devuelve informacion bancaria |
| `expedientAcceptedFrom` | string (date) | no | Proveedores con fecha aprobacion >= esta fecha |
| `expedientAcceptedTo` | string (date) | no | Proveedores con fecha aprobacion <= esta fecha |
| `expiredExpedient` | boolean | no | true = expediente expirado, false = no expirado |

### Response: `ProvidersResponse`

```json
{
  "total": 123,              // integer (int64)
  "items": [ProviderResponse],
  "classifications": [ProviderClassificationResponse],
  "specific_rules": [SpecificReceptionRuleResponse],
  "validators": [SafeUserResponse],
  "workflows": [WorkflowResponse]
}
```

### ProviderResponse (key fields)

| Field | Type | Description |
|---|---|---|
| `id` | string | Internal PDP provider ID |
| `external_id` | string | **ERP provider ID** |
| `name` | string | Provider name (razon social) |
| `rfc` | string | RFC |
| `tax_id` | string | Tax ID (for foreign providers) |
| `status` | string (enum) | `ENABLED`, `DISABLED` |
| `type` | string (enum) | `REGULAR`, `CUSTOMS_AGENT`, `FOREIGN`, `VENDOR` |
| `tenant_id` | string | Tenant ID |
| `country` | string | Country |
| `credit_days` | integer (int32) | Credit days |
| `max_credit_days` | integer (int32) | Max credit days |
| `companies` | array of string (uniqueItems) | Company IDs |
| `company_names` | string | Company names |
| `company_objects` | array of `CompanyResponse` | Company objects |
| `expedient` | `ExpedientResponse` | Expedient info |
| `expedient_status` | string | Expedient status |
| `expedient_template_id` | string | Expedient template ID |
| `expedient_template_name` | string | Expedient template name |
| `extended_fields` | array of `ExternProviderFieldValueResponse` | Extended fields |
| `provider_id_accounts_payable` | string | Accounts payable ID |
| `provider_id_se` | string | SE ID |
| `gln` | string | GLN code |
| `workflows` | array of string (uniqueItems) | Workflow IDs |
| `workflows_names` | string | Workflow names |
| `workflows_response` | array of `WorkflowResponse` | Workflow objects |
| `ledger_assignment` | `LedgerAssigmentResponse` | Ledger assignment |
| `black_list_validations` | `BlackListValidations` | Blacklist validations |
| `efos` | `Efos` | EFOS data |
| `terms_conditions` | `ProviderTermsConditions` | Terms and conditions |
| `specific_rule` | `SpecificReceptionRuleResponse` | Specific reception rule |
| `provider_classifications` | array of `ProviderClassificationResponse` | Classifications |
| ... | ... | (many more fields - see full schema above) |

---

## 3. POST /api/1.0/extern/tenants/{tenantId}/payments

**Summary:** Utiliza este endpoint para CREAR un pago (single payment)
**Tag:** payment-api

### Request Body: `OnePaymentRequest`

Same schema as the items inside the batch payments `payments` array. See section 1 for full details.

| Field | Type | Required |
|---|---|---|
| `cfdis` | array of `CfdiToPayExternRequest` | **YES** |
| `currency` | string | **YES** |
| `payment_date` | string (date-time) | **YES** |
| `total_amount` | number | **YES** |
| `bank_account_id` | string | no |
| `comments` | string | no |
| `external_id` | string | no |
| `ignore_amounts` | boolean | no |
| `operation_type` | string (enum) | no |
| `provider_external_id` | string | no |
| `reference` | string | no |

### Response: `ExternalPaymentResponse`

**Direct response** (not wrapped in batch). Same schema as the `item` in `BatchResponseExternalPaymentResponse`. See section 1 for full field listing.

---

## 4. GET /api/1.0/extern/tenants/{tenantId}/payments/{paymentId}

**Summary:** Obtiene un pago a partir del identificador especificado (getPayment)
**Tag:** payment-api

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `paymentId` | string | yes | ID del Portal de Proveedores asignado al pago |

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id_type` | string (enum) | no | `INTERNAL` (default) or `EXTERNAL`. INTERNAL = PDP DB id, EXTERNAL = external_id |

### Response: `ExternalPaymentResponse`

Same as the single POST payment response. See section 1 for full schema.

---

## 5. GET /api/1.0/extern/tenants/{tenantId}/cfdis

**Summary:** Busca cfdis que cumplan con los criterios proporcionados (listCfdis)
**Tag:** cfdi-api

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pageSize` | integer (int32) | **YES** | Tamano del conjunto de datos. Ej: 30 |
| `offset` | integer (int32) | **YES** | Posicion inicial del conjunto |
| `from` | string (date) | no | Fecha inicio (yyyy-mm-dd) |
| `to` | string (date) | no | Fecha fin (yyyy-mm-dd) |
| `providerId` | string | no | ID del Portal de Proveedores del proveedor |
| `providerExternalId` | string | no | **ID del proveedor asignado por el ERP** |
| `purchaseOrderId` | string | no | ID PDP de la orden de compra |
| `purchaseOrderExternalId` | string | no | ID ERP de la orden de compra |
| `warehouseDeliveryId` | string | no | ID PDP de la entrada a almacen |
| `warehouseDeliveryExternalId` | string | no | ID ERP de la entrada a almacen |
| `cfdiIds` | array of string (uniqueItems) | no | Lista de CFDI IDs |
| `uuids` | array of string (uniqueItems) | no | Lista de UUIDs de CFDI |
| `cfdiType` | string (enum) | no | `INVOICE`, `CREDIT_NOTE`, `PAYMENT_CFDI`, `ADVANCE` |
| `documentTypes` | array of string (enum) | no | `CFDI`, `EXPENSES_ACCOUNT`, `HONORARIUM`, `FOREIGN`, `FOREIGN_CREDIT_NOTE`, `REFUND`, `ADVANCE_PAYMENT` |
| `stage` | string (enum) | no | `PENDING_TO_SEND`, `PENDING_TO_AUTHORIZE`, `PENDING_TO_VALIDATE`, `PENDING_TO_PAY`, `DELIVERED_ERP`, `INCLUDED_IN_PAYMENT_ORDER`, `PAYMENT_COMPLETED`, `FINISHED` |
| `status` | string | no | Specific status: `TO_SEND`, `REJECTED`, `IN_RECEPTION`, `REJECTED_BY_ADMIN`, `REJECTED_BY_CXP`, `IN_REVIEW`, `PENDING_PAYMENT`, `PAYMENT_POSTPONE`, `IN_PAYMENT_ORDER`, `SEND_TO_EXECUTE`, `PAID`, `PENDING_ATTACH_PAYMENT_CFDI`, `NO_NEED_ATTACH_PAYMENT_CFDI`, `PENDING_APPLICATION`, `APPLIED`, `PENDING_ATTACH`, `PAYMENT_CFDI_IN_REVIEW`, `PAYMENT_CFDI_REJECTED`, `ATTACHED`, `DELIVERED_ERP` |
| `companyExternalId` | string | no | ID externo de la compania |
| `createdFrom` | string (date) | no | Fecha creacion desde (yyyy-MM-dd, inclusive 00:00) |
| `createdUntil` | string (date) | no | Fecha creacion hasta (yyyy-MM-dd, inclusive 23:59:59) |
| `serie` | string | no | Serie del comprobante |
| `folio` | string | no | Folio del comprobante |
| `hideValidations` | boolean | no | Excluir nodo de validaciones |
| `retrieveHistory` | boolean | no | Incluir historial por CFDI |

### Response: `CfdisExternResponse`

```json
{
  "total": 123,                    // integer (int64) - total count
  "items": [CfdiExternResponse]   // array of CFDI objects
}
```

### CfdiExternResponse (each item)

| Field | Type | Description |
|---|---|---|
| `id` | string | Internal CFDI ID |
| `identifier` | string | Identifier (serie + folio) |
| `status` | string | CFDI status |
| `type` | string | CFDI type |
| `currency` | string | Currency |
| `total` | number | Total amount |
| `total_for_prorrate` | number | Total for proration |
| `date` | string (date-time) | CFDI date |
| `description` | string | Description |
| `url` | string | URL |
| `file_name` | string | File name |
| `source_id` | string | Source ID |
| `error` | string | Error message |
| `error_code` | string (enum) | Error code (large enum) |
| `template_valid` | boolean | Template valid |
| `allow_link_po` | boolean | Allow link PO |
| `must_link_all_concepts` | boolean | Must link all concepts |
| `restrict_only_one_po` | boolean | Restrict to one PO |
| `validate_amounts_line_po` | boolean | Validate amounts by line PO |
| `amount_tolerance_line_po` | number | Amount tolerance line PO |
| `amount_tolerance_credit_note` | number | Amount tolerance credit note |
| `cfdi_advance_payment` | string | Advance payment reference |
| `provider_tax_id` | string | Provider tax ID |
| `isr_retenido` | number | ISR retained |
| `iva_retenido` | number | IVA retained |
| `iva_trasladado` | number | IVA transferred |
| `otros_retenido` | number | Other taxes retained |
| `otros_trasladado` | number | Other taxes transferred |
| `last_payment` | number | Last payment amount |
| `cfdi` | `CfdiRaw` | Raw CFDI XML data |
| `metadata` | **`CfdiMetadataResponse`** | **CFDI metadata (see below)** |
| `concepts` | array of `ConceptResponse` | CFDI concepts |
| `issuer` | `Issuer` | Issuer info |
| `owners` | `OwnersCfdi` | Owners |
| `employee` | `EmployeeResponse` | Employee |
| `expenses_account` | `ExpensesAccountResponse` | Expenses account |
| `cfdis_cancelled` | `ValidationCancelledResponse` | Cancelled info |
| `payment_complement_info` | `PaymentComplementInfo` | Payment complement info |
| `provider_fiscal_status_response` | `ProviderFiscalStatusResponse` | Provider fiscal status |

### CfdiMetadataResponse (the `metadata` field) - KEY FIELDS

| Field | Type | Description |
|---|---|---|
| **`provider_id`** | **string** | **PDP internal provider ID** |
| **`provider_external_id`** | **string** | **ERP provider ID (external_id)** |
| **`provider_name`** | **string** | **Provider name** |
| **`provider_rfc`** | **string** | **Provider RFC** |
| **`provider_tax_id`** | **string** | **Provider tax ID** |
| `tenant_id` | string | Tenant ID |
| `tenant_name` | string | Tenant name |
| `company_id` | string | Company ID |
| `company_name` | string | Company name |
| `company_rfc` | string | Company RFC |
| `status` | string | Status |
| `custom_status` | string | Custom status |
| `type` | string (enum) | `INVOICE`, `CREDIT_NOTE`, `PAYMENT_CFDI`, `TRASLADO`, `NOMINA`, `ADVANCED` |
| `cfdi_status_group` | string (enum) | `SENDING`, `IN_PROCESS`, `VALIDATION`, `RECEIVED`, `DELIVERED_ERP`, `POSTPONE`, `PAYMENT_ORDER`, `ARCHIVED`, `ASSOCIATED`, `DELETED`, `SE_SENDING`, `SE_SENT`, `HIDDEN` |
| `balance` | number | Remaining balance |
| `total_mxn` | number | Total in MXN |
| `subtotal_base` | number | Subtotal base |
| `created_at` | string (date-time) | Creation date |
| `authorized_at` | string (date-time) | Authorization date |
| `send_at` | string (date-time) | Send date |
| `from` | string (date-time) | From date |
| `to` | string (date-time) | To date |
| `erp_id` | string | ERP ID |
| `erp_status` | string | ERP status |
| `comments` | string | Comments |
| `package_id` | string | Package ID |
| `customer_id` | string | Customer ID |
| `employee_id` | string | Employee ID |
| `workflow_id` | string | Workflow ID |
| `cfdi_id_se` | string | SE CFDI ID |
| `consecutive` | integer (int32) | Consecutive number |
| `partially_payed` | boolean | Partially paid |
| `balanced_by_credit_note` | boolean | Balanced by credit note |
| `cancelled_by_sat` | boolean | Cancelled by SAT |
| `cancelled_in_tenant` | boolean | Cancelled in tenant |
| `cfdi_valid` | boolean | CFDI valid |
| `valid_pdf` | boolean | Valid PDF |
| `xml_modified` | boolean | XML modified |
| `from_reception_email` | boolean | From reception email |
| `upload_from_tenant` | boolean | Uploaded from tenant |
| `force_workflow_id` | boolean | Force workflow ID |
| `complementary_advanced` | boolean | Complementary advanced |
| `in_expenses_account` | boolean | In expenses account |
| `payment_by_factoring` | boolean | Payment by factoring |
| `has_users_provider` | boolean | Has users provider |
| `non_base_valid` | boolean | Non base valid |
| `provider_upload_sipare` | boolean | Provider upload SIPARE |
| `postpone_to` | string (date-time) | Postpone to date |
| `uso_cfdi` | string | CFDI usage code |
| `project` | string | Project |
| `expense_account_id` | string | Expense account ID |
| `expense_account_identifier` | string | Expense account identifier |
| `cfdi_related_to_credit_note` | string | CFDI related to credit note |
| `se_accounts_payable_related_url` | string | SE accounts payable URL |
| `authorizer_name` | string | Authorizer name |
| `sender_to_review_name` | string | Sender to review name |
| `uploader_name` | string | Uploader name |
| `receptors_names` | string | Receptors names |
| `payment_info` | `PaymentInfoResponse` | Payment info |
| `authorized_amount` | `AuthorizedAmount` | Authorized amount |
| `authorized_amount_response` | `AuthorizedAmountResponse` | Authorized amount response |
| `additional_amount` | `AdditionalAmount` | Additional amount |
| `advance_metadata` | `AdvanceMetadataResponse` | Advance metadata |
| `cfdi_proration` | `CfdiProrationResponse` | CFDI proration |
| `read_only` | `ReadOnlyCfdi` | Read only info |
| `shipping_data` | `ShippingData` | Shipping data |
| `specialized_services` | `SpecializedServicesResponse` | Specialized services |
| `semaphore` | `SemaphoreConfig` | Semaphore config |
| `owners` | `OwnersCfdi` | Owners |
| `customer` | `CustomerResponse` | Customer |
| `sender` | `UserResponse` | Sender user |
| `additional_info` | array of `ExtendedField` | Additional info fields |
| `before_send` | array of `CfdiBeforeSend` | Before send |
| `credit_notes` | array of `CreditNoteResponse` (uniqueItems) | Credit notes |
| `extended_fields` | array of `ExtendedFieldResponse` | Extended fields |
| `fields_response` | array of `AdditionalInfoFieldsResponse` | Fields response |
| `history` | array of `CfdiHistoryResponse` | History |
| `incident_companies` | array of `CompanyResponse` | Incident companies |
| `product_keys` | array of string (uniqueItems) | Product keys |
| `provider_responses` | array of `ProviderResponse` | Provider responses |
| `provider_workflows` | array of `WorkflowResponse` | Provider workflows |
| `purchase_order_ids` | array of string (uniqueItems) | PO IDs |
| `purchase_orders` | array of `PurchaseOrderRelationInvoice` | POs |
| `purchase_orders_response` | array of `PurchaseOrderRelationInvoiceResponse` | PO responses |
| `required_fields` | array of string (uniqueItems) | Required fields |
| `validations` | array of `CfdiValidation` | Validations |
| `warehouse_delivery_ids` | array of string (uniqueItems) | Warehouse delivery IDs |
| `users_receptor_id` | array of string (uniqueItems) | User receptor IDs |
| `user_authorizer_id` | string | User authorizer ID |
| `user_provider_sender_to_review_id` | string | User provider sender to review ID |
| `user_sender_to_review_id` | string | User sender to review ID |
| `user_uploader_id` | string | User uploader ID |
| `user_verifier_id` | string | User verifier ID |

---

## 6. PUT /api/1.0/batch/tenants/{tenantId}/payments/update-status

**Summary:** Actualiza el estatus de los pagos especificados en el request
**Tag:** BatchPaymentApi

### Request Body: `BatchUpdateStatusPaymentsRequest`

```json
{
  "payments": [UpdateStatusPaymentRequest]  // required, array
}
```

### UpdateStatusPaymentRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `external_id` | string | **YES** | ERP payment identifier |
| `status_pdp` | string (enum) | **YES** | `NO_NEED_PAYMENT_CFDI`, `PENDING_PAYMENT_CFDI`, `PENDING_PAYMENT_CFDI_HIDDEN`, `IN_REVIEW_PAYMENT_CFDI`, `PAYMENT_CFDI_ATTACHED`, `DELIVERED_ERP`, `FAILED`, `REJECTED_PAYMENT_CFDI` |

### Response: `BatchPaymentResponse`

Same as batch create payments response (section 1).

---

## 7. DELETE /api/1.0/batch/tenants/{tenantId}/payments/reject

**Summary:** Cancela los pagos especificados en el request (cancelPayments)
**Tag:** BatchPaymentApi

### Request Body: `BatchPaymentRejectRequest`

```json
{
  "payments": [BatchPaymentDeleteRequest]  // required, array
}
```

### BatchPaymentDeleteRequest

| Field | Type | Required | Description |
|---|---|---|---|
| `external_id` | string | no | ERP payment identifier |
| `comments` | string | no | Rejection comments |
| `erp_status` | string | no | ERP status |

### Response: `BatchPaymentResponse`

Same as batch create payments response (section 1).

---

## Key Observations

### 1. Batch Payment Results Array Behavior
The `BatchPaymentResponse.results` array contains `BatchResponseExternalPaymentResponse` items. Each item has:
- `error_code` (int32, required) - 0 typically means success
- `error_message` (string, required)
- `id` (string, required) - the external ID
- `item` (ExternalPaymentResponse, required) - the payment object

The spec marks ALL four fields as **required**, meaning every result will always have these fields. The structure supports partial failures (some items succeed, others fail with individual error codes).

### 2. Provider Lookup by externalId
The GET providers endpoint supports:
- **`externalId`** (singular, string) - single lookup
- **`external_ids`** (plural, array) - multiple lookups
- **`rfc`** - lookup by RFC
- **`emptyExternalId`** (boolean) - find providers without ERP ID

### 3. CFDI metadata.provider_id
The `CfdiMetadataResponse` contains:
- **`provider_id`** (string) - Internal PDP provider ID
- **`provider_external_id`** (string) - ERP external ID
- **`provider_name`** (string) - Provider name
- **`provider_rfc`** (string) - Provider RFC
- **`provider_tax_id`** (string) - Provider tax ID

These are available directly in the metadata response of each CFDI. The `provider_id` here is the PDP internal ID (NOT the ERP external_id).

### 4. CFDI Search by Provider
The GET cfdis endpoint supports searching by:
- **`providerId`** - PDP internal ID
- **`providerExternalId`** - ERP external ID
