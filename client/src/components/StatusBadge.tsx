import type { Status } from '@aegis/shared';
import { STATUS_LABELS } from '@aegis/shared';
import { CheckCircle2, Clock, Circle, MinusCircle, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: Status;
  overdue?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const statusConfig: Record<
  Status,
  { icon: LucideIcon; color: string; bg: string }
> = {
  implemented: {
    icon: CheckCircle2,
    color: 'text-status-implemented',
    bg: 'bg-status-implemented-bg',
  },
  in_progress: {
    icon: Clock,
    color: 'text-status-progress',
    bg: 'bg-status-progress-bg',
  },
  not_started: {
    icon: Circle,
    color: 'text-status-notstarted',
    bg: 'bg-status-notstarted-bg',
  },
  not_applicable: {
    icon: MinusCircle,
    color: 'text-status-na',
    bg: 'bg-status-na-bg',
  },
};

export function StatusBadge({ status, overdue, size = 'md', className }: StatusBadgeProps) {
  if (overdue) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full font-medium',
          size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
          'bg-status-overdue-bg text-status-overdue',
          className,
        )}
      >
        <AlertTriangle
          className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
          aria-hidden="true"
        />
        <span>Overdue</span>
      </span>
    );
  }

  const config = statusConfig[status];
  const Icon = config.icon;
  const label = STATUS_LABELS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        config.bg,
        config.color,
        className,
      )}
    >
      <Icon
        className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
