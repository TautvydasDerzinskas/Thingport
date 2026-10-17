# Installing and building run on the build machine's own platform: their output, the static dist, is the
# same for every architecture, and running Node under QEMU for the arm64 image is slow and has crashed
# npm ci mid-install. Only the nginx stage below is built per platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS test
COPY . .
RUN npm run verify
CMD ["npm", "run", "verify"]

FROM dependencies AS build
# Set by build-image.yml to the commit that triggered this image's build. Vite inlines any
# VITE_-prefixed env var into the bundle at build time, so the running app can report its own
# commit to AdminSettingsPage's update checker -- see backend/Dockerfile's matching GIT_SHA for
# why this is compared against the latest commit touching frontend/, not raw main HEAD.
ARG GIT_SHA=unknown
ENV VITE_GIT_SHA=$GIT_SHA
COPY . .
RUN npm run build

# ─── Production image (nginx) ─────────────────────────────────────────────────
# The frontend always calls same-origin /api/*; nginx reverse-proxies that to the backend
# container over the compose network (see nginx.conf). No build-time API URL needed.
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
