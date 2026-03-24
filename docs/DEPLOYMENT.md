# Guia de Despliegue -- SageConnect v2.0

Procedimiento completo para desplegar SageConnect como servicio de Windows usando Servy.

## 1. Prerequisitos

Antes de iniciar el despliegue, verificar que los siguientes componentes estan instalados y configurados en el servidor de produccion:

| Componente | Version | Verificacion |
|------------|---------|-------------|
| Node.js | v22.15.0 | `node --version` |
| Servy | v7.0+ | `servy-cli --version` |
| Codigo v2.0 | -- | Desplegado en `E:\sageconnect` |
| Archivo `.env` | -- | Configurado en `E:\sageconnect\.env` |

### Instalar Servy

Si Servy no esta instalado en el servidor:

```powershell
winget install servy
```

Despues de instalar, **reiniciar la terminal** para que `servy-cli` este disponible en el PATH.

### Verificar archivo .env

El archivo `.env` debe existir en `E:\sageconnect\.env` con todas las variables de configuracion necesarias (base de datos, API keys, etc.). Consultar `.env.example` como referencia.

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

### Paso 3: Desplegar codigo v2.0

Copiar los archivos del codigo v2.0 al directorio de produccion e instalar dependencias:

```powershell
cd E:\sageconnect
npm install --production
```

Verificar que el archivo de entrada existe:

```powershell
Test-Path E:\sageconnect\src\index.js
```

### Paso 4: Ejecutar script de instalacion como Administrador

Abrir **PowerShell como Administrador** y ejecutar:

```powershell
cd E:\sageconnect
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
| Logs del servicio | `Get-Content E:\sageconnect\logs\servy-stdout.log -Tail 20` | Mensajes de inicio del servidor |

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
Get-Content E:\sageconnect\logs\servy-stdout.log -Tail 50

# Ver ultimas lineas del log de stderr
Get-Content E:\sageconnect\logs\servy-stderr.log -Tail 50

# Seguir log en tiempo real
Get-Content E:\sageconnect\logs\servy-stdout.log -Wait -Tail 20

# Logs de la aplicacion (generados por la app, no por Servy)
Get-ChildItem E:\sageconnect\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 10
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

## 5. Rollback

Si el servicio de Servy presenta problemas y es necesario volver al metodo anterior:

### Paso 1: Detener y desinstalar el servicio

```powershell
Stop-Service SageConnect
servy-cli uninstall --name=SageConnect
```

### Paso 2: Restaurar RunSageconnect.bat

Restaurar el archivo `RunSageconnect.bat` desde el backup del servidor (no esta en el repositorio).

Contenido original del archivo:

```batch
@echo off
cd /d E:\sageconnect
npm start
```

### Paso 3: Re-habilitar tarea programada

Abrir **Windows Task Scheduler** y habilitar la tarea que ejecuta `RunSageconnect.bat`.

### Nota importante

El codigo v2.0 sigue funcionando correctamente con `npm start` -- no requiere revertir el codigo. El rollback solo cambia el metodo de ejecucion (de servicio Servy a tarea programada).

---

## 6. Troubleshooting

### El servicio no inicia

1. **Verificar .env:** Asegurarse de que el archivo `.env` existe y tiene todas las variables necesarias.

   ```powershell
   Test-Path E:\sageconnect\.env
   ```

2. **Revisar logs de error:**

   ```powershell
   Get-Content E:\sageconnect\logs\servy-stderr.log -Tail 50
   ```

3. **Probar ejecucion manual:** Intentar correr la aplicacion directamente para ver errores:

   ```powershell
   cd E:\sageconnect
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

1. **Verificar variables en .env:** `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`.
2. **Probar conectividad al servidor SQL:**

   ```powershell
   Test-NetConnection -ComputerName <DB_HOST> -Port 1433
   ```

3. **Revisar logs de la aplicacion** para el mensaje de error especifico.
