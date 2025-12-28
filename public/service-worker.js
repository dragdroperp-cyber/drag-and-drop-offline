// Optimized Service Worker for Grocery Studio PWA
// Version: 1.0.1.6
// Auto-versioned based on build timestamp for cache busting
const CACHE_VERSION = '1.0.1.6';
const CACHE_NAMES = {
  STATIC: `grocery-studio-static-${CACHE_VERSION}`,
  RUNTIME: `grocery-studio-runtime-${CACHE_VERSION}`,
  ASSETS: `grocery-studio-assets-${CACHE_VERSION}`
};

// Cache size limits (in bytes)
const CACHE_LIMITS = {
  STATIC: 50 * 1024 * 1024,    // 50MB for static assets
  RUNTIME: 25 * 1024 * 1024,   // 25MB for runtime cache
  ASSETS: 10 * 1024 * 1024     // 10MB for JS/CSS assets
};

// Essential files only - minimal precaching
const ESSENTIAL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/offline.html'
];

// Essential external resources (fonts only, no heavy scripts)
const ESSENTIAL_EXTERNAL = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// File patterns to skip caching (large files, media, etc.)
const SKIP_CACHE_PATTERNS = [
  /\.(mp4|avi|mov|wmv|flv|webm|m4v)$/i,  // Videos
  /\.(mp3|wav|ogg|flac|aac|m4a)$/i,      // Audio
  /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/i, // Images
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i, // Documents
  /\/api\//,                             // API calls
  /\/assets\/.*\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|mp4|avi|mov|wmv|flv|webm|m4v|mp3|wav|ogg|flac|aac|m4a)$/i,
  /\/images?\//,                         // Image folders
  /\/videos?\//,                         // Video folders
  /\/media\//,                           // Media folders
  /\/uploads\//                          // Upload folders
];

// File patterns for stale-while-revalidate strategy
const STALE_WHILE_REVALIDATE_PATTERNS = [
  /\.(js|css)$/,                         // JS and CSS files
  /\/api\/.*\?(.*&)?_sw_cache=/,         // API calls with cache buster
  /\/manifest\.json$/,                   // Manifest file
  /\/favicon\.ico$/                      // Favicon
];

// Track authentication state
let isAuthenticated = false;

// Install event - cache only essential assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAMES.STATIC);
        console.log('[SW] Caching essential assets');

        // Cache only essential assets to keep initial load small
        await Promise.allSettled(
          ESSENTIAL_ASSETS.map(url =>
            fetch(url, { cache: 'reload' })
              .then(response => response.ok ? cache.put(url, response) : Promise.reject())
              .catch(err => console.log(`[SW] Skipped caching ${url}:`, err.message))
          )
        );

        // Cache essential external resources
        await Promise.allSettled(
          ESSENTIAL_EXTERNAL.map(url =>
            fetch(url)
              .then(response => response.ok ? cache.put(url, response) : Promise.reject())
              .catch(err => console.log(`[SW] Skipped external ${url}:`, err.message))
          )
        );

        console.log('[SW] Essential assets cached');
      } catch (error) {
        console.error('[SW] Installation error:', error);
      }
    })()
  );

  // Skip waiting to activate immediately (improves UX)
  self.skipWaiting();
});

// Activate event - clean up old caches and enforce size limits
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheNames = await caches.keys();
        const oldCaches = cacheNames.filter(name =>
          !Object.values(CACHE_NAMES).includes(name)
        );

        console.log('[SW] Deleting old caches:', oldCaches);
        await Promise.all(
          oldCaches.map(cacheName => caches.delete(cacheName))
        );

        // Enforce cache size limits
        await enforceCacheLimits();

        // Take control immediately
        await self.clients.claim();

        console.log('[SW] Activation complete');
      } catch (error) {
        console.error('[SW] Activation error:', error);
      }
    })()
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  if (type === 'AUTHENTICATED') {
    isAuthenticated = true;
    console.log('[SW] User authenticated');
    event.waitUntil(cacheEssentialResources());
  } else if (type === 'LOGGED_OUT') {
    isAuthenticated = false;
    console.log('[SW] User logged out');
    // Clear runtime cache on logout
    event.waitUntil(caches.delete(CACHE_NAMES.RUNTIME));
  } else if (type === 'CACHE_RESOURCES') {
    event.waitUntil(cacheEssentialResources());
  } else if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches());
  }
});

// Cache only essential resources after authentication
async function cacheEssentialResources() {
  if (!isAuthenticated) return;

  try {
    const cache = await caches.open(CACHE_NAMES.RUNTIME);
    console.log('[SW] Caching essential runtime resources...');

    // Cache essential routes (not all routes to save space)
    const essentialRoutes = ['/', '/dashboard', '/offline.html'];

    await Promise.allSettled(
      essentialRoutes.map(route =>
        fetch(route)
          .then(response => response.ok ? cache.put(route, response) : Promise.reject())
          .catch(err => console.log(`[SW] Skipped route ${route}:`, err.message))
      )
    );

    console.log('[SW] Essential resources cached');
  } catch (error) {
    console.error('[SW] Error caching essential resources:', error);
  }
}

// Enforce cache size limits by removing oldest entries
async function enforceCacheLimits() {
  const cacheLimits = {
    [CACHE_NAMES.STATIC]: CACHE_LIMITS.STATIC,
    [CACHE_NAMES.RUNTIME]: CACHE_LIMITS.RUNTIME,
    [CACHE_NAMES.ASSETS]: CACHE_LIMITS.ASSETS
  };

  for (const [cacheName, limit] of Object.entries(cacheLimits)) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      let totalSize = 0;
      const entries = [];

      // Calculate sizes and collect entries
      for (const request of keys) {
        try {
          const response = await cache.match(request);
          if (response) {
            const contentLength = response.headers.get('content-length');
            const size = contentLength ? parseInt(contentLength) : 0;
            totalSize += size;
            entries.push({ request, size, response });
          }
        } catch (e) {
          // Skip problematic entries
        }
      }

      // Remove oldest entries if over limit
      if (totalSize > limit) {
        console.log(`[SW] Cache ${cacheName} over limit (${totalSize} > ${limit}), cleaning up`);

        // Sort by response date (oldest first) and remove until under limit
        entries.sort((a, b) => {
          const dateA = new Date(a.response.headers.get('date') || 0);
          const dateB = new Date(b.response.headers.get('date') || 0);
          return dateA - dateB;
        });

        let currentSize = totalSize;
        for (const entry of entries) {
          if (currentSize <= limit) break;

          await cache.delete(entry.request);
          currentSize -= entry.size;
          console.log(`[SW] Removed ${entry.request.url} from cache`);
        }
      }
    } catch (error) {
      console.error(`[SW] Error enforcing cache limits for ${cacheName}:`, error);
    }
  }
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(cacheName => {
      console.log('[SW] Clearing cache:', cacheName);
      return caches.delete(cacheName);
    })
  );
  console.log('[SW] All caches cleared');
}

// Fetch event - optimized caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip service worker, extensions, and data URLs
  if (url.pathname === '/service-worker.js' ||
    !url.protocol.startsWith('http') ||
    url.protocol === 'data:') {
    return;
  }

  // Skip caching for large files and media
  const shouldSkipCache = SKIP_CACHE_PATTERNS.some(pattern => pattern.test(url.href));
  if (shouldSkipCache) {
    return;
  }

  // Handle API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Use stale-while-revalidate for specific file types
  const shouldUseStaleWhileRevalidate = STALE_WHILE_REVALIDATE_PATTERNS.some(pattern =>
    pattern.test(url.href)
  );

  if (shouldUseStaleWhileRevalidate) {
    event.respondWith(handleStaleWhileRevalidate(request));
  } else {
    event.respondWith(handleCacheFirst(request));
  }
});

// Stale-while-revalidate strategy for JS/CSS and other frequently updated files
async function handleStaleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAMES.ASSETS);
  const cachedResponse = await cache.match(request);

  // Always try to update cache in background
  const networkUpdate = fetch(request).then(async (response) => {
    if (response && response.ok) {
      // Check file size before caching (skip files > 2MB)
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 2 * 1024 * 1024) {
        return response; // Don't cache large files
      }

      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // Network failed - this is fine, we have cache
  });

  // Return cached version immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }

  // No cache, wait for network
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache for future requests
      const contentLength = networkResponse.headers.get('content-length');
      if (!contentLength || parseInt(contentLength) <= 2 * 1024 * 1024) {
        cache.put(request, networkResponse.clone());
      }
    }
    return networkResponse;
  } catch (error) {
    // Network failed and no cache - serve offline fallback
    return handleOfflineFallback(request);
  }
}

// Cache-first strategy for static assets
async function handleCacheFirst(request) {
  const url = new URL(request.url);

  // Try cache first
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Not in cache, try network
  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      // Cache successful responses (with size limit)
      const contentLength = networkResponse.headers.get('content-length');
      if (!contentLength || parseInt(contentLength) <= 1024 * 1024) { // 1MB limit
        const cacheName = url.pathname.startsWith('/api/')
          ? CACHE_NAMES.RUNTIME
          : CACHE_NAMES.STATIC;

        const cache = await caches.open(cacheName);
        cache.put(request, networkResponse.clone());
      }
    }

    return networkResponse;
  } catch (error) {
    return handleOfflineFallback(request);
  }
}

// Handle API requests
async function handleApiRequest(request) {
  try {
    return await fetch(request);
  } catch (error) {
    // Return offline API response
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
}

// Handle offline fallback
async function handleOfflineFallback(request) {
  const url = new URL(request.url);

  // For navigation requests, serve cached pages
  if (request.mode === 'navigate') {
    const cachedPage = await caches.match('/') ||
      await caches.match('/offline.html');
    if (cachedPage) {
      return cachedPage;
    }
  }

  // For other requests, try to serve from any cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Last resort
  if (request.mode === 'navigate') {
    return new Response('Offline - Please check your connection', {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Simplified background sync (optional)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'TRIGGER_SYNC' });
        });
      })
    );
  }
});

// Minimal push notification support (optional)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data?.text() || 'Update available',
    icon: '/favicon.ico',
    tag: 'notification'
  };

  event.waitUntil(
    self.registration.showNotification('Grocery ERP', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
