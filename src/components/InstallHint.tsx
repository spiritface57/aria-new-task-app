import { isIOS, isStandalone } from '../lib/push';

/** iPhone keeps installed web apps separate from Safari: sign in where you will use the app. */
export function InstallHint() {
  if (!isIOS() || isStandalone()) return null;
  return (
    <div className="notice">
      <strong>On iPhone, install the app first.</strong>
      <p>Tap the Share button, then <em>Add to Home Screen</em>. Open the app from your Home Screen
        and sign in there. Reminders only work in the installed app.</p>
    </div>
  );
}
