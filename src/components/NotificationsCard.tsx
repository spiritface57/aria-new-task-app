import { useEffect, useState } from 'react';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { errorMessage } from '../lib/errors';
import { ErrorText } from './ui';

const TEXT: Record<PushState, string> = {
  'install-first': 'On iPhone, notifications only work in the installed app. Tap Share, then Add to Home Screen, and open it from there.',
  unsupported: 'This browser can’t show notifications. Use Chrome on Android or the installed app on iPhone.',
  denied: 'Notifications are blocked. Allow them for this app in your phone’s settings, then come back.',
  off: '',
  on: 'On for this phone. Tip for Android: in the phone’s Settings → Apps → Family Tasks → Notifications, pick a loud ringtone as the sound.',
};

export function NotificationsCard({ purpose }: { purpose: 'reminders' | 'help alerts' }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { pushState().then(setState, () => setState('unsupported')); }, []);

  async function change(fn: () => Promise<PushState | void>) {
    setBusy(true); setError(null);
    try { const next = await fn(); setState(next ?? await pushState()); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  if (!state) return null;
  return (
    <div className="stack">
      <p>{state === 'off'
        ? purpose === 'reminders' ? 'Get a notification when each task is due.' : 'Get a notification when a child asks for help.'
        : TEXT[state]}</p>
      {state === 'off' && <button className="btn btn-primary" disabled={busy} onClick={() => change(enablePush)}>Turn on {purpose}</button>}
      {state === 'on' && <button className="btn" disabled={busy} onClick={() => change(disablePush)}>Turn off on this phone</button>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
