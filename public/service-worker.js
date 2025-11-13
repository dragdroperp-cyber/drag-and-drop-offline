// Service Worker for Grocery ERP PWA
const CACHE_NAME = 'grocery-erp-v1';
const RUNTIME_CACHE = 'grocery-erp-runtime-v1';
const OFFLINE_CACHE = 'grocery-erp-offline-v1';
const ASSET_MANIFEST_URL = '/asset-manifest.json';

// Track authentication state
let isAuthenticated = false;

// Assets to cache immediately on install
// Note: React build creates hashed filenames, so we cache the main routes
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/offline.html',
  ASSET_MANIFEST_URL
];

// Routes to cache after authentication (all app routes)
const APP_ROUTES = [
  '/',
  '/dashboard',
  '/customers',
  '/billing',
  '/products',
  '/inventory',
  '/purchase',
  '/financial',
  '/assistant',
  '/reports',
  '/upgrade',
  '/settings'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[Service Worker] Caching static assets');
        try {
          await cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
        } catch (err) {
          console.log('[Service Worker] Cache addAll error:', err);
        }
        await cacheAssetManifestFiles(cache);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE && cacheName !== OFFLINE_CACHE) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  return self.clients.claim();
});

// Listen for messages from the app (authentication events)
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);
  
  if (event.data && event.data.type === 'AUTHENTICATED') {
    isAuthenticated = true;
    console.log('[Service Worker] User authenticated, caching app resources...');
    
    // Cache all app routes and resources after authentication
    event.waitUntil(
      cacheAppResources()
    );
  } else if (event.data && event.data.type === 'LOGGED_OUT') {
    isAuthenticated = false;
    console.log('[Service Worker] User logged out');
    event.waitUntil(clearAuthenticatedCaches());
  } else if (event.data && event.data.type === 'CACHE_APP_RESOURCES') {
    // Explicit request to cache resources
    event.waitUntil(
      cacheAppResources()
    );
  }
});

// Function to cache all app resources
async function cacheAppResources() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    console.log('[Service Worker] Caching app routes...');
    
    // Cache all app routes
    const cachePromises = APP_ROUTES.map(route => {
      return cache.add(route).catch(err => {
        console.log(`[Service Worker] Failed to cache route ${route}:`, err);
        // Don't fail the whole operation if one route fails
      });
    });
    
    await Promise.all(cachePromises);
    
    // Also cache external resources (fonts, etc.)
    const externalResources = [
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
    ];
    
    const externalPromises = externalResources.map(url => {
      return fetch(url)
        .then(response => {
          if (response.ok) {
            return cache.put(url, response);
          }
        })
        .catch(err => {
          console.log(`[Service Worker] Failed to cache external resource ${url}:`, err);
        });
    });
    
    await Promise.all(externalPromises);

    // Update main asset cache as well
    const staticCache = await caches.open(CACHE_NAME);
    await cacheAssetManifestFiles(staticCache);
    
    console.log('[Service Worker] App resources cached successfully');
  } catch (error) {
    console.error('[Service Worker] Error caching app resources:', error);
  }
}

async function cacheAssetManifestFiles(cache) {
  try {
    const manifestResponse = await fetch(ASSET_MANIFEST_URL, { cache: 'no-store' });
    if (!manifestResponse || !manifestResponse.ok) {
      return;
    }

    const manifest = await manifestResponse.json();
    const files = manifest?.files || {};
    const entrypoints = manifest?.entrypoints || [];
    const urlsToCache = new Set();

    Object.values(files).forEach((value) => {
      if (typeof value === 'string') {
        urlsToCache.add(value);
      } else if (value?.files) {
        Object.values(value.files).forEach((nested) => {
          if (typeof nested === 'string') {
            urlsToCache.add(nested);
          }
        });
      }
    });

    entrypoints.forEach((value) => {
      if (typeof value === 'string') {
        urlsToCache.add(value);
      }
    });

    for (const url of urlsToCache) {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (error) {
        console.log(`[Service Worker] Failed to precache ${url}:`, error);
      }
    }
  } catch (error) {
    console.log('[Service Worker] Unable to precache from asset manifest:', error);
  }
}

async function clearAuthenticatedCaches() {
  const cachesToClear = [RUNTIME_CACHE, OFFLINE_CACHE];
  await Promise.all(
    cachesToClear.map((name) =>
      caches.delete(name).catch((error) => {
        console.log(`[Service Worker] Failed to delete cache ${name}:`, error);
      })
    )
  );
}

// Fetch event - serve from cache, fallback to network (cache-first strategy when authenticated)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (except handle them for API calls)
  if (request.method !== 'GET' && !url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip service worker itself
  if (url.pathname === '/service-worker.js') {
    return;
  }

  // For authenticated users, use cache-first strategy
  if (isAuthenticated) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          // Return cached version if available (offline-first)
          if (cachedResponse) {
            // Update cache in background (stale-while-revalidate pattern)
            fetch(request)
              .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                  const cacheToUse = url.pathname.startsWith('/api/') ? OFFLINE_CACHE : RUNTIME_CACHE;
                  caches.open(cacheToUse)
                    .then((cache) => {
                      cache.put(request, response.clone());
                    });
                }
              })
              .catch(() => {
                // Network request failed, but we have cached version
                // This is expected when offline
              });
            return cachedResponse;
          }

          // No cache, try network
          return fetch(request)
            .then((response) => {
              // Don't cache if not a valid response
              if (!response || response.status !== 200 || response.type !== 'basic') {
                return response;
              }

              // Clone the response
              const responseToCache = response.clone();

              // Determine which cache to use
              const cacheToUse = url.pathname.startsWith('/api/') ? OFFLINE_CACHE : RUNTIME_CACHE;

              // Cache all successful responses (static assets, API responses, etc.)
              const shouldCache = 
                url.pathname.startsWith('/static/') ||
                url.pathname.startsWith('/api/') ||
                url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico)$/) ||
                request.mode === 'navigate' ||
                url.origin === location.origin;

              if (shouldCache) {
                caches.open(cacheToUse)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  });
              }

              return response;
            })
            .catch(() => {
              // Network failed - try to serve fallback
              if (request.mode === 'navigate') {
                // For navigation requests, return cached index page
                return caches.match('/').then(cachedIndex => {
                  if (cachedIndex) {
                    return cachedIndex;
                  }
                  // No cached index, return offline page
                  return caches.match('/offline.html').then((offlinePage) => {
                    if (offlinePage) {
                      return offlinePage;
                    }
                    return new Response('Offline', {
                      status: 503,
                      headers: new Headers({
                        'Content-Type': 'text/html'
                      })
                    });
                  });
                });
              }
              
              // For API requests when offline, return empty JSON response
              if (url.pathname.startsWith('/api/')) {
                return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
                  status: 503,
                  headers: new Headers({
                    'Content-Type': 'application/json'
                  })
                });
              }
              
              // For other requests, return basic error
              return new Response('Offline - Content not available', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({
                  'Content-Type': 'text/plain'
                })
              });
            });
        })
    );
  } else {
    // For unauthenticated users, use network-first strategy
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache static assets even when not authenticated
          if (response && response.status === 200 && response.type === 'basic') {
            const isStaticAsset = 
              url.pathname.startsWith('/static/') ||
              url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/);

            if (isStaticAsset) {
              const responseToCache = response.clone();
              caches.open(RUNTIME_CACHE)
                .then((cache) => {
                  cache.put(request, responseToCache);
                });
            }
          }
          return response;
        })
        .catch(() => {
          // Try cache as fallback
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              if (request.mode === 'navigate') {
                return caches.match('/').then((cachedIndex) => {
                  if (cachedIndex) {
                    return cachedIndex;
                  }
                  return caches.match('/offline.html');
                });
              }
              return new Response('Offline', {
                status: 503,
                headers: new Headers({
                  'Content-Type': 'text/plain'
                })
              });
            });
        })
    );
  }
});

// Background sync for offline actions (if needed)
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  // You can add background sync logic here for offline actions
});

// Push notifications (if needed)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  // You can add push notification handling here
});

