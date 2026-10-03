export type Outcome = 'done' | 'help' | 'not_done';
export type ISODate = string; // YYYY-MM-DD, always in the family's time zone

export interface Family { id: string; name: string; timezone: string }
export interface Parent { user_id: string; display_name: string }
export interface Child { id: string; display_name: string; archived_at: string | null }
export interface ChildDevice { user_id: string; child_id: string; linked_at: string }

export interface Task {
  id: string;
  title: string;
  days_mask: number;     // bit 0 = Monday … bit 6 = Sunday
  time_local: string;    // "HH:MM:SS" in the family's time zone
  active: boolean;
  starts_on: ISODate;
  assignees: string[];   // child ids
}

export interface TaskResult {
  task_id: string;
  child_id: string;
  local_date: ISODate;
  state: Outcome;
  note: string;
  updated_at: string;
}

export type Membership =
  | { role: 'parent'; userId: string; familyId: string }
  | { role: 'child'; userId: string; familyId: string; childId: string }
  | { role: 'none'; userId: string; anonymous: boolean };

export interface TaskDraft {
  id: string | null;
  title: string;
  time: string;          // "HH:MM"
  days: number[];        // 1 = Monday … 7 = Sunday
  active: boolean;
  assignees: string[];
}
