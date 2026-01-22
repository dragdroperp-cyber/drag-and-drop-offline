/**
 * Sync Service - Handles synchronization between IndexedDB and Backend
 * - Checks for items with isSynced: false
 * - Verifies online status
 * - Sends data to backend
 * - Marks successfully synced items
 * - Retries failed syncs
 */

import { API_BASE_URL, apiRequest, getSellerId } from '../utils/api';
import { isProfileComplete } from '../utils/profileUtils';

// Helper to get store functions - will be provided by AppContext
let getStoreFunctionsProvider = null;

// Helper to check if order is being processed (will be provided by AppContext)
let checkOrderHashPending = null;

export const setOrderHashPendingChecker = (checker) => {
  checkOrderHashPending = checker;
};

// Callback to notify AppContext when items are synced (for state updates)
let onItemSyncedCallback = null;

export const setOnItemSyncedCallback = (callback) => {
  onItemSyncedCallback = callback;
};

// Callback to notify AppContext when sync completes (for status updates)
let onSyncCompletedCallback = null;

export const setOnSyncCompletedCallback = (callback) => {
  onSyncCompletedCallback = callback;
};

export const setStoreFunctionsProvider = (provider) => {
  getStoreFunctionsProvider = provider;
};

class SyncService {
  constructor() {
    this.isSyncing = false;
    this.syncQueue = [];
    this.retryAttempts = new Map(); // Track retry attempts per item
    this.maxRetries = 3;
    this.syncTimer = null; // Timer for debounced sync
    this.SYNC_DELAY = 30000; // 30 seconds delay
  }

  /**
   * Check if user profile is complete via localStorage
   */
  checkProfileStatus() {
    try {
      const auth = localStorage.getItem('auth');
      if (!auth) return false;
      const authData = JSON.parse(auth);
      const user = authData.currentUser;
      return isProfileComplete(user);
    } catch (error) {
      return false;
    }
  }

  /**
   * Schedule a sync to run after a delay (debounce)
   * If called again within the delay, the timer is reset
   */
  scheduleSync(getStoreFunctions = null) {
    // Clear existing timer
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      // console.log('[SYNC] ⏳ Operation detected. Resetting 30s sync timer...');
    } else {
      // console.log('[SYNC] ⏳ Operation detected. Starting 30s sync timer...');
    }

    // Schedule new sync
    this.syncTimer = setTimeout(async () => {
      // console.log('[SYNC] ⏰ 30s timer expired. Triggering full sync...');
      this.syncTimer = null; // Reset timer flag

      // Only runs if online
      if (this.isOnline()) {
        await this.syncAll(getStoreFunctions);
        // console.log('[SYNC] 💤 Sync complete. Going idle until next operation.');
      } else {
        // console.log('[SYNC] 📴 Offline. Sync skipped. Timer cleared.');
      }
    }, this.SYNC_DELAY);
  }

  /**
   * Cancel any pending scheduled sync
   */
  cancelScheduledSync() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Check if user is online
   */
  isOnline() {
    return navigator.onLine;
  }

  /**
   * Get seller ID from auth state
   */
  getSellerId() {
    try {
      const auth = localStorage.getItem('auth');
      if (auth) {
        const authData = JSON.parse(auth);
        // For Firebase auth, sellerId might be stored separately
        // For now, we'll get it from the backend auth endpoint
        return authData.sellerId || authData.uid;
      }
      return null;
    } catch (error) {

      return null;
    }
  }

  /**
   * Get sellerId from localStorage (cached) - only call backend if not present
   */
  getSellerIdFromCache() {
    try {
      const auth = localStorage.getItem('auth');
      if (!auth) return null;

      const authData = JSON.parse(auth);
      return authData.sellerId || authData.currentUser?.sellerId || null;
    } catch (error) {

      return null;
    }
  }

  /**
   * Get or create seller from backend - ONLY if not in localStorage
   */
  async getSellerIdFromBackend() {
    try {
      // First check if sellerId is already in localStorage (avoid multiple API calls)
      const cachedSellerId = this.getSellerIdFromCache();
      if (cachedSellerId) {
        return cachedSellerId;
      }

      const auth = localStorage.getItem('auth');
      if (!auth) return null;

      const authData = JSON.parse(auth);
      const user = authData.currentUser;

      if (!user || !user.email) return null;

      // Only call backend if sellerId is not cached
      const result = await getSellerId(
        user.email,
        user.uid,
        user.displayName,
        user.photoURL
      );

      if (result.success && result.sellerId) {
        // Store sellerId in localStorage
        const updatedAuth = {
          ...authData,
          sellerId: result.sellerId
        };
        localStorage.setItem('auth', JSON.stringify(updatedAuth));
        return result.sellerId;
      }
      return null;
    } catch (error) {

      return null;
    }
  }

  /**
   * Sync a single item
   */
  async syncItem(storeName, item, sellerId) {
    try {
      const endpoint = this.getEndpointForStore(storeName);
      if (!endpoint) {
        throw new Error(`No endpoint for store: ${storeName}`);
      }

      // Clean item data before sending to backend
      let cleanedItem = { ...item };

      // For products, handle category field properly
      if (storeName === 'products') {
        // Remove category if it's a string (should be ObjectId reference)
        // Backend will handle category references separately
        if (cleanedItem.category && typeof cleanedItem.category === 'string' && !/^[0-9a-fA-F]{24}$/.test(cleanedItem.category)) {

          delete cleanedItem.category;
        }
      }

      // For purchaseOrders, remove custom _id field so MongoDB can generate ObjectId
      if (storeName === 'purchaseOrders') {
        if (cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('PO_')) {

          delete cleanedItem._id;
        }
      }

      // For productBatches, remove custom _id field so MongoDB can generate ObjectId
      if (storeName === 'productBatches') {
        console.log(`[SYNC] Product batch before cleaning:`, { id: cleanedItem.id, _id: cleanedItem._id });
        if (cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('batch_')) {
          console.log(`[SYNC] Removing _id field for product batch: ${cleanedItem._id}`);
          delete cleanedItem._id;
        }
        console.log(`[SYNC] Product batch after cleaning:`, { id: cleanedItem.id, _id: cleanedItem._id });
      }

      // Debug what we're sending
      if (storeName === 'orders') {

      }

      const result = await apiRequest(`/sync/${endpoint}`, {
        method: 'POST',
        body: {
          sellerId,
          items: [cleanedItem]
        }
      });

      if (!result.success) {
        // Check if this is an expired plan error
        if (result.planInvalid || (result.error && result.error.toLowerCase().includes('plan has expired'))) {
          console.log(`[SYNC] ⚠️ Sync blocked due to expired plan for ${storeName} item ${item.id}`);
          // Return a special result indicating plan expiration
          return {
            success: false,
            planExpired: true,
            error: result.error || 'Plan expired - sync blocked',
            itemId: item.id
          };
        }

        throw new Error(result.error || result.message || 'Sync failed');
      }

      // Return the data structure - should be { success: true, results: { success: [...], failed: [...] } }
      const responseData = result.data || result;
      console.log(`[SYNC] 📦 Response data structure for ${storeName}:`, {
        hasData: !!result.data,
        hasResults: !!(result.data?.results || result.results),
        successItems: result.data?.results?.success?.length || result.results?.success?.length || 0,
        failedItems: result.data?.results?.failed?.length || result.results?.failed?.length || 0
      });

      return responseData;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get endpoint name for store
   */
  getEndpointForStore(storeName) {
    const endpointMap = {
      customers: 'customers',
      products: 'products',
      productBatches: 'product-batches',
      orders: 'orders',
      transactions: 'transactions',
      purchaseOrders: 'vendor-orders',
      categories: 'categories',
      refunds: 'refunds',
      expenses: 'expenses',
      planOrders: 'plan-orders',
      customerTransactions: 'customers',
      suppliers: 'suppliers',
      supplierTransactions: 'suppliers',
      dProducts: 'd-products',
      settings: 'settings'
    };
    return endpointMap[storeName];
  }

  /**
   * Sync all unsynced items from a store
   */
  async syncStore(storeName, getAllItems, updateItem, deleteItem = null) {
    try {
      const items = await getAllItems();

      if (storeName === 'dProducts') {
        console.log(`[SYNC DEBUG] syncStore(dProducts): Fetched ${items.length} total items from IDB`);
      }

      // Filter items that are NOT synced (isSynced === false, null, or undefined)
      // Include both regular unsynced items AND deleted items (isDeleted: true)
      // Backend will handle deletion when it sees isDeleted: true
      // BUT: Skip orders that are currently being processed via direct API call
      const unsyncedItems = items.filter(item => {
        const isSynced = item.isSynced;
        // Consider as unsynced if: false, null, undefined, or explicitly set to false
        // Include deleted items (isDeleted: true) so they can be synced for deletion
        const isUnsynced = isSynced !== true && isSynced !== 'true';

        // For orders only: Skip if this order is currently being processed via direct API call
        if (storeName === 'orders' && isUnsynced && checkOrderHashPending) {
          // Create a simple hash to check (same logic as AppContext)
          const normalizedTotal = Math.round((item.totalAmount || 0) * 100) / 100;
          const itemsHash = JSON.stringify((item.items || []).map(i => ({
            name: (i.name || '').trim(),
            quantity: typeof i.quantity === 'number' ? i.quantity : parseFloat(i.quantity) || 0,
            sellingPrice: Math.round((typeof i.sellingPrice === 'number' ? i.sellingPrice : parseFloat(i.sellingPrice) || 0) * 100) / 100,
            costPrice: Math.round((typeof i.costPrice === 'number' ? i.costPrice : parseFloat(i.costPrice) || 0) * 100) / 100
          })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
          const orderHash = `${item.sellerId || ''}_${item.customerId || 'null'}_${normalizedTotal}_${itemsHash}`;

          if (checkOrderHashPending(orderHash)) {
            // console.log(`[SYNC] Skipping currently processing order: ${item.id} (Hash: ${orderHash})`);
            return false; // Skip this order
          }
        }

        return isUnsynced;
      });

      // Log deleted items separately for debugging
      const deletedItems = unsyncedItems.filter(item => item.isDeleted === true);
      if (deletedItems.length > 0) {
        // console.log(`[SYNC] ${storeName} has ${deletedItems.length} deleted items to sync`);
        deletedItems.forEach(item => {
          // console.log(`[SYNC] Deleted item details:`, { id: item.id, name: item.name, isDeleted: item.isDeleted });
        });
      }

      if (storeName === 'purchaseOrders') {
        // console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: All items count: ${items.length}, Unsynced: ${unsyncedItems.length}`);

        if (unsyncedItems.length > 0) {
          console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: Unsynced items details:`, unsyncedItems.map(i => ({
            id: i.id,
            supplierName: i.supplierName || i.id,
            isSynced: i.isSynced,
            isSyncedType: typeof i.isSynced
          })));
        }
      }

      if (unsyncedItems.length > 0) {
        console.log(`[SYNC] ${storeName} has ${unsyncedItems.length} unsynced items to sync`);
        if (storeName === 'productBatches') {
          unsyncedItems.forEach(item => {
            console.log(`[SYNC] 📦 Unsynced Batch Detail:`, { id: item.id, _id: item._id, productId: item.productId, batchNumber: item.batchNumber, isSynced: item.isSynced });
          });
        }
      }

      if (unsyncedItems.length === 0) {
        if (storeName === 'productBatches') {
          // console.log(`[SYNC] 📦 No unsynced productBatches found in IndexedDB.`);
        }
        return { success: true, synced: 0, failed: 0 };
      }

      // Use cached sellerId first (avoid multiple API calls)
      let sellerId = this.getSellerIdFromCache();
      if (!sellerId) {
        // Only call backend if not in cache
        sellerId = await this.getSellerIdFromBackend();
      }
      if (!sellerId) {
        // console.error('[SYNC] No seller ID found, aborting sync');
        return { success: false, error: 'No seller ID' };
      }

      const results = { success: [], failed: [] };

      // Prepare batch payload
      const cleanedItems = unsyncedItems.map(item => {
        let cleanedItem = { ...item };

        // For products, handle category field properly
        if (storeName === 'products') {
          // Remove category if it's a string (should be ObjectId reference)
          // Backend will handle category references separately
          if (cleanedItem.category && typeof cleanedItem.category === 'string' && !/^[0-9a-fA-F]{24}$/.test(cleanedItem.category)) {
            // console.log(`[SYNC] Removing invalid category string from product: ${cleanedItem.category}`);
            delete cleanedItem.category;
          }
        }

        // For purchaseOrders, remove custom _id field so MongoDB can generate ObjectId
        if (storeName === 'purchaseOrders') {
          if (cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('PO_')) {
            // console.log(`[SYNC] Removing _id field for purchase order: ${cleanedItem._id}`);
            delete cleanedItem._id;
          }
        }

        // For productBatches, remove custom _id field so MongoDB can generate ObjectId
        if (storeName === 'productBatches') {
          if (cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('batch_')) {
            console.log(`[SYNC] Removing _id field for product batch: ${cleanedItem._id}`);
            delete cleanedItem._id;
          }
        }

        return cleanedItem;
      });

      console.log(`[SYNC] 🚀 BATCH SYNC: Sending ${cleanedItems.length} items for ${storeName} to endpoint: /sync/${this.getEndpointForStore(storeName)}`);

      const endpoint = this.getEndpointForStore(storeName);
      if (!endpoint) {
        throw new Error(`No endpoint for store: ${storeName}`);
      }

      // Execute BATCH API call
      try {
        const result = await apiRequest(`/sync/${endpoint}`, {
          method: 'POST',
          body: {
            sellerId,
            items: cleanedItems // Send all items in one batch
          }
        });

        if (!result.success) {
          // Check if this is an expired plan error (global failure)
          if (result.planInvalid || (result.error && result.error.toLowerCase().includes('plan has expired'))) {
            console.log(`[SYNC] ⚠️ Sync blocked due to expired plan for ${storeName} items`);
            throw new Error(result.error || 'Plan expired - sync blocked');
          }
          throw new Error(result.error || result.message || 'Batch sync failed');
        }

        // Extract results from batch response
        const responseData = result.data || result;
        const successItems = responseData.results?.success || responseData.success || [];
        const failedItems = responseData.results?.failed || responseData.failed || [];

        console.log(`[SYNC] 📦 Batch response for ${storeName}: Success: ${successItems.length}, Failed: ${failedItems.length}`);
        if (storeName === 'productBatches') {
          console.log(`[SYNC] 📦 productBatches sync results:`, responseData.results || responseData);
        }

        // Process SUCCESS items
        for (const syncedItemData of successItems) {
          // Find the original item based on ID
          // Be careful to match loose equality or strict string matching depending on what backend returns
          // Backend should return 'id' which is the original frontend ID for correlation
          const originalItem = unsyncedItems.find(i => i.id == syncedItemData.id);

          if (!originalItem) {
            console.warn(`[SYNC] Received success for unknown item ID: ${syncedItemData.id}`);
            continue;
          }

          if (syncedItemData.action === 'skipped') {
            console.warn(`[SYNC] Item ${originalItem.id} was skipped by backend`);
            results.failed.push({ id: originalItem.id, error: 'Item skipped by backend' });
            continue;
          }

          // Check if this was a deletion
          if (originalItem.isDeleted === true && syncedItemData.action === 'deleted') {
            // Item was successfully deleted on backend - remove from IndexedDB
            if (deleteItem) {
              await deleteItem(originalItem.id);
              // console.log(`[SYNC] 🗑️ Removed deleted item locally: ${originalItem.id}`);
            }
            results.success.push(originalItem.id);
            this.retryAttempts.delete(originalItem.id);
          } else {
            // Update local item with synced status
            if (storeName === 'purchaseOrders') {
              // For purchase orders, keep local data and just mark as synced
              const syncedItem = {
                ...originalItem,
                isSynced: true,
                syncedAt: new Date().toISOString()
              };
              await updateItem(syncedItem);
              results.success.push(originalItem.id);
              this.retryAttempts.delete(originalItem.id);

              if (onItemSyncedCallback) {
                onItemSyncedCallback(storeName, syncedItem);
              }
            } else {
              // Normal sync update
              const mongoId = syncedItemData._id;

              // CRITICAL SAFEGUARD: If original item has no _id (it's new) and backend didn't return one, 
              // we cannot mark it as synced because we haven't established the permanent link.
              if (!originalItem._id && !mongoId) {
                console.warn(`[SYNC] ⚠️ Backend returned success for new item ${originalItem.id} but missing _id. Cannot mark as synced.`);
                continue;
              }

              // STOP ID SWAPPING: Keep the local ID as the primary key to preserve relationships (foreign keys)
              // Store the MongoDB ID in _id field for backend reference
              const syncedItem = {
                ...originalItem,
                isSynced: true,
                syncedAt: new Date().toISOString(),
                _id: mongoId || originalItem._id,
                localId: originalItem.localId || originalItem.id // Ensure localId is preserved/set
              };

              console.log(`[SYNC DEBUG] Item ${originalItem.id} synced successfully.`, {
                storeName,
                id: syncedItem.id,
                _id: syncedItem._id,
                isSynced: syncedItem.isSynced
              });

              // Clean up flags
              if (syncedItem.isDeleted) {
                delete syncedItem.isDeleted;
                delete syncedItem.deletedAt;
              }
              if (syncedItem.isUpdate) {
                delete syncedItem.isUpdate;
              }

              await updateItem(syncedItem);
              results.success.push(originalItem.id);
              this.retryAttempts.delete(originalItem.id);

              if (onItemSyncedCallback) {
                onItemSyncedCallback(storeName, syncedItem);
              }

              if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('syncSuccess', {
                  detail: { storeName, item: syncedItem }
                }));
              }
            }
          }
        }

        // Process FAILED items
        for (const failedItemData of failedItems) {
          const originalItem = unsyncedItems.find(i => i.id == failedItemData.id);
          if (!originalItem) continue;

          const errorMsg = failedItemData.error || 'Batch sync failed for item';
          const attempts = this.retryAttempts.get(originalItem.id) || 0;

          const failedItem = {
            ...originalItem,
            isSynced: false,
            syncError: errorMsg,
            syncAttempts: attempts + 1,
            lastSyncAttempt: new Date().toISOString()
          };

          await updateItem(failedItem);

          if (attempts < this.maxRetries) {
            this.retryAttempts.set(originalItem.id, attempts + 1);
            results.failed.push({ id: originalItem.id, error: errorMsg, retry: true });
          } else {
            this.retryAttempts.set(originalItem.id, attempts + 1);
            results.failed.push({ id: originalItem.id, error: errorMsg, retry: false });
            console.warn(`[SYNC] ⚠️ Item ${originalItem.id} exceeded max retries`);
          }

          console.log(`❌ SYNC FAILED: ${storeName} item ${originalItem.id}`, errorMsg);

          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('syncFailed', {
              detail: { storeName, item: failedItem, error: errorMsg }
            }));
          }
        }

        // Check for items that were in cleanedItems but NOT in success OR failed (should not happen normally)
        // If the backend drops items without reporting, we should assume failure or retry
        if (successItems.length + failedItems.length < cleanedItems.length) {
          console.warn(`[SYNC] ⚠️ Mismatch in batch response count. Sent: ${cleanedItems.length}, Received: ${successItems.length + failedItems.length}`);
          const processedIds = new Set([...successItems, ...failedItems].map(i => i.id));

          for (const item of unsyncedItems) {
            // Note: item.id might be string or number, ensure robust check
            if (!processedIds.has(item.id) && !processedIds.has(String(item.id))) {
              console.warn(`[SYNC] Item ${item.id} was not returned in batch response. Marking as failed.`);
              // Mark as failed so it can be retried
              results.failed.push({ id: item.id, error: 'No response from server', retry: true });
            }
          }
        }

      } catch (batchError) {
        console.error(`[SYNC] ❌ Batch request failed for ${storeName}:`, batchError);
        // Mark ALL items as failed (network error or crash)
        for (const item of unsyncedItems) {
          const attempts = this.retryAttempts.get(item.id) || 0;
          const failedItem = {
            ...item,
            isSynced: false,
            syncError: batchError.message,
            syncAttempts: attempts + 1,
            lastSyncAttempt: new Date().toISOString()
          };
          await updateItem(failedItem);

          if (attempts < this.maxRetries) {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: batchError.message, retry: true });
          } else {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: batchError.message, retry: false });
          }
        }
      }

      return {
        success: results.failed.length === 0,
        synced: results.success.length,
        failed: results.failed.length,
        failedItems: results.failed
      };
    } catch (error) {

      return { success: false, error: error.message };
    }
  }

  /**
   * Sync multiple stores belonging to the same endpoint in a single call.
   * This ensures that related data (like customers and their transactions) can be synced together.
   */
  async syncStoreGroup(endpoint, storeNames, getStoreFuncs) {
    const results = { success: true, synced: 0, failed: 0, storeResults: {} };
    const allUnsyncedItems = [];
    const idToStoreMap = new Map();
    const unsyncedItemsPerStore = new Map();

    let sellerId = this.getSellerIdFromCache();
    if (!sellerId) sellerId = await this.getSellerIdFromBackend();
    if (!sellerId) return { success: false, error: 'No seller ID' };

    for (const storeName of storeNames) {
      const storeFunctions = getStoreFuncs(storeName);
      if (!storeFunctions) continue;

      const items = await storeFunctions.getAllItems();
      const unsynced = items.filter(item => {
        const isSynced = item.isSynced;
        const isUnsynced = isSynced !== true && isSynced !== 'true';
        if (storeName === 'orders' && isUnsynced && checkOrderHashPending) {
          const normalizedTotal = Math.round((item.totalAmount || 0) * 100) / 100;
          const itemsHash = JSON.stringify((item.items || []).map(i => ({
            name: (i.name || '').trim(),
            quantity: typeof i.quantity === 'number' ? i.quantity : parseFloat(i.quantity) || 0,
            sellingPrice: Math.round((typeof i.sellingPrice === 'number' ? i.sellingPrice : parseFloat(i.sellingPrice) || 0) * 100) / 100,
            costPrice: Math.round((typeof i.costPrice === 'number' ? i.costPrice : parseFloat(i.costPrice) || 0) * 100) / 100
          })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
          const orderHash = `${item.sellerId || ''}_${item.customerId || 'null'}_${normalizedTotal}_${itemsHash}`;
          if (checkOrderHashPending(orderHash)) return false;
        }
        return isUnsynced;
      });

      if (unsynced.length > 0) {
        unsyncedItemsPerStore.set(storeName, unsynced);
        for (const item of unsynced) {
          let cleanedItem = { ...item };
          if (storeName === 'products' && cleanedItem.category && typeof cleanedItem.category === 'string' && !/^[0-9a-fA-F]{24}$/.test(cleanedItem.category)) delete cleanedItem.category;
          if (storeName === 'purchaseOrders' && cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('PO_')) delete cleanedItem._id;
          if (storeName === 'productBatches' && cleanedItem._id && typeof cleanedItem._id === 'string' && cleanedItem._id.startsWith('batch_')) delete cleanedItem._id;

          allUnsyncedItems.push(cleanedItem);
          idToStoreMap.set(String(item.id), storeName);
        }
        results.storeResults[storeName] = { success: true, synced: 0, failed: 0 };
      }
    }

    if (allUnsyncedItems.length === 0) return results;

    console.log(`[SYNC] 🚀 GROUP SYNC: Sending ${allUnsyncedItems.length} items to ${endpoint} from stores: ${Array.from(unsyncedItemsPerStore.keys()).join(', ')}`);

    try {
      const result = await apiRequest(`/sync/${endpoint}`, {
        method: 'POST',
        body: { sellerId, items: allUnsyncedItems }
      });

      if (!result.success) throw new Error(result.error || result.message || 'Group batch sync failed');

      const responseData = result.data || result;
      const successItems = responseData.results?.success || responseData.success || [];
      const failedItems = responseData.results?.failed || responseData.failed || [];

      // Process Success
      for (const syncedData of successItems) {
        const storeName = idToStoreMap.get(String(syncedData.id));
        const originalItem = unsyncedItemsPerStore.get(storeName)?.find(i => String(i.id) === String(syncedData.id));
        if (!originalItem) continue;

        const storeFuncs = getStoreFuncs(storeName);
        const mongoId = syncedData._id;

        if (originalItem.isDeleted === true && syncedData.action === 'deleted') {
          console.log(`[SYNC] 🗑️ Item confirmed deleted on backend: ${storeName} (${originalItem.id})`);
          if (storeFuncs.deleteItem) await storeFuncs.deleteItem(originalItem.id);
        } else if (mongoId || originalItem._id) {
          const syncedItem = { ...originalItem, _id: mongoId || originalItem._id, isSynced: true, syncedAt: new Date().toISOString() };
          delete syncedItem.isUpdate;

          // STOP ID SWAPPING: Just update the synced item with remote metadata
          // const hasIdChanged = mongoId && String(originalItem.id) !== String(mongoId);
          // if (hasIdChanged) {
          //   console.log(`[SYNC] 🆔 Group ID Swap for ${storeName}: ${originalItem.id} -> ${mongoId}`);
          //   syncedItem.id = mongoId;
          //   syncedItem.localId = originalItem.id;
          //   if (storeFuncs.deleteItem) await storeFuncs.deleteItem(originalItem.id);
          // }

          // Ensure localId is set
          syncedItem.localId = originalItem.localId || originalItem.id;

          await storeFuncs.updateItem(syncedItem);
          if (onItemSyncedCallback) onItemSyncedCallback(storeName, syncedItem);
          console.log(`[SYNC] ✅ Group item confirmed on backend: ${storeName} (${syncedItem.id})`);
        } else {
          console.error(`[SYNC] ❌ Group safeguard triggered: No _id for item ${originalItem.id} in ${storeName}`);
        }
        results.synced++;
        results.storeResults[storeName].synced++;
      }

      // Process Failures
      for (const failedData of failedItems) {
        const storeName = idToStoreMap.get(String(failedData.id));
        const originalItem = unsyncedItemsPerStore.get(storeName)?.find(i => String(i.id) === String(failedData.id));
        if (!originalItem) continue;

        const storeFuncs = getStoreFuncs(storeName);
        const attempts = this.retryAttempts.get(originalItem.id) || 0;
        const failedItem = { ...originalItem, isSynced: false, syncError: failedData.error, syncAttempts: attempts + 1, lastSyncAttempt: new Date().toISOString() };
        await storeFuncs.updateItem(failedItem);
        this.retryAttempts.set(originalItem.id, attempts + 1);
        results.failed++;
        results.storeResults[storeName].failed++;
      }
    } catch (err) {
      console.error(`[SYNC] ❌ Group sync error for ${endpoint}:`, err);
      results.success = false;
      results.error = err.message;
    }

    return results;
  }

  /**
   * Build product ID mapping: frontend ID -> MongoDB _id
   * This is called after products are synced to create a mapping
   */
  async buildProductIdMapping(getAllProducts, productIdMapping) {
    try {
      const products = await getAllProducts();
      // console.log(`[SYNC] Building product ID mapping from ${products.length} products`);

      for (const product of products) {
        // Map frontend ID to MongoDB _id if product is synced
        // Use localId if available (stored during sync), otherwise use id
        const frontendId = product.localId || product.id;
        if (frontendId && product._id && product.isSynced === true) {
          productIdMapping.set(frontendId, product._id);
          // console.log(`[SYNC] Mapped product: ${frontendId} -> ${product._id}`);
        }
      }

      // console.log(`[SYNC] Product ID mapping created with ${productIdMapping.size} entries`);

    } catch (error) {
      console.error('[SYNC] Error building product ID mapping:', error);
    }
  }


  /**
   * Update product batch productId fields before syncing batches
   * Maps temporary frontend product IDs to MongoDB _id values
   */
  async updateProductBatchProductIds(getAllProductBatches, updateProductBatch, productIdMapping) {
    try {
      const productBatches = await getAllProductBatches();
      const unsyncedBatches = productBatches.filter(batch => batch.isSynced !== true);

      // console.log(`[SYNC] Updating ${unsyncedBatches.length} unsynced product batches with mapping size ${productIdMapping.size}`);

      if (unsyncedBatches.length === 0 || productIdMapping.size === 0) {
        return;
      }

      for (const batch of unsyncedBatches) {
        console.log(`[SYNC] Checking batch ${batch.id} with productId: ${batch.productId}`);
        if (batch.productId && productIdMapping.has(batch.productId)) {
          const mongoId = productIdMapping.get(batch.productId);
          console.log(`[SYNC] Updating batch ${batch.id}: ${batch.productId} -> ${mongoId}`);

          // Update the batch with the correct MongoDB product ID
          const updatedBatch = {
            ...batch,
            productId: mongoId
          };

          await updateProductBatch(updatedBatch);
          console.log(`[SYNC] Successfully updated batch ${batch.id}`);
        } else {
          console.log(`[SYNC] No mapping found for batch ${batch.id} with productId: ${batch.productId}`);
        }
      }

    } catch (error) {
      console.error('[SYNC] Error updating product batch productIds:', error);
    }
  }

  /**
   * Update order items' productId fields before syncing orders
   * Maps temporary frontend product IDs to MongoDB _id values
   */
  async updateOrderProductIds(getAllOrders, updateOrder, productIdMapping) {
    try {
      const orders = await getAllOrders();
      const unsyncedOrders = orders.filter(order => order.isSynced !== true);

      if (unsyncedOrders.length === 0 || productIdMapping.size === 0) {

        return;
      }

      let updatedCount = 0;

      for (const order of unsyncedOrders) {
        if (!order.items || !Array.isArray(order.items)) {
          continue;
        }

        let orderUpdated = false;
        const updatedItems = order.items.map(item => {
          // If productId is a string (temporary frontend ID), try to map it
          if (item.productId && typeof item.productId === 'string' && !item.productId.match(/^[0-9a-fA-F]{24}$/)) {
            // This is a temporary frontend ID, try to find the MongoDB _id
            const mongoId = productIdMapping.get(item.productId);
            if (mongoId) {

              orderUpdated = true;
              return { ...item, productId: mongoId };
            } else {
              // Product not found in mapping - might not be synced yet or doesn't exist
              // Set to null to avoid ObjectId cast error

              orderUpdated = true;
              return { ...item, productId: null };
            }
          }
          // If productId is already a valid MongoDB ObjectId string, keep it
          return item;
        });

        if (orderUpdated) {
          const updatedOrder = {
            ...order,
            items: updatedItems
          };
          await updateOrder(updatedOrder);
          updatedCount++;

        }
      }

    } catch (error) {

    }
  }

  /**
   * Batch sync all stores
   */
  async syncAll(getStoreFunctions = null) {
    // Check if a sync is already in progress and return the existing promise
    if (this.currentSyncPromise) {
      console.log('[SYNC] ⏳ Joining existing sync operation...');
      return this.currentSyncPromise;
    }

    // Start a new sync operation and track the promise
    this.currentSyncPromise = this._internalSyncAll(getStoreFunctions)
      .finally(() => {
        this.currentSyncPromise = null;
      });

    return this.currentSyncPromise;
  }

  /**
   * Internal implementation of batch sync
   */
  async _internalSyncAll(getStoreFunctions = null) {
    const getStoreFuncs = getStoreFunctions || getStoreFunctionsProvider;
    if (!getStoreFuncs) {
      return { success: false, error: 'Store functions provider not set' };
    }

    if (this.isSyncing) {
      return { success: false, error: 'Sync in progress' };
    }

    if (!this.isOnline()) {
      return { success: false, error: 'Offline' };
    }

    if (!this.checkProfileStatus()) {
      // console.log('[SYNC] Profile incomplete, skipping backend sync');
      return { success: false, error: 'Profile incomplete' };
    }

    this.isSyncing = true;

    try {
      // Use cached sellerId first (avoid multiple API calls)
      let sellerId = this.getSellerIdFromCache();
      if (!sellerId) {

        // Only call backend if not in cache
        sellerId = await this.getSellerIdFromBackend();
      }
      if (!sellerId) {

        return { success: false, error: 'No seller ID' };
      }

      const results = {};
      let totalSynced = 0;
      let totalFailed = 0;

      // Product ID mapping: frontend ID -> MongoDB _id
      // This is used to update order items' productId after products are synced
      const productIdMapping = new Map();

      // Sync in order: categories -> products -> customers -> orders -> transactions -> refunds -> expenses -> productBatches -> purchaseOrders
      // CRITICAL: We sync orders BEFORE productBatches to avoid double-reduction on the first sync of a new batch.
      // The order sync performs a relative reduction, while batch sync performs an absolute overwrite.
      // Sync in order: categories -> products -> customers -> orders -> transactions -> refunds -> expenses -> customerTransactions -> productBatches -> purchaseOrders -> settings
      // CRITICAL: We sync orders BEFORE productBatches to avoid double-reduction on the first sync of a new batch.
      // The order sync performs a relative reduction, while batch sync performs an absolute overwrite.
      // By processing orders first, the batch sync acts as an idempotent confirmation of the final state.
      let syncOrder = ['categories', 'products', 'dProducts', 'customers', 'suppliers', 'orders', 'transactions', 'refunds', 'expenses', 'customerTransactions', 'supplierTransactions', 'productBatches', 'purchaseOrders', 'planOrders', 'settings'];

      // OPTIMIZATION: If this syncAll call is coming from Billing.js (partial sync context), 
      // we might want to avoid re-triggering productBatches if it's already being handled explicitly.
      // However, syncAll is generally safe to run as it checks isSynced status.
      // The duplicate calls the user sees are likely:
      // 1. Explicit syncStore('productBatches') in Billing.js
      // 2. syncAll() background loop or triggered by syncSuccess event
      // To fix the double-tap, we rely on the fact that the first sync will mark items as synced=true.
      // But if there's a race, both might send.
      // We can't easily detect the caller here, but we can ensure we check status freshly.

      // Group stores by endpoint while maintaining order
      const endpointGroups = [];
      const processedStores = new Set();

      for (const storeName of syncOrder) {
        if (processedStores.has(storeName)) continue;

        const endpoint = this.getEndpointForStore(storeName);
        if (!endpoint) continue;

        // Find all stores in syncOrder that share this endpoint
        const sameEndpointStores = syncOrder.filter(s => this.getEndpointForStore(s) === endpoint);

        endpointGroups.push({
          endpoint,
          stores: sameEndpointStores
        });

        sameEndpointStores.forEach(s => processedStores.add(s));
      }

      for (const group of endpointGroups) {
        const { endpoint, stores } = group;

        // Pre-sync hooks for specific stores if they are in this group
        for (const storeName of stores) {
          const storeFunctions = getStoreFuncs(storeName);
          if (!storeFunctions) {
            console.error(`[SYNC] ❌ Missing store functions for ${storeName}`);
            continue;
          }

          // Debug log for suppliers
          if (storeName === 'suppliers' || storeName === 'supplierTransactions') {
            try {
              const debugItems = await storeFunctions.getAllItems();
              const debugUnsynced = debugItems.filter(i => i.isSynced !== true && i.isSynced !== 'true');
              console.log(`[SYNC DEBUG] ${storeName}: Found ${debugItems.length} total, ${debugUnsynced.length} unsynced`);
            } catch (e) {
              console.error(`[SYNC DEBUG] Error checking ${storeName}:`, e);
            }
          }

          if (storeName === 'products') {
            await this.buildProductIdMapping(storeFunctions.getAllItems, productIdMapping);
          }
          if (storeName === 'orders') {
            await this.updateOrderProductIds(storeFunctions.getAllItems, storeFunctions.updateItem, productIdMapping);
          }
          if (storeName === 'productBatches') {
            await this.updateProductBatchProductIds(storeFunctions.getAllItems, storeFunctions.updateItem, productIdMapping);
          }
        }

        // Perform group sync (or single store sync if group has only 1 store)
        let groupSyncResult;
        if (stores.length > 1) {
          groupSyncResult = await this.syncStoreGroup(endpoint, stores, getStoreFuncs);
        } else {
          const storeName = stores[0];
          const storeFunctions = getStoreFuncs(storeName);
          if (storeFunctions) {
            if (storeName === 'dProducts') {
              console.log(`[SYNC DEBUG] Calling syncStore for dProducts. Unsynced items identified:`,
                (await storeFunctions.getAllItems()).filter(i => i.isSynced !== true && i.isSynced !== 'true').length);
            }
            const syncResult = await this.syncStore(
              storeName,
              storeFunctions.getAllItems,
              storeFunctions.updateItem,
              storeFunctions.deleteItem
            );
            groupSyncResult = {
              success: true,
              synced: syncResult.synced,
              failed: syncResult.failed,
              storeResults: { [storeName]: syncResult }
            };
          } else {
            groupSyncResult = { success: true, synced: 0, failed: 0, storeResults: {} };
          }
        }

        // Post-sync hooks
        for (const storeName of stores) {
          const storeFunctions = getStoreFuncs(storeName);
          if (!storeFunctions) continue;

          const syncResult = groupSyncResult.storeResults[storeName] || { synced: 0, failed: 0 };

          if (storeName === 'products' && syncResult.synced > 0) {
            await this.buildProductIdMapping(storeFunctions.getAllItems, productIdMapping);
          }

          results[storeName] = syncResult;
          totalSynced += syncResult.synced || 0;
          totalFailed += syncResult.failed || 0;
        }
      }

      // Notify UI about sync completion
      // console.log('🔄🔄🔄 SYNC ALL COMPLETED - calling onSyncCompletedCallback:', {
      //   success: totalFailed === 0,
      //   totalSynced,
      //   totalFailed,
      //   resultsSummary: Object.keys(results).reduce((acc, key) => {
      //     acc[key] = { synced: results[key].synced, failed: results[key].failed };
      //     return acc;
      //   }, {})
      // });

      if (onSyncCompletedCallback) {
        // Prepare summary
        const summary = {
          success: true,
          totalSynced,
          totalFailed,
          details: results
        };

        // THROTTLE: If we synced items, wait briefly before triggering the full data refresh.
        // This prevents the "double fetch" race where the UI tries to reload data 
        // while the backend/local DB is still finalizing transactions.
        if (totalSynced > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        onSyncCompletedCallback(summary);
      }

      return {
        success: totalFailed === 0,
        results,
        summary: {
          totalSynced,
          totalFailed
        }
      };
    } catch (error) {

      return { success: false, error: error.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Retry failed syncs
   */
  async retryFailedSyncs(getStoreFunctions = null) {
    const getStoreFuncs = getStoreFunctions || getStoreFunctionsProvider;
    if (!getStoreFuncs) {

      return { success: false, error: 'Store functions provider not set' };
    }
    if (!this.isOnline()) {
      return { success: false, error: 'Offline' };
    }

    // Use cached sellerId first (avoid multiple API calls)
    let sellerId = this.getSellerIdFromCache();
    if (!sellerId) {
      // Only call backend if not in cache
      sellerId = await this.getSellerIdFromBackend();
    }
    if (!sellerId) {
      return { success: false, error: 'No seller ID' };
    }

    // Get all items and find those with sync errors
    const results = {};
    const syncOrder = ['categories', 'products', 'dProducts', 'productBatches', 'customers', 'suppliers', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'expenses', 'customerTransactions', 'supplierTransactions', 'planOrders'];

    for (const storeName of syncOrder) {
      const storeFunctions = getStoreFunctions(storeName);
      if (storeFunctions) {
        try {
          const items = await storeFunctions.getAllItems();
          const failedItems = items.filter(item =>
            item.isSynced === false &&
            item.syncError &&
            (this.retryAttempts.get(item.id) || 0) < this.maxRetries
          );

          if (failedItems.length > 0) {

            results[storeName] = await this.syncStore(
              storeName,
              storeFunctions.getAllItems,
              storeFunctions.updateItem
            );
          }
        } catch (error) {

        }
      }
    }

    return { success: true, results };
  }

  /**
   * Start automatic sync (checks periodically)
   */
  startAutoSync(getStoreFunctions = null, interval = 30000, skipInitialSync = false) {
    const getStoreFuncs = getStoreFunctions || getStoreFunctionsProvider;
    if (!getStoreFuncs) {

      return;
    }

    // Initial sync (skip if backgroundSyncWithBackend already handled it)
    if (!skipInitialSync) {
      this.syncAll(getStoreFuncs);
    }

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      if (this.isOnline() && !this.isSyncing) {
        this.syncAll(getStoreFuncs);
      }
    }, interval);

    // Sync when coming back online
    window.addEventListener('online', () => {

      // Give a small delay to ensure network is fully connected
      setTimeout(() => {
        if (this.isOnline()) {
          this.syncAll(getStoreFuncs).catch(err => {

          });
        }
      }, 1000);
    });
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

// Export singleton instance
export const syncService = new SyncService();
export default syncService;
