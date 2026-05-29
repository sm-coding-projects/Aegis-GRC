import { describe, it, expect } from 'vitest';
import { applyFilters, groupByTheme } from './controlsUtils';
import type { ControlRow } from '@aegis/shared';

// Minimal mock helpers
function makeControl(overrides: Partial<ControlRow> & { id: number; control_id: string; theme_id: 'A.5' | 'A.6' | 'A.7' | 'A.8' }): ControlRow {
  return {
    client_id: 1,
    theme: overrides.theme_id === 'A.5'
      ? 'Organizational controls'
      : overrides.theme_id === 'A.6'
      ? 'People controls'
      : overrides.theme_id === 'A.7'
      ? 'Physical controls'
      : 'Technological controls',
    title: `Control ${overrides.control_id}`,
    applicable: true,
    applicability_justification: null,
    status: 'not_started',
    owner: null,
    due_date: null,
    last_reviewed: null,
    implementation_notes: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    overdue: false,
    evidence_count: 0,
    ...overrides,
  };
}

const MOCK_CONTROLS: ControlRow[] = [
  makeControl({ id: 1, control_id: 'A.5.1', theme_id: 'A.5', status: 'implemented', owner: 'Alice' }),
  makeControl({ id: 2, control_id: 'A.5.2', theme_id: 'A.5', status: 'in_progress', owner: 'Bob' }),
  makeControl({ id: 3, control_id: 'A.5.3', theme_id: 'A.5', status: 'not_started' }),
  makeControl({ id: 4, control_id: 'A.6.1', theme_id: 'A.6', status: 'implemented', owner: 'Alice' }),
  makeControl({ id: 5, control_id: 'A.8.1', theme_id: 'A.8', status: 'not_applicable', applicable: false }),
  makeControl({ id: 6, control_id: 'A.8.2', theme_id: 'A.8', status: 'not_started', overdue: true }),
];

describe('applyFilters', () => {
  it('returns all controls when no filters applied', () => {
    expect(applyFilters(MOCK_CONTROLS, {})).toHaveLength(6);
  });

  it('filters by status', () => {
    const result = applyFilters(MOCK_CONTROLS, { status: 'implemented' });
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.status === 'implemented')).toBe(true);
  });

  it('filters by theme', () => {
    const result = applyFilters(MOCK_CONTROLS, { theme: 'A.5' });
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.theme_id === 'A.5')).toBe(true);
  });

  it('filters by owner', () => {
    const result = applyFilters(MOCK_CONTROLS, { owner: 'Alice' });
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.owner === 'Alice')).toBe(true);
  });

  it('filters by applicable=true', () => {
    const result = applyFilters(MOCK_CONTROLS, { applicable: true });
    expect(result).toHaveLength(5);
    expect(result.every((c) => c.applicable)).toBe(true);
  });

  it('filters by applicable=false', () => {
    const result = applyFilters(MOCK_CONTROLS, { applicable: false });
    expect(result).toHaveLength(1);
    expect(result[0]?.applicable).toBe(false);
  });

  it('filters overdue controls', () => {
    const result = applyFilters(MOCK_CONTROLS, { overdue: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.overdue).toBe(true);
  });

  it('searches by control_id', () => {
    const result = applyFilters(MOCK_CONTROLS, { search: 'A.6' });
    expect(result).toHaveLength(1);
    expect(result[0]?.control_id).toBe('A.6.1');
  });

  it('searches case-insensitively by owner', () => {
    const result = applyFilters(MOCK_CONTROLS, { search: 'alice' });
    expect(result).toHaveLength(2);
  });

  it('combines theme and status filters', () => {
    const result = applyFilters(MOCK_CONTROLS, { theme: 'A.5', status: 'implemented' });
    expect(result).toHaveLength(1);
    expect(result[0]?.control_id).toBe('A.5.1');
  });

  it('returns empty array when no controls match', () => {
    const result = applyFilters(MOCK_CONTROLS, { status: 'in_progress', theme: 'A.8' });
    expect(result).toHaveLength(0);
  });
});

describe('groupByTheme', () => {
  it('groups controls by theme in canonical order (A.5, A.6, A.7, A.8)', () => {
    const groups = groupByTheme(MOCK_CONTROLS);
    // A.7 has no controls in our mock set, so only 3 groups
    expect(groups).toHaveLength(3);
    expect(groups[0]?.theme_id).toBe('A.5');
    expect(groups[1]?.theme_id).toBe('A.6');
    expect(groups[2]?.theme_id).toBe('A.8');
  });

  it('places controls into the correct group', () => {
    const groups = groupByTheme(MOCK_CONTROLS);
    const a5 = groups.find((g) => g.theme_id === 'A.5');
    expect(a5?.controls).toHaveLength(3);
  });

  it('excludes themes with no controls', () => {
    const groups = groupByTheme(MOCK_CONTROLS);
    expect(groups.find((g) => g.theme_id === 'A.7')).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(groupByTheme([])).toHaveLength(0);
  });
});
