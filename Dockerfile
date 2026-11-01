FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app

COPY package*.json ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/atem-protocol/package.json packages/atem-protocol/package.json
COPY packages/atem-state/package.json packages/atem-state/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build --workspace=@atem-sandbox/web && npm run build:server

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS runtime
LABEL com.azure.containerizationassist.createdby="containerization-assist"
WORKDIR /app
ENV NODE_ENV=production \
    ATEM_SANDBOX_PORTABLE_ROOT=/data \
    ATEM_SANDBOX_WEB_DIST=/app/web \
    ATEM_SANDBOX_WEB_HOST=0.0.0.0 \
    ATEM_SANDBOX_ATEM_HOST=0.0.0.0
COPY --from=build /app/dist/server.cjs /app/server.cjs
COPY --from=build /app/apps/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000/tcp 9910/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "const fs=require('node:fs'); const port=JSON.parse(fs.readFileSync('/data/config.json','utf8')).server.webPort; require('node:http').get('http://127.0.0.1:'+port+'/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
USER node
CMD ["node", "/app/server.cjs"]
