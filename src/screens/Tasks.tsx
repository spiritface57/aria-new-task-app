import { useState } from 'react';
import { act } from '../lib/api';
import { describeDays, formatTime, maskToDays, WEEKDAY_SHORT } from '../lib/dates';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Field, Sheet } from '../components/ui';
import type { Task, TaskDraft } from '../lib/types';

export function Tasks() {
  const { tasks, activeChildren, childName } = useFamily();
  const [editing, setEditing] = useState<TaskDraft | null>(null);

  const newDraft = (): TaskDraft => ({
    id: null, title: '', time: '17:00', days: [1, 2, 3, 4, 5], active: true,
    assignees: activeChildren.length === 1 ? [activeChildren[0].id] : [],
  });
  const toDraft = (t: Task): TaskDraft => ({
    id: t.id, title: t.title, time: t.time_local.slice(0, 5), days: maskToDays(t.days_mask),
    active: t.active, assignees: t.assignees,
  });

  return (
    <main className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        {activeChildren.length > 0 && <button className="btn btn-primary btn-small" onClick={() => setEditing(newDraft())}>Add task</button>}
      </header>
      {activeChildren.length === 0 && <p className="empty">Add a child in <strong>Family</strong> first.</p>}
      {activeChildren.length > 0 && tasks.length === 0 && (
        <p className="empty">No tasks yet. Add one, like “Homework” on weekdays at 4:30 PM.</p>
      )}
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id}>
            <button className={`list-row task-row ${t.active ? '' : 'is-paused'}`} onClick={() => setEditing(toDraft(t))}>
              <time className="slot-time">{formatTime(t.time_local)}</time>
              <span>
                <span className="slot-title">{t.title}{!t.active && <span className="tag">Paused</span>}</span>
                <span className="muted">{describeDays(t.days_mask)}, for {t.assignees.map(childName).join(' and ') || 'nobody'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} title={editing?.id ? 'Edit task' : 'New task'} onClose={() => setEditing(null)}>
        {editing && <TaskEditor draft={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

function TaskEditor({ draft, onDone }: { draft: TaskDraft; onDone(): void }) {
  const { activeChildren } = useFamily();
  const { busy, error, setError, run } = useAction();
  const [d, setD] = useState(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = (list: (string | number)[], v: string | number) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function save() {
    if (d.days.length === 0) return setError('Choose at least one day.');
    if (d.assignees.length === 0) return setError('Choose at least one child for this task.');
    const ok = await run(() => act.saveTask({ ...d, title: d.title.trim() }));
    if (ok !== undefined) onDone();
  }

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Task"><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required maxLength={160} placeholder="Piano practice" /></Field>
      <Field label="Reminder time"><input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} required /></Field>
      <fieldset className="field">
        <legend className="field-label">Repeats on</legend>
        <div className="day-picker">
          {WEEKDAY_SHORT.map((label, i) => (
            <button key={label} type="button" className="chip" aria-pressed={d.days.includes(i + 1)}
              onClick={() => setD({ ...d, days: (toggle(d.days, i + 1) as number[]).sort() })}>{label}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">For</legend>
        <div className="day-picker">
          {activeChildren.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={d.assignees.includes(c.id)}
              onClick={() => setD({ ...d, assignees: toggle(d.assignees, c.id) as string[] })}>{c.display_name}</button>
          ))}
        </div>
      </fieldset>
      {d.id && (
        <label className="check">
          <input type="checkbox" checked={!d.active} onChange={(e) => setD({ ...d, active: !e.target.checked })} />
          Pause this task (no reminders, history kept)
        </label>
      )}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</button>
      {d.id && !confirmDelete && <button type="button" className="btn btn-quiet btn-danger" onClick={() => setConfirmDelete(true)}>Delete task</button>}
      {d.id && confirmDelete && (
        <div className="notice notice-danger">
          <p>Deleting also erases every result recorded for this task. To keep the history, pause it instead.</p>
          <button type="button" className="btn btn-danger" disabled={busy}
            onClick={async () => { const ok = await run(() => act.deleteTask(d.id!)); if (ok !== undefined) onDone(); }}>
            Delete task and its history
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
