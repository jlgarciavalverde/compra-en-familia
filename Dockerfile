# syntax=docker/dockerfile:1
# La etapa de compilación corre en la arquitectura nativa del builder: pnpm 12 (Rust) falla bajo QEMU.
# Es válido mientras no haya dependencias nativas; con better-sqlite3 habrá que instalar sus binarios amd64 (ver Fase 1).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN npm i -g pnpm@12.4.2
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
ARG APP_VERSION=0.0.0
RUN pnpm -r build \
 && pnpm --filter @compra/api deploy --prod --legacy /out

FROM node:22-alpine
ARG APP_VERSION=0.0.0
ENV APP_VERSION=$APP_VERSION NODE_ENV=production PORT=3000 WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
