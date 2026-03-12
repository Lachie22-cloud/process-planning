FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S aiagent && adduser -S aiagent -u 1001
COPY --from=builder /app/package.json /app/package-lock.json* /app/.npmrc* ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ dist/
USER aiagent
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3100/ai/health || exit 1
CMD ["node", "dist/server.js"]
