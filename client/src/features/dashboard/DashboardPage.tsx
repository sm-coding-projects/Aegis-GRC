import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { AlertTriangle, Clock, Activity, Users } from 'lucide-react';
import { useSelectedClient } from '@/lib/client-context';
import { dashboardApi, clientsApi } from '@/lib/api';
import type { DashboardSummary, ThemeProgress } from '@aegis/shared';
import { STATUS_LABELS } from '@aegis/shared';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { CreateClientDialog } from '@/features/clients/CreateClientDialog';
import { Button } from '@/components/ui/Button';

/* ---- Status color map (matches tokens.css) ---- */
const STATUS_COLORS: Record<string, string> = {
  implemented: 'hsl(152, 58%, 32%)',
  in_progress: 'hsl(33, 90%, 38%)',
  not_started: 'hsl(215, 16%, 38%)',
  not_applicable: 'hsl(220, 8%, 46%)',
};

const DARK_STATUS_COLORS: Record<string, string> = {
  implemented: 'hsl(152, 52%, 60%)',
  in_progress: 'hsl(40, 88%, 62%)',
  not_started: 'hsl(215, 14%, 70%)',
  not_applicable: 'hsl(220, 8%, 62%)',
};

function getStatusColor(key: string): string {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return (isDark ? DARK_STATUS_COLORS[key] : STATUS_COLORS[key]) ?? '#888';
}

export function DashboardPage() {
  const { selectedClientId, setSelectedClientId } = useSelectedClient();
  const [createOpen, setCreateOpen] = React.useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const {
    data: summary,
    isLoading,
    error,
    refetch,
  } = useQuery<DashboardSummary>({
    queryKey: ['dashboard', selectedClientId],
    queryFn: () => dashboardApi.get(selectedClientId!),
    enabled: selectedClientId != null,
  });

  if (clients.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <div className="h-14 w-14 rounded-full bg-surface-2 flex items-center justify-center">
          <Users className="h-7 w-7 text-text-muted" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text">No clients yet</h2>
          <p className="text-sm text-text-muted mt-1">
            Add your first client engagement to get started.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Add first engagement
        </Button>
        <CreateClientDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(id) => setSelectedClientId(id)}
        />
      </div>
    );
  }

  if (selectedClientId == null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-text-muted">Select an engagement from the sidebar.</p>
      </div>
    );
  }

  if (isLoading) return <DashboardSkeleton />;

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <p className="text-text-muted">Failed to load dashboard.</p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return <DashboardContent summary={summary} />;
}

function DashboardContent({ summary }: { summary: DashboardSummary }) {
  const completionPct = Math.round(summary.completion * 100);

  const donutData = [
    { name: STATUS_LABELS.implemented, value: summary.implemented, key: 'implemented' },
    { name: STATUS_LABELS.in_progress, value: summary.in_progress, key: 'in_progress' },
    { name: STATUS_LABELS.not_started, value: summary.not_started, key: 'not_started' },
    { name: STATUS_LABELS.not_applicable, value: summary.not_applicable, key: 'not_applicable' },
  ].filter((d) => d.value > 0);

  return (
    <div className="animate-fade-in">
      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">Dashboard</h2>
        <p className="text-sm text-text-muted mt-1">ISO/IEC 27001:2022 Annex A — Statement of Applicability</p>
      </div>

      {/* Headline metric + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Headline */}
        <div className="lg:col-span-1 rounded-lg border border-border bg-surface shadow-elev-1 p-6 flex flex-col items-center justify-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Overall compliance
          </p>
          <p className="text-5xl font-semibold font-data text-text">{completionPct}%</p>
          <p className="text-xs text-text-muted">
            {summary.implemented} of {summary.applicable} applicable controls implemented
          </p>
          {summary.overdue > 0 && (
            <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full bg-status-overdue-bg">
              <AlertTriangle className="h-3.5 w-3.5 text-status-overdue" aria-hidden="true" />
              <span className="text-xs font-medium text-status-overdue">
                {summary.overdue} overdue
              </span>
            </div>
          )}
        </div>

        {/* Donut chart */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-surface shadow-elev-1 p-6">
          <p className="text-sm font-medium text-text mb-4">Status breakdown</p>
          <div className="flex items-center gap-6">
            <div style={{ height: 160, width: 160, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.key} fill={getStatusColor(entry.key)} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      background: 'hsl(var(--surface))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: 'hsl(var(--text))',
                    }}
                    formatter={(value: number, name: string) => [value, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              {[
                { key: 'implemented' as const, label: STATUS_LABELS.implemented, value: summary.implemented },
                { key: 'in_progress' as const, label: STATUS_LABELS.in_progress, value: summary.in_progress },
                { key: 'not_started' as const, label: STATUS_LABELS.not_started, value: summary.not_started },
                { key: 'not_applicable' as const, label: STATUS_LABELS.not_applicable, value: summary.not_applicable },
              ].map(({ key, value }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: getStatusColor(key) }} aria-hidden="true" />
                    <StatusBadge status={key} size="sm" />
                  </div>
                  <span className="font-data text-sm font-medium text-text tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Per-theme progress */}
      <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-6 mb-6">
        <p className="text-sm font-medium text-text mb-4">Progress by theme</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {summary.by_theme.map((tp) => (
            <ThemeProgressBar key={tp.theme_id} tp={tp} />
          ))}
        </div>
      </div>

      {/* Bottom row: overdue + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OverdueList summary={summary} />
        <RecentActivity summary={summary} />
      </div>
    </div>
  );
}

function ThemeProgressBar({ tp }: { tp: ThemeProgress }) {
  const pct = Math.round(tp.completion * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-text">
          <span className="font-data text-text-muted">{tp.theme_id}</span>{' '}
          {tp.theme}
        </span>
        <span className="font-data text-xs text-text-muted tabular-nums">{pct}%</span>
      </div>
      <div
        className="h-2 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${tp.theme} completion`}
      >
        <div
          className="h-full rounded-full bg-status-implemented transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-text-muted mt-1">
        {tp.implemented} / {tp.applicable} applicable · {tp.overdue} overdue
      </p>
    </div>
  );
}

function OverdueList({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-status-overdue" aria-hidden="true" />
        <p className="text-sm font-medium text-text">Overdue controls</p>
        <span className="ml-auto font-data text-xs font-medium text-status-overdue">
          {summary.overdue}
        </span>
      </div>
      {summary.overdue === 0 ? (
        <p className="text-sm text-text-muted">No overdue controls. Keep it up.</p>
      ) : (
        <p className="text-sm text-text-muted">
          {summary.overdue} control{summary.overdue > 1 ? 's are' : ' is'} past due. Review the
          Controls page for details.
        </p>
      )}
    </div>
  );
}

function RecentActivity({ summary }: { summary: DashboardSummary }) {
  const activities = summary.recent_activity ?? [];
  return (
    <div className="rounded-lg border border-border bg-surface shadow-elev-1 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text">Recent activity</p>
      </div>
      {activities.length === 0 ? (
        <p className="text-sm text-text-muted">No recent activity.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {activities.slice(0, 8).map((entry) => (
            <li key={entry.id} className="flex items-start gap-2">
              <Clock className="h-3.5 w-3.5 text-text-muted mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text truncate">{entry.summary}</p>
                <p className="font-data text-xs text-text-muted">
                  {new Date(entry.at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-fade-in">
      <Skeleton className="h-7 w-48 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Skeleton className="h-44 lg:col-span-1" />
        <Skeleton className="h-44 lg:col-span-2" />
      </div>
      <Skeleton className="h-48 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
