import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { act, formatCode, inviteLink } from '../lib/api';
import { formatShortDay } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { signOut } from '../lib/signOut';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Field, Section, Sheet } from '../components/ui';
import { NotificationsCard } from '../components/NotificationsCard';
import { RecoveryCode } from '../components/RecoveryCode';
import { TimeZoneField } from './Onboarding';
import type { Child } from '../lib/types';

type Invite = { code: string; kind: 'parent' | 'child_device'; childName?: string };

export function FamilyScreen() {
  const { family, activeChildren, parents, devices } = useFamily();
  const [child, setChild] = useState<Child | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const parentInvite = useAction();

  return (
    <main className="page">
      <header className="page-head"><h1>{family.name}</h1></header>

      <Section title="Children">
        <ul className="list">
          {activeChildren.map((c) => {
            const n = devices.filter((d) => d.child_id === c.id).length;
            return (
              <li key={c.id}>
                <button className="list-row" onClick={() => setChild(c)}>
                  <span className="slot-title">{c.display_name}</span>
                  <span className="muted">{n === 0 ? 'No phone linked' : n === 1 ? '1 phone linked' : `${n} phones linked`}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <AddChild />
      </Section>

      <Section title="Parents">
        <ul className="list">{parents.map((p) => <li key={p.user_id} className="list-row">{p.display_name}</li>)}</ul>
        <button className="btn" disabled={parentInvite.busy} onClick={async () => {
          const code = await parentInvite.run(() => act.createInvite('parent'));
          if (code) setInvite({ code, kind: 'parent' });
        }}>Invite a parent</button>
        <ErrorText>{parentInvite.error}</ErrorText>
      </Section>

      <Section title="Help alerts on this phone"><NotificationsCard purpose="help alerts" /></Section>
      <FamilySettings />
      <Account />

      <Sheet open={!!child} title={child?.display_name ?? ''} onClose={() => setChild(null)}>
        {child && <ChildPanel child={child} onInvite={setInvite} onClose={() => setChild(null)} />}
      </Sheet>
      <Sheet open={!!invite} title={invite?.kind === 'parent' ? 'Invite a parent' : `Link ${invite?.childName}'s phone`} onClose={() => setInvite(null)}>
        {invite && <InviteCode invite={invite} />}
      </Sheet>
    </main>
  );
}

function AddChild() {
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  return (
    <form className="inline-form" onSubmit={async (e) => {
      e.preventDefault();
      if ((await run(() => act.addChild(name))) !== undefined) setName('');
    }}>
      <input aria-label="Child's name" placeholder="Child's first name" value={name}
        onChange={(e) => setName(e.target.value)} required maxLength={40} />
      <button className="btn" disabled={busy}>Add child</button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function ChildPanel({ child, onInvite, onClose }: { child: Child; onInvite(i: Invite): void; onClose(): void }) {
  const { devices } = useFamily();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(child.display_name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const linked = devices.filter((d) => d.child_id === child.id);

  return (
    <div className="stack">
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => act.updateChild(child.id, name, false)); }}>
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        <button className="btn" disabled={busy || name === child.display_name}>Rename</button>
      </form>

      <h3>Phones</h3>
      {linked.length === 0 && <p className="muted">No phone linked yet.</p>}
      <ul className="list">
        {linked.map((d) => (
          <li key={d.user_id} className="list-row">
            <span>Linked {formatShortDay(d.linked_at.slice(0, 10))}</span>
            <button className="btn btn-small btn-quiet btn-danger" disabled={busy}
              onClick={() => run(() => act.removeDevice(d.user_id))}>Unlink</button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        const code = await run(() => act.createInvite('child_device', child.id));
        if (code) { onClose(); onInvite({ code, kind: 'child_device', childName: child.display_name }); }
      }}>Link a phone</button>
      <p className="muted">Lost a phone? Unlink it here, then link the new one. {child.display_name}’s history stays.</p>

      {!confirmRemove ? (
        <button className="btn btn-quiet btn-danger" onClick={() => setConfirmRemove(true)}>Remove from family</button>
      ) : (
        <div className="notice notice-danger">
          <p>{child.display_name}’s phones will be unlinked and reminders will stop. Past results are kept.</p>
          <button className="btn btn-danger" disabled={busy} onClick={async () => {
            if ((await run(() => act.updateChild(child.id, child.display_name, true))) !== undefined) onClose();
          }}>Remove {child.display_name}</button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function InviteCode({ invite }: { invite: Invite }) {
  const [status, setStatus] = useState<string | null>(null);
  const link = inviteLink(invite.code, invite.kind);
  const forChild = invite.kind === 'child_device';

  async function share() {
    const text = forChild
      ? `Open this on ${invite.childName}'s phone to set up Family Tasks: ${link}`
      : `Join our family on Family Tasks: ${link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setStatus('Link copied.'); }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setStatus(errorMessage(e));
    }
  }

  return (
    <div className="stack">
      <p className="code" aria-label="Code">{formatCode(invite.code)}</p>
      <p className="muted">
        Works once, for {forChild ? '24 hours' : '7 days'}. Only share it with {forChild ? invite.childName : 'the other parent'}.
      </p>
      {forChild ? (
        <p>On {invite.childName}’s phone, open the app, tap <em>Child: I have a code</em> and type this code.
          On iPhone, add the app to the Home Screen first and enter the code there.</p>
      ) : (
        <p>They open the link, create a parent account, and the code is filled in for them under <em>Join as a parent</em>.</p>
      )}
      <button className="btn btn-primary" onClick={share}>Share link</button>
      <button className="btn" onClick={() => navigator.clipboard.writeText(invite.code).then(() => setStatus('Code copied.'))}>Copy code</button>
      {status && <p className="muted" role="status">{status}</p>}
    </div>
  );
}

function FamilySettings() {
  const { family } = useFamily();
  const { busy, error, run } = useAction();
  const [name, setName] = useState(family.name);
  const [tz, setTz] = useState(family.timezone);
  const changed = name !== family.name || tz !== family.timezone;
  return (
    <Section title="Family settings">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => act.updateFamily(name, tz)); }}>
        <Field label="Family name"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
        <TimeZoneField value={tz} onChange={setTz} />
        <button className="btn" disabled={busy || !changed}>Save settings</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Section>
  );
}

function Account() {
  const qc = useQueryClient();
  const { parents } = useFamily();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const last = parents.length === 1;
  return (
    <Section title="Account">
      <button className="btn" disabled={busy} onClick={() => run(() => signOut(qc))}>Sign out</button>
      <button className="btn" disabled={busy} onClick={async () => {
        const code = await run(act.createRecoveryCode);
        if (code) setNewCode(code);
      }}>Replace my recovery code</button>
      <Sheet open={!!newCode} title="New recovery code" onClose={() => setNewCode(null)}>
        {newCode && <RecoveryCode code={newCode} onDone={() => setNewCode(null)} />}
      </Sheet>
      {!confirm ? (
        <button className="btn btn-quiet btn-danger" onClick={() => setConfirm(true)}>Delete my account</button>
      ) : (
        <div className="notice notice-danger">
          <p>{last
            ? 'You are the only parent. Deleting your account also deletes this family, its children, tasks and history. This can’t be undone.'
            : 'You will leave this family. The other parents keep everything.'}</p>
          <button className="btn btn-danger" disabled={busy}
            onClick={() => run(() => signOut(qc, { deleteAccount: true }))}>
            {last ? 'Delete account and family' : 'Delete my account'}
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}
