# SIRAT — Dockerfile (Next.js standalone)
# Mengacu pada https://nextjs.org/docs/app/api-reference/config/next-config-js/output
# Build: docker build -t sirat:latest .
# Run:   docker run -p 3901:3901 --env-file .env --read-only -v sirat-archive:/var/lib/sirat sirat:latest

FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- deps stage
FROM base AS deps
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .env untuk build (DATABASE_URL dummy OK; Prisma generate tidak connect)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build

# --- runtime stage (minimal)
FROM node:20-bookworm-slim AS runner
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3901
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# User non-root
RUN groupadd --system sirat && useradd --system --gid sirat --no-create-home --shell /usr/sbin/nologin sirat

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/scripts ./scripts

# Direktori data (mount volume di sini)
RUN mkdir -p /var/lib/sirat/archive /var/lib/sirat/staging && \
    chown -R sirat:sirat /var/lib/sirat /app
USER sirat
EXPOSE 3901

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/auth/me').then(r=>{if(r.status===401||r.status===200)process.exit(0);else process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
