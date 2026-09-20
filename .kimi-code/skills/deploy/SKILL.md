---
name: deploy
description: Despliegue de compra-en-familia al VPS casero — build de imagen, subida, puesta en marcha y verificación
type: prompt
whenToUse: Cuando se pida desplegar, actualizar la app en el VPS o publicar una nueva versión
---

# Despliegue de compra-en-familia al VPS

VPS: `joseluis@192.168.18.7` (ver skill `vps`). Docker rootless; la app no publica puertos (solo túnel Cloudflare). La imagen se construye en el Mac (build multi-stage del `Dockerfile`, requiere Node 22 + pnpm 12 resueltos dentro del propio build).

## Procedimiento

1. **Versionar**: elegir versión semver (p. ej. `0.5.0`). No sobrescribir `:latest` ciegamente: etiquetar siempre con versión.
2. **Build** (desde la raíz del repo):
   `docker build --build-arg APP_VERSION=<version> -t compra-en-familia:<version> .`
3. **Subir** (el VPS no construye, solo recibe imágenes):
   `docker save compra-en-familia:<version> | gzip | ssh joseluis@192.168.18.7 'docker load'`
4. **Actualizar compose** en `~/servicios/compra/docker-compose.yml`: cambiar `image: compra-en-familia:latest` por `compra-en-familia:<version>` (sed remoto).
5. **Levantar**: `ssh joseluis@192.168.18.7 'cd ~/servicios/compra && docker compose up -d'`
6. **Verificar**:
   - `docker ps` → `compra` en `(healthy)` y 0 reinicios.
   - `docker logs compra --tail 20` → sin errores.
   - Probar la web vía su dominio público (túnel Cloudflare).

## Antes de tocar datos

- Snapshot preventivo si la versión migra la BD:
  `ssh joseluis@192.168.18.7 'cp -r ~/servicios/compra/data ~/servicios/compra/data-pre-<version>'`
- Las migraciones son lineales (`PRAGMA user_version`); no hay vuelta atrás: verificar que la nueva imagen arranca antes de reemplazar la anterior.

## Rollback

Con el snapshot de datos y la imagen anterior aún en el VPS: `docker compose up -d` con el tag anterior tras restaurar `data/` del snapshot.
