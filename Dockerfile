# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 — builder: install deps (compiling the native SQLCipher addon) and
# build the shared package + the client SPA. Debian (glibc) base avoids the
# musl/native-module pain Alpine causes with better-sqlite3*.
###############################################################################
FROM node:22-bookworm-slim AS builder

# Toolchain for node-gyp to compile better-sqlite3-multiple-ciphers if no
# prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install with a warm layer cache: copy only manifests first.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# Copy the rest of the source and build shared types + the client bundle.
COPY . .
RUN npm run build:shared \
 && npm run build:client \
 # Sanity: the native addon must actually load in this environment.
 && node -e "const D=require('better-sqlite3-multiple-ciphers'); const d=new D(':memory:'); d.pragma(\"cipher='sqlcipher'\"); d.close(); console.log('native addon OK');"

###############################################################################
# Stage 2 — runtime: slim, non-root. Copies built artifacts + node_modules
# (including the compiled native addon and tsx) from the builder. Same Debian
# base ⇒ ABI-compatible native binary.
###############################################################################
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8443 \
    DATA_DIR=/data \
    CERTS_DIR=/certs \
    IDLE_TIMEOUT_MIN=30

WORKDIR /app

# Bring over the whole built tree (node_modules has the compiled addon + tsx;
# server runs from TypeScript source via the tsx loader).
COPY --from=builder /app /app

# Data + cert mount points, owned by the non-root runtime user.
RUN mkdir -p /data /certs \
 && chown -R node:node /data /certs /app

USER node

EXPOSE 8443
VOLUME ["/data", "/certs"]

# Node-based healthcheck (no curl in the image). Accepts the self-signed cert.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('https').get({host:'localhost',port:process.env.PORT||8443,path:'/api/health',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Run server as PID 1 (clean SIGTERM → graceful re-lock). __dirname resolves the
# client bundle at /app/client/dist automatically.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
