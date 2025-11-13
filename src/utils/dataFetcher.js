/**
 * Data Fetcher Utility
 * Fetches data from backend MongoDB when online, or from IndexedDB when offline
 */

import { apiRequest, checkBackendHealth } from './api';
import { 
  getAllItems, 
  updateItem,
  clearAllItems,
  addMultipleItems,
  STORES 
} from './indexedDB';

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
    sellingPrice: product.sellingUnitPrice || product.sellingPrice || 0 // Backward compatibility
  };
};

/**
 * Check if user is online and backend is available
 */
export const isOnline = async () => {
  // First check navigator.onLine
  if (!navigator.onLine) {
    return false;
  }

  // Then verify backend is actually reachable
  try {
    const healthCheck = await checkBackendHealth();
    return healthCheck.available;
  } catch (error) {
    console.error('Backend health check failed:', error);
    return false;
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
        await syncToIndexedDB(STORES.customers, customers);
        
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
        await syncToIndexedDB(STORES.products, normalizedProducts);
        
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
        await syncToIndexedDB(STORES.orders, orders);
        
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
        await syncToIndexedDB(STORES.transactions, transactions);
        
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
        await syncToIndexedDB(STORES.purchaseOrders, orders);
        
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
        await syncToIndexedDB(STORES.categories, categories);
        
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
  const online = await isOnline();
  
  if (online) {
    try {
      const result = await apiRequest('/data/all', { method: 'GET' });
      
      if (result.success && result.data?.data) {
        const { customers, products, orders, transactions, purchaseOrders, categories } = result.data.data;
        
        // Normalize data before syncing
        const normalizedCustomers = (customers || []).map(customer => normalizeCustomer(customer));
        const normalizedProducts = (products || []).map(product => normalizeProduct(product));
        
        // Update IndexedDB with backend data
        await Promise.all([
          syncToIndexedDB(STORES.customers, normalizedCustomers),
          syncToIndexedDB(STORES.products, normalizedProducts),
          syncToIndexedDB(STORES.orders, orders || []),
          syncToIndexedDB(STORES.transactions, transactions || []),
          syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || []),
          syncToIndexedDB(STORES.categories, categories || [])
        ]);
        
        return {
          customers: normalizedCustomers,
          products: normalizedProducts,
          orders: orders || [],
          transactions: transactions || [],
          purchaseOrders: purchaseOrders || [],
          categories: categories || []
        };
      }
    } catch (error) {
      console.error('Error fetching all data from backend:', error);
      // Fall through to IndexedDB
    }
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
  const normalizedProducts = (products || []).map(product => normalizeProduct(product));
  
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
 */
const syncToIndexedDB = async (storeName, backendItems) => {
  try {
    console.log(`🔄 [syncToIndexedDB] Syncing ${storeName} with ${backendItems.length} items from MongoDB`);
    
    // Step 1: Get existing items from IndexedDB to preserve unsynced local changes
    const existingItems = await getAllItems(storeName);
    
    // Step 2: Separate unsynced items (local changes that haven't been pushed to MongoDB yet)
    const unsyncedItems = existingItems.filter(item => item.isSynced === false);
    
    if (unsyncedItems.length > 0) {
      console.log(`⚠️ [syncToIndexedDB] Preserving ${unsyncedItems.length} unsynced local ${storeName} items`);
    }
    
    // Step 3: Clear all existing data from IndexedDB
    console.log(`🗑️ [syncToIndexedDB] Clearing all existing ${storeName} data from IndexedDB...`);
    await clearAllItems(storeName);
    console.log(`✅ [syncToIndexedDB] Cleared ${storeName} store`);
    
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
      
      // Prepare item for insertion with proper structure
      const itemToInsert = {
        ...normalizedItem,
        id: key, // Use MongoDB _id as id
        isSynced: true // All backend data is synced
      };
      
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
      console.log(`📥 [syncToIndexedDB] Inserting ${itemsToInsert.length} items from MongoDB into ${storeName}...`);
      await addMultipleItems(storeName, itemsToInsert, true); // Skip validation for backend data
      console.log(`✅ [syncToIndexedDB] Successfully inserted ${itemsToInsert.length} items into ${storeName}`);
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
    console.error(`❌ [syncToIndexedDB] Error syncing ${storeName} to IndexedDB:`, error);
    throw error;
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
  syncToIndexedDB
};

