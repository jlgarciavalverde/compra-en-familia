# AGENTS.md

Guía para agentes (Kimi Code y otros) que trabajen en este repo.

## Qué es esto

Monorepo pnpm (`apps/*`, `packages/*`) de una app de compras familiares. API Fastify 5 + `node:sqlite` (Node 22) que sirve una PWA React 19 (offline-first: outbox con claves de idempotencia + WebSocket). Todo el texto de producto va en **español** (UI, notificaciones, logs, tests).

## Comandos

- `pnpm dev:api` / `pnpm dev:web` — desarrollo (API :3000, Vite :5173)
- `pnpm typecheck` / `pnpm test` — verificar antes de dar por hecho cualquier cambio
- `pnpm build` y luego `pnpm e2e` — e2e Playwright con datos temporales en `e2e/.data`
- Los tests **deben quedar en verde**; si fallan, no es "cosa de antes" — se arreglan.

## Convenciones

- TypeScript estricto en los 3 paquetes; imports sin extensión; tipos compartidos desde `@compra/shared` (esquemas zod en `shared/src/schemas.ts`).
- Toda entrada/salida de la API se valida con zod; errores de negocio con `HttpError` (ver `apps/api/src/http.ts`).
- Acceso a BD solo a través de los helpers `get/all/run` y `tx()` de `apps/api/src/db.ts` (prepared statements). Migraciones: añadir bloque al final de `db.ts` subiendo `user_version`.
- Scopeo por hogar obligatorio en cada consulta (`household_id`).
- Web: datos siempre del servidor + overlay de operaciones pendientes (`lib/overlay.ts`); toda mutación pasa por el outbox (`lib/outbox.ts`) con `Idempotency-Key`.
- Los tests de API usan la app in-memory (`app.inject`), sin levantar servidor salvo el spec de WS/push que necesita puerto real.

## Infraestructura (contexto)

- Despliegue en VPS casero (`joseluis@192.168.18.7`): Docker rootless, `~/servicios/compra/` (compose sin puertos; solo túnel Cloudflare), red `proxy` compartida con `cloudflared` y Nextcloud.
- Build de imagen desde el Mac y subida por SSH; detalles en `.kimi-code/skills/deploy/SKILL.md`.
- Backups locales: dumps internos de la app + `~/servicios/backup.sh` semanal (compra + Nextcloud) en el VPS.
- No hay remoto git ni CI (decisión actual del propietario); no crear archivos de CI ni `.github/` por iniciativa propia.
