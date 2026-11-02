/* 只快取自己的靜態檔案；後端 API 與 Google 的請求一律走網路，不快取。 */
const CACHE = 'yunn-camera-v1';
const ASSETS = ['./', 'index.html', 'admin.html', 'css/style.css', 'js/config.js', 'js/auth.js', 'js/camera.js', 'js/admin.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // 網路優先，離線才用快取，避免更新後使用者一直看到舊版。
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
    return res;
  }).catch(() => caches.match(req)));
});
