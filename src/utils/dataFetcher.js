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
  getAllSyncTracking
} from './indexedDB';

// ==================== REQUEST DEDUPLICATION ====================
// Track in-flight API requests to prevent duplicates
const pendingRequests = new Map();

/**
 * Deduplicate API requests - if same request is in flight, return the pending promise
 * This prevents multiple simultaneous calls to the same endpoint
 */
const deduplicateRequest = async (key, requestFn) => {
  // Check if request is already in flight
  if (pendingRequests.has(key)) {
    console.log(`[DEDUPE] 🔄 Request for ${key} already in progress, waiting for existing request...`);
    return pendingRequests.get(key);
  }

  console.log(`[DEDUPE] 📤 Starting new request for ${key}`);

  // Execute the request and store the promise
  const promise = requestFn()
    .finally(() => {
      // Remove from pending requests when done
      pendingRequests.delete(key);
      console.log(`[DEDUPE] ✅ Request for ${key} completed and removed from pending`);
    });

  pendingRequests.set(key, promise);
  return promise;
};

/**
 * Clear all pending requests (useful for cleanup or testing)
 */
export const clearPendingRequests = () => {
  pendingRequests.clear();
  console.log('[DEDUPE] 🗑️ Cleared all pending requests');
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

  return {
    ...product,
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

  return {
    ...batch,
    // Ensure all required fields are present with defaults
    batchNumber: batch.batchNumber || '',
    mfg: batch.mfg || null,
    expiry: batch.expiry || null,
    quantity: batch.quantity || 0,
    costPrice: batch.costPrice || 0,
    sellingUnitPrice: batch.sellingUnitPrice || 0,
    productId: batch.productId || null,
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
  console.log('[IS ONLINE] Checking online status for refresh...');

  // For refresh operations, be more permissive
  // Check if user is authenticated (most important check)
  const auth = localStorage.getItem('auth');
  if (!auth) {
    console.log('[IS ONLINE] ❌ User not authenticated - blocking API calls');
    return false;
  }

  console.log('[IS ONLINE] ✅ User authenticated - allowing refresh operations');
  console.log('[IS ONLINE] Auth data exists:', !!auth);

  // For refresh operations, allow API calls even if navigator.onLine is false
  // The API calls will fail gracefully if actually offline
  return true;
};

/**
 * Fast load data from IndexedDB for instant UI display
 * This loads data immediately from IndexedDB without waiting for backend sync
 */
export const fastLoadFromIndexedDB = async () => {
  console.log('⚡ FAST LOAD: Loading data instantly from IndexedDB...');

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
      settings
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
      getAllItems(STORES.settings).catch(() => [])
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
        console.log(`📂 FAST LOAD: Category resolved for ${product.name}: ${normalized.categoryId} -> ${normalized.category}`);
      } else {
        normalized.category = normalized.category || '';
        if (normalized.categoryId) {
          console.log(`❌ FAST LOAD: Category NOT resolved for ${product.name}: categoryId=${normalized.categoryId}, available categories:`, Object.keys(categoryMap));
        }
      }
      return normalized;
    });

    // Save resolved products back to IndexedDB so future loads have resolved categories
    console.log('💾 FAST LOAD: Saving resolved products back to IndexedDB...');
    await syncToIndexedDB(STORES.products, normalizedProducts, { merge: true });

    console.log('✅ FAST LOAD: IndexedDB data loaded and resolved successfully', {
      customers: normalizedCustomers.length,
      products: normalizedProducts.length,
      productBatches: productBatches?.length || 0,
      orders: orders?.length || 0,
      transactions: transactions?.length || 0,
      purchaseOrders: purchaseOrders?.length || 0,
      categories: categories?.length || 0
    });

    return {
      customers: normalizedCustomers,
      products: normalizedProducts,
      productBatches: productBatches || [],
      orders: orders || [],
      transactions: transactions || [],
      purchaseOrders: purchaseOrders || [],
      categories: categories || [],
      activities: activities || [],
      refunds: refunds || [],
      plans: plans || [],
      planOrders: planOrders || [],
      planDetails: planDetails || [],
      settings: settings || [],
      dataSource: 'indexeddb', // Flag to indicate this came from IndexedDB
      loadedAt: Date.now()
    };
  } catch (error) {
    console.error('❌ FAST LOAD: Error loading from IndexedDB:', error);
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
      dataSource: 'error',
      loadedAt: Date.now()
    };
  }
};

/**
 * Background sync function that fetches from backend and updates both UI and IndexedDB
 * This should be called after fastLoadFromIndexedDB to get latest data
 */
export const backgroundSyncWithBackend = async (dispatch, ActionTypes) => {
  console.log('🔄 BACKGROUND SYNC: Starting background sync with backend...');

  // Check if user is authenticated before making API calls
  const auth = localStorage.getItem('auth');
  if (!auth) {
    console.log('🔄 BACKGROUND SYNC: No authentication found, skipping sync');
    return { success: false, reason: 'not_authenticated' };
  }

  try {
    console.log('🔍 BACKGROUND SYNC: Checking if online...');
    const online = await isOnline();
    console.log('🔍 BACKGROUND SYNC: Online status:', online);

    if (!online) {
      console.log('ℹ️ BACKGROUND SYNC: Offline - skipping backend sync');
      return { success: false, reason: 'offline' };
    }

    // Initialize sync tracking for new users
    console.log('🔄 BACKGROUND SYNC: Initializing sync tracking...');
    const { initializeSyncTracking } = await import('../utils/indexedDB');
    await initializeSyncTracking();

    console.log('📡 BACKGROUND SYNC: Fetching data from /data/all endpoint...');

    // Get last fetch times from IndexedDB to determine if we need full sync or incremental
    const { getLastFetchTimesForAPI } = await import('../utils/indexedDB');
    const lastFetchTimes = await getLastFetchTimesForAPI();
    console.log('📡 BACKGROUND SYNC: Last fetch times from IndexedDB:', lastFetchTimes);

    // Check if this is a completely new user (all timestamps are default = never synced)
    const defaultTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const isNewUser = Object.keys(lastFetchTimes).length === 0 ||
      Object.values(lastFetchTimes).every(time => time === defaultTime);

    // Prepare request body - new users get full sync, existing users get incremental
    const requestBody = isNewUser ? {} : { lastFetchTimes };
    console.log('📡 BACKGROUND SYNC: Is new user?', isNewUser, '- Request body:', requestBody);

    // Fetch latest data from backend using POST method
    const result = await apiRequest('/data/all', {
      method: 'POST',
      body: requestBody
    });
    console.log('📡 BACKGROUND SYNC: API response:', result);

    if (!result.success || !result.data?.data) {
      console.error('❌ BACKGROUND SYNC: Backend returned invalid data', result);
      return { success: false, reason: 'invalid_response' };
    }

    const { customers, products, productBatches, orders, transactions, purchaseOrders, categories, planOrders } = result.data.data;
    console.log('📊 BACKGROUND SYNC: Raw data received:', {
      customers: customers?.length || 0,
      products: products?.length || 0,
      productBatches: productBatches?.length || 0,
      orders: orders?.length || 0,
      transactions: transactions?.length || 0,
      purchaseOrders: purchaseOrders?.length || 0,
      planOrders: planOrders?.length || 0,
      categories: categories?.length || 0
    });

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
        console.log(`📂 BACKGROUND SYNC: Category resolved for ${product.name}: ${normalized.categoryId} -> ${normalized.category}`);
      } else {
        normalized.category = normalized.category || '';
        if (normalized.categoryId) {
          console.log(`❌ BACKGROUND SYNC: Category NOT resolved for ${product.name}: categoryId=${normalized.categoryId}, available categories:`, Object.keys(categoryMap));
        }
      }
      return normalized;
    });
    const normalizedProductBatches = (productBatches || []).map(batch => normalizeProductBatch(batch));
    console.log('🔄 BACKGROUND SYNC: Data normalized');

    // Update IndexedDB with fresh backend data
    console.log('💾 BACKGROUND SYNC: Saving to IndexedDB...');
    const syncResults = await Promise.all([
      syncToIndexedDB(STORES.customers, normalizedCustomers, { merge: true }),
      syncToIndexedDB(STORES.products, normalizedProducts, { merge: true }),
      syncToIndexedDB(STORES.productBatches, normalizedProductBatches, { merge: true }),
      syncToIndexedDB(STORES.orders, orders || [], { merge: true }),
      syncToIndexedDB(STORES.transactions, transactions || [], { merge: true }),
      syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || [], { merge: true }),
      syncToIndexedDB(STORES.categories, categories || [], { merge: true }),
      syncToIndexedDB(STORES.planOrders, planOrders || [], { merge: true })
    ]);
    console.log('💾 BACKGROUND SYNC: IndexedDB sync results:', syncResults);

    // Update UI state with fresh backend data
    console.log('🖥️ BACKGROUND SYNC: Updating UI state...');
    console.log('📂 BACKGROUND SYNC: Categories being set:', categories?.length || 0, 'categories');
    console.log('📦 BACKGROUND SYNC: Sample product categories:', normalizedProducts.slice(0, 3).map(p => ({ name: p.name, categoryId: p.categoryId, category: p.category })));

    dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedCustomers || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (normalizedProducts || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: (normalizedProductBatches || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_ORDERS, payload: (orders || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (transactions || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (purchaseOrders || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (categories || []).filter(i => i.isDeleted !== true) });
    dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: (planOrders || []).filter(i => i.isDeleted !== true) });
    console.log('🖥️ BACKGROUND SYNC: UI state updated');

    // Update last fetch times after successful sync
    console.log('🔄 BACKGROUND SYNC: Updating last fetch times after successful sync...');
    const { updateLastFetchTime } = await import('../utils/indexedDB');
    const currentTime = new Date().toISOString();

    // Update timestamp for all data types that were synced
    const dataTypes = ['customers', 'products', 'productBatches', 'orders', 'transactions', 'purchaseOrders', 'categories'];
    for (const dataType of dataTypes) {
      await updateLastFetchTime(dataType, currentTime);
    }
    console.log('✅ BACKGROUND SYNC: Last fetch times updated to:', currentTime);

    console.log('✅ BACKGROUND SYNC: Successfully synced backend data to UI and IndexedDB', {
      customers: normalizedCustomers.length,
      products: normalizedProducts.length,
      orders: orders?.length || 0,
      transactions: transactions?.length || 0,
      purchaseOrders: purchaseOrders?.length || 0,
      categories: categories?.length || 0
    });

    return {
      success: true,
      dataSource: 'backend',
      syncedAt: Date.now(),
      data: {
        customers: normalizedCustomers,
        products: normalizedProducts,
        orders: orders || [],
        transactions: transactions || [],
        purchaseOrders: purchaseOrders || [],
        categories: categories || []
      }
    };

  } catch (error) {
    console.error('❌ BACKGROUND SYNC: Error during background sync:', error);
    console.error('❌ BACKGROUND SYNC: Error details:', error.stack);
    return { success: false, reason: 'error', error: error.message };
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
      console.error('Error fetching customers from backend:', error);
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

        // Normalize products before syncing
        const normalizedProducts = products.map(product => normalizeProduct(product));

        // Update IndexedDB with backend data
        await syncToIndexedDB(STORES.products, normalizedProducts, { merge: true });

        return normalizedProducts;
      }
    } catch (error) {
      console.error('Error fetching products from backend:', error);
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
      console.error('Error fetching orders from backend:', error);
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
      console.error('Error fetching transactions from backend:', error);
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
      console.error('Error fetching vendor orders from backend:', error);
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
      console.error('Error fetching categories from backend:', error);
      // Fall through to IndexedDB
    }
  }

  // Fetch from IndexedDB (offline or backend failed)
  return await getAllItems(STORES.categories);
};

/**
 * Fetch all data at once from backend or IndexedDB
 */
export const fetchAllData = async () => {
  // Check if user is authenticated before making API calls
  const auth = localStorage.getItem('auth');
  if (!auth) {
    console.log('🔄 FETCH ALL DATA: No authentication found, using IndexedDB only');
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
  const [customers, products, orders, transactions, purchaseOrders, categories] = await Promise.all([
    getAllItems(STORES.customers).catch(() => []),
    getAllItems(STORES.products).catch(() => []),
    getAllItems(STORES.orders).catch(() => []),
    getAllItems(STORES.transactions).catch(() => []),
    getAllItems(STORES.purchaseOrders).catch(() => []),
    getAllItems(STORES.categories).catch(() => [])
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
    categories: categories || []
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
    console.log('🔄 DELTA SYNC: No authentication found, using IndexedDB only');
    return await fetchAllData();
  }

  const online = await isOnline();
  if (!online) {
    console.log('🔄 DELTA SYNC: Offline, using IndexedDB only');
    return await fetchAllData();
  }

  try {
    // Initialize sync tracking if not already done
    await initializeSyncTracking();

    if (forceFullSync) {
      console.log('🔄 DELTA SYNC: Force full sync requested');
      return await fetchAllData();
    }

    // Get last fetch times from IndexedDB
    const lastFetchTimes = await getLastFetchTimesForAPI();
    console.log('🔄 DELTA SYNC: Last fetch times:', lastFetchTimes);

    // Call delta sync API with deduplication to prevent duplicate calls
    console.log('🔄 DELTA SYNC: Calling delta sync API...');
    const result = await deduplicateRequest('delta-sync', async () => {
      return await apiRequest('/data/delta-sync', {
        method: 'POST',
        body: { lastFetchTimes }
      });
    });

    if (!result.success) {
      console.warn('🔄 DELTA SYNC: Delta sync API failed, falling back to full sync');
      const fullData = await fetchAllData();
      // Don't update fetch times for failed delta sync - let full sync handle it
      return fullData;
    }

    const { needsFullSync, deltaInfo, data } = result.data.data;
    console.log('🔄 DELTA SYNC: API response - needs full sync:', needsFullSync?.length > 0, 'delta data types:', Object.keys(deltaInfo || {}));
    console.log('🔄 DELTA SYNC: Raw API data object:', result.data.data);
    console.log('🔄 DELTA SYNC: Data keys:', Object.keys(data || {}));
    console.log('🔄 DELTA SYNC: DeltaInfo object:', deltaInfo);

    // Check if ANY data type needs update (this is our master condition)
    const hasAnyUpdates = deltaInfo && Object.values(deltaInfo).some(info => info.needsUpdate === true);
    console.log('🔄 DELTA SYNC: Any data type needs update:', hasAnyUpdates);

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
      staff: []
    };

    // Track if any data was processed (from delta OR full sync)
    let hasProcessedData = false;

    // Track which data types actually had changes (for timestamp updates)
    const updatedDataTypes = new Set();

    // Process each data type that has delta data
    console.log('🔄 DELTA SYNC: Processing delta data:', Object.keys(data || {}));

    for (const [dataType, deltaData] of Object.entries(data || {})) {
      console.log(`🔄 DELTA SYNC: Processing ${dataType}, deltaData:`, JSON.stringify(deltaData, null, 2));
      console.log(`🔄 DELTA SYNC: Checking ${dataType}:`, {
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

      console.log(`🔄 DELTA SYNC: ${dataType} hasValidData check:`, {
        deltaDataExists: !!deltaData,
        isObject: typeof deltaData === 'object',
        hasItemsProp: !!(deltaData && deltaData.items),
        itemsIsArray: Array.isArray(deltaData?.items),
        itemsLength: deltaData?.items?.length || 0,
        finalResult: hasValidData
      });

      if (hasValidData) {
        hasProcessedData = true;
        console.log(`🔄 DELTA SYNC: ✅ Processing ${deltaData.items.length} ${dataType} items from server`);

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
          console.log(`🔄 DELTA SYNC: ${storeName} has ${existingItems.length} existing items in IndexedDB`);

          // Check if incoming data is different from existing data
          let hasChanges = false;
          const itemsToUpdate = [];

          for (const incomingItem of normalizedItems) {
            console.log(`🔄 DELTA SYNC: Processing ${dataType} item:`, {
              id: incomingItem.id,
              _id: incomingItem._id,
              name: incomingItem.name || incomingItem.customerName,
              total: incomingItem.total,
              isSynced: incomingItem.isSynced,
              updatedAt: incomingItem.updatedAt
            });

            // Find existing item by id or _id (MongoDB uses _id, local items use id)
            const existingItem = existingItems.find(item =>
              (item.id && incomingItem.id && item.id === incomingItem.id) ||
              (item._id && incomingItem._id && item._id === incomingItem._id) ||
              (item.id && incomingItem._id && item.id === incomingItem._id) ||
              (item._id && incomingItem.id && item._id === incomingItem.id)
            );

            console.log(`🔄 DELTA SYNC: Found existing ${dataType} item:`, existingItem ? {
              id: existingItem.id,
              _id: existingItem._id,
              name: existingItem.name || existingItem.customerName,
              isSynced: existingItem.isSynced,
              updatedAt: existingItem.updatedAt
            } : 'NOT FOUND');

            if (!existingItem) {
              // New item - needs to be added
              console.log(`🔄 DELTA SYNC: ${dataType} ${incomingItem.id || incomingItem._id} (${incomingItem.name || incomingItem.customerName || 'N/A'}) is NEW - will be added`);
              hasChanges = true;
              itemsToUpdate.push(incomingItem);
            } else {
              // Existing item - check if it has changed
              const isDifferent = compareDataItems(incomingItem, existingItem, dataType);
              if (isDifferent) {
                console.log(`🔄 DELTA SYNC: ${dataType} ${incomingItem.id || incomingItem._id} (${incomingItem.name || incomingItem.customerName || 'N/A'}) has CHANGES - will be updated`);
                console.log(`🔄 DELTA SYNC: Existing item:`, {
                  id: existingItem.id,
                  _id: existingItem._id,
                  isSynced: existingItem.isSynced,
                  updatedAt: existingItem.updatedAt,
                  total: existingItem.total,
                  customerName: existingItem.customerName
                });
                console.log(`🔄 DELTA SYNC: Incoming item:`, {
                  id: incomingItem.id,
                  _id: incomingItem._id,
                  isSynced: incomingItem.isSynced,
                  updatedAt: incomingItem.updatedAt,
                  total: incomingItem.total,
                  customerName: incomingItem.customerName
                });
                hasChanges = true;
                itemsToUpdate.push(incomingItem);
              } else {
                console.log(`🔄 DELTA SYNC: ${dataType} ${incomingItem.id || incomingItem._id} (${incomingItem.name || incomingItem.customerName || 'N/A'}) is UNCHANGED - skipping update`);
              }
            }
          }

          if (hasChanges && itemsToUpdate.length > 0) {
            console.log(`🔄 DELTA SYNC: 💾 Updating ${itemsToUpdate.length} changed ${dataType} items in IndexedDB`);

            try {
              const saveResult = await syncToIndexedDB(storeName, itemsToUpdate, { merge: true });
              console.log(`✅ DELTA SYNC: Successfully updated ${itemsToUpdate.length} ${dataType} items in IndexedDB`);

              // Mark this data type as updated for timestamp tracking
              updatedDataTypes.add(dataType);

              // Return updated data for UI
              allData[dataType] = normalizedItems;
            } catch (error) {
              console.error(`❌ DELTA SYNC: Failed to update ${dataType} in IndexedDB:`, error);
            }
          } else {
            console.log(`🔄 DELTA SYNC: ⏭️ No changes detected for ${dataType} - skipping IndexedDB update`);
            // Still return existing data for UI consistency
            allData[dataType] = existingItems;
          }
        } else {
          console.warn(`🔄 DELTA SYNC: ⚠️ No store name found for dataType: ${dataType}`);
        }
      } else {
        console.log(`🔄 DELTA SYNC: ⏭️ No updates for ${dataType}`);
      }
    }

    // Update last sync time ONLY for data types that were actually updated in IndexedDB
    console.log('🔄 DELTA SYNC: Updating last sync times only for data types that had actual changes');
    console.log('🔄 DELTA SYNC: Data types with changes:', Array.from(updatedDataTypes));

    for (const dataType of updatedDataTypes) {
      const deltaData = data?.[dataType];
      if (deltaData && deltaData.updatedAt) {
        try {
          // Subtract 2 minutes from the updatedAt time to ensure we don't miss recent changes
          const adjustedTime = new Date(new Date(deltaData.updatedAt).getTime() - 2 * 60 * 1000).toISOString();
          console.log(`🔄 DELTA SYNC: ✅ Updating ${dataType} fetch time to:`, adjustedTime, `(adjusted from ${deltaData.updatedAt}, data was actually updated)`);
          await updateLastFetchTime(dataType, adjustedTime);
        } catch (error) {
          console.error(`Error updating last fetch time for ${dataType}:`, error);
        }
      } else {
        console.warn(`🔄 DELTA SYNC: Could not update timestamp for ${dataType} - missing delta data or updatedAt`);
      }
    }

    // Timestamp updates are handled above - only for data types that actually had updates

    // Load all data from IndexedDB to ensure we have the most recent data (after delta + full sync)
    // This ensures UI displays data through IndexedDB as requested
    console.log('🔄 DELTA SYNC: Loading final data from IndexedDB for UI display');
    const dataTypesToLoad = ['customers', 'products', 'orders', 'transactions', 'purchaseOrders', 'categories', 'refunds', 'plans', 'planOrders', 'staff'];
    for (const dataType of dataTypesToLoad) {
      const storeName = getStoreNameForDataType(dataType);
      if (storeName) {
        try {
          const indexedDBData = await getAllItems(storeName);
          allData[dataType] = normalizeDataByType(dataType, indexedDBData);
          console.log(`🔄 DELTA SYNC: Loaded ${allData[dataType].length} ${dataType} from IndexedDB for UI`);
        } catch (error) {
          console.error(`Error loading ${dataType} from IndexedDB:`, error);
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
      console.log('🔄 DELTA SYNC: Full sync needed for:', needsFullSync);

      // Perform full sync and save data to IndexedDB
      const auth = localStorage.getItem('auth');

      if (auth) {
        const online = await isOnline();
        if (online) {
          try {
            console.log('🔄 DELTA SYNC: Attempting API full sync and saving to IndexedDB...');
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
        //         console.log(`🔄 DELTA SYNC: Full sync key '${key}':`, { value, isValidArray, isValidValue });
        //         return isValidArray || isValidValue;
        //       });
        //
              // Check if API actually returned meaningful data (not empty objects/arrays)
              const dataKeys = Object.keys(fullSyncResult.data.data);
              const hasActualData = dataKeys.some(key => {
                const value = fullSyncResult.data.data[key];
                const isValidArray = Array.isArray(value) && value.length > 0;
                const isValidValue = !Array.isArray(value) && value != null;
                console.log(`🔄 DELTA SYNC: Full sync key '${key}':`, { value, isValidArray, isValidValue });
                return isValidArray || isValidValue;
              });

              if (hasActualData) {
                console.log('🔄 DELTA SYNC: API full sync returned actual data, saving to IndexedDB');

                // Save full sync data to IndexedDB (this will overwrite/merge with delta data)
                const { customers, products, orders, transactions, purchaseOrders, categories, refunds, plans, planOrders, staff } = fullSyncResult.data.data;

                // Normalize data before syncing
                const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));
                const normalizedProducts = (products || []).map(product => normalizeProduct(product));

                // Save to IndexedDB - FULL SYNC should REPLACE all existing data with fresh data from server
                // Use merge: false for full sync to ensure clean replacement
                await Promise.all([
                  normalizedCustomers.length > 0 ? syncToIndexedDB(STORES.customers, normalizedCustomers, { merge: false }) : Promise.resolve(),
                  normalizedProducts.length > 0 ? syncToIndexedDB(STORES.products, normalizedProducts, { merge: false }) : Promise.resolve(),
                  (orders && orders.length > 0) ? syncToIndexedDB(STORES.orders, orders, { merge: false }) : Promise.resolve(),
                  (transactions && transactions.length > 0) ? syncToIndexedDB(STORES.transactions, transactions, { merge: false }) : Promise.resolve(),
                  (purchaseOrders && purchaseOrders.length > 0) ? syncToIndexedDB(STORES.purchaseOrders, purchaseOrders, { merge: false }) : Promise.resolve(),
                  (categories && categories.length > 0) ? syncToIndexedDB(STORES.categories, categories, { merge: false }) : Promise.resolve(),
                  (refunds && refunds.length > 0) ? syncToIndexedDB(STORES.refunds, refunds, { merge: false }) : Promise.resolve(),
                  (plans && plans.length > 0) ? syncToIndexedDB(STORES.plans, plans, { merge: false }) : Promise.resolve(),
                  (planOrders && planOrders.length > 0) ? syncToIndexedDB(STORES.planOrders, planOrders, { merge: false }) : Promise.resolve(),
                  (staff && staff.length > 0) ? syncToIndexedDB(STORES.staff, staff, { merge: false }) : Promise.resolve()
                ]);

                console.log('🔄 DELTA SYNC: Full sync data saved to IndexedDB successfully');
                fullSyncSucceeded = true;
                hasProcessedData = true;

                // Update allData with full sync data
                allData.customers = normalizedCustomers;
                allData.products = normalizedProducts;
                allData.orders = orders || [];
                allData.transactions = transactions || [];
                allData.purchaseOrders = purchaseOrders || [];
                allData.categories = categories || [];
                allData.refunds = refunds || [];
                allData.plans = plans || [];
                allData.planOrders = planOrders || [];
                allData.staff = staff || [];

              } else {
                console.log('🔄 DELTA SYNC: API full sync returned empty data, not saving to IndexedDB');
              }
            } else {
              console.log('🔄 DELTA SYNC: API full sync failed or returned no data');
            }
          } catch (apiError) {
            console.log('🔄 DELTA SYNC: API full sync failed:', apiError.message);
          }
        } else {
          console.log('🔄 DELTA SYNC: Offline, cannot perform API full sync');
        }
      }
    }

    // Timestamp updates are handled above - only for data types that actually had updates (needsUpdate = true)
    console.log('🔄 DELTA SYNC: Timestamp updates completed for data types with actual updates');

    console.log('✅ DELTA SYNC: Completed successfully');
    return allData;

  } catch (error) {
    console.error('❌ DELTA SYNC: Error in delta sync, falling back to full sync:', error);
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
    categories: STORES.categories,
    orders: STORES.orders,
    transactions: STORES.transactions,
    purchaseOrders: STORES.purchaseOrders,
    refunds: STORES.refunds,
    plans: STORES.plans,
    planOrders: STORES.planOrders,
    staff: STORES.staff
  };
  return mapping[dataType];
};

/**
 * Normalize data by type
 */
const normalizeDataByType = (dataType, data) => {
  switch (dataType) {
    case 'customers':
      return data.map(customer => normalizeCustomer(customer));
    case 'products':
      return data.map(product => normalizeProduct(product));
    default:
      return data;
  }
};

/**
 * Update last sync time for all data types after successful sync
 */
const updateAllFetchTimes = async () => {
  try {
    const allDataTypes = ['customers', 'products', 'categories', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'plans', 'planOrders', 'staff'];
    // Subtract 2 minutes to avoid missing recent changes
    const adjustedTime = new Date(new Date().getTime() - 2 * 60 * 1000).toISOString();

    console.log('🔄 DELTA SYNC: updateAllFetchTimes called - Updating last fetch times for all data types after sync');
    console.log('🔄 DELTA SYNC: Adjusted timestamp (2 min ago):', adjustedTime);

    for (const dataType of allDataTypes) {
      try {
        console.log(`🔄 DELTA SYNC: Updating fetch time for ${dataType}`);
        await updateLastFetchTime(dataType, adjustedTime);
        console.log(`🔄 DELTA SYNC: Successfully updated fetch time for ${dataType}`);
      } catch (error) {
        console.error(`Error updating last fetch time for ${dataType}:`, error);
      }
    }

    console.log('🔄 DELTA SYNC: Finished updating all fetch times');
  } catch (error) {
    console.error('Error updating all fetch times:', error);
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
    // Products: name + description
    const productName = (itemToInsert.name || '').trim().toLowerCase();
    const productDescription = (itemToInsert.description || '').trim().toLowerCase();

    return itemsToInsert.some(p => {
      const existingName = (p.name || '').trim().toLowerCase();
      const existingDescription = (p.description || '').trim().toLowerCase();

      return existingName === productName &&
        (existingDescription === productDescription ||
          (existingDescription === '' && productDescription === '') ||
          (existingDescription === null && productDescription === null) ||
          (existingDescription === undefined && productDescription === undefined));
    });
  } else if (storeName === STORES.customers) {
    // Customers: name + mobileNumber (or email)
    const customerName = (itemToInsert.name || '').trim().toLowerCase();
    const mobileNumber = (itemToInsert.mobileNumber || itemToInsert.phone || '').trim();
    const email = (itemToInsert.email || '').trim().toLowerCase();

    return itemsToInsert.some(c => {
      const existingName = (c.name || '').trim().toLowerCase();
      const existingMobile = (c.mobileNumber || c.phone || '').trim();
      const existingEmail = (c.email || '').trim().toLowerCase();

      if (mobileNumber && existingMobile) {
        return existingName === customerName && existingMobile === mobileNumber;
      }
      if (email && existingEmail) {
        return existingName === customerName && existingEmail === email;
      }
      return existingName === customerName && !existingMobile && !existingEmail && !mobileNumber && !email;
    });
  } else if (storeName === STORES.orders) {
    // Orders: sellerId + customerId + totalAmount + items hash + createdAt
    const orderHash = hashItems(itemToInsert.items, false);
    const orderCreatedAt = itemToInsert.createdAt || itemToInsert.date;

    return itemsToInsert.some(o => {
      if (o.sellerId !== itemToInsert.sellerId) return false;

      const oCustomerId = o.customerId || null;
      const itemCustomerId = itemToInsert.customerId || null;
      if (oCustomerId !== itemCustomerId) return false;

      const totalDiff = Math.abs((o.totalAmount || 0) - (itemToInsert.totalAmount || 0));
      if (totalDiff > 0.01) return false;

      const existingHash = hashItems(o.items, false);
      if (existingHash !== orderHash) return false;

      if (orderCreatedAt && o.createdAt) {
        return isWithin5Seconds(o.createdAt, orderCreatedAt);
      }

      return o.id === itemToInsert.id || o._id === itemToInsert.id || o.id === itemToInsert._id;
    });
  } else if (storeName === STORES.purchaseOrders) {
    // Vendor Orders: sellerId + supplierName + total + items hash + createdAt
    const poHash = hashItems(itemToInsert.items, true);
    const poCreatedAt = itemToInsert.createdAt || itemToInsert.date;

    return itemsToInsert.some(po => {
      if (po.sellerId !== itemToInsert.sellerId) return false;

      const poSupplier = (po.supplierName || '').trim().toLowerCase();
      const itemSupplier = (itemToInsert.supplierName || '').trim().toLowerCase();
      if (poSupplier !== itemSupplier) return false;

      const totalDiff = Math.abs((po.total || 0) - (itemToInsert.total || 0));
      if (totalDiff > 0.01) return false;

      const existingHash = hashItems(po.items, true);
      if (existingHash !== poHash) return false;

      if (poCreatedAt && po.createdAt) {
        return isWithin5Seconds(po.createdAt, poCreatedAt);
      }

      return po.id === itemToInsert.id || po._id === itemToInsert.id || po.id === itemToInsert._id;
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
      console.warn(`⚠️ [syncToIndexedDB] Invalid backend data for ${storeName} - skipping sync`);
      return;
    }

    // Check if IndexedDB is available before attempting sync
    const indexedDBAvailable = await isIndexedDBAvailable();
    if (!indexedDBAvailable) {
      console.warn(`⚠️ [syncToIndexedDB] IndexedDB availability check failed - but attempting sync anyway since operations may still work`);
      // Don't return here - try the operation anyway since the availability check can be unreliable
    }

    console.log(`🔄 [syncToIndexedDB] Syncing ${storeName} with ${backendItems.length} items from MongoDB (Merge: ${merge})`);

    // Step 1: Get existing items from IndexedDB to preserve unsynced local changes
    // Only needed if we are clearing the store (not merging)
    let unsyncedItems = [];
    if (!merge) {
      const existingItems = await getAllItems(storeName);
      unsyncedItems = existingItems.filter(item => item.isSynced === false);

      if (unsyncedItems.length > 0) {
        console.log(`⚠️ [syncToIndexedDB] Preserving ${unsyncedItems.length} unsynced local ${storeName} items`);
      }

      // Note: Removed validation that prevented clearing IndexedDB when backend returns empty array
      // The backend returning empty data means the collection should be empty (e.g., all items deleted)
      // We should always trust the backend data as authoritative

      // Step 4: Clear all existing data from IndexedDB
      console.log(`🗑️ [syncToIndexedDB] Clearing all existing ${storeName} data from IndexedDB...`);
      await clearAllItems(storeName);
      console.log(`✅ [syncToIndexedDB] Cleared ${storeName} store`);
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

      const key = normalizedItem._id || normalizedItem.id;
      console.log(`🔄 [syncToIndexedDB] Using key for ${storeName}: ${key} (from ${normalizedItem._id ? '_id' : 'id'})`);

      // Prepare item for insertion with proper structure
      const itemToInsert = {
        ...normalizedItem,
        id: key, // Use MongoDB _id as id
        isSynced: true // All backend data is synced
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
            console.log(`[syncToIndexedDB] Preserving splitPaymentDetails for order ${itemToInsert.id}:`, {
              backend: backendItem.splitPaymentDetails,
              preserved: itemToInsert.splitPaymentDetails,
              itemToInsertKeys: Object.keys(itemToInsert)
            });
          }
        } else if (backendItem.paymentMethod === 'split') {
          console.warn(`[syncToIndexedDB] WARNING: Order ${itemToInsert.id} has paymentMethod='split' but no splitPaymentDetails in backend response`);
        }
      }

      // Check for duplicates in batch before inserting
      if (isDuplicateInBatch(storeName, itemToInsert, itemsToInsert)) {
        duplicateCount++;
        console.warn(`⚠️ Duplicate ${storeName} in MongoDB batch (skipping):`, {
          id: itemToInsert.id,
          name: itemToInsert.name || itemToInsert.supplierName || 'N/A'
        });
        continue; // Skip duplicate
      }

      itemsToInsert.push(itemToInsert);
    }

    if (duplicateCount > 0) {
      console.log(`⚠️ [syncToIndexedDB] Skipped ${duplicateCount} duplicate items from MongoDB batch`);
    }

    // Step 5: Insert all MongoDB items
    if (itemsToInsert.length > 0) {
      console.log(`📥 [syncToIndexedDB] Items to insert for ${storeName}:`, itemsToInsert);
      console.log(`📥 [syncToIndexedDB] First item details:`, {
        id: itemsToInsert[0].id,
        name: itemsToInsert[0].name,
        updatedAt: itemsToInsert[0].updatedAt,
        isSynced: itemsToInsert[0].isSynced
      });

      if (merge) {
        console.log(`📥 [syncToIndexedDB] Merging ${itemsToInsert.length} items from MongoDB into ${storeName}...`);
        const mergeResult = await updateMultipleItems(storeName, itemsToInsert, true); // Skip validation for backend data
        console.log(`✅ [syncToIndexedDB] Successfully merged ${itemsToInsert.length} items into ${storeName}`, mergeResult);
      } else {
        console.log(`📥 [syncToIndexedDB] Inserting ${itemsToInsert.length} items from MongoDB into ${storeName}...`);
        const insertResult = await addMultipleItems(storeName, itemsToInsert, true); // Skip validation for backend data
        console.log(`✅ [syncToIndexedDB] Successfully inserted ${itemsToInsert.length} items into ${storeName}`, insertResult);
      }
    } else {
      console.log(`⚠️ [syncToIndexedDB] No items to insert for ${storeName}`);
    }

    // Step 6: Re-insert unsynced local items (preserve local changes)
    // Use updateItem (put) to handle potential ID conflicts with MongoDB items
    if (unsyncedItems.length > 0) {
      console.log(`📥 [syncToIndexedDB] Re-inserting ${unsyncedItems.length} unsynced local items into ${storeName}...`);
      for (const unsyncedItem of unsyncedItems) {
        try {
          await updateItem(storeName, unsyncedItem, true); // Use put to handle conflicts
        } catch (error) {
          console.error(`Error re-inserting unsynced item ${unsyncedItem.id} in ${storeName}:`, error);
        }
      }
      console.log(`✅ [syncToIndexedDB] Successfully re-inserted ${unsyncedItems.length} unsynced items into ${storeName}`);
    }

    console.log(`✅ [syncToIndexedDB] Completed sync for ${storeName}: ${itemsToInsert.length} MongoDB items + ${unsyncedItems.length} unsynced local items`);
  } catch (error) {
    // Handle IndexedDB errors gracefully - don't crash the app
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    if (errorMessage.includes('Internal error opening backing store') ||
      errorMessage.includes('UnknownError') ||
      errorMessage.includes('QuotaExceededError')) {
      console.warn(`⚠️ [syncToIndexedDB] IndexedDB storage unavailable for ${storeName} - likely private browsing or storage quota exceeded. Data will remain in memory.`);
      console.warn(`   Error details: ${errorMessage}`);
      return; // Don't throw - allow app to continue with in-memory data
    } else {
      console.error(`❌ [syncToIndexedDB] Unexpected error syncing ${storeName} to IndexedDB:`, error);
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
    console.log('🔄 LATEST FETCH: Fetching latest data with timestamps:', timestamps);

    const online = await isOnline();
    if (!online) {
      console.log('🔄 LATEST FETCH: Offline, skipping latest fetch');
      return {};
    }

    const result = await apiRequest('/data/latest-fetch', {
      method: 'POST',
      body: { timestamps }
    });

    if (!result.success) {
      console.warn('🔄 LATEST FETCH: API call failed:', result.error);
      return {};
    }

    const latestData = result.data || {};
    console.log('🔄 LATEST FETCH: Received latest data:', Object.keys(latestData));

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

        console.log(`🔄 LATEST FETCH: Processed ${normalizedItems.length} ${dataType} items`);
      }
    }

    return processedData;

  } catch (error) {
    console.error('🔄 LATEST FETCH: Error fetching latest data:', error);
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
    console.log('🔄 MERGE LATEST: Merging latest data to IndexedDB:', Object.keys(latestData));

    for (const [dataType, dataInfo] of Object.entries(latestData)) {
      if (dataInfo && dataInfo.data && Array.isArray(dataInfo.data) && dataInfo.data.length > 0) {
        const storeName = getStoreNameForDataType(dataType);

        if (storeName) {
          console.log(`🔄 MERGE LATEST: Merging ${dataInfo.data.length} ${dataType} to ${storeName}`);

          // Use merge: true to update existing records and add new ones
          await syncToIndexedDB(storeName, dataInfo.data, { merge: true });

          // Update fetch time if requested (subtract 2 minutes to avoid missing recent changes)
          if (updateFetchTimes && dataInfo.timestamp) {
            const adjustedTime = new Date(new Date(dataInfo.timestamp).getTime() - 2 * 60 * 1000).toISOString();
            await updateLastFetchTime(dataType, adjustedTime);
          }

          console.log(`✅ MERGE LATEST: Successfully merged ${dataType}`);
        }
      }
    }

    console.log('✅ MERGE LATEST: All data merged successfully');
    return true;

  } catch (error) {
    console.error('❌ MERGE LATEST: Error merging latest data:', error);
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
          console.warn(`Invalid timestamp for ${dataType}:`, timestamp);
        }
      }
    }

    console.log('🔄 LATEST FETCH: Valid timestamps for latest fetch:', validTimestamps);
    return validTimestamps;

  } catch (error) {
    console.error('Error getting latest fetch timestamps:', error);
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
    console.log('🔄 FETCH ALL LATEST: Getting all data updated since:', lastFetchTime);

    const online = await isOnline();
    if (!online) {
      console.log('🔄 FETCH ALL LATEST: Offline, skipping fetch');
      return {};
    }

    // Use deduplication to prevent multiple simultaneous calls
    const result = await deduplicateRequest(`fetch-latest-${lastFetchTime}`, async () => {
      return await apiRequest(`/data/fetch-latest?lastFetchTime=${encodeURIComponent(lastFetchTime)}`, {
        method: 'GET'
      });
    });

    if (!result.success) {
      console.warn('🔄 FETCH ALL LATEST: API call failed:', result.error);
      return {};
    }

    const latestData = result.data || {};
    console.log('🔄 FETCH ALL LATEST: Received data:', Object.keys(latestData));

    // Process and normalize the data
    const processedData = {};

    for (const [dataType, dataArray] of Object.entries(latestData)) {
      if (Array.isArray(dataArray) && dataArray.length > 0) {
        let normalizedItems = dataArray;

        // Apply normalization based on data type
        switch (dataType) {
          case 'customers':
            normalizedItems = dataArray.map(customer => normalizeCustomer(customer));
            break;
          case 'products':
            normalizedItems = dataArray.map(product => normalizeProduct(product));
            break;
          default:
            // No special normalization needed for other types
            break;
        }

        processedData[dataType] = {
          count: normalizedItems.length,
          data: normalizedItems,
          timestamp: new Date()
        };

        console.log(`🔄 FETCH ALL LATEST: Processed ${normalizedItems.length} ${dataType} items`);
      }
    }

    return processedData;

  } catch (error) {
    console.error('🔄 FETCH ALL LATEST: Error fetching data:', error);
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
    console.error('Error getting earliest last fetch time:', error);
    return null;
  }
};

/**
 * Fetch MongoDB sync tracking document for the current seller
 * @returns {Promise<Object|null>} Sync tracking document or null
 */
export const fetchMongoDBSyncTracking = async () => {
  try {
    console.log('🔍 FETCH SYNC TRACKING: Getting MongoDB sync tracking document');

    const online = await isOnline();
    if (!online) {
      console.log('🔍 FETCH SYNC TRACKING: Offline, skipping');
      return null;
    }

    const result = await apiRequest('/data/sync-tracking', {
      method: 'GET'
    });

    if (!result.success) {
      console.warn('🔍 FETCH SYNC TRACKING: Failed to fetch sync tracking:', result.error);
      return null;
    }

    console.log('🔍 FETCH SYNC TRACKING: Received sync tracking document:', result.data);
    return result.data;
  } catch (error) {
    console.error('❌ FETCH SYNC TRACKING: Error fetching sync tracking:', error);
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
  const dataTypes = ['customers', 'products', 'categories', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'plans', 'planOrders', 'staff'];

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
    planOrders: 'planOrders',
    staff: 'staff'
  };

  for (const dataType of dataTypes) {
    const apiDataType = dataTypeMapping[dataType];
    const mongoData = mongoTracking?.[apiDataType];
    const mongoTime = mongoData?.latestUpdateTime;
    const indexedDBTime = indexedDBTimes[dataType];

    console.log(`🔍 COMPARE: ${dataType} → ${apiDataType}, mongoData:`, mongoData, 'mongoTime:', mongoTime, 'indexedDBTime:', indexedDBTime);

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
      comparison[dataType].reason = `MongoDB (${mongoTime}) > IndexedDB (${indexedDBTime})`;
      dataTypesToFetch[dataType] = mongoTime;
    } else {
      comparison[dataType].reason = `IndexedDB (${indexedDBTime}) >= MongoDB (${mongoTime})`;
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
    console.log('🔄 FETCH SELECTIVE: Getting data for specific types:', Object.keys(dataTypesToFetch));

    const online = await isOnline();
    if (!online) {
      console.log('🔄 FETCH SELECTIVE: Offline, skipping fetch');
      return {};
    }

    // Create query parameters for selective fetch
    const queryParams = new URLSearchParams();
    for (const [dataType, timestamp] of Object.entries(dataTypesToFetch)) {
      queryParams.append(`${dataType}LastFetchTime`, timestamp);
    }

    const result = await apiRequest(`/data/fetch-selective?${queryParams.toString()}`, {
      method: 'GET'
    });

    if (!result.success) {
      console.warn('🔄 FETCH SELECTIVE: API call failed:', result.error);
      return {};
    }

    const latestData = result.data || {};
    console.log('🔄 FETCH SELECTIVE: Received data:', Object.keys(latestData));

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
    console.error('❌ FETCH SELECTIVE: Error fetching selective data:', error);
    return {};
  }
};

/**
 * Auto-refresh latest data (called on page refresh)
 * @returns {Promise<Object>} Refresh result
 */
// Track how many times autoRefreshLatestData is called
let autoRefreshCallCount = 0;

export const autoRefreshLatestData = async () => {
  try {
    autoRefreshCallCount++;
    console.log(`🔄 AUTO REFRESH #${autoRefreshCallCount}: Starting efficient data sync check`);

    // Check if user is authenticated
    const auth = localStorage.getItem('auth');
    console.log('🔄 AUTO REFRESH: Auth check - auth exists:', !!auth, 'auth value:', auth ? 'present' : 'null');
    if (!auth) {
      console.log('🔄 AUTO REFRESH: ❌ No authentication found, skipping sync');
      return { success: true, message: 'No authentication', data: {}, recordsProcessed: 0, dataTypesUpdated: 0 };
    }

    const isOnlineStatus = await isOnline();
    console.log('🔄 AUTO REFRESH: Online check result:', isOnlineStatus);
    if (!isOnlineStatus) {
      console.log('🔄 AUTO REFRESH: ❌ Offline, skipping sync');
      return { success: true, message: 'Offline', data: {}, recordsProcessed: 0, dataTypesUpdated: 0 };
    }

    console.log('🔄 AUTO REFRESH: ✅ Authenticated and online, proceeding with sync');

    // Get last fetch times from IndexedDB
    console.log('🔄 AUTO REFRESH: Getting last fetch times from IndexedDB...');
    const lastFetchTimes = await getLastFetchTimesForAPI();
    console.log('🔄 AUTO REFRESH: Last fetch times retrieved:', lastFetchTimes);
    console.log('🔄 AUTO REFRESH: Current time for comparison:', new Date().toISOString());

    // Call /data/all with last fetch times to check for updates (with deduplication)
    console.log('🔄 AUTO REFRESH: About to call /data/all API with lastFetchTimes');
    const requestBody = { lastFetchTimes };
    console.log('🔄 AUTO REFRESH: Request body:', JSON.stringify(requestBody, null, 2));

    const result = await deduplicateRequest('auto-refresh-sync', async () => {
      return await apiRequest('/data/all', {
        method: 'POST',
        body: requestBody
      });
    });

    console.log('🔄 AUTO REFRESH: API call completed, result:', result);

    if (!result.success) {
      console.warn('🔄 AUTO REFRESH: API call failed:', result.error);
      return { success: false, message: result.error || 'API call failed' };
    }

    const response = result.data;
    console.log('🔄 AUTO REFRESH: API response:', response);

    // Check if plan is invalid/expired
    if (response.planInvalid === true) {
      console.log('🚫 AUTO REFRESH: Plan invalid - user needs to upgrade');
      return {
        success: false,
        planInvalid: true,
        message: response.message || 'Your plan has expired. Please upgrade to continue.',
        planStatus: response.planStatus
      };
    }

    // Check if backend says no updates needed
    if (response.needUpdate === false) {
      console.log('🔄 AUTO REFRESH: ✅ No updates needed - data is current');
      console.log('🔄 AUTO REFRESH: Backend confirmed no changes since last fetch times');
      return {
        success: true,
        message: 'Data is up to date',
        data: {},
        recordsProcessed: 0,
        dataTypesUpdated: 0,
        needUpdate: false
      };
    }

    // Backend returned data - update IndexedDB and UI
    if (response.data && typeof response.data === 'object') {
      const receivedCollections = Object.keys(response.data);
      console.log(`🔄 AUTO REFRESH: 📥 Data received from server - updating ${receivedCollections.length} collections: ${receivedCollections.join(', ')}`);
      console.log(`🔄 AUTO REFRESH: Total records received: ${Object.values(response.data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)}`);

      const dataTypesToUpdate = ['customers', 'products', 'orders', 'transactions', 'purchaseOrders', 'categories', 'refunds', 'plans', 'planOrders'];
      const updatedData = {};
      let totalRecordsProcessed = 0;

      // Update each data type in IndexedDB
      for (const dataType of dataTypesToUpdate) {
        if (response.data[dataType] && Array.isArray(response.data[dataType])) {
          const items = response.data[dataType];
          console.log(`🔄 AUTO REFRESH: 💾 Updating ${items.length} ${dataType} in IndexedDB`);

          // Normalize data
          let normalizedItems = items;
          if (dataType === 'customers') {
            normalizedItems = items.map(customer => normalizeCustomer(customer));
          } else if (dataType === 'products') {
            normalizedItems = items.map(product => normalizeProduct(product));
          }

          // Update IndexedDB (merge: false for full replacement)
          const storeName = getStoreNameForDataType(dataType);
          if (storeName) {
            try {
              await syncToIndexedDB(storeName, normalizedItems, { merge: false });
              console.log(`✅ AUTO REFRESH: Updated ${normalizedItems.length} ${dataType} in IndexedDB`);

              // Prepare data for UI update
              updatedData[dataType] = {
                data: normalizedItems,
                timestamp: new Date().toISOString()
              };
              totalRecordsProcessed += normalizedItems.length;

            } catch (error) {
              console.error(`❌ AUTO REFRESH: Failed to update ${dataType}:`, error);
            }
          }
        }
      }

      // Update last fetch times only for data types that were actually updated
      const currentTime = new Date().toISOString();
      const updatedDataTypes = Object.keys(updatedData);
      console.log(`🔄 AUTO REFRESH: Updating lastFetchTime for ${updatedDataTypes.length} collections: ${updatedDataTypes.join(', ')}`);

      for (const dataType of updatedDataTypes) {
        try {
          await updateLastFetchTime(dataType, currentTime);
          console.log(`✅ AUTO REFRESH: Updated lastFetchTime for ${dataType} to ${currentTime}`);
        } catch (error) {
          console.error(`❌ AUTO REFRESH: Error updating last fetch time for ${dataType}:`, error);
        }
      }

      const dataTypesUpdated = Object.keys(updatedData).length;
      console.log('🔄 AUTO REFRESH: 📦 Sync completed - updated types:', dataTypesUpdated, 'total records:', totalRecordsProcessed);

      return {
        success: true,
        message: `Data sync completed - ${dataTypesUpdated} data types updated (${totalRecordsProcessed} records)`,
        data: updatedData,
        recordsProcessed: totalRecordsProcessed,
        dataTypesUpdated: dataTypesUpdated,
        needUpdate: true
      };
    }

    // Unexpected response format
    console.warn('🔄 AUTO REFRESH: Unexpected API response format');
    return { success: false, message: 'Unexpected API response' };

  } catch (error) {
    console.error('❌ AUTO REFRESH: Error during data sync:', error);
    return { success: false, message: error.message || 'Unknown error during sync' };
  }
};

export { syncToIndexedDB };

export default {
  isOnline,
  fetchCustomers,
  fetchProducts,
  fetchOrders,
  fetchTransactions,
  fetchVendorOrders,
  fetchCategories,
  fetchAllData,
  syncToIndexedDB,
  autoRefreshLatestData
};

