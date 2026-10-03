import { describe, expect, it } from 'vitest';
import { canAddToCalendar, googleCalendarUrl, icsFile } from './calendar';
import type { Task } from './types';

const base: Task = { id: 't1', title: 'Piano, scales', kind: 'repeat', due_on: null, days_mask: 0b0010101,
  time_local: '23:50:00', active: true, starts_on: '2026-09-01', points: 0, needs_check: false,
  needs_photo: false, checklist: [], assignees: [] };

describe('calendar', () => {
  it('builds a repeating Google Calendar event in the family time zone', () => {
    const url = new URL(googleCalendarUrl(base, 'America/Toronto', '2026-10-06'));
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(url.searchParams.get('ctz')).toBe('America/Toronto');
    // Next Mon/Wed/Fri on or after Tue Oct 6 is Wed Oct 7; 23:50 + 15 min rolls past midnight.
    expect(url.searchParams.get('dates')).toBe('20261007T235000/20261008T000500');
  });
  it('builds a one-time event without a repeat rule, escaping text', async () => {
    const ics = await icsFile({ ...base, kind: 'once', due_on: '2026-10-20', days_mask: 0 }, 'America/Toronto', '2026-10-06').text();
    expect(ics).toContain('DTSTART;TZID=America/Toronto:20261020T235000');
    expect(ics).not.toContain('RRULE');
    expect(ics).toContain('SUMMARY:Piano\\, scales');
  });
  it('does not offer past one-time tasks', () => {
    expect(canAddToCalendar({ ...base, kind: 'once', due_on: '2026-10-01', days_mask: 0 }, '2026-10-06')).toBe(false);
    expect(canAddToCalendar(base, '2026-10-06')).toBe(true);
  });
});
