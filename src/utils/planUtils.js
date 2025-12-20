// Plan-based feature unlocking utility

export const PLAN_FEATURES = {
  basic: {
    unlockedModules: [
      'dashboard',
      'customers',
      'products',
      'inventory',
      'billing',
      'salesOrderHistory',
      'refunds',
      'settings'
    ],
    lockedModules: [
      'purchase',
      'financial',
      'reports'
    ],
    maxCustomers: 149,
    maxProducts: 499,
    maxOrders: 199,
    voiceAssistant: false,
    advancedReports: false,
    userManagement: false
  },
  standard: {
    unlockedModules: [
      'dashboard',
      'customers',
      'products',
      'inventory',
      'billing',
      'salesOrderHistory',
      'refunds',
      'purchase',
      'reports',
      'settings'
    ],
    lockedModules: [
      'financial'
    ],
    maxCustomers: 299,
    maxProducts: 899,
    maxOrders: 599,
    voiceAssistant: false, // Only text access
    advancedReports: false,
    userManagement: false
  },
  premium: {
    unlockedModules: [
      'dashboard',
      'customers',
      'products',
      'inventory',
      'billing',
      'salesOrderHistory',
      'refunds',
      'purchase',
      'financial',
      'reports',
      'settings'
    ],
    lockedModules: [],
    maxCustomers: Infinity,
    maxProducts: Infinity,
    maxOrders: Infinity,
    voiceAssistant: true,
    advancedReports: true,
    userManagement: true
  }
};

// Helper function to normalize module names for comparison
const normalizeModuleName = (name) => {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/orders?/g, '')
    .replace(/ai/g, '')
    .replace(/voice/g, '')
    .replace(/assistant/g, 'assistant');
};

// Check if a module is unlocked for the current plan
// currentPlanDetails: optional object from backend with unlockedModules array
export const isModuleUnlocked = (moduleName, currentPlan, currentPlanDetails = null) => {
  // Always allow access to upgrade page, dashboard, and settings
  if (moduleName === 'upgrade' || moduleName === 'dashboard' || moduleName === 'settings') return true;

  // If no plan details or no unlockedModules array, deny access (be restrictive)
  if (!currentPlanDetails || !currentPlanDetails.unlockedModules || !Array.isArray(currentPlanDetails.unlockedModules)) {
    return false;
  }

  // If we have plan details from database, use them
  if (currentPlanDetails && currentPlanDetails.unlockedModules) {
    // Normalize all database module names
    const normalizedDbModules = currentPlanDetails.unlockedModules.map(normalizeModuleName);

    // Normalize the requested module name
    const normalizedModuleName = normalizeModuleName(moduleName);

    // Direct normalized match
    if (normalizedDbModules.includes(normalizedModuleName)) {
      return true;
    }

    // Exact match (case-insensitive)
    const lowerModuleName = moduleName.toLowerCase();
    for (const dbModule of currentPlanDetails.unlockedModules) {
      if (dbModule.toLowerCase() === lowerModuleName) {
        return true;
      }
    }

    // Special mappings for common variations between frontend and database naming
    const moduleMappings = {
      'purchase': ['purchase', 'purchaseorders', 'purchase orders'],
      'purchaseOrders': ['purchase', 'purchaseorders', 'purchase orders'],
      'financial': ['financial', 'finance', 'financial management'],
      'reports': ['reports', 'reporting'],
      'settings': ['settings', 'setting'],
      'dashboard': ['dashboard'],
      'customers': ['customers', 'customer'],
      'products': ['products', 'product'],
      'inventory': ['inventory', 'stock'],
      'billing': ['billing', 'bill'],
      'salesOrderHistory': ['salesorderhistory', 'sales order history', 'order history', 'orders']
    };

    const mappings = moduleMappings[moduleName] || [moduleName];
    for (const mapping of mappings) {
      const normalizedMapping = normalizeModuleName(mapping);
      if (normalizedDbModules.includes(normalizedMapping)) {
        return true;
      }
      // Also check against original database module names (case-insensitive)
      for (const dbModule of currentPlanDetails.unlockedModules) {
        if (dbModule.toLowerCase().includes(mapping.toLowerCase()) ||
          mapping.toLowerCase().includes(dbModule.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  // No fallback - only current plan's unlockedModules are allowed
  return false;
};

// Check if user can add more customers (distributed across all valid plan orders)
export const canAddCustomer = async (currentCustomers, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage.customers) return false;

  const limit = aggregatedUsage.customers.limit;
  const used = aggregatedUsage.customers.used;

  // If unlimited, always allow
  if (limit === null || limit === undefined || limit === 'Unlimited') return true;

  // Check if we have capacity
  return used < limit;
};

// Check if user can add more products (distributed across all valid plan orders)
export const canAddProduct = async (currentProducts, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage.products) return false;

  const limit = aggregatedUsage.products.limit;
  const used = aggregatedUsage.products.used;

  // If unlimited, always allow
  if (limit === null || limit === undefined || limit === 'Unlimited') return true;

  // Check if we have capacity
  return used < limit;
};

// Check if user can add more orders (distributed across all valid plan orders)
export const canAddOrder = async (currentOrders, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage.orders) return false;

  const limit = aggregatedUsage.orders.limit;
  const used = aggregatedUsage.orders.used;

  // If unlimited, always allow
  if (limit === null || limit === undefined || limit === 'Unlimited') return true;

  // Check if we have capacity
  return used < limit;
};

// Legacy function for backward compatibility (single plan checking)
export const canAddCustomerLegacy = (currentCustomers, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxCustomers', planFeatures ? planFeatures.maxCustomers : 0);
  return currentCustomers < limit;
};

// Legacy function for backward compatibility (single plan checking)
export const canAddProductLegacy = (currentProducts, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxProducts', planFeatures ? planFeatures.maxProducts : 0);
  return currentProducts < limit;
};

// Legacy function for backward compatibility (single plan checking)
export const canAddOrderLegacy = (currentOrders, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxOrders', planFeatures ? planFeatures.maxOrders : 0);
  return currentOrders < limit;
};

// Helper function to normalize limit values
const normalizeLimit = (planDetails, key, fallback) => {
  if (planDetails && planDetails[key] !== undefined && planDetails[key] !== null) {
    const value = planDetails[key];
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'unlimited' || lower === 'infinity') {
        return Infinity;
      }
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    if (typeof value === 'number') {
      return value === -1 ? Infinity : value;
    }
  }
  return fallback;
};

// Check if voice assistant is available
export const isVoiceAssistantAvailable = (currentPlan) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures) return false;

  return planFeatures.voiceAssistant;
};

// Check if advanced reports are available
export const isAdvancedReportsAvailable = (currentPlan) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures) return false;

  return planFeatures.advancedReports;
};

// Check if user management is available
export const isUserManagementAvailable = (currentPlan) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures) return false;

  return planFeatures.userManagement;
};

// Get distributed plan limits (sum of all valid plan orders)
export const getDistributedPlanLimits = (aggregatedUsage) => {
  if (!aggregatedUsage) {
    return { maxCustomers: 0, maxProducts: 0, maxOrders: 0 };
  }

  return {
    maxCustomers: aggregatedUsage.customers?.limit || 0,
    maxProducts: aggregatedUsage.products?.limit || 0,
    maxOrders: aggregatedUsage.orders?.limit || 0
  };
};

// Get current usage from distributed system
export const getDistributedUsage = (aggregatedUsage) => {
  if (!aggregatedUsage) {
    return { customers: 0, products: 0, orders: 0 };
  }

  return {
    customers: aggregatedUsage.customers?.used || 0,
    products: aggregatedUsage.products?.used || 0,
    orders: aggregatedUsage.orders?.used || 0
  };
};

// Legacy getPlanLimits function for backward compatibility
export const getPlanLimits = (currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) {
    return { maxCustomers: 0, maxProducts: 0, maxOrders: 0 };
  }

  const fallbackCustomers = planFeatures ? planFeatures.maxCustomers : 0;
  const fallbackProducts = planFeatures ? planFeatures.maxProducts : 0;
  const fallbackOrders = planFeatures ? planFeatures.maxOrders : 0;

  return {
    maxCustomers: normalizeLimit(currentPlanDetails, 'maxCustomers', fallbackCustomers),
    maxProducts: normalizeLimit(currentPlanDetails, 'maxProducts', fallbackProducts),
    maxOrders: normalizeLimit(currentPlanDetails, 'maxOrders', fallbackOrders)
  };
};

// Check if a plan type is unlimited
export const isUnlimited = (limit) => {
  return limit === null || limit === undefined || limit === 'Unlimited' || limit === Infinity;
};

// Get remaining capacity for a specific type
export const getRemainingCapacity = (aggregatedUsage, type) => {
  if (!aggregatedUsage || !aggregatedUsage[type]) return 0;

  const limit = aggregatedUsage[type].limit;
  const used = aggregatedUsage[type].used;

  if (isUnlimited(limit)) return Infinity;

  return Math.max(0, limit - used);
};

// Get usage percentage for a specific type
export const getUsagePercentage = (aggregatedUsage, type) => {
  if (!aggregatedUsage || !aggregatedUsage[type]) return 0;

  const limit = aggregatedUsage[type].limit;
  const used = aggregatedUsage[type].used;

  if (isUnlimited(limit) || limit === 0) return 0;

  return Math.min(100, Math.round((used / limit) * 100));
};

// Calculate aggregated usage from planOrders data
export const calculateAggregatedUsageFromPlanOrders = (planOrders) => {
  if (!Array.isArray(planOrders) || planOrders.length === 0) {
    return {
      customers: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
      products: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
      orders: { limit: 0, used: 0, remaining: 0, isUnlimited: false }
    };
  }

  const now = new Date();
  const validPlanOrders = planOrders.filter(order => {
    // Check if payment is completed
    if (order.paymentStatus !== 'completed') return false;

    // Check if not expired
    if (order.expiryDate && new Date(order.expiryDate) <= now) return false;

    // Check if has valid limits (at least one limit should be set)
    return order.customerLimit !== null || order.productLimit !== null || order.orderLimit !== null;
  });

  const aggregated = {
    customers: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
    products: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
    orders: { limit: 0, used: 0, remaining: 0, isUnlimited: false }
  };

  // Sum up limits and usage from all valid plan orders
  for (const order of validPlanOrders) {
    // Customers
    if (order.customerLimit === null || order.customerLimit === undefined) {
      aggregated.customers.isUnlimited = true;
    } else if (!aggregated.customers.isUnlimited) {
      aggregated.customers.limit += order.customerLimit;
    }
    aggregated.customers.used += order.customerCurrentCount || 0;

    // Products
    if (order.productLimit === null || order.productLimit === undefined) {
      aggregated.products.isUnlimited = true;
    } else if (!aggregated.products.isUnlimited) {
      aggregated.products.limit += order.productLimit;
    }
    aggregated.products.used += order.productCurrentCount || 0;

    // Orders
    if (order.orderLimit === null || order.orderLimit === undefined) {
      aggregated.orders.isUnlimited = true;
    } else if (!aggregated.orders.isUnlimited) {
      aggregated.orders.limit += order.orderLimit;
    }
    aggregated.orders.used += order.orderCurrentCount || 0;
  }

  // Calculate remaining for each type
  ['customers', 'products', 'orders'].forEach(type => {
    if (aggregated[type].isUnlimited) {
      aggregated[type].remaining = null; // Unlimited
    } else {
      aggregated[type].remaining = Math.max(0, aggregated[type].limit - aggregated[type].used);
    }
  });

  return aggregated;
};

// Check if user can add data of a specific type (distributed limit checking)
export const canAddData = async (currentCount, dataType, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage[dataType]) return false;

  const limit = aggregatedUsage[dataType].limit;
  const used = aggregatedUsage[dataType].used;

  // If unlimited, always allow
  if (isUnlimited(limit)) return true;

  // Check if we have capacity
  return used < limit;
};

// Get limit error message for a specific data type
export const getLimitErrorMessage = (dataType, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage[dataType]) {
    return `Unable to check limits for ${dataType}. Please try again.`;
  }

  const remainingCapacity = getRemainingCapacity(aggregatedUsage, dataType);
  const dataTypeLabel = dataType.charAt(0).toUpperCase() + dataType.slice(1);

  if (remainingCapacity === 0) {
    return `You've reached your ${dataType} limit across all plans. Please upgrade your plan to add more ${dataType}.`;
  }

  return `You've reached your ${dataType} limit across all plans. Remaining capacity: ${remainingCapacity}. Please upgrade your plan to add more ${dataType}.`;
};

// Data creation manager with distributed limit checking
export class DataCreationManager {
  constructor(appContext) {
    this.state = appContext.state;
    this.dispatch = appContext.dispatch;
  }

  // Check if user can create data of a specific type
  async canCreate(type, currentCount) {
    const canAdd = await canAddData(currentCount, type, this.state.aggregatedUsage);

    if (!canAdd) {
      const errorMessage = getLimitErrorMessage(type, this.state.aggregatedUsage);
      return { canCreate: false, errorMessage };
    }

    return { canCreate: true };
  }

  // Create customer with limit checking
  async createCustomer(customerData) {
    // Check limits
    const activeCustomers = this.state.customers.filter(c => !c.isDeleted);
    const limitCheck = await this.canCreate('customers', activeCustomers.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      // Add to IndexedDB first
      const { addItem } = await import('../utils/indexedDB');
      const customerWithId = {
        ...customerData,
        sellerId: this.state.currentUser?.sellerId,
        isSynced: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: Date.now().toString() // Temporary frontend ID
      };

      await addItem('customers', customerWithId);

      // Update local state
      this.dispatch({
        type: 'ADD_CUSTOMER',
        payload: customerWithId
      });

      // Trigger sync
      const { syncData } = await import('../utils/api');
      syncData('customers', [customerWithId], this.state.currentUser?.sellerId);

      return { success: true, data: customerWithId };
    } catch (error) {

      return { success: false, error: 'Failed to create customer. Please try again.' };
    }
  }

  // Create product with limit checking
  async createProduct(productData) {
    // Check limits
    const activeProducts = this.state.products.filter(p => !p.isDeleted);
    const limitCheck = await this.canCreate('products', activeProducts.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      // Add to IndexedDB first
      const { addItem } = await import('../utils/indexedDB');
      const productWithId = {
        ...productData,
        sellerId: this.state.currentUser?.sellerId,
        isSynced: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: Date.now().toString() // Temporary frontend ID
      };

      await addItem('products', productWithId);

      // Update local state
      this.dispatch({
        type: 'ADD_PRODUCT',
        payload: productWithId
      });

      // Trigger sync
      const { syncData } = await import('../utils/api');
      syncData('products', [productWithId], this.state.currentUser?.sellerId);

      return { success: true, data: productWithId };
    } catch (error) {

      return { success: false, error: 'Failed to create product. Please try again.' };
    }
  }

  // Create order with limit checking
  async createOrder(orderData) {
    // Check limits
    const activeOrders = this.state.orders.filter(o => !o.isDeleted);
    const limitCheck = await this.canCreate('orders', activeOrders.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      // Add to IndexedDB first
      const { addItem } = await import('../utils/indexedDB');
      const orderWithId = {
        ...orderData,
        sellerId: this.state.currentUser?.sellerId,
        isSynced: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: Date.now().toString() // Temporary frontend ID
      };

      await addItem('orders', orderWithId);

      // Update local state
      this.dispatch({
        type: 'ADD_ORDER',
        payload: orderWithId
      });

      // Trigger sync
      const { syncData } = await import('../utils/api');
      syncData('orders', [orderWithId], this.state.currentUser?.sellerId);

      return { success: true, data: orderWithId };
    } catch (error) {

      return { success: false, error: 'Failed to create order. Please try again.' };
    }
  }
}

// Get upgrade message for locked features
export const getUpgradeMessage = (feature, currentPlan) => {
  // No upgrade message for upgrade page itself
  if (feature === 'upgrade') return '';

  const messages = {
    purchase: 'Upgrade to Standard Plan to manage purchase orders',
    financial: 'Upgrade to Premium Plan to access financial management',
    reports: currentPlan === 'basic' ? 'Upgrade to Standard Plan for basic reports' : 'Upgrade to Premium Plan for advanced reports',
    settings: 'Upgrade to Premium Plan for full settings control'
  };

  return messages[feature] || 'Upgrade your plan to access this feature';
};
