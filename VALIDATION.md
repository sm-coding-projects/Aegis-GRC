# VALIDATION.md — Aegis GRC

This document records what was run to validate each phase gate (CLAUDE.md §8) and
the evidence observed. Every "passed" below was actually executed and observed —
not assumed. Commands are reproducible from the repo root.

> Environment: Node 22.22, npm 10.9, Docker 29.4, sqlite3 3.51, OpenSSL 3.6,
> macOS (darwin). Native addon: `better-sqlite3-multiple-ciphers@11.10.0`
> (bundled SQLite 3.49.2, SQLCipher v4 scheme).

---

## Gate checklist

| # | Phase | Status |
|---|-------|--------|
| 0 | Scaffold | ✅ green |
| 1 | Data layer & schema | ✅ green |
| 2 | Encryption & migration | ✅ green |
| 3 | Auth & lifecycle | ✅ green |
| 4 | API | ✅ green |
| 5 | Frontend | ✅ green |
| 6 | Containerize | ✅ green |
| 7 | E2E + migration drill | ✅ green |

Aggregate automated tests: **62 unit/integration** (31 server + 31 client) + **1
Playwright e2e** + **1 scripted Docker migration drill**, all passing.

---

## Phase 0 — Scaffold
- `npm install` → clean, 0 vulnerabilities (after deduping Vitest→Vite and upgrading multer to 2.x).
- `npm run typecheck` → all three workspaces (shared/server/client) compile, exit 0.
- `npm run lint` → exit 0.
- `npm test` → trivial Vitest tests pass.
- Native SQLCipher addon loads; `cipher='sqlcipher'` selectable.

## Phase 1 — Data layer & schema
- `server/src/db/schema.test.ts` creates an encrypted DB in a temp dir, seeds a client, and asserts:
  - exactly **93** control rows, theme distribution **A.5=37 / A.6=8 / A.7=14 / A.8=34**;
  - per-client isolation (two clients → 186 rows total);
  - seeded defaults (`applicable=1`, `status='not_started'`);
  - an audit row written on client creation.

## Phase 2 — Encryption & migration (the high-risk layer)
`server/src/db/encryption.test.ts` (all pass) plus a tangible shell demo:
1. **Round-trip** — write a row, checkpoint+close, copy *only* `aegis.db` to a fresh path, reopen with the password → row present.
2. **Wrong password** — opening the copy with a different password throws `SQLITE_NOTADB`; no data readable.
3. **Genuine encryption** —
   - raw `aegis.db` first 16 bytes are a random salt, **not** `SQLite format 3\0` (observed e.g. `a5cd b560…`, `de40 d2f7…`, `1d72 ba7b…`);
   - a unique plaintext marker stored in the DB does **not** appear anywhere in the raw bytes;
   - the system `sqlite3 aegis.db "SELECT name FROM sqlite_master"` (no key) fails with `file is not a database (26)`.
4. **Rekey** — `P → P2` re-encrypts; reopen with `P2` works, with `P` fails, data intact.

> **Bug found & fixed here:** `rekey` is rejected in WAL journal mode. The opener
> enables WAL, so a password change would have failed in production. Fixed by
> checkpointing and dropping to the rollback journal around the rekey
> (`server/src/db/crypto-db.ts`).

## Phase 3 — Auth & lifecycle
`server/src/auth/auth.test.ts` (supertest, 10 tests):
- unauth `/api/*` → 401; `/api/health` is public.
- create-master-password flow seeds the DB and starts a session; cookie is `HttpOnly` + `SameSite=Strict`.
- create/unlock require the `X-Requested-With` header (login-CSRF mitigation).
- unlock: right password → 200; wrong → generic `401 Incorrect password`; **6th attempt → 429** (rate-limited).
- logout re-locks the vault (subsequent `/api/me` → 401).
- a CSRF-less mutation (`POST /logout` with no `X-CSRF-Token`) → 403.
- restore-from-upload then unlock recovers data; restore on an existing instance → 409.
- idle timeout closes the session and re-locks.

## Phase 4 — API
`server/src/routes/api.test.ts` (supertest, 8 tests):
- clients CRUD (+ seeds 93 controls, audited).
- controls filter by theme/status, update, **overdue derivation** (`applicable && status≠implemented && due_date<today`).
- evidence: add link, add note, upload file (blob inside the DB), list, **download returns exact bytes**, delete.
- dashboard aggregates reflect updates (implemented / applicable / by-theme / recent activity).
- CSV export is well-formed (header + 93 rows) and is audited.
- zod validation rejections (missing/empty/unknown fields, bad status enum) → 400.
- **backup** downloads an encrypted file that re-opens with the password (and fails with a wrong password).

## Phase 5 — Frontend
- `npm run build --workspace @aegis/client` → succeeds (tsc + vite).
- **33 IBM Plex woff2** files bundled into `dist/assets` (genuinely self-hosted; no font CDN).
- Component tests: controls-table filtering (15) + StatusBadge semantics (15, proving status is never color-only) + utils → 31 client tests pass.
- Manual visual check (light + dark) of the gate screen, dashboard (compliance %, status donut, per-theme bars, overdue/recent panels), controls table (grouped by theme, sticky header, mono IDs, hover/chevron), and the control detail drawer — all per §7.

## Phase 6 — Containerize
- `docker compose build` → succeeds; builder prints `native addon OK`.
- `docker compose up` → container reports **healthy** (node-based HTTPS healthcheck).
- `curl -k https://localhost:8443/api/health` → `{"ok":true,...}`.
- Native addon loads **at runtime** (`docker compose exec` → SQLite 3.49.2).
- Creating a master password via the API writes the **one encrypted file** to the host bind mount `./data/aegis.db` (random header, not SQLite magic).
- Graceful `docker compose down` (SIGTERM → checkpoint+close) leaves a single self-contained `aegis.db` (no `-wal`/`-shm`).

> **Bug found & fixed here:** a stale `shared/tsconfig.tsbuildinfo` was being copied
> into the image, causing `tsc` to skip emitting `shared/dist` (which is
> `.dockerignore`d) → the client build failed to resolve `@aegis/shared`. Fixed by
> adding `**/*.tsbuildinfo` to `.dockerignore` (and `.gitignore`).

## Phase 7 — End-to-end validation (headline requirement)

### Migration drill — `scripts/migration-drill.sh` (real Docker containers)
```
1. Start container A (volume dataA) → healthy
2. Create master password + client "Migrated Client Co"; set a control Implemented;
   add a link evidence + upload a file evidence (blob inside the encrypted DB).
   A snapshot → implemented=1, evidence_items=2
3. Stop A gracefully → single self-contained aegis.db (no -wal/-shm)
4. Copy ONLY aegis.db into a brand-new greenfield dir (dataB)
   raw header e.g. "1d72 ba7b…" (NOT 'SQLite format 3')
5. Start FRESH container B on dataB → status {"unlocked":false,"needsSetup":false}
6. Wrong password on B → HTTP 401
7. Correct password unlocks B; verified:
   - client name = "Migrated Client Co"
   - controls = 93
   - implemented = 1
   - evidence items = 2
   - downloaded file bytes == uploaded file bytes  ✅
RESULT: ✓ MIGRATION DRILL PASSED
```
Run it yourself: `npm run build` first is not required — it uses the built image:
```bash
docker compose build && bash scripts/migration-drill.sh
```

### Playwright happy path — `e2e/happy-path.spec.ts`
`npx playwright test` → **1 passed**. Flow: open app → create master password →
create engagement (seeds 93 controls) → set a control Implemented (save) → add a
link evidence → upload a file evidence → reload → state persisted → lock → unlock
→ state still present (incl. both evidence items) → wrong password rejected.

> **Two real bugs found & fixed by the e2e:**
> 1. The SPA history-fallback used `res.sendFile` with a relative `CLIENT_DIST`,
>    which Express rejects → `500` on the SPA. Fixed by resolving the dir to an
>    absolute path (`server/src/index.ts`).
> 2. Empty `<input type="date">` values submit `''`, which the original
>    `isoDateSchema` rejected — silently **blocking every control save** where a
>    date field was left untouched. Fixed in the shared schema by coercing `''`→`null`
>    (`shared/src/index.ts`); this is the single source of truth for client + server.

---

## Known limitations / things to review
- **Self-signed TLS by default.** Browsers warn until you mount a real cert at
  `/certs` (or terminate TLS at a reverse proxy). This is by design for a
  zero-config single container; see README "TLS".
- **Bind-mount ownership on Linux.** The container runs as uid 1000 (`node`). On
  Linux hosts, `./data` must be writable by uid 1000 (`sudo chown -R 1000:1000 data`).
  On macOS/Windows Docker Desktop this is handled automatically.
- **Client bundle ~918 kB** (Recharts is the bulk). Acceptable for a self-hosted
  single-user app; could be code-split later. The build prints a size warning, not an error.
- **Dev-only audit advisory:** `npm audit` is clean for production deps; the test
  toolchain (Vitest/Vite) is not shipped in the image.
- No automated axe/Lighthouse run was performed; a11y was built to spec
  (semantic HTML, focus-visible, aria labels, status never color-only, reduced-motion)
  and spot-checked, but not machine-audited.
