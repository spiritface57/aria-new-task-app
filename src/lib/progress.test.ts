import { describe, expect, it } from 'vitest';
import { indexResults, weekCounts } from './progress';
import type { Task, TaskResult } from './types';

const task = (id: string, assignees: string[], days_mask = 127): Task =>
  ({ id, title: id, days_mask, time_local: '17:00:00', active: true, starts_on: '2026-09-01', assignees });
const result = (task_id: string, child_id: string, local_date: string, state: TaskResult['state']): TaskResult =>
  ({ task_id, child_id, local_date, state, note: '', updated_at: '' });

describe('weekCounts', () => {
  const tasks = [task('piano', ['aria']), task('reading', ['aria', 'sam'])];
  const results = indexResults([
    result('piano', 'aria', '2026-09-28', 'done'),
    result('reading', 'sam', '2026-09-28', 'help'),
  ]);

  it('counts each child separately and leaves future days empty', () => {
    const days = weekCounts('2026-09-28', '2026-09-29', tasks, ['aria', 'sam'], results);
    expect(days[0]).toMatchObject({ done: 1, help: 1, not_done: 0, pending: 1 });
    expect(days[1]).toMatchObject({ done: 0, pending: 3 });
    expect(days[2]).toMatchObject({ done: 0, help: 0, not_done: 0, pending: 0 });
  });

  it('filters to one child', () => {
    const days = weekCounts('2026-09-28', '2026-09-28', tasks, ['sam'], results);
    expect(days[0]).toMatchObject({ help: 1, pending: 0, done: 0 });
  });
});
