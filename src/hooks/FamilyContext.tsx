import { createContext, useContext } from 'react';
import type { Child, Family, Membership, Parent, ChildDevice, Task } from '../lib/types';

export interface FamilyState {
  membership: Exclude<Membership, { role: 'none' }>;
  family: Family;
  children: Child[];        // includes archived
  activeChildren: Child[];
  parents: Parent[];
  devices: ChildDevice[];
  tasks: Task[];
  today: string;
  childName(id: string): string;
}

export const FamilyContext = createContext<FamilyState | null>(null);

export function useFamily(): FamilyState {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside FamilyContext');
  return value;
}
