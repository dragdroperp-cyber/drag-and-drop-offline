// Optimized Service Worker for Grocery Studio PWA
// Version: 1.0.3.6
// Auto-versioned based on build timestamp for cache busting
const CACHE_VERSION = '1.0.3.9';
const CACHE_NAMES = {
  STATIC: `grocery-studio-static-${CACHE_VERSION}`,
  RUNTIME: `grocery-studio-runtime-${CACHE_VERSION}`,
  ASSETS: `grocery-studio-assets-${CACHE_VERSION}`
};

// Cache size limits (in bytes)
// Cache size limits (in bytes)
const CACHE_LIMITS = {
  STATIC: 100 * 1024 * 1024,    // 100MB for static assets
  RUNTIME: 50 * 1024 * 1024,   // 50MB for runtime cache
  ASSETS: 50 * 1024 * 1024     // 50MB for JS/CSS assets
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
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff2'
];

// File patterns to skip caching (large files, media, etc.)
const SKIP_CACHE_PATTERNS = [
  /\.(mp4|avi|mov|wmv|flv|webm|m4v)$/i,  // Videos (keep skipping heavy videos)
  // Removed image/audio skipping to allow offline assets
  /\/uploads\/large\//,                   // Only skip specifically large uploads
  /\.hot-update\.(js|json)$/,             // Skip HMR hot updates
  /\/ws$/                                 // Skip WebSocket connections
];

// File patterns for stale-while-revalidate strategy
const STALE_WHILE_REVALIDATE_PATTERNS = [
  /\.(js|css)$/,                         // JS and CSS files
  /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/i, // Images
  /\.(mp3|wav|ogg|flac|aac|m4a)$/i,      // Audio (notification sounds)
  /\/api\/.*\?(.*&)?_sw_cache=/,         // API calls with cache buster
  /\/manifest\.json$/,                   // Manifest file
  /\/favicon\.ico$/                      // Favicon
];

// Track authentication state
let isAuthenticated = false;

// Install event - cache only essential assets
self.addEventListener('install', (event) => {
  // console.log('[SW] Installing version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAMES.STATIC);
        // console.log('[SW] Caching essential assets');

        // Cache only essential assets to keep initial load small
        await Promise.allSettled(
          ESSENTIAL_ASSETS.map(url =>
            fetch(url, { cache: 'reload' })
              .then(response => response.ok ? cache.put(url, response) : Promise.reject())
              .catch(err => { }) // console.log(`[SW] Skipped caching ${url}:`, err.message))
          )
        );

        // Cache essential external resources
        await Promise.allSettled(
          ESSENTIAL_EXTERNAL.map(url =>
            fetch(url)
              .then(response => response.ok ? cache.put(url, response) : Promise.reject())
              .catch(err => { }) // console.log(`[SW] Skipped external ${url}:`, err.message))
          )
        );

        // console.log('[SW] Essential assets cached');
      } catch (error) {
        // console.error('[SW] Installation error:', error);
      }
    })()
  );

  // Removed self.skipWaiting() to allow manual upgrade via the Dashboard button
});

// Activate event - clean up old caches and enforce size limits
self.addEventListener('activate', (event) => {
  // console.log('[SW] Activating version', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheNames = await caches.keys();
        const oldCaches = cacheNames.filter(name =>
          !Object.values(CACHE_NAMES).includes(name)
        );

        // console.log('[SW] Deleting old caches:', oldCaches);
        await Promise.all(
          oldCaches.map(cacheName => caches.delete(cacheName))
        );

        // Enforce cache size limits
        await enforceCacheLimits();

        // Take control immediately
        await self.clients.claim();

        // console.log('[SW] Activation complete');
      } catch (error) {
        // console.error('[SW] Activation error:', error);
      }
    })()
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  if (type === 'AUTHENTICATED') {
    isAuthenticated = true;
    // console.log('[SW] User authenticated');
    event.waitUntil(cacheEssentialResources());
  } else if (type === 'LOGGED_OUT') {
    isAuthenticated = false;
    // console.log('[SW] User logged out');
    // Clear runtime cache on logout
    event.waitUntil(caches.delete(CACHE_NAMES.RUNTIME));
  } else if (type === 'CACHE_RESOURCES' || type === 'CACHE_APP_RESOURCES') {
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
    // console.log('[SW] Caching ALL essential runtime resources for offline use...');

    // Cache ALL essential routes so the entire app works offline
    const essentialRoutes = [
      '/',
      '/index.html',
      '/offline.html',
      '/dashboard',
      '/billing',
      '/products',
      '/d-products',
      '/customers',
      '/suppliers',
      '/online-store',
      '/purchase',
      '/financial',
      '/reports',
      '/sales-order-history',
      '/refunds',
      '/gst',
      '/customization',
      '/product-performance',
      '/upgrade',
      '/plan-history',
      '/settings'
    ];

    // Cache routes with better error handling
    const cachePromises = essentialRoutes.map(async (route) => {
      try {
        const response = await fetch(route, {
          cache: 'reload',
          credentials: 'same-origin'
        });

        if (response && response.ok) {
          await cache.put(route, response);
          // console.log(`[SW] ✓ Cached: ${route}`);
          return { route, success: true };
        } else {
          // console.warn(`[SW] ✗ Failed to cache ${route}: ${response.status}`);
          return { route, success: false };
        }
      } catch (err) {
        // console.warn(`[SW] ✗ Error caching ${route}:`, err.message);
        return { route, success: false };
      }
    });

    const results = await Promise.allSettled(cachePromises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

    // console.log(`[SW] Cached ${successCount}/${essentialRoutes.length} essential routes`);

    // Also cache static assets (sounds, fonts, etc.)
    const staticAssets = [
      '/assets/beep-401570.mp3',
      '/assets/cash-register-kaching-376867.mp3',
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
    ];

    // console.log('[SW] Caching static assets (sounds, fonts)...');
    const assetPromises = staticAssets.map(async (asset) => {
      try {
        const response = await fetch(asset, {
          mode: asset.startsWith('http') ? 'cors' : 'same-origin'
        });

        if (response && response.ok) {
          await cache.put(asset, response);
          // console.log(`[SW] ✓ Cached asset: ${asset}`);
          return { asset, success: true };
        } else {
          // console.warn(`[SW] ✗ Failed to cache asset ${asset}: ${response.status}`);
          return { asset, success: false };
        }
      } catch (err) {
        // console.warn(`[SW] ✗ Error caching asset ${asset}:`, err.message);
        return { asset, success: false };
      }
    });

    const assetResults = await Promise.allSettled(assetPromises);
    const assetSuccessCount = assetResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;

    // console.log(`[SW] Cached ${assetSuccessCount}/${staticAssets.length} static assets`);

    const totalCached = successCount + assetSuccessCount;
    const totalResources = essentialRoutes.length + staticAssets.length;

    // Notify the client about cache completion
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_COMPLETE',
        cached: totalCached,
        total: totalResources
      });
    });

  } catch (error) {
    // console.error('[SW] Error caching essential resources:', error);
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
        // console.log(`[SW] Cache ${cacheName} over limit (${totalSize} > ${limit}), cleaning up`);

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
          // console.log(`[SW] Removed ${entry.request.url} from cache`);
        }
      }
    } catch (error) {
      // console.error(`[SW] Error enforcing cache limits for ${cacheName}:`, error);
    }
  }
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(cacheName => {
      // console.log('[SW] Clearing cache:', cacheName);
      return caches.delete(cacheName);
    })
  );
  // console.log('[SW] All caches cleared');
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

// Background Sync Implementation
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    // console.log('[SW] Background sync triggered');
    event.waitUntil(syncData());
  }
});

// Database and Sync Helpers
const DB_NAME = 'ERP_DB';
const DB_VERSION = 28;
const STORES = {
  customers: 'customers',
  products: 'products',
  productBatches: 'productBatches',
  orders: 'orders',
  transactions: 'transactions',
  purchaseOrders: 'purchaseOrders',
  categories: 'categories',
  expenses: 'expenses',
  suppliers: 'suppliers',
  supplierTransactions: 'supplierTransactions',
  customerTransactions: 'customerTransactions',
  refunds: 'refunds',
  dProducts: 'dProducts',
  planOrders: 'planOrders'
};

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Get Auth Token from IDB (assuming it's stored in settings or handled via postMessage previously)
// Since we can't easily access localStorage, we'll try to find it in a specific 'settings' store 
// or rely on the client having sent it to us to cache.
// For this implementation, we will assume the token is stored in the 'auth' object store or sent via message.
// FALLBACK: If we can't get the token, we can't sync.
async function getAuthToken(db) {
  // Try to get token from a dedicated auth store or settings if it exists
  // If your app doesn't store auth in IDB, you MUST implement message passing to save it to IDB/Cache.
  // Here we assume a simple 'settings' store might contain it, or we skip auth if headers not needed (unlikely).
  // REAL implementations often duplicate the token into IDB for this exact reason.
  return new Promise((resolve) => {
    // Attempt to read from 'settings' store where we might have saved 'auth_token'
    try {
      if (!db.objectStoreNames.contains('settings')) {
        resolve(null);
        return;
      }
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get('auth_token'); // App must save this!
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// Helper to get sync endpoint for store
function getSyncEndpoint(storeName) {
  const endpoints = {
    products: 'products',
    productBatches: 'product-batches',
    customers: 'customers',
    orders: 'orders',
    transactions: 'transactions',
    purchaseOrders: 'purchase-orders',
    categories: 'categories',
    expenses: 'expenses',
    refunds: 'refunds',
    planOrders: 'plan-orders',
    syncTracking: 'sync-tracking',
    customerTransactions: 'customer-transactions',
    suppliers: 'suppliers',
    supplierTransactions: 'suppliers',
    dProducts: 'd-products',
    expenses: 'expenses'
  };
  return endpoints[storeName] || null;
}

// Perform the actual sync
async function syncData() {
  try {
    const db = await openDB();
    const token = await getAuthToken(db);

    const storesToSync = Object.values(STORES);
    let totalSynced = 0;
    let hasFailures = false;

    // Get sellerId from settings if available
    const sellerId = await new Promise((resolve) => {
      try {
        if (!db.objectStoreNames.contains('settings')) return resolve(null);
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const request = store.get('seller_id');
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });

    if (!sellerId) {
      // console.warn('[SW] No sellerId found in settings. Skipping background sync.');
      return;
    }

    for (const storeName of storesToSync) {
      if (!db.objectStoreNames.contains(storeName)) continue;

      const unsyncedItems = await getAllUnsynced(db, storeName);
      if (unsyncedItems.length === 0) continue;

      const syncEndpoint = getSyncEndpoint(storeName);
      if (!syncEndpoint) {
        // console.warn(`[SW] No sync endpoint for store: ${storeName}`);
        continue;
      }

      // console.log(`[SW] Syncing ${unsyncedItems.length} items from ${storeName} to /sync/${syncEndpoint}`);

      // Prepare cleaned items (remove local-only fields)
      const cleanedItems = unsyncedItems.map(item => {
        let cleanedItem = { ...item };
        if (storeName === 'productBatches' && cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('batch_')) {
          delete cleanedItem._id;
        }
        if (storeName === 'purchaseOrders' && cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('PO_')) {
          delete cleanedItem._id;
        }
        return cleanedItem;
      });

      try {
        const response = await fetch(`/api/sync/${syncEndpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          credentials: 'include',
          body: JSON.stringify({
            sellerId,
            items: cleanedItems
          })
        });

        if (response.ok) {
          const result = await response.json();

          if (result.success) {
            const responseData = result.data || result;
            const successItems = responseData.results?.success || responseData.success || [];

            // Update local items as synced
            for (const syncedInfo of successItems) {
              const originalItem = unsyncedItems.find(i => String(i.id) === String(syncedInfo.id));
              if (originalItem) {
                await updateItemSynced(db, storeName, originalItem, syncedInfo);
                totalSynced++;
              }
            }

            // Check if some items failed inside the batch
            const failedCount = (responseData.results?.failed || responseData.failed || []).length;
            if (failedCount > 0) {
              // console.warn(`[SW] ${failedCount} items failed in batch sync for ${storeName}`);
              hasFailures = true;
            }
          } else {
            // console.error(`[SW] Batch sync logic failure for ${storeName}:`, result.message);
            hasFailures = true;
          }
        } else {
          // console.error(`[SW] HTTP error syncing ${storeName}:`, response.status);
          hasFailures = true;
        }
      } catch (err) {
        // console.error(`[SW] Network error syncing ${storeName}:`, err);
        hasFailures = true;
      }
    }

    if (totalSynced > 0) {
      // console.log(`[SW] Successfully background synced ${totalSynced} items`);
      // Notify client to refresh
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETED', count: totalSynced }));
      });
    }

    if (hasFailures) {
      throw new Error('Some items failed to sync. Scheduling retry.');
    }

  } catch (error) {
    // console.error('[SW] Background sync failed:', error);
    throw error;
  }
}

function getAllUnsynced(db, storeName) {
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const unsynced = [];

    if (store.indexNames.contains('isSynced')) {
      const index = store.index('isSynced');
      const request = index.getAll(IDBKeyRange.only(false));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    } else {
      const request = store.openCursor();
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.isSynced === false) unsynced.push(cursor.value);
          cursor.continue();
        } else {
          resolve(unsynced);
        }
      };
    }
  });
}

async function updateItemSynced(db, storeName, localItem, syncedInfo) {
  return new Promise((resolve, reject) => {
    const mongoId = syncedInfo._id;

    // CRITICAL SAFEGUARD: Match syncService.js logic
    if (!localItem._id && !mongoId) {
      // console.warn(`[SW] Skipping sync mark for new item ${localItem.id} - no _id returned`);
      return resolve();
    }

    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    const hasIdChanged = mongoId && String(localItem.id) !== String(mongoId);

    const updatedItem = {
      ...localItem,
      isSynced: true,
      syncedAt: new Date().toISOString(),
      _id: mongoId || localItem._id
    };

    if (hasIdChanged) {
      updatedItem.id = mongoId;
      updatedItem.localId = localItem.id;
      // Delete old record if ID changed
      store.delete(localItem.id);
    }

    store.put(updatedItem);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Minimal push notification support (optional)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data?.text() || 'Update available',
    icon: '/favicon.ico',
    tag: 'notification'
  };

  event.waitUntil(
    self.registration.showNotification('Grocery studio', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
