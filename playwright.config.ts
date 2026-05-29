import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Boots the real HTTPS server (self-signed) against a clean temp
 * data dir, then drives Chromium with ignoreHTTPSErrors. Waits for the TCP port
 * (not an HTTP probe) so the self-signed cert doesn't trip readiness.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'https://localhost:8443',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'rm -rf /tmp/aegis-e2e-data && mkdir -p /tmp/aegis-e2e-data /tmp/aegis-e2e-certs && ' +
      // Build shared + client so the served SPA reflects the current source.
      'npm run build:shared && npm run build:client && ' +
      'DATA_DIR=/tmp/aegis-e2e-data CERTS_DIR=/tmp/aegis-e2e-certs PORT=8443 NODE_ENV=production ' +
      'CLIENT_DIST=./client/dist node --import tsx server/src/index.ts',
    port: 8443,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
