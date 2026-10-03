import { useEffect, useRef } from 'react';
import { captchaEnabled, mountCaptcha } from '../lib/turnstile';

/**
 * Turnstile tokens are single-use: give this component a new `key` after every
 * submit so a fresh challenge is issued. Renders nothing when CAPTCHA is off.
 */
export function Captcha({ onToken, onError }: { onToken(token: string | null): void; onError(msg: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!captchaEnabled() || !ref.current) return;
    onToken(null);
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    mountCaptcha(ref.current, onToken).then(
      (c) => { if (cancelled) c(); else cleanup = c; },
      (e: Error) => onError(e.message));
    return () => { cancelled = true; cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return captchaEnabled() ? <div ref={ref} className="captcha" /> : null;
}
