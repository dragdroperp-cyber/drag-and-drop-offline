/**
 * Sync Service - Handles synchronization between IndexedDB and Backend
 * - Checks for items with isSynced: false
 * - Verifies online status
 * - Sends data to backend
 * - Marks successfully synced items
 * - Retries failed syncs
 */

import { API_BASE_URL, apiRequest, getSellerId } from '../utils/api';

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

export const setStoreFunctionsProvider = (provider) => {
  getStoreFunctionsProvider = provider;
};

class SyncService {
  constructor() {
    this.isSyncing = false;
    this.syncQueue = [];
    this.retryAttempts = new Map(); // Track retry attempts per item
    this.maxRetries = 3;
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
      console.error('Error getting seller ID:', error);
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
      console.error('Error getting sellerId from cache:', error);
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
      console.error('Error getting seller from backend:', error);
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

      console.log(`[SYNC] 📤 Sending ${storeName} item to /sync/${endpoint}`, {
        itemId: item.id,
        sellerId: sellerId,
        endpoint: `/sync/${endpoint}`
      });

      const result = await apiRequest(`/sync/${endpoint}`, {
        method: 'POST',
        body: {
          sellerId,
          items: [item]
        }
      });

      console.log(`[SYNC] 📥 API response for ${storeName} item ${item.id}:`, result);

      if (!result.success) {
        console.error(`[SYNC] ❌ API request failed for ${storeName} item ${item.id}:`, result);
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
      console.error(`[SYNC] ❌ Error syncing item ${item.id} from ${storeName}:`, error);
      console.error(`[SYNC] Error details:`, {
        message: error.message,
        stack: error.stack,
        storeName: storeName,
        itemId: item.id
      });
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
      orders: 'orders',
      transactions: 'transactions',
      purchaseOrders: 'vendor-orders',
      categories: 'categories'
    };
    return endpointMap[storeName];
  }

  /**
   * Sync all unsynced items from a store
   */
  async syncStore(storeName, getAllItems, updateItem, deleteItem = null) {
    try {
      const items = await getAllItems();
      
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
            console.log(`[SYNC] ⏸️ ${storeName}: Skipping order ${item.id} - currently being processed via direct API call`);
            return false; // Skip this order
          }
        }
        
        return isUnsynced;
      });
      
      // Log deleted items separately for debugging
      const deletedItems = unsyncedItems.filter(item => item.isDeleted === true);
      if (deletedItems.length > 0) {
        console.log(`[SYNC] 🗑️ ${storeName}: Found ${deletedItems.length} deleted items to sync`);
        deletedItems.forEach(item => {
          console.log(`[SYNC] 🗑️ Deleted item: ${item.id}, _id: ${item._id || 'none'}, will be deleted on backend`);
        });
      }

      console.log(`[SYNC] ${storeName}: Found ${unsyncedItems.length} unsynced items out of ${items.length} total`);
      if (storeName === 'purchaseOrders') {
        console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: Total items: ${items.length}`);
        console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: Unsynced items: ${unsyncedItems.length}`);
        console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: All items details:`, items.map(i => ({ 
          id: i.id, 
          supplierName: i.supplierName || i.id, 
          isSynced: i.isSynced,
          isSyncedType: typeof i.isSynced,
          isSyncedValue: i.isSynced
        })));
        if (unsyncedItems.length > 0) {
          console.log(`[SYNC] 🔍 PURCHASE ORDERS DEBUG: Unsynced items details:`, unsyncedItems.map(i => ({ 
            id: i.id, 
            supplierName: i.supplierName || i.id, 
            isSynced: i.isSynced,
            isSyncedType: typeof i.isSynced
          })));
        }
      }
      console.log(`[SYNC] ${storeName}: All items isSynced status:`, items.map(i => ({ id: i.id, name: i.name || i.supplierName || i.id, isSynced: i.isSynced })));
      
      if (unsyncedItems.length > 0) {
        console.log(`[SYNC] ${storeName} unsynced items details:`, unsyncedItems.map(i => ({ 
          id: i.id, 
          name: i.name || i.id, 
          isSynced: i.isSynced,
          isSyncedType: typeof i.isSynced
        })));
      } else {
        console.log(`[SYNC] ${storeName}: All items are synced (isSynced === true)`);
      }

      if (unsyncedItems.length === 0) {
        return { success: true, synced: 0, failed: 0 };
      }

      // Use cached sellerId first (avoid multiple API calls)
      let sellerId = this.getSellerIdFromCache();
      if (!sellerId) {
        // Only call backend if not in cache
        sellerId = await this.getSellerIdFromBackend();
      }
      if (!sellerId) {
        console.warn('No seller ID available, skipping sync');
        return { success: false, error: 'No seller ID' };
      }

      const results = { success: [], failed: [] };

      for (const item of unsyncedItems) {
        try {
          console.log(`[SYNC] 🔄 Syncing ${storeName} item:`, item.id, 'isSynced:', item.isSynced);
          if (storeName === 'purchaseOrders') {
            console.log(`[SYNC] 🔍 PURCHASE ORDER SYNC: Item ID: ${item.id}, Supplier: ${item.supplierName}, isSynced: ${item.isSynced}`);
            console.log(`[SYNC] 🔍 PURCHASE ORDER SYNC: Full item data:`, JSON.stringify(item, null, 2));
          } else {
            console.log(`[SYNC] Item data:`, JSON.stringify(item, null, 2));
          }
          
          const result = await this.syncItem(storeName, item, sellerId);
          
          console.log(`[SYNC] Sync response for ${storeName} item ${item.id}:`, result);
          if (storeName === 'purchaseOrders') {
            console.log(`[SYNC] 🔍 PURCHASE ORDER SYNC RESPONSE:`, JSON.stringify(result, null, 2));
          }
          
          // Check response format - backend returns { success: true, results: { success: [...], failed: [...] } }
          if (result && result.success !== false) {
            const resultsData = result.results || result;
            const successItems = resultsData.success || [];
            
            if (successItems.length > 0) {
              // Find the synced item by matching id
              const syncedItemData = successItems.find(si => si.id === item.id) || successItems[0];
              
              // Check if this was a deletion
              if (item.isDeleted === true && syncedItemData.action === 'deleted') {
                // Item was successfully deleted on backend - remove from IndexedDB
                console.log(`[SYNC] 🗑️ Item ${item.id} was deleted on backend, removing from IndexedDB`);
                if (deleteItem) {
                  await deleteItem(item.id);
                  console.log(`[SYNC] ✅ Deleted item ${item.id} from IndexedDB after successful backend deletion`);
                }
                results.success.push(item.id);
                this.retryAttempts.delete(item.id);
                console.log(`[SYNC] ✅ Successfully deleted ${storeName} item:`, item.id);
              } else {
                // Normal sync (create or update)
                // Mark item as synced
                const syncedItem = {
                  ...item,
                  isSynced: true,
                  syncedAt: new Date().toISOString(),
                  _id: syncedItemData._id // Store backend ID
                };
                
                // Remove isDeleted flag if it was set (for items that were deleted but then re-added)
                if (syncedItem.isDeleted) {
                  delete syncedItem.isDeleted;
                  delete syncedItem.deletedAt;
                }
                
                // Remove isUpdate flag after successful sync
                if (syncedItem.isUpdate) {
                  delete syncedItem.isUpdate;
                }
                
                console.log(`[SYNC] Updating item ${item.id} in IndexedDB with isSynced: true, _id: ${syncedItemData._id}`);
                await updateItem(syncedItem);
                console.log(`[SYNC] ✅ Item ${item.id} marked as synced in IndexedDB`);
                
                // Notify AppContext to update state immediately
                if (onItemSyncedCallback) {
                  onItemSyncedCallback(storeName, syncedItem);
                }
                
                results.success.push(item.id);
                this.retryAttempts.delete(item.id); // Clear retry count
                console.log(`[SYNC] ✅ Successfully synced ${storeName} item:`, item.id);
              }
            } else {
              const failedItems = resultsData.failed || [];
              const errorMsg = failedItems.find(f => f.id === item.id)?.error || result.message || result.error || 'Sync failed - no success items';
              console.error(`[SYNC] ❌ Sync failed for ${storeName} item ${item.id}:`, errorMsg);
              throw new Error(errorMsg);
            }
          } else {
            const errorMsg = result?.message || result?.error || 'Sync failed';
            console.error(`[SYNC] ❌ Sync failed for ${storeName} item ${item.id}:`, errorMsg);
            throw new Error(errorMsg);
          }
        } catch (error) {
          console.error(`[SYNC] ❌ Failed to sync ${storeName} item ${item.id}:`, error.message);
          // Track retry attempts
          const attempts = this.retryAttempts.get(item.id) || 0;
          
          // Mark item with sync error for retry
          const failedItem = {
            ...item,
            isSynced: false,
            syncError: error.message,
            syncAttempts: attempts + 1
          };
          await updateItem(failedItem);
          
          if (attempts < this.maxRetries) {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: error.message, retry: true });
          } else {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: error.message, retry: false });
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
      console.error(`Error syncing store ${storeName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Batch sync all stores
   */
  async syncAll(getStoreFunctions = null) {
    const getStoreFuncs = getStoreFunctions || getStoreFunctionsProvider;
    if (!getStoreFuncs) {
      console.error('[SYNC] Store functions provider not set');
      return { success: false, error: 'Store functions provider not set' };
    }
    if (this.isSyncing) {
      console.log('[SYNC] Sync already in progress, skipping...');
      return { success: false, error: 'Sync in progress' };
    }

    if (!this.isOnline()) {
      console.log('[SYNC] Offline, cannot sync');
      return { success: false, error: 'Offline' };
    }

    console.log('[SYNC] ========== Starting sync to MongoDB ==========');
    this.isSyncing = true;

    try {
      // Use cached sellerId first (avoid multiple API calls)
      let sellerId = this.getSellerIdFromCache();
      if (!sellerId) {
        console.log('[SYNC] SellerId not in cache, fetching from backend...');
        // Only call backend if not in cache
        sellerId = await this.getSellerIdFromBackend();
      }
      if (!sellerId) {
        console.error('[SYNC] No seller ID available');
        return { success: false, error: 'No seller ID' };
      }
      console.log('[SYNC] Using sellerId:', sellerId);

      const results = {};
      let totalSynced = 0;
      let totalFailed = 0;

      // Sync in order: categories -> products -> customers -> orders -> transactions -> vendorOrders
      const syncOrder = ['categories', 'products', 'customers', 'orders', 'transactions', 'purchaseOrders'];

      for (const storeName of syncOrder) {
        const storeFunctions = getStoreFuncs(storeName);
        if (storeFunctions) {
          console.log(`[SYNC] 🔄 Syncing ${storeName}...`);
          console.log(`[SYNC] Store functions available:`, {
            getAllItems: typeof storeFunctions.getAllItems,
            updateItem: typeof storeFunctions.updateItem,
            deleteItem: typeof storeFunctions.deleteItem
          });
          
          const syncResult = await this.syncStore(
            storeName,
            storeFunctions.getAllItems,
            storeFunctions.updateItem,
            storeFunctions.deleteItem
          );
          results[storeName] = syncResult;
          totalSynced += syncResult.synced || 0;
          totalFailed += syncResult.failed || 0;
          
          if (syncResult.synced > 0) {
            console.log(`[SYNC] ✅ ${storeName}: ${syncResult.synced} items synced successfully`);
          }
          if (syncResult.failed > 0) {
            console.log(`[SYNC] ⚠️ ${storeName}: ${syncResult.failed} items failed to sync`);
            if (syncResult.failedItems) {
              console.log(`[SYNC] Failed items:`, syncResult.failedItems);
            }
          }
          if (syncResult.synced === 0 && syncResult.failed === 0) {
            console.log(`[SYNC] ℹ️ ${storeName}: No items to sync`);
            if (storeName === 'purchaseOrders') {
              console.log(`[SYNC] ⚠️ PURCHASE ORDERS: No items synced - check if items have isSynced: false`);
            }
          }
        } else {
          console.warn(`[SYNC] ⚠️ No store functions found for ${storeName}`);
          if (storeName === 'purchaseOrders') {
            console.error(`[SYNC] ❌ PURCHASE ORDERS: Store functions not found! Check getStoreFunctions implementation.`);
          }
        }
      }

      console.log(`[SYNC] ========== Sync Complete ==========`);
      console.log(`[SYNC] Total synced: ${totalSynced}, Total failed: ${totalFailed}`);

      return {
        success: totalFailed === 0,
        results,
        summary: {
          totalSynced,
          totalFailed
        }
      };
    } catch (error) {
      console.error('[SYNC] ❌ Error in batch sync:', error);
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
      console.error('Store functions provider not set');
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
    const syncOrder = ['categories', 'products', 'customers', 'orders', 'transactions', 'purchaseOrders'];

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
            console.log(`Retrying ${failedItems.length} failed items in ${storeName}...`);
            results[storeName] = await this.syncStore(
              storeName,
              storeFunctions.getAllItems,
              storeFunctions.updateItem
            );
          }
        } catch (error) {
          console.error(`Error retrying ${storeName}:`, error);
        }
      }
    }

    return { success: true, results };
  }

  /**
   * Start automatic sync (checks periodically)
   */
  startAutoSync(getStoreFunctions = null, interval = 30000) {
    const getStoreFuncs = getStoreFunctions || getStoreFunctionsProvider;
    if (!getStoreFuncs) {
      console.error('Store functions provider not set');
      return;
    }
    
    // Initial sync
    this.syncAll(getStoreFuncs);

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      if (this.isOnline() && !this.isSyncing) {
        this.syncAll(getStoreFuncs);
      }
    }, interval);

    // Sync when coming back online
    window.addEventListener('online', () => {
      console.log('🌐 Back online event detected, triggering sync...');
      // Give a small delay to ensure network is fully connected
      setTimeout(() => {
        if (this.isOnline()) {
          this.syncAll(getStoreFuncs).catch(err => {
            console.error('Error syncing after coming online:', err);
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

