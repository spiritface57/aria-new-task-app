import { useMemo, useState } from 'react';
import { act, load } from '../lib/api';
import { addDays, formatDay, formatShortDay, formatTime, isScheduled } from '../lib/dates';
import { indexResults, resultKey } from '../lib/progress';
import { useAction, useOnceResults, usePendingChecks, useResults, useStats } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, OUTCOME_LABEL, Section, Stamp } from '../components/ui';
import { ChildFilter } from '../components/ChildFilter';
import type { RespondTarget } from './RespondSheet';
import type { Child, ISODate, Task, TaskResult } from '../lib/types';

export function Today({ onRespond }: { onRespond(t: RespondTarget): void }) {
  const { family, membership, activeChildren, tasks, today } = useFamily();
  const isParent = membership.role === 'parent';
  const todays = useResults(family.id, today, today);
  const onceIds = useMemo(() => tasks.filter((t) => t.kind === 'once').map((t) => t.id), [tasks]);
  const once = useOnceResults(family.id, onceIds);
  const byKey = useMemo(() => indexResults([...(todays.data ?? []), ...(once.data ?? [])]), [todays.data, once.data]);
  const [filter, setFilter] = useState<string | null>(null);

  const visibleChildren = membership.role === 'child'
    ? activeChildren.filter((c) => c.id === membership.childId)
    : activeChildren.filter((c) => !filter || c.id === filter);

  return (
    <main className="page">
      <header className="page-head">
        <h1>{formatDay(today)}</h1>
        {membership.role === 'child' && <ChildBadges childId={membership.childId} />}
        {isParent && <ChildFilter value={filter} onChange={setFilter} />}
      </header>

      {isParent && <ToCheck />}

      {isParent && activeChildren.length === 0 && (
        <p className="empty">Add your children in <strong>Family</strong>, then create tasks for them.</p>
      )}

      {visibleChildren.map((child) => (
        <ChildDay key={child.id} child={child} today={today} byKey={byKey} tasks={tasks}
          showName={isParent} onRespond={onRespond} />
      ))}
    </main>
  );
}

function ChildBadges({ childId }: { childId: string }) {
  const { family } = useFamily();
  const stats = useStats(family.id).data?.find((s) => s.child_id === childId);
  if (!stats) return null;
  return (
    <div className="badges">
      <span className="badge badge-streak">🔥 {stats.streak} {stats.streak === 1 ? 'day' : 'days'} in a row</span>
      <span className="badge badge-points">⭐ {stats.balance} points</span>
    </div>
  );
}

function ChildDay({ child, tasks, today, byKey, showName, onRespond }: {
  child: Child; tasks: Task[]; today: ISODate; byKey: Map<string, TaskResult>;
  showName: boolean; onRespond(t: RespondTarget): void;
}) {
  const mine = tasks.filter((t) => t.assignees.includes(child.id) && t.active);
  const unanswered = (t: Task) => !byKey.has(resultKey(t.id, child.id, t.due_on!));
  const dueToday = mine.filter((t) => isScheduled(t, today));
  const late = mine.filter((t) => t.kind === 'once' && t.due_on! < today && unanswered(t));
  const soon = mine.filter((t) => t.kind === 'once' && t.due_on! > today && t.due_on! <= addDays(today, 7) && unanswered(t));
  const done = dueToday.filter((t) => byKey.get(resultKey(t.id, child.id, today))?.state === 'done').length;

  const row = (task: Task, date: ISODate, label?: string) => {
    const r = byKey.get(resultKey(task.id, child.id, date));
    const state = r?.state ?? 'pending';
    const waiting = r?.state === 'done' && r.needs_check && !r.approved_at;
    return (
      <li key={`${task.id}${date}`}>
        <button className="slot" onClick={() => onRespond({ taskId: task.id, childId: child.id, date })}>
          <time className="slot-time">{label ?? formatTime(task.time_local)}</time>
          <span className="slot-main">
            <span className="slot-title">{task.title}{task.points > 0 && <span className="pts">+{task.points}</span>}</span>
            <span className={`slot-state state-${state}`}>
              {waiting ? 'Done, waiting for a parent to check' : OUTCOME_LABEL[state]}
              {task.checklist.length > 0 && state === 'pending' && `, ${task.checklist.length} steps`}
            </span>
            {r?.note && <span className="slot-note">“{r.note}”</span>}
          </span>
          <Stamp state={state} />
        </button>
      </li>
    );
  };

  return (
    <section className="day">
      <div className="day-head">
        {showName && <h2>{child.display_name}</h2>}
        {dueToday.length > 0 && <p className="muted">{done} of {dueToday.length} done</p>}
      </div>
      {late.length > 0 && (
        <>
          <h3 className="late-head">Late</h3>
          <ol className="timeline">{late.map((t) => row(t, t.due_on!, formatShortDay(t.due_on!)))}</ol>
        </>
      )}
      {dueToday.length === 0 ? <p className="empty">Nothing scheduled today.</p> : (
        <ol className="timeline">{dueToday.map((t) => row(t, today))}</ol>
      )}
      {soon.length > 0 && (
        <>
          <h3 className="muted">Coming up</h3>
          <ol className="timeline">{soon.map((t) => row(t, t.due_on!, formatShortDay(t.due_on!)))}</ol>
        </>
      )}
    </section>
  );
}

/** Parents accept "Done" answers on tasks that need checking, so points count. */
function ToCheck() {
  const { family, tasks, childName } = useFamily();
  const pending = usePendingChecks(family.id, true);
  const { busy, error, run } = useAction();
  const [photo, setPhoto] = useState<string | null>(null);
  if (!pending.data?.length) return null;

  return (
    <Section title={`To check (${pending.data.length})`}>
      <ul className="list">
        {pending.data.map((r) => {
          const task = tasks.find((t) => t.id === r.task_id);
          return (
            <li key={resultKey(r.task_id, r.child_id, r.local_date)} className="list-row check-row">
              <div>
                <p className="slot-title">{task?.title ?? 'Deleted task'}</p>
                <p className="muted">{childName(r.child_id)}, {formatShortDay(r.local_date)}{r.points ? `, +${r.points} pts` : ''}</p>
                {r.note && <p className="slot-note">“{r.note}”</p>}
                {r.photo_path && (
                  <button className="btn btn-quiet btn-small" onClick={() =>
                    run(async () => setPhoto(await load.photoUrl(r.photo_path!)))}>See photo</button>
                )}
              </div>
              <div className="button-col">
                <button className="btn btn-small btn-primary" disabled={busy}
                  onClick={() => run(() => act.reviewResult(r.task_id, r.child_id, r.local_date, true))}>Accept</button>
                <button className="btn btn-small" disabled={busy}
                  onClick={() => run(() => act.reviewResult(r.task_id, r.child_id, r.local_date, false))}>Not done</button>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
      {photo && (
        <button className="photo-view" onClick={() => setPhoto(null)} aria-label="Close photo">
          <img src={photo} alt="Photo sent with the task" />
        </button>
      )}
    </Section>
  );
}
