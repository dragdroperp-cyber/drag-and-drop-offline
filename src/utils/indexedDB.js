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
 * - Plans: name, description, price, durationDays, unlockedModules, lockedModules, maxCustomers, maxProducts, maxOrders, isActive, totalSales, totalRevenue, createdAt, updatedAt, _id, id
 * - PlanOrders: sellerId, planId, expiryDate, durationDays, price, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentStatus, totalCustomers, totalOrders, totalProducts, createdAt, updatedAt, isSynced, _id, id
 * - Activities: id, message, timestamp, type, createdAt (frontend-only for UI logging)
 */

const DB_NAME = 'ERP_DB';
const DB_VERSION = 16; // Incremented to ensure settings store exists consistently

// Object Store Names - ALL MongoDB models + frontend-only activities
export const STORES = {
  customers: 'customers',
  products: 'products',
  orders: 'orders', // For sales/billing records (Order model)
  transactions: 'transactions', // ONLY for plan purchases (Transaction model)
  purchaseOrders: 'purchaseOrders', // Maps to VendorOrder in MongoDB
  categories: 'categories', // Maps to ProductCategory in MongoDB
  plans: 'plans', // Premium plan details
  planOrders: 'planOrders', // Plan purchase orders
  planDetails: 'planDetails', // Cached active plan details per seller
  settings: 'settings', // Seller settings with offline sync support
  activities: 'activities',// Frontend-only for UI logging
};

// Database initialization
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const transaction = event.target.transaction;
      const oldVersion = event.oldVersion;
      
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
      // - paymentMethod: String (required, enum: ["cash","card","upi","due","credit"], default: "cash")
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
              console.log(`[IndexedDB Migration] Adding index ${index.name} to orders store`);
              orderStore.createIndex(index.name, index.keyPath, { unique: false });
            }
          });
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
  
  const validPaymentMethods = ['cash', 'card', 'upi', 'due', 'credit'];
  if (!order.paymentMethod || !validPaymentMethods.includes(order.paymentMethod)) {
    errors.push(`Payment method must be one of: ${validPaymentMethods.join(', ')}`);
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
      // Products: name + description
      const productName = (item.name || '').trim().toLowerCase();
      const productDescription = (item.description || '').trim().toLowerCase();
      
      const duplicateProduct = existingItems.find(p => {
        const existingName = (p.name || '').trim().toLowerCase();
        const existingDescription = (p.description || '').trim().toLowerCase();
        
        return existingName === productName && 
               (existingDescription === productDescription || 
                (existingDescription === '' && productDescription === '') ||
                (existingDescription === null && productDescription === null) ||
                (existingDescription === undefined && productDescription === undefined));
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
    }
  } catch (error) {
    console.error(`Error checking for duplicate ${storeName}:`, error);
    // Continue with add if duplicate check fails
  }
  
  // Validate if validator exists
  if (!skipValidation) {
    const validator = getValidator(storeName);
    if (validator) {
      const validation = validator(item);
      if (!validation.valid) {
        console.error(`Validation failed for ${storeName}:`, validation.errors);
        console.error('Item data:', JSON.stringify(item, null, 2));
        return Promise.reject(new Error(`Validation failed: ${validation.errors.join(', ')}`));
      }
    }
  }
  
  // Ensure isSynced flag is set (default to false for new items)
  let itemWithSync;
  if (storeName === STORES.activities) {
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
      console.error('IndexedDB error:', error);
      console.error('Available stores:', Array.from(db.objectStoreNames));
      return reject(error);
    }
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(itemWithSync);
    
    request.onsuccess = () => {
      console.log(`Successfully added item to ${storeName}:`, itemWithSync.id || itemWithSync._id);
      resolve(request.result);
    };
    request.onerror = () => {
      const error = request.error;
      if (error && error.name === 'ConstraintError') {
        console.warn(`⚠️ Item with ID ${itemWithSync.id || itemWithSync._id} already exists in ${storeName}, treating as update`);

        // Use a new transaction because the current one will be aborted
        transaction.abort();

        try {
          const updateTxn = db.transaction([storeName], 'readwrite');
          const updateStore = updateTxn.objectStore(storeName);
          const updateRequest = updateStore.put(itemWithSync);

          updateRequest.onsuccess = () => {
            console.log(`Updated existing item in ${storeName}:`, itemWithSync.id || itemWithSync._id);
            resolve(updateRequest.result);
          };

          updateRequest.onerror = () => {
            console.error(`Error updating item in ${storeName}:`, updateRequest.error);
            reject(updateRequest.error);
          };
        } catch (updateError) {
          console.error(`Error creating update transaction for ${storeName}:`, updateError);
          reject(updateError);
        }
      } else {
        console.error(`Error adding to ${storeName}:`, error);
        reject(error);
      }
    };
  });
};

/**
 * Get all items from a store
 * @param {string} storeName - Name of the object store
 * @returns {Promise<Array>} - Array of all items
 */
export const getAllItems = async (storeName) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get a single item by ID
 * @param {string} storeName - Name of the object store
 * @param {string|number} id - ID of the item
 * @returns {Promise<Object|null>} - The item or null if not found
 */
export const getItem = async (storeName, id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
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
        console.error(`Validation failed for ${storeName}:`, validation.errors);
        console.error('Item data:', JSON.stringify(item, null, 2));
        return Promise.reject(new Error(`Validation failed: ${validation.errors.join(', ')}`));
      }
    }
  }
  
  // Preserve isSynced flag if not explicitly set
  let itemWithSync;
  if (storeName === STORES.activities) {
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
      console.error('IndexedDB error:', error);
      console.error('Available stores:', Array.from(db.objectStoreNames));
      return reject(error);
    }
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(itemWithSync);
    
    request.onsuccess = () => {
      console.log(`Successfully saved item to ${storeName}:`, itemWithSync.id || itemWithSync._id);
      resolve(request.result);
    };
    request.onerror = () => {
      console.error(`Error saving to ${storeName}:`, request.error);
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
        const request = store.add(item);
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
    
    const promises = items.map(item => {
      return new Promise((res, rej) => {
        const request = store.put(item);
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ============================================
// QUERY & SEARCH OPERATIONS
// ============================================

/**
 * Get items by index value
 * @param {string} storeName - Name of the object store
 * @param {string} indexName - Name of the index
 * @param {any} value - Value to search for
 * @returns {Promise<Array>} - Array of matching items
 */
export const getItemsByIndex = async (storeName, indexName, value) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get items by index range
 * @param {string} storeName - Name of the object store
 * @param {string} indexName - Name of the index
 * @param {IDBKeyRange} range - IDBKeyRange object
 * @returns {Promise<Array>} - Array of matching items
 */
export const getItemsByRange = async (storeName, indexName, range) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(range);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Search customers by name, mobileNumber, or email
 * @param {string} searchTerm - Search term
 * @returns {Promise<Array>} - Array of matching customers
 */
export const searchCustomers = async (searchTerm) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.customers], 'readonly');
    const store = transaction.objectStore(STORES.customers);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const allCustomers = request.result;
      const term = searchTerm.toLowerCase();
      const filtered = allCustomers.filter(customer => {
        // Support both mobileNumber and phone for backward compatibility
        const mobileNumber = customer.mobileNumber || customer.phone || '';
        return (
        customer.name?.toLowerCase().includes(term) ||
          mobileNumber.includes(term) ||
        customer.email?.toLowerCase().includes(term)
      );
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Search products by name, category, or barcode
 * @param {string} searchTerm - Search term
 * @returns {Promise<Array>} - Array of matching products
 */
export const searchProducts = async (searchTerm) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.products], 'readonly');
    const store = transaction.objectStore(STORES.products);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const allProducts = request.result;
      const term = searchTerm.toLowerCase();
      const filtered = allProducts.filter(product => 
        product.name?.toLowerCase().includes(term) ||
        product.category?.toLowerCase().includes(term) ||
        product.barcode?.includes(term)
      );
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get products by category
 * @param {string} category - Category name
 * @returns {Promise<Array>} - Array of products in category
 */
export const getProductsByCategory = async (category) => {
  return getItemsByIndex(STORES.products, 'category', category);
};

/**
 * Get low stock products
 * @param {number} threshold - Stock threshold
 * @returns {Promise<Array>} - Array of low stock products
 */
export const getLowStockProducts = async (threshold) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.products], 'readonly');
    const store = transaction.objectStore(STORES.products);
    const index = store.index('quantity');
    const range = IDBKeyRange.upperBound(threshold);
    const request = index.getAll(range);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get expiring products
 * @param {Date} expiryDate - Expiry date threshold
 * @returns {Promise<Array>} - Array of expiring products
 */
export const getExpiringProducts = async (expiryDate) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.products], 'readonly');
    const store = transaction.objectStore(STORES.products);
    const index = store.index('expiryDate');
    const range = IDBKeyRange.upperBound(expiryDate.toISOString());
    const request = index.getAll(range);
    
    request.onsuccess = () => {
      const products = request.result;
      // Filter out products without expiry dates and past expiry dates
      const filtered = products.filter(product => {
        if (!product.expiryDate) return false;
        const expiry = new Date(product.expiryDate);
        return expiry >= new Date() && expiry <= expiryDate;
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get transactions by customer ID
 * @param {string} customerId - Customer ID
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactionsByCustomer = async (customerId) => {
  return getItemsByIndex(STORES.transactions, 'customerId', customerId);
};

/**
 * Get transactions by date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} - Array of transactions
 */
export const getTransactionsByDateRange = async (startDate, endDate) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.transactions], 'readonly');
    const store = transaction.objectStore(STORES.transactions);
    const index = store.index('createdAt');
    const range = IDBKeyRange.bound(
      startDate.toISOString(),
      endDate.toISOString()
    );
    const request = index.getAll(range);
    
    request.onsuccess = () => {
      const transactions = request.result;
      // Filter by actual date range
      const filtered = transactions.filter(t => {
        const date = new Date(t.createdAt);
        return date >= startDate && date <= endDate;
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get purchase orders by status
 * @param {string} status - Order status
 * @returns {Promise<Array>} - Array of purchase orders
 */
export const getPurchaseOrdersByStatus = async (status) => {
  return getItemsByIndex(STORES.purchaseOrders, 'status', status);
};

/**
 * Get activities by type
 * @param {string} type - Activity type
 * @returns {Promise<Array>} - Array of activities
 */
export const getActivitiesByType = async (type) => {
  return getItemsByIndex(STORES.activities, 'type', type);
};

/**
 * Get activities by date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} - Array of activities
 */
export const getActivitiesByDateRange = async (startDate, endDate) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.activities], 'readonly');
    const store = transaction.objectStore(STORES.activities);
    const index = store.index('timestamp');
    const range = IDBKeyRange.bound(
      startDate.toISOString(),
      endDate.toISOString()
    );
    const request = index.getAll(range);
    
    request.onsuccess = () => {
      const activities = request.result;
      const filtered = activities.filter(a => {
        const date = new Date(a.timestamp || a.createdAt);
        return date >= startDate && date <= endDate;
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
};

// ============================================
// PAGINATION OPERATIONS
// ============================================

/**
 * Get paginated items from a store
 * @param {string} storeName - Name of the object store
 * @param {number} page - Page number (1-based)
 * @param {number} pageSize - Items per page
 * @param {string} sortBy - Index name to sort by (optional)
 * @param {boolean} descending - Sort descending (default: false)
 * @returns {Promise<{items: Array, total: number, page: number, pageSize: number, totalPages: number}>}
 */
export const getPaginatedItems = async (storeName, page = 1, pageSize = 50, sortBy = null, descending = false) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    
    // Get total count
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const total = countRequest.result;
      const totalPages = Math.ceil(total / pageSize);
      
      // Get all items
      const getAllRequest = sortBy ? store.index(sortBy).getAll() : store.getAll();
      getAllRequest.onsuccess = () => {
        let items = getAllRequest.result;
        
        // Sort if needed
        if (sortBy && items.length > 0) {
          items.sort((a, b) => {
            const aVal = a[sortBy];
            const bVal = b[sortBy];
            if (descending) {
              return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            } else {
              return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            }
          });
        }
        
        // Paginate
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedItems = items.slice(startIndex, endIndex);
        
        resolve({
          items: paginatedItems,
          total,
          page,
          pageSize,
          totalPages
        });
      };
      getAllRequest.onerror = () => reject(getAllRequest.error);
    };
    countRequest.onerror = () => reject(countRequest.error);
  });
};

// ============================================
// STATISTICS & AGGREGATION OPERATIONS
// ============================================

/**
 * Get total sales amount
 * @param {Date} startDate - Start date (optional)
 * @param {Date} endDate - End date (optional)
 * @returns {Promise<number>} - Total sales amount
 */
export const getTotalSales = async (startDate = null, endDate = null) => {
  const transactions = startDate && endDate
    ? await getTransactionsByDateRange(startDate, endDate)
    : await getAllItems(STORES.transactions);
  
  return transactions.reduce((sum, transaction) => sum + (transaction.total || 0), 0);
};

/**
 * Get total purchase orders amount
 * @param {Date} startDate - Start date (optional)
 * @param {Date} endDate - End date (optional)
 * @returns {Promise<number>} - Total purchase orders amount
 */
export const getTotalPurchaseOrders = async (startDate = null, endDate = null) => {
  const orders = await getAllItems(STORES.purchaseOrders);
  
  let filtered = orders;
  if (startDate && endDate) {
    filtered = orders.filter(order => {
      const date = new Date(order.createdAt);
      return date >= startDate && date <= endDate;
    });
  }
  
  return filtered.reduce((sum, order) => sum + (order.total || 0), 0);
};

/**
 * Get inventory value (stock * price)
 * @returns {Promise<number>} - Total inventory value
 */
export const getInventoryValue = async () => {
  const products = await getAllItems(STORES.products);
  return products.reduce((sum, product) => {
    const quantity = product.quantity || 0;
    const price = product.price || 0;
    return sum + (quantity * price);
  }, 0);
};

/**
 * Get customer statistics
 * @returns {Promise<{total: number, withTransactions: number, totalSpent: number}>}
 */
export const getCustomerStats = async () => {
  const customers = await getAllItems(STORES.customers);
  const transactions = await getAllItems(STORES.transactions);
  
  const customerIds = new Set(transactions.map(t => t.customerId).filter(Boolean));
  const totalSpent = transactions.reduce((sum, t) => sum + (t.total || 0), 0);
  
  return {
    total: customers.length,
    withTransactions: customerIds.size,
    totalSpent
  };
};

// ============================================
// EXPORT & IMPORT OPERATIONS
// ============================================

/**
 * Export all data as JSON
 * @returns {Promise<Object>} - All data as JSON object
 */
export const exportData = async () => {
  try {
    const [customers, products, orders, transactions, purchaseOrders, categories, plans, planOrders, activities] = await Promise.all([
      getAllItems(STORES.customers),
      getAllItems(STORES.products),
      getAllItems(STORES.orders),
      getAllItems(STORES.transactions),
      getAllItems(STORES.purchaseOrders),
      getAllItems(STORES.categories),
      getAllItems(STORES.plans),
      getAllItems(STORES.planOrders),
      getAllItems(STORES.activities)
    ]);

    const data = {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      customers,
      products,
      orders,
      transactions,
      purchaseOrders,
      categories,
      plans,
      planOrders,
      activities
    };

    return data;
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
};

/**
 * Import data from JSON
 * @param {Object} data - Data object to import
 * @param {boolean} clearExisting - Whether to clear existing data first (default: true)
 * @returns {Promise<{success: boolean, message: string, imported: Object}>}
 */
export const importData = async (data, clearExisting = true) => {
  try {
    if (clearExisting) {
      await Promise.all([
        clearAllItems(STORES.customers),
        clearAllItems(STORES.products),
        clearAllItems(STORES.orders),
        clearAllItems(STORES.transactions),
        clearAllItems(STORES.purchaseOrders),
        clearAllItems(STORES.categories),
        clearAllItems(STORES.plans),
        clearAllItems(STORES.planOrders),
        clearAllItems(STORES.activities)
      ]);
    }

    const imported = {
      customers: 0,
      products: 0,
      orders: 0,
      transactions: 0,
      purchaseOrders: 0,
      categories: 0,
      plans: 0,
      planOrders: 0,
      activities: 0
    };

    if (data.customers && data.customers.length > 0) {
      await addMultipleItems(STORES.customers, data.customers);
      imported.customers = data.customers.length;
    }
    if (data.products && data.products.length > 0) {
      await addMultipleItems(STORES.products, data.products);
      imported.products = data.products.length;
    }
    if (data.orders && data.orders.length > 0) {
      await addMultipleItems(STORES.orders, data.orders);
      imported.orders = data.orders.length;
    }
    if (data.transactions && data.transactions.length > 0) {
      await addMultipleItems(STORES.transactions, data.transactions);
      imported.transactions = data.transactions.length;
    }
    if (data.purchaseOrders && data.purchaseOrders.length > 0) {
      await addMultipleItems(STORES.purchaseOrders, data.purchaseOrders);
      imported.purchaseOrders = data.purchaseOrders.length;
    }
    if (data.categories && data.categories.length > 0) {
      await addMultipleItems(STORES.categories, data.categories);
      imported.categories = data.categories.length;
    }
    if (data.plans && data.plans.length > 0) {
      await addMultipleItems(STORES.plans, data.plans);
      imported.plans = data.plans.length;
    }
    if (data.planOrders && data.planOrders.length > 0) {
      await addMultipleItems(STORES.planOrders, data.planOrders);
      imported.planOrders = data.planOrders.length;
    }
    if (data.activities && data.activities.length > 0) {
      await addMultipleItems(STORES.activities, data.activities);
      imported.activities = data.activities.length;
    }

    return {
      success: true,
      message: 'Data imported successfully',
      imported
    };
  } catch (error) {
    console.error('Error importing data:', error);
    return {
      success: false,
      message: error.message,
      imported: {}
    };
  }
};

// ============================================
// SYNC OPERATIONS
// ============================================

/**
 * Sync data to backend
 * @param {string} backendUrl - Backend API URL
 * @param {Object} options - Sync options
 * @returns {Promise<{success: boolean, message: string, data?: any}>}
 */
export const syncDataToBackend = async (backendUrl = 'https://your-backend-api.com/sync', options = {}) => {
  if (!navigator.onLine && !options.force) {
    console.warn('Device is offline. Cannot sync data.');
    return { success: false, message: 'Device is offline' };
  }

  try {
    const data = await exportData();
    data.syncedAt = new Date().toISOString();
    data.userId = options.userId || null;

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Backend sync failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Data synced successfully:', result);
    return { success: true, message: 'Data synced successfully', data: result };
  } catch (error) {
    console.error('Error syncing data:', error);
    return { success: false, message: error.message };
  }
};

/**
 * Sync data from backend
 * @param {string} backendUrl - Backend API URL
 * @param {Object} options - Sync options
 * @returns {Promise<{success: boolean, message: string, data?: any}>}
 */
export const syncDataFromBackend = async (backendUrl = 'https://your-backend-api.com/sync', options = {}) => {
  if (!navigator.onLine && !options.force) {
    console.warn('Device is offline. Cannot sync data.');
    return { success: false, message: 'Device is offline' };
  }

  try {
    const url = new URL(backendUrl);
    if (options.userId) {
      url.searchParams.append('userId', options.userId);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Backend fetch failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = await importData(data, options.clearExisting !== false);
    
    return { success: result.success, message: result.message, data: result.imported };
  } catch (error) {
    console.error('Error syncing data from backend:', error);
    return { success: false, message: error.message };
  }
};

// ============================================
// DATABASE MANAGEMENT OPERATIONS
// ============================================

/**
 * Delete the entire database
 * @returns {Promise<void>}
 */
export const deleteDatabase = async () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn('Database deletion blocked. Close all tabs with this database open.');
      reject(new Error('Database deletion blocked'));
    };
  });
};

/**
 * Get database size information
 * @returns {Promise<{stores: Object, totalSize: number}>}
 */
export const getDatabaseInfo = async () => {
  const db = await openDB();
  const stores = {};
  let totalSize = 0;

  for (const storeName of db.objectStoreNames) {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const countRequest = store.count();
    
    await new Promise((resolve, reject) => {
      countRequest.onsuccess = () => {
        stores[storeName] = {
          count: countRequest.result,
          name: storeName
        };
        resolve();
      };
      countRequest.onerror = () => reject(countRequest.error);
    });
  }

  // Estimate size (rough calculation)
  const allData = await exportData();
  const dataString = JSON.stringify(allData);
  totalSize = new Blob([dataString]).size;

  return {
    stores,
    totalSize,
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
  };
};

// Export openDB for direct access if needed
export { openDB };
