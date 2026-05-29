# Aegis GRC

A self-hosted web app for a GRC consultant to track **ISO/IEC 27001:2022 Annex A
controls** across multiple client engagements. Each engagement gets its own
Statement of Applicability (all 93 Annex A controls) to work through:
applicability, implementation status, owners, evidence, due dates, and review notes.

**Everything lives in one encrypted file, in one container, unlocked by one master
password.** Stand up a fresh instance, drop that file in, log in — all your data is there.

- 🔒 **Encrypted at rest** — the entire datastore is a single SQLCipher-encrypted
  SQLite file (`aegis.db`). The master password *is* the key (AES-256, PBKDF2,
  HMAC-SHA512). It is never stored anywhere; the KDF salt lives in the file header,
  so there is no sidecar key/salt file.
- 📦 **One container, one file** — embedded DB, in-process, no external services.
- 🔑 **One password** gates the UI and unlocks the data.
- 🎨 **Refined institutional UI** — IBM Plex, semantic status palette, first-class
  light/dark themes, dashboard, filterable controls table, detail drawer.

> ⚠️ **There is no password recovery.** The password is the encryption key. If you
> lose it, the data is unrecoverable by design. Keep it safe and keep backups.

---

## Quick start

```bash
docker compose build
docker compose up -d
```

Open **https://localhost:8443**.

On first run you'll be asked to **create a master password** (this initializes and
encrypts the database). On later runs you'll be asked to **unlock** with it.

Your data is stored at `./data/aegis.db` (a Docker bind mount). Certificates, if
you provide them, go in `./certs`.

### Requirements
- Docker + Docker Compose.
- Ports: `8443` (HTTPS) exposed by default.

### Linux note (file permissions)
The container runs as a non-root user (uid `1000`). On Linux, make the data dir
writable by it before first start:
```bash
mkdir -p data && sudo chown -R 1000:1000 data certs
```
On macOS/Windows Docker Desktop this is handled automatically.

---

## Backup

Your entire dataset is the single file `aegis.db`. Two ways to back it up:

1. **In-app (recommended):** Settings → **Download backup**. The server checkpoints
   the database and streams a self-contained, still-encrypted `aegis-backup-<date>.db`.
2. **From disk:** stop the container (`docker compose down`) so the file is
   checkpointed and self-contained, then copy `./data/aegis.db` somewhere safe.

The backup is encrypted with your master password. Store it anywhere — it is
useless without the password.

---

## Restore / migrate to a fresh instance

This is the headline workflow, and it is verified end-to-end (see `VALIDATION.md`).

**Option A — drop the file in (greenfield):**
```bash
# On the new host, with no existing ./data/aegis.db:
mkdir -p data
cp /path/to/your/aegis.db ./data/aegis.db   # (Linux: chown to uid 1000)
docker compose up -d
```
Open the app and **unlock with your original master password**. All clients,
controls, and evidence (including uploaded files, which live inside the encrypted
DB) are present.

**Option B — upload via the UI:** on a brand-new instance, the first-run screen
offers **"Restore from backup instead"** → choose your `aegis.db` → then unlock
with the original password.

A wrong password is always rejected with a generic error; the file is never
readable without it.

---

## TLS

The app serves **HTTPS** directly (so the container truly "holds everything").

- **Provide your own cert (recommended for anything beyond localhost):** mount
  `fullchain.pem` and `privkey.pem` into `/certs`:
  ```
  ./certs/fullchain.pem
  ./certs/privkey.pem
  ```
  (already wired in `docker-compose.yml`).
- **No cert mounted:** a **self-signed** certificate is generated on first start.
  Browsers will warn; this is fine for localhost/trusted-LAN use but **not** for
  untrusted networks. The server logs a clear warning when it does this.
- **Production upgrade path:** terminate TLS at a reverse proxy
  (Caddy / Traefik / nginx) in front, with Aegis on the internal network. The
  default single-container path works on its own regardless.

---

## Configuration

All optional (see `.env.example`). Defaults are baked into the image.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8443` | HTTPS listen port |
| `IDLE_TIMEOUT_MIN` | `30` | Auto-lock + destroy session after this much inactivity |
| `DATA_DIR` | `/data` | Where `aegis.db` lives (bind mount) |
| `CERTS_DIR` | `/certs` | Where `fullchain.pem` / `privkey.pem` are read from |
| `MAX_EVIDENCE_BYTES` | `10485760` | Max size of a single uploaded evidence file (10 MB) |

---

## Security notes

- **Master password is never persisted** — not in env, on disk, or in logs. It
  exists only as the in-memory key of the open DB connection. Container start ⇒
  locked ⇒ unlock required.
- **Sessions:** `HttpOnly` + `SameSite=Strict` cookie, `Secure` over HTTPS,
  server-side state tied to the in-memory unlocked handle. Logout and idle-timeout
  both close the DB (re-lock) and destroy the session.
- **CSRF:** `SameSite=Strict` plus a required per-session `X-CSRF-Token` header on
  state-changing requests; bootstrap auth routes require a custom `X-Requested-With`
  header.
- **Brute force:** the unlock route is rate-limited (5 attempts / 15 min / IP) with
  a small failure delay and generic error messages.
- **Headers:** `helmet` with HSTS and a strict Content-Security-Policy
  (`script-src 'self'` — no inline scripts; the theme bootstrap is an external file).
- **Container:** runs as non-root, drops all Linux capabilities, `no-new-privileges`,
  and the image excludes `data/`, `certs/`, and `.env` via `.dockerignore`.

---

## Development

Monorepo with npm workspaces: `shared/` (zod schemas + types, the single source of
validation truth), `server/` (Express + TypeScript, run via `tsx`), `client/`
(React + Vite + Tailwind + Radix/shadcn).

```bash
npm install
npm run dev          # server (8443, HTTPS) + client (5173, proxies /api)

npm run typecheck    # all workspaces
npm run lint
npm test             # Vitest: server (supertest/integration) + client (component)
npm run test:e2e     # Playwright happy path (boots a real HTTPS server)
npm run build        # shared + client
```

Validation drill (real containers):
```bash
docker compose build && bash scripts/migration-drill.sh
```

### Tech
TypeScript end-to-end · Node 22 · Express · `better-sqlite3-multiple-ciphers`
(SQLCipher v4) · React + Vite · Tailwind + Radix/shadcn · TanStack Query ·
react-hook-form + zod · Recharts · Vitest + supertest + Playwright ·
multi-stage Debian Docker image.

See **`CLAUDE.md`** for the full design/requirements spec and **`VALIDATION.md`**
for the phase-by-phase validation evidence.

---

## Scope (v1)

Controls tracking + per-client SoA + dashboard. **Not** in v1 (clean extension
points left, not built): multi-user/RBAC, cloud sync, external auth, telemetry,
risk/asset registers.
