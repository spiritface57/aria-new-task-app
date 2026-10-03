import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { signOut } from '../lib/signOut';
import { useAction } from '../hooks/data';
import { useFamily } from '../hooks/FamilyContext';
import { ErrorText, Section } from '../components/ui';
import { NotificationsCard } from '../components/NotificationsCard';

export function Me() {
  const qc = useQueryClient();
  const { family, membership, childName } = useFamily();
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const name = membership.role === 'child' ? childName(membership.childId) : '';

  return (
    <main className="page">
      <header className="page-head"><h1>Hi, {name}</h1><p className="muted">{family.name}</p></header>
      <Section title="Reminders"><NotificationsCard purpose="reminders" /></Section>
      <Section title="This phone">
        {!confirm ? (
          <button className="btn btn-quiet" onClick={() => setConfirm(true)}>Unlink this phone</button>
        ) : (
          <div className="notice notice-danger">
            <p>To use the app on this phone again, a parent will need to give you a new code. Your history stays.</p>
            <button className="btn btn-danger" disabled={busy}
              onClick={() => run(() => signOut(qc, { deleteAccount: true }))}>Unlink this phone</button>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </Section>
    </main>
  );
}
