# Guia de Despliegue -- SageConnect (v2.3)

Procedimiento completo para desplegar SageConnect como servicio de Windows usando Servy.

> **Contexto de uso de este documento:**
> - Las **Secciones 1-4** (Prerequisitos, Cutover inicial, Verificacion, Comandos utiles) describen la **instalacion inicial** de Servy en un servidor nuevo. Es un procedimiento de una sola vez.
> - Para el **deploy del dia a dia** (actualizar el codigo a la ultima version), se hace `git fetch && git reset --hard origin/master` contra el repo dist (`E:\sageconnect-dist`). Ver § "Deploy continuo" mas abajo y [`OPERATIONS.md`](OPERATIONS.md) para el flujo operativo completo.
> - La **Seccion 5 (Rollback)** original describia volver a `RunSageconnect.bat` (v1.x). Ese metodo esta **obsoleto desde v2.0**; el rollback real es `git reset --hard <SHA-anterior>` en el repo dist. Ver § "Rollback (v2.3)" mas abajo.
> - El servidor de produccion actual de Capstone Copper se llama `ZCL-RDS-02` y el SQL Server `ZCL-SQL-01`. La base de datos Sage 300 se llama `COPDAT` (inmutable). Ver `OPERATIONS.md` para mas paths/identificadores.

## 1. Prerequisitos

Antes de iniciar el despliegue, verificar que los siguientes componentes estan instalados y configurados en el servidor de produccion:

| Componente | Version | Verificacion |
|------------|---------|-------------|
| Node.js | v22.15.0 | `node --version` |
| Servy | v7.0+ | `servy-cli --version` |
| Codigo (dist obfuscado) | -- | Desplegado en `E:\sageconnect-dist` (clon del repo `FReptar0/sageconnect-dist`) |
| Archivo `.env` | -- | Configurado en `E:\sageconnect-dist\.env` |

### Instalar Servy

Si Servy no esta instalado en el servidor:

```powershell
winget install servy
```

Despues de instalar, **reiniciar la terminal** para que `servy-cli` este disponible en el PATH.

### Verificar archivo .env

El archivo `.env` debe existir en `E:\sageconnect-dist\.env` con todas las variables de configuracion necesarias (base de datos, API keys, etc.). Consultar `.env.example` como referencia.

---

## 2. Procedimiento de Cutover

> **Tiempo estimado de inactividad:** 5-10 minutos

### Paso 1: Detener la tarea programada

Abrir **Windows Task Scheduler** y deshabilitar la tarea que ejecuta `RunSageconnect.bat`.

```powershell
# Verificar que la tarea esta deshabilitada
Get-ScheduledTask | Where-Object { $_.TaskName -like "*SageConnect*" -or $_.TaskName -like "*sageconnect*" }
```

### Paso 2: Verificar que no hay procesos node.exe corriendo

```powershell
tasklist /fi "imagename eq node.exe"
```

Si hay procesos de SageConnect activos, detenerlos:

```powershell
# Solo si es necesario -- verificar que son procesos de SageConnect antes de terminarlos
taskkill /fi "imagename eq node.exe" /f
```

### Paso 3: Sincronizar codigo obfuscado desde dist

Tomar el ultimo build obfuscado desde `FReptar0/sageconnect-dist` e instalar dependencias:

```powershell
cd E:\sageconnect-dist
git fetch origin master
git log origin/master --oneline -5    # verificar que el SHA esperado esta presente
git reset --hard origin/master         # NO usar `git pull` — el dist se force-pushea
npm ci --omit=dev
```

> **Nota:** el flag `--omit=dev` reemplaza el viejo `--production` (deprecado en npm v7+). `git pull` no funciona en el repo dist porque la GitHub Action `obfuscate-deploy.yml` hace `git push --force` cada vez (cada obfuscacion produce historia diferente).

Verificar que el archivo de entrada existe:

```powershell
Test-Path E:\sageconnect-dist\src\index.js
```

### Paso 4: Ejecutar script de instalacion como Administrador

Abrir **PowerShell como Administrador** y ejecutar:

```powershell
cd E:\sageconnect-dist
.\scripts\install-service.ps1
```

El script realiza las siguientes validaciones automaticamente:
- Verifica permisos de Administrador
- Verifica que `servy-cli` esta en el PATH
- Verifica que Node.js esta instalado
- Verifica que el directorio de instalacion contiene `src/index.js`
- Verifica que el servicio no existe (idempotente)

Si el servicio ya existe, el script termina sin hacer cambios.

**Parametros opcionales:**

```powershell
.\scripts\install-service.ps1 -InstallDir "D:\apps\sageconnect" -NodePath "D:\nodejs\node.exe" -Port 3031
```

### Paso 5: Verificar que el servicio esta corriendo

```powershell
Get-Service SageConnect
```

El estado debe ser `Running`.

Visitar el dashboard web en el navegador:

```
http://localhost:3030/schedule.html
```

---

## 3. Verificacion

Despues de completar el cutover, verificar cada uno de estos puntos:

| Verificacion | Comando / URL | Resultado esperado |
|-------------|---------------|-------------------|
| Servicio corriendo | `Get-Service SageConnect` | Status: Running |
| Health check | `http://localhost:3030/api/system/health` | `{ "status": "ok", "uptime": ... }` |
| Dashboard web | `http://localhost:3030` | Pagina de programacion visible |
| Programacion de tareas | `http://localhost:3030/schedule.html` | Proxima ejecucion programada visible |
| Logs del servicio | `Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Tail 20` | Mensajes de inicio del servidor |

### Verificacion adicional

```powershell
# Verificar que el servicio esta configurado para inicio automatico
Get-Service SageConnect | Select-Object Name, Status, StartType

# Verificar que el puerto 3030 esta escuchando
netstat -ano | findstr :3030
```

---

## 4. Comandos Utiles

### Administracion del servicio

```powershell
# Ver estado del servicio
Get-Service SageConnect
servy-cli status --name=SageConnect

# Reiniciar servicio
Restart-Service SageConnect
servy-cli restart --name=SageConnect

# Detener servicio
Stop-Service SageConnect
servy-cli stop --name=SageConnect

# Iniciar servicio
Start-Service SageConnect
servy-cli start --name=SageConnect

# Desinstalar servicio (requiere Administrador)
servy-cli uninstall --name=SageConnect
```

### Logs

```powershell
# Ver ultimas lineas del log de stdout
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Tail 50

# Ver ultimas lineas del log de stderr
Get-Content E:\sageconnect-dist\logs\servy-stderr.log -Tail 50

# Seguir log en tiempo real
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Wait -Tail 20

# Logs de la aplicacion (generados por la app, no por Servy)
Get-ChildItem E:\sageconnect-dist\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

### Configuracion de Servy

El servicio esta configurado con:

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| `startupType` | Automatic | Inicia automaticamente al encender el servidor |
| `recoveryAction` | RestartService | Reinicia automaticamente si el proceso falla |
| `maxRestartAttempts` | 5 | Maximo de intentos de reinicio antes de detenerse |
| `heartbeatInterval` | 30s | Intervalo de monitoreo de salud del proceso |
| `maxFailedChecks` | 3 | Checks fallidos antes de activar recuperacion |
| `rotationSize` | 10 MB | Tamano maximo de archivo de log antes de rotar |
| `maxRotations` | 5 | Maximo de archivos de log rotados a conservar |
| `stopTimeout` | 30s | Tiempo de espera para cierre graceful antes de forzar |

---

## 5. Deploy continuo (dia a dia)

Una vez que la instalacion inicial (Secciones 1-4) esta completa, los updates rutinarios siguen este flujo. El GitHub Action `obfuscate-deploy.yml` hace force-push del `dist/` obfuscado a `FReptar0/sageconnect-dist` cada vez que el source master se actualiza; el servidor solo necesita sincronizarse.

```powershell
# 1. Detener el servicio (libera handles de log y permite que el codigo nuevo cargue limpio)
Stop-Service SageConnect

# 2. Sincronizar desde el repo dist (NUNCA git pull — siempre reset --hard porque el dist es force-pushed)
cd E:\sageconnect-dist
git fetch origin master
git log origin/master --oneline -5     # diagnostico — el SHA del top debe matchear el ultimo build
git reset --hard origin/master

# 3. Instalar dependencias (npm ci es deterministico contra package-lock.json)
npm ci --omit=dev

# 4. Reiniciar el servicio
Start-Service SageConnect

# 5. Verificar
Get-Service SageConnect                                                   # Running
Invoke-WebRequest http://localhost:3030/api/system/health | Select Content
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Tail 20            # banner de arranque + licencia VALID
```

**No correr `node scripts/obfuscate.js` manualmente** — la obfuscacion la hace el GitHub Action en cada push a master del repo source. Si el dist no tiene el commit esperado, revisar la pestana Actions del repo source antes de tocar el servidor.

## 6. Rollback (v2.3)

Si el deploy mas reciente introdujo una regresion, volver al SHA anterior del repo dist. No hay rollback al "metodo viejo" (`RunSageconnect.bat`) porque ese metodo desaparecio en v2.0.

```powershell
# 1. Identificar el SHA anterior (el commit previo en dist corresponde al deploy previo)
cd E:\sageconnect-dist
git log origin/master --oneline -10

# 2. Detener el servicio
Stop-Service SageConnect

# 3. Reset al SHA anterior
git reset --hard <sha-anterior>

# 4. Reinstalar dependencias (puede no ser necesario si package-lock no cambio, pero seguro)
npm ci --omit=dev

# 5. Re-arrancar y verificar
Start-Service SageConnect
Get-Service SageConnect
Get-Content E:\sageconnect-dist\logs\servy-stdout.log -Tail 20
```

Una vez confirmado el rollback, el siguiente push a master del repo source generara un nuevo build en dist que potencialmente reintroducira el bug. Asegurarse de que el fix correspondiente este mergeado al source ANTES de re-ejecutar el deploy continuo.

---

## 6. Troubleshooting

### El servicio no inicia

1. **Verificar .env:** Asegurarse de que el archivo `.env` existe y tiene todas las variables necesarias.

   ```powershell
   Test-Path E:\sageconnect-dist\.env
   ```

2. **Revisar logs de error:**

   ```powershell
   Get-Content E:\sageconnect-dist\logs\servy-stderr.log -Tail 50
   ```

3. **Probar ejecucion manual:** Intentar correr la aplicacion directamente para ver errores:

   ```powershell
   cd E:\sageconnect-dist
   node src/index.js
   ```

### Puerto 3030 ocupado

1. **Identificar el proceso que ocupa el puerto:**

   ```powershell
   netstat -ano | findstr :3030
   ```

2. **Terminar el proceso** (usar el PID del paso anterior):

   ```powershell
   taskkill /pid <PID> /f
   ```

3. **Reiniciar el servicio:**

   ```powershell
   Start-Service SageConnect
   ```

### servy-cli no encontrado

1. **Instalar Servy:**

   ```powershell
   winget install servy
   ```

2. **Reiniciar la terminal** (PowerShell o CMD) para actualizar el PATH.

3. **Verificar instalacion:**

   ```powershell
   servy-cli --version
   ```

### El servicio se detiene despues de varios reinicios

Si Servy alcanzo el limite de `maxRestartAttempts` (5), el servicio se detiene automaticamente.

1. **Investigar la causa raiz** revisando los logs.
2. **Resolver el problema** (configuracion, dependencias, etc.).
3. **Reiniciar manualmente:**

   ```powershell
   Start-Service SageConnect
   ```

### Conexion a base de datos falla

1. **Verificar variables en .env:** los nombres reales son `DB_USER`, `DB_PASSWORD`, `SERVER` (hostname/IP), `DATABASE` (nombre de la BD). En el deploy de Capstone, `SERVER=ZCL-SQL-01` y `DATABASE=COPDAT`.
2. **Probar conectividad al servidor SQL:**

   ```powershell
   Test-NetConnection -ComputerName <SERVER> -Port 1433
   ```

3. **Revisar logs de la aplicacion** (`E:\sageconnect-dist\logs\sageconnect\YYYY-MM-DD\*.log`) para el mensaje de error especifico.

### Errores `Invalid object name` contra tablas Sage (APBTA, POPORH1, APVENO, BKACCT, APTCR, etc.)

**NO** es porque la base de datos sea la incorrecta — `COPDAT` es el nombre del DB Sage 300 (impuesto por Sage, no se puede renombrar). Investigar:

1. Schema implicito en la query — todas las tablas Sage estan en `dbo`, asegurar que la query usa `[COPDAT].dbo.<TABLE>`.
2. Permisos del login `sage` en COPDAT (mapeado como `dbo` por convencion).
3. Contexto `USE [DB]` — `runQuery(query, database)` siempre prepende `USE [database]` desde PR #16. Si el caller no pasa `database` explicito, usa `config.database.database` que es `COPDAT` en prod. Verificar que el caller no este pasando un default antiguo (`'FESA'`) inadvertidamente — ese fue el bug de PR #16/#19.
4. Errores de tipo o prefijo (`APBTA` vs `APBTA1`) — verificar contra el schema de Sage real.
