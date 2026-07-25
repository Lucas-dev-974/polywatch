FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/crypto-algo/package.json ./packages/crypto-algo/
RUN npm ci -w @polywatch/core -w @polywatch/crypto-algo
COPY packages/core ./packages/core
COPY packages/crypto-algo ./packages/crypto-algo
COPY tsconfig.base.json ./
RUN npm run build -w @polywatch/core && npm run build -w @polywatch/crypto-algo

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/crypto-algo/dist ./packages/crypto-algo/dist
COPY --from=builder /app/packages/crypto-algo/package.json ./packages/crypto-algo/
ENV NODE_ENV=production
CMD ["node", "packages/crypto-algo/dist/index.js"]
