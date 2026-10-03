import { useState } from 'react';
import { act } from '../lib/api';
import { formatShortDay } from '../lib/dates';
import { useAction, useRewards, useStats } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Field, Section, Sheet } from '../components/ui';
import type { Reward, RewardRequest } from '../lib/types';

export function Rewards() {
  const { family, membership } = useFamily();
  const { rewards, requests } = useRewards(family.id);
  const stats = useStats(family.id);
  if (!rewards.data || !requests.data || !stats.data) return <main className="page"><p className="muted">Loading…</p></main>;
  return membership.role === 'parent'
    ? <ParentRewards rewards={rewards.data} requests={requests.data} />
    : <ChildRewards childId={membership.childId} rewards={rewards.data} requests={requests.data}
        balance={stats.data.find((s) => s.child_id === membership.childId)?.balance ?? 0}
        streak={stats.data.find((s) => s.child_id === membership.childId)?.streak ?? 0} />;
}

const STATUS: Record<RewardRequest['status'], string> = {
  pending: 'Waiting for a parent', approved: 'Approved', declined: 'Not this time',
};

function ChildRewards({ childId, rewards, requests, balance, streak }: {
  childId: string; rewards: Reward[]; requests: RewardRequest[]; balance: number; streak: number;
}) {
  const { busy, error, run } = useAction();
  const active = rewards.filter((r) => r.active);
  const mine = requests.filter((r) => r.child_id === childId).slice(0, 10);
  return (
    <main className="page">
      <header className="page-head">
        <h1>Rewards</h1>
        <div className="badges">
          <span className="badge badge-points">⭐ {balance} points to spend</span>
          <span className="badge badge-streak">🔥 {streak} {streak === 1 ? 'day' : 'days'} in a row</span>
        </div>
      </header>
      {active.length === 0 && <p className="empty">No rewards yet. Ask a parent to add some!</p>}
      <ul className="list">
        {active.map((r) => {
          const short = r.cost - balance;
          return (
            <li key={r.id} className="list-row">
              <div><p className="slot-title">{r.title}</p><p className="muted">{r.cost} points</p></div>
              {short > 0
                ? <span className="muted">{short} more to go</span>
                : <button className="btn btn-small btn-primary" disabled={busy}
                    onClick={() => run(() => act.requestReward(r.id, childId))}>Ask for it</button>}
            </li>
          );
        })}
      </ul>
      <ErrorText>{error}</ErrorText>
      {mine.length > 0 && (
        <Section title="My requests">
          <ul className="list">
            {mine.map((q) => (
              <li key={q.id} className="list-row">
                <div><p>{q.title}</p><p className="muted">{formatShortDay(q.requested_at.slice(0, 10))}, {q.cost} points</p></div>
                <span className={`tag tag-${q.status}`}>{STATUS[q.status]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  );
}

function ParentRewards({ rewards, requests }: { rewards: Reward[]; requests: RewardRequest[] }) {
  const { family, childName } = useFamily();
  const stats = useStats(family.id).data ?? [];
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<Partial<Reward> | null>(null);
  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <main className="page">
      <header className="page-head">
        <h1>Rewards</h1>
        <button className="btn btn-primary btn-small" onClick={() => setEditing({ title: '', cost: 20, active: true })}>Add reward</button>
      </header>

      {pending.length > 0 && (
        <Section title={`Requests (${pending.length})`}>
          <ul className="list">
            {pending.map((q) => (
              <li key={q.id} className="list-row check-row">
                <div><p className="slot-title">{q.title}</p><p className="muted">{childName(q.child_id)}, {q.cost} points</p></div>
                <div className="button-col">
                  <button className="btn btn-small btn-primary" disabled={busy} onClick={() => run(() => act.decideReward(q.id, true))}>Approve</button>
                  <button className="btn btn-small" disabled={busy} onClick={() => run(() => act.decideReward(q.id, false))}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted">Declining gives the points back.</p>
        </Section>
      )}
      <ErrorText>{error}</ErrorText>

      <Section title="Points">
        <ul className="list">
          {stats.map((s) => (
            <li key={s.child_id} className="list-row">
              <span className="slot-title">{childName(s.child_id)}</span>
              <span className="muted">⭐ {s.balance} to spend, 🔥 {s.streak} {s.streak === 1 ? 'day' : 'days'}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Reward list">
        {rewards.length === 0 && <p className="empty">Add rewards your children can save up for, like “30 minutes of tablet time”.</p>}
        <ul className="list">
          {rewards.map((r) => (
            <li key={r.id}>
              <button className={`list-row ${r.active ? '' : 'is-paused'}`} onClick={() => setEditing(r)}>
                <span className="slot-title">{r.title}{!r.active && <span className="tag">Hidden</span>}</span>
                <span className="muted">{r.cost} points</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Sheet open={!!editing} title={editing?.id ? 'Edit reward' : 'New reward'} onClose={() => setEditing(null)}>
        {editing && <RewardEditor reward={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

function RewardEditor({ reward, onDone }: { reward: Partial<Reward>; onDone(): void }) {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(reward.title ?? '');
  const [cost, setCost] = useState(reward.cost ?? 20);
  const [active, setActive] = useState(reward.active ?? true);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      if ((await run(() => act.saveReward(reward.id ?? null, title.trim(), cost, active))) !== undefined) onDone();
    }}>
      <Field label="Reward"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} placeholder="30 minutes of tablet time" /></Field>
      <Field label="Cost in points">
        <input type="number" inputMode="numeric" min={1} max={100000} value={cost}
          onChange={(e) => setCost(Math.max(1, Number(e.target.value) || 1))} required />
      </Field>
      {reward.id && (
        <label className="check">
          <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
          Hide this reward (past requests are kept)
        </label>
      )}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save reward'}</button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
