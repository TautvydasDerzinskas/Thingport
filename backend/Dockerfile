FROM node:20-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund && npx prisma generate

FROM dependencies AS test
COPY . .
ENV DATABASE_URL="postgresql://thingport:thingport@localhost:5432/thingport_test?schema=public" \
    FILE_STORAGE=/tmp/thingport-storage
CMD ["npm", "test"]

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
# Set by build-image.yml to the commit that triggered this image's build -- exposed via
# GET /settings/version-check so the admin settings page can tell whether a newer commit
# touching backend/ has landed on main since this image was published. Left "unknown" for a
# manual/local `docker build` with no --build-arg, which the update checker treats as
# "can't check" rather than as outdated.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
RUN apk add --no-cache openssl su-exec
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# node:20-alpine already ships a "node" user/group at uid/gid 1000; remove it first so our own
# "appuser"/"appgroup" (which docker-entrypoint.sh re-aligns to PUID/PGID at container start)
# can claim that uid/gid without colliding.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && (deluser node 2>/dev/null || true) \
  && (delgroup node 2>/dev/null || true) \
  && addgroup -g 1000 appgroup \
  && adduser -D -u 1000 -G appgroup -s /sbin/nologin appuser \
  && mkdir -p /app/storage /app/data

EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
