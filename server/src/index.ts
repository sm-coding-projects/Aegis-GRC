import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import { createApp } from './app';
import { config } from './config';
import { log } from './util/logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the built client SPA directory (always absolute — sendFile needs it). */
function clientDistDir(): string {
  if (process.env.CLIENT_DIST && process.env.CLIENT_DIST.trim() !== '') {
    return path.resolve(process.env.CLIENT_DIST);
  }
  return path.resolve(__dirname, '../../client/dist');
}

interface Tls {
  key: string | Buffer;
  cert: string | Buffer;
  selfSigned: boolean;
}

/** Load mounted cert+key, or generate a self-signed pair on first start. */
function loadTls(): Tls {
  const certPath = path.join(config.certsDir, 'fullchain.pem');
  const keyPath = path.join(config.certsDir, 'privkey.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    log.info('tls.loaded_mounted_cert', { certPath });
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath), selfSigned: false };
  }

  const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    days: 825,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  log.warn('tls.self_signed_generated', {
    message:
      'No cert mounted at /certs — generated a SELF-SIGNED certificate. ' +
      'Browsers will warn. NOT suitable for untrusted networks; terminate TLS at a ' +
      'trusted reverse proxy (Caddy/Traefik/nginx) for production. See README.',
  });
  return { cert: pems.cert, key: pems.private, selfSigned: true };
}

function main(): void {
  const staticDir = clientDistDir();
  const hasClient = fs.existsSync(path.join(staticDir, 'index.html'));
  if (!hasClient) {
    log.warn('static.client_missing', { staticDir, hint: 'run `npm run build` for the client' });
  }

  const { app, context } = createApp({
    serveStaticDir: hasClient ? staticDir : undefined,
  });

  const tls = loadTls();
  const server = https.createServer({ key: tls.key, cert: tls.cert }, app);

  server.listen(config.port, () => {
    log.info('server.listening', {
      port: config.port,
      url: `https://localhost:${config.port}`,
      selfSigned: tls.selfSigned,
      dataDir: config.dataDir,
      servingSpa: hasClient,
    });
  });

  const shutdown = (signal: string) => {
    log.info('server.shutdown', { signal });
    server.close(() => {
      context.dispose();
      process.exit(0);
    });
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
