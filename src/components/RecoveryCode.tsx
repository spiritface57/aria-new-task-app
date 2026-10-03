import { useState } from 'react';
import { formatCode } from '../lib/api';

/** Shows a recovery code once and makes the parent confirm they saved it. */
export function RecoveryCode({ code, onDone, doneLabel = 'I saved it' }: {
  code: string; onDone(): void; doneLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <p>If you forget your password, this code is the only way back into your account.
        Save it somewhere safe, like your password manager or a photo. It works once.</p>
      <p className="code" aria-label="Recovery code">{formatCode(code)}</p>
      <button type="button" className="btn" onClick={() =>
        navigator.clipboard.writeText(formatCode(code)).then(() => setCopied(true))}>
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved this code
      </label>
      <button type="button" className="btn btn-primary" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
