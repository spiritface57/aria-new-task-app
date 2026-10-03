import type { Session } from '@supabase/supabase-js';
import { missingConfig } from './lib/config';
import { useMembership, useSession } from './hooks/data';
import { Splash } from './components/ui';
import { SignIn } from './screens/SignIn';
import { Onboarding } from './screens/Onboarding';
import { Shell } from './Shell';

export function App() {
  if (missingConfig.length) {
    return (
      <main className="page narrow">
        <h1>Setup needed</h1>
        <p>Add these to <code>.env</code> (or your host's environment variables) and rebuild:</p>
        <ul>{missingConfig.map((k) => <li key={k}><code>{k}</code></li>)}</ul>
      </main>
    );
  }
  return <Root />;
}

function Root() {
  const session = useSession();
  if (session === undefined) return <Splash />;
  if (!session) return <SignIn />;
  return <SignedIn session={session} />;
}

function SignedIn({ session }: { session: Session }) {
  const membership = useMembership(session);
  if (membership.isPending) return <Splash />;
  if (membership.isError) {
    return <div className="splash"><p>Couldn’t reach the server. Check your connection.</p>
      <button className="btn" onClick={() => membership.refetch()}>Try again</button></div>;
  }
  const m = membership.data;
  return m.role === 'none' ? <Onboarding membership={m} /> : <Shell membership={m} />;
}
