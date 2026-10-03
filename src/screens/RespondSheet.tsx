import { useEffect, useState } from 'react';
import { act, load } from '../lib/api';
import { formatDay } from '../lib/dates';
import { clearTicks, loadTicks, saveTicks } from '../lib/checklist';
import { shrinkPhoto } from '../lib/photo';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Sheet, Stamp } from '../components/ui';
import type { ISODate, Outcome, Task, TaskResult } from '../lib/types';

export interface RespondTarget { taskId: string; childId: string; date: ISODate }

export function RespondSheet({ target, existing, onClose }: {
  target: RespondTarget | null; existing?: TaskResult; onClose(): void;
}) {
  const { tasks, membership, childName, today } = useFamily();
  const task = target && tasks.find((t) => t.id === target.taskId);
  return (
    <Sheet open={!!task} title={task?.title ?? ''} onClose={onClose}>
      {task && target && (
        <RespondForm key={`${target.taskId}:${target.childId}:${target.date}`} task={task} target={target}
          existing={existing} onDone={onClose}
          subtitle={[
            membership.role === 'parent' ? childName(target.childId) : null,
            target.date === today ? 'Today' : target.date < today ? `Late, from ${formatDay(target.date)}` : formatDay(target.date),
            task.points ? `${task.points} points` : null,
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

function RespondForm({ task, target, existing, subtitle, onDone }: {
  task: Task; target: RespondTarget; existing?: TaskResult; subtitle: string; onDone(): void;
}) {
  const { family, membership } = useFamily();
  const isChild = membership.role === 'child';
  const { busy, error, setError, run } = useAction();
  const [state, setState] = useState<Outcome | null>(existing?.state ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [ticks, setTicks] = useState<number[]>(() => loadTicks(task.id, target.childId, target.date));
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const choice = CHOICES.find((c) => c.state === state);

  // Only the child's phone uploads photos (parents recording on a child's behalf skip it).
  const needsPhoto = task.needs_photo && isChild && existing?.state !== 'done';
  const listDone = task.checklist.every((_, i) => ticks.includes(i));
  const canFinish = listDone && (!needsPhoto || !!photo);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  function tick(i: number) {
    const next = ticks.includes(i) ? ticks.filter((x) => x !== i) : [...ticks, i];
    setTicks(next);
    saveTicks(task.id, target.childId, target.date, next);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const small = await shrinkPhoto(file);
      setPhoto(small);
      setPhotoPreview(URL.createObjectURL(small));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(s: Outcome, n: string) {
    const ok = await run(async () => {
      const path = s === 'done' && photo
        ? await act.uploadPhoto(family.id, target.childId, task.id, target.date, photo)
        : null;
      await act.submitResult(task.id, target.childId, target.date, s, n, path);
      return true;
    });
    if (ok) { clearTicks(task.id, target.childId, target.date); onDone(); }
  }

  return (
    <div className="stack">
      <p className="muted">{subtitle}</p>

      {task.checklist.length > 0 && (
        <ul className="checklist">
          {task.checklist.map((item, i) => (
            <li key={i}>
              <label className="check">
                <input type="checkbox" checked={ticks.includes(i)} onChange={() => tick(i)} />
                {item}
              </label>
            </li>
          ))}
        </ul>
      )}

      {needsPhoto && (
        <div className="stack">
          <label className="btn photo-btn">
            {photo ? 'Take a different photo' : '📷 Take a photo to finish'}
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
          {photoPreview && <img className="photo-preview" src={photoPreview} alt="Your photo" />}
        </div>
      )}

      <div className="choices" role="radiogroup" aria-label="How did it go?">
        {CHOICES.map((c) => {
          const locked = c.state === 'done' && !canFinish;
          return (
            <button key={c.state} type="button" role="radio" aria-checked={state === c.state}
              className={`choice choice-${c.state}`} disabled={busy || locked}
              onClick={() => { setState(c.state); if (c.state === 'done') save('done', ''); }}>
              <Stamp state={c.state} size="lg" />
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>
      {!canFinish && (
        <p className="muted">
          {!listDone ? 'Tick every step to unlock Done.' : 'Add a photo to unlock Done.'}
        </p>
      )}

      {choice?.prompt && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); save(choice.state, note); }}>
          <label className="field">
            <span className="field-label">{choice.prompt} <span className="muted">(optional)</span></span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
          </label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isChild ? 'Send to my family' : 'Save'}</button>
        </form>
      )}

      {existing?.photo_path && <SavedPhoto path={existing.photo_path} />}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function SavedPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { load.photoUrl(path).then(setUrl, () => setFailed(true)); }, [path]);
  if (failed) return <p className="muted">The photo is no longer available (photos are kept 60 days).</p>;
  return url ? <img className="photo-preview" src={url} alt="Photo sent with this task" /> : null;
}
