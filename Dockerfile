# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate`, which only needs a syntactically valid URL.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
# ponytail: ships dev deps because startup runs `prisma migrate deploy` + the tsx seed;
# split into a one-off migrate job + pruned image if image size starts to matter.
# Root-owned (read-only for the app user), so a compromised process can't rewrite its own code.
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy && prisma db seed && node dist/main.js"]
