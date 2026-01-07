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
      'settings',
      'customization'
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
      'settings',
      'customization'
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
      'settings',
      'customization'
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
  // Navigation is now always unlocked to allow read-only access to all modules
  // Users can navigate freely, but write operations are restricted if the plan is expired
  // or if the module is not included in their plan (handled at the dispatch level)
  return true;
};

// Check if user can add more customers (distributed across all valid plan orders)
export const canAddCustomer = (currentCustomers, aggregatedUsage, currentPlan, currentPlanDetails, planOrders = []) => {
  // Check for expired plan details first
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  // Check for mini-only status (requires at least one active non-mini plan)
  if (Array.isArray(planOrders) && planOrders.length > 0) {
    if (!hasActiveNonMiniPlan(planOrders)) return false;
  } else if (currentPlanDetails?.planType === 'mini') {
    return false;
  }

  if (aggregatedUsage && aggregatedUsage.customers && (aggregatedUsage.customers.limit > 0 || aggregatedUsage.customers.isUnlimited)) {
    const limit = Number(aggregatedUsage.customers.limit || 0);

    // If unlimited, always allow
    if (isUnlimited(limit)) return true;

    // Check capacity: Prefer server-side usage if available (handles plan resets/new plans),
    // otherwise fall back to local count.
    const usedCount = aggregatedUsage.customers.used !== undefined ? Number(aggregatedUsage.customers.used) : Number(currentCustomers);
    return usedCount < limit;
  }

  // Fallback to legacy check if aggregated data is missing or zero
  return canAddCustomerLegacy(currentCustomers, currentPlan, currentPlanDetails);
};

// Check if user can add more products (distributed across all valid plan orders)
export const canAddProduct = (currentProducts, aggregatedUsage, currentPlan, currentPlanDetails, planOrders = []) => {
  // Check for expired plan details first
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  // Check for mini-only status (requires at least one active non-mini plan)
  if (Array.isArray(planOrders) && planOrders.length > 0) {
    if (!hasActiveNonMiniPlan(planOrders)) return false;
  } else if (currentPlanDetails?.planType === 'mini') {
    return false;
  }

  if (aggregatedUsage && aggregatedUsage.products && (aggregatedUsage.products.limit > 0 || aggregatedUsage.products.isUnlimited)) {
    const limit = Number(aggregatedUsage.products.limit || 0);

    // If unlimited, always allow
    if (isUnlimited(limit)) return true;

    // Check capacity: Prefer server-side usage if available (handles plan resets/new plans),
    // otherwise fall back to local count.
    const usedCount = aggregatedUsage.products.used !== undefined ? Number(aggregatedUsage.products.used) : Number(currentProducts);
    return usedCount < limit;
  }

  // Fallback to legacy check if aggregated data is missing or zero
  return canAddProductLegacy(currentProducts, currentPlan, currentPlanDetails);
};

// Check if user can add more orders (distributed across all valid plan orders)
export const canAddOrder = (currentOrders, aggregatedUsage, currentPlan, currentPlanDetails, planOrders = []) => {
  // Check for expired plan details first
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  // Check for mini-only status (requires at least one active non-mini plan)
  if (Array.isArray(planOrders) && planOrders.length > 0) {
    if (!hasActiveNonMiniPlan(planOrders)) return false;
  } else if (currentPlanDetails?.planType === 'mini') {
    return false;
  }

  if (aggregatedUsage && aggregatedUsage.orders && (aggregatedUsage.orders.limit > 0 || aggregatedUsage.orders.isUnlimited)) {
    const limit = Number(aggregatedUsage.orders.limit || 0);

    // If unlimited, always allow
    if (isUnlimited(limit)) return true;

    // Check capacity: Prefer server-side usage if available (handles plan resets/new plans),
    // otherwise fall back to local count.
    const usedCount = aggregatedUsage.orders.used !== undefined ? Number(aggregatedUsage.orders.used) : Number(currentOrders);
    return usedCount < limit;
  }

  // Fallback to legacy check if aggregated data is missing or zero
  return canAddOrderLegacy(currentOrders, currentPlan, currentPlanDetails);
};

// Legacy function for backward compatibility (single plan checking)
export const canAddCustomerLegacy = (currentCustomers, currentPlan, currentPlanDetails = null) => {
  // Check for expired plan details
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxCustomers', planFeatures ? planFeatures.maxCustomers : 0);
  return currentCustomers < limit;
};

// Legacy function for backward compatibility (single plan checking)
export const canAddProductLegacy = (currentProducts, currentPlan, currentPlanDetails = null) => {
  // Check for expired plan details
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxProducts', planFeatures ? planFeatures.maxProducts : 0);
  return currentProducts < limit;
};

// Legacy function for backward compatibility (single plan checking)
export const canAddOrderLegacy = (currentOrders, currentPlan, currentPlanDetails = null) => {
  // Check for expired plan details
  if (currentPlanDetails && (currentPlanDetails.isExpired === true || (currentPlanDetails.expiryDate && new Date(currentPlanDetails.expiryDate) <= new Date()))) {
    return false;
  }

  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxOrders', planFeatures ? planFeatures.maxOrders : 0);
  return currentOrders < limit;
};

// Helper function to normalize limit values
const normalizeLimit = (planDetails, key, fallback) => {
  if (!planDetails) return fallback;

  // Key mappings for different naming conventions between frontend and backend
  const keyMappings = {
    'maxOrders': ['maxOrders', 'totalOrders', 'orderLimit'],
    'maxCustomers': ['maxCustomers', 'totalCustomers', 'customerLimit'],
    'maxProducts': ['maxProducts', 'totalProducts', 'productLimit']
  };

  const keysToCheck = keyMappings[key] || [key];

  for (const checkKey of keysToCheck) {
    if (planDetails[checkKey] !== undefined && planDetails[checkKey] !== null) {
      const value = planDetails[checkKey];
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
export const getDistributedPlanLimits = (aggregatedUsage, currentPlan, currentPlanDetails) => {
  if (aggregatedUsage && (aggregatedUsage.customers || aggregatedUsage.products || aggregatedUsage.orders) &&
    (Number(aggregatedUsage.customers?.limit || 0) > 0 || Number(aggregatedUsage.products?.limit || 0) > 0 || Number(aggregatedUsage.orders?.limit || 0) > 0)) {
    return {
      maxCustomers: aggregatedUsage.customers?.isUnlimited ? Infinity : Number(aggregatedUsage.customers?.limit || 0),
      maxProducts: aggregatedUsage.products?.isUnlimited ? Infinity : Number(aggregatedUsage.products?.limit || 0),
      maxOrders: aggregatedUsage.orders?.isUnlimited ? Infinity : Number(aggregatedUsage.orders?.limit || 0)
    };
  }

  // Fallback to legacy getPlanLimits
  return getPlanLimits(currentPlan, currentPlanDetails);
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
export const getRemainingCapacity = (currentCount, aggregatedUsage, type, currentPlan, currentPlanDetails) => {
  if (aggregatedUsage && aggregatedUsage[type] && (aggregatedUsage[type].limit > 0 || aggregatedUsage[type].isUnlimited)) {
    const limit = aggregatedUsage[type].limit;

    if (isUnlimited(limit)) return Infinity;

    // Prefer server-side usage if available (handles plan resets/new plans),
    // otherwise fall back to local count.
    const usedCount = aggregatedUsage[type].used !== undefined ? Number(aggregatedUsage[type].used) : Number(currentCount);

    return Math.max(0, limit - usedCount);
  }

  // Fallback legacy capacity
  const limits = getPlanLimits(currentPlan || 'basic', currentPlanDetails);
  const typeMap = {
    customers: 'maxCustomers',
    products: 'maxProducts',
    orders: 'maxOrders'
  };
  const limitValue = limits[typeMap[type]] || 0;
  if (isUnlimited(limitValue)) return Infinity;

  return Math.max(0, limitValue - currentCount);
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
      aggregated.customers.limit += Number(order.customerLimit || 0);
    }
    aggregated.customers.used += Number(order.customerCurrentCount || 0);

    // Products
    if (order.productLimit === null || order.productLimit === undefined) {
      aggregated.products.isUnlimited = true;
    } else if (!aggregated.products.isUnlimited) {
      aggregated.products.limit += Number(order.productLimit || 0);
    }
    aggregated.products.used += Number(order.productCurrentCount || 0);

    // Orders
    if (order.orderLimit === null || order.orderLimit === undefined) {
      aggregated.orders.isUnlimited = true;
    } else if (!aggregated.orders.isUnlimited) {
      aggregated.orders.limit += Number(order.orderLimit || 0);
    }
    aggregated.orders.used += Number(order.orderCurrentCount || 0);
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

// Check if user has at least one active non-mini plan
export const hasActiveNonMiniPlan = (planOrders) => {
  if (!Array.isArray(planOrders) || planOrders.length === 0) return false;

  const COMPLETED_STATUSES = ['completed', 'paid', 'success', 'successful', 'captured', 'active'];
  const BASE_PLANS = ['basic', 'standard', 'premium', 'pro', 'free'];

  const now = new Date();
  return planOrders.some(order => {
    // 1. Check if payment or subscription status is active/completed
    const pStatus = (order.paymentStatus || '').toLowerCase();
    const sStatus = (order.status || '').toLowerCase();
    const isPaid = COMPLETED_STATUSES.includes(pStatus) || COMPLETED_STATUSES.includes(sStatus);

    // 2. Check if not expired
    // Must have a valid expiry date and it must be in the future
    const hasExpiry = !!order.expiryDate;
    const isNotExpired = hasExpiry && new Date(order.expiryDate) > now;

    // 3. Check if planType is NOT 'mini' and IS a base plan
    let planType = (order.planType || '').toLowerCase();
    let planId = '';

    if (typeof order.planId === 'object' && order.planId) {
      planId = (order.planId.id || order.planId._id || '').toLowerCase();
      if (!planType) planType = (order.planId.planType || '').toLowerCase();
    } else if (typeof order.planId === 'string') {
      planId = order.planId.toLowerCase();
    }

    const isMini = planType.includes('mini') || planId.includes('mini') || planId.includes('topup');
    const isBasePlan = BASE_PLANS.includes(planType) || BASE_PLANS.includes(planId);

    // To be a valid base plan, it must be a base plan AND not a mini plan AND paid AND not expired
    return isPaid && isNotExpired && isBasePlan && !isMini;
  });
};

// Check if user can add data of a specific type (distributed limit checking)
export const canAddData = async (currentCount, dataType, aggregatedUsage, currentPlan, currentPlanDetails, planOrders = []) => {
  if (dataType === 'customers') return canAddCustomer(currentCount, aggregatedUsage, currentPlan, currentPlanDetails, planOrders);
  if (dataType === 'products') return canAddProduct(currentCount, aggregatedUsage, currentPlan, currentPlanDetails, planOrders);
  if (dataType === 'orders') return canAddOrder(currentCount, aggregatedUsage, currentPlan, currentPlanDetails, planOrders);
  return false;
};

// Get limit error message for a specific data type
export const getLimitErrorMessage = (dataType, aggregatedUsage) => {
  if (!aggregatedUsage || !aggregatedUsage[dataType]) {
    return `Unable to check limits for ${dataType}. Please try again.`;
  }

  const remainingCapacity = getRemainingCapacity(0, aggregatedUsage, dataType);
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
    const planOrders = this.state.planOrders || this.state.planUsagePlans || this.state.usage?.plans || [];
    const canAdd = await canAddData(currentCount, type, this.state.aggregatedUsage, this.state.currentPlan, this.state.currentPlanDetails, planOrders);

    if (!canAdd) {
      const errorMessage = getLimitErrorMessage(type, this.state.aggregatedUsage);
      return { canCreate: false, errorMessage };
    }

    return { canCreate: true };
  }

  // Create customer with limit checking
  // Create customer with limit checking (Optimistic & Instant)
  async createCustomer(customerData) {
    // Check limits
    const activeCustomers = this.state.customers.filter(c => !c.isDeleted);
    const limitCheck = await this.canCreate('customers', activeCustomers.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      const customerWithId = {
        ...customerData,
        sellerId: this.state.currentUser?.sellerId || this.state.sellerId,
        isSynced: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        id: `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique temporary frontend ID
      };

      // Dispatch immediately (optimistic update)
      // The reducer for ADD_CUSTOMER handles IndexedDB saving AND background sync
      this.dispatch({
        type: 'ADD_CUSTOMER',
        payload: customerWithId
      });

      return { success: true, data: customerWithId };
    } catch (error) {
      console.error("Error creating customer:", error);
      return { success: false, error: 'Failed to create customer. Please try again.' };
    }
  }

  // Create product with limit checking
  // Create product with limit checking (Optimistic & Instant)
  async createProduct(productData) {
    // Check limits
    const activeProducts = this.state.products.filter(p => !p.isDeleted);
    const limitCheck = await this.canCreate('products', activeProducts.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      const productWithId = {
        ...productData,
        sellerId: this.state.currentUser?.sellerId || this.state.sellerId,
        isSynced: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique temporary frontend ID
      };

      // Dispatch immediately (optimistic update)
      // The reducer for ADD_PRODUCT handles IndexedDB saving AND background sync
      this.dispatch({
        type: 'ADD_PRODUCT',
        payload: productWithId
      });

      return { success: true, data: productWithId };
    } catch (error) {
      console.error("Error creating product:", error);
      return { success: false, error: 'Failed to create product. Please try again.' };
    }
  }

  // Create order with limit checking
  // Create order with limit checking (Optimistic & Instant)
  async createOrder(orderData) {
    // Check limits
    const activeOrders = this.state.orders.filter(o => !o.isDeleted);
    const limitCheck = await this.canCreate('orders', activeOrders.length);

    if (!limitCheck.canCreate) {
      return { success: false, error: limitCheck.errorMessage };
    }

    try {
      const orderWithId = {
        ...orderData,
        sellerId: this.state.currentUser?.sellerId || this.state.sellerId,
        isSynced: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        id: `ord-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique temporary frontend ID
      };

      // Dispatch immediately (optimistic update)
      // The reducer for ADD_ORDER handles IndexedDB saving AND background sync
      this.dispatch({
        type: 'ADD_ORDER',
        payload: orderWithId
      });

      return { success: true, data: orderWithId };
    } catch (error) {
      console.error("Error creating order:", error);
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
