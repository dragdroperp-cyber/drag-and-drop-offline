/**
 * Universal Incremental Sync Manager
 * Provides generic sync functions that work with any collection
 * Supports both full sync and incremental sync based on timestamps
 */

import { apiRequest } from '../utils/api';
import { isProfileComplete } from '../utils/profileUtils';
import { getAllItems, addItem, updateItem, deleteItem, updateMultipleItems, deleteMultipleItems, STORES } from '../utils/indexedDB';

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
  supplierTransactions: 'supplier-transactions',
  dProducts: 'd-products'
};

// Metadata store name for tracking sync timestamps
const METADATA_STORE = STORES.syncMetadata;

// Track active syncs to prevent duplicates
const activeSyncs = new Set();

/**
 * Check if user profile is complete via localStorage
 */
const checkProfileStatus = () => {
  try {
    const auth = localStorage.getItem('auth');
    if (!auth) return false;
    const authData = JSON.parse(auth);
    const user = authData.currentUser;
    return isProfileComplete(user);
  } catch (error) {
    return false;
  }
};

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
 * Helper to prepare item for storing (preserves IDs and sync status)
 * @param {Object} item - Item from backend
 * @param {Object|null} existing - Existing local item (if any)
 */
const prepareItemForStore = (item, existing) => {
  // CRITICAL: Do not overwrite local items that have pending changes (isSynced: false)
  if (existing && existing.isSynced === false) {
    // console.log(`[SYNC] Skipping inbound update for item ${item.id || item._id} - local has pending changes`);
    return null; // Skip update
  }

  // STOP ID SWAPPING: Prioritize localId to preserve offline relationships
  const idToUse = existing?.id || item.localId || (item.id && item.id.length !== 24 ? item.id : item._id);

  return {
    ...item,
    id: idToUse || item.id || item._id, // Keep localId as primary key
    localId: existing?.localId || item.localId || (idToUse !== item._id ? idToUse : undefined), // Ensure localId is tracked
    _id: item._id || (item.id && item.id.length === 24 ? item.id : undefined), // Ensure _id is tracked
    isSynced: true,
    updatedAt: item.updatedAt || new Date().toISOString()
  };
};

/**
 * Sync a single collection incrementally with BATCH optimization
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

    // ONLY SYNC IF PROFILE IS COMPLETED
    if (!checkProfileStatus()) {
      // console.log(`[SYNC] Skipping ${storeName} sync - profile incomplete`);
      return {
        success: true,
        collection: collectionName,
        skipped: true,
        message: 'Profile incomplete'
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

    // apiRequest returns { success: true, data: { updated: [...], deleted: [...], ... } }
    const responseData = response.data || {};
    const { updated = [], deleted = [] } = responseData;

    // Optimization: Fetch all items ONCE for existence check
    let existingItems = [];
    try {
      existingItems = await getAllItems(storeName);
    } catch (e) {
      // Store might be empty or new
    }

    // Create lookup map for faster access: Key -> Item
    // We map both id and _id to the item for robust finding
    const existingMap = new Map();
    existingItems.forEach(item => {
      if (item.id) existingMap.set(String(item.id), item);
      if (item._id) existingMap.set(String(item._id), item);
    });

    // Process UPDATES in batch
    const itemsToUpdate = [];
    for (const item of updated) {
      const lookupId = item.id || item._id;
      const existing = existingMap.get(String(lookupId)) || existingMap.get(String(item._id));

      const itemToStore = prepareItemForStore(item, existing);
      if (itemToStore) {
        itemsToUpdate.push(itemToStore);
      }
    }

    if (itemsToUpdate.length > 0) {
      await updateMultipleItems(storeName, itemsToUpdate, true); // true = skip validation for speed
    }

    // Process DELETES in batch
    const idsToDelete = [];
    for (const deletedItem of deleted) {
      const itemId = deletedItem.id || deletedItem._id;
      if (itemId) {
        const existing = existingMap.get(String(itemId));
        if (existing) {
          // Soft delete: mark as deleted instead of removing
          itemsToUpdate.push({
            ...existing,
            isDeleted: true,
            updatedAt: deletedItem.updatedAt || new Date().toISOString()
          });
        }
      }
    }

    // We reuse itemsToUpdate array for soft deletes (since they are just updates with isDeleted: true)
    if (idsToDelete.length > 0) {
      // Note: Currently we do soft deletes via update, so idsToDelete is unused unless we switch to hard delete
      // await deleteMultipleItems(storeName, idsToDelete);
    }
    // Re-run batch update if we added soft deletes
    if (itemsToUpdate.length > 0) {
      await updateMultipleItems(storeName, itemsToUpdate, true);
    }

    // Update last sync timestamp
    await setLastSync(collectionName);

    // Clear the sync flag
    activeSyncs.delete(syncKey);

    return {
      success: true,
      collection: collectionName,
      updated: itemsToUpdate.length, // Approximate count (includes soft deletes)
      deleted: deleted.length,
      total: itemsToUpdate.length
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
 * Perform incremental sync for all collections (PARALLEL)
 */
export const performIncrementalSync = async (collections = null) => {
  try {
    const collectionsToSync = collections || Object.keys(COLLECTION_MAP);

    // Run all syncs in parallel
    const promises = collectionsToSync.map(async (storeName) => {
      try {
        const lastSync = await getLastSync(COLLECTION_MAP[storeName]);
        return await syncCollection(storeName, lastSync);
      } catch (error) {
        return {
          storeName,
          success: false,
          error: error.message
        };
      }
    });

    const resultsArray = await Promise.all(promises);

    // Convert array back to object format
    const results = {};
    resultsArray.forEach((res, index) => {
      results[collectionsToSync[index]] = res;
    });

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
 * Perform full sync for all collections (PARALLEL)
 */
export const performFullSync = async (collections = null) => {
  try {
    const collectionsToSync = collections || Object.keys(COLLECTION_MAP);

    // Run all syncs in parallel
    const promises = collectionsToSync.map(async (storeName) => {
      try {
        return await syncCollection(storeName, null);
      } catch (error) {
        return {
          storeName,
          success: false,
          error: error.message
        };
      }
    });

    const resultsArray = await Promise.all(promises);

    // Convert array back to object format
    const results = {};
    resultsArray.forEach((res, index) => {
      results[collectionsToSync[index]] = res;
    });

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

// Kept for backward compatibility if needed, but updated to use batches
export const updateIndexedDB = async (storeName, item) => {
  try {
    const { updateItem } = await import('../utils/indexedDB');
    // Simplified single update fallback
    await updateItem(storeName, item);
  } catch (e) {
    console.error(e);
  }
};

export const deleteIndexedDB = async (storeName, itemId) => {
  try {
    const { deleteItem } = await import('../utils/indexedDB');
    await deleteItem(storeName, itemId);
  } catch (e) { console.error(e); }
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
