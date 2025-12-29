/**
 * Comprehensive IndexedDB utility for ERP_DB
 * Provides async wrapper with Promises for all CRUD operations
 * EXACTLY aligned with MongoDB schemas - no extra fields or stores
 *
 * Database Models - EXACT MongoDB Schema:
 * - Customers: sellerId, name, dueAmount, mobileNumber, email, createdAt, updatedAt, isSynced, _id, id
 * - Products: sellerId, name, barcode, categoryId, stock, unit, lowStockLevel, costPrice, sellingUnitPrice, mfg, expiryDate, description, isActive, createdAt, updatedAt, isSynced, _id, id
 * - Orders: sellerId (required), customerId (optional), paymentMethod (enum: cash/card/upi/due/credit), items[] (name, sellingPrice, costPrice, quantity, unit), totalAmount (required), createdAt, updatedAt, isSynced, _id, id (for sales/billing records)
 * - Transactions: sellerId, type (plan_purchase only), amount, paymentMethod, description, razorpayOrderId, razorpayPaymentId, planOrderId, planId, date, createdAt, updatedAt, isSynced, _id, id (ONLY for plan purchases)
 * - VendorOrders (purchaseOrders): sellerId, supplierName, items[], total, status, notes, expectedDeliveryDate, actualDeliveryDate, cancelledAt, cancelledReason, createdAt, updatedAt, isSynced, _id, id
 * - ProductCategories (categories): sellerId, name, isActive, description, createdAt, updatedAt, isSynced, _id, id
 * - Refunds: orderId, customerId, sellerId, items[] (productId, name, qty, rate, lineTotal, unit), totalRefundAmount, reason, refundedByUser, createdAt, updatedAt, isSynced, _id, id
 * - Plans: name, description, price, durationDays, unlockedModules, lockedModules, maxCustomers, maxProducts, maxOrders, isActive, totalSales, totalRevenue, createdAt, updatedAt, _id, id
 * - PlanOrders: sellerId, planId, expiryDate, durationDays, price, status, paymentStatus, paymentMethod, lastActivatedAt, accumulatedUsedMs, customerLimit, productLimit, orderLimit, customerCurrentCount, productCurrentCount, orderCurrentCount, razorpayOrderId, razorpayPaymentId, razorpaySignature, totalCustomers, totalOrders, totalProducts, createdAt, updatedAt, isSynced, _id, id
 * - Activities: id, message, timestamp, type, createdAt (frontend-only for UI logging)
 */

// Cache for IndexedDB availability check to prevent repeated timeouts
let indexedDBAvailabilityCache = null;
let indexedDBAvailabilityCheckPromise = null;
let lastTimeoutWarningTime = 0;

// Flags for database state management
let databaseMissingLogoutTriggered = false;
let indexedDBStorageRestricted = false;

// Check if IndexedDB is available and working
export const isIndexedDBAvailable = async () => {
  // Return cached result if available
  if (indexedDBAvailabilityCache !== null) {
    return indexedDBAvailabilityCache;
  }

  // Return existing promise if check is already in progress
  if (indexedDBAvailabilityCheckPromise) {
    return indexedDBAvailabilityCheckPromise;
  }

  try {
    // Check if IndexedDB is supported
    if (!window.indexedDB) {

      indexedDBAvailabilityCache = false;
      return false;
    }

    // Try to open a test database to check if IndexedDB works
    // This will fail in private browsing mode or when storage is disabled
    indexedDBAvailabilityCheckPromise = new Promise((resolve) => {
      const testDB = indexedDB.open('test-db', 1);

      testDB.onerror = () => {

        indexedDBAvailabilityCache = false;
        indexedDBAvailabilityCheckPromise = null;
        resolve(false);
      };

      testDB.onsuccess = () => {
        // Clean up test database
        const db = testDB.result;
        db.close();
        indexedDB.deleteDatabase('test-db');
        indexedDBAvailabilityCache = true;
        indexedDBAvailabilityCheckPromise = null;
        resolve(true);
      };

      // Timeout after 5 seconds in case the callbacks don't fire (increased from 3 seconds)
      setTimeout(() => {
        // Only log timeout warning once every 30 seconds to prevent console spam
        const now = Date.now();
        if (now - lastTimeoutWarningTime > 30000) {

          lastTimeoutWarningTime = now;
        }
        // Don't mark as unavailable - let operations proceed and fail naturally if IndexedDB really doesn't work
        indexedDBAvailabilityCache = true; // Assume available and let operations fail if not
        indexedDBAvailabilityCheckPromise = null;
        resolve(true);
      }, 5000);
    });

    return indexedDBAvailabilityCheckPromise;
  } catch (error) {

    indexedDBAvailabilityCache = false;
    indexedDBAvailabilityCheckPromise = null;
    return false;
  }
};

// Reset the IndexedDB availability cache (useful for testing or when availability might change)
export const resetIndexedDBAvailabilityCache = () => {
  indexedDBAvailabilityCache = null;
  indexedDBAvailabilityCheckPromise = null;
  lastTimeoutWarningTime = 0;
};

const DB_NAME = 'ERP_DB';
const DB_VERSION = 28; // Force migration for achievements

// Object Store Names - ALL MongoDB models + frontend-only activities
export const STORES = {
  customers: 'customers',
  products: 'products',
  productBatches: 'productBatches', // Product batch records (ProductBatch model)
  orders: 'orders', // For sales/billing records (Order model)
  transactions: 'transactions', // ONLY for plan purchases (Transaction model)
  purchaseOrders: 'purchaseOrders', // Maps to VendorOrder in MongoDB
  categories: 'categories', // Maps to ProductCategory in MongoDB
  refunds: 'refunds', // Refund records (Refund model)
  plans: 'plans', // Premium plan details
  planOrders: 'planOrders', // Plan purchase orders
  planDetails: 'planDetails', // Cached active plan details per seller
  settings: 'settings', // Seller settings with offline sync support
  activities: 'activities',// Frontend-only for UI logging
  staff: 'staff', // Staff data and permissions
  syncMetadata: 'syncMetadata', // Metadata for tracking lastSync timestamps per collection
  syncTracking: 'syncTracking', // New store for sync tracking per data type
  expenses: 'expenses', // Expense tracking
  staffPermissions: 'staffPermissions', // Cached staff permissions
};

// Helper function to safely perform database operations with IndexedDB availability check
const withIndexedDB = async (operation, fallback = null) => {
  try {
    const db = await openDB();
    if (!db) {

      return fallback;
    }
    return await operation(db);
  } catch (error) {
    console.error(`IndexedDB error during operation:`, error);
    return fallback;
  }
};

// Database initialization with error handling for storage restrictions
const openDB = () => {
  return new Promise((resolve, reject) => {
    // Try to open the database directly
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      const error = request.error;
      const errorMessage = error?.message || error?.toString() || 'Unknown IndexedDB error';

      // Handle specific storage-related errors gracefully
      if (errorMessage.includes('Internal error opening backing store') ||
        errorMessage.includes('UnknownError') ||
        errorMessage.includes('QuotaExceededError')) {

        reject(new Error('IndexedDB storage unavailable'));
      } else {
        reject(error);
      }
    };
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const transaction = event.target.transaction;
      const oldVersion = event.oldVersion;

      // Create Expenses Store
      if (!db.objectStoreNames.contains(STORES.expenses)) {
        const expenseStore = db.createObjectStore(STORES.expenses, { keyPath: 'id', autoIncrement: false });
        expenseStore.createIndex('sellerId', 'sellerId', { unique: false });
        expenseStore.createIndex('date', 'date', { unique: false });
        expenseStore.createIndex('category', 'category', { unique: false });
        expenseStore.createIndex('createdAt', 'createdAt', { unique: false });
        expenseStore.createIndex('isSynced', 'isSynced', { unique: false });
        expenseStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        // Add missing indexes if store exists but indexes don't (for future migrations if needed)
        const expenseStore = transaction.objectStore(STORES.expenses);
        if (!expenseStore.indexNames.contains('isSynced')) {
          expenseStore.createIndex('isSynced', 'isSynced', { unique: false });
        }
      }



      // Create Customers Store - EXACT MongoDB Customer schema
      // MongoDB: sellerId, name, dueAmount, mobileNumber, email
      if (!db.objectStoreNames.contains(STORES.customers)) {
        const customerStore = db.createObjectStore(STORES.customers, { keyPath: 'id', autoIncrement: false });
        customerStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        customerStore.createIndex('name', 'name', { unique: false });
        customerStore.createIndex('mobileNumber', 'mobileNumber', { unique: false });
        customerStore.createIndex('email', 'email', { unique: false });
        customerStore.createIndex('dueAmount', 'dueAmount', { unique: false });
        customerStore.createIndex('createdAt', 'createdAt', { unique: false });
        customerStore.createIndex('isSynced', 'isSynced', { unique: false });
        customerStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const customerStore = transaction.objectStore(STORES.customers);

        // Migration: Remove phone index if it exists (version 7+)
        if (oldVersion < 7 && customerStore.indexNames.contains('phone')) {
          customerStore.deleteIndex('phone');
        }

        // Migration for version 9: Add sellerId index (MongoDB field)
        if (oldVersion < 9) {
          if (!customerStore.indexNames.contains('sellerId')) {
            customerStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
        }

        // Add missing indexes to existing store
        if (oldVersion < 6) {
          if (!customerStore.indexNames.contains('mobileNumber')) {
            customerStore.createIndex('mobileNumber', 'mobileNumber', { unique: false });
          }
          if (!customerStore.indexNames.contains('dueAmount')) {
            customerStore.createIndex('dueAmount', 'dueAmount', { unique: false });
          }
          if (!customerStore.indexNames.contains('isSynced')) {
            customerStore.createIndex('isSynced', 'isSynced', { unique: false });
          }
        }

        // Add isDeleted index for soft delete support
        if (!customerStore.indexNames.contains('isDeleted')) {
          customerStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        }
      }

      // Create Products Store - EXACT MongoDB Product model
      // MongoDB: sellerId, name, barcode, categoryId, stock, unit, lowStockLevel, costPrice, sellingUnitPrice, mfg, expiryDate, description, isActive
      if (!db.objectStoreNames.contains(STORES.products)) {
        const productStore = db.createObjectStore(STORES.products, { keyPath: 'id', autoIncrement: false });
        productStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        productStore.createIndex('name', 'name', { unique: false });
        productStore.createIndex('barcode', 'barcode', { unique: false });
        productStore.createIndex('categoryId', 'categoryId', { unique: false });
        productStore.createIndex('stock', 'stock', { unique: false }); // MongoDB uses 'stock' not 'quantity'
        productStore.createIndex('quantity', 'quantity', { unique: false }); // Keep for backward compatibility
        productStore.createIndex('unit', 'unit', { unique: false });
        productStore.createIndex('lowStockLevel', 'lowStockLevel', { unique: false });
        productStore.createIndex('costPrice', 'costPrice', { unique: false }); // MongoDB uses 'costPrice'
        productStore.createIndex('sellingUnitPrice', 'sellingUnitPrice', { unique: false }); // MongoDB uses 'sellingUnitPrice'
        productStore.createIndex('mfg', 'mfg', { unique: false });
        productStore.createIndex('expiryDate', 'expiryDate', { unique: false });
        productStore.createIndex('description', 'description', { unique: false });
        productStore.createIndex('isActive', 'isActive', { unique: false });
        productStore.createIndex('createdAt', 'createdAt', { unique: false });
        productStore.createIndex('isSynced', 'isSynced', { unique: false });
        productStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const productStore = transaction.objectStore(STORES.products);

        // Migration for version 9: Add sellerId index (MongoDB field)
        if (oldVersion < 9) {
          if (!productStore.indexNames.contains('sellerId')) {
            productStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
        }

        // Migration for version 8: Align with MongoDB model
        if (oldVersion < 8) {
          // Add stock index (MongoDB uses 'stock' not 'quantity')
          if (!productStore.indexNames.contains('stock')) {
            productStore.createIndex('stock', 'stock', { unique: false });
          }
          // Add costPrice index if missing
          if (!productStore.indexNames.contains('costPrice')) {
            productStore.createIndex('costPrice', 'costPrice', { unique: false });
          }
          // Add sellingUnitPrice index if missing
          if (!productStore.indexNames.contains('sellingUnitPrice')) {
            productStore.createIndex('sellingUnitPrice', 'sellingUnitPrice', { unique: false });
          }
          // Add mfg index if missing
          if (!productStore.indexNames.contains('mfg')) {
            productStore.createIndex('mfg', 'mfg', { unique: false });
          }
        }

        // Migration for older versions
        if (oldVersion < 6) {
          // Ensure quantity index exists (for backward compatibility)
          if (!productStore.indexNames.contains('quantity')) {
            productStore.createIndex('quantity', 'quantity', { unique: false });
          }

          // Add isSynced index for sync tracking
          if (!productStore.indexNames.contains('isSynced')) {
            productStore.createIndex('isSynced', 'isSynced', { unique: false });
          }

          // Add other missing indexes if needed
          const indexesToAdd = [
            { name: 'categoryId', keyPath: 'categoryId', unique: false },
            { name: 'unit', keyPath: 'unit', unique: false },
            { name: 'lowStockLevel', keyPath: 'lowStockLevel', unique: false },
            { name: 'sellingUnitPrice', keyPath: 'sellingUnitPrice', unique: false },
            { name: 'isActive', keyPath: 'isActive', unique: false }
          ];
          indexesToAdd.forEach(idx => {
            if (!productStore.indexNames.contains(idx.name)) {
              productStore.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            }
          });
        }

        // Add isDeleted index for soft delete support
        if (!productStore.indexNames.contains('isDeleted')) {
          productStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        }
      }

      // Create Product Batches Store - EXACT MongoDB ProductBatch model
      // MongoDB: sellerId, productId, batchNumber, mfg, expiry, quantity, costPrice, sellingUnitPrice, isDeleted
      if (!db.objectStoreNames.contains(STORES.productBatches)) {
        const productBatchStore = db.createObjectStore(STORES.productBatches, { keyPath: 'id', autoIncrement: false });
        productBatchStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        productBatchStore.createIndex('productId', 'productId', { unique: false }); // MongoDB field
        productBatchStore.createIndex('batchNumber', 'batchNumber', { unique: false });
        productBatchStore.createIndex('mfg', 'mfg', { unique: false });
        productBatchStore.createIndex('expiry', 'expiry', { unique: false });
        productBatchStore.createIndex('quantity', 'quantity', { unique: false });
        productBatchStore.createIndex('costPrice', 'costPrice', { unique: false });
        productBatchStore.createIndex('sellingUnitPrice', 'sellingUnitPrice', { unique: false });
        productBatchStore.createIndex('createdAt', 'createdAt', { unique: false });
        productBatchStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        productBatchStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      }

      // Create Transactions Store - EXACT MongoDB Transaction model
      // MongoDB: sellerId, type, amount, paymentMethod, description, razorpayOrderId, razorpayPaymentId, planOrderId, planId, date
      if (!db.objectStoreNames.contains(STORES.transactions)) {
        const transactionStore = db.createObjectStore(STORES.transactions, { keyPath: 'id', autoIncrement: false });
        transactionStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        transactionStore.createIndex('type', 'type', { unique: false });
        transactionStore.createIndex('amount', 'amount', { unique: false });
        transactionStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
        transactionStore.createIndex('description', 'description', { unique: false });
        transactionStore.createIndex('date', 'date', { unique: false });
        transactionStore.createIndex('razorpayOrderId', 'razorpayOrderId', { unique: false });
        transactionStore.createIndex('razorpayPaymentId', 'razorpayPaymentId', { unique: false });
        transactionStore.createIndex('planOrderId', 'planOrderId', { unique: false });
        transactionStore.createIndex('planId', 'planId', { unique: false });
        transactionStore.createIndex('createdAt', 'createdAt', { unique: false });
        transactionStore.createIndex('isSynced', 'isSynced', { unique: false });
        transactionStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        // Frontend-only fields for UI (not in MongoDB)
        transactionStore.createIndex('customerId', 'customerId', { unique: false });
        transactionStore.createIndex('customerName', 'customerName', { unique: false });
        transactionStore.createIndex('total', 'total', { unique: false }); // For backward compatibility
      } else {
        const transactionStore = transaction.objectStore(STORES.transactions);

        // Migration for version 9: Add sellerId index (MongoDB field)
        if (oldVersion < 9) {
          if (!transactionStore.indexNames.contains('sellerId')) {
            transactionStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
        }

        // Migration for version 8: Align with MongoDB Transaction model
        if (oldVersion < 8) {
          // Ensure MongoDB-required indexes exist
          const mongoIndexes = [
            { name: 'type', keyPath: 'type', unique: false },
            { name: 'amount', keyPath: 'amount', unique: false },
            { name: 'paymentMethod', keyPath: 'paymentMethod', unique: false },
            { name: 'description', keyPath: 'description', unique: false },
            { name: 'date', keyPath: 'date', unique: false },
            { name: 'razorpayOrderId', keyPath: 'razorpayOrderId', unique: false },
            { name: 'razorpayPaymentId', keyPath: 'razorpayPaymentId', unique: false },
            { name: 'planOrderId', keyPath: 'planOrderId', unique: false },
            { name: 'planId', keyPath: 'planId', unique: false }
          ];
          mongoIndexes.forEach(idx => {
            if (!transactionStore.indexNames.contains(idx.name)) {
              transactionStore.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            }
          });
        }

        // Migration for older versions
        if (oldVersion < 6) {
          // Add isSynced index
          if (!transactionStore.indexNames.contains('isSynced')) {
            transactionStore.createIndex('isSynced', 'isSynced', { unique: false });
          }
        }

        // Add isDeleted index for soft delete support
        if (!transactionStore.indexNames.contains('isDeleted')) {
          transactionStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        }
      }

      // Create Purchase Orders Store (VendorOrder) - EXACT MongoDB VendorOrder schema
      // MongoDB: sellerId, supplierName, items[], total, status, notes, expectedDeliveryDate, actualDeliveryDate, cancelledAt, cancelledReason
      if (!db.objectStoreNames.contains(STORES.purchaseOrders)) {
        const poStore = db.createObjectStore(STORES.purchaseOrders, { keyPath: 'id', autoIncrement: false });
        poStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        poStore.createIndex('supplierName', 'supplierName', { unique: false });
        poStore.createIndex('status', 'status', { unique: false });
        poStore.createIndex('total', 'total', { unique: false });
        poStore.createIndex('notes', 'notes', { unique: false });
        poStore.createIndex('expectedDeliveryDate', 'expectedDeliveryDate', { unique: false });
        poStore.createIndex('actualDeliveryDate', 'actualDeliveryDate', { unique: false });
        poStore.createIndex('cancelledAt', 'cancelledAt', { unique: false });
        poStore.createIndex('cancelledReason', 'cancelledReason', { unique: false });
        poStore.createIndex('createdAt', 'createdAt', { unique: false });
        poStore.createIndex('isSynced', 'isSynced', { unique: false });
        poStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const poStore = transaction.objectStore(STORES.purchaseOrders);

        // Migration for version 9: Add missing MongoDB fields
        if (oldVersion < 9) {
          // Add sellerId index (MongoDB field)
          if (!poStore.indexNames.contains('sellerId')) {
            poStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
          // Add notes index (in MongoDB VendorOrder)
          if (!poStore.indexNames.contains('notes')) {
            poStore.createIndex('notes', 'notes', { unique: false });
          }
          // Add cancelledReason index (in MongoDB VendorOrder)
          if (!poStore.indexNames.contains('cancelledReason')) {
            poStore.createIndex('cancelledReason', 'cancelledReason', { unique: false });
          }
        }

        // Migration for older versions
        if (oldVersion < 6) {
          // Add missing indexes to existing store
          const indexesToAdd = [
            { name: 'expectedDeliveryDate', keyPath: 'expectedDeliveryDate', unique: false },
            { name: 'actualDeliveryDate', keyPath: 'actualDeliveryDate', unique: false },
            { name: 'cancelledAt', keyPath: 'cancelledAt', unique: false },
            { name: 'isSynced', keyPath: 'isSynced', unique: false }
          ];
          indexesToAdd.forEach(idx => {
            if (!poStore.indexNames.contains(idx.name)) {
              poStore.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            }
          });
        }

        // Add isDeleted index for soft delete support
        if (!poStore.indexNames.contains('isDeleted')) {
          poStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        }
      }

      // Create Activities Store (frontend-only for UI logging - not in MongoDB)
      if (!db.objectStoreNames.contains(STORES.activities)) {
        const activityStore = db.createObjectStore(STORES.activities, { keyPath: 'id', autoIncrement: false });
        activityStore.createIndex('type', 'type', { unique: false });
        activityStore.createIndex('timestamp', 'timestamp', { unique: false });
        activityStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create Staff Store (for staff data and permissions)
      if (!db.objectStoreNames.contains(STORES.staff)) {
        const staffStore = db.createObjectStore(STORES.staff, { keyPath: 'id', autoIncrement: false });
        staffStore.createIndex('sellerId', 'sellerId', { unique: false });
        staffStore.createIndex('email', 'email', { unique: true });
        staffStore.createIndex('createdAt', 'createdAt', { unique: false });
        staffStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        staffStore.createIndex('isSynced', 'isSynced', { unique: false });
        staffStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      }

      // Create Sync Metadata Store (for tracking lastSync timestamps per collection)
      if (!db.objectStoreNames.contains(STORES.syncMetadata)) {
        const metadataStore = db.createObjectStore(STORES.syncMetadata, { keyPath: 'id', autoIncrement: false });
        metadataStore.createIndex('collection', 'collection', { unique: true });
        metadataStore.createIndex('lastSync', 'lastSync', { unique: false });
        metadataStore.createIndex('createdAt', 'createdAt', { unique: false });
        metadataStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Create Sync Tracking Store (only stores lastFetchTime per data type)
      if (!db.objectStoreNames.contains(STORES.syncTracking)) {
        const syncTrackingStore = db.createObjectStore(STORES.syncTracking, { keyPath: 'dataType', autoIncrement: false });
        syncTrackingStore.createIndex('lastFetchTime', 'lastFetchTime', { unique: false });
      }

      // Create Staff Permissions Store
      if (!db.objectStoreNames.contains(STORES.staffPermissions)) {
        const staffPermsStore = db.createObjectStore(STORES.staffPermissions, { keyPath: 'id', autoIncrement: false });
        staffPermsStore.createIndex('userId', 'userId', { unique: true });
        staffPermsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Migration for version 9: Remove unnecessary stores (invoices, settings) that don't exist in MongoDB
      if (oldVersion < 9) {
        // Remove invoices store if it exists (not in MongoDB)
        if (db.objectStoreNames.contains('invoices')) {
          db.deleteObjectStore('invoices');
        }
        // Remove legacy settings store so it can be recreated with the new schema
        if (db.objectStoreNames.contains(STORES.settings)) {
          db.deleteObjectStore('settings');
        }
      }

      // Create Settings Store (seller settings with offline sync support)
      if (!db.objectStoreNames.contains(STORES.settings)) {
        const settingsStore = db.createObjectStore(STORES.settings, { keyPath: 'id', autoIncrement: false });
        settingsStore.createIndex('sellerId', 'sellerId', { unique: false });
        settingsStore.createIndex('isSynced', 'isSynced', { unique: false });
        settingsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Create Orders Store - EXACT MongoDB Order schema (for sales/billing records)
      // MongoDB Order Schema:
      // - sellerId: ObjectId (required, ref: Seller)
      // - customerId: ObjectId (optional, ref: Customer)
      // - paymentMethod: String (required, enum: ["cash","card","upi","due","credit","split"], default: "cash")
      // - splitPaymentDetails: Object { type: String (enum: ["cash_online","online_due","cash_due"]), cashAmount: Number, onlineAmount: Number, dueAmount: Number }
      // - items: Array of { name, sellingPrice, costPrice, quantity, unit } (all required)
      // - totalAmount: Number (required)
      // - createdAt: Date (auto from timestamps)
      // - updatedAt: Date (auto from timestamps)
      // Frontend additions:
      // - id: String (frontend ID, keyPath)
      // - _id: String (MongoDB _id after sync)
      // - isSynced: Boolean (sync status)
      // - syncedAt: Date (when synced)
      if (!db.objectStoreNames.contains(STORES.orders)) {
        const orderStore = db.createObjectStore(STORES.orders, { keyPath: 'id', autoIncrement: false });

        // Indexes for MongoDB fields
        orderStore.createIndex('sellerId', 'sellerId', { unique: false });
        orderStore.createIndex('customerId', 'customerId', { unique: false });
        orderStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
        orderStore.createIndex('totalAmount', 'totalAmount', { unique: false });

        // Indexes for timestamps (from MongoDB timestamps option)
        orderStore.createIndex('createdAt', 'createdAt', { unique: false });
        orderStore.createIndex('updatedAt', 'updatedAt', { unique: false });

        // Indexes for sync management
        orderStore.createIndex('isSynced', 'isSynced', { unique: false });
        orderStore.createIndex('syncedAt', 'syncedAt', { unique: false });

        // Index for MongoDB _id (after sync)
        orderStore.createIndex('_id', '_id', { unique: false });

        // Index for soft delete support
        orderStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const orderStore = transaction.objectStore(STORES.orders);
        // Migration for version 11: Add missing indexes (updatedAt, syncedAt, _id)
        if (oldVersion < 11) {
          const indexesToAdd = [
            { name: 'sellerId', keyPath: 'sellerId' },
            { name: 'customerId', keyPath: 'customerId' },
            { name: 'paymentMethod', keyPath: 'paymentMethod' },
            { name: 'totalAmount', keyPath: 'totalAmount' },
            { name: 'createdAt', keyPath: 'createdAt' },
            { name: 'updatedAt', keyPath: 'updatedAt' },
            { name: 'isSynced', keyPath: 'isSynced' },
            { name: 'syncedAt', keyPath: 'syncedAt' },
            { name: '_id', keyPath: '_id' },
            { name: 'isDeleted', keyPath: 'isDeleted' }
          ];

          indexesToAdd.forEach(index => {
            if (!orderStore.indexNames.contains(index.name)) {

              orderStore.createIndex(index.name, index.keyPath, { unique: false });
            }
          });
        }

        // Migration for version 17: Split payment support (no new indexes needed, just schema update)
        if (oldVersion < 17) {

          // IndexedDB can store nested objects without explicit indexes
          // The splitPaymentDetails will be stored as part of the order object
        }
      }

      // Create Plans Store - EXACT MongoDB Plan schema (for premium plan details)
      // MongoDB: name, description, price, durationDays, unlockedModules, lockedModules, maxCustomers, maxProducts, maxOrders, isActive, totalSales, totalRevenue
      if (!db.objectStoreNames.contains(STORES.plans)) {
        const planStore = db.createObjectStore(STORES.plans, { keyPath: 'id', autoIncrement: false });
        planStore.createIndex('name', 'name', { unique: false });
        planStore.createIndex('price', 'price', { unique: false });
        planStore.createIndex('durationDays', 'durationDays', { unique: false });
        planStore.createIndex('isActive', 'isActive', { unique: false });
        planStore.createIndex('createdAt', 'createdAt', { unique: false });
      } else {
        const planStore = transaction.objectStore(STORES.plans);
        // Migration for version 10: Ensure all indexes exist
        if (oldVersion < 10) {
          if (!planStore.indexNames.contains('name')) {
            planStore.createIndex('name', 'name', { unique: false });
          }
          if (!planStore.indexNames.contains('price')) {
            planStore.createIndex('price', 'price', { unique: false });
          }
          if (!planStore.indexNames.contains('durationDays')) {
            planStore.createIndex('durationDays', 'durationDays', { unique: false });
          }
          if (!planStore.indexNames.contains('isActive')) {
            planStore.createIndex('isActive', 'isActive', { unique: false });
          }
        }
      }

      // Create PlanOrders Store - EXACT MongoDB PlanOrder schema (for plan purchase orders)
      // MongoDB: sellerId, planId, expiryDate, durationDays, price, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentStatus, totalCustomers, totalOrders, totalProducts
      if (!db.objectStoreNames.contains(STORES.planOrders)) {
        const planOrderStore = db.createObjectStore(STORES.planOrders, { keyPath: 'id', autoIncrement: false });
        planOrderStore.createIndex('sellerId', 'sellerId', { unique: false });
        planOrderStore.createIndex('planId', 'planId', { unique: false });
        planOrderStore.createIndex('expiryDate', 'expiryDate', { unique: false });
        planOrderStore.createIndex('paymentStatus', 'paymentStatus', { unique: false });
        planOrderStore.createIndex('razorpayOrderId', 'razorpayOrderId', { unique: false });
        planOrderStore.createIndex('razorpayPaymentId', 'razorpayPaymentId', { unique: false });
        planOrderStore.createIndex('createdAt', 'createdAt', { unique: false });
        planOrderStore.createIndex('isSynced', 'isSynced', { unique: false });
      } else {
        const planOrderStore = transaction.objectStore(STORES.planOrders);
        // Migration for version 10: Ensure all indexes exist
        if (oldVersion < 10) {
          if (!planOrderStore.indexNames.contains('sellerId')) {
            planOrderStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
          if (!planOrderStore.indexNames.contains('planId')) {
            planOrderStore.createIndex('planId', 'planId', { unique: false });
          }
          if (!planOrderStore.indexNames.contains('expiryDate')) {
            planOrderStore.createIndex('expiryDate', 'expiryDate', { unique: false });
          }
          if (!planOrderStore.indexNames.contains('paymentStatus')) {
            planOrderStore.createIndex('paymentStatus', 'paymentStatus', { unique: false });
          }
          if (!planOrderStore.indexNames.contains('isSynced')) {
            planOrderStore.createIndex('isSynced', 'isSynced', { unique: false });
          }
        }
      }

      if (!db.objectStoreNames.contains(STORES.planDetails)) {
        const planDetailStore = db.createObjectStore(STORES.planDetails, { keyPath: 'id', autoIncrement: false });
        planDetailStore.createIndex('sellerId', 'sellerId', { unique: false });
        planDetailStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else {
        const planDetailStore = transaction.objectStore(STORES.planDetails);
        if (!planDetailStore.indexNames.contains('sellerId')) {
          planDetailStore.createIndex('sellerId', 'sellerId', { unique: false });
        }
        if (!planDetailStore.indexNames.contains('updatedAt')) {
          planDetailStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }

      // Create Categories Store - EXACT MongoDB ProductCategory schema
      // MongoDB: sellerId, name, isActive, description (NO image field)
      // Create Refunds Store - EXACT MongoDB Refund schema
      // MongoDB: orderId, customerId, sellerId, items[], totalRefundAmount, reason, refundedByUser
      if (!db.objectStoreNames.contains(STORES.refunds)) {
        const refundStore = db.createObjectStore(STORES.refunds, { keyPath: 'id', autoIncrement: false });
        refundStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        refundStore.createIndex('orderId', 'orderId', { unique: false }); // MongoDB field
        refundStore.createIndex('customerId', 'customerId', { unique: false }); // MongoDB field
        refundStore.createIndex('createdAt', 'createdAt', { unique: false });
        refundStore.createIndex('isSynced', 'isSynced', { unique: false });
        refundStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const refundStore = transaction.objectStore(STORES.refunds);

        // Add missing indexes to existing store
        if (oldVersion < 18) {
          if (!refundStore.indexNames.contains('sellerId')) {
            refundStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
          if (!refundStore.indexNames.contains('orderId')) {
            refundStore.createIndex('orderId', 'orderId', { unique: false });
          }
          if (!refundStore.indexNames.contains('customerId')) {
            refundStore.createIndex('customerId', 'customerId', { unique: false });
          }
          if (!refundStore.indexNames.contains('isSynced')) {
            refundStore.createIndex('isSynced', 'isSynced', { unique: false });
          }
          if (!refundStore.indexNames.contains('isDeleted')) {
            refundStore.createIndex('isDeleted', 'isDeleted', { unique: false });
          }
        }
      }

      if (!db.objectStoreNames.contains(STORES.categories)) {
        const categoryStore = db.createObjectStore(STORES.categories, { keyPath: 'id', autoIncrement: false });
        categoryStore.createIndex('sellerId', 'sellerId', { unique: false }); // MongoDB field
        categoryStore.createIndex('name', 'name', { unique: false }); // Not unique - multiple sellers can have same name
        categoryStore.createIndex('isActive', 'isActive', { unique: false });
        categoryStore.createIndex('description', 'description', { unique: false });
        categoryStore.createIndex('createdAt', 'createdAt', { unique: false });
        categoryStore.createIndex('isSynced', 'isSynced', { unique: false });
        categoryStore.createIndex('isDeleted', 'isDeleted', { unique: false });
      } else {
        const categoryStore = transaction.objectStore(STORES.categories);

        // Migration for version 9: Remove image index (not in MongoDB), add sellerId and description indexes
        if (oldVersion < 9) {
          // Add sellerId index (MongoDB field)
          if (!categoryStore.indexNames.contains('sellerId')) {
            categoryStore.createIndex('sellerId', 'sellerId', { unique: false });
          }
          // Remove image index if it exists (not in MongoDB ProductCategory schema)
          if (categoryStore.indexNames.contains('image')) {
            categoryStore.deleteIndex('image');
          }
          // Add description index (in MongoDB)
          if (!categoryStore.indexNames.contains('description')) {
            categoryStore.createIndex('description', 'description', { unique: false });
          }
          // Remove unique constraint on name (multiple sellers can have same category name)
          if (categoryStore.indexNames.contains('name')) {
            try {
              categoryStore.deleteIndex('name');
              categoryStore.createIndex('name', 'name', { unique: false });
            } catch (e) {
              // Index might already be non-unique
            }
          }
        }

        // Migration for older versions
        if (oldVersion < 6) {
          if (!categoryStore.indexNames.contains('isActive')) {
            categoryStore.createIndex('isActive', 'isActive', { unique: false });
          }
          if (!categoryStore.indexNames.contains('isSynced')) {
            categoryStore.createIndex('isSynced', 'isSynced', { unique: false });
          }
        }

        // Add isDeleted index for soft delete support
        if (!categoryStore.indexNames.contains('isDeleted')) {
          categoryStore.createIndex('isDeleted', 'isDeleted', { unique: false });
        }
      }

      // Migration for version 22: Simplify syncTracking to only store lastSyncTime
      if (oldVersion < 22 && db.objectStoreNames.contains(STORES.syncTracking)) {
        const syncTrackingStore = transaction.objectStore(STORES.syncTracking);

        // Remove old indexes that are no longer needed
        if (syncTrackingStore.indexNames.contains('lastFullSync')) {
          syncTrackingStore.deleteIndex('lastFullSync');
        }
        if (syncTrackingStore.indexNames.contains('updatedAt')) {
          syncTrackingStore.deleteIndex('updatedAt');
        }

        // Clear all existing data to start fresh with simplified structure
        const clearRequest = syncTrackingStore.clear();
        clearRequest.onsuccess = () => {

        };
      }

      // Migration for version 24: Ensure lastFetchTime index exists (no-op since store is created with correct schema)
      if (oldVersion < 24 && db.objectStoreNames.contains(STORES.syncTracking)) {

        // The store is created with the correct schema at the top of this function
        // No migration needed since we changed the initial schema
      }

      // Migration for version 25: Force refresh of syncTracking data
      if (oldVersion < 25 && db.objectStoreNames.contains(STORES.syncTracking)) {

        const syncTrackingStore = transaction.objectStore(STORES.syncTracking);
        const clearRequest = syncTrackingStore.clear();
        clearRequest.onsuccess = () => {

        };
        clearRequest.onerror = (event) => {

        };
      }

    };

    request.onerror = () => {

      reject(request.error);
    };
  });
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate customer data according to backend model
 * @param {Object} customer - Customer object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateCustomer = (customer) => {
  const errors = [];

  if (!customer.name || typeof customer.name !== 'string' || customer.name.trim() === '') {
    errors.push('Customer name is required');
  }

  if (customer.dueAmount !== undefined && customer.dueAmount !== null) {
    const parsedDue = typeof customer.dueAmount === 'number'
      ? customer.dueAmount
      : parseFloat(customer.dueAmount);
    if (!Number.isFinite(parsedDue)) {
      errors.push('Due amount must be a valid number');
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate product data according to backend model
 * @param {Object} product - Product object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateProduct = (product) => {
  const errors = [];

  if (!product.name || typeof product.name !== 'string' || product.name.trim() === '') {
    errors.push('Product name is required');
  }

  // MongoDB uses 'stock', but frontend may use 'quantity' for compatibility
  const stock = product.stock !== undefined ? product.stock : product.quantity;
  if (stock !== undefined && stock !== null) {
    if (typeof stock !== 'number' || stock < 0) {
      errors.push('Product stock/quantity must be a non-negative number');
    }
  }

  if (product.unit && typeof product.unit !== 'string') {
    errors.push('Product unit must be a string');
  }

  // MongoDB uses 'costPrice', but frontend may use 'unitPrice' for compatibility
  const costPrice = product.costPrice !== undefined ? product.costPrice : product.unitPrice;
  if (costPrice !== undefined && costPrice !== null) {
    if (typeof costPrice !== 'number' || costPrice < 0) {
      errors.push('Cost price/unit price must be a non-negative number');
    }
  }

  if (product.sellingUnitPrice !== undefined && product.sellingUnitPrice !== null) {
    if (typeof product.sellingUnitPrice !== 'number' || product.sellingUnitPrice < 0) {
      errors.push('Selling unit price must be a non-negative number');
    }
  }

  // Backward compatibility: sellingPrice
  if (product.sellingPrice !== undefined && product.sellingPrice !== null) {
    if (typeof product.sellingPrice !== 'number' || product.sellingPrice < 0) {
      errors.push('Selling price must be a non-negative number');
    }
  }

  if (product.lowStockLevel !== undefined && product.lowStockLevel !== null) {
    if (typeof product.lowStockLevel !== 'number' || product.lowStockLevel < 0) {
      errors.push('Low stock level must be a non-negative number');
    }
  }

  if (product.expiryDate && !(product.expiryDate instanceof Date) && typeof product.expiryDate !== 'string') {
    errors.push('Expiry date must be a valid date');
  }

  if (product.description !== undefined && product.description !== null && typeof product.description !== 'string') {
    errors.push('Description must be a string');
  }

  if (product.isActive !== undefined && typeof product.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate order data according to backend Order model (for sales/billing)
 * @param {Object} order - Order object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateOrder = (order) => {
  const errors = [];

  // sellerId is required in MongoDB Order model
  if (!order.sellerId) {
    errors.push('Seller ID is required');
  }

  // customerId can be null for walk-in customers, so no validation needed

  const validPaymentMethods = ['cash', 'card', 'upi', 'due', 'credit', 'split'];
  if (!order.paymentMethod || !validPaymentMethods.includes(order.paymentMethod)) {
    errors.push(`Payment method must be one of: ${validPaymentMethods.join(', ')}`);
  }

  // Validate split payment details if payment method is split
  if (order.paymentMethod === 'split') {
    if (!order.splitPaymentDetails) {
      errors.push('Split payment requires splitPaymentDetails');
    } else {
      const splitDetails = order.splitPaymentDetails;
      const validSplitTypes = ['cash_online', 'online_due', 'cash_due'];

      // Allow null type (for backward compatibility or incomplete data)
      // Only validate if type is provided and not null
      if (splitDetails.type !== null && splitDetails.type !== undefined && !validSplitTypes.includes(splitDetails.type)) {
        errors.push(`Split payment type must be one of: ${validSplitTypes.join(', ')}, or null`);
      }

      // Validate amounts
      const cashAmount = typeof splitDetails.cashAmount === 'number' ? splitDetails.cashAmount : 0;
      const onlineAmount = typeof splitDetails.onlineAmount === 'number' ? splitDetails.onlineAmount : 0;
      const dueAmount = typeof splitDetails.dueAmount === 'number' ? splitDetails.dueAmount : 0;

      if (cashAmount < 0 || onlineAmount < 0 || dueAmount < 0) {
        errors.push('Split payment amounts cannot be negative');
      }

      // Validate that amounts match the split type (only if type is not null)
      if (splitDetails.type !== null && splitDetails.type !== undefined) {
        if (splitDetails.type === 'cash_online' && (cashAmount === 0 || onlineAmount === 0)) {
          errors.push('Cash + Online split requires both cash and online amounts > 0');
        }
        if (splitDetails.type === 'online_due' && (onlineAmount === 0 || dueAmount === 0)) {
          errors.push('Online + Due split requires both online and due amounts > 0');
        }
        if (splitDetails.type === 'cash_due' && (cashAmount === 0 || dueAmount === 0)) {
          errors.push('Cash + Due split requires both cash and due amounts > 0');
        }
      }

      // Validate that split amounts sum to totalAmount (within 0.01 tolerance)
      if (order.totalAmount !== undefined && order.totalAmount !== null) {
        const splitTotal = cashAmount + onlineAmount + dueAmount;
        if (Math.abs(splitTotal - order.totalAmount) > 0.01) {
          errors.push(`Split payment total (${splitTotal.toFixed(2)}) must equal order total (${order.totalAmount.toFixed(2)})`);
        }
      }
    }
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    errors.push('Order must have at least one item');
  } else {
    order.items.forEach((item, index) => {
      if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
        errors.push(`Item ${index + 1}: Name is required`);
      }

      if (item.sellingPrice === undefined || item.sellingPrice === null || typeof item.sellingPrice !== 'number' || item.sellingPrice < 0) {
        errors.push(`Item ${index + 1}: Selling price must be a non-negative number`);
      }

      if (item.costPrice === undefined || item.costPrice === null || typeof item.costPrice !== 'number' || item.costPrice < 0) {
        errors.push(`Item ${index + 1}: Cost price must be a non-negative number`);
      }

      if (item.quantity === undefined || item.quantity === null || typeof item.quantity !== 'number' || item.quantity <= 0) {
        errors.push(`Item ${index + 1}: Quantity must be greater than 0`);
      }

      if (!item.unit || typeof item.unit !== 'string') {
        errors.push(`Item ${index + 1}: Unit is required`);
      }
    });
  }

  if (order.totalAmount === undefined || order.totalAmount === null || typeof order.totalAmount !== 'number' || order.totalAmount < 0) {
    errors.push('Total amount must be a non-negative number');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate transaction data according to backend Transaction model (ONLY for plan purchases)
 * @param {Object} transaction - Transaction object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateTransaction = (transaction) => {
  const errors = [];

  if (!transaction || typeof transaction !== 'object') {
    return { valid: false, errors: ['Transaction must be an object'] };
  }

  if (!transaction.type || typeof transaction.type !== 'string' || transaction.type.trim() === '') {
    errors.push('Transaction type is required');
  }

  const resolvedAmount = (typeof transaction.amount === 'number' && !Number.isNaN(transaction.amount))
    ? transaction.amount
    : (typeof transaction.total === 'number' && !Number.isNaN(transaction.total) ? transaction.total : null);

  if (resolvedAmount === null) {
    errors.push('Transaction amount or total must be a valid number');
  }

  const validPaymentMethods = ['cash', 'card', 'upi', 'bank', 'credit', 'razorpay'];
  if (transaction.paymentMethod && !validPaymentMethods.includes(transaction.paymentMethod)) {
    errors.push(`Payment method must be one of: ${validPaymentMethods.join(', ')}`);
  }

  if (transaction.date) {
    const isValidDateInstance = transaction.date instanceof Date;
    const isIsoString = typeof transaction.date === 'string' && !Number.isNaN(Date.parse(transaction.date));
    if (!isValidDateInstance && !isIsoString) {
      errors.push('Transaction date must be a valid date');
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate purchase order (VendorOrder) data according to backend model
 * @param {Object} order - Purchase order object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validatePurchaseOrder = (order) => {
  const errors = [];

  if (!order.supplierName || typeof order.supplierName !== 'string' || order.supplierName.trim() === '') {
    errors.push('Supplier name is required');
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    errors.push('Purchase order must have at least one item');
  } else {
    order.items.forEach((item, index) => {
      if (!item.productName || typeof item.productName !== 'string' || item.productName.trim() === '') {
        errors.push(`Item ${index + 1}: Product name is required`);
      }

      if (item.quantity === undefined || item.quantity === null || typeof item.quantity !== 'number' || item.quantity < 1) {
        errors.push(`Item ${index + 1}: Quantity must be at least 1`);
      }

      if (item.price === undefined || item.price === null || typeof item.price !== 'number' || item.price < 0) {
        errors.push(`Item ${index + 1}: Price must be a non-negative number`);
      }

      const validUnits = ['pcs', 'kg', 'g', 'mg', 'l', 'ml', 'box', 'packet', 'bottle', 'dozen'];
      if (!item.unit || !validUnits.includes(item.unit)) {
        errors.push(`Item ${index + 1}: Unit must be one of: ${validUnits.join(', ')}`);
      }

      if (item.subtotal !== undefined && item.subtotal !== null) {
        if (typeof item.subtotal !== 'number' || item.subtotal < 0) {
          errors.push(`Item ${index + 1}: Subtotal must be a non-negative number`);
        }
      }
    });
  }

  if (order.total !== undefined && order.total !== null) {
    if (typeof order.total !== 'number' || order.total < 0) {
      errors.push('Total must be a non-negative number');
    }
  }

  const validStatuses = ['pending', 'completed', 'cancelled'];
  if (order.status && !validStatuses.includes(order.status)) {
    errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  if (order.expectedDeliveryDate && !(order.expectedDeliveryDate instanceof Date) && typeof order.expectedDeliveryDate !== 'string') {
    errors.push('Expected delivery date must be a valid date');
  }

  if (order.actualDeliveryDate && !(order.actualDeliveryDate instanceof Date) && typeof order.actualDeliveryDate !== 'string') {
    errors.push('Actual delivery date must be a valid date');
  }

  if (order.cancelledAt && !(order.cancelledAt instanceof Date) && typeof order.cancelledAt !== 'string') {
    errors.push('Cancelled date must be a valid date');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate category data according to backend model
 * @param {Object} category - Category object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateCategory = (category) => {
  const errors = [];

  if (!category.name || typeof category.name !== 'string' || category.name.trim() === '') {
    errors.push('Category name is required');
  }

  if (category.isActive !== undefined && typeof category.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  if (category.description !== undefined && category.description !== null && typeof category.description !== 'string') {
    errors.push('Description must be a string');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate refund data according to backend Refund model
 * @param {Object} refund - Refund object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validateRefund = (refund) => {
  const errors = [];

  // sellerId is required in MongoDB Refund model
  if (!refund.sellerId) {
    errors.push('Seller ID is required');
  }

  // orderId is required
  if (!refund.orderId) {
    errors.push('Order ID is required');
  }

  // items array is required and must not be empty
  if (!refund.items || !Array.isArray(refund.items) || refund.items.length === 0) {
    errors.push('Refund items array is required and must not be empty');
  } else {
    // Validate each item
    refund.items.forEach((item, index) => {
      if (!item.productId) {
        errors.push(`Item ${index + 1}: Product ID is required`);
      }
      if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
        errors.push(`Item ${index + 1}: Product name is required`);
      }
      if (item.qty === undefined || item.qty === null || typeof item.qty !== 'number' || item.qty <= 0) {
        errors.push(`Item ${index + 1}: Quantity must be a positive number`);
      }
      if (item.rate === undefined || item.rate === null || typeof item.rate !== 'number' || item.rate < 0) {
        errors.push(`Item ${index + 1}: Rate must be a non-negative number`);
      }
      if (item.lineTotal === undefined || item.lineTotal === null || typeof item.lineTotal !== 'number' || item.lineTotal < 0) {
        errors.push(`Item ${index + 1}: Line total must be a non-negative number`);
      }
    });
  }

  // totalRefundAmount is required
  if (refund.totalRefundAmount === undefined || refund.totalRefundAmount === null || typeof refund.totalRefundAmount !== 'number' || refund.totalRefundAmount < 0) {
    errors.push('Total refund amount must be a non-negative number');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate plan data according to backend Plan model
 * @param {Object} plan - Plan object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validatePlan = (plan) => {
  const errors = [];

  if (!plan.name || typeof plan.name !== 'string' || plan.name.trim() === '') {
    errors.push('Plan name is required');
  }

  if (plan.price === undefined || plan.price === null || typeof plan.price !== 'number' || plan.price < 0) {
    errors.push('Plan price must be a non-negative number');
  }

  if (plan.durationDays === undefined || plan.durationDays === null || typeof plan.durationDays !== 'number' || plan.durationDays < 1) {
    errors.push('Duration days must be at least 1');
  }

  if (plan.isActive !== undefined && typeof plan.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate cached plan detail data
 * @param {Object} planDetail - Plan detail object
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validatePlanDetail = (planDetail) => {
  const errors = [];

  if (!planDetail || typeof planDetail !== 'object') {
    errors.push('Plan detail must be an object');
    return { valid: false, errors };
  }

  if (!planDetail.id || typeof planDetail.id !== 'string') {
    errors.push('Plan detail id is required');
  }

  if (!planDetail.sellerId || typeof planDetail.sellerId !== 'string') {
    errors.push('Plan detail sellerId is required');
  }

  if (planDetail.data === undefined) {
    errors.push('Plan detail data is required');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate plan order data according to backend PlanOrder model
 * @param {Object} planOrder - PlanOrder object to validate
 * @returns {{valid: boolean, errors: Array<string>}}
 */
const validatePlanOrder = (planOrder) => {
  const errors = [];

  if (!planOrder.planId || typeof planOrder.planId !== 'string') {
    errors.push('Plan ID is required');
  }

  if (planOrder.price === undefined || planOrder.price === null || typeof planOrder.price !== 'number' || planOrder.price < 0) {
    errors.push('Plan order price must be a non-negative number');
  }

  if (planOrder.durationDays === undefined || planOrder.durationDays === null || typeof planOrder.durationDays !== 'number' || planOrder.durationDays < 1) {
    errors.push('Duration days must be at least 1');
  }

  if (planOrder.expiryDate && !(planOrder.expiryDate instanceof Date) && typeof planOrder.expiryDate !== 'string') {
    errors.push('Expiry date must be a valid date');
  }

  const validPaymentStatuses = ['pending', 'completed', 'failed'];
  if (planOrder.paymentStatus && !validPaymentStatuses.includes(planOrder.paymentStatus)) {
    errors.push(`Payment status must be one of: ${validPaymentStatuses.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Get validation function for a store
 * @param {string} storeName - Name of the store
 * @returns {Function|null} - Validation function or null
 */
const getValidator = (storeName) => {
  const validators = {
    [STORES.customers]: validateCustomer,
    [STORES.products]: validateProduct,
    [STORES.orders]: validateOrder,
    [STORES.transactions]: validateTransaction,
    [STORES.purchaseOrders]: validatePurchaseOrder,
    [STORES.categories]: validateCategory,
    [STORES.refunds]: validateRefund,
    [STORES.plans]: validatePlan,
    [STORES.planOrders]: validatePlanOrder,
    [STORES.planDetails]: validatePlanDetail
  };

  return validators[storeName] || null;
};

// ============================================
// GENERIC CRUD OPERATIONS
// ============================================

/**
 * Add a single item to a store with validation
 * @param {string} storeName - Name of the object store
 * @param {Object} item - Item to add (must have id)
 * @param {boolean} skipValidation - Skip validation (default: false)
 * @returns {Promise<any>} - The key of the added item
 */
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

export const addItem = async (storeName, item, skipValidation = false) => {
  // Check for duplicates based on store type
  try {
    const existingItems = await getAllItems(storeName);

    if (storeName === STORES.products) {
      // Products: name + description OR barcode OR rapid recreation
      const productName = (item.name || '').trim().toLowerCase();
      const productDescription = (item.description || '').trim().toLowerCase();
      const productBarcode = (item.barcode || '').trim();
      const productCreatedAt = item.createdAt || new Date().toISOString();

      const duplicateProduct = existingItems.find(p => {
        // Check for exact ID match first
        if (p.id === item.id || p._id === item.id || p.id === item._id) return true;

        const existingName = (p.name || '').trim().toLowerCase();
        const existingDescription = (p.description || '').trim().toLowerCase();
        const existingBarcode = (p.barcode || '').trim();

        // Match by barcode if both have it
        if (productBarcode && existingBarcode && productBarcode === existingBarcode) return true;

        // Match by name + description
        if (existingName === productName &&
          (existingDescription === productDescription ||
            (existingDescription === '' && productDescription === '') ||
            (existingDescription === null && productDescription === null) ||
            (existingDescription === undefined && productDescription === undefined))) {
          return true;
        }

        // Also match rapid recreation within 5 seconds if name matches
        if (existingName === productName && isWithin5Seconds(p.createdAt, productCreatedAt)) {
          return true;
        }

        return false;
      });

      if (duplicateProduct) {
        console.warn('⚠️ Duplicate product detected in IndexedDB (skipping add):', {
          name: item.name,
          description: item.description || 'No description',
          existingId: duplicateProduct.id,
          newId: item.id
        });
        return Promise.resolve(duplicateProduct.id || duplicateProduct._id);
      }
    } else if (storeName === STORES.customers) {
      // Customers: name + mobileNumber (or email if mobileNumber not available)
      const customerName = (item.name || '').trim().toLowerCase();
      const mobileNumber = (item.mobileNumber || item.phone || '').trim();
      const email = (item.email || '').trim().toLowerCase();

      const duplicateCustomer = existingItems.find(c => {
        const existingName = (c.name || '').trim().toLowerCase();
        const existingMobile = (c.mobileNumber || c.phone || '').trim();
        const existingEmail = (c.email || '').trim().toLowerCase();

        // Match by name + mobileNumber if both exist
        if (mobileNumber && existingMobile) {
          return existingName === customerName && existingMobile === mobileNumber;
        }
        // Match by name + email if mobileNumber not available
        if (email && existingEmail) {
          return existingName === customerName && existingEmail === email;
        }
        // Match by name only if neither mobile nor email available
        return existingName === customerName && !existingMobile && !existingEmail && !mobileNumber && !email;
      });

      if (duplicateCustomer) {
        console.warn('⚠️ Duplicate customer detected in IndexedDB (skipping add):', {
          name: item.name,
          mobileNumber: mobileNumber || 'N/A',
          email: email || 'N/A',
          existingId: duplicateCustomer.id,
          newId: item.id
        });
        return Promise.resolve(duplicateCustomer.id || duplicateCustomer._id);
      }
    } else if (storeName === STORES.orders) {
      // Orders: sellerId + customerId + totalAmount + items hash + createdAt (within same minute)
      const orderHash = hashItems(item.items, false);
      const orderCreatedAt = item.createdAt || item.date;

      const duplicateOrder = existingItems.find(o => {
        // Must match sellerId
        if (o.sellerId !== item.sellerId) return false;

        // Match customerId (both can be null/undefined for walk-in)
        const oCustomerId = o.customerId || null;
        const itemCustomerId = item.customerId || null;
        if (oCustomerId !== itemCustomerId) return false;

        // Match totalAmount (within 0.01 tolerance for floating point)
        const totalDiff = Math.abs((o.totalAmount || 0) - (item.totalAmount || 0));
        if (totalDiff > 0.01) return false;

        // Match items hash
        const existingHash = hashItems(o.items, false);
        if (existingHash !== orderHash) return false;

        // Match createdAt within 5 seconds (to catch rapid duplicates)
        if (orderCreatedAt && o.createdAt) {
          return isWithin5Seconds(o.createdAt, orderCreatedAt);
        }

        // If no createdAt, match by id (prevent exact duplicate IDs)
        return o.id === item.id || o._id === item.id || o.id === item._id;
      });

      if (duplicateOrder) {
        console.warn('⚠️ Duplicate order detected in IndexedDB (skipping add):', {
          sellerId: item.sellerId,
          customerId: item.customerId || 'Walk-in',
          totalAmount: item.totalAmount,
          createdAt: orderCreatedAt,
          existingId: duplicateOrder.id,
          newId: item.id
        });
        return Promise.resolve(duplicateOrder.id || duplicateOrder._id);
      }
    } else if (storeName === STORES.purchaseOrders) {
      // Vendor Orders: sellerId + supplierName + total + items hash + createdAt (within same minute)
      const poHash = hashItems(item.items, true);
      const poCreatedAt = item.createdAt || item.date;

      const duplicatePO = existingItems.find(po => {
        // Must match sellerId
        if (po.sellerId !== item.sellerId) return false;

        // Match supplierName
        const poSupplier = (po.supplierName || '').trim().toLowerCase();
        const itemSupplier = (item.supplierName || '').trim().toLowerCase();
        if (poSupplier !== itemSupplier) return false;

        // Match total (within 0.01 tolerance)
        const totalDiff = Math.abs((po.total || 0) - (item.total || 0));
        if (totalDiff > 0.01) return false;

        // Match items hash
        const existingHash = hashItems(po.items, true);
        if (existingHash !== poHash) return false;

        // Match createdAt within 5 seconds (to catch rapid duplicates)
        if (poCreatedAt && po.createdAt) {
          return isWithin5Seconds(po.createdAt, poCreatedAt);
        }

        // If no createdAt, match by id (prevent exact duplicate IDs)
        return po.id === item.id || po._id === item.id || po.id === item._id;
      });

      if (duplicatePO) {
        console.warn('⚠️ Duplicate vendor order detected in IndexedDB (skipping add):', {
          sellerId: item.sellerId,
          supplierName: item.supplierName,
          total: item.total,
          createdAt: poCreatedAt,
          existingId: duplicatePO.id,
          newId: item.id
        });
        return Promise.resolve(duplicatePO.id || duplicatePO._id);
      }
    } else if (storeName === STORES.productBatches) {
      // Product Batches: productId + batchNumber (OR rapid recreation within 5 seconds)
      const batchNumber = (item.batchNumber || '').trim().toLowerCase();
      const productId = String(item.productId || '');
      const batchCreatedAt = item.createdAt || new Date().toISOString();

      if (batchNumber && productId) {
        const duplicateBatch = existingItems.find(b => {
          // Check for exact ID match first
          if (b.id === item.id || b._id === item.id || b.id === item._id) return true;

          const existingBatchNumber = (b.batchNumber || '').trim().toLowerCase();
          const existingProductId = String(b.productId || '');

          // Match by productId + batchNumber
          if (existingBatchNumber === batchNumber && existingProductId === productId) return true;

          // Also match rapid recreation within 5 seconds if productId matches
          if (existingProductId === productId && isWithin5Seconds(b.createdAt, batchCreatedAt)) {
            // Check if other fields are also similar to be sure
            const costDiff = Math.abs((b.costPrice || 0) - (item.costPrice || 0));
            const sellingDiff = Math.abs((b.sellingUnitPrice || 0) - (item.sellingUnitPrice || 0));
            if (costDiff < 0.01 && sellingDiff < 0.01) return true;
          }

          return false;
        });

        if (duplicateBatch) {
          console.warn('⚠️ Duplicate product batch detected in IndexedDB (skipping add):', {
            batchNumber: item.batchNumber,
            productId: item.productId,
            existingId: duplicateBatch.id || duplicateBatch._id,
            newId: item.id
          });
          return Promise.resolve(duplicateBatch.id || duplicateBatch._id);
        }
      }
    }
  } catch (error) {

    // Continue with add if duplicate check fails
  }

  // Validate if validator exists
  if (!skipValidation) {
    const validator = getValidator(storeName);
    if (validator) {
      const validation = validator(item);
      if (!validation.valid) {

        console.error('Item data:', JSON.stringify(item, null, 2));
        return Promise.reject(new Error(`Validation failed: ${validation.errors.join(', ')}`));
      }
    }
  }

  // Ensure isSynced flag is set (default to false for new items)
  let itemWithSync;
  if (storeName === STORES.activities || storeName === STORES.syncMetadata) {
    itemWithSync = { ...item };
    delete itemWithSync.isSynced;
  } else {
    itemWithSync = {
      ...item,
      isSynced: item.isSynced !== undefined ? item.isSynced : false
    };
  }

  return withIndexedDB(async (db) => {

    // Check if store exists, if not, try to close and reopen to trigger upgrade
    if (!db.objectStoreNames.contains(storeName)) {
      // Special handling for syncMetadata - don't show error, just use localStorage fallback
      if (storeName === STORES.syncMetadata) {
        console.log(`⚠️ syncMetadata store not yet created (database upgrade pending). Using localStorage fallback.`);
        // Don't throw error - let syncManager handle fallback to localStorage
        return Promise.reject(new Error('Store not available - using localStorage fallback'));
      }

      console.log('Available stores:', Array.from(db.objectStoreNames));

      // Close the database connection to allow upgrade
      try {
        db.close();
        // Wait a moment for the close to complete
        await new Promise(resolve => setTimeout(resolve, 200));

        // Reopen - this should trigger the upgrade if version changed
        db = await openDB();

        // Check again
        if (!db.objectStoreNames.contains(storeName)) {
          const error = new Error(`Object store "${storeName}" does not exist. Please refresh the page to upgrade the database to version ${DB_VERSION}.`);

          console.error('Available stores:', Array.from(db.objectStoreNames));

          // Show user-friendly error message (only for non-metadata stores)
          if (window.showToast && storeName !== STORES.syncMetadata) {
            window.showToast('Database needs to be upgraded. Please refresh the page.', 'error');
          }
          return Promise.reject(error);
        } else {

        }
      } catch (closeError) {

        const error = new Error(`Object store "${storeName}" does not exist. Please refresh the page to upgrade the database.`);
        if (window.showToast && storeName !== STORES.syncMetadata) {
          window.showToast('Please refresh the page to upgrade the database.', 'error');
        }
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      // Verify store exists (double check after potential upgrade)
      if (!db.objectStoreNames.contains(storeName)) {
        const error = new Error(`Object store "${storeName}" does not exist. Please refresh the page.`);

        console.error('Available stores:', Array.from(db.objectStoreNames));
        return reject(error);
      }

      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(itemWithSync);

      request.onsuccess = () => {

        resolve(request.result);
      };
      request.onerror = () => {
        const error = request.error;
        if (error && error.name === 'ConstraintError') {

          // Use a new transaction because the current one will be aborted
          transaction.abort();

          try {
            const updateTxn = db.transaction([storeName], 'readwrite');
            const updateStore = updateTxn.objectStore(storeName);
            const updateRequest = updateStore.put(itemWithSync);

            updateRequest.onsuccess = () => {

              resolve(updateRequest.result);
            };

            updateRequest.onerror = () => {

              reject(updateRequest.error);
            };
          } catch (updateError) {

            reject(updateError);
          }
        } else {

          reject(error);
        }
      };
    });
  }, null); // Return null as fallback when IndexedDB is unavailable
};

/**
 * Get all items from a store
 * @param {string} storeName - Name of the object store
 * @returns {Promise<Array>} - Array of all items
 */
export const getAllItems = async (storeName) => {
  return withIndexedDB(async (db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, []); // Return empty array as fallback when IndexedDB is unavailable
};

/**
 * Get a single item by ID
 * @param {string} storeName - Name of the object store
 * @param {string|number} id - ID of the item
 * @returns {Promise<Object|null>} - The item or null if not found
 */
export const getItem = async (storeName, id) => {
  return withIndexedDB(async (db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }, null); // Return null as fallback when IndexedDB is unavailable
};

/**
 * Update an existing item (or add if it doesn't exist) with validation
 * @param {string} storeName - Name of the object store
 * @param {Object} item - Item to update (must have id)
 * @param {boolean} skipValidation - Skip validation (default: false)
 * @returns {Promise<any>} - The key of the updated item
 */
export const updateItem = async (storeName, item, skipValidation = false) => {
  // Validate if validator exists
  if (!skipValidation) {
    const validator = getValidator(storeName);
    if (validator) {
      const validation = validator(item);
      if (!validation.valid) {

        console.error('Item data:', JSON.stringify(item, null, 2));
        return Promise.reject(new Error(`Validation failed: ${validation.errors.join(', ')}`));
      }
    }
  }

  // Preserve isSynced flag if not explicitly set
  let itemWithSync;
  if (storeName === STORES.activities || storeName === STORES.syncMetadata || storeName === STORES.syncTracking) {
    itemWithSync = { ...item };
    delete itemWithSync.isSynced;
  } else {
    itemWithSync = {
      ...item,
      isSynced: item.isSynced !== undefined ? item.isSynced : false
    };
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    // Verify store exists
    if (!db.objectStoreNames.contains(storeName)) {
      const error = new Error(`Object store "${storeName}" does not exist. Database may need to be upgraded.`);

      console.error('Available stores:', Array.from(db.objectStoreNames));
      return reject(error);
    }

    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(itemWithSync);

    request.onsuccess = () => {

      resolve(request.result);
    };
    request.onerror = () => {

      reject(request.error);
    };
  });
};

/**
 * Delete an item by ID
 * @param {string} storeName - Name of the object store
 * @param {string|number} id - ID of the item to delete
 * @returns {Promise<void>}
 */
export const deleteItem = async (storeName, id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Count items in a store
 * @param {string} storeName - Name of the object store
 * @returns {Promise<number>} - Count of items
 */
export const countItems = async (storeName) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// ============================================
// BATCH OPERATIONS
// ============================================

/**
 * Add multiple items to a store with validation
 * @param {string} storeName - Name of the object store
 * @param {Array<Object>} items - Array of items to add
 * @param {boolean} skipValidation - Skip validation (default: false)
 * @returns {Promise<void>}
 */
export const addMultipleItems = async (storeName, items, skipValidation = false) => {
  try {
    if (!(await isIndexedDBAvailable())) {
      console.warn(`⚠️ [addMultipleItems] IndexedDB unavailable - skipping add for ${storeName} (${items.length} items)`);
      return; // Skip operation gracefully
    }

    // Validate all items if validator exists
    if (!skipValidation) {
      const validator = getValidator(storeName);
      if (validator) {
        const validationErrors = [];
        items.forEach((item, index) => {
          const validation = validator(item);
          if (!validation.valid) {
            validationErrors.push(`Item ${index + 1}: ${validation.errors.join(', ')}`);
          }
        });

        if (validationErrors.length > 0) {
          return Promise.reject(new Error(`Validation failed: ${validationErrors.join('; ')}`));
        }
      }
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);

      const promises = items.map(item => {
        return new Promise((res, rej) => {
          // Debug logging for split payment orders being stored
          if (storeName === STORES.orders && item.paymentMethod === 'split') {
            console.log(`[IndexedDB] Storing split payment order ${item.id}:`, {
              hasSplitPaymentDetails: 'splitPaymentDetails' in item,
              splitPaymentDetails: item.splitPaymentDetails,
              itemKeys: Object.keys(item)
            });
          }

          const request = store.add(item);
          request.onsuccess = () => res();
          request.onerror = () => {

            rej(request.error);
          };
        });
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      Promise.all(promises).catch(reject);
    });
  } catch (error) {
    console.warn(`⚠️ [addMultipleItems] IndexedDB error for ${storeName} - skipping add (${items.length} items):`, error.message);
    return; // Don't throw - operation is not critical for app functionality
  }
};

/**
 * Update multiple items in a store with validation
 * @param {string} storeName - Name of the object store
 * @param {Array<Object>} items - Array of items to update
 * @param {boolean} skipValidation - Skip validation (default: false)
 * @returns {Promise<void>}
 */
export const updateMultipleItems = async (storeName, items, skipValidation = false) => {

  // Validate all items if validator exists
  if (!skipValidation) {
    const validator = getValidator(storeName);
    if (validator) {
      const validationErrors = [];
      items.forEach((item, index) => {
        const validation = validator(item);
        if (!validation.valid) {
          validationErrors.push(`Item ${index + 1}: ${validation.errors.join(', ')}`);
        }
      });

      if (validationErrors.length > 0) {

        return Promise.reject(new Error(`Validation failed: ${validationErrors.join('; ')}`));
      }
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    const promises = items.map((item, index) => {
      return new Promise((res, rej) => {

        const request = store.put(item);
        request.onsuccess = (event) => {

          res(event.target.result);
        };
        request.onerror = (event) => {

          rej(request.error);
        };
      });
    });

    transaction.oncomplete = (event) => {

      resolve();
    };
    transaction.onerror = (event) => {

      reject(transaction.error);
    };

    Promise.all(promises).catch((error) => {

      reject(error);
    });
  });
};

/**
 * Delete multiple items by IDs
 * @param {string} storeName - Name of the object store
 * @param {Array<string|number>} ids - Array of IDs to delete
 * @returns {Promise<void>}
 */
export const deleteMultipleItems = async (storeName, ids) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    const promises = ids.map(id => {
      return new Promise((res, rej) => {
        const request = store.delete(id);
        request.onsuccess = () => res();
        request.onerror = () => rej(request.error);
      });
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    Promise.all(promises).catch(reject);
  });
};

/**
 * Clear all items from a store
 * @param {string} storeName - Name of the object store
 * @returns {Promise<void>}
 */
export const clearAllItems = async (storeName) => {
  try {
    if (!(await isIndexedDBAvailable())) {

      return; // Skip operation gracefully
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {

    return; // Don't throw - operation is not critical
  }
};

// ============================================
// QUERY OPERATIONS
// ============================================

/**
 * Search items in a store
 * @param {string} storeName - Name of the object store
 * @param {string} query - Search query
 * @param {Array<string>} fields - Fields to search in
 * @returns {Promise<Array>} - Array of matching items
 */
export const searchItems = async (storeName, query, fields) => {
  const items = await getAllItems(storeName);
  if (!query) return items;

  const lowerQuery = query.toLowerCase();
  return items.filter(item => {
    return fields.some(field => {
      const value = item[field];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(lowerQuery);
    });
  });
};

// ============================================
// DATABASE STATS
// ============================================

/**
 * Get database statistics (counts per store)
 * @returns {Promise<Object>} - Object with store counts
 */
export const getDatabaseStats = async () => {
  try {
    if (!(await isIndexedDBAvailable())) {
      return {};
    }

    const db = await openDB();
    const storeNames = Array.from(db.objectStoreNames);
    const stats = {};

    await Promise.all(storeNames.map(async (storeName) => {
      try {
        stats[storeName] = await countItems(storeName);
      } catch (e) {
        stats[storeName] = 0;
      }
    }));

    return stats;
  } catch (error) {

    return {};
  }
};

// ============================================
// EXPORT / IMPORT OPERATIONS
// ============================================

/**
 * Export specific stores to JSON
 * @param {Array<string>} storeNames - Names of stores to export
 * @returns {Promise<Object>} - Object with store data
 */
export const exportDatabase = async (storeNames = Object.values(STORES)) => {
  const exportData = {};
  exportData.version = DB_VERSION;
  exportData.timestamp = new Date().toISOString();
  exportData.stores = {};

  await Promise.all(storeNames.map(async (storeName) => {
    try {
      if (storeName === STORES.activities) return; // Skip activities
      exportData.stores[storeName] = await getAllItems(storeName);
    } catch (e) {

    }
  }));

  return exportData;
};

/**
 * Import data from JSON
 * @param {Object} data - Exported data
 * @returns {Promise<void>}
 */
export const importDatabase = async (data) => {
  if (!data || !data.stores) {
    throw new Error('Invalid backup data');
  }

  for (const storeName of Object.keys(data.stores)) {
    // Basic validation
    if (!Object.values(STORES).includes(storeName)) continue;

    const items = data.stores[storeName];
    if (Array.isArray(items) && items.length > 0) {
      await clearAllItems(storeName);
      await addMultipleItems(storeName, items, true); // Skip individual validation for speed
    }
  }
};

// ============================================
// SYNC HELPER
// ============================================

/**
 * Efficiently sync items from backend to IndexedDB
 * Handles duplicates and updates intelligently
 * @param {Array} items - Items from backend
 * @param {string} storeName - Store name
 * @param {boolean} forceRefresh - Whether to force overwrite
 */
export const syncToIndexedDB = async (items, storeName, forceRefresh = false) => {
  if (!items || !Array.isArray(items) || items.length === 0) return;

  try {
    const existingItems = await getAllItems(storeName);
    const existingMap = new Map(existingItems.map(i => [i.id || i._id, i]));
    const itemsToAdd = [];
    const itemsToUpdate = [];

    // Helper for finding duplicates by content
    const findDuplicate = (item) => {
      if (storeName === STORES.customers) {
        const mobile = (item.mobileNumber || item.phone || '').trim();
        const email = (item.email || '').trim().toLowerCase();
        const name = (item.name || '').trim().toLowerCase();

        return existingItems.find(ex => {
          // Skip if same ID (already handled by existingMap)
          if (ex.id === item._id || ex._id === item._id) return false;

          const exName = (ex.name || '').trim().toLowerCase();
          const exMobile = (ex.mobileNumber || ex.phone || '').trim();
          const exEmail = (ex.email || '').trim().toLowerCase();

          if (mobile && exMobile) return exName === name && exMobile === mobile;
          if (email && exEmail) return exName === name && exEmail === email;
          return exName === name && !mobile && !exMobile && !email && !exEmail;
        });
      }
      return null;
    };

    for (const item of items) {
      // Backend items use _id, ensure it's set as id for IndexedDB
      const itemToSync = { ...item, id: item._id, isSynced: true };

      const existing = existingMap.get(item._id);

      if (existing) {
        // Update if different or forced
        // For simplicity in this restoration, we overwrite if existing
        // Real logic might check updatedAt
        const existingUpdated = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const newUpdated = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;

        if (forceRefresh || newUpdated > existingUpdated || !existing.isSynced) {
          itemsToUpdate.push(itemToSync);
        }
      } else {
        // Check for duplicate by content (specifically for customers)
        // If we find a local duplicate (unsynced), we should replace it or handle it
        // The robust logic in Step 523 deleted the local duplicate
        const duplicate = findDuplicate(item);
        if (duplicate) {
          // If the local item is NOT isSynced (isSynced: false), and we found a match from backend,
          // then the local item is likely a temporary version of this backend item.
          // We should delete the local duplicate and insert the backend item.
          if (!duplicate.isSynced) {
            console.log(`[Sync] Found local duplicate for ${storeName} (ID: ${duplicate.id}). Deleting local, accepting backend (ID: ${item._id}).`);
            await deleteItem(storeName, duplicate.id);
          }
        }
        itemsToAdd.push(itemToSync);
      }
    }

    if (itemsToAdd.length > 0) {
      await addMultipleItems(storeName, itemsToAdd, true); // Skip validation for synced items
    }
    if (itemsToUpdate.length > 0) {
      await updateMultipleItems(storeName, itemsToUpdate, true);
    }

    // Update last sync time
    try {
      const db = await openDB();
      if (db.objectStoreNames.contains(STORES.syncMetadata)) {
        await updateItem(STORES.syncMetadata, {
          id: storeName,
          collection: storeName,
          lastSync: new Date().toISOString()
        }, true);
      }
    } catch (e) {
      console.warn('Failed to update sync metadata', e);
    }

  } catch (error) {
    console.error(`Error syncing ${storeName} to IndexedDB:`, error);
  }
};

// ============================================
// CLEANUP OPERATIONS
// ============================================

/**
 * Cleanup old activities (keep last 30 days)
 */
export const cleanupOldActivities = async () => {
  try {
    const activities = await getAllItems(STORES.activities);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const idsToDelete = activities
      .filter(a => new Date(a.timestamp) < thirtyDaysAgo)
      .map(a => a.id);

    if (idsToDelete.length > 0) {
      await deleteMultipleItems(STORES.activities, idsToDelete);
    }
  } catch (e) {
    console.warn('Cleanup failed:', e);
  }
};

export { openDB }; // Export openDB mainly for testing or advanced usage

// ============================================
// SYNC TRACKING OPERATIONS
// ============================================

/**
 * Update the last fetch time for a specific data type
 */
export const updateLastFetchTime = async (dataType, timestamp) => {
  return updateItem(STORES.syncTracking, {
    dataType,
    lastFetchTime: timestamp
  }, true);
};

/**
 * Get all sync tracking records
 */
export const getAllSyncTracking = async () => {
  return getAllItems(STORES.syncTracking);
};

/**
 * Get sync tracking for a specific data type
 */
export const getSyncTracking = async (dataType) => {
  return getItem(STORES.syncTracking, dataType);
};

/**
 * Initialize sync tracking with default timestamps
 */
export const initializeSyncTracking = async () => {
  const dataTypes = ['customers', 'products', 'categories', 'orders', 'transactions', 'purchaseOrders', 'refunds', 'plans', 'staff', 'expenses'];
  const now = new Date(0).toISOString(); // Default to epoch for full sync initially

  for (const dataType of dataTypes) {
    const existing = await getSyncTracking(dataType);
    if (!existing) {
      await updateLastFetchTime(dataType, now);
    }
  }
};

/**
 * Get last fetch times for all data types in a format suitable for the API
 */
export const getLastFetchTimesForAPI = async () => {
  const tracking = await getAllSyncTracking();
  const times = {};
  tracking.forEach(t => {
    times[t.dataType] = t.lastFetchTime;
  });
  return times;
};

// ============================================
// DUPLICATE CLEANUP OPERATIONS
// ============================================

/**
 * Cleanup duplicate product batches based on productId and batchNumber
 */
export const cleanupDuplicateProductBatches = async () => {
  try {
    const batches = await getAllItems(STORES.productBatches);
    const seen = new Set();
    const duplicates = [];

    batches.forEach(batch => {
      const key = `${batch.productId}_${(batch.batchNumber || '').trim().toLowerCase()}`;
      if (seen.has(key)) {
        duplicates.push(batch.id);
      } else {
        seen.add(key);
      }
    });

    if (duplicates.length > 0) {
      console.log(`[Cleanup] Found ${duplicates.length} duplicate product batches. Deleting...`);
      await deleteMultipleItems(STORES.productBatches, duplicates);
    }
    return duplicates.length;
  } catch (error) {
    console.error('Error cleaning up duplicate product batches:', error);
    return 0;
  }
};

/**
 * Cleanup duplicate purchase orders based on content
 */
export const cleanupDuplicatePurchaseOrders = async () => {
  try {
    const poItems = await getAllItems(STORES.purchaseOrders);
    const seen = new Set();
    const duplicates = [];

    poItems.forEach(po => {
      // Create a unique key based on supplier, total and items hash
      const itemsHash = hashItems(po.items, true);
      const key = `${po.supplierName}_${po.total}_${itemsHash}_${po.createdAt}`;

      if (seen.has(key)) {
        duplicates.push(po.id);
      } else {
        seen.add(key);
      }
    });

    if (duplicates.length > 0) {
      console.log(`[Cleanup] Found ${duplicates.length} duplicate purchase orders. Deleting...`);
      await deleteMultipleItems(STORES.purchaseOrders, duplicates);
    }
    return duplicates.length;
  } catch (error) {
    console.error('Error cleaning up duplicate purchase orders:', error);
    return 0;
  }
};

/**
 * Save staff permissions to IndexedDB
 */
export const saveStaffPermissions = async (userId, permissions) => {
  return updateItem(STORES.staffPermissions, {
    id: userId,
    userId: userId,
    permissions: permissions,
    updatedAt: new Date().toISOString()
  }, true);
};

/**
 * Get staff permissions from IndexedDB
 */
export const getStaffPermissions = async (userId) => {
  return getItem(STORES.staffPermissions, userId);
};
