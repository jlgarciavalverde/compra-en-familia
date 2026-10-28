# Operaciones

[← Documentación](README.md) · [README del proyecto](../README.md)

Manual para quien mantiene el servidor. Convenciones de desarrollo en `AGENTS.md`; despliegue paso a paso en `.kimi-code/skills/deploy/SKILL.md`.

## Piezas

| Qué | Dónde |
|---|---|
| App (API + web) | contenedor `compra` en el VPS, `~/servicios/compra/` (compose sin puertos publicados) |
| Acceso público | túnel de Cloudflare → `http://compra:3000` (`compra.redgarverde.com`) |
| Datos | `~/servicios/compra/data/` (`compra.db`, `backups/`, `downloads/`) |
| Secretos | `~/servicios/compra/.env` (600): `SETUP_CODE`, opcionalmente `PUBLIC_URL`, `AUTH_RATE_LIMIT` |
| Clave de firma del APK | `~/.android-keystores/` **en el Mac** (fuera del repo) |

Las claves VAPID de las notificaciones se generan solas la primera vez y viven en la base de datos (`kv`).

## Variables de entorno

API:

| Variable | Defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de escucha |
| `DATA_DIR` | `data` | Directorio con `compra.db` y `backups/` |
| `SETUP_CODE` | — | Código que exige el primer registro (crea el hogar). Sin él, la API no se puede inicializar |
| `ALLOWED_ORIGINS` | prod: `https://compra.redgarverde.com` · dev: además las variantes de `localhost` | Orígenes CORS permitidos |
| `PUBLIC_URL` | `https://compra.redgarverde.com` | URL pública (sujeto VAPID de los avisos push) |
| `APP_VERSION` | `0.0.0` | Versión que informa `/health` |
| `AUTH_RATE_LIMIT` | interno | Máximo de peticiones por minuto e IP en las rutas de autenticación |
| `LOG_LEVEL` | `info` | Nivel de log (pino) |
| `WEB_DIR` | `web` | Directorio del build estático de la web |

Web (al compilar): `VITE_API_URL`, `VITE_PUBLIC_URL`.

## Imagen de Docker

Imagen única y multi-stage (`Dockerfile`), que corre como `USER node`:

```bash
docker build --build-arg APP_VERSION=$(git describe --tags 2>/dev/null || echo 0.0.0) -t compra-en-familia:<versión> .
```

En el VPS (`deploy/docker-compose.yml`): Docker rootless, sin puertos publicados, rootfs de solo lectura, `cap_drop: [ALL]` y límite de 512 MiB y 1 CPU.

## Desplegar una versión

Ver la skill `deploy`. Resumen: build de la imagen en el Mac (`linux/amd64`), `docker save | ssh docker load`, **parar → copiar `data/` a `data-pre-<versión>` → `up`**, y comprobar `healthy`, `/health` y el dominio. Las migraciones (`db.ts`, `PRAGMA user_version`) son lineales y no tienen vuelta atrás: la copia previa es el rollback.

## Copias de seguridad

Tres capas:

1. **La app**, cada 6 h: `data/backups/compra-AAAA-MM-DD.db` (una por día, 14 días). Copia consistente (`VACUUM INTO`).
2. **El VPS**: `~/servicios/backup.sh` → `~/backups/<fecha>/` (compra + Nextcloud, 8 copias), en el mismo disco que el servicio. Se ejecuta cada domingo a las 3:00 con el cron del usuario.
3. **Fuera del servidor**: `scripts/pull-backups.sh` trae a este Mac la última copia de la app y **comprueba su integridad** (`PRAGMA integrity_check`) antes de guardarla en `~/Backups/compra-en-familia/` (14 copias). Es la que protege de un fallo de disco del VPS.

Para que la tercera se haga sola cada día a las 21:00 (Mac encendido), crear `~/Library/LaunchAgents/es.redgarverde.compra-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>es.redgarverde.compra-backup</string>
  <key>ProgramArguments</key><array>
    <string>/Users/joseluis/proyectos/compra-en-familia/scripts/pull-backups.sh</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/compra-backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/compra-backup.log</string>
</dict></plist>
```

y `launchctl load ~/Library/LaunchAgents/es.redgarverde.compra-backup.plist`.

### Restaurar

```bash
ssh joseluis@192.168.18.7
cd ~/servicios/compra
docker compose stop
cp -a data data-antes-de-restaurar            # por si acaso
rm -f data/compra.db data/compra.db-wal data/compra.db-shm
cp data/backups/compra-AAAA-MM-DD.db data/compra.db   # o subir una del Mac con scp
docker compose up -d
docker logs compra --tail 20                   # debe arrancar sin errores
```

Conviene **ensayarlo** de vez en cuando con `sqlite3 <copia> "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM lists;"`, que es lo que hace `pull-backups.sh` en cada copia.

## App de Android (TWA)

El APK no lleva código: abre `https://compra.redgarverde.com` a pantalla completa con Chrome. Por eso **las actualizaciones de la web llegan solas**; solo hace falta regenerar el APK si cambian el icono, el nombre, los colores o la clave de firma.

- Verificación de dominio: `apps/web/public/.well-known/assetlinks.json` (paquete `com.redgarverde.compra` + huella SHA-256 de la clave). Si no coincide con la clave con la que se firma, la app muestra la barra de direcciones de Chrome.
- Compilar (Mac): `cd tools/twa && pnpm install --ignore-workspace && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools node build.mjs <versión>`. Deja `build/compra-en-familia.apk` y `build/version.json`. Necesita JDK 21 y el SDK de Android (platform 35, build-tools 35).
- Publicar (sin redesplegar la imagen): `scp tools/twa/build/compra-en-familia.apk tools/twa/build/version.json joseluis@192.168.18.7:servicios/compra/data/downloads/`. La app lo sirve en `/app.apk` y `/version.json` y Ajustes muestra el botón de descarga.
- **La clave de firma es insustituible.** `~/.android-keystores/compra-en-familia.jks` y su `.properties`: guarda una copia fuera del Mac (gestor de contraseñas o disco cifrado). Si se pierde, hay que instalar otra app nueva, cambiar `assetlinks.json` y volver a instalar en cada móvil.

## Notificaciones push

Web Push estándar (VAPID), sin Firebase ni cuentas de terceros: el servidor habla con el servicio de push del navegador de cada móvil. Solo se aceptan destinos de servicios conocidos (Google, Mozilla, Microsoft, Apple) para que nadie pueda usar el servidor contra la red de casa. Los avisos seguidos se agrupan (30 s). Una suscripción que el servicio da por muerta (404/410) se elimina sola.

## Seguridad — resumen operativo

- Contraseñas con scrypt; sesiones opacas (solo se guarda su hash), 90 días de inactividad. Cambiar la contraseña o restablecerla cierra las demás sesiones.
- Sin correo: quien olvida la contraseña necesita que un administrador le genere un enlace de un solo uso (24 h) en Ajustes.
- CSP estricta (solo scripts propios), CORS cerrado, límite de intentos en acceso/registro/recuperación (10 por minuto y por IP).
- El servidor no publica puertos: solo se llega por el túnel de Cloudflare. El contenedor corre sin capacidades, con el sistema de ficheros de solo lectura.
- Dependencias: `pnpm audit` antes de cada versión.

## Problemas típicos

| Síntoma | Causa y arreglo |
|---|---|
| La app de Android muestra la barra de Chrome | `assetlinks.json` no coincide con la clave de firma, o Chrome tiene caché: reinstalar tras corregirlo |
| «Sesión no válida» tras cambiar la contraseña en otro móvil | Es lo esperado: se cierran las demás sesiones |
| No llegan avisos push | Permiso bloqueado en el navegador, o la suscripción caducó: desactivar y volver a activar en Ajustes |
| Un cambio hecho sin cobertura no llega | Se reintenta cada 15 s y al volver la red; si el servidor lo rechaza definitivamente (p. ej. el producto lo borró otra persona) sale un aviso |
| El contenedor no arranca tras desplegar | Restaurar `data-pre-<versión>` y volver a la imagen anterior (ver skill `deploy`) |
