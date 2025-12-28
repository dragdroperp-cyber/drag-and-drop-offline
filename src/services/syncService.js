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
      expenses: 'expenses'
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

            return false; // Skip this order
          }
        }

        return isUnsynced;
      });

      // Log deleted items separately for debugging
      const deletedItems = unsyncedItems.filter(item => item.isDeleted === true);
      if (deletedItems.length > 0) {

        deletedItems.forEach(item => {

        });
      }

      if (storeName === 'purchaseOrders') {

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
      //(`[SYNC] ${storeName}: All items isSynced status:`, items.map(i => ({ id: i.id, name: i.name || i.supplierName || i.id, isSynced: i.isSynced })));

      if (unsyncedItems.length > 0) {
        console.log(`[SYNC] ${storeName} unsynced items details:`, unsyncedItems.map(i => ({
          id: i.id,
          name: i.name || i.id,
          isSynced: i.isSynced,
          isSyncedType: typeof i.isSynced
        })));
      } else {
        //(`[SYNC] ${storeName}: All items are synced (isSynced === true)`);
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

        return { success: false, error: 'No seller ID' };
      }

      const results = { success: [], failed: [] };

      for (const item of unsyncedItems) {
        try {

          if (storeName === 'orders') {

            //(`[SYNC] 🧾 ORDER SYNC: Full item data:`, JSON.stringify(item, null, 2));
          } else if (storeName === 'purchaseOrders') {

            //(`[SYNC] 🔍 PURCHASE ORDER SYNC: Full item data:`, JSON.stringify(item, null, 2));
          } else {
            //(`[SYNC] Item data:`, JSON.stringify(item, null, 2));
          }

          const result = await this.syncItem(storeName, item, sellerId);

          if (storeName === 'purchaseOrders') {
            //(`[SYNC] 🔍 PURCHASE ORDER SYNC RESPONSE:`, JSON.stringify(result, null, 2));
          }

          // Check response format - backend returns { success: true, results: { success: [...], failed: [...] } }
          // Be more strict: only proceed if we get a clear success response and results
          if (result && result.success === true && (result.results || result.data?.results)) {
            const resultsData = result.results || result;
            const successItems = resultsData.success || [];

            if (successItems.length > 0) {
              // Find the synced item by matching id - ensure this specific item was successfully synced
              const syncedItemData = successItems.find(si => si.id === item.id);

              if (!syncedItemData || syncedItemData.action === 'skipped') {
                // This specific item was not in the success list or was skipped, treat as failed/unsynced
                console.warn(`[SYNC] Item ${item.id} was ${syncedItemData ? 'skipped' : 'not found'} in backend response for ${storeName}`);
                results.failed.push({ id: item.id, error: 'Item skipped or not processed' });
                continue;
              }

              // Check if this was a deletion
              if (item.isDeleted === true && syncedItemData.action === 'deleted') {
                // Item was successfully deleted on backend - remove from IndexedDB

                if (deleteItem) {
                  await deleteItem(item.id);

                }
                results.success.push(item.id);
                this.retryAttempts.delete(item.id);

                // Don't notify UI about deletion - UI was already updated when delete was initiated
                // The item should remain removed from UI state
              } else {
                if (storeName === 'purchaseOrders') {
                  // For purchase orders, keep local data and just mark as synced
                  // Don't merge server response to avoid overwrites
                  const syncedItem = {
                    ...item,
                    isSynced: true,
                    syncedAt: new Date().toISOString()
                  };

                  await updateItem(syncedItem);
                  results.success.push(item.id);
                  this.retryAttempts.delete(item.id);

                  // Notify UI that purchase order was synced
                  if (onItemSyncedCallback) {
                    onItemSyncedCallback(storeName, syncedItem);
                  }
                } else {
                  // Normal sync (create or update) for other stores
                  // Mark item as synced
                  const mongoId = syncedItemData._id;
                  const hasIdChanged = mongoId && item.id !== mongoId;

                  const syncedItem = {
                    ...item,
                    isSynced: true,
                    syncedAt: new Date().toISOString(),
                    _id: mongoId || item._id // Preserve existing _id or use new one, but don't fallback to temporary id
                  };

                  if (hasIdChanged) {
                    // Update main ID to match MongoDB ID (this changes the key in IndexedDB)
                    syncedItem.id = mongoId;
                    // Preserve local ID explicitly for mapping purposes
                    syncedItem.localId = item.id;

                    console.log(`[SYNC] 🔄 Swapping temp ID ${item.id} with Mongo ID ${mongoId} for ${storeName}`);
                  }

                  // Remove isDeleted flag if it was set (for items that were deleted but then re-added)
                  if (syncedItem.isDeleted) {
                    delete syncedItem.isDeleted;
                    delete syncedItem.deletedAt;
                  }

                  // Remove isUpdate flag after successful sync
                  if (syncedItem.isUpdate) {
                    delete syncedItem.isUpdate;
                  }

                  // If ID changed, delete the old record (with temp ID) first
                  if (hasIdChanged && deleteItem) {
                    try {
                      await deleteItem(item.id);
                    } catch (delErr) {
                      console.warn(`[SYNC] Failed to delete temp item ${item.id}:`, delErr);
                    }
                  }

                  // Update/Add the synced item
                  // If ID changed, this effectively adds the new record
                  await updateItem(syncedItem);

                  results.success.push(item.id);
                  this.retryAttempts.delete(item.id);

                  console.log(`✅ SYNC SUCCESS: ${storeName} item ${syncedItem.id} marked as synced`, {
                    itemId: syncedItem.id,
                    itemName: syncedItem.name || syncedItem.id,
                    isSynced: syncedItem.isSynced,
                    syncedAt: syncedItem.syncedAt
                  });

                  // Notify AppContext to update state immediately
                  if (onItemSyncedCallback) {
                    onItemSyncedCallback(storeName, syncedItem);
                  }

                  // Dispatch custom event for UI feedback
                  if (typeof window !== 'undefined' && window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('syncSuccess', {
                      detail: { storeName, item: syncedItem }
                    }));
                  }
                }
              }
            } else {
              const failedItems = resultsData.failed || [];
              const failedItem = failedItems.find(f => f.id === item.id);
              const errorMsg = failedItem?.error || result.message || result.error || 'Sync failed - no success items';

              throw new Error(errorMsg);
            }
          } else {
            const errorMsg = result?.message || result?.error || 'Sync failed';

            throw new Error(errorMsg);
          }
        } catch (error) {

          // Track retry attempts
          const attempts = this.retryAttempts.get(item.id) || 0;

          // IMPORTANT: Keep item in IndexedDB - never delete on sync failure
          // Only mark with sync error for retry
          const failedItem = {
            ...item,
            isSynced: false, // Keep as unsynced
            syncError: error.message,
            syncAttempts: attempts + 1,
            lastSyncAttempt: new Date().toISOString()
          };

          // Update item in IndexedDB to track the error, but keep it there
          try {
            await updateItem(failedItem);
            //(`[SYNC] ✅ Item ${item.id} updated in IndexedDB with sync error (will retry later)`);
          } catch (updateError) {

            // Don't throw - we want to continue with other items
          }

          if (attempts < this.maxRetries) {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: error.message, retry: true });
          } else {
            this.retryAttempts.set(item.id, attempts + 1);
            results.failed.push({ id: item.id, error: error.message, retry: false });
            console.warn(`[SYNC] ⚠️ Item ${item.id} has exceeded max retry attempts (${this.maxRetries}). It will remain in IndexedDB but sync will not be retried automatically.`);
          }

          console.log(`❌ SYNC FAILED: ${storeName} item ${item.id} failed to sync`, {
            itemId: item.id,
            itemName: item.name || item.id,
            isSynced: failedItem.isSynced,
            error: error.message,
            attempts: attempts + 1
          });

          // Dispatch custom event for UI feedback on sync failure
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('syncFailed', {
              detail: { storeName, item: failedItem, error: error.message }
            }));
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
   * Build product ID mapping: frontend ID -> MongoDB _id
   * This is called after products are synced to create a mapping
   */
  async buildProductIdMapping(getAllProducts, productIdMapping) {
    try {
      const products = await getAllProducts();
      console.log(`[SYNC] Building product ID mapping from ${products.length} products`);

      for (const product of products) {
        // Map frontend ID to MongoDB _id if product is synced
        // Use localId if available (stored during sync), otherwise use id
        const frontendId = product.localId || product.id;
        if (frontendId && product._id && product.isSynced === true) {
          productIdMapping.set(frontendId, product._id);
          console.log(`[SYNC] Mapped product: ${frontendId} -> ${product._id}`);
        }
      }

      console.log(`[SYNC] Product ID mapping created with ${productIdMapping.size} entries`);

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

      console.log(`[SYNC] Updating ${unsyncedBatches.length} unsynced product batches with mapping size ${productIdMapping.size}`);

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
      // By processing orders first, the batch sync acts as an idempotent confirmation of the final state.
      const syncOrder = ['categories', 'products', 'customers', 'orders', 'transactions', 'refunds', 'expenses', 'productBatches', 'purchaseOrders'];

      for (const storeName of syncOrder) {
        const storeFunctions = getStoreFuncs(storeName);
        if (storeFunctions) {

          // Before syncing products, build initial mapping from already-synced products
          if (storeName === 'products') {
            await this.buildProductIdMapping(storeFunctions.getAllItems, productIdMapping);
          }

          // Before syncing orders, update productId references using the mapping
          if (storeName === 'orders') {
            await this.updateOrderProductIds(storeFunctions.getAllItems, storeFunctions.updateItem, productIdMapping);
          }

          const syncResult = await this.syncStore(
            storeName,
            storeFunctions.getAllItems,
            storeFunctions.updateItem,
            storeFunctions.deleteItem
          );

          // After products sync, rebuild the mapping to include newly synced products
          if (storeName === 'products' && syncResult.synced > 0) {
            // Rebuild mapping from IndexedDB (products should now have _id after sync)
            await this.buildProductIdMapping(storeFunctions.getAllItems, productIdMapping);
          }

          // Before syncing product batches, update their productId references
          if (storeName === 'products') {
            // Update product batch productIds using the mapping
            const productBatchStoreFunctions = getStoreFuncs('productBatches');
            if (productBatchStoreFunctions) {
              await this.updateProductBatchProductIds(
                productBatchStoreFunctions.getAllItems,
                productBatchStoreFunctions.updateItem,
                productIdMapping
              );
            }
          }


          results[storeName] = syncResult;
          totalSynced += syncResult.synced || 0;
          totalFailed += syncResult.failed || 0;

          if (syncResult.synced > 0) {

          }
          if (syncResult.failed > 0) {

            if (syncResult.failedItems) {

            }
          }
          if (syncResult.synced === 0 && syncResult.failed === 0) {

            if (storeName === 'purchaseOrders') {

            }
          }
        } else {

          if (storeName === 'purchaseOrders') {

          }
        }
      }

      // Notify UI about sync completion
      console.log('🔄🔄🔄 SYNC ALL COMPLETED - calling onSyncCompletedCallback:', {
        success: totalFailed === 0,
        totalSynced,
        totalFailed,
        resultsSummary: Object.keys(results).reduce((acc, key) => {
          acc[key] = { synced: results[key].synced, failed: results[key].failed };
          return acc;
        }, {})
      });

      if (onSyncCompletedCallback) {
        onSyncCompletedCallback({
          success: totalFailed === 0,
          totalSynced,
          totalFailed,
          results
        });
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
    const syncOrder = ['categories', 'products', 'productBatches', 'customers', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'expenses'];

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
