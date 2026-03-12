# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes VITE_* env vars at build time.
# VITE_SUPABASE_URL should be the public-facing origin (same domain as the app)
# so that the Supabase JS client uses Caddy's reverse-proxy routes.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_AI_AGENT_URL=""
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_AI_AGENT_URL=${VITE_AI_AGENT_URL}

RUN npm run build

# ── Stage 2: Serve ───────────────────────────────────────────────
FROM nginx:alpine

COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
