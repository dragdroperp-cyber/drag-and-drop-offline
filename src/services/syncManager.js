/**
 * Universal Incremental Sync Manager
 * Provides generic sync functions that work with any collection
 * Supports both full sync and incremental sync based on timestamps
 */

import { apiRequest } from '../utils/api';
import { getAllItems, addItem, updateItem, deleteItem, STORES } from '../utils/indexedDB';

// Map frontend store names to backend collection names
const COLLECTION_MAP = {
  customers: 'customers',
  products: 'products',
  productBatches: 'product-batches',
  orders: 'orders',
  transactions: 'transactions',
  purchaseOrders: 'vendor-orders',
  categories: 'categories',
  refunds: 'refunds',
  planOrders: 'plan-orders',
  plans: 'plans',
  expenses: 'expenses',
  customerTransactions: 'customer-transactions',
  suppliers: 'suppliers',
  supplierTransactions: 'supplier-transactions'
};

// Metadata store name for tracking sync timestamps
const METADATA_STORE = STORES.syncMetadata;

// Track active syncs to prevent duplicates
const activeSyncs = new Set();

/**
 * Initialize metadata store in IndexedDB
 */
const initMetadataStore = async () => {
  // This will be handled by indexedDB.js upgrade logic
  // For now, we'll use a simple approach with localStorage as fallback
};

/**
 * Get last sync timestamp for a collection
 */
export const getLastSync = async (collectionName) => {
  try {
    // Try IndexedDB first
    try {
      const metadata = await getAllItems(METADATA_STORE).catch(() => []);
      const record = metadata.find(m => m.collection === collectionName);
      if (record && record.lastSync) {
        return new Date(record.lastSync);
      }
    } catch (idbError) {
      // Store might not exist yet (database not upgraded)

    }

    // Fallback to localStorage
    const stored = localStorage.getItem(`sync_${collectionName}`);
    if (stored) {
      return new Date(stored);
    }

    return null;
  } catch (error) {

    // Fallback to localStorage
    const stored = localStorage.getItem(`sync_${collectionName}`);
    return stored ? new Date(stored) : null;
  }
};

/**
 * Set last sync timestamp for a collection
 */
export const setLastSync = async (collectionName, timestamp = new Date()) => {
  try {
    const timestampStr = timestamp instanceof Date ? timestamp.toISOString() : timestamp;

    // Try IndexedDB first
    try {
      // Check if store exists by trying to get items
      const metadata = await getAllItems(METADATA_STORE).catch(() => {
        // Store doesn't exist yet - will use localStorage
        throw new Error('Store not available');
      });

      const existing = metadata.find(m => m.collection === collectionName);

      if (existing) {
        await updateItem(METADATA_STORE, {
          ...existing,
          lastSync: timestampStr,
          updatedAt: new Date().toISOString()
        });
      } else {
        await addItem(METADATA_STORE, {
          id: `metadata_${collectionName}`,
          collection: collectionName,
          lastSync: timestampStr,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (idbError) {
      // Store might not exist yet (database not upgraded) - use localStorage only

    }

    // Always update localStorage as backup (works even if IndexedDB store doesn't exist)
    localStorage.setItem(`sync_${collectionName}`, timestampStr);
  } catch (error) {

    // Fallback to localStorage
    localStorage.setItem(`sync_${collectionName}`, timestamp instanceof Date ? timestamp.toISOString() : timestamp);
  }
};

/**
 * Reset all sync timestamps (for full sync)
 */
export const resetAllSyncTimestamps = async () => {
  try {
    const collections = Object.keys(COLLECTION_MAP);
    for (const collection of collections) {
      await setLastSync(collection, new Date(0)); // Set to epoch for full sync
    }
  } catch (error) {

  }
};

/**
 * Update item in IndexedDB (generic)
 */
export const updateIndexedDB = async (storeName, item) => {
  try {
    // Ensure item has required fields
    // STOP ID SWAPPING: Prioritize localId to preserve offline relationships
    const idToUse = item.localId || (item.id && item.id.length !== 24 ? item.id : item._id);

    const itemToStore = {
      ...item,
      id: idToUse || item.id || item._id, // Keep localId as primary key
      localId: item.localId || (idToUse !== item._id ? idToUse : undefined), // Ensure localId is tracked
      _id: item._id || (item.id && item.id.length === 24 ? item.id : undefined), // Ensure _id is tracked
      isSynced: true,
      updatedAt: item.updatedAt || new Date().toISOString()
    };

    // Check if item exists
    const existing = await getAllItems(storeName).then(items =>
      items.find(i => i.id === itemToStore.id || i._id === itemToStore.id)
    );

    if (existing) {
      // CRITICAL: Do not overwrite local items that have pending changes (isSynced: false)
      // This prevents "stale" server data from reverting offline edits before they are pushed
      if (existing.isSynced === false) {
        // console.log(`[SYNC] Skipping inbound update for ${storeName} item ${item.id} - local has pending changes`);
        return existing;
      }

      await updateItem(storeName, itemToStore);
    } else {
      await addItem(storeName, itemToStore);
    }

    return itemToStore;
  } catch (error) {

    throw error;
  }
};

/**
 * Delete item from IndexedDB (generic)
 */
export const deleteIndexedDB = async (storeName, itemId) => {
  try {
    const { deleteItem } = await import('../utils/indexedDB');
    await deleteItem(storeName, itemId);
  } catch (error) {

    // Don't throw - deletion failures shouldn't break sync
  }
};

/**
 * Sync a single collection incrementally
 */
export const syncCollection = async (storeName, since = null) => {
  // Prevent multiple simultaneous syncs of the same collection
  const syncKey = `${storeName}_${since ? 'incremental' : 'full'}`;

  try {
    const collectionName = COLLECTION_MAP[storeName];
    if (!collectionName) {
      throw new Error(`No collection mapping for store: ${storeName}`);
    }

    if (activeSyncs.has(syncKey)) {
      console.log(`[SYNC] Skipping ${storeName} sync - already in progress`);
      return {
        success: true,
        collection: collectionName,
        skipped: true,
        message: 'Sync already in progress'
      };
    }
    activeSyncs.add(syncKey);

    // Build query URL
    let url = `/sync/${collectionName}`;
    if (since) {
      const sinceStr = since instanceof Date ? since.toISOString() : since;
      url += `?since=${encodeURIComponent(sinceStr)}`;
    }

    // Fetch data from backend
    const response = await apiRequest(url, {
      method: 'GET'
    });

    if (!response.success) {
      throw new Error(response.message || 'Sync failed');
    }

    const { updated = [], deleted = [] } = response;

    // Update IndexedDB with new/updated items
    let updatedCount = 0;
    for (const item of updated) {
      try {
        await updateIndexedDB(storeName, item);
        updatedCount++;
      } catch (error) {

      }
    }

    // Delete items from IndexedDB (soft delete - mark as deleted)
    let deletedCount = 0;
    for (const deletedItem of deleted) {
      try {
        const itemId = deletedItem.id || deletedItem._id;
        if (itemId) {
          // Check if item exists in IndexedDB before attempting to delete
          const existingItems = await getAllItems(storeName);
          const existingItem = existingItems.find(i => (i.id === itemId || i._id === itemId));

          if (existingItem) {
            // Soft delete: mark as deleted instead of removing
            await updateItem(storeName, {
              ...existingItem,
              isDeleted: true,
              updatedAt: deletedItem.updatedAt || new Date().toISOString()
            });
            deletedCount++;
          } else {
            // Item doesn't exist in IndexedDB, skip

          }
        }
      } catch (error) {

      }
    }

    // Update last sync timestamp
    await setLastSync(collectionName);

    // Clear the sync flag
    activeSyncs.delete(syncKey);

    return {
      success: true,
      collection: collectionName,
      updated: updatedCount,
      deleted: deletedCount,
      total: updatedCount + deletedCount
    };
  } catch (error) {
    // Clear the sync flag on error
    activeSyncs.delete(syncKey);

    return {
      success: false,
      collection: storeName,
      error: error.message
    };
  }
};

/**
 * Perform incremental sync for all collections
 */
export const performIncrementalSync = async (collections = null) => {
  try {
    const collectionsToSync = collections || Object.keys(COLLECTION_MAP);
    const results = {};

    for (const storeName of collectionsToSync) {
      try {
        // Get last sync timestamp
        const lastSync = await getLastSync(COLLECTION_MAP[storeName]);

        // Perform incremental sync
        const result = await syncCollection(storeName, lastSync);
        results[storeName] = result;
      } catch (error) {

        results[storeName] = {
          success: false,
          error: error.message
        };
      }
    }

    return {
      success: true,
      results,
      summary: {
        total: collectionsToSync.length,
        successful: Object.values(results).filter(r => r.success).length,
        failed: Object.values(results).filter(r => !r.success).length
      }
    };
  } catch (error) {

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Perform full sync for all collections (ignores timestamps)
 */
export const performFullSync = async (collections = null) => {
  try {
    const collectionsToSync = collections || Object.keys(COLLECTION_MAP);
    const results = {};

    for (const storeName of collectionsToSync) {
      try {
        // Perform sync without timestamp (full sync)
        const result = await syncCollection(storeName, null);
        results[storeName] = result;
      } catch (error) {

        results[storeName] = {
          success: false,
          error: error.message
        };
      }
    }

    // Reset all timestamps after full sync
    await resetAllSyncTimestamps();

    return {
      success: true,
      results,
      summary: {
        total: collectionsToSync.length,
        successful: Object.values(results).filter(r => r.success).length,
        failed: Object.values(results).filter(r => !r.success).length
      }
    };
  } catch (error) {

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check if online
 */
export const isOnline = () => {
  return navigator.onLine;
};

export default {
  syncCollection,
  performIncrementalSync,
  performFullSync,
  getLastSync,
  setLastSync,
  resetAllSyncTimestamps,
  updateIndexedDB,
  deleteIndexedDB,
  isOnline,
  COLLECTION_MAP
};
