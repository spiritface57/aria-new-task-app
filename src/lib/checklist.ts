import type { ISODate } from './types';

// Ticks are kept on the child's phone until the task is answered, so closing
// the app halfway doesn't lose them. Only "Done" is sent to the server.
const key = (taskId: string, childId: string, date: ISODate) => `familyTasks.check.${taskId}.${childId}.${date}`;

export function loadTicks(taskId: string, childId: string, date: ISODate): number[] {
  try { return JSON.parse(localStorage.getItem(key(taskId, childId, date)) ?? '[]'); } catch { return []; }
}

export function saveTicks(taskId: string, childId: string, date: ISODate, ticks: number[]) {
  try { localStorage.setItem(key(taskId, childId, date), JSON.stringify(ticks)); } catch { /* storage full: ticks are a convenience */ }
}

export function clearTicks(taskId: string, childId: string, date: ISODate) {
  try { localStorage.removeItem(key(taskId, childId, date)); } catch { /* ignore */ }
}
