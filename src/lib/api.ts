// The only module that talks to Supabase. Reads use RLS-protected tables;
// every write is an RPC that the database validates.
import { supabase } from './supabase';
import type {
  Child, ChildDevice, Family, ISODate, Membership, Outcome, Parent, Task, TaskDraft, TaskResult,
} from './types';
import { daysToMask } from './dates';

type Response<T> = { data: T | null; error: { message: string } | null };

function unwrap<T>(r: Response<T>): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return unwrap<T>(await supabase.rpc(fn, args) as Response<T>);
}

export async function loadMembership(userId: string, anonymous: boolean): Promise<Membership> {
  const [parent, device] = await Promise.all([
    supabase.from('parents').select('family_id').eq('user_id', userId).maybeSingle(),
    supabase.from('child_devices').select('family_id, child_id').eq('user_id', userId).maybeSingle(),
  ]);
  const p = unwrap<{ family_id: string } | null>(parent);
  if (p) return { role: 'parent', userId, familyId: p.family_id };
  const d = unwrap<{ family_id: string; child_id: string } | null>(device);
  if (d) return { role: 'child', userId, familyId: d.family_id, childId: d.child_id };
  return { role: 'none', userId, anonymous };
}

export const load = {
  family: async (id: string) =>
    unwrap<Family>(await supabase.from('families').select('id, name, timezone').eq('id', id).single()),

  parents: async (familyId: string) =>
    unwrap<Parent[]>(await supabase.from('parents').select('user_id, display_name')
      .eq('family_id', familyId).order('joined_at')),

  children: async (familyId: string) =>
    unwrap<Child[]>(await supabase.from('children').select('id, display_name, archived_at')
      .eq('family_id', familyId).order('created_at')),

  devices: async (familyId: string) =>
    unwrap<ChildDevice[]>(await supabase.from('child_devices').select('user_id, child_id, linked_at')
      .eq('family_id', familyId).order('linked_at')),

  tasks: async (familyId: string): Promise<Task[]> => {
    type Row = Omit<Task, 'assignees'> & { task_assignees: { child_id: string }[] };
    const rows = unwrap<Row[]>(await supabase.from('tasks')
      .select('id, title, days_mask, time_local, active, starts_on, task_assignees(child_id)')
      .eq('family_id', familyId).order('time_local'));
    return rows.map(({ task_assignees, ...task }) => ({
      ...task, assignees: task_assignees.map((a) => a.child_id),
    }));
  },

  results: async (familyId: string, from: ISODate, to: ISODate) =>
    unwrap<TaskResult[]>(await supabase.from('task_results')
      .select('task_id, child_id, local_date, state, note, updated_at')
      .eq('family_id', familyId).gte('local_date', from).lte('local_date', to)),
};

export const act = {
  createFamily: (name: string, displayName: string, timezone: string) =>
    rpc<string>('create_family', { p_name: name, p_display_name: displayName, p_timezone: timezone }),
  updateFamily: (name: string, timezone: string) =>
    rpc('update_family', { p_name: name, p_timezone: timezone }),
  addChild: (name: string) => rpc<string>('add_child', { p_display_name: name }),
  updateChild: (id: string, name: string, archived: boolean) =>
    rpc('update_child', { p_child: id, p_display_name: name, p_archived: archived }),
  createInvite: (kind: 'parent' | 'child_device', childId?: string) =>
    rpc<string>('create_invite', { p_kind: kind, p_child: childId ?? null }),
  acceptInvite: (code: string, displayName?: string) =>
    rpc<{ family_id: string; role: 'parent' | 'child' }>('accept_invite',
      { p_code: code, p_display_name: displayName ?? null }),
  removeDevice: (userId: string) => rpc('remove_child_device', { p_user: userId }),
  saveTask: (d: TaskDraft) => rpc<string>('save_task', {
    p_id: d.id, p_title: d.title, p_time: d.time, p_days: daysToMask(d.days),
    p_active: d.active, p_assignees: d.assignees,
  }),
  deleteTask: (id: string) => rpc('delete_task', { p_id: id }),
  submitResult: (taskId: string, childId: string, date: ISODate, state: Outcome, note: string) =>
    rpc('submit_result', { p_task: taskId, p_child: childId, p_date: date, p_state: state, p_note: note }),
  savePush: (endpoint: string, p256dh: string, auth: string) =>
    rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }),
  deletePush: (endpoint: string) => rpc('delete_push_subscription', { p_endpoint: endpoint }),
  deleteFamily: () => rpc('delete_family'),
  deleteMyAccount: () => rpc('delete_my_account'),
  createRecoveryCode: () => rpc<string>('create_recovery_code'),
  hasRecoveryCode: () => rpc<boolean>('has_recovery_code'),
};

/** Groups a 32-character code as XXXX-XXXX-… so it can be read aloud and typed. */
export function formatCode(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, '').toUpperCase().match(/.{1,4}/g)?.join('-') ?? code;
}

export function inviteLink(code: string, kind: 'parent' | 'child_device'): string {
  const q = new URLSearchParams({ code, for: kind === 'parent' ? 'parent' : 'child' });
  return `${location.origin}/?${q}`;
}
