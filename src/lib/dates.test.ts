import { describe, expect, it } from 'vitest';
import { addDays, daysToMask, describeDays, isScheduled, isoWeekday, maskToDays, nextOccurrence, todayIn, weekStart } from './dates';

describe('todayIn', () => {
  it('uses the family time zone, not the device', () => {
    const lateEveningToronto = new Date('2026-10-04T02:30:00Z'); // 22:30 on Oct 3 in Toronto
    expect(todayIn('America/Toronto', lateEveningToronto)).toBe('2026-10-03');
    expect(todayIn('Asia/Tehran', lateEveningToronto)).toBe('2026-10-04');
  });
});

describe('calendar maths', () => {
  it('crosses month, year and DST boundaries without drifting', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15');   // DST day in North America
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');   // leap year
  });
  it('numbers weekdays Monday=1 … Sunday=7 and finds Monday', () => {
    expect(isoWeekday('2026-10-03')).toBe(6);   // Saturday
    expect(isoWeekday('2026-10-04')).toBe(7);   // Sunday
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });
  it('round-trips day masks the same way the database does (bit 0 = Monday)', () => {
    expect(daysToMask([1, 2, 3, 4, 5])).toBe(31);
    expect(maskToDays(96)).toEqual([6, 7]);
    expect(describeDays(127)).toBe('Every day');
    expect(describeDays(5)).toBe('Mon, Wed');
  });
});

describe('isScheduled', () => {
  const task = { kind: 'repeat' as const, due_on: null, days_mask: daysToMask([6]), starts_on: '2026-10-01', active: true };
  it('matches weekday, start date and active flag', () => {
    expect(isScheduled(task, '2026-10-03')).toBe(true);
    expect(isScheduled(task, '2026-10-04')).toBe(false);          // Sunday
    expect(isScheduled({ ...task, starts_on: '2026-10-10' }, '2026-10-03')).toBe(false);
    expect(isScheduled({ ...task, active: false }, '2026-10-03')).toBe(false);
  });
});

describe('one-time tasks', () => {
  const once = { kind: 'once' as const, due_on: '2026-10-09', days_mask: 0, starts_on: '2026-10-01', active: true };
  it('are scheduled only on their due date', () => {
    expect(isScheduled(once, '2026-10-09')).toBe(true);
    expect(isScheduled(once, '2026-10-10')).toBe(false);
  });
  it('next occurrence of a repeating task skips unscheduled days', () => {
    const sat = { kind: 'repeat' as const, due_on: null, days_mask: daysToMask([6]), starts_on: '2026-09-01', active: true };
    expect(nextOccurrence(sat, '2026-10-05')).toBe('2026-10-10');
    expect(nextOccurrence(once, '2026-10-01')).toBe('2026-10-09');
  });
});
