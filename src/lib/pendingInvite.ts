// An invite link (/?code=…&for=parent|child) is remembered across reloads and
// app restarts until the code is used, so the person can create an account first.
const KEY = 'familyTasks.pendingInvite';
type Kind = 'parent' | 'child';

export function captureInviteFromUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return;
  const kind: Kind = url.searchParams.get('for') === 'parent' ? 'parent' : 'child';
  localStorage.setItem(KEY, JSON.stringify({ code, kind }));
  url.searchParams.delete('code');
  url.searchParams.delete('for');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function read(): { code: string; kind: Kind } | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export const pendingInvite = {
  get: () => read()?.code ?? '',
  kind: (): Kind | null => read()?.kind ?? null,
  clear: () => localStorage.removeItem(KEY),
};
