import type { ControlRow } from '@aegis/shared';
import { THEMES } from '@aegis/shared';
import type { ThemeId } from '@aegis/shared';

export interface ControlFilters {
  theme?: ThemeId;
  status?: string;
  owner?: string;
  applicable?: boolean;
  overdue?: boolean;
  search?: string;
}

/**
 * Group controls by theme in canonical order.
 * Returns entries only for themes that have at least one control.
 */
export function groupByTheme(
  controls: ControlRow[],
): Array<{ theme_id: ThemeId; theme: string; controls: ControlRow[] }> {
  const groups = new Map<ThemeId, ControlRow[]>();

  for (const theme of THEMES) {
    groups.set(theme.id as ThemeId, []);
  }

  for (const control of controls) {
    const group = groups.get(control.theme_id);
    if (group) {
      group.push(control);
    }
  }

  return THEMES.map((theme) => ({
    theme_id: theme.id as ThemeId,
    theme: theme.name,
    controls: groups.get(theme.id as ThemeId) ?? [],
  })).filter((g) => g.controls.length > 0);
}

/**
 * Apply filters to a flat list of controls. Intended for client-side filtering
 * (e.g. search box that doesn't hit the server) or testing purposes.
 * The server-side query params mirror these semantics.
 */
export function applyFilters(controls: ControlRow[], filters: ControlFilters): ControlRow[] {
  return controls.filter((c) => {
    if (filters.theme && c.theme_id !== filters.theme) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.owner && c.owner !== filters.owner) return false;
    if (filters.applicable !== undefined && c.applicable !== filters.applicable) return false;
    if (filters.overdue !== undefined && filters.overdue && !c.overdue) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = `${c.control_id} ${c.title} ${c.owner ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
