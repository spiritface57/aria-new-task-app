import { useEffect, useRef, type ReactNode } from 'react';
import type { Outcome } from '../lib/types';

export function Sheet({ open, title, onClose, children }: {
  open: boolean; title: string; onClose(): void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

export const OUTCOME_LABEL: Record<Outcome | 'pending', string> = {
  done: 'Done', help: 'Needs help', not_done: 'Not done', pending: 'Not yet',
};
const OUTCOME_MARK: Record<Outcome | 'pending', string> = {
  done: '✓', help: '?', not_done: '✕', pending: '',
};

export function Stamp({ state, size = 'md' }: { state: Outcome | 'pending'; size?: 'md' | 'lg' }) {
  return (
    <span className={`stamp stamp-${state} stamp-${size}`} role="img" aria-label={OUTCOME_LABEL[state]}>
      {OUTCOME_MARK[state]}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="error" role="alert">{children}</p> : null;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export function Splash({ text = 'Loading…' }: { text?: string }) {
  return <div className="splash"><p>{text}</p></div>;
}
