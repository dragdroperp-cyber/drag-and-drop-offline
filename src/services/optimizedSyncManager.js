/**
 * Optimized Sync Manager
 * 
 * Features:
 * 1. Request Deduplication - Prevents multiple simultaneous API calls for the same resource
 * 2. Incremental Sync - Only fetches data changed since last sync
 * 3. Multi-Device Support - Properly handles data changes across devices
 * 4. Smart Caching - Reduces unnecessary API calls
 * 5. Automatic Refresh - Periodically checks for updates
 */

import { apiRequest } from '../utils/api';
import { getAllItems, updateItem, addItem, deleteItem, STORES } from '../utils/indexedDB';
import { performIncrementalSync, getLastSync, setLastSync } from './syncManager';

// Request deduplication - track in-flight requests
const pendingRequests = new Map();

// Cache for recent data fetches (short-lived cache)
const dataCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

// Sync status tracking
let lastFullSyncTime = null;
let isSyncInProgress = false;

// Callbacks for sync events
const syncCallbacks = new Set();

/**
 * Register a callback for sync events
 */
export const onSyncEvent = (callback) => {
    syncCallbacks.add(callback);
    return () => syncCallbacks.delete(callback);
};

/**
 * Notify all listeners of sync events
 */
const notifySyncEvent = (event, data) => {
    syncCallbacks.forEach(callback => {
        try {
            callback(event, data);
        } catch (error) {
            console.error('Error in sync callback:', error);
        }
    });
};

/**
 * Deduplicate API requests - if same request is in flight, return the pending promise
 */
const deduplicateRequest = async (key, requestFn) => {
    // Check if request is already in flight
    if (pendingRequests.has(key)) {
        console.log(`[SYNC] 🔄 Request for ${key} already in progress, waiting...`);
        return pendingRequests.get(key);
    }

    // Execute the request and store the promise
    const promise = requestFn()
        .finally(() => {
            // Remove from pending requests when done
            pendingRequests.delete(key);
        });

    pendingRequests.set(key, promise);
    return promise;
};

/**
 * Get data from cache if available and not expired
 */
const getCachedData = (key) => {
    const cached = dataCache.get(key);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > CACHE_DURATION) {
        dataCache.delete(key);
        return null;
    }

    console.log(`[SYNC] 📦 Using cached data for ${key}`);
    return cached.data;
};

/**
 * Store data in cache
 */
const setCachedData = (key, data) => {
    dataCache.set(key, {
        data,
        timestamp: Date.now()
    });
};

/**
 * Clear cache for a specific key or all cache
 */
export const clearCache = (key = null) => {
    if (key) {
        dataCache.delete(key);
    } else {
        dataCache.clear();
    }
};

/**
 * Fetch collection data with deduplication and caching
 */
export const fetchCollection = async (collectionName, options = {}) => {
    const {
        forceRefresh = false,
        useCache = true,
        since = null
    } = options;

    const cacheKey = `collection_${collectionName}_${since || 'full'}`;

    // Check cache first (unless force refresh)
    if (!forceRefresh && useCache) {
        const cached = getCachedData(cacheKey);
        if (cached) {
            return cached;
        }
    }

    // Deduplicate the request
    return deduplicateRequest(cacheKey, async () => {
        try {
            console.log(`[SYNC] 📥 Fetching ${collectionName}${since ? ' (incremental)' : ' (full)'}...`);

            let url = `/sync/${collectionName}`;
            if (since) {
                const sinceStr = since instanceof Date ? since.toISOString() : since;
                url += `?since=${encodeURIComponent(sinceStr)}`;
            }

            const response = await apiRequest(url, { method: 'GET' });

            if (!response.success) {
                throw new Error(response.message || 'Sync failed');
            }

            // Cache the result
            if (useCache) {
                setCachedData(cacheKey, response);
            }

            console.log(`[SYNC] ✅ Fetched ${collectionName}: ${response.count?.updated || 0} updated, ${response.count?.deleted || 0} deleted`);

            return response;
        } catch (error) {
            console.error(`[SYNC] ❌ Error fetching ${collectionName}:`, error);
            throw error;
        }
    });
};

/**
 * Sync a single collection incrementally
 */
export const syncCollectionIncremental = async (storeName, collectionName) => {
    try {
        // Get last sync timestamp
        const lastSync = await getLastSync(collectionName);

        console.log(`[SYNC] 🔄 Syncing ${collectionName} (last sync: ${lastSync ? lastSync.toISOString() : 'never'})`);

        // Fetch data from backend (with deduplication)
        const response = await fetchCollection(collectionName, {
            since: lastSync,
            useCache: false // Don't cache incremental syncs
        });

        const { updated = [], deleted = [] } = response;

        // Update IndexedDB
        let updatedCount = 0;
        let deletedCount = 0;

        // Process updated items
        for (const item of updated) {
            try {
                const itemToStore = {
                    ...item,
                    id: item.id || item._id,
                    isSynced: true,
                    updatedAt: item.updatedAt || new Date().toISOString()
                };

                // Check if exists
                const allItems = await getAllItems(storeName);
                const existing = allItems.find(i => i.id === itemToStore.id || i._id === itemToStore.id);

                if (existing) {
                    await updateItem(storeName, itemToStore);
                } else {
                    await addItem(storeName, itemToStore);
                }
                updatedCount++;
            } catch (error) {
                console.error(`[SYNC] ❌ Error updating item in ${storeName}:`, error);
            }
        }

        // Process deleted items (soft delete)
        for (const deletedItem of deleted) {
            try {
                const itemId = deletedItem.id || deletedItem._id;
                if (itemId) {
                    const allItems = await getAllItems(storeName);
                    const existing = allItems.find(i => i.id === itemId || i._id === itemId);

                    if (existing) {
                        await updateItem(storeName, {
                            ...existing,
                            isDeleted: true,
                            deletedAt: deletedItem.updatedAt || new Date().toISOString()
                        });
                        deletedCount++;
                    }
                }
            } catch (error) {
                console.error(`[SYNC] ❌ Error deleting item from ${storeName}:`, error);
            }
        }

        // Update last sync timestamp
        await setLastSync(collectionName);

        const result = {
            success: true,
            collection: collectionName,
            updated: updatedCount,
            deleted: deletedCount,
            total: updatedCount + deletedCount
        };

        // Notify listeners
        notifySyncEvent('collection_synced', result);

        return result;
    } catch (error) {
        console.error(`[SYNC] ❌ Error syncing ${collectionName}:`, error);
        return {
            success: false,
            collection: collectionName,
            error: error.message
        };
    }
};

/**
 * Sync all collections incrementally
 */
export const syncAllIncremental = async () => {
    if (isSyncInProgress) {
        console.log('[SYNC] ⏸️ Sync already in progress, skipping...');
        return { success: false, error: 'Sync in progress' };
    }

    isSyncInProgress = true;
    notifySyncEvent('sync_started', { type: 'incremental' });

    try {
        const collections = [
            { store: STORES.categories, collection: 'categories' },
            { store: STORES.products, collection: 'products' },
            { store: STORES.customers, collection: 'customers' },
            { store: STORES.orders, collection: 'orders' },
            { store: STORES.transactions, collection: 'transactions' },
            { store: STORES.purchaseOrders, collection: 'vendor-orders' },
            { store: STORES.refunds, collection: 'refunds' }
        ];

        const results = {};
        let totalUpdated = 0;
        let totalDeleted = 0;

        for (const { store, collection } of collections) {
            const result = await syncCollectionIncremental(store, collection);
            results[collection] = result;

            if (result.success) {
                totalUpdated += result.updated || 0;
                totalDeleted += result.deleted || 0;
            }
        }

        lastFullSyncTime = new Date();

        const summary = {
            success: true,
            results,
            summary: {
                totalUpdated,
                totalDeleted,
                timestamp: lastFullSyncTime.toISOString()
            }
        };

        notifySyncEvent('sync_completed', summary);

        console.log(`[SYNC] ✅ Incremental sync completed: ${totalUpdated} updated, ${totalDeleted} deleted`);

        return summary;
    } catch (error) {
        console.error('[SYNC] ❌ Error in incremental sync:', error);
        notifySyncEvent('sync_error', { error: error.message });
        return {
            success: false,
            error: error.message
        };
    } finally {
        isSyncInProgress = false;
    }
};

/**
 * Auto-sync manager - periodically checks for updates
 */
class AutoSyncManager {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        this.syncIntervalMs = 60000; // 1 minute default
    }

    start(intervalMs = 60000) {
        if (this.isRunning) {
            console.log('[AUTO-SYNC] Already running');
            return;
        }

        this.syncIntervalMs = intervalMs;
        this.isRunning = true;

        console.log(`[AUTO-SYNC] 🚀 Starting auto-sync (interval: ${intervalMs}ms)`);

        // Initial sync
        this.performSync();

        // Set up periodic sync
        this.interval = setInterval(() => {
            this.performSync();
        }, intervalMs);

        // Sync when coming back online
        window.addEventListener('online', this.handleOnline);

        // Sync when window regains focus (user switches back to tab)
        window.addEventListener('focus', this.handleFocus);
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        console.log('[AUTO-SYNC] 🛑 Stopping auto-sync');

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('focus', this.handleFocus);

        this.isRunning = false;
    }

    handleOnline = () => {
        console.log('[AUTO-SYNC] 🌐 Back online, syncing...');
        setTimeout(() => this.performSync(), 1000);
    };

    handleFocus = () => {
        console.log('[AUTO-SYNC] 👁️ Window focused, checking for updates...');
        // Only sync if it's been more than 30 seconds since last sync
        if (!lastFullSyncTime || Date.now() - lastFullSyncTime.getTime() > 30000) {
            this.performSync();
        }
    };

    async performSync() {
        if (!navigator.onLine) {
            console.log('[AUTO-SYNC] ⚠️ Offline, skipping sync');
            return;
        }

        if (isSyncInProgress) {
            console.log('[AUTO-SYNC] ⏸️ Sync in progress, skipping');
            return;
        }

        try {
            await syncAllIncremental();
        } catch (error) {
            console.error('[AUTO-SYNC] ❌ Error during auto-sync:', error);
        }
    }
}

// Export singleton instance
export const autoSyncManager = new AutoSyncManager();

/**
 * Initialize optimized sync system
 */
export const initializeOptimizedSync = (options = {}) => {
    const {
        autoSync = true,
        syncInterval = 60000, // 1 minute
        initialSync = true
    } = options;

    console.log('[SYNC] 🚀 Initializing optimized sync system...');

    // Perform initial sync if requested
    if (initialSync) {
        syncAllIncremental().catch(error => {
            console.error('[SYNC] ❌ Error in initial sync:', error);
        });
    }

    // Start auto-sync if requested
    if (autoSync) {
        autoSyncManager.start(syncInterval);
    }

    return {
        syncNow: syncAllIncremental,
        startAutoSync: () => autoSyncManager.start(syncInterval),
        stopAutoSync: () => autoSyncManager.stop(),
        clearCache,
        onSyncEvent
    };
};

export default {
    fetchCollection,
    syncCollectionIncremental,
    syncAllIncremental,
    initializeOptimizedSync,
    autoSyncManager,
    clearCache,
    onSyncEvent
};
