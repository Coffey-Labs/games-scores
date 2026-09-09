# node:sqlite is built into the runtime and the server runs straight from
# TypeScript, so there is no build stage, no compiler and no native module.
FROM node:26-alpine

ENV NODE_ENV=production \
    PORT=5184 \
    DB_PATH=/data/scores.db \
    TRUST_PROXY=1

WORKDIR /app
COPY src ./src

# The database is the only writable path; everything else can stay read-only.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5184

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5184/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.ts"]
