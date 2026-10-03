import { useEffect, useMemo, useState } from 'react';
import { useFamilyQueries, useRealtime, useResults, useToday } from './hooks/data';
import { FamilyContext, type FamilyState } from './hooks/FamilyContext';
import { refreshPush } from './lib/push';
import { Splash } from './components/ui';
import { Today } from './screens/Today';
import { Week } from './screens/Week';
import { Tasks } from './screens/Tasks';
import { FamilyScreen } from './screens/Family';
import { Me } from './screens/Me';
import { RespondSheet, type RespondTarget } from './screens/RespondSheet';
import type { Membership } from './lib/types';

type Tab = 'today' | 'week' | 'tasks' | 'family' | 'me';
const PARENT_TABS: [Tab, string][] = [['today', 'Today'], ['week', 'Week'], ['tasks', 'Tasks'], ['family', 'Family']];
const CHILD_TABS: [Tab, string][] = [['today', 'Today'], ['week', 'Week'], ['me', 'Me']];

/** Notification taps open /?respond=…&child=…&date=… or /?tab=… */
function parseLink(search: string): { tab?: Tab; respond?: RespondTarget } {
  const q = new URLSearchParams(search);
  const taskId = q.get('respond'), childId = q.get('child'), date = q.get('date');
  if (taskId && childId && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { tab: 'today', respond: { taskId, childId, date } };
  }
  const tab = q.get('tab') as Tab | null;
  return tab ? { tab } : {};
}

export function Shell({ membership }: { membership: Exclude<Membership, { role: 'none' }> }) {
  const isParent = membership.role === 'parent';
  const q = useFamilyQueries(membership.familyId, isParent);
  useRealtime(membership.familyId);
  useEffect(() => { refreshPush().catch(() => undefined); }, []);

  const [link, setLink] = useState(() => parseLink(location.search));
  const [tab, setTab] = useState<Tab>(link.tab ?? 'today');
  const [respond, setRespond] = useState<RespondTarget | null>(null);

  useEffect(() => {
    if (location.search) history.replaceState(null, '', '/');
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open') setLink(parseLink(new URL(e.data.url, location.origin).search));
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    if (link.tab) setTab(link.tab);
    if (link.respond) setRespond(link.respond);
  }, [link]);

  const timeZone = q.family.data?.timezone ?? 'UTC';
  const today = useToday(timeZone);
  const respondResults = useResults(membership.familyId, respond?.date ?? today, respond?.date ?? today);

  const value = useMemo<FamilyState | null>(() => {
    if (!q.family.data || !q.children.data || !q.tasks.data || !q.parents.data) return null;
    const children = q.children.data;
    return {
      membership, family: q.family.data, children,
      activeChildren: children.filter((c) => !c.archived_at),
      parents: q.parents.data, devices: q.devices.data ?? [], tasks: q.tasks.data, today,
      childName: (id) => children.find((c) => c.id === id)?.display_name ?? 'Removed child',
    };
  }, [membership, q.family.data, q.children.data, q.tasks.data, q.parents.data, q.devices.data, today]);

  const failed = [q.family, q.children, q.tasks, q.parents].find((x) => x.isError);
  if (failed) {
    return <div className="splash"><p>Couldn’t load your family. Check your connection.</p>
      <button className="btn" onClick={() => failed.refetch()}>Try again</button></div>;
  }
  if (!value) return <Splash />;

  const tabs = isParent ? PARENT_TABS : CHILD_TABS;
  const existing = respond && respondResults.data?.find(
    (r) => r.task_id === respond.taskId && r.child_id === respond.childId && r.local_date === respond.date);

  return (
    <FamilyContext.Provider value={value}>
      <div className="app">
        {tab === 'today' && <Today onRespond={setRespond} />}
        {tab === 'week' && <Week />}
        {tab === 'tasks' && isParent && <Tasks />}
        {tab === 'family' && isParent && <FamilyScreen />}
        {tab === 'me' && !isParent && <Me />}
        <nav className="tabbar" aria-label="Main">
          {tabs.map(([id, label]) => (
            <button key={id} className="tab" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </div>
      <RespondSheet target={respond} existing={existing ?? undefined} onClose={() => setRespond(null)} />
    </FamilyContext.Provider>
  );
}
