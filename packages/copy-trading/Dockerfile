FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/copy-trading/package.json ./packages/copy-trading/
RUN npm ci -w @polywatch/core -w @polywatch/copy-trading
COPY packages/core ./packages/core
COPY packages/copy-trading ./packages/copy-trading
COPY tsconfig.base.json ./
RUN npm run build -w @polywatch/core && npm run build -w @polywatch/copy-trading

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/copy-trading/dist ./packages/copy-trading/dist
COPY --from=builder /app/packages/copy-trading/package.json ./packages/copy-trading/
ENV NODE_ENV=production
CMD ["node", "packages/copy-trading/dist/index.js"]
