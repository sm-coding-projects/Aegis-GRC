/** Single source of "now" so timestamps are consistent and easy to stub. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date as YYYY-MM-DD (UTC), for overdue comparisons. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
