// Plan-based feature unlocking utility

export const PLAN_FEATURES = {
  basic: {
    unlockedModules: [
      'dashboard',
      'customers', 
      'products',
      'inventory',
      'billing',
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
  // Always allow access to upgrade page and dashboard
  if (moduleName === 'upgrade' || moduleName === 'dashboard') return true;
  
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
      'billing': ['billing', 'bill']
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
  
  // Fallback to hardcoded PLAN_FEATURES for backward compatibility
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures) return false;
  
  return planFeatures.unlockedModules.includes(moduleName);
};

// Check if user can add more customers
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

export const canAddCustomer = (currentCustomers, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxCustomers', planFeatures ? planFeatures.maxCustomers : 0);
  return currentCustomers < limit;
};

// Check if user can add more products
export const canAddProduct = (currentProducts, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxProducts', planFeatures ? planFeatures.maxProducts : 0);
  return currentProducts < limit;
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

// Get plan limits
export const canAddOrder = (currentOrders, currentPlan, currentPlanDetails = null) => {
  const planFeatures = PLAN_FEATURES[currentPlan];
  if (!planFeatures && !currentPlanDetails) return false;
  const limit = normalizeLimit(currentPlanDetails, 'maxOrders', planFeatures ? planFeatures.maxOrders : 0);
  return currentOrders < limit;
};

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
