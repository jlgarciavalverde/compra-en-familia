---
name: compra-conventions
description: Convenciones de código y arquitectura de compra-en-familia — cómo añadir rutas, migraciones, tests y funciones de la PWA
type: prompt
whenToUse: Al implementar o modificar cualquier funcionalidad del monorepo compra-en-familia
---

# Convenciones de compra-en-familia

Antes de cambiar código, lee `AGENTS.md` y `README.md` de la raíz (fuente de verdad). Resumen operativo:

## Verificación obligatoria

`pnpm typecheck` y `pnpm test` deben quedar en verde antes de dar nada por terminado. Para cambios en la web o sincronización, además: `pnpm build && pnpm e2e`.

## API (apps/api)

- Rutas en `src/routes/<feature>.ts` registradas en `src/app.ts`; validación zod de toda entrada; errores de negocio con `HttpError`.
- BD solo por helpers `get/all/run` y `tx()` de `src/db.ts`. Cada consulta filtra por `household_id`.
- Nueva migración = nuevo bloque `if (userVersion < N)` al final de `db.ts`, sin migraciones de bajada.
- Auth: `requireUser(db, authorization)` en cada ruta; rate-limit solo en auth; tests con app in-memory (`app.inject`) salvo WS/push que levantan puerto real.
- Notificaciones: nunca lanzan errores a la petición; usan `notifier` (debounce 30 s).

## Web (apps/web)

- Textos de UI siempre en español.
- Datos siempre del servidor (TanStack Query) + overlay de pendientes (`lib/overlay.ts`); toda mutación pasa por el outbox (`lib/outbox.ts`) con `Idempotency-Key` generada por el cliente.
- Al añadir una mutación nueva: endpoint zod en `packages/shared/src/schemas.ts`, handler API, y flush del outbox probado offline (ver `e2e/offline.spec.ts`).
- Estilos con Tailwind 4; componentes comunes en `components/ui.tsx`.

## Shared (packages/shared)

- Sin dependencias de runtime salvo zod; tipos y esquemas compartidos. El ranking del catálogo offline (web) debe espejar el SQL de la API — mantenerlos en paralelo.
