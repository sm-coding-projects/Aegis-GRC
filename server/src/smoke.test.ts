import { describe, it, expect } from 'vitest';
import { THEMES, TOTAL_CONTROLS, STATUSES } from '@aegis/shared';
import { config } from './config';

describe('phase 0 smoke', () => {
  it('shared constants are wired up correctly', () => {
    expect(TOTAL_CONTROLS).toBe(93);
    expect(THEMES.reduce((s, t) => s + t.count, 0)).toBe(93);
    expect(STATUSES).toContain('implemented');
  });

  it('config loads with sane defaults', () => {
    expect(config.port).toBeGreaterThan(0);
    expect(config.idleTimeoutMs).toBeGreaterThan(0);
  });
});
