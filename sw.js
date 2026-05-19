// sw.js — CarDiary Service Worker
const CACHE_NAME = 'cardiary-v3';

// Файлы для офлайн-кеширования
const ASSETS = [
  './index.html',
  './app.js',
  './manifest.json',
  './icon.png'
];

// ========== УСТАНОВКА ==========
self.addEventListener('install', (event) => {
  console.log('[SW] Установка...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кеширую основные файлы');
        return cache.addAll(ASSETS);
      })
      .then(() => {
        console.log('[SW] Принудительная активация');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Ошибка кеширования:', err);
      })
  );
});

// ========== АКТИВАЦИЯ ==========
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация...');
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        // Удаляем старые версии кеша
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Удаляю старый кеш:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Захватываю все вкладки');
        return self.clients.claim();
      })
  );
});

// ========== ПЕРЕХВАТ ЗАПРОСОВ ==========
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Пропускаем Firebase, OpenWeatherMap и Google APIs
  if (
    url.includes('firestore') ||
    url.includes('openweathermap') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com')
  ) {
    return; // Не кешируем API-запросы
  }

  // Пропускаем POST-запросы (сохранение данных)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кешируем успешные ответы
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Если нет сети — отдаём из кеша
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Если и в кеше нет — показываем офлайн-страницу
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          // Для остального возвращаем ошибку
          return new Response('Нет соединения', { status: 503 });
        });
      })
  );
});

// ========== УВЕДОМЛЕНИЕ ОБ ОБНОВЛЕНИИ ==========
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
