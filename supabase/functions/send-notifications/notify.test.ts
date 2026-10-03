import { describe, expect, it, vi } from 'vitest';
import { helpMessage, reminderMessage, run, type Deps, type HelpAlert, type Reminder } from './notify';

const reminder: Reminder = { task_id: 't1', child_id: 'c1', local_date: '2026-10-03', title: 'Piano',
  endpoint: 'https://push/a', p256dh: 'k', auth: 'a' };
const alertFor = (endpoint: string): HelpAlert => ({ alert_id: 7, child_name: 'Aria', title: 'Piano', endpoint, p256dh: 'k', auth: 'a' });

function deps(over: Partial<Deps>): Deps {
  return {
    claimReminders: async () => [], claimHelpAlerts: async () => [],
    completeHelpAlerts: vi.fn(async () => {}), removeEndpoints: vi.fn(async () => {}),
    send: async () => 'ok', ...over,
  };
}

describe('messages', () => {
  it('deep-links reminders to the response screen', () => {
    expect(reminderMessage(reminder).url).toBe('/?respond=t1&child=c1&date=2026-10-03');
  });
  it('never includes the child’s note in a help alert', () => {
    const m = helpMessage(alertFor('x'));
    expect(m.title).toBe('Aria needs help');
    expect(m.body).toBe('Piano');
  });
});

describe('run', () => {
  it('completes an alert when at least one parent device received it', async () => {
    const d = deps({
      claimHelpAlerts: async () => [alertFor('https://push/mom'), alertFor('https://push/dad')],
      send: async (t) => (t.endpoint.endsWith('mom') ? 'failed' : 'ok'),
    });
    await run(d);
    expect(d.completeHelpAlerts).toHaveBeenCalledWith([7]);
  });
  it('leaves an alert pending for retry when every device failed', async () => {
    const d = deps({ claimHelpAlerts: async () => [alertFor('https://push/mom')], send: async () => 'failed' });
    await run(d);
    expect(d.completeHelpAlerts).not.toHaveBeenCalled();
  });
  it('removes subscriptions the push service says are gone, and survives send errors', async () => {
    const d = deps({
      claimReminders: async () => [reminder, { ...reminder, endpoint: 'https://push/b' }],
      send: async (t) => { if (t.endpoint.endsWith('b')) throw new Error('boom'); return 'gone'; },
    });
    const summary = await run(d);
    expect(d.removeEndpoints).toHaveBeenCalledWith(['https://push/a']);
    expect(summary).toMatchObject({ reminders: 2, sent: 0, failed: 1, removed: 1 });
  });
});
