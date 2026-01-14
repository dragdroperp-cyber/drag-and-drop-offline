/**
 * Data Fetcher Utility
 * Fetches data from backend MongoDB when online, or from IndexedDB when offline
 * 
 * Features:
 * - Request deduplication to prevent duplicate API calls
 * - Smart caching for frequently accessed data
 * - Offline-first with IndexedDB fallback
 */

import { apiRequest } from './api';
import {
  getAllItems,
  updateItem,
  clearAllItems,
  addMultipleItems,
  STORES,
  isIndexedDBAvailable,
  getLastFetchTimesForAPI,
  updateLastFetchTime,
  updateMultipleItems,
  initializeSyncTracking,
  getAllSyncTracking,
  getSyncTracking,
  cleanupDuplicateProductBatches,
  cleanupDuplicatePurchaseOrders,
  deleteItem
} from './indexedDB';
import { cleanupDuplicateCustomers } from './cleanupUtils';

// ==================== REQUEST DEDUPLICATION ====================
// Track in-flight API requests to prevent duplicates
const pendingRequests = new Map();

// ==================== REFRESH PROGRESS TRACKING ====================
const refreshProgressCallbacks = new Set();

/**
 * Register callback for refresh progress updates
 */
export const registerRefreshProgressCallback = (callback) => {
  refreshProgressCallbacks.add(callback);
  return () => refreshProgressCallbacks.delete(callback);
};

/**
 * Notify all listeners about refresh progress
 * @param {number} progress - Percentage (0-100)
 * @param {string} message - Status message
 */
export const notifyRefreshProgress = (progress, message) => {
  refreshProgressCallbacks.forEach(callback => {
    try {
      callback({ progress, message });
    } catch (e) {
      console.error('Error in refresh progress callback:', e);
    }
  });
};

/**
 * Register background sync task with Service Worker
 * Call this whenever valid data is saved locally that needs to be synced
 */
export const registerBackgroundSync = async () => {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-data');
      console.log('🔄 Background sync registered successfully');
    }
  } catch (error) {
    console.warn('⚠️ Background sync registration failed:', error);
  }
};

/**
 * Deduplicate API requests - if same request is in flight, return the pending promise
 * This prevents multiple simultaneous calls to the same endpoint
 */
const deduplicateRequest = async (key, requestFn) => {
  // Check if request is already in flight
  if (pendingRequests.has(key)) {
    console.log(`🔄 DEDUPLICATE: Request "${key}" already in flight, returning existing promise`);
    return pendingRequests.get(key);
  }

  console.log(`🔄 DEDUPLICATE: Starting new request "${key}"`);
  // Execute the request and store the promise
  const promise = requestFn()
    .finally(() => {
      // Remove from pending requests when done
      pendingRequests.delete(key);
      console.log(`🔄 DEDUPLICATE: Request "${key}" completed and removed from pending`);
    });

  pendingRequests.set(key, promise);
  return promise;
};

/**
 * Clear all pending requests (useful for cleanup or testing)
 */
export const clearPendingRequests = () => {
  pendingRequests.clear();

};
// ==================== END REQUEST DEDUPLICATION ====================

/**
 * Normalize customer data - ensure all fields are present for backward compatibility
 */
const normalizeCustomer = (customer) => {
  if (!customer) return customer;

  // Ensure both dueAmount (MongoDB) and balanceDue (frontend compatibility) are set
  // Handle both number and string types, convert to number
  let dueAmount = 0;
  if (customer.dueAmount !== undefined && customer.dueAmount !== null) {
    dueAmount = typeof customer.dueAmount === 'number' ? customer.dueAmount : parseFloat(customer.dueAmount) || 0;
  } else if (customer.balanceDue !== undefined && customer.balanceDue !== null) {
    dueAmount = typeof customer.balanceDue === 'number' ? customer.balanceDue : parseFloat(customer.balanceDue) || 0;
  }

  // Ensure mobileNumber is set (prefer mobileNumber over phone)
  const mobileNumber = customer.mobileNumber || customer.phone || '';

  // Create normalized customer with both fields
  const normalizedCustomer = {
    ...customer,
    dueAmount: dueAmount, // MongoDB uses dueAmount
    balanceDue: dueAmount, // Frontend compatibility - ensure balanceDue is always set for UI display
    mobileNumber: mobileNumber
  };

  // Log only if there's a mismatch (for debugging)
  if ((customer.dueAmount !== undefined && customer.balanceDue === undefined) ||
    (customer.balanceDue !== undefined && customer.dueAmount === undefined)) {
    console.log('Normalized customer (fixed missing field):', {
      id: normalizedCustomer.id,
      name: normalizedCustomer.name,
      dueAmount: normalizedCustomer.dueAmount,
      balanceDue: normalizedCustomer.balanceDue
    });
  }

  return normalizedCustomer;
};

/**
 * Normalize product data - ensure both MongoDB fields (stock, costPrice) and frontend compatibility fields (quantity, unitPrice) exist
 * MongoDB uses 'stock' and 'costPrice', but frontend may use 'quantity' and 'unitPrice' for compatibility
 */
const normalizeProduct = (product) => {
  if (!product) return product;

  // Ensure both stock (MongoDB) and quantity (frontend compatibility) are set
  const stock = product.stock !== undefined ? product.stock : (product.quantity !== undefined ? product.quantity : 0);

  // Ensure both costPrice (MongoDB) and unitPrice (frontend compatibility) are set
  const costPrice = product.costPrice !== undefined ? product.costPrice : (product.unitPrice !== undefined ? product.unitPrice : 0);

  // Ensure category is preserved from nested object if needed
  let category = (product.category && product.category !== 'undefined') ? product.category : '-';
  if ((category === '-' || !category) && product.categoryId && typeof product.categoryId === 'object' && product.categoryId.name) {
    category = product.categoryId.name;
  }

  // Deduplicate batches inside product - prevents duplicate entries in UI
  const productBatches = product.batches || [];
  const dedupedBatches = [];
  const seenBatchKeys = new Set();

  productBatches.forEach(batch => {
    if (!batch) return;
    // Create unique key based on productId and batchNumber
    const key = `${batch.productId}_${(batch.batchNumber || '').trim().toLowerCase()}`;
    // Also consider ID/mongoID as unique keys if they exist
    const idKey = batch.id || batch._id;

    if (!seenBatchKeys.has(key) && (!idKey || !seenBatchKeys.has(idKey))) {
      // Ensure batch has productId (inherit from parent if missing)
      if (!batch.productId) {
        batch.productId = product._id || product.id;
      }
      // Ensure batch has sellerId
      if (!batch.sellerId && product.sellerId) {
        batch.sellerId = product.sellerId;
      }

      dedupedBatches.push(batch);
      seenBatchKeys.add(key);
      if (idKey) seenBatchKeys.add(idKey);
    }
  });

  return {
    ...product,
    batches: dedupedBatches,
    category: category,
    categoryId: (product.categoryId && typeof product.categoryId === 'object') ? product.categoryId._id || product.categoryId.id : product.categoryId,
    stock: stock,
    quantity: stock, // Frontend compatibility
    costPrice: costPrice,
    unitPrice: costPrice, // Frontend compatibility
    // Ensure sellingUnitPrice exists (MongoDB field)
    sellingUnitPrice: product.sellingUnitPrice || product.sellingPrice || 0,
    sellingPrice: product.sellingUnitPrice || product.sellingPrice || 0, // Backward compatibility
    trackExpiry: product.trackExpiry || false
  };
};

const normalizeProductBatch = (batch) => {
  if (!batch) return batch;

  // Fix productId - if it's an object or string with object notation, extract the actual ID
  let productId = batch.productId;

  if (typeof productId === 'object' && productId._id) {
    // Handle object format
    productId = productId._id.toString();
  } else if (typeof productId === 'string') {
    // Handle string formats
    if (productId.trim().startsWith('{') && productId.includes('_id')) {
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(productId);
        if (parsed._id) {
          productId = parsed._id.toString();
        }
      } catch (e) {
        // Try regex patterns for malformed strings
        let match = productId.match(/ObjectId\("([^"]+)"\)/);
        if (match) {
          productId = match[1];
        } else {
          match = productId.match(/ObjectId\\\("([^"]+)"\\\)/);
          if (match) {
            productId = match[1];
          } else {
            const altMatch = productId.match(/_id:\s*new ObjectId\("([^"]+)"\)/);
            if (altMatch) {
              productId = altMatch[1];
            } else {
              const escAltMatch = productId.match(/_id:\s*new ObjectId\\\("([^"]+)"\\\)/);
              if (escAltMatch) {
                productId = escAltMatch[1];
              }
            }
          }
        }
      }
    }
  }

  return {
    ...batch,
    // Ensure all required fields are present with defaults
    batchNumber: batch.batchNumber || '',
    mfg: batch.mfg || null,
    expiry: batch.expiry || null,
    quantity: batch.quantity || 0,
    costPrice: batch.costPrice || 0,
    sellingUnitPrice: batch.sellingUnitPrice || 0,
    productId: productId,
    sellerId: batch.sellerId || null,
    isDeleted: batch.isDeleted || false,
    createdAt: batch.createdAt || new Date().toISOString(),
    updatedAt: batch.updatedAt || new Date().toISOString()
  };
};

/**
 * Compare two data items to see if they have meaningful differences
 * @param {Object} item1 - First item to compare
 * @param {Object} item2 - Second item to compare
 * @param {string} dataType - Type of data (customers, products, orders, etc.)
 * @returns {boolean} - True if items are different, false if same
 */
const compareDataItems = (item1, item2, dataType) => {
  // Always compare updatedAt first - if server has newer data, consider it changed
  if (item1.updatedAt !== item2.updatedAt) {
    return true;
  }

  // Compare type-specific fields
  switch (dataType) {
    case 'dProducts':
      return (
        item1.pCode !== item2.pCode ||
        item1.productName !== item2.productName ||
        item1.unit !== item2.unit ||
        item1.taxPercentage !== item2.taxPercentage
      );

    case 'customers':
      return (
        item1.name !== item2.name ||
        item1.email !== item2.email ||
        item1.mobileNumber !== item2.mobileNumber ||
        item1.dueAmount !== item2.dueAmount ||
        item1.balanceDue !== item2.balanceDue
      );

    case 'products':
      return (
        item1.name !== item2.name ||
        item1.stock !== item2.stock ||
        item1.costPrice !== item2.costPrice ||
        item1.sellingPrice !== item2.sellingPrice ||
        item1.category !== item2.category ||
        item1.trackExpiry !== item2.trackExpiry
      );

    case 'productBatches':
      return (
        item1.batchNumber !== item2.batchNumber ||
        item1.mfg !== item2.mfg ||
        item1.expiry !== item2.expiry ||
        item1.quantity !== item2.quantity ||
        item1.costPrice !== item2.costPrice ||
        item1.sellingUnitPrice !== item2.sellingUnitPrice ||
        item1.productId !== item2.productId
      );

    case 'orders':
      // For orders, check if they're the same order by comparing key fields
      // Orders can have same content but different sync status
      const sameOrder = (
        (item1.id && item2.id && item1.id === item2.id) ||
        (item1._id && item2._id && item1._id === item2._id) ||
        (item1.createdAt && item2.createdAt && item1.createdAt === item2.createdAt &&
          item1.total === item2.total && item1.customerName === item2.customerName)
      );

      if (!sameOrder) {
        return true; // Different orders
      }

      // Same order - check if important fields changed
      return (
        item1.total !== item2.total ||
        item1.status !== item2.status ||
        item1.customerName !== item2.customerName ||
        item1.isSynced !== item2.isSynced ||
        JSON.stringify(item1.items || []) !== JSON.stringify(item2.items || [])
      );

    default:
      // For other types, compare basic fields
      return (
        item1.name !== item2.name ||
        item1.updatedAt !== item2.updatedAt ||
        item1.isSynced !== item2.isSynced
      );
  }
};

/**
 * Check if user is online and backend is available
 */
export const isOnline = async () => {

  // For refresh operations, be more permissive
  // Check if user is authenticated (most important check)
  const auth = localStorage.getItem('auth');
  if (!auth) {

    return false;
  }

  // For refresh operations, allow API calls even if navigator.onLine is false
  // The API calls will fail gracefully if actually offline
  return true;
};

/**
 * Fast load data from IndexedDB for instant UI display
 * This loads data immediately from IndexedDB without waiting for backend sync
 */
export const fastLoadFromIndexedDB = async () => {

  try {
    // Load all data from IndexedDB in parallel for maximum speed
    const [
      customers,
      products,
      productBatches,
      orders,
      transactions,
      purchaseOrders,
      categories,
      activities,
      refunds,
      plans,
      planOrders,
      planDetails,
      settings,
      expenses,
      customerTransactions,
      dProducts
    ] = await Promise.all([
      getAllItems(STORES.customers).catch(() => []),
      getAllItems(STORES.products).catch(() => []),
      getAllItems(STORES.productBatches).catch(() => []),
      getAllItems(STORES.orders).catch(() => []),
      getAllItems(STORES.transactions).catch(() => []),
      getAllItems(STORES.purchaseOrders).catch(() => []),
      getAllItems(STORES.categories).catch(() => []),
      getAllItems(STORES.activities).catch(() => []),
      getAllItems(STORES.refunds).catch(() => []),
      getAllItems(STORES.plans).catch(() => []),
      getAllItems(STORES.planOrders).catch(() => []),
      getAllItems(STORES.planDetails).catch(() => []),
      getAllItems(STORES.settings).catch(() => []),
      getAllItems(STORES.expenses).catch(() => []),
      getAllItems(STORES.customerTransactions).catch(() => []),
      getAllItems(STORES.dProducts).catch(() => [])
    ]);

    // Clean up duplicate product batches on app refresh
    if (productBatches && productBatches.length > 0) {

      const cleanupResult = await cleanupDuplicateProductBatches();

      if (cleanupResult.removed > 0) {

        // Reload product batches after cleanup
        const cleanedProductBatches = await getAllItems(STORES.productBatches).catch(() => []);
        // Use the cleaned data
        const finalProductBatches = cleanedProductBatches || [];
        // Update the variable for later use
        Object.assign(productBatches, finalProductBatches);
      }
    }

    // Clean up duplicate purchase orders on app refresh
    if (purchaseOrders && purchaseOrders.length > 0) {

      const cleanupResult = await cleanupDuplicatePurchaseOrders();

      if (cleanupResult.removed > 0) {

        // Reload purchase orders after cleanup
        const cleanedPurchaseOrders = await getAllItems(STORES.purchaseOrders).catch(() => []);
        // Use the cleaned data
        const finalPurchaseOrders = cleanedPurchaseOrders || [];
        // Update the variable for later use
        Object.assign(purchaseOrders, finalPurchaseOrders);
      }
    }

    // Normalize data
    const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));

    // Create category lookup map for resolving category names
    const categoryMap = {};
    (categories || []).forEach(cat => {
      if (cat.id || cat._id) {
        categoryMap[cat.id || cat._id] = cat.name || '';
      }
    });

    const normalizedProducts = (products || []).map(product => {
      const normalized = normalizeProduct(product);
      // Resolve category name from categoryId
      if (normalized.categoryId && categoryMap[normalized.categoryId]) {
        normalized.category = categoryMap[normalized.categoryId];

      } else {
        normalized.category = normalized.category || '';
        // Only log if categoryId exists but not found (skip if no categoryId)
        if (normalized.categoryId) {
          // Reduced logging
        }
      }
      return normalized;
    });

    // Save resolved products back to IndexedDB so future loads have resolved categories

    await syncToIndexedDB(STORES.products, normalizedProducts, { merge: true });

    // Helper to sort by createdAt descending
    const sortByDateDesc = (items) => {
      if (!items || !Array.isArray(items)) return [];
      return items.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.date || 0).getTime();
        const dateB = new Date(b.createdAt || b.date || 0).getTime();
        return dateB - dateA;
      });
    };

    // Sort data to ensure consistent UI order (newest first)
    // This fixes "reverse order" issues when refreshing the page
    const sortedCustomers = sortByDateDesc(normalizedCustomers);
    const sortedProducts = sortByDateDesc(normalizedProducts); // Products often preferred newest first too
    const sortedOrders = sortByDateDesc(orders || []);
    const sortedTransactions = sortByDateDesc(transactions || []);
    const sortedPurchaseOrders = sortByDateDesc(purchaseOrders || []);
    const sortedRefunds = sortByDateDesc(refunds || []);
    const sortedExpenses = sortByDateDesc(expenses || []);
    const sortedCustomerTransactions = sortByDateDesc(customerTransactions || []);

    return {
      customers: sortedCustomers,
      products: sortedProducts,
      productBatches: productBatches || [],
      orders: sortedOrders,
      transactions: sortedTransactions,
      purchaseOrders: sortedPurchaseOrders,
      categories: categories || [],
      activities: activities || [],
      refunds: sortedRefunds,
      plans: plans || [],
      planOrders: planOrders || [],
      planDetails: planDetails || [],
      settings: settings || [],
      settings: settings || [],
      expenses: sortedExpenses,
      customerTransactions: sortedCustomerTransactions,
      dProducts: dProducts || [],
      dataSource: 'indexeddb', // Flag to indicate this came from IndexedDB
      loadedAt: Date.now()
    };
  } catch (error) {

    // Return empty arrays if IndexedDB fails completely
    return {
      customers: [],
      products: [],
      orders: [],
      transactions: [],
      purchaseOrders: [],
      categories: [],
      activities: [],
      refunds: [],
      plans: [],
      planOrders: [],
      planDetails: [],
      settings: [],
      dProducts: [],
      dataSource: 'error',
      loadedAt: Date.now()
    };
  }
};

/**
 * Background sync function that fetches from backend and updates both UI and IndexedDB
 * This should be called after fastLoadFromIndexedDB to get latest data
 */
// Sync Queue for offline operations
const SYNC_QUEUE_KEY = 'syncQueue';
let syncQueue = [];
let syncInProgress = false;

// Load sync queue from localStorage
const loadSyncQueue = () => {
  try {
    const stored = localStorage.getItem(SYNC_QUEUE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    syncQueue = parsed;
    //(`📋 Loaded sync queue: ${parsed.length} operations`, parsed.map(op => ({ type: op.type, id: op.id })));
  } catch (error) {

    syncQueue = [];
  }
};

// Save sync queue to localStorage
const saveSyncQueue = () => {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  } catch (error) {

  }
};

// Add operation to sync queue
export const addToSyncQueue = async (operationType, data) => {

  loadSyncQueue();

  const operation = {
    id: `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: operationType,
    data,
    timestamp: new Date().toISOString(),
    retries: 0,
    maxRetries: 3
  };

  syncQueue.push(operation);

  saveSyncQueue();

  return operation.id;
};

// Process sync queue
const processSyncQueue = async (dispatch, ActionTypes) => {

  //(`🔄 PROCESS SYNC QUEUE: Online status:`, isOnline());

  if (syncInProgress || !isOnline()) {

    return;
  }

  syncInProgress = true;

  loadSyncQueue();

  if (syncQueue.length === 0) {

    syncInProgress = false;
    return;
  }

  //(`🔄 Operations:`, syncQueue.map(op => ({ type: op.type, id: op.id })));

  const operationsToRemove = [];

  for (const operation of syncQueue) {
    try {

      let success = false;

      switch (operation.type) {
        case 'batch_update':
          // Sync batch update to backend
          const batchResult = await apiRequest(`/data/product-batches/${operation.data.batchId}`, {
            method: 'PUT',
            body: operation.data.updateData
          });

          if (batchResult.success) {
            success = true;

          }
          break;

        case 'batch_create_from_po':
          // Sync batch creation from purchase order to backend

          try {
            const batchData = operation.data.batchData;

            // Check if productId is a valid MongoDB ObjectId (product must be synced first)
            const isValidObjectId = /^[a-f\d]{24}$/i.test(batchData.productId);

            if (!isValidObjectId) {
              //(`⏳ Batch sync deferred - product not synced yet: ${operation.data.batchId} (productId: ${batchData.productId})`);
              // Don't mark as failed - let it retry later when product is synced
              break;
            }

            // Remove frontend-specific fields that shouldn't go to MongoDB
            const { id, _id, isSynced, syncedAt, lastModified, createdAt, purchaseOrderId, ...mongoBatchData } = batchData;

            const batchResult = await apiRequest('/data/product-batches', {
              method: 'POST',
              body: mongoBatchData
            });

            if (batchResult.success) {
              success = true;

              // Replace local data with backend response - backend is authoritative
              const { updateItem, STORES } = await import('../utils/indexedDB');
              // Ensure we extract the inner data object if it exists (API wrapper pattern)
              const backendBatch = batchResult.data?.data || batchResult.data || batchResult.batch;

              if (backendBatch) {

                // Update the local record with MongoDB details but KEEP local ID
                const { updateItem, STORES } = await import('../utils/indexedDB');

                const mongoBatch = {
                  ...backendBatch,  // Use full MongoDB data
                  id: batchData.id, // KEEP LOCAL ID as IndexedDB key
                  _id: backendBatch._id || backendBatch.id,  // MongoDB ID
                  mongoId: backendBatch._id || backendBatch.id, // Explicit reference
                  isSynced: true,  // Mark as synced
                  syncedAt: new Date().toISOString(),  // Track sync time
                  // Preserve any local UI state that backend might not return
                  createdAt: backendBatch.createdAt || batchData.createdAt,
                  purchaseOrderId: backendBatch.purchaseOrderId || batchData.purchaseOrderId
                };

                try {
                  await updateItem(STORES.productBatches, mongoBatch);

                  // Immediately clean up any duplicate temp batches
                  const { cleanupDuplicateProductBatches } = await import('../utils/indexedDB');

                  const batchCleanupResult = await cleanupDuplicateProductBatches();

                  if (batchCleanupResult.removed > 0) {

                  }

                  // Also update the state in AppContext to reflect backend data
                  dispatch({
                    type: ActionTypes.UPDATE_PRODUCT_BATCH,
                    payload: mongoBatch
                  });

                } catch (addError) {

                }
              } else {

                // Fallback: just mark as synced
                const syncedBatch = {
                  ...batchData,
                  isSynced: true,
                  syncedAt: new Date().toISOString()
                };
                await updateItem(STORES.productBatches, syncedBatch);
              }
            } else {
              //(`❌ Batch creation failed (will retry): ${operation.data.batchId}`, batchResult);

            }
          } catch (batchError) {

            // Don't mark as success if there's an error - let it retry
          }
          break;

        case 'batch_create':
        case 'batch_create_manual':
          // Sync manual batch creation to backend (not from purchase order)

          try {
            const batchData = operation.data.batchData;

            // Check if productId is a valid MongoDB ObjectId (product must be synced first)
            const isValidObjectId = /^[a-f\d]{24}$/i.test(batchData.productId);

            if (!isValidObjectId) {
              //(`⏳ Manual batch sync deferred - product not synced yet: ${operation.data.batchId} (productId: ${batchData.productId})`);
              // Don't mark as failed - let it retry later when product is synced
              break;
            }

            // Check for existing batch with same batchNumber and productId to prevent duplicates
            const existingBatchCheck = await apiRequest(`/data/product-batches?batchNumber=${encodeURIComponent(batchData.batchNumber || '')}&productId=${batchData.productId}`, {
              method: 'GET'
            });

            if (existingBatchCheck.success && existingBatchCheck.data && existingBatchCheck.data.length > 0) {
              // Batch already exists in backend - mark as synced and update local data
              success = true;
              const existingBatch = existingBatchCheck.data[0];

              const { updateItem, STORES } = await import('../utils/indexedDB');
              const syncedBatch = {
                ...batchData,
                id: batchData.id, // KEEP LOCAL ID
                _id: existingBatch._id || existingBatch.id, // Store MongoId
                mongoId: existingBatch._id || existingBatch.id,
                isSynced: true,
                syncedAt: new Date().toISOString()
              };
              await updateItem(STORES.productBatches, syncedBatch);

              // Update state in AppContext
              dispatch({
                type: ActionTypes.UPDATE_PRODUCT_BATCH,
                payload: syncedBatch
              });

              break; // Skip creation since it already exists
            }

            // Remove frontend-specific fields that shouldn't go to MongoDB
            const { id, _id, isSynced, syncedAt, lastModified, createdAt, ...mongoBatchData } = batchData;

            const batchResult = await apiRequest('/data/product-batches', {
              method: 'POST',
              body: mongoBatchData
            });

            if (batchResult.success) {
              success = true;

              // Replace local data with backend response - backend is authoritative
              const { updateItem, STORES } = await import('../utils/indexedDB');
              // Ensure we extract the inner data object if it exists (API wrapper pattern)
              const backendBatch = batchResult.data?.data || batchResult.data || batchResult.batch;

              console.log('🔄 Batch sync response:', {
                localId: batchData.id,
                backendBatch: backendBatch
              });

              if (backendBatch && (backendBatch._id || backendBatch.id)) {
                // Construct the new synced batch record - KEEPING LOCAL ID
                const mongoBatch = {
                  ...backendBatch,  // Use full MongoDB data
                  id: batchData.id, // KEEP LOCAL ID as IndexedDB key
                  _id: backendBatch._id || backendBatch.id,  // MongoDB ID
                  mongoId: backendBatch._id || backendBatch.id, // Explicit reference
                  isSynced: true,  // Mark as synced
                  syncedAt: new Date().toISOString(),  // Track sync time
                  // Preserve any local UI state that backend might not return
                  createdAt: backendBatch.createdAt || batchData.createdAt,
                  localId: batchData.id // Pass localId so Reducer knows which temp batch to replace (though we are keeping it as primary ID now)
                };

                try {
                  // SAFE SYNC PATTERN: Update existing record directly
                  const { updateItem, STORES } = await import('../utils/indexedDB');

                  console.log('💾 Updating synced batch in DB (keeping local ID):', mongoBatch);
                  await updateItem(STORES.productBatches, mongoBatch);

                  // No need to delete temp batch as we just updated it in-place

                  // Immediately clean up any duplicate temp batches (just in case)
                  const { cleanupDuplicateProductBatches } = await import('../utils/indexedDB');

                  const batchCleanupResult = await cleanupDuplicateProductBatches();

                  if (batchCleanupResult.removed > 0) {
                    console.log('🧹 Cleaned up duplicate batches after sync');
                  }

                  // Also update the state in AppContext to reflect backend data
                  dispatch({
                    type: ActionTypes.UPDATE_PRODUCT_BATCH,
                    payload: mongoBatch
                  });

                } catch (addError) {
                  // If updateItem fails, log it
                  console.warn('⚠️ Update synced batch failed:', addError.message);
                }
              } else {
                // Fallback: just mark as synced
                const syncedBatch = {
                  ...batchData,
                  isSynced: true,
                  syncedAt: new Date().toISOString()
                };
                await updateItem(STORES.productBatches, syncedBatch);
              }
            } else {
              // Handle case where backend returns 409 Conflict (Duplicate) as a failure but with existing data
              if (batchResult.status === 409 || (batchResult.reason && batchResult.reason.includes('already exists'))) {
                success = true; // Mark op as done so we don't retry forever
              }
            }
          } catch (batchError) {
            // If duplicate key error, consider it synced
            if (batchError.message && batchError.message.includes('Key already exists')) {
              success = true;
            }
          }
          break;

        case 'purchase_order_create':
          // Sync purchase order creation to backend

          //(`🔄 Timestamp: ${new Date().toISOString()}`);
          try {
            // Remove the custom _id field so MongoDB can generate its own ObjectId
            const { _id, ...orderDataWithoutId } = operation.data.orderData;
            const poResult = await apiRequest('/data/vendor-orders', {
              method: 'POST',
              body: orderDataWithoutId
            });

            if (poResult.success) {
              success = true;

              // Check current IndexedDB state before replacement
              const { getAllItems, deleteItem, addItem, updateItem, STORES } = await import('../utils/indexedDB');
              const currentOrders = await getAllItems(STORES.purchaseOrders);

              currentOrders.forEach(order => {
                //(`  - ${order.id} (${order.supplierName}, ${order.total})`);
              });

              const backendOrder = poResult.data || poResult.order;

              if (backendOrder) {

                // Always attempt to replace the temp order with the MongoDB order
                // This is the correct behavior for purchase order sync

                const mongoOrder = {
                  ...backendOrder,  // Use full MongoDB data
                  id: operation.data.orderData.id,  // KEEP LOCAL ID (UUID)
                  _id: backendOrder._id || backendOrder.id,  // MongoDB ID
                  mongoId: backendOrder._id || backendOrder.id,  // Explicit
                  localId: operation.data.orderData.id,
                  isSynced: true,  // Mark as synced
                  syncedAt: new Date().toISOString(),  // Track sync time
                  // Preserve any local data that should be kept
                  createdAt: backendOrder.createdAt || operation.data.orderData.createdAt,
                  date: backendOrder.date || operation.data.orderData.date
                };

                // Update the existing item instead of deleting and adding new
                // This prevents "dangling references" caused by ID swapping
                const { updateItem, deleteItem, getAllItems, STORES } = await import('../utils/indexedDB');

                try {
                  await updateItem(STORES.purchaseOrders, mongoOrder);

                  // Optional: Clean up OTHER duplicates that are NOT the current ID
                  // but share the same supplier/time (if they exist)
                  const ordersAfterUpdate = await getAllItems(STORES.purchaseOrders);
                  const duplicateTempOrders = ordersAfterUpdate.filter(o =>
                    o.id.startsWith('PO_') &&
                    o.supplierName === operation.data.orderData.supplierName &&
                    o.id !== mongoOrder.id && // Don't delete self
                    !o.isSynced
                  );

                  for (const dupOrder of duplicateTempOrders) {
                    try {
                      await deleteItem(STORES.purchaseOrders, dupOrder.id);
                    } catch (e) {
                      // ignore
                    }
                  }

                } catch (updateError) {
                  return; // Exit if we can't update
                }

                // Final verification
                const finalOrders = await getAllItems(STORES.purchaseOrders);
                const tempStillExistsFinal = finalOrders.some(o => o.id === operation.data.orderData.id);
                const mongoExistsFinal = finalOrders.some(o => o.id === mongoOrder.id);

                if (tempStillExistsFinal) {

                }

                if (!mongoExistsFinal) {

                }

                finalOrders.forEach(o => (`  - ${o.id} (${o.supplierName}, synced: ${o.isSynced})`));

                // Replace the local order in Redux state with the synced MongoDB order

                dispatch({
                  type: 'REPLACE_PURCHASE_ORDER',
                  payload: {
                    tempId: operation.data.orderData.id,
                    newOrder: mongoOrder
                  }
                });

              } else {

                // Fallback: just mark as synced
                const syncedOrder = {
                  ...operation.data.orderData,
                  isSynced: true,
                  syncedAt: new Date().toISOString()
                };
                await updateItem(STORES.purchaseOrders, syncedOrder);
              }
            }
          } catch (poError) {

          }
          break;

        case 'product_create':
          // Sync product creation to backend
          try {
            // Remove temp IDs so backend generates new one
            const { id, _id, isSynced, syncedAt, createdAt, updatedAt, ...productData } = operation.data;

            const createResult = await apiRequest('/data/products', {
              method: 'POST',
              body: productData
            });

            if (createResult.success) {
              success = true;
              const backendProduct = createResult.data?.data || createResult.data || createResult.product;

              if (backendProduct && (backendProduct.id || backendProduct._id)) {
                // Determine IDs
                const tempId = operation.data.id;
                const backendId = backendProduct._id || backendProduct.id;

                // Rule 1: Protect unsynced local items
                // EXCEPTION: If backend item has same or newer timestamp, it means our sync succeeded!
                // So we should accept the backend item (which has isSynced: true).
                // This block is a conceptual rule and not directly inserted here.
                // The actual implementation is within syncToIndexedDB's filter logic.

                const syncedProduct = {
                  ...backendProduct,
                  id: tempId, // KEEP LOCAL ID
                  _id: backendId,
                  mongoId: backendId,
                  isSynced: true,
                  syncedAt: new Date().toISOString()
                };

                // Update IndexedDB: Update existing item
                const { updateItem, STORES } = await import('../utils/indexedDB');

                try {
                  await updateItem(STORES.products, syncedProduct);
                } catch (e) {
                  // Fallback
                }

                // Update State: Update existing item
                if (dispatch && ActionTypes) {
                  dispatch({
                    type: ActionTypes.UPDATE_PRODUCT,
                    payload: syncedProduct
                  });
                }
              }
            }
          } catch (createError) {
            // If error, let it retry
          }
          break;

        case 'product_update':
          // Sync product update to backend

          try {
            const productData = operation.data.productData;

            // Ensure we have a valid MongoDB ObjectId for the update
            const productId = productData._id || productData.id;
            if (!productId || !/^[a-f\d]{24}$/i.test(productId)) {
              //('⏳ Product update sync deferred - product not synced yet: ${productId}');
              // Don't mark as failed - let it retry later when product is synced
              break;
            }

            // Remove frontend-specific fields that shouldn't go to MongoDB
            const { id, isSynced, syncedAt, lastModified, createdAt, updatedAt, batches, ...mongoProductData } = productData;

            const productResult = await apiRequest(`/data/products/${productId}`, {
              method: 'PUT',
              body: mongoProductData
            });

            if (productResult.success) {
              success = true;

              // Update local data to mark as synced
              const { updateItem, STORES } = await import('../utils/indexedDB');
              const syncedProduct = {
                ...productData,
                isSynced: true,
                syncedAt: new Date().toISOString()
              };
              await updateItem(STORES.products, syncedProduct);

              // Update state in AppContext
              dispatch({
                type: ActionTypes.UPDATE_PRODUCT,
                payload: syncedProduct
              });

            } else {
              //('❌ Product update failed (will retry): ${productId}', productResult);

            }
          } catch (productError) {

            // Don't mark as success if there's an error - let it retry
          }
          break;

        case 'expense_create': {
          const expenseResult = await apiRequest('/expenses', {
            method: 'POST',
            body: operation.data
          });

          if (expenseResult.success) {
            success = true;
            const addedExpense = expenseResult.data?.data || expenseResult.data;
            const { deleteItem, addItem, updateItem, STORES } = await import('../utils/indexedDB');

            // Fix: Ensure ID is present (MongoDB returns _id, IndexedDB needs id)
            if (!addedExpense.id && addedExpense._id) {
              addedExpense.id = addedExpense._id;
            }

            // If we have a temp ID, replace it. Otherwise just update.
            // If we have a temp ID, update it.
            if (operation.data.id && String(operation.data.id).startsWith('temp_')) {
              const syncedExpense = {
                ...addedExpense,
                id: operation.data.id, // KEEP LOCAL ID
                _id: addedExpense.id || addedExpense._id,
                mongoId: addedExpense.id || addedExpense._id,
                isSynced: true
              };

              await updateItem(STORES.expenses, syncedExpense);
            } else {
              await updateItem(STORES.expenses, { ...addedExpense, isSynced: true });
            }
          }
          break;
        }

        case 'expense_delete': {
          const deleteResult = await apiRequest(`/expenses/${operation.data.id}`, {
            method: 'DELETE'
          });

          if (deleteResult.success) {
            success = true;
            const { deleteItem, STORES } = await import('../utils/indexedDB');
            await deleteItem(STORES.expenses, operation.data.id);
          } else {
            // If 404, it's already gone, so success
            // But we don't have status code easily here from apiRequest usually unless we check deeper
            // apiRequest returns { success: false, message: ... }
            // We can assume if it fails it might be net error or server error.
            // If we want to be safe, we can just leave it in queue to retry.
          }
          break;
        }

        default:

      }

      if (success) {
        operationsToRemove.push(operation.id);

      } else {
        operation.retries++;
        if (operation.retries >= operation.maxRetries) {

          operationsToRemove.push(operation.id);
        }
      }

    } catch (error) {

      operation.retries++;

      if (operation.retries >= operation.maxRetries) {
        operationsToRemove.push(operation.id);
      }
    }
  }

  // Remove completed/failed operations
  syncQueue = syncQueue.filter(op => !operationsToRemove.includes(op.id));
  saveSyncQueue();

  syncInProgress = false;

  if (syncQueue.length > 0) {

  } else {

    if (window.showToast) {
      window.showToast('All offline changes synced successfully!', 'success');
    }
  }
};

// Initialize sync queue
loadSyncQueue();

// Network status detection and auto-sync
let networkStatusInitialized = false;

const initializeNetworkSync = (dispatch, ActionTypes) => {
  if (networkStatusInitialized) return;
  networkStatusInitialized = true;

  // Listen for online events
  window.addEventListener('online', async () => {

    if (window.showToast) {
      window.showToast('Back online! Syncing your changes...', 'info');
    }

    try {
      // Small delay to ensure network is stable
      setTimeout(async () => {
        await backgroundSyncWithBackend(dispatch, ActionTypes);
      }, 1000);
    } catch (error) {

    }
  });

  // Listen for offline events
  window.addEventListener('offline', () => {

    if (window.showToast) {
      window.showToast('You are offline. Changes will sync when online.', 'warning');
    }
  });

  // Check current status
  if (navigator.onLine) {

  } else {

    if (window.showToast) {
      window.showToast('You are currently offline. Changes will sync when online.', 'warning');
    }
  }
};

// Export network initialization
export const initializeOfflineSync = (dispatch, ActionTypes) => {
  initializeNetworkSync(dispatch, ActionTypes);
};

/**
 * Scan for and sync any unsynced data from IndexedDB
 * (Safety net for when sync queue is empty but local data exists - e.g. after refresh)
 */
const syncUnsyncedDataFromIndexedDB = async (dispatch, ActionTypes) => {
  if (!await isOnline()) return;

  const { getAllItems, updateItem, deleteItem, addItem, STORES } = await import('./indexedDB');

  // Define syncable stores and their endpoints
  // Note: Only include stores that support direct syncing via REST API
  const syncConfig = [
    { store: STORES.expenses, endpoint: '/expenses', name: 'expenses' },
    { store: STORES.customers, endpoint: '/data/customers', name: 'customers' }
    // Add other critical stores as needed (e.g. products, orders) - keeping it safe for now
  ];

  for (const config of syncConfig) {
    try {
      const items = await getAllItems(config.store);
      // Find items that are NOT synced and NOT deleted (soft deletes should be handled via sync queue ideally, but we skip for safety here)
      const unsynced = items.filter(i => !i.isSynced && !i.isDeleted);

      if (unsynced.length > 0) {
        if (config.name === 'expenses') {
          notifyRefreshProgress(15, `Syncing ${unsynced.length} unsaved expenses...`);
        }

        for (const item of unsynced) {
          try {
            // Determine if it's a temp ID (Create) or real ID (Update)
            // Temp IDs usually start with 'temp_' or are short (timestamp based) or non-hex
            const isTemp = String(item.id).startsWith('temp_') || String(item.id).length < 24;

            // Prepare payload
            const payload = { ...item };
            delete payload.isSynced;
            delete payload.syncedAt;
            // Remove local-only fields if any

            let result;
            if (isTemp) {
              // Create operation
              // Remove temp ID so backend generates new one
              const tempId = payload.id;
              delete payload.id;
              delete payload._id;

              result = await apiRequest(config.endpoint, { method: 'POST', body: payload });

              if (result.success) {
                const backendData = result.data?.data || result.data || result.expense; // Handle various response formats

                if (backendData && (backendData.id || backendData._id)) {
                  // Success - update local temp item with backend ID (keep local ID)
                  const newItem = {
                    ...backendData,
                    id: tempId, // KEEP LOCAL ID
                    _id: backendData._id || backendData.id,
                    mongoId: backendData._id || backendData.id,
                    isSynced: true,
                    syncedAt: new Date().toISOString()
                  };

                  // Update existing item
                  await updateItem(config.store, newItem);
                  if (config.store === STORES.expenses) {
                    // Maybe dispatch update? But this is background sync.
                  }
                }
              }
            } else {
              // Update operation
              // Only performed if endpoint supports PUT
              result = await apiRequest(`${config.endpoint}/${item.id}`, { method: 'PUT', body: payload });

              if (result.success) {
                await updateItem(config.store, { ...item, isSynced: true, syncedAt: new Date().toISOString() });
              }
            }
          } catch (syncError) {
            console.error(`Failed to sync item ${item.id} in ${config.name}:`, syncError);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing store ${config.name} for sync:`, error);
    }
  }
};


export const backgroundSyncWithBackend = async (dispatch, ActionTypes, options = {}) => {
  if (options.showProgress) {
    notifyRefreshProgress(5, 'Initializing sync...');
  }
  // Prevent multiple simultaneous background sync calls
  if (window.backgroundSyncInProgress) {

    return { success: false, reason: 'already_in_progress' };
  }

  window.backgroundSyncInProgress = true;

  try {
    // Process sync queue first (offline operations)

    // Process sync queue first (offline operations) - CRITICAL for product creation
    await processSyncQueue(dispatch, ActionTypes);

    // Also check for any manually added unsynced items in IndexedDB (safety net)
    // DISABLED: This is handled by syncService.syncAll() and was causing duplicate API calls
    // await syncUnsyncedDataFromIndexedDB(dispatch, ActionTypes);

  } catch (queueError) {

  }

  // Check if user is authenticated before making API calls
  const auth = localStorage.getItem('auth');
  if (!auth) {

    return { success: false, reason: 'not_authenticated' };
  }

  try {

    const online = await isOnline();

    if (!online) {

      return { success: false, reason: 'offline' };
    }

    // Initialize sync tracking for new users

    const { initializeSyncTracking } = await import('../utils/indexedDB');
    await initializeSyncTracking();

    // Skip data fetching if requested (e.g., after purchase order creation to avoid duplicates)
    if (options.skipDataFetch) {
      //('📡 BACKGROUND SYNC: Skipping data fetch as requested (skipDataFetch=true)');
      window.backgroundSyncInProgress = false;
      return { success: true, reason: 'data_fetch_skipped' };
    }

    // Get last fetch times from IndexedDB to determine if we need full sync or incremental
    const { getLastFetchTimesForAPI } = await import('../utils/indexedDB');
    let lastFetchTimes = {};

    if (options.forceFullSync) {
      // Force full sync by sending empty/null timestamps
      console.log('🔄 BACKGROUND SYNC: Force full sync requested');
      lastFetchTimes = {};
    } else {
      lastFetchTimes = await getLastFetchTimesForAPI();
    }

    // Check if we need full sync (new user OR forced)
    const defaultTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const shouldFullSync = options.forceFullSync || Object.keys(lastFetchTimes).length === 0 ||
      Object.values(lastFetchTimes).every(time => time === defaultTime);

    // Prepare request body - new users get full sync, existing users get incremental
    // Use an empty array [] for full sync as requested
    const requestBody = shouldFullSync ? [] : { lastFetchTimes };

    // Fetch latest data from backend using POST method
    if (options.showProgress) notifyRefreshProgress(30, 'Downloading data...');
    const result = await apiRequest('/data/all', {
      method: 'POST',
      body: requestBody
    });

    if (!result.success || !result.data?.data) {

      return { success: false, reason: 'invalid_response' };
    }

    const { customers, products, productBatches, orders, transactions, purchaseOrders, expenses, categories, customerTransactions, planOrders, suppliers, supplierTransactions, dProducts } = result.data.data;

    // Note: planOrders are no longer stored in IndexedDB - we use planDetails instead

    // Normalize and prepare data
    const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));

    // Create category lookup map for resolving category names
    const categoryMap = {};
    (categories || []).forEach(cat => {
      if (cat.id || cat._id) {
        categoryMap[cat.id || cat._id] = cat.name || '';
      }
    });

    const normalizedProducts = (products || []).map(product => {
      const normalized = normalizeProduct(product);
      // Resolve category name from categoryId
      if (normalized.categoryId && categoryMap[normalized.categoryId]) {
        normalized.category = categoryMap[normalized.categoryId];

      } else {
        normalized.category = normalized.category || '';
        if (normalized.categoryId) {
          // Reduced logging
        }
      }
      return normalized;
    });
    const normalizedProductBatches = (productBatches || []).map(batch => normalizeProductBatch(batch));

    // Update IndexedDB with fresh backend data
    // Use replace (merge: false) if performning full sync to ensure deleted items are removed from IDB
    // Use merge (merge: true) if performing incremental sync to just update changed items
    const idbMergeMode = !shouldFullSync;

    if (options.showProgress) notifyRefreshProgress(60, 'Updating local database...');
    const syncResults = await Promise.all([
      syncToIndexedDB(STORES.customers, normalizedCustomers, { merge: idbMergeMode }),
      syncToIndexedDB(STORES.products, normalizedProducts, { merge: idbMergeMode }),
      syncToIndexedDB(STORES.productBatches, normalizedProductBatches, { merge: idbMergeMode }),
      syncToIndexedDB(STORES.orders, orders || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.transactions, transactions || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.expenses, expenses || [], { merge: idbMergeMode }), // Add expenses sync
      syncToIndexedDB(STORES.categories, categories || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.customerTransactions, customerTransactions || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.suppliers, suppliers || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.supplierTransactions, supplierTransactions || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.planOrders, planOrders || [], { merge: idbMergeMode }),
      syncToIndexedDB(STORES.dProducts, dProducts || [], { merge: idbMergeMode })
    ]);

    // Update last fetch times for data types that were updated
    const currentTime = new Date().toISOString();
    const dataTypesUpdated = [];

    if (normalizedCustomers && normalizedCustomers.length > 0) dataTypesUpdated.push('customers');
    if (normalizedProducts && normalizedProducts.length > 0) dataTypesUpdated.push('products');
    if (normalizedProductBatches && normalizedProductBatches.length > 0) dataTypesUpdated.push('productBatches');
    if (orders && orders.length > 0) dataTypesUpdated.push('orders');
    if (transactions && transactions.length > 0) dataTypesUpdated.push('transactions');
    if (purchaseOrders && purchaseOrders.length > 0) dataTypesUpdated.push('purchaseOrders');
    if (expenses && expenses.length > 0) dataTypesUpdated.push('expenses'); // Track expenses update
    if (categories && categories.length > 0) dataTypesUpdated.push('categories');
    if (customerTransactions && customerTransactions.length > 0) dataTypesUpdated.push('customerTransactions');
    if (suppliers && suppliers.length > 0) dataTypesUpdated.push('suppliers');
    if (supplierTransactions && supplierTransactions.length > 0) dataTypesUpdated.push('supplierTransactions');
    if (planOrders && planOrders.length > 0) dataTypesUpdated.push('planOrders');
    if (dProducts && dProducts.length > 0) dataTypesUpdated.push('dProducts');

    //(`🔄 BACKGROUND SYNC: Updating lastFetchTime for ${dataTypesUpdated.length} data types: ${dataTypesUpdated.join(', ')}`);

    for (const dataType of dataTypesUpdated) {
      try {
        await updateLastFetchTime(dataType, currentTime);

        if (dataType === 'productBatches') {

        }
      } catch (error) {

      }
    }

    // Update UI state with fresh backend data

    //('📦 BACKGROUND SYNC: Sample product categories:', normalizedProducts.slice(0, 3).map(p => ({ name: p.name, categoryId: p.categoryId, category: p.category })));

    // REFRESH FROM IDB: Get the TRUE state (Backend + Preserved Local Unsynced)
    // We must return this instead of raw backend data so the UI reflects local changes
    const [
      idbCustomers,
      idbProducts,
      idbBatches,
      idbOrders,
      idbTransactions,
      idbPurchaseOrders,
      idbCategories,
      idbExpenses,
      idbCustomerTransactions,
      idbSuppliers,
      idbSupplierTransactions,
      idbPlanOrders,
      idbDProducts
    ] = await Promise.all([
      getAllItems(STORES.customers).catch(() => []),
      getAllItems(STORES.products).catch(() => []),
      getAllItems(STORES.productBatches).catch(() => []),
      getAllItems(STORES.orders).catch(() => []),
      getAllItems(STORES.transactions).catch(() => []),
      getAllItems(STORES.purchaseOrders).catch(() => []),
      getAllItems(STORES.categories).catch(() => []),
      getAllItems(STORES.expenses).catch(() => []),
      getAllItems(STORES.customerTransactions).catch(() => []),
      getAllItems(STORES.suppliers).catch(() => []),
      getAllItems(STORES.supplierTransactions).catch(() => []),
      getAllItems(STORES.planOrders).catch(() => []),
      getAllItems(STORES.dProducts).catch(() => [])
    ]);

    // Update UI state logic (previously using undefined dispatch)
    // We will return the data to AppContext which handles the dispatching

    // Associate batches with products for stock calculations using IDB data
    const associateBatchesWithProducts = (products, batches) => {
      // Create a map of productId to batches
      const batchMap = {};
      batches.forEach(batch => {
        const productId = batch.productId;
        if (!batchMap[productId]) {
          batchMap[productId] = [];
        }
        batchMap[productId].push(batch);
      });

      // Associate batches with products
      return products.map(product => {
        const productId = product._id || product.id;
        const productBatches = batchMap[productId] || [];
        return {
          ...product,
          batches: productBatches
        };
      });
    };

    const productsWithBatches = associateBatchesWithProducts(
      (idbProducts || []).filter(i => i.isDeleted !== true),
      (idbBatches || []).filter(i => i.isDeleted !== true)
    );

    if (options.showProgress) notifyRefreshProgress(100, 'Sync complete');

    return {
      success: true,
      dataSource: 'backend_merged',
      syncedAt: Date.now(),
      data: {
        customers: idbCustomers,
        products: idbProducts, // Now includes batches associated in UI logic downstream or via normalization? 
        // AppContext expects 'products' here. We passed productsWithBatches above to dispatch?
        // AppContext handles association itself if needed, or we pass it here.
        // Let's pass the associated ones to be safe, or just the raw list.
        // Actually, let's keep it consistent.
        products: productsWithBatches,
        productBatches: idbBatches, // Ensure this is returned!
        orders: idbOrders,
        transactions: idbTransactions,
        purchaseOrders: idbPurchaseOrders,
        categories: idbCategories,
        expenses: idbExpenses,
        customerTransactions: idbCustomerTransactions,
        suppliers: idbSuppliers,
        supplierTransactions: idbSupplierTransactions,
        suppliers: idbSuppliers,
        supplierTransactions: idbSupplierTransactions,
        planOrders: idbPlanOrders || [],
        dProducts: idbDProducts || []
      },
      // Pass plan data through for AppContext to handle (reconciling with local usage)
      planUsageSummary: result.data.planUsageSummary,
      planDetails: result.data.planDetails
    };

  } catch (error) {

    return { success: false, reason: 'error', error: error.message };
  } finally {
    // Always clear the in-progress flag
    window.backgroundSyncInProgress = false;
  }
};

/**
 * Fetch customers from backend or IndexedDB
 */
export const fetchCustomers = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/customers', { method: 'GET' });

      if (result.success && result.data?.data) {
        const customers = result.data.data;

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.customers, customers, { merge: true });

        return customers;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  const customers = await getAllItems(STORES.customers);
  // Normalize customers - convert phone to mobileNumber for backward compatibility
  return customers.map(customer => normalizeCustomer(customer));
};

/**
 * Fetch products from backend or IndexedDB
 */
export const fetchProducts = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/products', { method: 'GET' });

      if (result.success && result.data?.data) {
        const products = result.data.data;

        // Normalize products before syncing - but preserve batches if they exist
        const normalizedProducts = products.map(product => {
          const normalized = normalizeProduct(product);
          // Preserve batches from backend if they exist
          if (product.batches && product.batches.length > 0) {
            normalized.batches = product.batches;
          }
          return normalized;
        });

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.products, normalizedProducts, { merge: true });

        return normalizedProducts;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  const products = await getAllItems(STORES.products);
  // Normalize products - ensure both stock/quantity and costPrice/unitPrice exist
  return products.map(product => normalizeProduct(product));
};

/**
 * Fetch orders from backend or IndexedDB
 */
export const fetchOrders = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/orders', { method: 'GET' });

      if (result.success && result.data?.data) {
        const orders = result.data.data;

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.orders, orders, { merge: true });

        return orders;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  return await getAllItems(STORES.orders);
};

/**
 * Fetch transactions from backend or IndexedDB
 */
export const fetchTransactions = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/transactions', { method: 'GET' });

      if (result.success && result.data?.data) {
        const transactions = result.data.data;

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.transactions, transactions, { merge: true });

        return transactions;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  return await getAllItems(STORES.transactions);
};

/**
 * Fetch vendor orders (purchase orders) from backend or IndexedDB
 */
export const fetchVendorOrders = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/vendor-orders', { method: 'GET' });

      if (result.success && result.data?.data) {
        const orders = result.data.data;

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.purchaseOrders, orders, { merge: true });

        return orders;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  return await getAllItems(STORES.purchaseOrders);
};

/**
 * Fetch categories from backend or IndexedDB
 */
export const fetchCategories = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/data/categories', { method: 'GET' });

      if (result.success && result.data?.data) {
        const categories = result.data.data;

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.categories, categories, { merge: true });

        return categories;
      }
    } catch (error) {

      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  return await getAllItems(STORES.categories);
};

/**
 * Fetch expenses from backend or IndexedDB
 */
export const fetchExpenses = async () => {
  const online = await isOnline();

  if (online) {
    try {
      const result = await apiRequest('/expenses', { method: 'GET' });

      if (result.success && result.data) {
        // Handle both direct array or nested data property
        const expenses = Array.isArray(result.data) ? result.data : (result.data.data || []);

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.expenses, expenses, { merge: true });

        return expenses;
      }
    } catch (error) {
      console.error('Error fetching expenses from backend:', error);
      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)

  const expenses = await getAllItems(STORES.expenses);
  return expenses || [];
};

/**
 * Normalize data based on its type
 */
const normalizeDataByType = (dataType, items) => {
  if (!items || !Array.isArray(items)) return [];

  if (dataType === 'customers') {
    return items.map(item => normalizeCustomer(item));
  } else if (dataType === 'products') {
    return items.map(item => normalizeProduct(item));
  } else if (dataType === 'productBatches') {
    return items.map(item => normalizeProductBatch(item));
  }

  return items;
};

/**
 * Fetch all data at once from backend or IndexedDB
 */
export const fetchAllData = async () => {
  // Check if user is authenticated before making API calls
  const auth = localStorage.getItem('auth');
  if (!auth) {
    // console.log('❌ fetchAllData: No auth token found');
  } else {
    const online = await isOnline();

    // DISABLED: Full data fetch - only sync on login now
    // if (online) {
    //   try {
    //     // Use deduplication to prevent multiple simultaneous calls
    //     const result = await deduplicateRequest('fetch-all-data', async () => {
    //       return await apiRequest('/data/all', { method: 'GET' });
    //     });
    //
    //     if (result.success && result.data?.data) {
    //       const { customers, products, orders, transactions, purchaseOrders, categories } = result.data.data;
    //
    //       // Normalize data before syncing
    //       const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));
    //       const normalizedProducts = (products || []).map(product => normalizeProduct(product));
    //
    //       // Update IndexedDB with backend data
    //       await Promise.all([
    //         syncToIndexedDB(STORES.customers, normalizedCustomers, { merge: true }),
    //         syncToIndexedDB(STORES.products, normalizedProducts, { merge: true }),
    //         syncToIndexedDB(STORES.orders, orders || [], { merge: true }),
    //         syncToIndexedDB(STORES.transactions, transactions || [], { merge: true }),
    //         syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || [], { merge: true }),
    //         syncToIndexedDB(STORES.categories, categories || [], { merge: true })
    //       ]);
    //
    //       // Note: Timestamps are updated by the caller if needed
    //
    //       return {
    //         customers: normalizedCustomers,
    //         products: normalizedProducts,
    //         orders: orders || [],
    //         transactions: transactions || [],
    //         purchaseOrders: purchaseOrders || [],
    //         categories: categories || []
    //       };
    //     }
    //   } catch (error) {
    //     console.error('Error fetching all data from backend:', error);
    //     // Fall through to IndexedDB
    //   }
    // }
  }

  // Fetch from IndexedDB (offline or backend failed)
  const [customers, products, orders, transactions, purchaseOrders, categories, expenses, customerTransactions, dProducts] = await Promise.all([
    getAllItems(STORES.customers).catch(() => []),
    getAllItems(STORES.products).catch(() => []),
    getAllItems(STORES.orders).catch(() => []),
    getAllItems(STORES.transactions).catch(() => []),
    getAllItems(STORES.purchaseOrders).catch(() => []),
    getAllItems(STORES.categories).catch(() => []),
    getAllItems(STORES.expenses).catch(() => []),
    getAllItems(STORES.customerTransactions).catch(() => []),
    getAllItems(STORES.dProducts).catch(() => [])
  ]);

  // Normalize data
  const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));

  // Create category lookup map for resolving category names
  const categoryMap = {};
  (categories || []).forEach(cat => {
    if (cat.id || cat._id) {
      categoryMap[cat.id || cat._id] = cat.name || '';
    }
  });

  const normalizedProducts = (products || []).map(product => {
    const normalized = normalizeProduct(product);
    // Resolve category name from categoryId
    if (normalized.categoryId && categoryMap[normalized.categoryId]) {
      normalized.category = categoryMap[normalized.categoryId];
    } else {
      normalized.category = normalized.category || '';
    }
    return normalized;
  });

  return {
    customers: normalizedCustomers,
    products: normalizedProducts,
    orders: orders || [],
    transactions: transactions || [],
    purchaseOrders: purchaseOrders || [],
    categories: categories || [],
    expenses: expenses || [],
    customerTransactions: customerTransactions || [],
    dProducts: dProducts || []
  };
};

/**
 * Fetch all data with delta sync - efficient loading for thousands of users
 * Uses sync tracking to only fetch changed data
 */
const fetchAllDataWithDeltaSync = async (options = {}) => {
  const {
    forceFullSync = false, // Force full sync instead of delta
    chunkSize = 500, // Number of records per chunk for large datasets
    showProgress = false // Show progress callbacks
  } = options;

  // Check if user is authenticated
  const auth = localStorage.getItem('auth');
  if (!auth) {
    // console.log('❌ fetchAllDataWithDeltaSync: No auth token found');
    return await fetchAllData();
  }

  const online = await isOnline();
  if (!online) {
    // console.log('🌐 fetchAllDataWithDeltaSync: Offline mode');
    return await fetchAllData();
  }

  try {
    // Initialize sync tracking if not already done
    await initializeSyncTracking();

    // Variable to determine if we should skip delta sync and go straight to full sync
    let skipDeltaSync = forceFullSync;

    // Result of delta sync
    let deltaResult = null;

    if (!skipDeltaSync) {
      // Get last fetch times from IndexedDB
      const lastFetchTimes = await getLastFetchTimesForAPI();

      // Call delta sync API with deduplication to prevent duplicate calls
      // console.log('🔄 DELTA SYNC: Requesting delta updates...');
      const result = await deduplicateRequest('delta-sync', async () => {
        return await apiRequest('/data/delta-sync', {
          method: 'POST',
          body: { lastFetchTimes }
        });
      });

      if (!result.success) {
        // Delta sync failed - possibly due to expiry/reset. Fallback to full sync.
        console.warn('⚠️ Delta sync failed, falling back to full sync:', result.error);
        skipDeltaSync = true;
      } else {
        deltaResult = result;
      }
    } else {
      // console.log('🔄 DELTA SYNC: Forced full sync requested');
    }

    // Default empty result structure if skipping delta
    const resultData = deltaResult?.data?.data || { needsFullSync: [], deltaInfo: {}, data: {} };
    const { needsFullSync, deltaInfo, data } = resultData;

    // If we're skipping delta sync (forceFullSync or failed delta), allow full sync logic to proceed
    // by ensuring we don't return early

    //('🔄 DELTA SYNC: API response - needs full sync:', needsFullSync?.length > 0, 'delta data types:', Object.keys(deltaInfo || {}));

    //('🔄 DELTA SYNC: Data keys:', Object.keys(data || {}));

    // Check if ANY data type needs update (this is our master condition)
    const hasAnyUpdates = deltaInfo && Object.values(deltaInfo).some(info => info.needsUpdate === true);

    // Always process delta data if it exists, regardless of needsUpdate flags
    // This ensures multi-device consistency

    // Process delta data FIRST (regardless of needsFullSync)
    const allData = {
      customers: [],
      products: [],
      orders: [],
      transactions: [],
      purchaseOrders: [],
      categories: [],
      refunds: [],
      plans: [],
      planOrders: [],
      expenses: [],
      expenses: [],
      staff: [],
      customerTransactions: [],
      suppliers: [],
      supplierTransactions: [],
      dProducts: []
    };

    // Track if any data was processed (from delta OR full sync)
    let hasProcessedData = false;

    // Track which data types actually had changes (for timestamp updates)
    const updatedDataTypes = new Set();

    // Process each data type that has delta data
    //('🔄 DELTA SYNC: Processing delta data:', Object.keys(data || {}));

    for (const [dataType, deltaData] of Object.entries(data || {})) {
      // (`🔄 DELTA SYNC: Processing ${ dataType }, deltaData: `, JSON.stringify(deltaData, null, 2));
      console.log(`🔄 DELTA SYNC: Checking ${dataType}: `, {
        hasDeltaData: !!deltaData,
        deltaDataType: typeof deltaData,
        hasItems: !!(deltaData && deltaData.items),
        itemsLength: deltaData?.items?.length || 0,
        firstItem: deltaData?.items?.[0] ? {
          id: deltaData.items[0].id,
          name: deltaData.items[0].name,
          updatedAt: deltaData.items[0].updatedAt
        } : null
      });

      // Check if this data type has items to process
      const hasValidData = deltaData && typeof deltaData === 'object' && deltaData.items && Array.isArray(deltaData.items) && deltaData.items.length > 0;

      console.log(`🔄 DELTA SYNC: ${dataType} hasValidData check: `, {
        deltaDataExists: !!deltaData,
        isObject: typeof deltaData === 'object',
        hasItemsProp: !!(deltaData && deltaData.items),
        itemsIsArray: Array.isArray(deltaData?.items),
        itemsLength: deltaData?.items?.length || 0,
        finalResult: hasValidData
      });

      if (hasValidData) {
        hasProcessedData = true;

        // Normalize incoming data
        let normalizedItems = deltaData.items;
        if (dataType === 'customers') {
          normalizedItems = deltaData.items.map(customer => normalizeCustomer(customer));
        } else if (dataType === 'products') {
          normalizedItems = deltaData.items.map(product => normalizeProduct(product));
        }

        // Get existing data from IndexedDB to compare
        const storeName = getStoreNameForDataType(dataType);
        if (storeName) {
          const existingItems = await getAllItems(storeName);

          // Check if incoming data is different from existing data
          let hasChanges = false;
          const itemsToUpdate = [];

          for (const incomingItem of normalizedItems) {

            // Find existing item by id or _id (MongoDB uses _id, local items use id)
            const existingItem = existingItems.find(item =>
              (item.id && incomingItem.id && item.id === incomingItem.id) ||
              (item._id && incomingItem._id && item._id === incomingItem._id) ||
              (item.id && incomingItem._id && item.id === incomingItem._id) ||
              (item._id && incomingItem.id && item._id === incomingItem.id)
            );

            if (!existingItem) {
              // New item - needs to be added
              //(`🔄 DELTA SYNC: ${ dataType } ${ incomingItem.id || incomingItem._id } (${ incomingItem.name || incomingItem.customerName || 'N/A' }) is NEW - will be added`);
              hasChanges = true;
              itemsToUpdate.push(incomingItem);
            } else {
              // Existing item - check if it has changed
              const isDifferent = compareDataItems(incomingItem, existingItem, dataType);
              if (isDifferent) {
                //(`🔄 DELTA SYNC: ${ dataType } ${ incomingItem.id || incomingItem._id } (${ incomingItem.name || incomingItem.customerName || 'N/A' }) has CHANGES - will be updated`);

                hasChanges = true;
                itemsToUpdate.push(incomingItem);
              } else {
                //(`🔄 DELTA SYNC: ${ dataType } ${ incomingItem.id || incomingItem._id } (${ incomingItem.name || incomingItem.customerName || 'N/A' }) is UNCHANGED - skipping update`);
              }
            }
          }

          if (hasChanges && itemsToUpdate.length > 0) {

            try {
              const saveResult = await syncToIndexedDB(storeName, itemsToUpdate, { merge: true });

              // Mark this data type as updated for timestamp tracking
              updatedDataTypes.add(dataType);

              // Return updated data for UI
              allData[dataType] = normalizedItems;
            } catch (error) {

            }
          } else {

            // Still return existing data for UI consistency
            allData[dataType] = existingItems;
          }
        } else {

        }
      } else {

      }
    }

    // Update last sync time ONLY for data types that were actually updated in IndexedDB

    //('🔄 DELTA SYNC: Data types with changes:', Array.from(updatedDataTypes));

    for (const dataType of updatedDataTypes) {
      const deltaData = data?.[dataType];
      if (deltaData && deltaData.updatedAt) {
        try {
          // Subtract 2 minutes from the updatedAt time to ensure we don't miss recent changes
          const adjustedTime = new Date(new Date(deltaData.updatedAt).getTime() - 2 * 60 * 1000).toISOString();
          //(`🔄 DELTA SYNC: ✅ Updating ${ dataType } fetch time to: `, adjustedTime, `(adjusted from ${ deltaData.updatedAt }, data was actually updated)`);
          await updateLastFetchTime(dataType, adjustedTime);
        } catch (error) {

        }
      } else {

      }
    }

    // Timestamp updates are handled above - only for data types that actually had updates

    // Load all data from IndexedDB to ensure we have the most recent data (after delta + full sync)
    // This ensures UI displays data through IndexedDB as requested

    const dataTypesToLoad = ['customers', 'products', 'orders', 'transactions', 'purchaseOrders', 'categories', 'refunds', 'plans', 'planOrders', 'staff', 'expenses', 'customerTransactions', 'suppliers', 'supplierTransactions'];
    for (const dataType of dataTypesToLoad) {
      const storeName = getStoreNameForDataType(dataType);
      if (storeName) {
        try {
          const indexedDBData = await getAllItems(storeName);
          allData[dataType] = normalizeDataByType(dataType, indexedDBData);

        } catch (error) {

          allData[dataType] = [];
        }
      }
    }

    // Timestamp updates are now handled above with precise logic

    // Handle full sync for data types that need it, or for new users with no data
    const shouldDoFullSync = (needsFullSync && needsFullSync.length > 0) ||
      (!hasProcessedData && !hasAnyUpdates); // New user with no data

    // Track full sync success for timestamp updates
    let fullSyncSucceeded = false;

    if (shouldDoFullSync) {

      // Perform full sync and save data to IndexedDB
      const auth = localStorage.getItem('auth');

      if (auth) {
        const online = await isOnline();
        if (online) {
          try {

            const fullSyncResult = await deduplicateRequest('full-sync-fallback', async () => {
              return await apiRequest('/data/all', { method: 'GET' });
            });
            //
            console.log('🔄 DELTA SYNC: API full sync result:', {
              success: fullSyncResult.success,
              hasData: !!fullSyncResult.data?.data,
              dataKeys: fullSyncResult.data?.data ? Object.keys(fullSyncResult.data.data) : []
            });

            if (fullSyncResult.success && fullSyncResult.data?.data) {
              //       // Check if API actually returned meaningful data (not empty objects/arrays)
              //       const dataKeys = Object.keys(fullSyncResult.data.data);
              //       const hasActualData = dataKeys.some(key => {
              //         const value = fullSyncResult.data.data[key];
              //         const isValidArray = Array.isArray(value) && value.length > 0;
              //         const isValidValue = !Array.isArray(value) && value != null;
              //         //(`🔄 DELTA SYNC: Full sync key '${key}': `, { value, isValidArray, isValidValue });
              //         return isValidArray || isValidValue;
              //       });
              //
              // Check if API actually returned meaningful data (not empty objects/arrays)
              const dataKeys = Object.keys(fullSyncResult.data.data);
              const hasActualData = dataKeys.some(key => {
                const value = fullSyncResult.data.data[key];
                const isValidArray = Array.isArray(value) && value.length > 0;
                const isValidValue = !Array.isArray(value) && value != null;

                return isValidArray || isValidValue;
              });

              if (hasActualData) {

                // Save full sync data to IndexedDB (this will overwrite/merge with delta data)
                const { customers, products, productBatches, orders, transactions, purchaseOrders, categories, refunds, plans, planOrders, staff, expenses, customerTransactions, suppliers, supplierTransactions, dProducts } = fullSyncResult.data.data;

                // Normalize data before syncing
                const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));
                const normalizedProducts = (products || []).map(product => normalizeProduct(product));
                const normalizedProductBatches = (productBatches || []).map(batch => normalizeProductBatch(batch));

                // Save to IndexedDB - FULL SYNC should REPLACE all existing data with fresh data from server
                // Use merge: false for full sync to ensure clean replacement
                await Promise.all([
                  normalizedCustomers.length > 0 ? syncToIndexedDB(STORES.customers, normalizedCustomers, { merge: false }) : Promise.resolve(),
                  normalizedProducts.length > 0 ? syncToIndexedDB(STORES.products, normalizedProducts, { merge: false }) : Promise.resolve(),
                  normalizedProductBatches.length > 0 ? syncToIndexedDB(STORES.productBatches, normalizedProductBatches, { merge: false }) : Promise.resolve(),
                  (orders && orders.length > 0) ? syncToIndexedDB(STORES.orders, orders, { merge: false }) : Promise.resolve(),
                  (transactions && transactions.length > 0) ? syncToIndexedDB(STORES.transactions, transactions, { merge: false }) : Promise.resolve(),
                  (purchaseOrders && purchaseOrders.length > 0) ? syncToIndexedDB(STORES.purchaseOrders, purchaseOrders, { merge: false }) : Promise.resolve(),
                  (categories && categories.length > 0) ? syncToIndexedDB(STORES.categories, categories, { merge: false }) : Promise.resolve(),
                  (refunds && refunds.length > 0) ? syncToIndexedDB(STORES.refunds, refunds, { merge: false }) : Promise.resolve(),
                  (plans && plans.length > 0) ? syncToIndexedDB(STORES.plans, plans, { merge: false }) : Promise.resolve(),
                  (planOrders && planOrders.length > 0) ? syncToIndexedDB(STORES.planOrders, planOrders, { merge: false }) : Promise.resolve(),
                  (staff && staff.length > 0) ? syncToIndexedDB(STORES.staff, staff, { merge: false }) : Promise.resolve(),
                  (expenses && expenses.length > 0) ? syncToIndexedDB(STORES.expenses, expenses, { merge: false }) : Promise.resolve(),
                  (customerTransactions && customerTransactions.length > 0) ? syncToIndexedDB(STORES.customerTransactions, customerTransactions, { merge: false }) : Promise.resolve(),
                  (suppliers && suppliers.length > 0) ? syncToIndexedDB(STORES.suppliers, suppliers, { merge: false }) : Promise.resolve(),
                  (supplierTransactions && supplierTransactions.length > 0) ? syncToIndexedDB(STORES.supplierTransactions, supplierTransactions, { merge: false }) : Promise.resolve(),
                  (dProducts && dProducts.length > 0) ? syncToIndexedDB(STORES.dProducts, dProducts, { merge: false }) : Promise.resolve()
                ]);

                fullSyncSucceeded = true;
                hasProcessedData = true;

                // Update allData with full sync data
                allData.customers = normalizedCustomers;
                allData.products = normalizedProducts;
                allData.productBatches = normalizedProductBatches;
                allData.orders = orders || [];
                allData.transactions = transactions || [];
                allData.purchaseOrders = purchaseOrders || [];
                allData.categories = categories || [];
                allData.refunds = refunds || [];
                allData.plans = plans || [];
                allData.planOrders = planOrders || [];
                allData.staff = staff || [];
                allData.expenses = expenses || [];
                allData.customerTransactions = customerTransactions || [];
                allData.suppliers = suppliers || [];
                allData.supplierTransactions = supplierTransactions || [];
                allData.dProducts = dProducts || [];

              } else {

              }
            } else {

            }
          } catch (apiError) {

          }
        } else {

        }
      }
    }

    // Timestamp updates are handled above - only for data types that actually had updates (needsUpdate = true)

    return allData;

  } catch (error) {

    // Fall back to full sync on any error
    return await fetchAllData();
  }
};

/**
 * Get IndexedDB store name for data type
 */
const getStoreNameForDataType = (dataType) => {
  const mapping = {
    customers: STORES.customers,
    products: STORES.products,
    productBatches: STORES.productBatches,
    categories: STORES.categories,
    orders: STORES.orders,
    transactions: STORES.transactions,
    purchaseOrders: STORES.purchaseOrders,
    refunds: STORES.refunds,
    plans: STORES.plans,
    planOrders: STORES.planOrders,
    expenses: STORES.expenses,
    staff: STORES.staff,
    customerTransactions: STORES.customerTransactions,
    suppliers: STORES.suppliers,
    supplierTransactions: STORES.supplierTransactions,
    dProducts: STORES.dProducts
  };
  return mapping[dataType];
};


/**
 * Update last sync time for all data types after successful sync
 */
const updateAllFetchTimes = async () => {
  try {
    const allDataTypes = ['customers', 'products', 'categories', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'plans', 'staff', 'expenses', 'customerTransactions', 'suppliers', 'supplierTransactions', 'dProducts'];
    // Subtract 2 minutes to avoid missing recent changes
    const adjustedTime = new Date(new Date().getTime() - 2 * 60 * 1000).toISOString();

    //('🔄 DELTA SYNC: Adjusted timestamp (2 min ago):', adjustedTime);

    for (const dataType of allDataTypes) {
      try {

        await updateLastFetchTime(dataType, adjustedTime);

      } catch (error) {

      }
    }

  } catch (error) {

  }
};

/**
 * Generate a hash from items array for duplicate detection
 */
const hashItems = (items, isVendorOrder = false) => {
  if (!Array.isArray(items) || items.length === 0) return '';

  if (isVendorOrder) {
    // Vendor orders use productName instead of name
    return JSON.stringify(items.map(i => ({
      productName: i.productName || i.name,
      quantity: i.quantity,
      price: i.price
    })).sort((a, b) => (a.productName || a.name || '').localeCompare(b.productName || b.name || '')));
  } else {
    // Orders use name, sellingPrice, costPrice
    return JSON.stringify(items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      sellingPrice: i.sellingPrice,
      costPrice: i.costPrice
    })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  }
};

/**
 * Check if two dates are within the same minute (for order duplicate detection)
 */
const isSameMinute = (date1, date2) => {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate() &&
    d1.getHours() === d2.getHours() &&
    d1.getMinutes() === d2.getMinutes();
};

// Check if two dates are within 5 seconds (for duplicate detection)
const isWithin5Seconds = (date1, date2) => {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const timeDiff = Math.abs(d1.getTime() - d2.getTime());
  return timeDiff <= 5000; // 5 seconds in milliseconds
};

/**
 * Check for duplicate item in batch
 */
const isDuplicateInBatch = (storeName, itemToInsert, itemsToInsert) => {
  if (storeName === STORES.products) {
    // Products: name + description OR barcode
    const productName = (itemToInsert.name || '').trim().toLowerCase();
    const productDescription = (itemToInsert.description || '').trim().toLowerCase();
    const productBarcode = (itemToInsert.barcode || '').trim();

    return itemsToInsert.some(p => {
      // Check for exact ID match first
      if (p.id === itemToInsert.id || p._id === itemToInsert.id || p.id === itemToInsert._id) return true;

      const existingName = (p.name || '').trim().toLowerCase();
      const existingDescription = (p.description || '').trim().toLowerCase();
      const existingBarcode = (p.barcode || '').trim();

      // Match by barcode if both have it
      if (productBarcode && existingBarcode && productBarcode === existingBarcode) return true;

      // Match by name + description
      return existingName === productName &&
        (existingDescription === productDescription ||
          (existingDescription === '' && productDescription === '') ||
          (existingDescription === null && productDescription === null) ||
          (existingDescription === undefined && productDescription === undefined));
    });
  } else if (storeName === STORES.productBatches) {
    // Product Batches: productId + batchNumber
    const productId = String(itemToInsert.productId || '');
    const batchNumber = (itemToInsert.batchNumber || '').trim().toLowerCase();

    return itemsToInsert.some(b => {
      // Check for exact ID match first
      if (b.id === itemToInsert.id || b._id === itemToInsert.id || b.id === itemToInsert._id) return true;

      // Check for localId match (sync resilience)
      if (itemToInsert.localId && (b.localId === itemToInsert.localId || b.id === itemToInsert.localId)) return true;
      if (itemToInsert._id && (b._id === itemToInsert._id || b.id === itemToInsert._id)) return true;

      const existingProductId = String(b.productId || '');
      const existingBatchNumber = (b.batchNumber || '').trim().toLowerCase();

      // Case 1: Perfect match
      if (existingProductId === productId && existingBatchNumber === batchNumber) return true;

      // Case 2: ID mismatch (local vs synced) but batch number and prices match
      // This is a strong indicator of a duplicate caused by product ID sync
      if (existingBatchNumber === batchNumber && batchNumber !== '') {
        const costDiff = Math.abs((b.costPrice || 0) - (itemToInsert.costPrice || 0));
        const sellingDiff = Math.abs((b.sellingUnitPrice || 0) - (itemToInsert.sellingUnitPrice || 0));

        // If prices are the same and it's the same seller, it's almost certainly the same logical batch
        if (costDiff < 0.01 && sellingDiff < 0.01) return true;
      }

      return false;
    });
  } else if (storeName === STORES.customers) {
    // Customers: Only check for ID match.
    // Duplicate check based on mobile number is REMOVED as requested.
    // Multiple customers can share the same mobile number.
    return itemsToInsert.some(c => {
      // Check for exact ID match first
      if (c.id === itemToInsert.id || c._id === itemToInsert.id || c.id === itemToInsert._id) return true;
      return false;
    });
  } else if (storeName === STORES.orders) {
    // Orders: ONLY check for exact ID match. 
    // It is perfectly valid to have separate orders with same content and timestamp.
    return itemsToInsert.some(o => {
      return (o.id && itemToInsert.id && o.id === itemToInsert.id) ||
        (o._id && itemToInsert._id && o._id === itemToInsert._id) ||
        (o.id && itemToInsert._id && o.id === itemToInsert._id) ||
        (o._id && itemToInsert.id && o._id === itemToInsert.id);
    });
  } else if (storeName === STORES.purchaseOrders) {
    // Vendor Orders: ONLY check for exact ID match.
    return itemsToInsert.some(po => {
      return (po.id && itemToInsert.id && po.id === itemToInsert.id) ||
        (po._id && itemToInsert._id && po._id === itemToInsert._id) ||
        (po.id && itemToInsert._id && po.id === itemToInsert._id) ||
        (po._id && itemToInsert.id && po._id === itemToInsert.id);
    });
  }

  return false;
};

/**
 * Sync backend data to IndexedDB
 * Clears existing synced data and inserts fresh MongoDB data
 * Preserves unsynced local changes (isSynced === false) to prevent data loss
 * Gracefully handles IndexedDB unavailability (private browsing, storage quota, etc.)
 * 
 * @param {string} storeName - Name of the store
 * @param {Array} backendItems - Items from backend
 * @param {Object} options - Options { merge: boolean }
 */
const syncToIndexedDB = async (storeName, backendItems, options = {}) => {
  const { merge = false } = options;

  try {
    // Validate backend data before proceeding
    if (!backendItems || !Array.isArray(backendItems)) {

      return;
    }

    // Check if IndexedDB is available before attempting sync
    const indexedDBAvailable = await isIndexedDBAvailable();
    if (!indexedDBAvailable) {

      // Don't return here - try the operation anyway since the availability check can be unreliable
    }

    //(`🔄[syncToIndexedDB] Syncing ${ storeName } with ${ backendItems.length } items from MongoDB(Merge: ${ merge })`);

    // Step 1: Get existing items from IndexedDB to preserve unsynced local changes
    // Only needed if we are clearing the store (not merging)
    let unsyncedItems = [];
    if (!merge) {
      const existingItems = await getAllItems(storeName);
      unsyncedItems = existingItems.filter(item => item.isSynced === false || item.isSynced === 'false' || !item.isSynced);

      if (unsyncedItems.length > 0) {
        console.log(`[SYNC DEBUG] Found ${unsyncedItems.length} unsynced items in ${storeName} before clearing:`,
          unsyncedItems.map(i => ({ id: i.id, name: i.name, isSynced: i.isSynced }))
        );
      }

      // Note: Removed validation that prevented clearing IndexedDB when backend returns empty array
      // The backend returning empty data means the collection should be empty (e.g., all items deleted)
      // We should always trust the backend data as authoritative

      // Step 4: Clear all existing data from IndexedDB

      await clearAllItems(storeName);

    }

    // Step 4: Normalize and prepare all MongoDB items for insertion (with duplicate checking)
    const itemsToInsert = [];
    let duplicateCount = 0;

    for (const backendItem of backendItems) {
      // Normalize data based on store type
      let normalizedItem = backendItem;
      if (storeName === STORES.customers) {
        normalizedItem = normalizeCustomer(backendItem);
      } else if (storeName === STORES.products) {
        normalizedItem = normalizeProduct(backendItem);
      }

      const key = normalizedItem.localId || normalizedItem._id || normalizedItem.id;

      // Prepare item for insertion with proper structure
      const itemToInsert = {
        ...normalizedItem,
        id: key, // Use localId as primary key if available to preserve relationships
        localId: key, // Ensure localId is set
        _id: normalizedItem._id || (normalizedItem.id !== key ? normalizedItem.id : undefined), // Store mongoId in _id
        isSynced: normalizedItem.isSynced !== undefined ? normalizedItem.isSynced : true
      };

      // For orders, explicitly preserve splitPaymentDetails to ensure it matches MongoDB exactly
      if (storeName === STORES.orders) {
        // Always preserve splitPaymentDetails if it exists in backend response
        if ('splitPaymentDetails' in backendItem) {
          // Deep clone to ensure nested object is preserved
          if (backendItem.splitPaymentDetails && typeof backendItem.splitPaymentDetails === 'object') {
            itemToInsert.splitPaymentDetails = JSON.parse(JSON.stringify(backendItem.splitPaymentDetails));
          } else {
            itemToInsert.splitPaymentDetails = backendItem.splitPaymentDetails;
          }

          // Debug logging for split payment orders
          if (backendItem.paymentMethod === 'split') {
            console.log(`[syncToIndexedDB] Preserving splitPaymentDetails for order ${itemToInsert.id}: `, {
              backend: backendItem.splitPaymentDetails,
              preserved: itemToInsert.splitPaymentDetails,
              itemToInsertKeys: Object.keys(itemToInsert)
            });
          }
        } else if (backendItem.paymentMethod === 'split') {

        }
      }

      // Check for duplicates in batch before inserting
      if (isDuplicateInBatch(storeName, itemToInsert, itemsToInsert)) {
        duplicateCount++;
        console.warn(`⚠️ Duplicate ${storeName} in MongoDB batch(skipping): `, {
          id: itemToInsert.id,
          name: itemToInsert.name || itemToInsert.supplierName || 'N/A'
        });
        continue; // Skip duplicate
      }

      itemsToInsert.push(itemToInsert);
    }

    if (duplicateCount > 0) {

    }

    // SAFEGUARD: When merging (incremental sync), do NOT overwrite local items that are unsynced
    // This prevents reverting local changes (like stock reduction) when backend data is stale
    let finalItemsToInsert = itemsToInsert;
    if (merge && itemsToInsert.length > 0) {
      try {
        const existingItems = await getAllItems(storeName);
        const unsyncedMap = new Map(); // Map to store unsynced items by their IDs

        existingItems.forEach(item => {
          if (item && item.isSynced === false) {
            if (item.id) unsyncedMap.set(String(item.id), item);
            if (item._id) unsyncedMap.set(String(item._id), item);
            if (item.localId) unsyncedMap.set(String(item.localId), item);
          }
        });

        if (unsyncedMap.size > 0) {
          const originalCount = finalItemsToInsert.length;
          finalItemsToInsert = finalItemsToInsert.filter(backendItem => {
            const backendItemId = String(backendItem.id || backendItem._id);
            const unsyncedLocalItem = unsyncedMap.get(backendItemId);

            // Rule 1: If there's an unsynced local item with the same ID
            if (unsyncedLocalItem) {
              const localTime = unsyncedLocalItem.updatedAt ? new Date(unsyncedLocalItem.updatedAt).getTime() : 0;
              const serverTime = backendItem.updatedAt ? new Date(backendItem.updatedAt).getTime() : 0;

              // If Server is >= Local, it means Server caught up. Accept Server item.
              // So, we don't filter out the backend item.
              if (serverTime >= localTime) {
                // console.log(`[syncToIndexedDB] ✅ Backend caught up for ${backendItemId}. Accepting synced version.`);
                return true; // Keep the backend item
              }

              // If Local is newer, reject the backend item to preserve local changes.
              // console.log(`[syncToIndexedDB] 🛡️ Preserving local unsynced item ${backendItemId} (local is newer).`);
              return false; // Reject backend item (Local is newer)
            }
            return true; // No unsynced local item with this ID, so keep the backend item
          });

          if (finalItemsToInsert.length < originalCount) {
            console.log(`[syncToIndexedDB] 🛡️ Preserved ${originalCount - finalItemsToInsert.length} unsynced local items from overwrite in ${storeName}`);
          }
        }
      } catch (checkError) {
        console.error('Error checking for unsynced conflicts:', checkError);
      }
    }

    // Step 5: Insert all MongoDB items
    if (finalItemsToInsert.length > 0) {

      if (merge) {

        const mergeResult = await updateMultipleItems(storeName, finalItemsToInsert, true); // Skip validation for backend data

      } else {

        const insertResult = await addMultipleItems(storeName, finalItemsToInsert, true); // Skip validation for backend data

      }
    } else {

    }

    // Step 6: Re-insert unsynced local items (preserve local changes)
    // Use updateItem (put) to handle potential ID conflicts with MongoDB items
    if (unsyncedItems.length > 0) {
      let discardedCount = 0;
      for (const unsyncedItem of unsyncedItems) {
        try {
          // Check if this unsynced item is already present in the backend items (match by ID or localId)
          // This handles the case where a temporary frontend ID has been swapped for a MongoDB ObjectId
          const matchingBackendItem = finalItemsToInsert.find(i =>
            String(i.id) === String(unsyncedItem.id) ||
            String(i._id) === String(unsyncedItem.id) ||
            (i.localId && String(i.localId) === String(unsyncedItem.id)) ||
            (unsyncedItem._id && String(i.id) === String(unsyncedItem._id)) ||
            (unsyncedItem._id && i.localId && String(i.localId) === String(unsyncedItem._id))
          );

          if (matchingBackendItem) {
            console.log(`[SYNC DEBUG] Unsynced item ${unsyncedItem.name} (${unsyncedItem.id}) matched backend item ${matchingBackendItem.id}.`,
              { localId: matchingBackendItem.localId, serverTime: matchingBackendItem.updatedAt, localTime: unsyncedItem.updatedAt }
            );
            // IDs differ (e.g. Local 'temp-1' vs Backend 'real-1'), so delete the old local key
            if (String(matchingBackendItem.id) !== String(unsyncedItem.id)) {
              console.log(`[syncToIndexedDB] 🗑️ Cleaning up replaced local ID ${unsyncedItem.id} in favor of ${matchingBackendItem.id} for ${storeName}`);
              await deleteItem(storeName, unsyncedItem.id);

              // Merge and update
              const mergedItem = { ...matchingBackendItem, ...unsyncedItem, id: matchingBackendItem.id };
              console.log(`[SYNC DEBUG] Merged item ${mergedItem.name} has isSynced: ${mergedItem.isSynced}`);
              await updateItem(storeName, mergedItem, true);
              discardedCount++;
              continue;
            }

            // If IDs are the same, check timestamps.
            // If Backend has caught up (time >= local), we DON'T need to re-insert the unsynced local version.
            // We can let the Backend version (already in 'itemsToInsert') stay.
            if (matchingBackendItem) {
              const localTime = new Date(unsyncedItem.updatedAt || unsyncedItem.createdAt || 0).getTime();
              const serverTime = new Date(matchingBackendItem.updatedAt || matchingBackendItem.createdAt || 0).getTime();

              // Only discard local unsynced copy if backend is STRICTLY NEWER
              // If timestamps are equal, preserve local unsynced to be safe
              if (serverTime > localTime) {
                // Backend is up to date. Discard local unsynced copy in favor of backend.
                console.log(`[SYNC DEBUG] ⏩ Discarding local unsynced copy of ${unsyncedItem.name} (${unsyncedItem.id}) in favor of newer backend item (${matchingBackendItem.id})`);
                discardedCount++;
                continue;
              }
            }

            // If IDs are the same AND local is newer, Fall through to updateItem below to overwrite.
          }

          console.log(`[SYNC DEBUG] Re-inserting unsynced item ${unsyncedItem.name} (${unsyncedItem.id}) with isSynced: ${unsyncedItem.isSynced}`);
          await updateItem(storeName, unsyncedItem, true); // Use put to handle conflicts
        } catch (error) {
          // Error re-inserting unsynced item
        }
      }
    }

    // Post-sync cleanup for specific stores
    if (storeName === STORES.customers) {
      await cleanupDuplicateCustomers();
    }
  } catch (error) {
    // Handle IndexedDB errors gracefully - don't crash the app
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    if (errorMessage.includes('Internal error opening backing store') ||
      errorMessage.includes('UnknownError') ||
      errorMessage.includes('QuotaExceededError')) {

      return; // Don't throw - allow app to continue with in-memory data
    } else {

      // Only throw for unexpected errors, not storage-related ones
      throw error;
    }
  }
};

/**
 * Fetch latest data for specified data types based on timestamps
 * @param {Object} timestamps - Object with dataType: timestamp pairs
 * @returns {Promise<Object>} Latest data for each type
 */
export const fetchLatestData = async (timestamps = {}) => {
  try {

    const online = await isOnline();
    if (!online) {

      return {};
    }

    const result = await apiRequest('/data/latest-fetch', {
      method: 'POST',
      body: { timestamps }
    });

    if (!result.success) {

      return {};
    }

    const latestData = result.data || {};
    //('🔄 LATEST FETCH: Received latest data:', Object.keys(latestData));

    // Process and normalize the data
    const processedData = {};

    for (const [dataType, dataInfo] of Object.entries(latestData)) {
      if (dataInfo && dataInfo.data && Array.isArray(dataInfo.data)) {
        let normalizedItems = dataInfo.data;

        // Apply normalization based on data type
        switch (dataType) {
          case 'customers':
            normalizedItems = dataInfo.data.map(customer => normalizeCustomer(customer));
            break;
          case 'products':
            normalizedItems = dataInfo.data.map(product => normalizeProduct(product));
            break;
          default:
            // No special normalization needed for other types
            break;
        }

        processedData[dataType] = {
          count: dataInfo.count || normalizedItems.length,
          data: normalizedItems,
          timestamp: dataInfo.timestamp
        };

      }
    }

    return processedData;

  } catch (error) {

    return {};
  }
};

/**
 * Merge latest data into existing IndexedDB data
 * @param {Object} latestData - Latest data from API
 * @param {Object} options - Options for merging
 */
export const mergeLatestDataToIndexedDB = async (latestData, options = {}) => {
  const { updateFetchTimes = true } = options;

  try {
    //('🔄 MERGE LATEST: Merging latest data to IndexedDB:', Object.keys(latestData));

    for (const [dataType, dataInfo] of Object.entries(latestData)) {
      if (dataInfo && dataInfo.data && Array.isArray(dataInfo.data) && dataInfo.data.length > 0) {
        const storeName = getStoreNameForDataType(dataType);

        if (storeName) {

          // Use merge: true to update existing records and add new ones
          await syncToIndexedDB(storeName, dataInfo.data, { merge: true });

          // Update fetch time if requested (subtract 2 minutes to avoid missing recent changes)
          if (updateFetchTimes && dataInfo.timestamp) {
            const adjustedTime = new Date(new Date(dataInfo.timestamp).getTime() - 2 * 60 * 1000).toISOString();
            await updateLastFetchTime(dataType, adjustedTime);
          }

        }
      }
    }

    return true;

  } catch (error) {

    return false;
  }
};

/**
 * Get timestamps for latest fetch (from IndexedDB sync tracking)
 * @returns {Promise<Object>} Timestamps object for API call
 */
export const getLatestFetchTimestamps = async () => {
  try {
    const fetchTimes = await getLastFetchTimesForAPI();

    // Filter out null/undefined timestamps and ensure they're valid dates
    const validTimestamps = {};
    for (const [dataType, timestamp] of Object.entries(fetchTimes)) {
      if (timestamp && timestamp !== 'null' && timestamp !== null) {
        try {
          // Ensure it's a valid date string
          const date = new Date(timestamp);
          if (!isNaN(date.getTime())) {
            validTimestamps[dataType] = timestamp;
          }
        } catch (e) {

        }
      }
    }

    return validTimestamps;

  } catch (error) {

    return {};
  }
};

/**
 * Fetch all latest data since a specific timestamp
 * @param {string} lastFetchTime - ISO timestamp string
 * @returns {Promise<Object>} All updated data since the timestamp
 */
export const fetchAllLatestData = async (lastFetchTime) => {
  try {
    const online = await isOnline();
    if (!online) {
      return {};
    }

    // Use timestamps for each data type from IndexedDB
    // This provides much better granularity than a single lastFetchTime
    const timestamps = await getLatestFetchTimestamps();

    // Use the POST endpoint which supports per-type timestamps
    return await fetchLatestData(timestamps);

  } catch (error) {
    console.error('Fetch all latest data error:', error);
    return {};
  }
};
/**
 * Get the earliest lastFetchTime across all data types
 * @returns {Promise<string|null>} Earliest timestamp or null if none exists
 */
export const getEarliestLastFetchTime = async () => {
  try {
    const allTracking = await getAllSyncTracking();
    if (allTracking.length === 0) return null;

    const timestamps = allTracking
      .map(tracking => tracking.lastFetchTime)
      .filter(timestamp => timestamp && timestamp !== 'null')
      .sort();

    return timestamps.length > 0 ? timestamps[0] : null;
  } catch (error) {

    return null;
  }
};

/**
 * Fetch MongoDB sync tracking document for the current seller
 * @returns {Promise<Object|null>} Sync tracking document or null
 */
export const fetchMongoDBSyncTracking = async () => {
  try {

    const online = await isOnline();
    if (!online) {

      return null;
    }

    const result = await apiRequest('/data/sync-tracking', {
      method: 'GET'
    });

    if (!result.success) {

      return null;
    }

    return result.data;
  } catch (error) {

    return null;
  }
};

/**
 * Compare MongoDB latest update times with IndexedDB last fetch times
 * @param {Object} mongoTracking - MongoDB sync tracking document
 * @param {Object} indexedDBTimes - IndexedDB last fetch times
 * @returns {Object} Comparison results and data types that need updating
 */
export const compareSyncTimestamps = (mongoTracking, indexedDBTimes) => {
  const dataTypesToFetch = {};
  const comparison = {};

  // Data types to check for updates
  const dataTypes = ['customers', 'products', 'categories', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'plans', 'planOrders', 'staff', 'expenses', 'suppliers', 'supplierTransactions', 'dProducts'];

  // Map data types to their corresponding names in the API response
  const dataTypeMapping = {
    customers: 'customers',
    products: 'products',
    categories: 'categories',
    orders: 'orders',
    transactions: 'transactions',
    purchaseOrders: 'vendorOrders', // API uses 'vendorOrders' but we use 'purchaseOrders'
    refunds: 'refunds',
    plans: 'plans',
    // planOrders removed - using planDetails for limits and usage
    staff: 'staff',
    expenses: 'expenses',
    suppliers: 'suppliers',
    supplierTransactions: 'supplierTransactions',
    dProducts: 'dProducts'
  };

  for (const dataType of dataTypes) {
    const apiDataType = dataTypeMapping[dataType];
    const mongoData = mongoTracking?.[apiDataType];
    const mongoTime = mongoData?.latestUpdateTime;
    const indexedDBTime = indexedDBTimes[dataType];

    comparison[dataType] = {
      mongoLatestUpdateTime: mongoTime,
      indexedDBLastFetchTime: indexedDBTime,
      needsUpdate: false,
      reason: null
    };

    if (!mongoTime) {
      comparison[dataType].reason = 'No MongoDB timestamp';
      continue;
    }

    if (!indexedDBTime) {
      comparison[dataType].reason = 'No IndexedDB timestamp';
      comparison[dataType].needsUpdate = true;
      dataTypesToFetch[dataType] = mongoTime;
      continue;
    }

    const mongoDate = new Date(mongoTime);
    const indexedDBDate = new Date(indexedDBTime);

    if (mongoDate > indexedDBDate) {
      comparison[dataType].needsUpdate = true;
      comparison[dataType].reason = `MongoDB(${mongoTime}) > IndexedDB(${indexedDBTime})`;
      dataTypesToFetch[dataType] = mongoTime;
    } else {
      comparison[dataType].reason = `IndexedDB(${indexedDBTime}) >= MongoDB(${mongoTime})`;
    }
  }

  return {
    comparison,
    dataTypesToFetch,
    hasUpdates: Object.keys(dataTypesToFetch).length > 0
  };
};

/**
 * Fetch latest data for only the specified data types
 * @param {Object} dataTypesToFetch - Object mapping dataType to timestamp
 * @returns {Promise<Object>} Latest data response
 */
export const fetchSelectiveLatestData = async (dataTypesToFetch) => {
  try {
    //('🔄 FETCH SELECTIVE: Getting data for specific types:', Object.keys(dataTypesToFetch));

    const online = await isOnline();
    if (!online) {

      return {};
    }

    // Create query parameters for selective fetch
    const queryParams = new URLSearchParams();
    for (const [dataType, timestamp] of Object.entries(dataTypesToFetch)) {
      queryParams.append(`${dataType} LastFetchTime`, timestamp);
    }

    const result = await apiRequest(`/ data / fetch - selective ? ${queryParams.toString()} `, {
      method: 'GET'
    });

    if (!result.success) {

      return {};
    }

    const latestData = result.data || {};
    //('🔄 FETCH SELECTIVE: Received data:', Object.keys(latestData));

    // Process and normalize the data - API returns {items, count, updatedAt} format
    const processedData = {};
    for (const [dataType, dataObj] of Object.entries(latestData)) {
      if (dataObj && dataObj.items && Array.isArray(dataObj.items) && dataObj.items.length > 0) {
        let normalizedItems = dataObj.items;

        // Apply normalization based on data type
        switch (dataType) {
          case 'customers':
            normalizedItems = dataObj.items.map(customer => normalizeCustomer(customer));
            break;
          case 'products':
            normalizedItems = dataObj.items.map(product => normalizeProduct(product));
            break;
          // Add other normalizations as needed
        }

        processedData[dataType] = {
          data: normalizedItems,
          timestamp: dataObj.updatedAt || dataTypesToFetch[dataType] || new Date().toISOString()
        };
      }
    }

    return processedData;
  } catch (error) {

    return {};
  }
};

/**
 * Auto-refresh latest data (called on page refresh)
 * @returns {Promise<Object>} Refresh result
 */
// Track how many times autoRefreshLatestData is called
// Singleton promise to prevent double API calls
let refreshPromise = null;

let autoRefreshCallCount = 0;

export const autoRefreshLatestData = async (dispatch, ActionTypes, lastFetchTimesArg) => {
  // If a refresh is already in progress, return that promise to avoid duplicate calls
  if (refreshPromise) {
    console.log('🔄 AUTO REFRESH: Reusing in-flight refresh promise...');
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      autoRefreshCallCount++;
      // console.log('🔄🔄🔄 AUTO REFRESH LATEST DATA STARTED - Call #' + autoRefreshCallCount);

      // Check if user is authenticated
      const auth = localStorage.getItem('auth');

      if (!auth) {
        console.log('🔄 AUTO REFRESH: No authentication found, skipping');
        return { success: true, message: 'No authentication', data: {}, recordsProcessed: 0, dataTypesUpdated: 0 };
      }

      const isOnlineStatus = await isOnline();
      // console.log('🔄 AUTO REFRESH: Online status:', isOnlineStatus);

      if (!isOnlineStatus) {
        console.log('🔄 AUTO REFRESH: Offline, skipping API call');
        return { success: true, message: 'Offline', data: {}, recordsProcessed: 0, dataTypesUpdated: 0 };
      }

      // Ensure sync tracking is initialized
      await initializeSyncTracking();

      // Get last fetch times from IndexedDB
      // Use passed argument if available (from loadData), otherwise fetch fresh
      const lastFetchTimes = lastFetchTimesArg || await getLastFetchTimesForAPI();
      // console.log('🔄 AUTO REFRESH: Last fetch times:', lastFetchTimes);

      const requestBody = { lastFetchTimes };
      // console.log('🔄 AUTO REFRESH: About to call /data/all API with body:', requestBody);

      const result = await apiRequest('/data/all', {
        method: 'POST',
        body: requestBody // apiRequest handles JSON.stringify
      });
      return result;
    } finally {
      // Clear promise so next call can proceed
      refreshPromise = null;
    }
  })();

  try {
    const result = await refreshPromise;

    // Use the result for further processing
    if (!result || !result.success) {
      console.log('🔄 AUTO REFRESH: API call failed or returned unsuccesful', result);
      if (result && result.planInvalid) {
        return {
          success: false,
          planInvalid: true,
          message: result.message || 'Plan expired',
          planStatus: result.planStatus
        };
      }
      return { success: false, message: result?.message || 'Failed to fetch updates' };
    }

    // console.log('🔄 AUTO REFRESH: API call completed, result:', result);

    if (!result.success && !result.planInvalid) {
      console.log('🔄 AUTO REFRESH: API call failed:', result.error);
      return {
        success: false,
        message: result.error || 'API call failed'
      };
    }

    // Treat planInvalid with data as a successful call for data retrieval purposes (read-only mode)
    const response = result.data;
    // console.log('🔄 AUTO REFRESH: Response data:', response);

    // Track if plan is invalid for later notification
    const isPlanInvalid = response.planInvalid === true;

    // Check if backend says no updates needed
    if (response.needUpdate === false) {

      return {
        success: true,
        message: 'Data is up to date',
        data: {},
        recordsProcessed: 0,
        dataTypesUpdated: 0,
        needUpdate: false,
        planInvalid: isPlanInvalid // Pass through plan status
      };
    }

    // If plan is invalid but no data returned, return error
    if (isPlanInvalid && (!response.data || Object.keys(response.data).length === 0)) {

      return {
        success: false,
        planInvalid: true,
        message: response.message || 'Your plan has expired. Please upgrade to continue.',
        planStatus: response.planStatus
      };
    }

    // Backend returned data - update IndexedDB and UI
    if (response.data && typeof response.data === 'object') {
      const receivedCollections = Object.keys(response.data);
      //(`🔄 AUTO REFRESH: 📥 Data received from server - updating ${ receivedCollections.length } collections: ${ receivedCollections.join(', ') } `);
      //(`🔄 AUTO REFRESH: Total records received: ${ Object.values(response.data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) } `);

      // Check if productBatches are included
      if (response.data.productBatches && Array.isArray(response.data.productBatches)) {

      } else {

      }

      const dataTypesToUpdate = ['customers', 'products', 'productBatches', 'orders', 'transactions', 'purchaseOrders', 'categories', 'refunds', 'plans', 'expenses', 'customerTransactions', 'suppliers', 'supplierTransactions', 'dProducts'];
      const updatedData = {};
      let totalRecordsProcessed = 0;

      // Update each data type in IndexedDB
      for (const dataType of dataTypesToUpdate) {
        // Handle both direct arrays (API response format) and nested objects (internal format)
        let items = null;
        if (Array.isArray(response.data[dataType])) {
          // Direct array format from API
          items = response.data[dataType];

        } else if (response.data[dataType] && response.data[dataType].data && Array.isArray(response.data[dataType].data)) {
          // Nested object format (internal)
          items = response.data[dataType].data;

        }

        if (items && items.length > 0) {

          if (dataType === 'productBatches') {

          }

          // Normalize data
          let normalizedItems = items;
          if (dataType === 'customers') {
            normalizedItems = items.map(customer => normalizeCustomer(customer));
          } else if (dataType === 'products') {
            normalizedItems = items.map(product => normalizeProduct(product));
          } else if (dataType === 'productBatches') {

            normalizedItems = items.map(batch => normalizeProductBatch(batch));

          }

          // Update IndexedDB (merge: false for full replacement)
          const storeName = getStoreNameForDataType(dataType);

          if (storeName) {
            try {

              const syncResult = await syncToIndexedDB(storeName, normalizedItems, { merge: false });

              // Verify the data was actually saved
              if (dataType === 'productBatches') {
                const { getAllItems } = await import('../utils/indexedDB');
                const savedBatches = await getAllItems(storeName);

                if (savedBatches.length > 0) {

                }
              }

              // Prepare data for UI update (match the format expected by AppContext)
              updatedData[dataType] = {
                data: normalizedItems,
                timestamp: new Date().toISOString()
              };
              totalRecordsProcessed += normalizedItems.length;

            } catch (error) {

            }
          }
        }
      }

      // Update last fetch times only for data types that were actually updated
      const currentTime = new Date().toISOString();
      const updatedDataTypes = Object.keys(updatedData);
      //(`🔄 AUTO REFRESH: Updating lastFetchTime for ${ updatedDataTypes.length } collections: ${ updatedDataTypes.join(', ') } `);

      for (const dataType of updatedDataTypes) {
        try {
          await updateLastFetchTime(dataType, currentTime);

          if (dataType === 'productBatches') {

          }
        } catch (error) {

        }
      }

      const dataTypesUpdated = Object.keys(updatedData).length;

      return {
        success: true,
        message: `Data sync completed - ${dataTypesUpdated} data types updated(${totalRecordsProcessed} records)`,
        data: updatedData,
        recordsProcessed: totalRecordsProcessed,
        dataTypesUpdated: dataTypesUpdated,
        needUpdate: true,
        planInvalid: isPlanInvalid, // Pass through plan status
        planUsageSummary: response.planUsageSummary, // Pass through aggregated usage
        planDetails: response.planDetails // Pass through individual plan details
      };
    }

    // Unexpected response format

    return { success: false, message: 'Unexpected API response' };

  } catch (error) {

    return { success: false, message: error.message || 'Unknown error during sync' };
  }
};

/**
 * Update inventory after a sale (reduce product stock and batch quantities)
 */
export const updateInventoryAfterSale = async (order) => {
  try {

    if (!order.items || order.items.length === 0) {

      return { success: true, message: 'No items to update' };
    }

    // Get current products and batches from IndexedDB
    const [currentProducts, currentBatches] = await Promise.all([
      getAllItems(STORES.products),
      getAllItems(STORES.productBatches)
    ]);

    // Create maps for quick lookup
    const productMap = new Map();
    const batchMap = new Map();

    currentProducts.forEach(product => {
      productMap.set(product.id || product._id, product);
    });

    currentBatches.forEach(batch => {
      const productId = batch.productId;
      if (!batchMap.has(productId)) {
        batchMap.set(productId, []);
      }
      batchMap.get(productId).push(batch);
    });

    // Process each order item
    const updatedProducts = [];
    const updatedBatches = [];

    for (const orderItem of order.items) {
      const productId = orderItem.productId || orderItem.id;
      const quantitySold = orderItem.quantity || 0;

      if (!productId || quantitySold <= 0) {
        continue;
      }

      // Update product stock - ROBUST LOOKUP
      // Find product by id, _id, or localId matching the order item's productId
      let product = productMap.get(productId);

      // If direct map lookup failed, try searching by values (in case order used _id but map key is id, etc.)
      if (!product) {
        product = currentProducts.find(p =>
          p.id === productId ||
          p._id === productId ||
          p.localId === productId
        );
      }

      if (product) {
        const newStock = Math.max(0, (product.stock || 0) - quantitySold);
        const updatedProduct = {
          ...product,
          stock: newStock,
          quantity: newStock, // Keep both fields in sync
          updatedAt: new Date().toISOString(),
          isSynced: product.isSynced // Preserve sync status
        };

        updatedProducts.push(updatedProduct);
      } else {
        console.warn(`[updateInventoryAfterSale] Could not find product for order item: ${productId}`);
      }

      // Update batch quantities (FIFO - First In, First Out)
      // Robustly find batches for this product
      let productBatches = batchMap.get(productId);

      // If not found by direct key, try searching all batches that match the actual found product's IDs
      if ((!productBatches || productBatches.length === 0) && product) {
        productBatches = currentBatches.filter(b =>
          b.productId === product.id ||
          b.productId === product._id ||
          (product.localId && b.productId === product.localId)
        );
      }

      productBatches = productBatches || [];

      // Sort batches by creation date (oldest first) for FIFO
      // productBatches.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

      let remainingQuantity = quantitySold;

      for (const batch of productBatches) {
        if (remainingQuantity <= 0) break;

        const batchReduction = Math.min(batch.quantity || 0, remainingQuantity);
        if (batchReduction > 0) {
          const newBatchQuantity = Math.max(0, (batch.quantity || 0) - batchReduction);
          const updatedBatch = {
            ...batch,
            quantity: newBatchQuantity,
            updatedAt: new Date().toISOString(),
            isSynced: false // Mark as unsynced so it syncs to MongoDB
          };

          updatedBatches.push(updatedBatch);
          remainingQuantity -= batchReduction;
        }
      }

      if (remainingQuantity > 0) {
        // console.warn(`⚠️ Batch stock exhausted for product ${productId}. Remaining unsatisified: ${remainingQuantity}`);
      }
    }

    // Update IndexedDB with the changes using updateMultipleItems directly
    // This avoids syncToIndexedDB's behavior of marking items as already synced
    if (updatedProducts.length > 0) {
      await updateMultipleItems(STORES.products, updatedProducts);
    }

    if (updatedBatches.length > 0) {
      await updateMultipleItems(STORES.productBatches, updatedBatches);
    }

    // Register background sync if any inventory updates were pending sync
    if (updatedProducts.length > 0 || updatedBatches.length > 0) {
      registerBackgroundSync();
    }

    console.log('📊 Final inventory status:', {
      updatedProducts: updatedProducts.map(p => ({ name: p.name, newStock: p.stock })),
      updatedBatches: updatedBatches.map(b => ({ id: b.id, newQuantity: b.quantity }))
    });

    return {
      success: true,
      updatedProducts: updatedProducts,
      updatedBatches: updatedBatches
    };

  } catch (error) {

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Update product and batch inventory after a refund
 * Increases stock levels for the refunded items
 */
export const updateInventoryAfterRefund = async (refund) => {
  try {
    const products = await getAllItems(STORES.products);
    const batches = await getAllItems(STORES.productBatches);

    const productMap = new Map();
    products.forEach(p => {
      const id = (p._id || p.id || '').toString();
      if (id) productMap.set(id, p);
    });

    // Group batches by productId
    const batchMap = new Map();
    batches.forEach(b => {
      const pid = (b.productId || '').toString();
      if (!pid) return;
      if (!batchMap.has(pid)) {
        batchMap.set(pid, []);
      }
      batchMap.get(pid).push(b);
    });

    const updatedProducts = [];
    const updatedBatches = [];

    for (const refundItem of refund.items) {
      const productId = (refundItem.productId || '').toString();
      const quantityToReturn = Number(refundItem.qty) || 0;

      if (!productId || quantityToReturn <= 0) {
        continue;
      }

      // Update product stock
      const product = productMap.get(productId);
      if (product) {
        const currentStock = Number(product.stock || product.quantity || 0);
        const newStock = currentStock + quantityToReturn;
        const updatedProduct = {
          ...product,
          stock: newStock,
          quantity: newStock,
          updatedAt: new Date().toISOString(),
          isSynced: false
        };
        updatedProducts.push(updatedProduct);
      }

      // Update batch quantities
      const productBatches = batchMap.get(productId) || [];
      if (productBatches.length > 0) {
        let targetBatch = null;

        // If specific batchId is provided, use it
        if (refundItem.batchId) {
          targetBatch = productBatches.find(b =>
            (b._id || b.id || '').toString() === refundItem.batchId.toString()
          );
        }

        // Fallback to latest batch if no batchId or batch not found
        if (!targetBatch) {
          // Sort batches by expiry/mfg/createdAt descending to find the "latest" one
          const sortedBatches = [...productBatches].sort((a, b) => {
            const dateA = new Date(a.expiry || a.createdAt || 0).getTime();
            const dateB = new Date(b.expiry || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          targetBatch = sortedBatches[0];
        }

        if (targetBatch) {
          const currentQty = Number(targetBatch.quantity || 0);
          const updatedBatch = {
            ...targetBatch,
            quantity: currentQty + quantityToReturn,
            updatedAt: new Date().toISOString(),
            isSynced: false
          };
          updatedBatches.push(updatedBatch);
        }
      }
    }

    if (updatedProducts.length > 0) {
      await updateMultipleItems(STORES.products, updatedProducts);
    }
    if (updatedBatches.length > 0) {
      await updateMultipleItems(STORES.productBatches, updatedBatches);
    }

    return {
      success: true,
      updatedProducts,
      updatedBatches
    };
  } catch (error) {
    console.error('Error updating inventory after refund:', error);
    return { success: false, error: error.message };
  }
};

export { syncToIndexedDB, normalizeProductBatch };

export default {
  isOnline,
  fetchCustomers,
  fetchProducts,
  fetchOrders,
  fetchTransactions,
  fetchVendorOrders,
  fetchCategories,
  fetchExpenses,
  fetchAllData,
  syncToIndexedDB,
  autoRefreshLatestData,
  updateInventoryAfterSale,
  updateInventoryAfterRefund,
  normalizeProductBatch
};
