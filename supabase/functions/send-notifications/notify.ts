// Runtime-agnostic core, so it can be unit-tested outside Deno.

export interface Target { endpoint: string; p256dh: string; auth: string }
export interface Reminder extends Target {
  task_id: string; child_id: string; local_date: string; title: string;
  attempt: number;        // 1, 2 or 3: rings again until answered
  token: string;          // authorises the Done / Snooze buttons
  quick_done: boolean;    // false when the task needs a checklist or photo
}
export interface HelpAlert extends Target { alert_id: number; child_name: string; title: string }

export interface Message {
  title: string;
  body: string;
  url: string;   // opened when the notification is tapped
  tag: string;   // same tag replaces an older notification instead of stacking
  kind: 'reminder' | 'help';
  token?: string;
  actions?: { action: 'done' | 'snooze' | 'open'; title: string }[];
}

export type SendResult = 'ok' | 'gone' | 'failed';

export interface Deps {
  claimReminders(): Promise<Reminder[]>;
  claimHelpAlerts(): Promise<HelpAlert[]>;
  completeHelpAlerts(ids: number[]): Promise<void>;
  removeEndpoints(endpoints: string[]): Promise<void>;
  send(target: Target, message: Message): Promise<SendResult>;
  /** Removes photos older than 60 days; returns how many. */
  cleanupPhotos(): Promise<number>;
}

// Notes are never put in a notification: lock screens are not private.
export function reminderMessage(r: Reminder): Message {
  const q = new URLSearchParams({ respond: r.task_id, child: r.child_id, date: r.local_date });
  return {
    kind: 'reminder',
    title: r.attempt > 1 ? `⏰ ${r.title} (reminder ${r.attempt} of 3)` : `⏰ ${r.title}`,
    body: r.quick_done ? 'Time for this task!' : 'Time for this task! Open the app to finish it.',
    url: `/?${q}`,
    // Same tag on every ring: the new ring replaces the old one and alerts again.
    tag: `reminder:${r.task_id}:${r.child_id}:${r.local_date}`,
    token: r.token,
    actions: r.quick_done
      ? [{ action: 'done', title: 'Done ✓' }, { action: 'snooze', title: 'In 10 min' }]
      : [{ action: 'open', title: 'Open' }, { action: 'snooze', title: 'In 10 min' }],
  };
}

export function helpMessage(a: HelpAlert): Message {
  return { kind: 'help', title: `${a.child_name} needs help`, body: a.title,
           url: '/?tab=today', tag: `help:${a.alert_id}` };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return out;
}

export async function run(deps: Deps) {
  const [reminders, alerts] = await Promise.all([deps.claimReminders(), deps.claimHelpAlerts()]);
  const jobs = [
    ...reminders.map((r) => ({ target: r, message: reminderMessage(r), alertId: undefined as number | undefined })),
    ...alerts.map((a) => ({ target: a, message: helpMessage(a), alertId: a.alert_id })),
  ];
  const results = await mapLimit(jobs, 20, (j) => deps.send(j.target, j.message).catch((): SendResult => 'failed'));

  const gone = new Set<string>();
  const delivered = new Set<number>();
  results.forEach((res, i) => {
    if (res === 'gone') gone.add(jobs[i].target.endpoint);
    if (res === 'ok' && jobs[i].alertId !== undefined) delivered.add(jobs[i].alertId!);
  });
  // An alert counts as delivered if at least one parent device received it.
  if (delivered.size) await deps.completeHelpAlerts([...delivered]);
  if (gone.size) await deps.removeEndpoints([...gone]);

  // Housekeeping must never block notifications.
  const photosRemoved = await deps.cleanupPhotos().catch(() => 0);

  return { reminders: reminders.length, alerts: alerts.length, sent: results.filter((r) => r === 'ok').length,
           failed: results.filter((r) => r === 'failed').length, removed: gone.size, photosRemoved };
}
