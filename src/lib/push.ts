import { act } from './api';
import { config } from './config';

export type PushState =
  | 'unsupported'      // browser has no Web Push
  | 'install-first'    // iPhone/iPad: only installed web apps can receive push
  | 'denied'           // user blocked notifications in settings
  | 'off'
  | 'on';

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function store(sub: PushSubscription) {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('Invalid push subscription');
  await act.savePush(json.endpoint, json.keys.p256dh, json.keys.auth);
}

/** Must be called from a tap: browsers only show the permission prompt after a user gesture. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.vapidPublicKey) as BufferSource,
    });
  await store(sub);
  return 'on';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await act.deletePush(sub.endpoint).catch(() => undefined); // still unsubscribe locally
  await sub.unsubscribe();
}

/** Push services rotate endpoints; re-saving on each start keeps the server copy current. */
export async function refreshPush(): Promise<void> {
  if (Notification?.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await store(sub);
}
