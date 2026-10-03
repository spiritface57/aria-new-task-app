import type { QueryClient } from '@tanstack/react-query';
import { act } from './api';
import { disablePush } from './push';
import { supabase } from './supabase';

/** Stop this phone's notifications first, so a signed-out phone never gets alerts. */
export async function signOut(qc: QueryClient, opts: { deleteAccount?: boolean } = {}) {
  await disablePush().catch(() => undefined);
  if (opts.deleteAccount) await act.deleteMyAccount();
  await supabase.auth.signOut();
  qc.clear();
}
