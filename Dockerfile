# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
# Two stages: build the static app, then run it with the zero-dependency server (no node_modules at runtime).
FROM node:22-alpine AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
# openssl generates the self-signed certificate that gives LAN devices a secure context (WebGPU, caching).
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/providers.json ./src/providers.json
COPY LICENSE NOTICE ./
ENV NODE_ENV=production \
    LEXI_HOST=0.0.0.0 \
    PORT=8787 \
    LEXI_DATA=/data
VOLUME ["/data"]
EXPOSE 8787 8788
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/lan >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
