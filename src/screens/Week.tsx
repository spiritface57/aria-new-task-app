import { useMemo, useState } from 'react';
import { addDays, formatShortDay, weekStart } from '../lib/dates';
import { indexResults, weekCounts } from '../lib/progress';
import { useResults } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ChildFilter } from '../components/ChildFilter';
import { WeekChart } from '../components/WeekChart';
import { Stamp } from '../components/ui';

export function Week() {
  const { family, membership, activeChildren, tasks, today, childName } = useFamily();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const start = addDays(weekStart(today), offset * 7);
  const end = addDays(start, 6);
  const results = useResults(family.id, start, end);

  const childIds = membership.role === 'child' ? [membership.childId]
    : filter ? [filter] : activeChildren.map((c) => c.id);

  const days = useMemo(
    () => weekCounts(start, today, tasks, childIds, indexResults(results.data ?? [])),
    [start, today, tasks, childIds.join(), results.data]);
  const total = days.reduce((a, d) => ({
    done: a.done + d.done, help: a.help + d.help, not_done: a.not_done + d.not_done, pending: a.pending + d.pending,
  }), { done: 0, help: 0, not_done: 0, pending: 0 });
  const all = total.done + total.help + total.not_done + total.pending;

  const helpNotes = (results.data ?? [])
    // Help requests always; other outcomes only when the child explained something.
    .filter((r) => (r.state === 'help' || r.note.trim() !== '') && childIds.includes(r.child_id))
    .sort((a, b) => b.local_date.localeCompare(a.local_date));

  return (
    <main className="page">
      <header className="page-head">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Previous week">‹</button>
          <h1>{offset === 0 ? 'This week' : `${formatShortDay(start)} to ${formatShortDay(end)}`}</h1>
          <button className="icon-btn" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Next week">›</button>
        </div>
        {membership.role === 'parent' && <ChildFilter value={filter} onChange={setFilter} />}
      </header>

      <section className="panel">
        <p className="week-total">
          {all === 0 ? 'No tasks were due yet this week.'
            : <><strong>{total.done}</strong> of {all} done</>}
        </p>
        <WeekChart days={days} today={today} />
        <ul className="legend">
          <li><Stamp state="done" /> Done {total.done}</li>
          <li><Stamp state="help" /> Needed help {total.help}</li>
          <li><Stamp state="not_done" /> Not done {total.not_done}</li>
          <li><Stamp state="pending" /> Not yet {total.pending}</li>
        </ul>
      </section>

      {helpNotes.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Help requests and notes</h2></div>
          <ul className="list">
            {helpNotes.map((r) => (
              <li key={`${r.task_id}${r.child_id}${r.local_date}`} className="list-row">
                <Stamp state={r.state} />
                <div>
                  <p>{tasks.find((t) => t.id === r.task_id)?.title ?? 'Deleted task'}</p>
                  <p className="muted">
                    {membership.role === 'parent' && `${childName(r.child_id)}, `}{formatShortDay(r.local_date)}
                  </p>
                  {r.note && <p className="slot-note">“{r.note}”</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
