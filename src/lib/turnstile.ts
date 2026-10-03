import { config } from './config';

// Cloudflare Turnstile protects anonymous sign-in (the child flow) from bots.
// When no site key is configured (local development), the check is skipped.

type Turnstile = {
  render(el: HTMLElement, opts: { sitekey: string; callback(token: string): void;
    'error-callback'(): void; 'expired-callback'(): void; appearance?: string }): string;
  remove(id: string): void;
};

let loading: Promise<Turnstile> | null = null;

function loadScript(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
    s.onerror = () => { loading = null; reject(new Error('Could not load the security check.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export const captchaEnabled = () => !!config.turnstileSiteKey;

/** Renders the widget into `el`; calls onToken with a fresh token (or null when it expires). */
export async function mountCaptcha(el: HTMLElement, onToken: (token: string | null) => void): Promise<() => void> {
  const ts = await loadScript();
  const id = ts.render(el, {
    sitekey: config.turnstileSiteKey,
    callback: (token) => onToken(token),
    'error-callback': () => onToken(null),
    'expired-callback': () => onToken(null),
  });
  return () => ts.remove(id);
}
