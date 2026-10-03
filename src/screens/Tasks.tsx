import { useState } from 'react';
import { act } from '../lib/api';
import { addDays, describeDays, formatShortDay, formatTime, maskToDays, WEEKDAY_SHORT } from '../lib/dates';
import { ROUTINES } from '../lib/routines';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Field, Sheet } from '../components/ui';
import type { Task, TaskDraft } from '../lib/types';

export function Tasks() {
  const { tasks, activeChildren, childName, today } = useFamily();
  const [editing, setEditing] = useState<TaskDraft | null>(null);
  const [routines, setRoutines] = useState(false);

  const newDraft = (): TaskDraft => ({
    id: null, title: '', kind: 'repeat', time: '17:00', days: [1, 2, 3, 4, 5], dueOn: addDays(today, 1),
    active: true, assignees: activeChildren.length === 1 ? [activeChildren[0].id] : [],
    points: 1, needsCheck: false, needsPhoto: false, checklist: [],
  });
  const toDraft = (t: Task): TaskDraft => ({
    id: t.id, title: t.title, kind: t.kind, time: t.time_local.slice(0, 5),
    days: t.kind === 'repeat' ? maskToDays(t.days_mask) : [1, 2, 3, 4, 5], dueOn: t.due_on ?? today,
    active: t.active, assignees: t.assignees, points: t.points, needsCheck: t.needs_check,
    needsPhoto: t.needs_photo, checklist: t.checklist,
  });
  const when = (t: Task) => t.kind === 'once' ? `Once, ${formatShortDay(t.due_on!)}` : describeDays(t.days_mask);
  const extras = (t: Task) => [
    t.points ? `${t.points} pts` : null, t.checklist.length ? 'checklist' : null,
    t.needs_photo ? 'photo' : null, t.needs_check ? 'parent checks' : null,
  ].filter(Boolean);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Tasks</h1>
        {activeChildren.length > 0 && (
          <div className="button-row">
            <button className="btn btn-primary btn-small" onClick={() => setEditing(newDraft())}>Add task</button>
            <button className="btn btn-small" onClick={() => setRoutines(true)}>Add a routine</button>
          </div>
        )}
      </header>
      {activeChildren.length === 0 && <p className="empty">Add a child in <strong>Family</strong> first.</p>}
      {activeChildren.length > 0 && tasks.length === 0 && (
        <p className="empty">No tasks yet. Start with a ready-made routine, or add your own.</p>
      )}
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id}>
            <button className={`list-row task-row ${t.active ? '' : 'is-paused'}`} onClick={() => setEditing(toDraft(t))}>
              <time className="slot-time">{formatTime(t.time_local)}</time>
              <span>
                <span className="slot-title">{t.title}{!t.active && <span className="tag">Paused</span>}</span>
                <span className="muted">{when(t)}, for {t.assignees.map(childName).join(' and ') || 'nobody'}</span>
                {extras(t).length > 0 && <span className="muted">{extras(t).join(', ')}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} title={editing?.id ? 'Edit task' : 'New task'} onClose={() => setEditing(null)}>
        {editing && <TaskEditor draft={editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={routines} title="Add a routine" onClose={() => setRoutines(false)}>
        {routines && <RoutinePicker onDone={() => setRoutines(false)} />}
      </Sheet>
    </main>
  );
}

function TaskEditor({ draft, onDone }: { draft: TaskDraft; onDone(): void }) {
  const { activeChildren, today } = useFamily();
  const { busy, error, setError, run } = useAction();
  const [d, setD] = useState(draft);
  const [listText, setListText] = useState(draft.checklist.join('\n'));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    if (d.kind === 'repeat' && d.days.length === 0) return setError('Choose at least one day.');
    if (d.assignees.length === 0) return setError('Choose at least one child for this task.');
    const checklist = listText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (checklist.length > 20) return setError('A checklist can have up to 20 items.');
    const ok = await run(() => act.saveTask({ ...d, title: d.title.trim(), checklist }));
    if (ok !== undefined) onDone();
  }

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Task"><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required maxLength={160} placeholder="Piano practice" /></Field>

      <div className="segmented" role="radiogroup" aria-label="How often">
        <button type="button" role="radio" aria-checked={d.kind === 'repeat'} onClick={() => setD({ ...d, kind: 'repeat' })}>Repeats</button>
        <button type="button" role="radio" aria-checked={d.kind === 'once'} onClick={() => setD({ ...d, kind: 'once' })}>One time</button>
      </div>

      {d.kind === 'repeat' ? (
        <fieldset className="field">
          <legend className="field-label">Repeats on</legend>
          <div className="day-picker">
            {WEEKDAY_SHORT.map((label, i) => (
              <button key={label} type="button" className="chip" aria-pressed={d.days.includes(i + 1)}
                onClick={() => setD({ ...d, days: toggle(d.days, i + 1).sort() })}>{label}</button>
            ))}
          </div>
        </fieldset>
      ) : (
        <Field label="Date" hint="If it isn't done that day, it stays on Today as late until it is.">
          <input type="date" value={d.dueOn} min={today} onChange={(e) => setD({ ...d, dueOn: e.target.value })} required />
        </Field>
      )}
      <Field label="Reminder time"><input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} required /></Field>

      <fieldset className="field">
        <legend className="field-label">For</legend>
        <div className="day-picker">
          {activeChildren.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={d.assignees.includes(c.id)}
              onClick={() => setD({ ...d, assignees: toggle(d.assignees, c.id) })}>{c.display_name}</button>
          ))}
        </div>
      </fieldset>

      <Field label="Points" hint="Earned when it's done. Changing points later doesn't change past days.">
        <input type="number" inputMode="numeric" min={0} max={1000} value={d.points}
          onChange={(e) => setD({ ...d, points: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} />
      </Field>
      <Field label="Checklist (optional)" hint="One item per line. Done unlocks when every item is ticked.">
        <textarea rows={3} value={listText} onChange={(e) => setListText(e.target.value)} placeholder={'Books\nLunch\nWater bottle'} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={d.needsPhoto} onChange={(e) => setD({ ...d, needsPhoto: e.target.checked })} />
        Needs a photo when done
      </label>
      <label className="check">
        <input type="checkbox" checked={d.needsCheck} onChange={(e) => setD({ ...d, needsCheck: e.target.checked })} />
        A parent checks it before points count
      </label>
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
          <p>Deleting also erases every result recorded for this task, including points earned. To keep the history, pause it instead.</p>
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

function RoutinePicker({ onDone }: { onDone(): void }) {
  const { activeChildren, today } = useFamily();
  const { busy, error, run } = useAction();
  const [routineId, setRoutineId] = useState(ROUTINES[0].id);
  const [kids, setKids] = useState<string[]>(activeChildren.length === 1 ? [activeChildren[0].id] : []);
  const routine = ROUTINES.find((r) => r.id === routineId)!;

  async function add() {
    const ok = await run(async () => {
      for (const t of routine.tasks) {
        await act.saveTask({ ...t, id: null, kind: 'repeat', dueOn: today, active: true, assignees: kids,
          needsCheck: false, needsPhoto: false });
      }
      return true;
    });
    if (ok) onDone();
  }

  return (
    <div className="stack">
      <div className="chips">
        {ROUTINES.map((r) => (
          <button key={r.id} type="button" className="chip" aria-pressed={r.id === routineId} onClick={() => setRoutineId(r.id)}>{r.name}</button>
        ))}
      </div>
      <ul className="list">
        {routine.tasks.map((t) => (
          <li key={t.title} className="list-row task-row">
            <time className="slot-time">{formatTime(t.time)}</time>
            <span><span className="slot-title">{t.title}</span>
              <span className="muted">{t.days.length === 7 ? 'Every day' : 'Weekdays'}, {t.points} pts{t.checklist.length ? ', checklist' : ''}</span></span>
          </li>
        ))}
      </ul>
      <fieldset className="field">
        <legend className="field-label">For</legend>
        <div className="day-picker">
          {activeChildren.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={kids.includes(c.id)}
              onClick={() => setKids(kids.includes(c.id) ? kids.filter((k) => k !== c.id) : [...kids, c.id])}>{c.display_name}</button>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-primary" disabled={busy || kids.length === 0} onClick={add}>
        {busy ? 'Adding…' : `Add ${routine.tasks.length} tasks`}
      </button>
      <p className="muted">You can change times, points or days of each task afterwards.</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
