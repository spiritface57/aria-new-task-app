import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { act } from '../lib/api';
import { allTimeZones, deviceTimeZone } from '../lib/dates';
import { pendingInvite } from '../lib/pendingInvite';
import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useAction } from '../hooks/data';
import { ErrorText, Field, Section, Splash } from '../components/ui';
import { RecoveryCode } from '../components/RecoveryCode';
import { ChildJoin } from './SignIn';
import type { Membership } from '../lib/types';

export function Onboarding({ membership }: { membership: Extract<Membership, { role: 'none' }> }) {
  const signOut = () => supabase.auth.signOut();

  if (membership.anonymous) {
    return (
      <main className="page narrow">
        <h1>Join your family</h1>
        <ChildJoin signedIn />
        <button className="btn btn-quiet" onClick={signOut}>Start over</button>
      </main>
    );
  }
  return <ParentOnboarding signOut={signOut} />;
}

function ParentOnboarding({ signOut }: { signOut(): void }) {
  // A new parent saves a recovery code before anything else: with no email
  // server, it is their only way back in after a forgotten password.
  const recovery = useQuery({ queryKey: ['hasRecoveryCode'], queryFn: act.hasRecoveryCode });
  if (recovery.isPending) return <Splash />;
  if (recovery.data === false) return <SaveRecoveryCode />;
  return (
    <main className="page narrow">
      <h1>Set up your family</h1>
      {pendingInvite.kind() === 'parent' ? <><JoinAsParent /><CreateFamily /></> : <><CreateFamily /><JoinAsParent /></>}
      <button className="btn btn-quiet" onClick={signOut}>Sign out</button>
    </main>
  );
}

function SaveRecoveryCode() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  // Not useAction(): it refreshes every query on success, which would flip
  // hasRecoveryCode to true and leave this screen before the code is shown.
  async function create() {
    setBusy(true); setError(null);
    try { setCode(await act.createRecoveryCode()); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <main className="page narrow">
      <h1>Save your recovery code</h1>
      {code
        ? <RecoveryCode code={code} onDone={() => qc.invalidateQueries({ queryKey: ['hasRecoveryCode'] })} />
        : <div className="stack">
            <p>There’s no password-reset email in this app. Instead you get a recovery code.
              You’ll need it if you ever forget your password.</p>
            <button className="btn btn-primary" disabled={busy} onClick={create}>Show my recovery code</button>
          </div>}
      <ErrorText>{error}</ErrorText>
    </main>
  );
}

function CreateFamily() {
  const qc = useQueryClient();
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  const [me, setMe] = useState('');
  const [tz, setTz] = useState(deviceTimeZone());
  return (
    <Section title="Start a new family">
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        await run(() => act.createFamily(name, me, tz));
        await qc.invalidateQueries({ queryKey: ['membership'] });
      }}>
        <Field label="Family name"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="The Rahimis" /></Field>
        <Field label="Your name" hint="Shown to your family."><input value={me} onChange={(e) => setMe(e.target.value)} required maxLength={60} /></Field>
        <TimeZoneField value={tz} onChange={setTz} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create family'}</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Section>
  );
}

function JoinAsParent() {
  const qc = useQueryClient();
  const { busy, error, run } = useAction();
  const [code, setCode] = useState(pendingInvite.kind() === 'parent' ? pendingInvite.get() : '');
  const [me, setMe] = useState('');
  return (
    <Section title="Join as a parent">
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => act.acceptInvite(code, me));
        if (ok) pendingInvite.clear();
        await qc.invalidateQueries({ queryKey: ['membership'] });
      }}>
        <Field label="Code from the other parent"><input value={code} onChange={(e) => setCode(e.target.value)} required autoCapitalize="characters" autoComplete="off" spellCheck={false} /></Field>
        <Field label="Your name"><input value={me} onChange={(e) => setMe(e.target.value)} required maxLength={60} /></Field>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Joining…' : 'Join family'}</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Section>
  );
}

export function TimeZoneField({ value, onChange }: { value: string; onChange(tz: string): void }) {
  const zones = allTimeZones();
  return (
    <Field label="Time zone" hint="Task times and “today” follow this time zone on every phone.">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!zones.includes(value) && <option value={value}>{value}</option>}
        {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
      </select>
    </Field>
  );
}
