# Payment Reconciliation

Script: `payment-reconciliation.js`

Compara las facturas **PENDING_TO_PAY** del portal con los pagos PY registrados en Sage y genera un reporte de conciliacion. Opcionalmente, sube los pagos listos al portal en un solo request batch.

---

## Requisitos previos

- Archivo `.env.credentials.focaltec` en la raiz del proyecto con:
  - `URL`, `TENANT_ID`, `API_KEY`, `API_SECRET`, `DATABASES`
- Conexion a SQL Server (Sage 300 y base `fesa`)

---

## 1. Generar el reporte

```bash
node src/scripts/payment-reconciliation.js
```

Esto ejecuta el script en modo **REPORT** (por defecto). No sube nada al portal.

### Que hace

1. Obtiene todas las facturas PENDING_TO_PAY del portal y extrae sus UUIDs.
2. Busca en Sage los pagos PY cuyas facturas tengan esos UUIDs (query por APIBHO).
3. Para cada pago encontrado, consulta sus facturas y las clasifica en 4 categorias:

| Categoria | Significado |
|-----------|-------------|
| **READY TO UPLOAD** | Todas las facturas tienen UUID y estan como PENDING_TO_PAY en el portal |
| **MISSING PROVIDERID** | El vendor en Sage no tiene el campo opcional PROVIDERID en APVENO |
| **MISSING UUID** | Una o mas facturas del pago no tienen FOLIOCFD en APIBHO |
| **NOT IN PORTAL** | Las facturas tienen UUID pero no aparecen como PENDING_TO_PAY (ya pagadas o no registradas) |

### Filtros opcionales

```bash
# Solo pagos a partir de cierta fecha (formato YYYYMMDD)
node src/scripts/payment-reconciliation.js --from=20250101

# Solo un pago especifico
node src/scripts/payment-reconciliation.js --py PY0061652

# Combinar filtros
node src/scripts/payment-reconciliation.js --from=20250101 --py PY0061652

# Si manejas multiples tenants, usa --index para seleccionar (default 0)
node src/scripts/payment-reconciliation.js --index=1
```

### Ejemplo de salida

```
=== PAYMENT RECONCILIATION REPORT ===
Portal PENDING_TO_PAY invoices: 342
Sage PY payments matching portal UUIDs: 28

--- READY TO UPLOAD (15) ---
  PY0061652  | vendor: PROV001 | $45,200.00 MXN | 3 invoices | all UUIDs matched

--- MISSING PROVIDERID (5) ---
  PY0061700  | vendor: PROV045 | RFC: ABC010101AAA | no PROVIDERID in APVENO

--- MISSING UUID (4) ---
  PY0061710  | vendor: PROV012 | 2/3 invoices missing UUID
    - FA-001: UUID present
    - FA-002: MISSING UUID
    - FA-003: MISSING UUID

--- NOT IN PORTAL (4) ---
  PY0061720  | vendor: PROV033 | 1/2 UUIDs not found as PENDING_TO_PAY (may already be paid)

=== SUMMARY ===
  Ready to upload:    15
  Missing PROVIDERID: 5
  Missing UUID:       4
  Not in portal:      4
  TOTAL:              28

Use --upload to send the 15 ready payments to the portal.
```

---

## 2. Subir pagos al portal

```bash
node src/scripts/payment-reconciliation.js --upload
```

Esto toma los pagos clasificados como **READY TO UPLOAD** y los envia al portal en un solo POST batch a `/api/1.0/batch/tenants/{tenantId}/payments`.

### Limitar la cantidad de pagos por ejecucion

```bash
# Subir maximo 5 pagos (default: 20)
node src/scripts/payment-reconciliation.js --upload --batch=5
```

Los pagos restantes se suben en ejecuciones posteriores. El script excluye automaticamente los pagos ya registrados en la tabla de control `fesaPagosFocaltec`.

### Que hace internamente

1. Construye el payload de cada pago con sus CFDIs (facturas + montos + UUIDs).
2. Envia todos los payloads en un solo request batch.
3. Para cada resultado exitoso (`error_code === 0`), inserta un registro en `fesa.dbo.fesaPagosFocaltec` con status `PAID` o `PARTIAL`.
4. Los resultados fallidos se reportan con su `error_code` y `error_message`.

### Ejemplo de salida

```
=== UPLOADING 5 of 15 ready payments (batch limit: 5) ===

  [POST] Sending 5 payments in batch to portal...
  [OK] Batch response received: 5 result(s)
  [OK] PY0061652 sent successfully | portal ID: 12345
  [OK] Control table updated for PY0061652 (status: PAID)
  [OK] PY0061653 sent successfully | portal ID: 12346
  [OK] Control table updated for PY0061653 (status: PARTIAL)
  [ERROR] PY0061654 failed: error_code=1827, message=Payment already exists

=== UPLOAD COMPLETE ===
  Success: 2
  Errors:  1
  Remaining: 10 (run again to process next batch)
```

---

## 3. Corregir pagos con MISSING UUID

Cuando una factura en Sage no tiene el campo `FOLIOCFD` en la tabla `APIBHO`, el pago no se puede conciliar. Para reparar los UUIDs faltantes usa `payment-uuid-repair.js`.

### Paso 1: Escanear

```bash
node src/scripts/payment-uuid-repair.js scan
```

Compara facturas del portal con las de Sage e identifica cuales necesitan UUID. Guarda el estado en `src/scripts/data/repair-state.json`.

### Paso 2: Reparar (modo dry-run)

```bash
# Ver que haria sin escribir nada en la base
node src/scripts/payment-uuid-repair.js repair
```

Muestra las sentencias INSERT/UPDATE que se ejecutarian sobre `APIBHO` para escribir los UUIDs faltantes.

### Paso 3: Reparar (aplicar cambios)

```bash
node src/scripts/payment-uuid-repair.js repair --apply
```

Escribe los UUIDs en `APIBHO`. Despues de esto, vuelve a correr el reporte de conciliacion y esos pagos deberian aparecer como **READY TO UPLOAD**.

### Paso 4: Verificar

```bash
# Verificar que el pago ahora tiene UUIDs completos
node src/scripts/payment-uuid-diagnostic.js --py PY0061710
```

El diagnostico muestra el estado actual de cada factura del pago: si tiene FOLIOCFD, si tiene PROVIDERID, etc.

### Flujo completo

```bash
# 1. Escanear
node src/scripts/payment-uuid-repair.js scan

# 2. Revisar y aplicar
node src/scripts/payment-uuid-repair.js repair --apply

# 3. Re-generar reporte para confirmar
node src/scripts/payment-reconciliation.js --py PY0061710

# 4. Subir si aparece como READY
node src/scripts/payment-reconciliation.js --upload --py PY0061710
```

---

## 4. Corregir pagos con MISSING PROVIDERID

Cuando un vendor en Sage no tiene el campo opcional `PROVIDERID` en la tabla `APVENO`, el pago no se puede subir al portal porque no hay forma de relacionar el vendor de Sage con el proveedor del portal.

### Opcion A: Registrar PROVIDERID directamente en Sage 300

1. Abrir **Sage 300 > Cuentas por Pagar > Proveedores**.
2. Buscar el vendor por su ID (columna `provider_external_id` del reporte).
3. Ir a la pestana de **Campos opcionales**.
4. Agregar o actualizar el campo `PROVIDERID` con el ID del proveedor en el portal.

Para encontrar el PROVIDERID correcto del portal:
- Buscar en el portal por RFC del vendor.
- El `provider_id` del portal es el valor que debe ir en `PROVIDERID`.

### Opcion B: Insertar via SQL (si tienes acceso directo)

```sql
-- Verificar si ya existe el registro
SELECT * FROM APVENO
WHERE VENDORID = 'VENDOR_ID_AQUI'
  AND OPTFIELD = 'PROVIDERID';

-- Si no existe, insertar
INSERT INTO APVENO (VENDORID, OPTFIELD, [VALUE], TYPE, LENGTH, DECIMALS, ALLOWNULL, VALIDATE, SWSET, VDESSION, FDESSION)
VALUES ('VENDOR_ID_AQUI', 'PROVIDERID', 'PORTAL_PROVIDER_ID', 1, 60, 0, 0, 0, 1, 0, 0);

-- Si existe pero esta vacio, actualizar
UPDATE APVENO
SET [VALUE] = 'PORTAL_PROVIDER_ID'
WHERE VENDORID = 'VENDOR_ID_AQUI'
  AND OPTFIELD = 'PROVIDERID';
```

> **Nota:** Verifica los valores de las columnas `TYPE`, `LENGTH`, etc. con un registro existente de tu base antes de insertar.

### Verificar la correccion

```bash
# Diagnosticar el pago especifico
node src/scripts/payment-uuid-diagnostic.js --py PY0061700

# Re-generar el reporte
node src/scripts/payment-reconciliation.js --py PY0061700
```

Si el PROVIDERID se registro correctamente, el pago deberia moverse de **MISSING PROVIDERID** a otra categoria (idealmente **READY TO UPLOAD**).

---

## Referencia rapida de flags

| Flag | Descripcion | Ejemplo |
|------|-------------|---------|
| `--upload` | Activa el modo de subida al portal | `--upload` |
| `--batch=N` | Limita la cantidad de pagos a subir (default: 20) | `--batch=5` |
| `--from=YYYYMMDD` | Filtra pagos en Sage a partir de esta fecha | `--from=20250101` |
| `--py DOCNBR` | Filtra un pago especifico por numero de documento | `--py PY0061652` |
| `--index=N` | Selecciona el tenant (default: 0) | `--index=1` |

---

## Scripts relacionados

| Script | Proposito |
|--------|-----------|
| `payment-reconciliation.js` | Reporte + subida batch de pagos listos |
| `payment-uuid-repair.js` | Escanear, reparar UUIDs faltantes en APIBHO |
| `payment-uuid-diagnostic.js` | Diagnostico detallado de un pago (UUID, PROVIDERID, errores) |
