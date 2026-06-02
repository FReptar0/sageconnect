# Acta de reunión — Criterios de reintentos y alertas

**Fecha:** miércoles 20 de mayo, 2026
**Duración:** ~35 minutos
**Asunto:** Cierre formal de criterios para política de reintentos de subida de POs/pagos al portal Focaltec + temas operativos derivados
**Cliente:** Capstone Copper
**Fuente:** transcripción `reintentos.txt` (local-only, en `.gitignore`)

## Participantes

- **Cliente:** Jose Guillermo Arredondo Lozano, Hortensia Mares Lopez, Cornelio Lopez, Gustavo Inchaurregui, Xadira
- **De nuestro lado:** Yahir Diaz, Santiago Peláez Jiménez
- **Ausentes notables:** Fernando ("Fer"), persona originalmente a cargo del proyecto

## Contexto

Guillermo abre exponiendo dos problemas recurrentes:

1. POs que se elaboran un día y se autorizan días después → SageConnect no las jala y requieren carga manual.
2. Facturas que tardan más de 15 minutos en pasarse del portal a Sage.

El correo de Yahir del 16 de mayo había planteado 4 preguntas sobre la política de reintentos. La reunión cierra esas 4 preguntas formalmente.

---

## Decisiones por pregunta

### Q1 — Hasta cuándo reintentar un documento fallido

**Opciones presentadas:**
- A (Actual): Reintentar hasta el cierre del mes.
- B: Tope de N intentos (ej. 10) y alerta inmediata.
- C: Tope de tiempo (ej. 7 días) y alerta.

**Decisión:** **Opción A** — Reintentar hasta el cierre del mes calendario. Lo que siga pendiente al cierre sale en un correo consolidado y se atiende manualmente.

> Guillermo: *"Ok, entonces sí, esta opción se aplica. La opción A, entonces."*

**Aplica:** POs y pagos por igual (Yahir confirmó *"En general"* cuando Guillermo preguntó si era para todo).

---

### Q2 — Frecuencia de reintentos

**Opciones presentadas:** secuencia propuesta (15 → 30 → 1 h → 2 h …) o más agresiva o más conservadora.

**Decisión:** **Frecuencia FIJA de 30 minutos**, con flexibilidad de bajar a 15 o 10 min posteriormente si la operación lo permite.

> Yahir: *"lo mejor sería cada 30 minutos o una hora. En caso de que sea lo más recurrente."*
>
> Hortensia: *"de reintentos yo creo que si hay media hora estaría bien."*
>
> Guillermo: *"los reintentos serían cada 30 minutos, esperando que no se empalmen."*
>
> Yahir: *"lo mejor sería dejarlos cada media hora. Vemos cómo se comporta y lo podemos ir ajustando y lo podemos ir bajando. Hasta llegar a los 10 minutos."*

**Notas:**
- El cron principal sigue cada 15 min (ejecución normal). Los reintentos son aparte, cada 30 min.
- Se descarta exponential backoff / curva geométrica. Es un intervalo fijo.
- Se quiere flexibilidad para REDUCIR el intervalo (más frecuente) si el sistema no se satura — NO para aumentarlo.

---

### Q3 — Alertas antes del cierre de mes

**Opciones presentadas:** solo correo de cierre de mes, o alerta intermedia/inmediata.

**Decisión:** **Modelo DIFERENCIADO por categoría:**

- **POs pendientes: alerta INMEDIATA** — cuando se detecte que una PO no se pudo cargar, notificar enseguida (no esperar al fin de mes).
- **Pagos pendientes: correo cada 15 DÍAS** con los pendientes acumulados.

> Guillermo (POs): *"órdenes de compra pendientes... requerimos que sea más continuo porque los proveedores suben facturas todos los días... no sería bueno que fuera cada mes... Ok, entonces que sea un alerta inmediata, ¿no?"*
>
> Yahir: *"Sí, en orden de compra sí estaría muy bien."*
>
> Guillermo (pagos): *"Y en pagos a lo mejor cada 15 días sí estaría perfecto."*

**Justificación del cliente (textual):** los proveedores suben facturas a diario y si la PO no está en el portal, los proveedores empiezan a reclamar. Por eso PO=inmediata. Pagos tiene cadencia natural quincenal (cuentas por pagar hace pagos 2 veces al mes oficialmente), por eso pagos=cada 15 días.

---

### Q4 — Manejo de errores permanentes (no reintentables)

**Opciones presentadas:**
- A (Actual): Reintentar de todas formas.
- B: Solo reintentar errores temporales de servidor.
- C: Definir códigos de error no reintentables.

**Decisión:** **Opción A** — Reintentar de todas formas.

> Guillermo: *"así como lo pusiste aquí, así está. Ah, reintentar de todas formas."*

---

## Temas adicionales tratados (fuera de las 4 preguntas)

### A. Botón manual para forzar sincronización (compromiso pendiente)

Guillermo pide la posibilidad de que almacén y cuentas por pagar puedan disparar el procesamiento manualmente desde el bastión, sin esperar el ciclo automático de 15/30 min.

> Santiago: *"así como te aparece el iconito de Sage, te va a aparecer un botoncito... porque es una dirección de Internet que está en el servidor."*

**Estado en la reunión:** *"Fer decía que ya casi estaba listo y que nada más era hablar con sistemas... Jorge o Alan"* para los accesos. Pendiente de coordinación con IT del cliente.

**Acción pendiente:** validar estado real de este desarrollo (Fer ya no está) y completar la coordinación con Jorge/Alan para los accesos en el bastión.

### B. Incidente del cierre de abril (28-29) + compromiso operativo

Guillermo reporta que SageConnect falló durante el cierre del mes anterior (28-29 abril): no traía facturas del portal a Sage en pleno cierre. Afectó a almacén (Cornelio se vio detenido toda la mañana).

> Santiago: *"si se necesita hacer alguna actualización de la versión que está trabajando de SageConnect, por favor... que se confirme con memo precisamente la actualización para que veamos que no se cruza el cierre."*

**Compromiso operativo:** ANTES de cualquier despliegue/actualización futura de SageConnect, confirmar con Guillermo (Memo) que no se atraviesa la ventana de cierre de mes.

### C. Problema con POs de recepción parcial → piezas en cero (relacionado con Phase 21)

Reporte desde almacén: cuando una PO se recibe parcialmente (ej: PO de 20 piezas, se reciben 10) y el proveedor intenta subir su factura, le aparecen 0 piezas disponibles cuando deberían quedar 10.

> Hortensia: *"ahorita, si ustedes están generando una orden de compra con 20 piezas, tu proveedor genera una factura por 10, selecciona la orden de compra y le pone 10, pues en el sistema debieran de estar todavía las 10 remanentes. Entonces ahí sí tenemos que revisar realmente qué está pasando."*
>
> Santiago: *"tenemos que checar cómo está tomando todavía la validación de la query, que no nos cierre la compra hasta que se haya subido la factura."*

**Acción pendiente (Santiago a Yahir):** *"hay que identificar de los procesos el que actualiza los estatus para ver cómo está disparándose esa condicional."*

**Nexo con Phase 21:** este es exactamente el síntoma de la política de pagos parciales que Phase 21 debe resolver. Cornelio se compromete a mandar un caso específico (orden de Mitsu) por correo para análisis.

### D. Acceso al portal de proveedores

Yahir queda agregado al portal con rol Supervisor (en sustitución de Fernando, próximamente). Documentación de cambio enviada a sistemas del cliente.

---

## Acciones derivadas

| # | Acción | Responsable | Estado |
|---|---|---|---|
| 1 | Documentar formal estas decisiones | Yahir | ✅ Este documento |
| 2 | Implementar las decisiones en el código de Phase 20 | Yahir / equipo | 🔴 Pendiente — el código actual NO refleja Q2 ni Q3 (ver `DEVIATIONS.md`) |
| 3 | Coordinar con Jorge/Alan los accesos para el botón manual en bastión | Santiago + cliente | 🟡 Pendiente |
| 4 | Avisar a Memo antes de cualquier despliegue / actualización | Yahir | 🟡 Recordatorio permanente |
| 5 | Investigar el cierre prematuro de POs en recepción parcial (Phase 21) | Yahir | 🟡 Esperando caso de Cornelio |
| 6 | Cambio de cuenta portal — Yahir como supervisor | Cliente sistemas (Jorge) | 🟡 En curso |

---

## Referencia

- **Transcripción fuente:** `reintentos.txt` (local-only, ignorada por git)
- **Correo cliente con las 4 preguntas:** Jose Guillermo Arredondo Lozano, 16 de mayo 2026, 13:04
- **Phase 20:** `.planning/phases/20-cron-retry-policy-eom-notification/`
- **Discrepancias contra código actual:** `DEVIATIONS.md` en este mismo directorio

---

*Acta levantada el 2026-06-02 a partir de la transcripción de la reunión del 2026-05-20.*
