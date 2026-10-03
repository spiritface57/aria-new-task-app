import { addDays, isScheduled } from './dates';
import type { ISODate, Outcome, Task, TaskResult } from './types';

export type Slot = Outcome | 'pending';
export interface DayCounts { date: ISODate; done: number; help: number; not_done: number; pending: number }

export const resultKey = (taskId: string, childId: string, date: ISODate) => `${taskId}|${childId}|${date}`;

export function indexResults(results: TaskResult[]): Map<string, TaskResult> {
  return new Map(results.map((r) => [resultKey(r.task_id, r.child_id, r.local_date), r]));
}

/** Occurrences of each task, for each selected child, on each day up to today. */
export function weekCounts(
  start: ISODate, today: ISODate, tasks: Task[], childIds: string[], results: Map<string, TaskResult>,
): DayCounts[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const counts: DayCounts = { date, done: 0, help: 0, not_done: 0, pending: 0 };
    if (date > today) return counts;
    for (const task of tasks) {
      if (!isScheduled(task, date)) continue;
      for (const childId of task.assignees) {
        if (!childIds.includes(childId)) continue;
        counts[results.get(resultKey(task.id, childId, date))?.state ?? 'pending']++;
      }
    }
    return counts;
  });
}
