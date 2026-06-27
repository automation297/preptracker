self.addEventListener('push', e => {
  let data = { title: 'PrepTracker', body: 'Update available.' };
  try { data = e.data.json(); } catch(err) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
