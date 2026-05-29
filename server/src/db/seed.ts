import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DB } from './crypto-db';
import { TOTAL_CONTROLS, type ThemeId } from '@aegis/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'seed', 'iso27001-2022-annex-a-controls.json');

interface SeedControl {
  id: string;
  themeId: ThemeId;
  theme: string;
  title: string;
}

interface SeedFile {
  standard: string;
  controlCount: number;
  controls: SeedControl[];
}

let cached: SeedFile | null = null;

/** Load and validate the canonical 93-control Annex A template (cached). */
export function loadControlTemplate(): SeedFile {
  if (cached) return cached;
  const raw = readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw) as SeedFile;
  if (!Array.isArray(parsed.controls) || parsed.controls.length !== TOTAL_CONTROLS) {
    throw new Error(
      `Control template invalid: expected ${TOTAL_CONTROLS} controls, got ${parsed.controls?.length}`,
    );
  }
  cached = parsed;
  return parsed;
}

/** The template version string recorded in app_meta. */
export function templateVersion(): string {
  return loadControlTemplate().standard;
}

/**
 * Insert all 93 Annex A controls for a freshly created client. Caller is
 * responsible for running this inside a transaction with the client INSERT.
 */
export function seedControlsForClient(db: DB, clientId: number, nowIso: string): number {
  const template = loadControlTemplate();
  const stmt = db.prepare(`
    INSERT INTO controls
      (client_id, control_id, theme_id, theme, title, applicable, status, created_at, updated_at)
    VALUES
      (@client_id, @control_id, @theme_id, @theme, @title, 1, 'not_started', @now, @now)
  `);
  for (const c of template.controls) {
    stmt.run({
      client_id: clientId,
      control_id: c.id,
      theme_id: c.themeId,
      theme: c.theme,
      title: c.title,
      now: nowIso,
    });
  }
  return template.controls.length;
}
