import type { TaskDraft } from './types';

type Template = Pick<TaskDraft, 'title' | 'time' | 'days' | 'points' | 'checklist'>;

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

/** Ready-made sets of tasks. Parents can edit each task after adding it. */
export const ROUTINES: { id: string; name: string; tasks: Template[] }[] = [
  { id: 'morning', name: 'School morning', tasks: [
    { title: 'Make your bed', time: '07:00', days: WEEKDAYS, points: 2, checklist: [] },
    { title: 'Brush teeth', time: '07:15', days: WEEKDAYS, points: 2, checklist: [] },
    { title: 'Get dressed', time: '07:20', days: WEEKDAYS, points: 2, checklist: [] },
    { title: 'Pack school bag', time: '07:40', days: WEEKDAYS, points: 3,
      checklist: ['Books and homework', 'Lunch', 'Water bottle', 'Gym clothes if needed'] },
  ] },
  { id: 'afterschool', name: 'After school', tasks: [
    { title: 'Unpack lunch box', time: '16:00', days: WEEKDAYS, points: 1, checklist: [] },
    { title: 'Homework', time: '16:30', days: WEEKDAYS, points: 5, checklist: [] },
    { title: 'Read for 20 minutes', time: '18:30', days: EVERY_DAY, points: 3, checklist: [] },
  ] },
  { id: 'bedtime', name: 'Bedtime', tasks: [
    { title: 'Tidy your room', time: '19:30', days: EVERY_DAY, points: 3, checklist: ['Toys away', 'Clothes in the basket'] },
    { title: 'Shower', time: '20:00', days: EVERY_DAY, points: 2, checklist: [] },
    { title: 'Brush teeth', time: '20:30', days: EVERY_DAY, points: 2, checklist: [] },
    { title: 'Lay out clothes for tomorrow', time: '20:40', days: WEEKDAYS, points: 1, checklist: [] },
  ] },
];
