import { useState } from 'react';
import { act } from '../lib/api';
import { formatDay } from '../lib/dates';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Sheet, Stamp } from '../components/ui';
import type { ISODate, Outcome, TaskResult } from '../lib/types';

export interface RespondTarget { taskId: string; childId: string; date: ISODate }

export function RespondSheet({ target, existing, onClose }: {
  target: RespondTarget | null; existing?: TaskResult; onClose(): void;
}) {
  const { tasks, membership, childName, today } = useFamily();
  const task = target && tasks.find((t) => t.id === target.taskId);
  return (
    <Sheet open={!!task} title={task?.title ?? ''} onClose={onClose}>
      {task && target && (
        <RespondForm key={`${target.taskId}:${target.childId}:${target.date}`} target={target}
          existing={existing} onDone={onClose}
          subtitle={[
            membership.role === 'parent' ? childName(target.childId) : null,
            target.date === today ? 'Today' : formatDay(target.date),
          ].filter(Boolean).join(', ')} />
      )}
    </Sheet>
  );
}

const CHOICES: { state: Outcome; label: string; prompt?: string }[] = [
  { state: 'done', label: 'Done' },
  { state: 'help', label: 'I need help', prompt: 'What do you need help with?' },
  { state: 'not_done', label: 'Not done', prompt: 'What got in the way?' },
];

function RespondForm({ target, existing, subtitle, onDone }: {
  target: RespondTarget; existing?: TaskResult; subtitle: string; onDone(): void;
}) {
  const { membership } = useFamily();
  const { busy, error, run } = useAction();
  const [state, setState] = useState<Outcome | null>(existing?.state ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const choice = CHOICES.find((c) => c.state === state);

  async function save(s: Outcome, n: string) {
    const ok = await run(() => act.submitResult(target.taskId, target.childId, target.date, s, n));
    if (ok !== undefined) onDone();
  }

  return (
    <div className="stack">
      <p className="muted">{subtitle}</p>
      <div className="choices" role="radiogroup" aria-label="How did it go?">
        {CHOICES.map((c) => (
          <button key={c.state} type="button" role="radio" aria-checked={state === c.state}
            className={`choice choice-${c.state}`} disabled={busy}
            onClick={() => { setState(c.state); if (c.state === 'done') save('done', ''); }}>
            <Stamp state={c.state} size="lg" />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      {choice?.prompt && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save(choice.state, note); }}>
          <label className="field">
            <span className="field-label">{choice.prompt} <span className="muted">(optional)</span></span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
          </label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : membership.role === 'child' ? 'Send to my family' : 'Save'}</button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
