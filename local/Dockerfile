FROM node:24-bookworm-slim
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY api api
COPY web web
COPY local local
ENV NEXT_TELEMETRY_DISABLED=1
