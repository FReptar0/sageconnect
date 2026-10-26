---
phase: 24
slug: paginar-descarga-cfdi
status: verified
threats_open: 0
asvs_level: 1
created: 2026-10-16
---

# Fase 24 — Seguridad

> Contrato de seguridad de la fase: registro de amenazas, riesgos aceptados y bitácora de auditoría.
> Registro tomado de los `<threat_model>` de los planes 24-01 a 24-04 (escritos en la planeación); los SUMMARY no
> traen Threat Flags. Evidencia verificada contra el código en `0defe4a` (`src/utils/GetTypesCFDI.js`) y los
> SUMMARY de la fase.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Sage (APVENO.PROVIDERID) → URL del portal | El ID de proveedor sale de una columna opcional de Sage y entra a la query string de getCfdisByProvider | Identificador de configuración |
| Portal → memoria del servicio | `items` y `total` del portal deciden cuántas páginas se piden y cuánto se acumula | Volumen de datos externos |
| Portal → SQL de Sage | `cfdi.timbre.uuid` y `cfdi.receptor.rfc` se usan como literales contra FESA y la base de Sage del tenant | Datos externos hacia la base contable |
| Portal / Sage → GetTypesCFDI.log | Valores externos (UUID, RFC, providerId, códigos de error) se escriben en la bitácora de auditoría | Texto externo en el registro de auditoría |
| Filtro → descarga | Lo que el filtro deja pasar se descarga y el importador lo registra en Sage | Integridad contable (duplicados) |
| GetTypesCFDI → scripts de conciliación | `getPendingToPayInvoices` alimenta scripts que leen "no está en la lista" como "no está en el portal" | Integridad de la lista de pendientes |
| Rama local → repositorio remoto y dist | Lo que está en la rama es lo que se publica y se ofusca | Código desplegable |
| Repo del dist → zcl-rds-test | El servidor de pruebas instala lo que haya en su rama del dist | Build instalado |
| Operador → `.env` del servidor | Lectura de variables con secretos durante la verificación | Secretos |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-24-01 | Tampering | URL de getCfdisByProvider (`providerId`) | mitigate | Todo valor de la query string pasa por `encodeURIComponent` (`GetTypesCFDI.js:527`, `:553`); prueba P-04 | closed |
| T-24-02 | Denial of Service | Bucle de paginación en el servicio always-on | mitigate | Tope `CYCLE_MAX_PAGES = 50` (`:21`), corte `sin-avance` (`:601`), presupuesto = 25 % de `stepTimeoutMs` (`:368`); dedupe local a cada llamada; P-08, P-09, P-16 | closed |
| T-24-03 | Denial of Service | Reintentos que rebasan el paso de 5 min | mitigate | `requestCfdiPage` revisa el presupuesto antes de cada intento (`:449`) y no espera si la espera terminaría después del límite (`:476-479`); la única espera es `sleep()` (`:362`); P-17 | closed |
| T-24-04 | Tampering (integridad) | Lista parcial leída por los scripts de conciliación | mitigate | `getPendingToPayInvoices` sin presupuesto (`budgetMs: null`, `:808`) y con "todo o nada"; P-19 a P-23 y P-30 | closed |
| T-24-05 | Tampering (inyección en log) | `proveedor=` y `status=` en las líneas `[PAGINACION]` | mitigate | `idLog` deja pasar solo `^[A-Za-z0-9_-]{1,64}$`; si no, `valorLog` (`:404`) | closed |
| T-24-06 | Information Disclosure | Cabeceras `PDPTenantKey`/`PDPTenantSecret` | mitigate | La línea `[PAGINACION]` solo lleva consulta, tenant, conteos, tiempos, corte, offset y proveedor; nunca URL ni cabeceras (`:410-418`) | closed |
| T-24-07 | Repudiation | Corte silencioso de la lista | mitigate | Una línea `[PAGINACION]` por consulta; `warn` con la causa cuando recibidas < total (`:431`) y `error` si no llegó nada | closed |
| T-24-08 | Tampering | Interpolación SQL preexistente en `getTypeP` | accept | Fuera de alcance (D-21, REQ-24-15); la fase no agrega sitios nuevos; ver AR-24-01 | closed |
| T-24-09 | Tampering / Elevation of Privilege | SQL del filtro con UUID/RFC del portal | mitigate | Lista blanca antes del SQL: `UUID_REGEX` y `RFC_REGEX` (`:37-38`); lo que no cumple queda como `invalida` y no llega a la consulta; el lote por RFC solo toma registros válidos (`resultado === null`); F-09 | closed |
| T-24-10 | Tampering | Consulta enrutada a la base equivocada | mitigate | Base explícita en cada `runQuery` del filtro: `'FESA'` para fesaParam (`:700`) y `databases[index]` para los bloques (`:721`); F-08 | closed |
| T-24-11 | Tampering (inyección en log) | UUID/RFC inválidos en las líneas por factura | mitigate | `valorLog` = `JSON.stringify(String(v).slice(0, 64))` (`:397`); F-09 | closed |
| T-24-12 | Tampering (integridad) | Descargar sin verificar tras un error SQL | mitigate | Un bloque o RFC que falla deja sus facturas como `error-sql` y no se descargan; una excepción inesperada devuelve `[]` (`:771-773`); F-11, F-12, F-13 | closed |
| T-24-13 | Denial of Service | Volumen de consultas SQL por ciclo | mitigate | Como máximo `2 × ceil(U / 200) + R` consultas, en serie; F-08 (450 facturas con 2 RFC: ≤ 8 consultas, `maxInFlight` 1). En producción, 16-oct: 518 facturas y 91 notas de crédito → 6 consultas en total | closed |
| T-24-14 | Denial of Service (disco) | Crecimiento del log con los pendientes | mitigate | Línea por factura solo para a-descargar y anomalías (`:755-760`); las ya registradas solo suman al resumen; sin `console.log` por factura; F-14, F-15 | closed |
| T-24-15 | Tampering (integridad) | Deriva semántica del filtro | mitigate | Paridad contra el oráculo congelado con intercalación CI y CS (F-05, F-06), que también pasan contra el código anterior | closed |
| T-24-16 | Tampering | Interpolación SQL preexistente en `getTypeP` y `getTypeIToSend` | accept | Fuera de alcance (D-21, REQ-24-15); ver AR-24-02 | closed |
| T-24-17 | Repudiation (falsa confianza) | Suites nuevas | mitigate | Prueba negativa consolidada contra origin/master: 36 ✕ / 10 ✓, la clasificación esperada (`24-03-SUMMARY.md`); la del fix de la revisión, en `24-REVIEW-FIX.md` | closed |
| T-24-18 | Information Disclosure (legal) | Commits y diff de la rama | mitigate | Grep de redacción de HANDOFF.md §1 con control positivo sobre el diff y los mensajes: limpio (`24-03-SUMMARY.md`) | closed |
| T-24-19 | Tampering (despliegue) | Contenido de la rama | mitigate | Alcance exacto de 4 archivos fuera de `.planning/`, merge-base `dde4bd0`, sin cambios de dependencias (`24-03-SUMMARY.md`) | closed |
| T-24-20 | Tampering / Elevation of Privilege | Publicación a producción por error | mitigate | Push solo de la rama, por nombre y sin `--force`; `master` del repo fuente (`dde4bd0`) y del dist (`0785a9a`) intactos (`24-04-SUMMARY.md`) | closed |
| T-24-21 | Spoofing | Instalar en el servidor equivocado | mitigate | Antes del checkout se confirmó el tenant del sandbox (`t7e92apvzynif2`; producción es `t7e92ajx4dm77k`) en la bitácora del servicio de zcl-rds-test (`24-04-SUMMARY.md`) | closed |
| T-24-22 | Information Disclosure | `.env` del servidor | mitigate | El tenant se confirmó en la bitácora del servicio, sin abrir ni pegar el `.env` (`24-04-SUMMARY.md`) | closed |
| T-24-23 | Denial of Service | Build roto en test sin vuelta atrás | mitigate | Punto de regreso anotado antes del checkout: `0785a9a`, rama `master` del dist (`24-04-SUMMARY.md`) | closed |
| T-24-24 | Tampering (integridad) | Datos del sandbox y de la base de pruebas | accept | El ciclo hace lo mismo que el actual; la fase no agrega escrituras; ver AR-24-03 | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-24-01 | T-24-08 | `getTypeP` conserva sus consultas con interpolación (D-21, REQ-24-15); la fase no la toca ni agrega sitios nuevos. Queda en `.planning/codebase/CONCERNS.md` para un cambio aparte | Plan 24-01 (ejecutado con OK de Yahir Diaz) | 2026-10-08 |
| AR-24-02 | T-24-16 | Igual que AR-24-01 para `getTypeP` y `getTypeIToSend`; los sitios de `getTypeI` y `getTypeE` sí se cerraron con la lista blanca (T-24-09) | Plan 24-02 (ejecutado con OK de Yahir Diaz) | 2026-10-08 |
| AR-24-03 | T-24-24 | El ciclo en zcl-rds-test hace las mismas lecturas, descargas e importación que el ciclo actual; la fase no agrega escrituras | Plan 24-04 (ejecutado con OK de Yahir Diaz) | 2026-10-08 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-16 | 24 | 24 | 0 | Claude (gsd-secure-phase; clasificación contra el código en `0defe4a` y los SUMMARY) |

Fuera de la fase: la instalación en producción va aparte, con el control de cambios CONT-26-16.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-16
