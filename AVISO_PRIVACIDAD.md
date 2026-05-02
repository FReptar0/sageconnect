# Aviso de Privacidad — SageConnect

**Versión:** 1.0
**Vigente desde:** 2 de mayo de 2026
**Tipo:** Aviso de Privacidad Simplificado de No Recolección (LFPDPPP Art. 16-17)

---

## 1. Identidad y Domicilio del Responsable

**Responsable:** Fernando Rodríguez Memije
**Domicilio para efectos del presente Aviso:** Ciudad de México, México
**Correo electrónico de contacto:** <fmemije00@gmail.com>
**Software:** SageConnect (sistema de integración entre Sage 300 ERP y Portal de Proveedores)

---

## 2. Declaración Esencial

**SageConnect NO recolecta, transmite, almacena ni procesa datos personales de personas físicas.**

El presente Aviso de Privacidad se emite de manera proactiva como medida de transparencia y defensa preventiva, aún cuando el Software queda fuera del ámbito material de aplicación de la **Ley Federal de Protección de Datos Personales en Posesión de los Particulares ("LFPDPPP")** por las razones expuestas en la sección 4.

---

## 3. Datos Procesados por el Software (Operación Normal)

Durante su operación normal en los servidores del cliente (**Licenciatario**), SageConnect procesa los siguientes tipos de información:

| Categoría | Permanencia | Sale del servidor del cliente |
|-----------|-------------|-------------------------------|
| Registros contables y financieros del ERP Sage 300 | En servidor del cliente únicamente | **NO** |
| CFDI (comprobantes fiscales digitales) | En servidor del cliente únicamente | **NO** |
| Datos de proveedores (RFC, razón social, datos bancarios) | En servidor del cliente únicamente | **NO** |
| Datos de pagos y órdenes de compra | En servidor del cliente únicamente | **NO** |
| Credenciales del Portal de Proveedores (api_key, secret) | En `.env` del servidor del cliente | **NO** |

**Toda la información procesada por SageConnect permanece exclusivamente en los servidores controlados por el Licenciatario.** El Licenciante (Fernando Rodríguez Memije / Tersoft) no tiene acceso técnico, contractual ni operativo a dicha información en ningún momento del ciclo de vida del Software.

---

## 4. Único Dato Transmitido al Licenciante: Identificador de Licencia

### 4.1 ¿Qué se transmite?

Durante la validación periódica de licencia (cláusula 1.3 del EULA), SageConnect envía **únicamente** el siguiente dato al servidor de validación operado por el Licenciante:

```
GET /api/validate?key=<SAGECONNECT_API_KEY>
```

donde `SAGECONNECT_API_KEY` es un **identificador único alfanumérico** asignado por el Licenciante al Licenciatario (persona moral / empresa) al momento de la firma del contrato de licencia.

### 4.2 ¿Por qué este dato NO es "dato personal" bajo LFPDPPP?

El artículo 3, fracción V de la LFPDPPP define:

> "**Datos personales:** Cualquier información concerniente a una persona física identificada o identificable."

El identificador `SAGECONNECT_API_KEY`:

1. **No identifica a una persona física.** Está vinculado a una persona moral (empresa cliente).
2. **No es información concerniente a un individuo.** Es un token criptográfico generado para autenticar a una empresa.
3. **No permite identificación indirecta de personas físicas.** No contiene nombre, RFC personal, correo personal, teléfono, dirección, ni cualquier otro elemento que pueda asociarse razonablemente a un individuo.

Por lo tanto, la transmisión del `SAGECONNECT_API_KEY` **queda fuera del ámbito de aplicación de la LFPDPPP** (Art. 2 fracción I).

### 4.3 Logs del Servidor de Validación

El servidor de validación operado por el Licenciante registra metadata estándar de servidor:

| Campo | Naturaleza | Período de retención |
|-------|-----------|---------------------|
| Dirección IP del servidor solicitante | IP de servidor empresarial (persona moral) | 12 meses |
| Marca de tiempo de la solicitud | Metadato técnico | 12 meses |
| `SAGECONNECT_API_KEY` recibido | Identificador de empresa | 12 meses |
| Resultado de validación (válido/inválido) | Metadato técnico | 12 meses |

**Justificación de no aplicación de LFPDPPP a estos logs:**

- La dirección IP corresponde al servidor del Licenciatario (típicamente un Windows Server alojado en infraestructura corporativa del cliente, p. ej. `ZCL-RDS-02`), **no a un dispositivo personal**.
- INAI ha sostenido en criterios orientadores que las direcciones IP de servidores empresariales en contexto B2B no constituyen datos personales de personas físicas cuando no permiten la identificación de un individuo.
- Aún en la interpretación más amplia, el agregado de IP+timestamp+API key no permite identificar a una persona física específica, sino únicamente a la persona moral Licenciataria.

---

## 5. Finalidades del Tratamiento

El identificador único de licencia (`SAGECONNECT_API_KEY`) y los logs descritos en la sección 4.3 son utilizados exclusivamente para:

1. **Verificar la vigencia y validez de la licencia comercial** entre el Licenciante y el Licenciatario.
2. **Registrar y auditar incidencias de seguridad** (intentos de validación con claves inválidas, ataques de fuerza bruta, anomalías de tráfico).
3. **Cumplir obligaciones contractuales** y, en su caso, ejercer derechos de revocación previstos en el EULA cláusula 4.

**No se utilizan para ningún otro fin**, incluyendo de forma enunciativa más no limitativa: marketing, análisis de comportamiento, perfilamiento, transferencia a terceros, o cualquier finalidad ajena a la administración de la licencia.

---

## 6. Transferencias

**El Licenciante NO transfiere ningún dato a terceros**, salvo en los siguientes supuestos previstos por el artículo 37 de la LFPDPPP (aún cuando técnicamente no aplique al no haber datos personales):

1. **Cuando sea requerido por orden judicial o autoridad competente** debidamente fundada y motivada.
2. **Para el cumplimiento de obligaciones legales** del Licenciante.

Los logs del servidor de validación son procesados exclusivamente por el Licenciante y por su proveedor de infraestructura en la nube (actualmente **Vercel Inc.**, mediante hosting del servidor en `sageconnect-license.vercel.app`), bajo los términos de servicio estándar de dicho proveedor.

---

## 7. Datos Procesados por el Cliente (Operador) — Fuera del Alcance de Tersoft

SageConnect, en su operación normal en el servidor del Licenciatario, procesa información que el Licenciatario configura directamente en su archivo `.env`, incluyendo de manera enunciativa:

- `LICENSE_ADMIN_EMAIL` — correo electrónico del administrador del Licenciatario para notificaciones operativas
- `MAILING_NOTICES`, `MAILING_CC` — destinatarios de notificaciones operativas
- Otros datos de contacto del personal técnico del Licenciatario

**Estos datos NUNCA salen del servidor del Licenciatario.** Son utilizados localmente por el Software para enviar correos de notificación operativa (timeouts, validaciones fallidas del XML, etc.) desde el servidor SMTP configurado por el propio Licenciatario.

El Licenciatario es el **responsable** del tratamiento de estos datos personales bajo LFPDPPP. El Licenciante actúa exclusivamente como proveedor de software (no como encargado ni responsable del tratamiento de tales datos).

---

## 8. Derechos ARCO del Titular

Aún cuando el Licenciante no procesa datos personales de personas físicas, en cumplimiento del principio de transparencia se informa que cualquier persona física que considere haber sido afectada por el tratamiento de datos personales en relación con SageConnect podrá ejercer sus derechos de **Acceso, Rectificación, Cancelación y Oposición ("ARCO")** mediante solicitud por escrito al correo electrónico de contacto especificado en la sección 1, conforme al procedimiento del artículo 29 de la LFPDPPP.

**Plazo de respuesta:** 20 días hábiles desde la recepción de la solicitud, conforme al artículo 32 de la LFPDPPP.

---

## 9. Autoridad Competente

En caso de considerar vulnerados sus derechos en materia de protección de datos personales, el titular podrá acudir a:

**Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales (INAI)**
Insurgentes Sur 3211, Col. Insurgentes Cuicuilco, Alcaldía Coyoacán, C.P. 04530, Ciudad de México, México
Sitio web: https://home.inai.org.mx
Tel: 55 5004 2400

---

## 10. Cambios al Aviso de Privacidad

Cualquier modificación al presente Aviso de Privacidad será publicada en el repositorio oficial del Software (https://github.com/FReptar0/sageconnect) y notificada al `LICENSE_ADMIN_EMAIL` configurado por el Licenciatario al menos 15 días naturales antes de su entrada en vigor, conforme al artículo 24 del Reglamento de la LFPDPPP.

---

## 11. Aceptación

La instalación, acceso o uso de SageConnect por parte del Licenciatario constituye aceptación expresa del presente Aviso de Privacidad y del EULA al que se encuentra vinculado.

---

## 12. Resumen para Operadores Técnicos

| Pregunta | Respuesta |
|----------|-----------|
| ¿SageConnect manda mis datos a Tersoft? | **No.** Solo manda tu API key (identificador de empresa). |
| ¿Manda CFDIs, pagos, datos de proveedores? | **No.** Esos datos jamás salen de tu servidor. |
| ¿Manda mi nombre, correo, RFC personal? | **No.** Nunca. |
| ¿Qué pasa si me hacen una auditoría INAI? | Este Aviso documenta que no recolectamos datos personales, así que estás protegido. |
| ¿Qué hago si tengo dudas? | Escribe a `fmemije00@gmail.com`. |

---

**Fernando Rodríguez Memije**
Licenciante / Responsable
Ciudad de México, México
2 de mayo de 2026

Para términos completos del contrato de licencia, ver `EULA.md`.
Para reportes de seguridad, ver `SECURITY.md`.
