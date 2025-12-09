// Service Worker for Grocery ERP PWA - Enhanced Offline Support
// IMPORTANT: Update CACHE_VERSION whenever you deploy new code to force cache refresh
const CACHE_VERSION = 'v1.0.5';
const CACHE_NAME = `grocery-erp-${CACHE_VERSION}`;
const RUNTIME_CACHE = `grocery-erp-runtime-${CACHE_VERSION}`;
const OFFLINE_CACHE = `grocery-erp-offline-${CACHE_VERSION}`;
const ASSET_MANIFEST_URL = '/asset-manifest.json';

// Track authentication state
let isAuthenticated = false;

// Critical assets to cache immediately on install
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/offline.html',
  '/assets/drag-and-drop-logo.jpg'
];

// All app routes (for SPA routing)
const APP_ROUTES = [
  '/',
  '/login',
  '/dashboard',
  '/customers',
  '/products',
  '/inventory',
  '/billing',
  '/purchase',
  '/financial',
  '/reports',
  '/sales-order-history',
  '/refunds',
  '/upgrade',
  '/settings',
  '/staff/signup'
];

// External resources to cache
const EXTERNAL_RESOURCES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://checkout.razorpay.com/v1/checkout.js'
];

// Install event - cache critical assets immediately
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        console.log('[Service Worker] Caching critical assets');

        // Cache critical assets
        await Promise.allSettled(
          CRITICAL_ASSETS.map(url =>
            cache.add(new Request(url, { cache: 'reload' }))
              .catch(err => console.error(`[SW] Failed to cache ${url}:`, err))
          )
        );

        // Cache asset manifest if available
        await cacheAssetManifestFiles(cache);

        console.log('[Service Worker] Installation complete');
      } catch (error) {
        console.error('[Service Worker] Installation error:', error);
      }
    })()
  );

  // Force activation immediately
  self.skipWaiting();
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        // Get all cache names
        const cacheNames = await caches.keys();

        // Delete old caches
        await Promise.all(
          cacheNames.map(cacheName => {
            if (!cacheName.includes(CACHE_VERSION)) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );

        // Take control of all pages immediately
        await self.clients.claim();

        console.log('[Service Worker] Activation complete');
      } catch (error) {
        console.error('[Service Worker] Activation error:', error);
      }
    })()
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating version', CACHE_VERSION);
  
  event.waitUntil(
    (async () => {
      try {
        // Get all cache names
        const cacheNames = await caches.keys();
        
        // Delete old caches
        await Promise.all(
          cacheNames.map(cacheName => {
            if (!cacheName.includes(CACHE_VERSION)) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
        
        // Take control of all pages immediately
        await self.clients.claim();
        
        console.log('[Service Worker] Activation complete');
      } catch (error) {
        console.error('[Service Worker] Activation error:', error);
      }
    })()
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);
  
  if (event.data?.type === 'AUTHENTICATED') {
    isAuthenticated = true;
    console.log('[Service Worker] User authenticated');
    event.waitUntil(cacheAppResources());
  } else if (event.data?.type === 'LOGGED_OUT') {
    isAuthenticated = false;
    console.log('[Service Worker] User logged out');
  } else if (event.data?.type === 'CACHE_APP_RESOURCES') {
    event.waitUntil(cacheAppResources());
  } else if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Cache all app resources
async function cacheAppResources() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    console.log('[Service Worker] Caching app routes and resources...');
    
    // Cache all app routes (SPA routes)
    await Promise.allSettled(
      APP_ROUTES.map(route => 
        cache.add(route).catch(err => 
          console.log(`[SW] Failed to cache route ${route}:`, err)
        )
      )
    );
    
    // Cache external resources
    await Promise.allSettled(
      EXTERNAL_RESOURCES.map(url => 
        fetch(url)
          .then(response => {
            if (response.ok) {
              return cache.put(url, response);
            }
          })
          .catch(err => console.log(`[SW] Failed to cache external ${url}:`, err))
      )
    );
    
    // Cache asset manifest files
    const staticCache = await caches.open(CACHE_NAME);
    await cacheAssetManifestFiles(staticCache);
    
    console.log('[Service Worker] App resources cached successfully');
  } catch (error) {
    console.error('[Service Worker] Error caching app resources:', error);
  }
}

// Cache files from asset manifest
async function cacheAssetManifestFiles(cache) {
  try {
    const manifestResponse = await fetch(ASSET_MANIFEST_URL, { cache: 'no-store' });
    if (!manifestResponse?.ok) {
      return;
    }

    const manifest = await manifestResponse.json();
    const files = manifest?.files || {};
    const entrypoints = manifest?.entrypoints || [];
    const urlsToCache = new Set();

    // Collect all file URLs
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

    // Cache all files
    await Promise.allSettled(
      Array.from(urlsToCache).map(url => 
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.log(`[SW] Failed to cache ${url}:`, err))
      )
    );
  } catch (error) {
    console.log('[Service Worker] Unable to cache from asset manifest:', error);
  }
}

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (except handle API calls)
  if (request.method !== 'GET') {
    // For API calls, try network first, then return offline response
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(
        fetch(request)
          .catch(() => {
            // Return offline response for API calls
            return new Response(
              JSON.stringify({ 
                error: 'Offline', 
                message: 'You are offline. Data will sync when connection is restored.',
                cached: false 
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          })
      );
    }
    return;
  }

  // Skip service worker itself
  if (url.pathname === '/service-worker.js') {
    return;
  }

  // Skip chrome-extension and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy: Cache First with Network Fallback (for offline support)
  event.respondWith(
    (async () => {
      try {
        // Try cache first
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
          // Update cache in background (stale-while-revalidate)
          fetch(request)
            .then(response => {
              if (response && response.ok) {
                const cacheToUse = url.pathname.startsWith('/api/') 
                  ? OFFLINE_CACHE 
                  : RUNTIME_CACHE;
                caches.open(cacheToUse).then(cache => {
                  cache.put(request, response.clone());
                });
              }
            })
            .catch(() => {
              // Network failed, but we have cached version - this is fine
            });
          
          return cachedResponse;
        }

        // Not in cache, try network
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse && networkResponse.ok) {
          const cacheToUse = url.pathname.startsWith('/api/') 
            ? OFFLINE_CACHE 
            : RUNTIME_CACHE;
          
          const cache = await caches.open(cacheToUse);
          cache.put(request, networkResponse.clone());
        }

        return networkResponse;
      } catch (error) {
        // Network failed - serve fallback
        
        // For navigation requests (page loads), serve index.html for SPA routing
        if (request.mode === 'navigate') {
          const indexCache = await caches.match('/');
          if (indexCache) {
            return indexCache;
          }
          // Fallback to offline page
          const offlinePage = await caches.match('/offline.html');
          if (offlinePage) {
            return offlinePage;
          }
        }
        
        // For API calls, return offline JSON response
        if (url.pathname.startsWith('/api/')) {
          return new Response(
            JSON.stringify({ 
              error: 'Offline', 
              message: 'You are offline. Data will sync when connection is restored.',
              cached: false 
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        
        // For other requests, try to serve from cache
        const cachedFallback = await caches.match(request);
        if (cachedFallback) {
          return cachedFallback;
        }
        
        // Last resort: return offline page for navigation, error for others
        if (request.mode === 'navigate') {
          const offlinePage = await caches.match('/offline.html');
          return offlinePage || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/html' }
          });
        }
        
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })()
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-data') {
    event.waitUntil(
      // Trigger sync when back online
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'TRIGGER_SYNC' });
        });
      })
    );
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  
  const options = {
    body: event.data?.text() || 'New update available',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    tag: 'notification',
    requireInteraction: false
  };
  
  event.waitUntil(
    self.registration.showNotification('Grocery ERP', options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll().then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
