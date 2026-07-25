FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci -w @polywatch/frontend
COPY packages/frontend ./packages/frontend
RUN npm run build -w @polywatch/frontend

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
