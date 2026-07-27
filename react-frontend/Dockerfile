# ── Stage 1: Build React ─────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Installa pnpm
RUN npm install -g pnpm

# Copia manifest e installa dipendenze
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copia sorgenti e build
COPY . .
RUN pnpm build

# ── Stage 2: Serve con nginx ──────────────────────────────────────────
FROM nginx:1.27-alpine

# Copia build React
COPY --from=builder /app/dist/public /usr/share/nginx/html

# Copia configurazione nginx con proxy API
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
