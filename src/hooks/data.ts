import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { load, loadMembership } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { todayIn } from '../lib/dates';
import type { ISODate } from '../lib/types';

/** undefined while the stored session is being read. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // Only set state here: calling Supabase inside this callback can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function useMembership(session: Session) {
  const user = session.user;
  return useQuery({
    queryKey: ['membership', user.id],
    queryFn: () => loadMembership(user.id, user.is_anonymous ?? false),
  });
}

export function useFamilyQueries(familyId: string, isParent: boolean) {
  return {
    family: useQuery({ queryKey: ['family', familyId], queryFn: () => load.family(familyId) }),
    children: useQuery({ queryKey: ['children', familyId], queryFn: () => load.children(familyId) }),
    parents: useQuery({ queryKey: ['parents', familyId], queryFn: () => load.parents(familyId) }),
    devices: useQuery({ queryKey: ['devices', familyId], queryFn: () => load.devices(familyId), enabled: isParent }),
    tasks: useQuery({ queryKey: ['tasks', familyId], queryFn: () => load.tasks(familyId) }),
  };
}

export function useResults(familyId: string, from: ISODate, to: ISODate) {
  return useQuery({
    queryKey: ['results', familyId, from, to],
    queryFn: () => load.results(familyId, from, to),
  });
}

/** Live updates. Refetch-on-focus (React Query default) covers events missed while asleep. */
export function useRealtime(familyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const filter = `family_id=eq.${familyId}`;
    const refresh = (key: string) => () => qc.invalidateQueries({ queryKey: [key, familyId] });
    const channel = supabase.channel(`family:${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_results', filter }, refresh('results'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, refresh('tasks'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees', filter }, refresh('tasks'))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [familyId, qc]);
}

/** The family's current date; rolls over at local midnight while the app is open. */
export function useToday(timeZone: string): ISODate {
  const [today, setToday] = useState(() => todayIn(timeZone));
  useEffect(() => {
    setToday(todayIn(timeZone));
    const id = setInterval(() => setToday(todayIn(timeZone)), 30_000);
    return () => clearInterval(id);
  }, [timeZone]);
  return today;
}

/** Runs one user action at a time with busy and error state, then refreshes data. */
export function useAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await qc.invalidateQueries();
      return result;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
