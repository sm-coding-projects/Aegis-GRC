import type { DB } from './crypto-db';
import type { DashboardSummary, ThemeProgress, ThemeId } from '@aegis/shared';
import { THEMES } from '@aegis/shared';
import { recentAudit } from './audit';
import { todayIso } from '../util/now';

interface AggRow {
  theme_id: ThemeId;
  total: number;
  applicable: number;
  implemented: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  overdue: number;
}

const AGG_SELECT = (scope: string) => `
  SELECT
    theme_id,
    count(*) AS total,
    sum(CASE WHEN applicable = 1 THEN 1 ELSE 0 END) AS applicable,
    sum(CASE WHEN status = 'implemented' THEN 1 ELSE 0 END) AS implemented,
    sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
    sum(CASE WHEN status = 'not_started' THEN 1 ELSE 0 END) AS not_started,
    sum(CASE WHEN status = 'not_applicable' THEN 1 ELSE 0 END) AS not_applicable,
    sum(CASE WHEN applicable = 1 AND status != 'implemented' AND due_date IS NOT NULL AND due_date < @today THEN 1 ELSE 0 END) AS overdue
  FROM controls
  WHERE client_id = @client_id
  ${scope}
`;

function completion(implemented: number, applicable: number): number {
  return applicable === 0 ? 1 : implemented / applicable;
}

/** Compute the full dashboard summary for a client. */
export function dashboardSummary(db: DB, clientId: number): DashboardSummary {
  const today = todayIso();
  const perTheme = db
    .prepare(AGG_SELECT('GROUP BY theme_id'))
    .all({ client_id: clientId, today }) as AggRow[];

  const byThemeMap = new Map<string, AggRow>(perTheme.map((r) => [r.theme_id, r]));
  const by_theme: ThemeProgress[] = THEMES.map((t) => {
    const r = byThemeMap.get(t.id);
    const agg: AggRow = r ?? {
      theme_id: t.id,
      total: 0,
      applicable: 0,
      implemented: 0,
      in_progress: 0,
      not_started: 0,
      not_applicable: 0,
      overdue: 0,
    };
    return {
      theme_id: t.id,
      theme: t.name,
      total: agg.total,
      applicable: agg.applicable,
      implemented: agg.implemented,
      in_progress: agg.in_progress,
      not_started: agg.not_started,
      not_applicable: agg.not_applicable,
      overdue: agg.overdue,
      completion: completion(agg.implemented, agg.applicable),
    };
  });

  const totals = by_theme.reduce(
    (acc, t) => ({
      total_controls: acc.total_controls + t.total,
      applicable: acc.applicable + t.applicable,
      implemented: acc.implemented + t.implemented,
      in_progress: acc.in_progress + t.in_progress,
      not_started: acc.not_started + t.not_started,
      not_applicable: acc.not_applicable + t.not_applicable,
      overdue: acc.overdue + t.overdue,
    }),
    {
      total_controls: 0,
      applicable: 0,
      implemented: 0,
      in_progress: 0,
      not_started: 0,
      not_applicable: 0,
      overdue: 0,
    },
  );

  return {
    client_id: clientId,
    ...totals,
    completion: completion(totals.implemented, totals.applicable),
    by_theme,
    recent_activity: recentAudit(db, 10, clientId),
  };
}
