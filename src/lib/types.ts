export type Outcome = 'done' | 'help' | 'not_done';
export type ISODate = string; // YYYY-MM-DD, always in the family's time zone

export interface Family { id: string; name: string; timezone: string }
export interface Parent { user_id: string; display_name: string }
export interface Child { id: string; display_name: string; archived_at: string | null }
export interface ChildDevice { user_id: string; child_id: string; linked_at: string }

export type TaskKind = 'repeat' | 'once';

export interface Task {
  id: string;
  title: string;
  kind: TaskKind;
  days_mask: number;     // repeat: bit 0 = Monday … bit 6 = Sunday; once: 0
  due_on: ISODate | null;// once: the day it is due (shown as "late" afterwards until done)
  time_local: string;    // "HH:MM:SS" in the family's time zone
  active: boolean;
  starts_on: ISODate;
  points: number;
  needs_check: boolean;  // a parent accepts "Done" before points count
  needs_photo: boolean;
  checklist: string[];
  assignees: string[];   // child ids
}

export interface TaskResult {
  task_id: string;
  child_id: string;
  local_date: ISODate;
  state: Outcome;
  note: string;
  updated_at: string;
  points: number;
  needs_check: boolean;
  approved_at: string | null;
  photo_path: string | null;
}

export interface Reward { id: string; title: string; cost: number; active: boolean }

export interface RewardRequest {
  id: string; reward_id: string; child_id: string; title: string; cost: number;
  status: 'pending' | 'approved' | 'declined'; requested_at: string;
}

export interface ChildStats { child_id: string; streak: number; earned: number; spent: number; balance: number }

export type Membership =
  | { role: 'parent'; userId: string; familyId: string }
  | { role: 'child'; userId: string; familyId: string; childId: string }
  | { role: 'none'; userId: string; anonymous: boolean };

export interface TaskDraft {
  id: string | null;
  title: string;
  kind: TaskKind;
  time: string;          // "HH:MM"
  days: number[];        // repeat: 1 = Monday … 7 = Sunday
  dueOn: ISODate;        // once
  active: boolean;
  assignees: string[];
  points: number;
  needsCheck: boolean;
  needsPhoto: boolean;
  checklist: string[];
}
