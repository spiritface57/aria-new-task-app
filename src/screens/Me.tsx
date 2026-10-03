import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canAddToCalendar, googleCalendarUrl, icsFile } from '../lib/calendar';
import { describeDays, formatShortDay, formatTime } from '../lib/dates';
import { signOut } from '../lib/signOut';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Section } from '../components/ui';
import { NotificationsCard } from '../components/NotificationsCard';
import type { Task } from '../lib/types';

export function Me() {
  const qc = useQueryClient();
  const { family, membership, childName, tasks, today } = useFamily();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const childId = membership.role === 'child' ? membership.childId : '';
  const mine = tasks.filter((t) => t.active && t.assignees.includes(childId) && canAddToCalendar(t, today));

  return (
    <main className="page">
      <header className="page-head"><h1>Hi, {childName(childId)}</h1><p className="muted">{family.name}</p></header>
      <Section title="Reminders"><NotificationsCard purpose="reminders" /></Section>
      <Section title="Add tasks to my calendar">
        <p className="muted">Puts a task in your phone's calendar. If a parent changes the task later, add it again.</p>
        <ul className="list">
          {mine.map((t) => <CalendarRow key={t.id} task={t} timeZone={family.timezone} today={today} />)}
        </ul>
      </Section>
      <Section title="This phone">
        {!confirm ? (
          <button className="btn btn-quiet" onClick={() => setConfirm(true)}>Unlink this phone</button>
        ) : (
          <div className="notice notice-danger">
            <p>To use the app on this phone again, a parent will need to give you a new code. Your history and points stay.</p>
            <button className="btn btn-danger" disabled={busy}
              onClick={() => run(() => signOut(qc, { deleteAccount: true }))}>Unlink this phone</button>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </Section>
    </main>
  );
}

function CalendarRow({ task, timeZone, today }: { task: Task; timeZone: string; today: string }) {
  function download() {
    const url = URL.createObjectURL(icsFile(task, timeZone, today));
    const a = document.createElement('a');
    a.href = url; a.download = `${task.title.replace(/[^\w\- ]+/g, '').trim() || 'task'}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return (
    <li className="list-row check-row">
      <div>
        <p className="slot-title">{task.title}</p>
        <p className="muted">{task.kind === 'once' ? formatShortDay(task.due_on!) : describeDays(task.days_mask)}, {formatTime(task.time_local)}</p>
      </div>
      <div className="button-col">
        <a className="btn btn-small btn-primary" href={googleCalendarUrl(task, timeZone, today)} target="_blank" rel="noopener">Google Calendar</a>
        <button className="btn btn-small" onClick={download}>Other calendar</button>
      </div>
    </li>
  );
}
