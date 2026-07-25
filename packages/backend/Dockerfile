FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/backend/package.json ./packages/backend/
RUN npm ci -w @polywatch/core -w @polywatch/backend
COPY packages/core ./packages/core
COPY packages/backend ./packages/backend
COPY tsconfig.base.json ./
RUN npm run build -w @polywatch/core && npm run build -w @polywatch/backend

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/backend/dist/index.js"]
