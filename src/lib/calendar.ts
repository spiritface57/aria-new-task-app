import { addDays, maskToDays, nextOccurrence } from './dates';
import type { ISODate, Task } from './types';

// "Add to calendar" without any server: Google Calendar opens with the event
// filled in; other calendar apps import the .ics file. Both are copies: if the
// task changes later, add it to the calendar again.

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DURATION_MIN = 15;

function stamp(date: ISODate, time: string, plusMinutes = 0): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + plusMinutes;
  const day = addDays(date, Math.floor(total / 1440));
  const mins = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${day.replace(/-/g, '')}T${hh}${mm}00`;
}

function rrule(task: Task): string | null {
  if (task.kind === 'once') return null;
  return `RRULE:FREQ=WEEKLY;BYDAY=${maskToDays(task.days_mask).map((d) => BYDAY[d - 1]).join(',')}`;
}

/** Past one-time tasks can't be added: there's nothing left to schedule. */
export function canAddToCalendar(task: Task, today: ISODate): boolean {
  const next = nextOccurrence(task, today);
  return !!next && next >= today;
}

export function googleCalendarUrl(task: Task, timeZone: string, today: ISODate): string {
  const start = nextOccurrence(task, today)!;
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${stamp(start, task.time_local)}/${stamp(start, task.time_local, DURATION_MIN)}`,
    ctz: timeZone,
    details: 'From Family Tasks',
  });
  const rule = rrule(task);
  if (rule) q.set('recur', rule);
  return `https://calendar.google.com/calendar/render?${q}`;
}

const escapeIcs = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function icsFile(task: Task, timeZone: string, today: ISODate): Blob {
  const start = nextOccurrence(task, today)!;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Tasks//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${task.id}@family-tasks`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=${timeZone}:${stamp(start, task.time_local)}`,
    `DTEND;TZID=${timeZone}:${stamp(start, task.time_local, DURATION_MIN)}`,
    ...(rrule(task) ? [rrule(task)!] : []),
    `SUMMARY:${escapeIcs(task.title)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(task.title)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
}
