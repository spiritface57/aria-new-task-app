import { useMemo, useState } from 'react';
import { formatDay, formatTime, isScheduled } from '../lib/dates';
import { indexResults, resultKey } from '../lib/progress';
import { useResults } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { OUTCOME_LABEL, Stamp } from '../components/ui';
import { ChildFilter } from '../components/ChildFilter';
import type { RespondTarget } from './RespondSheet';
import type { Child, Task, TaskResult } from '../lib/types';

export function Today({ onRespond }: { onRespond(t: RespondTarget): void }) {
  const { family, membership, activeChildren, tasks, today } = useFamily();
  const results = useResults(family.id, today, today);
  const byKey = useMemo(() => indexResults(results.data ?? []), [results.data]);
  const [filter, setFilter] = useState<string | null>(null);

  const visibleChildren = membership.role === 'child'
    ? activeChildren.filter((c) => c.id === membership.childId)
    : activeChildren.filter((c) => !filter || c.id === filter);

  return (
    <main className="page">
      <header className="page-head">
        <h1>{formatDay(today)}</h1>
        {membership.role === 'parent' && <ChildFilter value={filter} onChange={setFilter} />}
      </header>

      {membership.role === 'parent' && activeChildren.length === 0 && (
        <p className="empty">Add your children in <strong>Family</strong>, then create tasks for them.</p>
      )}

      {visibleChildren.map((child) => (
        <ChildDay key={child.id} child={child} today={today} byKey={byKey}
          tasks={tasks.filter((t) => t.assignees.includes(child.id) && isScheduled(t, today))}
          showName={membership.role === 'parent'} onRespond={onRespond} />
      ))}
    </main>
  );
}

function ChildDay({ child, tasks, today, byKey, showName, onRespond }: {
  child: Child; tasks: Task[]; today: string; byKey: Map<string, TaskResult>;
  showName: boolean; onRespond(t: RespondTarget): void;
}) {
  const done = tasks.filter((t) => byKey.get(resultKey(t.id, child.id, today))?.state === 'done').length;
  return (
    <section className="day">
      <div className="day-head">
        {showName && <h2>{child.display_name}</h2>}
        {tasks.length > 0 && <p className="muted">{done} of {tasks.length} done</p>}
      </div>
      {tasks.length === 0 ? <p className="empty">Nothing scheduled today.</p> : (
        <ol className="timeline">
          {tasks.map((task) => {
            const r = byKey.get(resultKey(task.id, child.id, today));
            const state = r?.state ?? 'pending';
            return (
              <li key={task.id}>
                <button className="slot" onClick={() => onRespond({ taskId: task.id, childId: child.id, date: today })}>
                  <time className="slot-time">{formatTime(task.time_local)}</time>
                  <span className="slot-main">
                    <span className="slot-title">{task.title}</span>
                    <span className={`slot-state state-${state}`}>{OUTCOME_LABEL[state]}</span>
                    {r?.note && <span className="slot-note">“{r.note}”</span>}
                  </span>
                  <Stamp state={state} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
