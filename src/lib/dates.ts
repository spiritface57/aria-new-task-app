import type { ISODate, Task } from './types';

// All calendar maths uses UTC Date objects as plain day counters, so the
// device's own time zone and DST can never shift a date.

export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUTC(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = toUTC(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday */
export function isoWeekday(d: ISODate): number {
  return ((toUTC(d).getUTCDay() + 6) % 7) + 1;
}

export function weekStart(d: ISODate): ISODate {
  return addDays(d, 1 - isoWeekday(d));
}

export function daysToMask(days: number[]): number {
  return days.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}

export function maskToDays(mask: number): number[] {
  return [1, 2, 3, 4, 5, 6, 7].filter((day) => (mask & (1 << (day - 1))) !== 0);
}

type Schedule = Pick<Task, 'kind' | 'days_mask' | 'due_on' | 'starts_on' | 'active'>;

/** Mirrors private.is_due_on in the database. */
export function isScheduled(task: Schedule, d: ISODate): boolean {
  if (!task.active) return false;
  if (task.kind === 'once') return task.due_on === d;
  return d >= task.starts_on && (task.days_mask & (1 << (isoWeekday(d) - 1))) !== 0;
}

/** Next date on or after `from` when a repeating task is due. */
export function nextOccurrence(task: Schedule, from: ISODate): ISODate | null {
  if (task.kind === 'once') return task.due_on;
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (isScheduled({ ...task, active: true }, d)) return d;
  }
  return null;
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeDays(mask: number): string {
  if (mask === 127) return 'Every day';
  if (mask === 31) return 'Weekdays';
  if (mask === 96) return 'Weekends';
  return maskToDays(mask).map((d) => WEEKDAY_SHORT[d - 1]).join(', ');
}

/** "17:00:00" → "5:00 PM" (or "17:00", following the device locale) */
export function formatTime(time: string, locale?: string): string {
  const [h, m] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

export function formatDay(d: ISODate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(toUTC(d));
}

export function formatShortDay(d: ISODate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(toUTC(d));
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [deviceTimeZone()];
}
