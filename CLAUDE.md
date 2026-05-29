# CLAUDE.md — ISO 27001 Control Tracker ("Aegis GRC")

This file is the persistent source of truth for this project. Read it fully before any work and re-read the relevant section before each phase. If anything here conflicts with a passing test, **the test wins and you flag the conflict to the user** — do not silently "fix" the test to match an assumption.

---

## 0. Working agreement (how to operate on this repo)

You are Claude Opus 4.8 running in Claude Code. Operate at **high effort** (use `xhigh` for the encryption layer, the Docker build, and the migration test — these are the parts that must not be subtly wrong).

Honesty rules for this repo (non-negotiable):
- **Never report a step as "done" or "passing" unless you have actually run it and seen the output.** Paste the relevant command output as evidence.
- If you are uncertain whether something works, say so explicitly and then verify it before moving on.
- If you write code with a known gap, weakness, or TODO, call it out in plain language rather than letting it pass unremarked.
- Prefer running the real thing (build the image, hit the endpoint, decrypt the file) over reasoning about whether it would work.
- When a plan looks unsound or a requirement is ambiguous, stop and ask rather than guessing.

Build in phases with a **validation gate** at the end of each phase (see §8). Do not start phase N+1 until phase N's gate is green and you've shown the evidence.

---

## 1. What we're building

A self-hosted web application for a **GRC (Governance, Risk & Compliance) consultant** to track **ISO/IEC 27001:2022 Annex A controls** across multiple client engagements.

The consultant manages several clients. Each client engagement gets its own **Statement of Applicability (SoA)** — an instance of all 93 Annex A controls — that the consultant works through over time: setting applicability, implementation status, owners, evidence, due dates, and review notes.

### Hard requirements (these define success)
1. **Single Docker deployment that holds everything.** One image, one container, one data volume. No external database server, no external services required to run.
2. **Encrypted at rest.** All application data is stored encrypted. The encryption is keyed by the user's master password.
3. **Password to access the app.** A single master password both gates access to the UI and unlocks the encrypted data. There is one user (the consultant).
4. **Single-file migration.** All data lives in **one encrypted file**. The migration story must be: *deploy a fresh ("greenfield") instance → put that one encrypted file in place → log in with the original password → all data is present.* No second file, no separate key file, no external secret needed beyond the password the user remembers.
5. **Visually appealing, modern, professional UI** per the design system in §7.

### Non-goals (keep scope tight)
- No multi-user accounts / RBAC. One master password, one operator.
- No cloud sync, no external auth providers, no telemetry.
- No risk-register/asset-register modules in v1 (controls tracking + SoA + dashboard only). Leave clean extension points but don't build them.

---

## 2. Locked technical decisions

Do not relitigate these without asking the user.

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** end to end | Types catch errors before tests do; aligns with the "validate everything" goal |
| Runtime | **Node.js 22 LTS** | Stable, good native-module support |
| Backend | **Express + TypeScript** | Battle-tested; rock-solid middleware (helmet, rate-limit, sessions) |
| Database | **SQLite via `better-sqlite3-multiple-ciphers`** | Embedded → one file, no server. The `-multiple-ciphers` build adds transparent SQLCipher-compatible encryption. This single choice satisfies requirements 1–4 simultaneously. |
| Cipher | **SQLCipher v4 scheme** (AES-256-CBC + HMAC-SHA512, PBKDF2 KDF) | Recognized standard in audit/compliance contexts; salt stored in the file header → no separate salt/key file → honors single-file migration |
| Frontend | **React + Vite + TypeScript** | Fast, modern, simple to bundle and serve statically |
| Styling | **Tailwind CSS** + **shadcn/ui** (Radix primitives) | Accessible, professional components you fully own and can theme; no "AI slop" if styled per §7 |
| Icons | **lucide-react** | Consistent, clean line icons |
| Charts | **Recharts** | Dashboard status/progress visualizations |
| Data fetching | **TanStack Query** | Caching, loading/error states for free |
| Forms | **react-hook-form** + **zod** | `zod` schemas are **shared** between client and server for one source of validation truth |
| Routing | **React Router** | Standard SPA routing |
| Tests | **Vitest** (unit/integration) + **Playwright** (one e2e happy path) + **supertest** (API) | |
| Container | **Multi-stage Dockerfile**, Debian-based (`node:22-bookworm-slim`) | Debian (glibc) avoids musl/native-module pain that Alpine causes with `better-sqlite3*` |

### Native-module note (read before writing the Dockerfile)
`better-sqlite3-multiple-ciphers` is a native addon. In the **builder** stage install `python3`, `make`, and `g++` (and `ca-certificates`) so it compiles if no prebuilt binary matches. In the **runtime** stage you can drop the toolchain *only if* you copy the already-built `node_modules` from the builder. Verify the addon loads at runtime — don't assume the prebuilt matched.

---

## 3. Architecture

Single container. The Node/Express process does two jobs: serves the built React SPA as static files, and serves the JSON API under `/api`. SQLite is in-process. TLS terminates at the app (see §6.4) so the container genuinely "holds everything."

```
┌─────────────────────────  Docker container  ──────────────────────────┐
│                                                                        │
│   Express (TypeScript)                                                 │
│   ├── HTTPS server (cert from /certs, else self-signed on first run)   │
│   ├── Static:  serves /app/client/dist  (the built React SPA)          │
│   ├── /api/*   JSON API (auth-gated by session)                        │
│   └── DB layer: better-sqlite3-multiple-ciphers                        │
│            │                                                           │
│            ▼                                                           │
│   /data/aegis.db   ◄── the ONE encrypted file (mounted volume)         │
│                                                                        │
└────────────────────────────────────────────────────────────────────┘
        ▲                                   ▲
   :8443 (HTTPS)                     volume mount: ./data → /data
```

The encrypted DB handle is held **in server memory only while unlocked**. Container start ⇒ locked ⇒ login required. This is by design.

---

## 4. The lock / unlock lifecycle (core security flow)

1. **Container starts** → no key in memory → DB is locked. Every `/api` route except the auth routes returns 401.
2. **First run** (`/data/aegis.db` does not exist): UI shows a **"Create master password"** screen. On submit, create the DB, key it with the password, run migrations, seed the control template (the 93 controls from `iso27001-2022-annex-a-controls.json`), and start a session.
3. **Normal run** (file exists): UI shows **"Unlock"** screen. On submit, attempt to open the file with the password.
   - Success → keep the open DB handle in memory, create a session, set the session cookie.
   - Failure (wrong password) → 401, **rate-limited** (see §6.3). Never reveal whether the file exists vs. password wrong beyond a generic "incorrect password."
4. **Authenticated requests** use the session cookie; the server uses the in-memory handle.
5. **Idle timeout** (configurable, default 30 min) or **explicit logout** → close the DB handle (re-lock) and destroy the session.
6. **Restore / greenfield**: on the first-run screen, also offer **"Restore from backup"** → user uploads an existing `aegis.db` → server writes it to `/data/aegis.db` → user then unlocks with the original password. (The file-copy method — dropping the file into the volume before start — must also work; this upload path is just a convenience.)

---

## 5. Encryption layer — REFERENCE IMPLEMENTATION (adapt, then prove it)

This is the highest-risk code in the project. The shape below is correct in intent; **you must verify the exact pragma sequence against the installed `better-sqlite3-multiple-ciphers` version and prove encryption is real with the §8 Phase-2 tests.** Do not ship this until the "raw file is not a plaintext SQLite DB" test passes.

```ts
// server/src/db/crypto-db.ts
import Database from 'better-sqlite3-multiple-ciphers';

/** Escape a passphrase for safe use in a PRAGMA string (double single-quotes). */
function q(passphrase: string): string {
  return passphrase.replace(/'/g, "''");
}

/** Open (or create) the encrypted database and key it with the master password.
 *  Throws if the password is wrong (SQLITE_NOTADB) or the file is corrupt. */
export function openEncrypted(path: string, password: string): Database.Database {
  const db = new Database(path);
  // Select the SQLCipher-compatible scheme and its v4 defaults BEFORE keying.
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`legacy=4`);                 // SQLCipher v4 KDF/page settings
  // Optional hardening: raise KDF iterations above the v4 default.
  // db.pragma(`kdf_iter=512000`);
  db.pragma(`key='${q(password)}'`);

  // Force a real read so a wrong key surfaces immediately as SQLITE_NOTADB.
  db.prepare(`SELECT count(*) FROM sqlite_master`).get();

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Change the master password in place (re-encrypts the whole file). */
export function rekey(db: Database.Database, newPassword: string): void {
  db.pragma(`rekey='${q(newPassword)}'`);
}
```

Rules for the rest of the data layer:
- **The password is never persisted anywhere** — not in env, not on disk, not in logs. It exists only as the in-memory key handle for the open connection.
- Correct-password verification is implicit: a wrong key throws on the first read. Do **not** add a separate plaintext password hash file (that would break the single-file rule).
- WAL files (`-wal`, `-shm`) are transient. They are also encrypted by SQLCipher, but for a clean single-file backup you must **checkpoint and close** (`PRAGMA wal_checkpoint(TRUNCATE)` then `db.close()`) so the backup is a single self-contained `aegis.db`. The "Download backup" action must checkpoint first.
- Never log SQL parameter values that contain client data.

---

## 6. Security requirements (beyond encryption-at-rest)

### 6.1 Sessions
- Session id in a cookie that is `httpOnly`, `secure`, `SameSite=Strict`, with a sensible `Max-Age`.
- Server-side session state (in-memory is fine for one user). Tie the session to the unlocked DB handle.
- Logout and idle-timeout both destroy the session **and** close/re-lock the DB.

### 6.2 CSRF
- Because auth is cookie-based, protect all state-changing routes. `SameSite=Strict` plus a required custom header (e.g. `X-Requested-With`) or a per-session CSRF token. Implement one and test it.

### 6.3 Brute-force resistance
- `express-rate-limit` on the unlock route (e.g. max ~5 attempts / 15 min / IP, with backoff). Add a small artificial delay on failure to blunt online guessing. Generic error messages only.

### 6.4 Transport security (TLS) inside the single container
- App listens on **HTTPS** (`PORT`, default 8443). Load cert+key from `/certs/fullchain.pem` and `/certs/privkey.pem` if present.
- If no cert is mounted, **generate a self-signed cert on first start** and log a clear warning that it's self-signed and unsuitable for untrusted networks.
- Set HSTS via `helmet`. Document (in README) the production upgrade path: terminate TLS at a reverse proxy (Caddy/Traefik/nginx) in front, with the app on the internal network — but the default single-container path must work on its own.

### 6.5 Headers & hardening
- `helmet` with a sensible Content-Security-Policy for the SPA (no unsafe-inline scripts; allow the app's own origin; allow the fonts/styles you actually use).
- No secrets baked into the image. `.dockerignore` excludes `data/`, `certs/`, `.env`, `node_modules`, test artifacts.
- Run the container as a **non-root** user; `/data` owned by that user.
- Input validation on every API route via the shared `zod` schemas; reject unknown fields.

---

## 7. Design system — "Refined institutional"

Goal: this should feel like a high-end compliance/audit console a consultant is proud to show a client — calm, precise, trustworthy, information-dense but legible. **Not** playful, **not** generic. Explicitly avoid AI-slop tells: no Inter/Roboto/Arial, no purple-gradient-on-white, no cookie-cutter centered hero. Commit to the direction with precision.

The system below is organized around the eleven UI/UX concepts the build is meant to embody (from Kole Jain, *"Every UI/UX Concept Explained in Under 10 Minutes"*): Affordances & Signifiers, Visual Hierarchy, Grids/Layouts/Spacing, Typography & Font Sizing, Color Theory, Dark Mode, Shadows, Icons & Buttons, Feedback & States, Micro-interactions, and Overlays. Implement each one deliberately.

### 7.1 Typography & font sizing
- **UI/body:** `IBM Plex Sans` — institutional, technical, credible; not overused. **Data/codes** (control IDs like `A.8.24`, dates, counts): `IBM Plex Mono`. **Optional report/section headings:** `IBM Plex Serif` for a touch of editorial authority. (Acceptable alternative pairing if you prefer: `Geist` for UI + `Geist Mono` for data. Do not use Inter.)
- Self-host the fonts (woff2) so the container has no external dependency and the CSP stays tight.
- Type scale (rem): 0.75 / 0.875 / 1 / 1.125 / 1.25 / 1.5 / 1.875 / 2.25. Body 1rem, line-height ~1.5. Headings tighter (1.1–1.25). Establish weight contrast (e.g. 400 body, 500 labels, 600 headings); don't fake hierarchy with size alone.

### 7.2 Color theory & tokens
Restrained neutral scale + **one** confident accent + a **semantic status palette**. Define everything as CSS variables (HSL) with light and dark values; components reference tokens, never raw hex. Suggested direction (tune for AA contrast):
- Neutrals: a cool slate ramp (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`).
- Accent: a deep, serious teal **or** indigo-leaning blue (pick one; not purple). Used sparingly for primary actions and focus rings — 60/30/10 rule: mostly neutral, accent is the 10%.
- **Status palette (GRC-critical, must be semantic and consistent everywhere):**
  - `Implemented` → green
  - `In progress` → amber
  - `Not started` → slate/grey (neutral, low emphasis)
  - `Not applicable` → muted/desaturated
  - `Overdue` → red (derive from due date < today AND not implemented)
- **Accessibility:** all text/background pairings meet **WCAG AA**. **Never encode status by color alone** — always pair the color with a text label and/or icon (color-blind safe). Verify contrast.

### 7.3 Grids, layout & spacing
- Spacing scale on a 4px base, 8px rhythm: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- App shell: persistent left sidebar (client switcher + nav: Dashboard, Controls, Reports, Settings), top bar (current client, lock button, theme toggle), main content max-width ~1280px with comfortable gutters.
- Align everything to the grid. Use generous negative space in the dashboard; controlled density in the controls table. Tables get sticky headers and clear row separation.

### 7.4 Dark mode
- First-class light **and** dark themes via a `data-theme` attribute / `class` on `<html>`; токen-driven so it's a variable swap, not a re-skin. Persist preference; respect `prefers-color-scheme` on first load.
- Dark mode done right: not pure black — use a dark slate base; **elevated surfaces get lighter**, not heavier shadows; reduce accent saturation slightly so it doesn't vibrate. Re-check contrast in dark.

### 7.5 Shadows & elevation
- A small, consistent elevation ramp (e.g. `--elev-1`, `--elev-2`, `--elev-3`): soft, low-spread shadows for cards, popovers, modals — used to signal layering, not decoration. In dark mode lean on surface-lightness for elevation and keep shadows subtle.

### 7.6 Icons & buttons
- `lucide-react` throughout, consistent stroke width and size.
- Button variants: `primary` (accent), `secondary` (neutral outline), `ghost` (text-only), `destructive` (red, for delete/reset). Sizes: sm / md. Every button has explicit `hover`, `active`, `focus-visible`, `disabled`, and `loading` states. One clear **primary action per screen**.

### 7.7 Affordances & signifiers
- Interactive things must look interactive and non-interactive things must not. Inputs look editable, buttons look pressable, rows that open a detail drawer show a hover state and a chevron/`cursor-pointer`. Disabled controls look disabled and explain why (tooltip) where useful.

### 7.8 Visual hierarchy
- Each screen has one obvious focal point. Dashboard leads with the headline compliance metric and a status breakdown; secondary metrics are visually subordinate. Use size, weight, color, and spacing — in that order of preference — to rank importance.

### 7.9 Feedback & states (no "dead" surfaces)
Every data surface implements all of: **loading** (skeletons, not spinners where a layout is known), **empty** (helpful empty states with a primary action, e.g. "No clients yet — add your first engagement"), **error** (clear, recoverable, with retry), and **success** (toast on save). Every mutation gives immediate feedback. Optimistic updates for status changes are encouraged (with rollback on failure).

### 7.10 Micro-interactions
- Subtle, fast (≈150–200ms ease-out): button press, row hover, drawer slide-in, toast enter/leave, status-badge change, expand/collapse. Tasteful, not bouncy. **Respect `prefers-reduced-motion`** — disable non-essential motion when set.

### 7.11 Overlays
- Use Radix-backed overlays (via shadcn/ui): a **right-hand drawer** for control detail/edit, **dialogs** for create-client and confirm-destructive actions, **toasts** for save/error feedback, **tooltips** for icon-only buttons and disabled-state explanations. All overlays: focus-trapped, closeable with ESC and a visible close affordance, scroll-locked behind, and labelled for screen readers.

### 7.12 Accessibility (baseline, not optional)
Semantic HTML, full keyboard navigation, visible `focus-visible` rings, `aria` labels on icon buttons and form fields, status never by color alone, AA contrast in both themes, and reduced-motion support.

---

## 8. Phased build plan with validation gates

Each phase ends with a gate. **Show the command output that proves the gate is green before continuing.**

**Phase 0 — Scaffold.** Monorepo: `/server`, `/client`, shared `/shared` for zod schemas + types, `iso27001-2022-annex-a-controls.json` in `/server/src/db/seed/`. TS configs, ESLint/Prettier, Vitest configured in both packages.
- *Gate:* `npm install` clean in both packages; `npm run typecheck` passes; `npm run lint` passes; a trivial Vitest test runs.

**Phase 1 — Data layer & schema.** Migrations create tables: `clients`, `controls` (the per-client SoA rows: client_id, control_id, theme, title, applicable bool, applicability_justification, status enum, owner, due_date, last_reviewed, implementation_notes), `evidence` (id, control row id, kind [link|note|file], label, url/text, blob for uploaded files stored **inside the DB**, mime, size, created_at), `audit_log` (who/when/what changed — append-only), `app_meta` (schema version, template version). Seeding a new client inserts all 93 controls from the JSON.
- *Gate:* a Vitest test creates an in-memory-equivalent encrypted DB in a temp dir, seeds a client, asserts exactly **93** control rows with correct theme distribution **37/8/14/34**.

**Phase 2 — Encryption & migration (USE xhigh EFFORT).** Implement §5. Then prove encryption and the single-file migration are real:
- *Gate (all must pass, paste evidence):*
  1. **Round-trip:** open with password `P`, write a known row, checkpoint+close → copy `aegis.db` to a *new* path (simulating a greenfield volume) → open the copy with `P` → the row is present and equal.
  2. **Wrong password fails:** opening the copy with a different password throws (SQLITE_NOTADB) and yields no data.
  3. **Encryption is genuine:** the raw `aegis.db` bytes do **not** begin with the `SQLite format 3\0` magic header, AND the system `sqlite3 aegis.db "SELECT name FROM sqlite_master"` (no key) fails. (Run both checks in the test.)
  4. **Rekey:** change password `P`→`P2`, close, reopen with `P2` succeeds and with `P` fails; data intact.

**Phase 3 — Auth & app lifecycle.** Implement §4 and §6 (sessions, CSRF, rate-limit, lock/unlock/first-run/restore, idle timeout, logout).
- *Gate:* supertest suite — unauth `/api/*` → 401; create-password flow works; unlock with right/wrong password (wrong is rate-limited after N tries); logout re-locks (subsequent calls 401); restore-from-upload then unlock works; CSRF-less mutation is rejected.

**Phase 4 — API.** REST endpoints for clients (CRUD), controls (list/filter/sort by theme, get, update status/applicability/owner/dates/notes), evidence (add link/note/upload, download, delete), dashboard aggregates (overall %, per-theme breakdown, overdue count, recently updated), backup download (checkpoint→stream encrypted file), CSV export of a client's SoA. All validated by shared zod schemas; all writes audited.
- *Gate:* supertest covers each endpoint incl. validation rejections and the audit-log side effects; backup endpoint returns a file that re-opens with the password.

**Phase 5 — Frontend.** Build the SPA per §7: unlock/create/restore screen, app shell (sidebar + topbar + theme toggle + lock), client switcher + create-client dialog, dashboard (Recharts: status donut, per-theme progress bars, overdue list, recent activity), controls table (grouped by theme, filter by status/theme/owner/applicability, search, sticky header), control detail **drawer** (edit everything, evidence add/list/download, change history), settings (change master password → rekey, download backup, theme), toasts, full loading/empty/error states, reduced-motion support.
- *Gate:* `npm run build` (client) succeeds; component tests for the controls table filtering and the status-badge semantics; manual screenshot check against §7 (lighthouse/axe pass for a11y if available).

**Phase 6 — Containerize.** Multi-stage Dockerfile (builder compiles client + server and installs native deps; runtime is slim, non-root, copies built artifacts + node_modules, exposes 8443, volume `/data`, optional `/certs`). `docker-compose.yml` mapping `./data:/data` and `./certs:/certs`. `.dockerignore`. Self-signed cert generation on first start if no cert mounted. `.env.example` documents `PORT`, `IDLE_TIMEOUT_MIN`, etc.
- *Gate:* `docker compose build` succeeds; `docker compose up` starts; `curl -k https://localhost:8443/api/health` returns ok; the native addon loads (no runtime "module not found"/ABI error).

**Phase 7 — End-to-end validation (the headline requirement).** A Playwright happy path AND a scripted migration drill:
- e2e: open app → create master password → it seeds a client's controls → set a control to `Implemented`, add an evidence link, add an evidence file → reload → state persisted → lock → unlock with password → state still there → wrong password rejected.
- **Migration drill (script it and paste output):** run container A with volume `dataA`, create data; copy `dataA/aegis.db` to a brand-new `dataB`; run a *fresh* container B on `dataB`; log in with the same password; confirm all clients/controls/evidence are present. Then confirm container B rejects a wrong password.
- *Gate:* both pass; produce a short `VALIDATION.md` summarizing what was run and the evidence.

---

## 9. Repository layout (target)

```
aegis-grc/
├── CLAUDE.md
├── README.md                 # how to run, backup, restore, TLS, security notes
├── VALIDATION.md             # produced in Phase 7
├── docker-compose.yml
├── Dockerfile
├── .dockerignore
├── .env.example
├── package.json              # workspaces: server, client, shared
├── shared/                   # zod schemas + shared TS types (imported by both)
├── server/
│   └── src/
│       ├── index.ts          # HTTPS + static + /api
│       ├── db/
│       │   ├── crypto-db.ts  # §5
│       │   ├── migrations/
│       │   └── seed/iso27001-2022-annex-a-controls.json
│       ├── auth/             # session, csrf, rate-limit, lifecycle
│       ├── routes/
│       └── ...
└── client/
    └── src/
        ├── styles/tokens.css # §7 design tokens (light + dark)
        ├── components/ui/    # shadcn/ui components
        ├── features/{unlock,dashboard,controls,clients,settings}/
        └── ...
```

## 10. Commands (define these in package.json so they exist for the gates)
- `npm run typecheck` · `npm run lint` · `npm test` (Vitest) · `npm run test:e2e` (Playwright)
- `npm run dev` (concurrent server + client dev) · `npm run build` (client + server)
- `docker compose build` · `docker compose up`

## 11. Definition of done
All seven gates green with pasted evidence; the migration drill in Phase 7 demonstrably works; `README.md` and `VALIDATION.md` exist; no secrets in the image; container runs as non-root over HTTPS; the UI satisfies §7 in both light and dark themes. If any item is not done, say so plainly — do not report done.
