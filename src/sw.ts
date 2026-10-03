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

interface PushMessage { title: string; body: string; url: string; tag: string }

self.addEventListener('push', (event) => {
  let msg: PushMessage = { title: 'Family Tasks', body: '', url: '/', tag: 'family-tasks' };
  try { if (event.data) msg = { ...msg, ...event.data.json() }; } catch { /* keep default */ }
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, data: { url: msg.url },
    icon: '/icon-192.png', badge: '/badge-96.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'open', url });
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
