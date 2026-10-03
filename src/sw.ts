/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// The app shell works offline; data needs a connection.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

interface PushMessage {
  kind: 'reminder' | 'help';
  title: string; body: string; url: string; tag: string;
  token?: string;
  actions?: { action: string; title: string }[];
}

// Ring-ring vibration (Android). iPhone ignores vibration and buttons.
const RING = [600, 300, 600, 300, 600, 900, 600, 300, 600, 300, 600];

self.addEventListener('push', (event) => {
  let msg: PushMessage = { kind: 'help', title: 'Family Tasks', body: '', url: '/', tag: 'family-tasks' };
  try { if (event.data) msg = { ...msg, ...event.data.json() }; } catch { /* keep default */ }
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean; actions?: { action: string; title: string }[] } = {
    body: msg.body, tag: msg.tag, icon: '/icon-192.png', badge: '/badge-96.png',
    data: { url: msg.url, token: msg.token },
    vibrate: RING,
    renotify: true,            // a repeated reminder with the same tag rings again
    requireInteraction: true,  // stays until tapped
    actions: msg.actions,
  };
  event.waitUntil(self.registration.showNotification(msg.title, options));
});

async function openApp(url: string) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
  if (open) {
    await open.focus();
    open.postMessage({ type: 'open', url });
  } else {
    await self.clients.openWindow(url);
  }
}

/** Done / Snooze straight from the notification, without opening the app. */
async function quickAction(token: string, action: 'done' | 'snooze'): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notification-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '' },
      body: JSON.stringify({ token, action }),
    });
    const body = await res.json() as { result?: string };
    if (body.result === 'done') {
      await self.registration.showNotification('Nice work! ✓', {
        body: 'Marked as done.', tag: 'family-tasks-confirm', icon: '/icon-192.png', badge: '/badge-96.png',
      });
      return true;
    }
    return body.result === 'snoozed';
  } catch {
    return false;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string; token?: string } | undefined;
  const url = new URL(data?.url ?? '/', self.location.origin).href;
  const action = event.action;
  event.waitUntil((async () => {
    if ((action === 'done' || action === 'snooze') && data?.token) {
      // If the button can't be handled here (offline, needs a photo…), open the app instead.
      if (await quickAction(data.token, action)) return;
    }
    await openApp(url);
  })());
});
