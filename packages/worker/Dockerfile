FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/worker/package.json ./packages/worker/
RUN npm ci -w @polywatch/core -w @polywatch/worker
COPY packages/core ./packages/core
COPY packages/worker ./packages/worker
COPY tsconfig.base.json ./
RUN npm run build -w @polywatch/core && npm run build -w @polywatch/worker

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/worker/package.json ./packages/worker/
ENV NODE_ENV=production
CMD ["node", "packages/worker/dist/index.js"]
