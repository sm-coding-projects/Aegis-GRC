import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import { STATUSES, STATUS_LABELS } from '@aegis/shared';
import type { Status } from '@aegis/shared';

describe('StatusBadge', () => {
  it.each(STATUSES)('renders the correct label text for status "%s"', (status: Status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
  });

  it('renders "Implemented" label for implemented status', () => {
    render(<StatusBadge status="implemented" />);
    expect(screen.getByText('Implemented')).toBeInTheDocument();
  });

  it('renders "In progress" label for in_progress status', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders "Not started" label for not_started status', () => {
    render(<StatusBadge status="not_started" />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('renders "Not applicable" label for not_applicable status', () => {
    render(<StatusBadge status="not_applicable" />);
    expect(screen.getByText('Not applicable')).toBeInTheDocument();
  });

  it('renders "Overdue" label when overdue prop is true', () => {
    render(<StatusBadge status="in_progress" overdue={true} />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('does NOT render the normal status label when overdue is true', () => {
    render(<StatusBadge status="in_progress" overdue={true} />);
    // "In progress" should NOT be visible — overdue badge replaces it
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  it('renders label text even for sm size (color alone is never used)', () => {
    render(<StatusBadge status="implemented" size="sm" />);
    // Must have text, not just a colored dot
    expect(screen.getByText('Implemented')).toBeInTheDocument();
  });

  it('renders an icon element alongside the label (aria-hidden)', () => {
    const { container } = render(<StatusBadge status="implemented" />);
    // The icon should be aria-hidden="true"
    const icons = container.querySelectorAll('[aria-hidden="true"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('renders an icon element for overdue variant too', () => {
    const { container } = render(<StatusBadge status="not_started" overdue={true} />);
    const icons = container.querySelectorAll('[aria-hidden="true"]');
    expect(icons.length).toBeGreaterThan(0);
  });

  it('overdue badge is not rendered when overdue prop is false', () => {
    render(<StatusBadge status="in_progress" overdue={false} />);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('overdue badge is not rendered when overdue prop is omitted', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });
});
