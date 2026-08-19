/* sw.js — service worker for THE PLUG 242.
 *
 * WHY THIS FILE EXISTS (Rodney 2026-08-19). His words:
 *   "I don't get the notification unless I'm in the app. When I open the app,
 *    then I hear I need agent, need agent, need agent. But it's not like a
 *    notification that comes straight to my phone like a WhatsApp."
 *
 * `storefront.html` has always called `navigator.serviceWorker.register('sw.js')`,
 * and this repo has NEVER contained an sw.js — `git log --all -- sw.js` is empty and
 * https://242plug.com/sw.js returned 404. So every one of those pushes was accepted
 * by Google's FCM servers and then had nothing on the phone to display it. A push
 * notification can ONLY be shown by a service worker; with no worker registered
 * there is no `push` event, so nothing ever appears on the lock screen.
 *
 * It looked healthy from every angle we had: /shop/push/status shows 5 live
 * subscriptions (4 of them his), web-push is installed, VAPID is configured, and
 * FCM never returned 404/410 so nothing was ever pruned. The whole chain worked
 * right up to the last step.
 *
 * (He almost certainly DID get notifications once — a worker registered back when
 * 242plug.com was on Netlify would survive the move to Railway, same origin, until
 * Chrome's update check fetched sw.js, got a 404, and dropped the registration.)
 *
 * ⚠️ DELIBERATELY PUSH-ONLY — THERE IS NO `fetch` HANDLER AND NO CACHE.
 * A caching service worker is exactly what caused the "stale page" and
 * "old phone deleted my restock" bugs, and a stale storefront can write bad stock.
 * This worker never intercepts a request, so it cannot serve anything old. If
 * offline caching is ever wanted it needs its own careful design and its own test.
 */

// Take over straight away rather than waiting for every tab to close — otherwise a
// staff phone that never fully closes the app would sit without a worker for days.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  // sendPush() in shop.js posts {title, body, url, tag}. Anything unreadable still
  // shows SOMETHING — a silent failure here is the exact bug this file fixes.
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {
    try { d = { body: event.data ? event.data.text() : '' }; } catch (_) { d = {}; }
  }
  const title = d.title || 'THE PLUG 242';
  const body  = d.body  || 'New delivery / task';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // ⚠️ NOT '/icon-192.png' — that path 404s (storefront.html links it, but nothing
      // serves it). '/inbox/icon-192.png' is the one that actually returns 200.
      icon: '/inbox/icon-192.png',
      badge: '/inbox/icon-192.png',
      // A per-alert tag would stack; a shared one replaces. Customers waiting for a
      // person must NOT quietly overwrite each other, so agent alerts get their own.
      tag: d.tag || 'plug242-task',
      renotify: true,
      requireInteraction: false,
      data: { url: d.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  // Focus the app if it is already open rather than piling up tabs; only open a new
  // window when nothing is there. An external link (wa.me/...) always opens fresh.
  event.waitUntil((async () => {
    const external = /^https?:\/\//i.test(url) && !url.includes(self.location.host);
    if (!external) {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes(self.location.host)) { try { await c.focus(); return; } catch (_) {} }
      }
    }
    await self.clients.openWindow(url);
  })());
});
