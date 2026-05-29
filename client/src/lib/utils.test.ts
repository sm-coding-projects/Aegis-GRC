import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges and de-duplicates conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    const hidden = false;
    expect(cn('text-text', hidden && 'hidden', 'font-data')).toBe('text-text font-data');
  });
});
