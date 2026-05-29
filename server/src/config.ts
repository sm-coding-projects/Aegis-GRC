/** Runtime configuration, read once from the environment with safe defaults. */
import path from 'node:path';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: intEnv('PORT', 8443),
  idleTimeoutMs: intEnv('IDLE_TIMEOUT_MIN', 30) * 60 * 1000,
  dataDir: process.env.DATA_DIR && process.env.DATA_DIR.trim() !== '' ? process.env.DATA_DIR : '/data',
  certsDir:
    process.env.CERTS_DIR && process.env.CERTS_DIR.trim() !== '' ? process.env.CERTS_DIR : '/certs',
  maxEvidenceBytes: intEnv('MAX_EVIDENCE_BYTES', 10 * 1024 * 1024),
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;

export const dbPath = () => path.join(config.dataDir, 'aegis.db');

export const isProd = () => config.nodeEnv === 'production';
