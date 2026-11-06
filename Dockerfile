# Production image of the Bâtisso API (feature 18a).
# Two stages: the build stage compiles with every dependency; the runtime stage
# keeps production dependencies only and runs as the unprivileged `node` user.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# `prisma generate` reads the config, which needs a DATABASE_URL; nothing
# connects to it during the build.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build

FROM node:22-alpine
# Prisma's migration engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
# The private photo and document folders live on a volume mounted here; a new
# named volume takes this directory's owner, so the API can write to it.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
# Pending migrations first: if one fails, the container exits without serving.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main"]
