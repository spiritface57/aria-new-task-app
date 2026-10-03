import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { act } from '../lib/api';
import { MIN_PASSWORD, resetPassword, signIn, signUp } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { captchaEnabled } from '../lib/turnstile';
import { pendingInvite } from '../lib/pendingInvite';
import { ErrorText, Field } from '../components/ui';
import { Captcha } from '../components/Captcha';
import { InstallHint } from '../components/InstallHint';
import { RecoveryCode } from '../components/RecoveryCode';

type Mode = 'start' | 'signin' | 'signup' | 'forgot' | 'child';

export function SignIn() {
  const [mode, setMode] = useState<Mode>(() => {
    const kind = pendingInvite.kind();
    return kind === 'parent' ? 'signup' : kind === 'child' ? 'child' : 'start';
  });
  const back = () => setMode('start');

  return (
    <main className="welcome">
      <div className="welcome-mark" aria-hidden="true">
        <span className="stamp stamp-done stamp-lg">✓</span>
        <span className="stamp stamp-help stamp-lg">?</span>
        <span className="stamp stamp-pending stamp-lg" />
      </div>
      <h1>Family Tasks</h1>
      {mode === 'start' && (
        <>
          <p className="lede">Daily routines with reminders. Kids tell you how it went; you see it right away.</p>
          <InstallHint />
          <div className="stack">
            <button className="btn btn-primary" onClick={() => setMode('signin')}>I’m a parent</button>
            <button className="btn" onClick={() => setMode('child')}>I’m a child with a code</button>
          </div>
        </>
      )}
      {(mode === 'signin' || mode === 'signup') && <ParentAuth mode={mode} onMode={setMode} onBack={back} />}
      {mode === 'forgot' && <ForgotPassword onBack={() => setMode('signin')} />}
      {mode === 'child' && <ChildJoin onBack={back} />}
    </main>
  );
}

/** Wraps a submit with busy/error state and a fresh CAPTCHA token per attempt. */
function useCaptchaForm() {
  const [token, setToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !busy && (!captchaEnabled() || !!token);

  async function submit(e: FormEvent, fn: (token?: string) => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn(token ?? undefined);
    } catch (err) {
      setError(errorMessage(err));
      setCaptchaKey((k) => k + 1);   // tokens are single-use
    } finally {
      setBusy(false);
    }
  }
  const captcha = <Captcha key={captchaKey} onToken={setToken} onError={setError} />;
  return { busy, error, ready, submit, captcha };
}

function ParentAuth({ mode, onMode, onBack }: { mode: 'signin' | 'signup'; onMode(m: Mode): void; onBack(): void }) {
  const f = useCaptchaForm();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isNew = mode === 'signup';

  return (
    <form className="stack" onSubmit={(e) => f.submit(e, (t) =>
      isNew ? signUp(email.trim(), password, t) : signIn(email.trim(), password, t))}>
      <h2>{isNew ? 'Create a parent account' : 'Parent sign in'}</h2>
      <InstallHint />
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </Field>
      <Field label="Password" hint={isNew ? `At least ${MIN_PASSWORD} characters.` : undefined}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          minLength={MIN_PASSWORD} maxLength={72} autoComplete={isNew ? 'new-password' : 'current-password'} />
      </Field>
      {f.captcha}
      <button className="btn btn-primary" disabled={!f.ready}>
        {f.busy ? 'Please wait…' : isNew ? 'Create account' : 'Sign in'}
      </button>
      <ErrorText>{f.error}</ErrorText>
      {isNew
        ? <button type="button" className="btn btn-quiet" onClick={() => onMode('signin')}>I already have an account</button>
        : <>
            <button type="button" className="btn btn-quiet" onClick={() => onMode('signup')}>Create a new account</button>
            <button type="button" className="btn btn-quiet" onClick={() => onMode('forgot')}>Forgot password?</button>
          </>}
      <button type="button" className="btn btn-quiet" onClick={onBack}>Back</button>
    </form>
  );
}

function ForgotPassword({ onBack }: { onBack(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  if (newCode) {
    return (
      <div className="stack">
        <h2>Password changed</h2>
        <p>Your old recovery code no longer works. Here is your new one.</p>
        <RecoveryCode code={newCode} onDone={onBack} doneLabel="Continue to sign in" />
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError(null);
      try { setNewCode(await resetPassword(email.trim(), code, password)); }
      catch (err) { setError(errorMessage(err)); }
      finally { setBusy(false); }
    }}>
      <h2>Reset your password</h2>
      <p className="muted">Use the recovery code you saved when you created your account.
        Lost it? Another parent in your family can invite you again with a new account.</p>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
      <Field label="Recovery code"><input value={code} onChange={(e) => setCode(e.target.value)} required autoCapitalize="characters" autoComplete="off" spellCheck={false} /></Field>
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} maxLength={72} autoComplete="new-password" />
      </Field>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : 'Set new password'}</button>
      <ErrorText>{error}</ErrorText>
      <button type="button" className="btn btn-quiet" onClick={onBack}>Back to sign in</button>
    </form>
  );
}

/** Used both before sign-in and by an anonymous login that has no family yet. */
export function ChildJoin({ onBack, signedIn = false }: { onBack?(): void; signedIn?: boolean }) {
  const qc = useQueryClient();
  const f = useCaptchaForm();
  const [code, setCode] = useState(pendingInvite.kind() === 'child' ? pendingInvite.get() : '');

  return (
    <form className="stack" onSubmit={(e) => f.submit(e, async (token) => {
      if (!signedIn) {
        const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken: token } });
        if (error) throw error;
      }
      await act.acceptInvite(code);
      pendingInvite.clear();
      await qc.invalidateQueries({ queryKey: ['membership'] });
    })}>
      <InstallHint />
      <Field label="Code from your parent" hint="Letters and numbers. Dashes and spaces don't matter.">
        <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters"
          autoComplete="off" spellCheck={false} required minLength={32} />
      </Field>
      {!signedIn && f.captcha}
      <button className="btn btn-primary" disabled={signedIn ? f.busy : !f.ready}>
        {f.busy ? 'Joining…' : 'Join my family'}
      </button>
      {onBack && <button type="button" className="btn btn-quiet" onClick={onBack}>Back</button>}
      <ErrorText>{f.error}</ErrorText>
    </form>
  );
}
