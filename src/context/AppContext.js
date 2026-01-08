import React, { createContext, useContext, useReducer, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  addItem as addToIndexedDB,
  updateItem as updateInIndexedDB,
  deleteItem as deleteFromIndexedDB,
  getAllItems,
  clearAllItems,
  addMultipleItems,
  updateLastFetchTime,
  STORES
} from '../utils/indexedDB';
import syncService, { setStoreFunctionsProvider } from '../services/syncService';
import {
  fetchAllData,
  fetchAllDataWithDeltaSync,
  fetchLatestData,
  mergeLatestDataToIndexedDB,
  getLatestFetchTimestamps,
  autoRefreshLatestData,
  fetchCustomers,
  fetchProducts,
  fetchTransactions,
  fetchVendorOrders,
  fetchCategories,
  isOnline,
  syncToIndexedDB,
  fastLoadFromIndexedDB,
  backgroundSyncWithBackend,
  updateInventoryAfterSale,
  normalizeProductBatch,
  initializeOfflineSync,
  registerBackgroundSync
} from '../utils/dataFetcher';
import { apiRequest, createOrder } from '../utils/api';
import { setOrderHashPendingChecker, setOnItemSyncedCallback, setOnSyncCompletedCallback } from '../services/syncService';
import { getPlanLimits, canAddCustomer, canAddProduct, canAddOrder, calculateAggregatedUsageFromPlanOrders, hasActiveNonMiniPlan } from '../utils/planUtils';
import { getViewFromPath } from '../utils/navigation';
import syncManager, { performFullSync, resetSyncMetadata, COLLECTION_MAP } from '../services/syncManager';

// Helper function for efficient array comparison (prevents unnecessary re-renders)
const arraysEqual = (arr1, arr2, dataType = 'unknown') => {
  // (`🔍 arraysEqual check for ${dataType}:`, {
  //   arr1Length: arr1.length,
  //   arr2Length: arr2.length,
  //   firstItem1: arr1[0] ? {
  //     id: arr1[0].id,
  //     name: arr1[0].name,
  //     updatedAt: arr1[0].updatedAt,
  //     isSynced: arr1[0].isSynced,
  //     isDeleted: arr1[0].isDeleted,
  //     ...(dataType === 'customers' ? {
  //       dueAmount: arr1[0].dueAmount,
  //       balanceDue: arr1[0].balanceDue,
  //       email: arr1[0].email
  //     } : {})
  //   } : null,
  //   firstItem2: arr2[0] ? {
  //     id: arr2[0].id,
  //     name: arr2[0].name,
  //     updatedAt: arr2[0].updatedAt,
  //     isSynced: arr2[0].isSynced,
  //     isDeleted: arr2[0].isDeleted,
  //     ...(dataType === 'customers' ? {
  //       dueAmount: arr2[0].dueAmount,
  //       balanceDue: arr2[0].balanceDue,
  //       email: arr2[0].email
  //     } : {})
  //   } : null
  // });

  if (arr1.length !== arr2.length) {
    //(`🔍 arraysEqual: Different lengths (${arr1.length} vs ${arr2.length}) - UPDATE NEEDED`);
    return false;
  }

  for (let i = 0; i < arr1.length; i++) {
    const item1 = arr1[i];
    const item2 = arr2[i];
    if (!item1 || !item2) {
      return false;
    }
    if (item1.id !== item2.id) {
      return false;
    }

    // Check data-type specific fields that can change
    if (dataType === 'customers') {
      if (item1.name !== item2.name ||
        item1.dueAmount !== item2.dueAmount ||
        item1.balanceDue !== item2.balanceDue ||
        item1.email !== item2.email ||
        item1.mobileNumber !== item2.mobileNumber) {
        return false;
      }
    } else if (dataType === 'products') {
      if (item1.name !== item2.name ||
        item1.costPrice !== item2.costPrice ||
        item1.sellingPrice !== item2.sellingPrice ||
        item1.stock !== item2.stock ||
        item1.category !== item2.category) {
        return false;
      }
    } else if (dataType === 'orders') {
      if (item1.total !== item2.total ||
        item1.status !== item2.status ||
        item1.customerName !== item2.customerName ||
        JSON.stringify(item1.items) !== JSON.stringify(item2.items)) {
        return false;
      }
    }

    // Check common metadata fields
    if (item1.updatedAt !== item2.updatedAt ||
      item1.isSynced !== item2.isSynced ||
      item1.isDeleted !== item2.isDeleted) {
      return false;
    }
  }
  return true;
};

// Track pending order API calls to prevent duplicates
// Key: order content hash, Value: order ID
const pendingOrderApiCalls = new Map();

// Store dispatch reference for async operations to update state
let globalDispatch = null;

// Sync status update callbacks
let syncStatusCallbacks = new Set();

// Debounce sync status updates to prevent excessive updates during bulk sync
let syncStatusUpdateTimeout = null;

/**
 * Register a callback to be notified when sync status should update
 */
export const registerSyncStatusCallback = (callback) => {
  syncStatusCallbacks.add(callback);
  return () => syncStatusCallbacks.delete(callback);
};

/**
 * Unregister a sync status callback
 */
export const unregisterSyncStatusCallback = (callback) => {
  syncStatusCallbacks.delete(callback);
};

/**
 * Trigger sync status updates across all registered callbacks (debounced)
 */
export const triggerSyncStatusUpdate = () => {
  // Clear any existing timeout
  if (syncStatusUpdateTimeout) {
    clearTimeout(syncStatusUpdateTimeout);
  }

  // Set a new timeout to trigger updates after a short delay
  // This debounces rapid-fire updates during bulk sync operations
  syncStatusUpdateTimeout = setTimeout(() => {
    syncStatusCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in sync status callback:', error);
      }
    });
    syncStatusUpdateTimeout = null;
  }, 50); // 50ms debounce delay
};

export const setGlobalDispatch = (dispatch) => {
  globalDispatch = dispatch;
};

// Function to refresh staff permissions from MongoDB
export const refreshStaffPermissions = async () => {
  try {
    const authData = localStorage.getItem('auth');
    if (!authData) {
      //('No auth data found, skipping permission refresh');
      return;
    }

    const parsedAuthData = JSON.parse(authData);
    if (parsedAuthData.userType !== 'staff') {
      //('User is not staff, skipping permission refresh');
      return;
    }

    const currentUser = parsedAuthData.currentUser;
    if (!currentUser?.email) {
      //('No email found in current user, skipping permission refresh');
      return;
    }

    //('🔄 Refreshing staff permissions for:', currentUser.email);

    // Import getStaffAuth dynamically to avoid circular imports
    const { getStaffAuth } = await import('../utils/api');

    const authResult = await getStaffAuth(
      currentUser.email,
      currentUser.uid || '',
      currentUser.displayName || currentUser.name || '',
      currentUser.profilePicture || currentUser.photoURL || ''
    );

    if (authResult.success && authResult.staff) {
      //('✅ Staff permissions refreshed successfully:', authResult.staff.permissions);

      // Save updated permissions to IndexedDB
      const { saveStaffPermissions } = await import('../utils/indexedDB');
      try {
        await saveStaffPermissions(
          authResult.staff._id,
          authResult.staff.permissions,
          authResult.seller?._id || authResult.sellerId
        );
        //('💾 Staff permissions updated in IndexedDB');
      } catch (error) {
        console.error('❌ Failed to save updated permissions to IndexedDB:', error);
        // Don't block the permission refresh if IndexedDB save fails
      }

      // Dispatch the refresh action
      if (globalDispatch) {
        globalDispatch({
          type: ActionTypes.REFRESH_STAFF_PERMISSIONS,
          payload: {
            permissions: authResult.staff.permissions || {}
          }
        });

        if (window.showToast) {
          window.showToast('Permissions updated successfully', 'success');
        }
      }
    } else {
      console.error('❌ Failed to refresh staff permissions:', authResult.error);
      if (window.showToast) {
        window.showToast('Failed to update permissions', 'error');
      }
    }
  } catch (error) {
    console.error('💥 Error refreshing staff permissions:', error);
    if (window.showToast) {
      window.showToast('Failed to update permissions', 'error');
    }
  }
};

const postMessageToServiceWorker = (message, options = {}) => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const { delay = 0 } = options;

  const sendMessage = () => {
    if (!navigator.serviceWorker.controller) return;
    try {
      navigator.serviceWorker.controller.postMessage(message);
    } catch (error) {
      console.error('[PWA] Failed to post message to service worker:', error);
    }
  };

  if (delay > 0) {
    setTimeout(sendMessage, delay);
  } else {
    sendMessage();
  }
};

export const PLAN_LOADER_SESSION_KEY = 'plan-bootstrap-complete';

// Export function to check if an order is currently being processed
export const isOrderBeingProcessed = (order) => {
  if (!order) return false;
  const orderHash = createOrderHash(order);
  return pendingOrderApiCalls.has(orderHash);
};

// Export function to check if an order hash is being processed
export const isOrderHashBeingProcessed = (orderHash) => {
  return pendingOrderApiCalls.has(orderHash);
};

// Recompute metrics and chart data derived from orders/products
const recomputeDerivedData = (state) => {
  try {
    const sellerId = state.currentUser?.sellerId || state.sellerId || null;
    const orders = (state.orders || []).filter(order => !sellerId || order.sellerId === sellerId);
    const products = state.products || [];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);

    // Build daily buckets for last 30 days
    const dayKey = (d) => `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    const days = [];
    const map = new Map();
    for (let i = 0; i < 30; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const k = dayKey(d);
      days.push(k);
      map.set(k, { sales: 0, profit: 0 });
    }

    let totalSales = 0;
    let totalProfit = 0;
    let salesToday = 0;
    let profitToday = 0;
    const todayKey = dayKey(now);

    for (const o of orders) {
      const d = new Date(o.createdAt || o.date || now);
      const k = dayKey(d);
      const orderTotal = Number(o.totalAmount || 0);
      const orderProfit = (o.items || []).reduce((acc, it) => {
        const sp = Number(it.sellingPrice || 0);
        const cp = Number(it.costPrice || 0);
        const qty = Number(it.quantity || 0);
        return acc + (sp - cp) * qty;
      }, 0);

      totalSales += orderTotal;
      totalProfit += orderProfit;
      if (k === todayKey) {
        salesToday += orderTotal;
        profitToday += orderProfit;
      }
      if (map.has(k)) {
        const v = map.get(k);
        v.sales += orderTotal;
        v.profit += orderProfit;
      }
    }

    const salesData = days.map(k => map.get(k)?.sales || 0);
    const profitData = days.map(k => map.get(k)?.profit || 0);

    // Minimal chart dataset structure; components can style further
    const salesChartData = {
      labels: days,
      datasets: [{ label: 'Sales', data: salesData }]
    };
    const profitChartData = {
      labels: days,
      datasets: [{ label: 'Profit', data: profitData }]
    };

    // Basic inventory summary (by quantity)
    const inventoryChartData = {
      labels: products.slice(0, 10).map(p => p.name || ''),
      datasets: [{ label: 'Stock', data: products.slice(0, 10).map(p => Number(p.quantity || p.stock || 0)) }]
    };

    return {
      salesChartData,
      profitChartData,
      inventoryChartData,
      totals: {
        totalSales,
        totalProfit,
        salesToday,
        profitToday
      }
    };
  } catch (e) {
    console.error('Error recomputing derived data:', e);
    return {};
  }
};

// Helper function to create a hash of order content for duplicate detection
const createOrderHash = (order) => {
  // Normalize totalAmount to 2 decimal places to handle floating point precision issues
  const normalizedTotal = Math.round((order.totalAmount || 0) * 100) / 100;

  // Create hash based on sellerId, customerId, totalAmount, and items
  // Sort items by name for consistent hashing
  const itemsHash = JSON.stringify((order.items || []).map(i => ({
    name: (i.name || '').trim(),
    quantity: typeof i.quantity === 'number' ? i.quantity : parseFloat(i.quantity) || 0,
    sellingPrice: Math.round((typeof i.sellingPrice === 'number' ? i.sellingPrice : parseFloat(i.sellingPrice) || 0) * 100) / 100,
    costPrice: Math.round((typeof i.costPrice === 'number' ? i.costPrice : parseFloat(i.costPrice) || 0) * 100) / 100
  })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));

  return `${order.sellerId || ''}_${order.customerId || 'null'}_${normalizedTotal}_${itemsHash}`;
};

// Helper function to get user-specific storage keys
const getUserStorageKey = (key, userId) => {
  if (!userId) return key;
  return `${key}_${userId}`;
};

// Load initial state from localStorage if available
const getInitialState = () => {
  const savedAuth = localStorage.getItem('auth');
  const savedSettings = localStorage.getItem('settings');

  let authState = { isAuthenticated: false, currentUser: null, userType: null };
  if (savedAuth) {
    try {
      authState = JSON.parse(savedAuth);
      // Ensure userType is set from currentUser if available
      if (authState.currentUser && !authState.userType) {
        authState.userType = authState.currentUser.userType || 'seller';
      }
    } catch (e) {
      console.error('Error parsing saved auth:', e);
    }
  }

  // For staff users, we'll load permissions but not show loading state initially
  // This allows them to see all navigation until permissions are loaded and filtered
  const shouldLoadStaffPermissions = false; // Don't show loading state initially

  let settingsState = {
    currentLanguage: 'en',
    voiceAssistantLanguage: 'en-US',
    voiceAssistantEnabled: true,
    expiryDaysThreshold: 3,
    lowStockThreshold: 10,
    subscriptionDays: 30,
    isSubscriptionActive: true,
    currentPlan: 'basic',
    gstNumber: '',
    storeName: 'Grocery Store',
    upiId: '',
    currencyFormat: 'plain',
    darkMode: false
  };

  const hasPlanBootstrapCompleted = typeof window !== 'undefined' && sessionStorage.getItem(PLAN_LOADER_SESSION_KEY) === 'true';

  if (savedSettings) {
    try {
      const parsed = JSON.parse(savedSettings);
      settingsState = { ...settingsState, ...parsed };
    } catch (e) {
      console.error('Error parsing saved settings:', e);
    }
  }

  const initialView = typeof window !== 'undefined'
    ? getViewFromPath(window.location.pathname)
    : 'dashboard';


  return {
    // Authentication
    isAuthenticated: authState.isAuthenticated,
    currentUser: authState.currentUser || null,
    staffPermissionsLoading: shouldLoadStaffPermissions,
    permissionsInitiallyLoaded: false,

    // Language settings
    currentLanguage: settingsState.currentLanguage,
    voiceAssistantLanguage: settingsState.voiceAssistantLanguage,
    voiceAssistantLanguage: settingsState.voiceAssistantLanguage,
    voiceAssistantEnabled: settingsState.voiceAssistantEnabled,
    darkMode: settingsState.darkMode,

    // Data
    customers: [],
    products: [],
    productBatches: [],
    purchaseOrders: [],
    orders: [], // Sales/billing records (Order model)
    transactions: [], // ONLY for plan purchases (Transaction model)
    activities: [],
    categories: [],
    planOrders: [], // Plan purchase orders
    refunds: [], // Refund records
    expenses: [], // Petty expenses
    customerTransactions: [], // Added ledger transactions for customers

    // UI state
    currentView: initialView,
    isListening: false,
    isLoading: false,
    refreshTrigger: 0,

    // Pagination
    customerCurrentPage: 1,
    productCurrentPage: 1,
    itemsPerPage: 50,

    // Current operations
    currentBillItems: [],
    currentPOItems: [],
    billingDraft: null,
    currentProduct: null, // For editing products from other pages

    // Settings
    expiryDaysThreshold: settingsState.expiryDaysThreshold,
    lowStockThreshold: settingsState.lowStockThreshold,
    currencyFormat: settingsState.currencyFormat || 'plain',

    // Subscription system
    subscriptionDays: settingsState.subscriptionDays,
    isSubscriptionActive: settingsState.isSubscriptionActive,
    currentPlan: settingsState.currentPlan,
    currentPlanDetails: null, // Will be fetched from backend
    aggregatedUsage: null, // Derived from plan details for limit checking
    isPlanInvalid: false, // Set to true when /data/all API returns planInvalid

    // Business details
    gstNumber: settingsState.gstNumber,
    storeName: authState.currentUser?.shopName || settingsState.storeName,
    upiId: authState.currentUser?.upiId || settingsState.upiId || '',

    // Scanner state
    isScannerActive: false,
    scannerType: 'html5-qrcode',

    // Charts and reports
    salesChartData: null,
    profitChartData: null,
    inventoryChartData: null,
    dashboardTotals: {
      totalSales: 0,
      totalProfit: 0,
      salesToday: 0,
      profitToday: 0
    },
    customerChartData: null,

    // Time and status
    currentTime: new Date().toLocaleTimeString(),
    systemStatus: 'online',
    dataFreshness: 'loading', // 'loading' | 'cached' | 'fresh' | 'error'
    dataLastSynced: null, // timestamp when data was last synced with backend
    allowedModules: authState.currentUser?.allowedModules || null,

    planBootstrap: {
      isActive: false,
      hasCompleted: hasPlanBootstrapCompleted,
      startedAt: null,
      completedAt: hasPlanBootstrapCompleted ? Date.now() : null
    },
  };
};

const initialState = getInitialState();

const adjustPlanUsage = (planDetails, deltas = {}) => {
  if (!planDetails) return planDetails;

  const next = { ...planDetails };

  const hasUsageSummary = !!next.planUsageSummary;

  const updateValue = (key, delta) => {
    if (!delta || delta === 0) return;
    if (!(key in next)) return;

    const raw = next[key];
    const parsed = typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : null;

    if (parsed === null || Number.isNaN(parsed)) return;

    const updated = Math.max(0, parsed + delta);
    next[key] = typeof raw === 'string' ? String(updated) : updated;
  };

  const applySummaryDelta = (typeKey, capitalized, delta) => {
    if (!delta || delta === 0) return;
    if (!next.planUsageSummary || !next.planUsageSummary[typeKey]) {
      updateValue(`total${capitalized}`, delta);
      return;
    }

    const summary = { ...next.planUsageSummary };
    const typeSummary = { ...summary[typeKey] };

    const usedBefore = typeof typeSummary.used === 'number' ? typeSummary.used : 0;
    const newUsed = Math.max(0, usedBefore + delta);
    typeSummary.used = newUsed;

    if (typeSummary.isUnlimited) {
      typeSummary.remaining = null;
      next[`max${capitalized}`] = Infinity;
      next[`remaining${capitalized}`] = Infinity;
    } else {
      const limitValue = typeof typeSummary.limit === 'number' ? typeSummary.limit : null;
      if (limitValue !== null) {
        const newRemaining = Math.max(0, limitValue - newUsed);
        typeSummary.remaining = newRemaining;
        next[`max${capitalized}`] = limitValue;
        next[`remaining${capitalized}`] = newRemaining;
      } else if (typeof typeSummary.remaining === 'number') {
        typeSummary.remaining = Math.max(0, typeSummary.remaining - delta);
        next[`remaining${capitalized}`] = typeSummary.remaining;
      }
    }

    next[`total${capitalized}`] = newUsed;
    summary[typeKey] = typeSummary;
    next.planUsageSummary = summary;
  };

  if (hasUsageSummary) {
    applySummaryDelta('customers', 'Customers', deltas.customers || 0);
    applySummaryDelta('products', 'Products', deltas.products || 0);
    applySummaryDelta('orders', 'Orders', deltas.orders || 0);
  } else {
    updateValue('totalCustomers', deltas.customers || 0);
    updateValue('totalProducts', deltas.products || 0);
    updateValue('totalOrders', deltas.orders || 0);
  }

  return next;
};

export const mergePlanDetailsWithUsage = (planDetails, usagePayload) => {
  const hasUsage = usagePayload && usagePayload.summary;
  if (!planDetails && !hasUsage) {
    return planDetails || null;
  }

  const combined = {
    ...(planDetails ? { ...planDetails } : {}),
  };

  if (hasUsage) {
    const summaryClone = { ...usagePayload.summary };
    const plansClone = Array.isArray(usagePayload.plans) ? usagePayload.plans.map(plan => ({ ...plan })) : [];

    const applyUsage = (typeKey, capitalized) => {
      const typeSummary = summaryClone[typeKey];
      if (!typeSummary) return;

      const isUnlimited = !!typeSummary.isUnlimited;
      const used = typeof typeSummary.used === 'number' ? typeSummary.used : 0;
      const limitValue = typeof typeSummary.limit === 'number' ? typeSummary.limit : null;

      let remainingValue;
      if (isUnlimited) {
        remainingValue = Infinity;
      } else if (typeof typeSummary.remaining === 'number') {
        remainingValue = Math.max(0, typeSummary.remaining);
      } else if (limitValue !== null) {
        remainingValue = Math.max(0, limitValue - used);
      } else if (typeof combined[`max${capitalized}`] === 'number') {
        remainingValue = Math.max(0, combined[`max${capitalized}`] - used);
      } else {
        remainingValue = Math.max(0, -used);
      }

      combined[`total${capitalized}`] = used;

      if (isUnlimited) {
        combined[`max${capitalized}`] = Infinity;
        combined[`remaining${capitalized}`] = Infinity;
      } else {
        if (limitValue !== null) {
          combined[`max${capitalized}`] = limitValue;
        } else if (combined[`max${capitalized}`] === undefined) {
          combined[`max${capitalized}`] = used + (typeof remainingValue === 'number' ? remainingValue : 0);
        }

        if (remainingValue === Infinity) {
          combined[`remaining${capitalized}`] = Infinity;
        } else if (typeof remainingValue === 'number') {
          combined[`remaining${capitalized}`] = remainingValue;
        }
      }

      summaryClone[typeKey] = {
        ...typeSummary,
        used,
        remaining: isUnlimited ? null : (typeof remainingValue === 'number' ? remainingValue : null),
      };
    };

    applyUsage('customers', 'Customers');
    applyUsage('products', 'Products');
    applyUsage('orders', 'Orders');

    combined.planUsageSummary = summaryClone;
    combined.planUsagePlans = plansClone;
  }

  return combined;
};

const AUTO_SWITCH_RETRY_WINDOW = 60 * 1000;
const AUTO_REFRESH_COOLDOWN = 15 * 1000;
const PAYMENT_COMPLETED_STATUSES = new Set(['completed', 'paid', 'success', 'successful', 'captured', 'active']);

const normalizePlanIdentifier = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    if (value.planId !== undefined) return normalizePlanIdentifier(value.planId);
    if (value.id !== undefined) return normalizePlanIdentifier(value.id);
    if (value.slug !== undefined) return normalizePlanIdentifier(value.slug);
    if (value.code !== undefined) return normalizePlanIdentifier(value.code);
    if (value.name !== undefined) return normalizePlanIdentifier(value.name);
  }
  const str = String(value).trim();
  if (!str) return null;
  return str.toLowerCase();
};

const parsePlanDateValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : Math.round(value * 1000);
  }
  const str = String(value).trim();
  if (!str) return null;
  const numeric = Number(str);
  if (!Number.isNaN(numeric)) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return Math.round(numeric * 1000);
  }
  const parsed = new Date(str);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
};

const extractFirstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
};

const normalizePlanOrderEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;

  const rawPlanId = extractFirstDefined(
    entry.planId,
    entry.plan_id,
    entry.plan?.planId,
    entry.plan?.plan_id,
    entry.plan?.id,
    entry.plan?.slug,
    entry.plan?.code,
    entry.planIdentifier,
    entry.planSlug,
    entry.planCode,
    entry.plan_key,
    entry.planKey
  );
  const planId = rawPlanId !== null ? String(rawPlanId) : null;
  const planKey = normalizePlanIdentifier(rawPlanId);

  const planOrderId = extractFirstDefined(
    entry.planOrderId,
    entry.plan_order_id,
    entry.id,
    entry._id,
    entry.orderId,
    entry.subscriptionId,
    entry.referenceId
  );

  if (!planId && !planOrderId) {
    return null;
  }

  const paymentStatus = normalizePlanIdentifier(entry.paymentStatus ?? entry.payment_status ?? entry.paymentState ?? entry.payment_state);
  const status = normalizePlanIdentifier(entry.status ?? entry.state ?? entry.subscriptionStatus);

  const expiresAt = parsePlanDateValue(
    extractFirstDefined(
      entry.expiresAt,
      entry.expiryDate,
      entry.expiry,
      entry.endDate,
      entry.validTill,
      entry.validUntil,
      entry.planExpiryDate,
      entry.planExpiry
    )
  );

  const startsAt = parsePlanDateValue(
    extractFirstDefined(
      entry.startsAt,
      entry.startDate,
      entry.start_time,
      entry.activatedAt,
      entry.createdAt,
      entry.planStartDate,
      entry.planStart
    )
  );

  const keySegments = [
    planOrderId ? String(planOrderId) : null,
    planKey,
    expiresAt !== null ? String(expiresAt) : null,
    startsAt !== null ? String(startsAt) : null
  ].filter(Boolean);

  const key = keySegments.length > 0
    ? keySegments.join('|')
    : (planKey ? `${planKey}|${expiresAt ?? 'no-expiry'}` : null);

  return {
    key,
    planId,
    planKey,
    planOrderId: planOrderId ? String(planOrderId) : null,
    paymentStatus,
    status,
    expiresAt,
    startsAt,
    planName: extractFirstDefined(entry.planName, entry.plan?.name, entry.name, entry.title),
    isCurrent: Boolean(entry.isCurrent || entry.current || entry.isActive || entry.active),
    isExpiredFlag: entry.isExpired,
    raw: entry
  };
};

const collectPlanOrdersFromDetails = (planDetails) => {
  if (!planDetails) return [];

  const sources = [];
  if (Array.isArray(planDetails.planUsagePlans)) {
    sources.push(...planDetails.planUsagePlans);
  }
  if (Array.isArray(planDetails.planOrders)) {
    sources.push(...planDetails.planOrders);
  }

  const unique = new Map();
  for (const entry of sources) {
    const normalized = normalizePlanOrderEntry(entry);
    if (!normalized || !normalized.key) continue;
    if (!unique.has(normalized.key)) {
      unique.set(normalized.key, normalized);
    }
  }

  return Array.from(unique.values());
};

const planDetailsHasPlanOrderSource = (planDetails) => {
  if (!planDetails) return false;
  return Array.isArray(planDetails.planUsagePlans) || Array.isArray(planDetails.planOrders);
};

const isPaymentStatusCompleted = (status) => {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return PAYMENT_COMPLETED_STATUSES.has(normalized);
};

const isPlanOrderExpired = (order, referenceTime) => {
  if (!order) return true;
  if (order.isExpiredFlag === true) return true;
  if (order.isExpiredFlag === false) return false;
  if (order.expiresAt === null) return false;
  return order.expiresAt <= referenceTime;
};

const getCurrentPlanExpiryTimestamp = (planDetails) => {
  if (!planDetails) return null;
  const expiryCandidate = extractFirstDefined(
    planDetails.expiresAt,
    planDetails.expiryDate,
    planDetails.expiry,
    planDetails.endDate,
    planDetails.validTill,
    planDetails.validUntil,
    planDetails.planExpiry,
    planDetails.planExpiryDate,
    planDetails.plan?.expiresAt,
    planDetails.plan?.expiryDate,
    planDetails.currentPlan?.expiresAt
  );
  return parsePlanDateValue(expiryCandidate);
};

export const isCurrentPlanExpired = (planDetails, referenceTime) => {
  if (!planDetails) return false;
  if (planDetails.isExpired === true) return true;
  const expiryTimestamp = getCurrentPlanExpiryTimestamp(planDetails);
  if (expiryTimestamp === null) return false;
  return expiryTimestamp <= referenceTime;
};

export const isPlanExpired = (state) => {
  if (!state) return false;

  // 1. Check explicit active flag
  if (state.isSubscriptionActive === false) return true;

  // 2. Check current plan details expired flag
  if (state.currentPlanDetails?.isExpired === true) return true;

  // 3. Check calculated expiry date if available
  if (state.currentPlanDetails?.expiryDate) {
    const expiry = new Date(state.currentPlanDetails.expiryDate);
    if (!isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) {
      return true;
    }
  }

  // 4. Check if plan is invalid (handled by loadData/refreshCurrentPlanDetails)
  if (state.isPlanInvalid === true) return true;

  // 5. Check for Mini-Plan only status
  // A base subscription (non-mini) is required for write operations.
  // Top-ups (mini plans) alone do not grant write access.
  const planOrders = state.planOrders || state.planUsagePlans || state.usage?.plans || [];
  if (planOrders.length > 0) {
    if (!hasActiveNonMiniPlan(planOrders)) {
      return true; // Only has mini plans = Denied write access
    }
  } else if (state.currentPlanDetails) {
    const pDetails = state.currentPlanDetails;
    const pType = (pDetails.planType || '').toLowerCase();
    const pName = (pDetails.planName || pDetails.name || '').toLowerCase();
    const pId = (pDetails.planId || pDetails.id || '').toLowerCase();

    const isMini = pType.includes('mini') || pName.includes('mini') || pId.includes('mini') || pId.includes('topup');

    // If it's explicitly identified as mini plan, block write operations
    if (isMini) return true;
  }

  // 6. Check currentPlan identifier string
  if (state.currentPlan && (
    state.currentPlan.toLowerCase().includes('mini') ||
    state.currentPlan.toLowerCase().includes('topup')
  )) {
    return true;
  }

  return false;
};

// Action types
export const ActionTypes = {
  // Authentication
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  REFRESH_STAFF_PERMISSIONS: 'REFRESH_STAFF_PERMISSIONS',
  SET_STAFF_PERMISSIONS_LOADING: 'SET_STAFF_PERMISSIONS_LOADING',

  // Language
  SET_LANGUAGE: 'SET_LANGUAGE',
  SET_VOICE_LANGUAGE: 'SET_VOICE_LANGUAGE',

  // Plan management
  SET_CURRENT_PLAN: 'SET_CURRENT_PLAN',
  SET_CURRENT_PLAN_DETAILS: 'SET_CURRENT_PLAN_DETAILS',
  SET_PLAN_ORDERS: 'SET_PLAN_ORDERS',
  SET_PLAN_INVALID: 'SET_PLAN_INVALID',
  SET_UPI_ID: 'SET_UPI_ID',

  // Data management
  SET_CUSTOMERS: 'SET_CUSTOMERS',
  ADD_CUSTOMER: 'ADD_CUSTOMER',
  UPDATE_CUSTOMER: 'UPDATE_CUSTOMER',
  DELETE_CUSTOMER: 'DELETE_CUSTOMER',

  SET_PRODUCTS: 'SET_PRODUCTS',
  ADD_PRODUCT: 'ADD_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DELETE_PRODUCT: 'DELETE_PRODUCT',
  SET_CURRENT_PRODUCT: 'SET_CURRENT_PRODUCT',

  SET_PRODUCT_BATCHES: 'SET_PRODUCT_BATCHES',
  ADD_PRODUCT_BATCH: 'ADD_PRODUCT_BATCH',
  UPDATE_PRODUCT_BATCH: 'UPDATE_PRODUCT_BATCH',
  DELETE_PRODUCT_BATCH: 'DELETE_PRODUCT_BATCH',

  SET_PURCHASE_ORDERS: 'SET_PURCHASE_ORDERS',
  ADD_PURCHASE_ORDER: 'ADD_PURCHASE_ORDER',
  UPDATE_PURCHASE_ORDER: 'UPDATE_PURCHASE_ORDER',
  DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER',

  SET_ORDERS: 'SET_ORDERS',
  ADD_ORDER: 'ADD_ORDER',
  UPDATE_ORDER: 'UPDATE_ORDER',
  DELETE_ORDER: 'DELETE_ORDER',

  SET_TRANSACTIONS: 'SET_TRANSACTIONS',
  ADD_TRANSACTION: 'ADD_TRANSACTION',
  UPDATE_TRANSACTION: 'UPDATE_TRANSACTION',

  // Refunds
  SET_REFUNDS: 'SET_REFUNDS',
  ADD_REFUND: 'ADD_REFUND',
  UPDATE_REFUND: 'UPDATE_REFUND',
  DELETE_REFUND: 'DELETE_REFUND',

  SET_ACTIVITIES: 'SET_ACTIVITIES',
  ADD_ACTIVITY: 'ADD_ACTIVITY',

  // Categories
  SET_CATEGORIES: 'SET_CATEGORIES',
  ADD_CATEGORY: 'ADD_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',

  // Expenses
  SET_EXPENSES: 'SET_EXPENSES',
  ADD_EXPENSE: 'ADD_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',

  // Customer Transactions
  SET_CUSTOMER_TRANSACTIONS: 'SET_CUSTOMER_TRANSACTIONS',
  ADD_CUSTOMER_TRANSACTION: 'ADD_CUSTOMER_TRANSACTION',
  UPDATE_CUSTOMER_TRANSACTION: 'UPDATE_CUSTOMER_TRANSACTION',
  DELETE_CUSTOMER_TRANSACTION: 'DELETE_CUSTOMER_TRANSACTION',

  // UI state
  SET_CURRENT_VIEW: 'SET_CURRENT_VIEW',
  SET_LISTENING: 'SET_LISTENING',
  SET_LOADING: 'SET_LOADING',
  FORCE_REFRESH: 'FORCE_REFRESH',
  SET_DARK_MODE: 'SET_DARK_MODE',

  // Pagination
  SET_CUSTOMER_PAGE: 'SET_CUSTOMER_PAGE',
  SET_PRODUCT_PAGE: 'SET_PRODUCT_PAGE',

  // Current operations
  SET_BILL_ITEMS: 'SET_BILL_ITEMS',
  ADD_BILL_ITEM: 'ADD_BILL_ITEM',
  REMOVE_BILL_ITEM: 'REMOVE_BILL_ITEM',
  CLEAR_BILL_ITEMS: 'CLEAR_BILL_ITEMS',
  SET_BILLING_DRAFT: 'SET_BILLING_DRAFT',

  SET_PO_ITEMS: 'SET_PO_ITEMS',
  ADD_PO_ITEM: 'ADD_PO_ITEM',
  REMOVE_PO_ITEM: 'REMOVE_PO_ITEM',
  CLEAR_PO_ITEMS: 'CLEAR_PO_ITEMS',

  // Settings
  SET_LOW_STOCK_THRESHOLD: 'SET_LOW_STOCK_THRESHOLD',
  SET_EXPIRY_DAYS_THRESHOLD: 'SET_EXPIRY_DAYS_THRESHOLD',

  // Subscription
  SET_SUBSCRIPTION_DAYS: 'SET_SUBSCRIPTION_DAYS',
  SET_SUBSCRIPTION_ACTIVE: 'SET_SUBSCRIPTION_ACTIVE',
  PLAN_BOOTSTRAP_START: 'PLAN_BOOTSTRAP_START',
  PLAN_BOOTSTRAP_COMPLETE: 'PLAN_BOOTSTRAP_COMPLETE',
  PLAN_BOOTSTRAP_RESET: 'PLAN_BOOTSTRAP_RESET',

  // Business details
  SET_GST_NUMBER: 'SET_GST_NUMBER',
  SET_STORE_NAME: 'SET_STORE_NAME',

  // User
  UPDATE_USER: 'UPDATE_USER',
  SET_VOICE_ASSISTANT_LANGUAGE: 'SET_VOICE_ASSISTANT_LANGUAGE',
  SET_VOICE_ASSISTANT_ENABLED: 'SET_VOICE_ASSISTANT_ENABLED',
  SET_CURRENCY_FORMAT: 'SET_CURRENCY_FORMAT',

  // Scanner
  SET_SCANNER_ACTIVE: 'SET_SCANNER_ACTIVE',
  SET_SCANNER_TYPE: 'SET_SCANNER_TYPE',

  // Charts
  SET_SALES_CHART_DATA: 'SET_SALES_CHART_DATA',
  SET_PROFIT_CHART_DATA: 'SET_PROFIT_CHART_DATA',
  SET_INVENTORY_CHART_DATA: 'SET_INVENTORY_CHART_DATA',
  SET_CUSTOMER_CHART_DATA: 'SET_CUSTOMER_CHART_DATA',

  // Time and status
  UPDATE_CURRENT_TIME: 'UPDATE_CURRENT_TIME',
  SET_SYSTEM_STATUS: 'SET_SYSTEM_STATUS',
  SET_DATA_FRESHNESS: 'SET_DATA_FRESHNESS'
};

// Helper function to get action type for data type
const getActionTypeForDataType = (dataType) => {
  const actionMap = {
    customers: ActionTypes.SET_CUSTOMERS,
    products: ActionTypes.SET_PRODUCTS,
    orders: ActionTypes.SET_ORDERS,
    transactions: ActionTypes.SET_TRANSACTIONS,
    purchaseOrders: ActionTypes.SET_PURCHASE_ORDERS,
    vendorOrders: ActionTypes.SET_PURCHASE_ORDERS,
    categories: ActionTypes.SET_CATEGORIES,
    refunds: ActionTypes.SET_REFUNDS,
    expenses: ActionTypes.SET_EXPENSES,
    customerTransactions: ActionTypes.SET_CUSTOMER_TRANSACTIONS,
    productBatches: ActionTypes.SET_PRODUCT_BATCHES
  };
  return actionMap[dataType];
};

// Helper function to get store functions for sync service (defined outside reducer)
const appStoreFunctions = (storeName) => {
  const storeMap = {
    customers: {
      getAllItems: () => getAllItems(STORES.customers),
      updateItem: (item) => updateInIndexedDB(STORES.customers, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.customers, id)
    },
    products: {
      getAllItems: () => getAllItems(STORES.products),
      updateItem: (item) => updateInIndexedDB(STORES.products, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.products, id)
    },
    orders: {
      getAllItems: () => getAllItems(STORES.orders),
      updateItem: (item) => updateInIndexedDB(STORES.orders, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.orders, id)
    },
    transactions: {
      getAllItems: () => getAllItems(STORES.transactions),
      updateItem: (item) => updateInIndexedDB(STORES.transactions, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.transactions, id)
    },
    purchaseOrders: {
      getAllItems: () => getAllItems(STORES.purchaseOrders),
      updateItem: (item) => updateInIndexedDB(STORES.purchaseOrders, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.purchaseOrders, id)
    },
    categories: {
      getAllItems: () => getAllItems(STORES.categories),
      updateItem: (item) => updateInIndexedDB(STORES.categories, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.categories, id)
    },
    refunds: {
      getAllItems: () => getAllItems(STORES.refunds),
      updateItem: (item) => updateInIndexedDB(STORES.refunds, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.refunds, id)
    },
    productBatches: {
      getAllItems: () => getAllItems(STORES.productBatches),
      updateItem: (item) => updateInIndexedDB(STORES.productBatches, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.productBatches, id)
    },
    expenses: {
      getAllItems: () => getAllItems(STORES.expenses),
      updateItem: (item) => updateInIndexedDB(STORES.expenses, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.expenses, id)
    },
    customerTransactions: {
      getAllItems: () => getAllItems(STORES.customerTransactions),
      updateItem: (item) => updateInIndexedDB(STORES.customerTransactions, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.customerTransactions, id)
    },
    settings: {
      getAllItems: () => getAllItems(STORES.settings),
      updateItem: (item) => updateInIndexedDB(STORES.settings, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.settings, id)
    }
  };
  return storeMap[storeName];
};

const formatPlanLimitLabel = (value) => (value === Infinity ? 'Unlimited' : value);

// Register store functions provider with sync service
setStoreFunctionsProvider(appStoreFunctions);

const getPlanNameLabel = (state) => {
  if (state.currentPlanDetails?.planName) {
    return state.currentPlanDetails.planName;
  }
  if (state.currentPlan) {
    return `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}`;
  }
  return 'Current';
};

const checkPlanCapacity = (state, entity) => {
  const planNameLabel = getPlanNameLabel(state);
  const aggregatedUsage = state.aggregatedUsage;

  const configs = {
    customer: {
      current: state.customers.filter(customer => !customer.isDeleted).length,
      limit: aggregatedUsage?.customers?.limit ?? 0,
      canAdd: (current) => canAddCustomer(current, aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []),
      label: 'customer',
      plural: 'customers'
    },
    product: {
      current: state.products.filter(product => !product.isDeleted).length,
      limit: aggregatedUsage?.products?.limit ?? 0,
      canAdd: (current) => canAddProduct(current, aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []),
      label: 'product',
      plural: 'products'
    },
    order: {
      current: state.orders.filter(order => !order.isDeleted).length,
      limit: aggregatedUsage?.orders?.limit ?? 0,
      canAdd: (current) => canAddOrder(current, aggregatedUsage, state.currentPlan, state.currentPlanDetails, state.planOrders || state.planUsagePlans || []),
      label: 'order',
      plural: 'orders'
    }
  };

  const config = configs[entity];
  if (!config) {
    return { allowed: true };
  }

  if (config.canAdd(config.current)) {
    return { allowed: true };
  }

  const limitLabel = formatPlanLimitLabel(config.limit);
  const message = `You've reached the ${config.label} limit (${limitLabel}) for the ${planNameLabel} plan. Upgrade your plan to add more ${config.plural}.`;
  return { allowed: false, message };
};

// Helper function to associate batches with products
export const associateBatchesWithProducts = (products, batches) => {
  // Create a map of productId to batches - try multiple ID formats
  const batchMap = {};
  batches.forEach(batch => {
    const productId = batch.productId;

    // Store under the exact productId
    if (!batchMap[productId]) {
      batchMap[productId] = [];
    }
    batchMap[productId].push(batch);
  });

  // Associate batches with products - try multiple ID matching strategies
  return products.map(product => {
    const productId = product._id || product.id;
    let productBatches = batchMap[productId] || [];

    // If no batches found with primary ID, try alternative formats
    if (productBatches.length === 0) {
      // Try string conversion if productId is an object
      const stringProductId = typeof productId === 'object' ? productId.toString() : productId;

      // Try different ID variations
      const alternativeIds = [
        stringProductId,
        product._id?.toString(),
        product.id?.toString()
      ].filter((id, index, arr) => id && arr.indexOf(id) === index && id !== productId); // Remove duplicates

      for (const altId of alternativeIds) {
        if (batchMap[altId]) {
          productBatches = batchMap[altId];
          break;
        }
      }
    }

    return {
      ...product,
      batches: productBatches
    };
  });
};

// Reducer function
// Helper to calculate aggregated usage considering both backend plan orders and local unsynced data
const calculateRealtimeAggregatedUsage = (params) => {
  const { planOrders, orders, customers, products, currentPlanDetails } = params;

  // 1. Base usage - Prioritize the pre-calculated summary from backend if available
  // This ensures we match the backend's logic exactly for limits/usage
  let baseUsage;

  if (currentPlanDetails?.planUsageSummary) {
    // Prefer summary from backend as it's the authoritative source
    baseUsage = JSON.parse(JSON.stringify(currentPlanDetails.planUsageSummary));
  } else if (planOrders && planOrders.length > 0) {
    // Fallback to calculating from orders if summary missing
    baseUsage = calculateAggregatedUsageFromPlanOrders(planOrders);
  } else {
    // Default zero usage
    baseUsage = {
      customers: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
      products: { limit: 0, used: 0, remaining: 0, isUnlimited: false },
      orders: { limit: 0, used: 0, remaining: 0, isUnlimited: false }
    };
  }

  // 2. Apply local state DELTAS (Local Truth)
  // CRITICAL FIX: Instead of counting absolute local items (which might include unlimited historical data),
  // we strictly calculate the DELTA of changes that haven't reached the server yet.
  // usage = ServerUsage + (NewUnsynced) - (DeletedUnsynced)

  const activeSellerId = params.sellerId || params.currentUser?.sellerId || currentPlanDetails?.sellerId;

  const applyDelta = (entityType, items) => {
    if (!items || !Array.isArray(items) || !baseUsage[entityType]) return;

    let delta = 0;
    items.forEach(item => {
      // Filter by sellerId first
      if (activeSellerId && item.sellerId && item.sellerId !== activeSellerId) return;

      // Identify New Unsynced Items (adds to usage)
      // Condition: Not synced, Not deleted. Valid regardless of _id presence if it's explicitly unsynced 
      // (sometimes _id is set preemptively or during partial syncs)
      const isNewLocal = !item.isSynced && !item.isDeleted;

      // Identify Deleted Unsynced Items (subtracts from usage)
      // Condition: Not synced, IS deleted, and HAS backend _id (meaning it was on server, now deleted locally)
      const isDeletedLocal = !item.isSynced && item.isDeleted && (item._id || item.id);

      if (isNewLocal) delta++;
      // Only subtract if it was previously counted (i.e. has a server ID)
      if (isDeletedLocal && item._id) delta--;
    });

    if (delta !== 0) {
      baseUsage[entityType].used = Math.max(0, (baseUsage[entityType].used || 0) + delta);
    }
  };

  applyDelta('orders', orders);
  applyDelta('customers', customers);
  applyDelta('products', products);

  // 4. Recalculate remaining
  ['orders', 'customers', 'products'].forEach(key => {
    if (baseUsage[key]) {
      if (!baseUsage[key].isUnlimited && typeof baseUsage[key].limit === 'number') {
        baseUsage[key].remaining = Math.max(0, baseUsage[key].limit - baseUsage[key].used);
      } else if (baseUsage[key].isUnlimited) {
        baseUsage[key].remaining = null;
      }
    }
  });

  return baseUsage;
};

const appReducer = (state, action) => {
  // Only log critical actions (skip UPDATE_CURRENT_TIME and other frequent actions)
  if (action.type === 'ADD_ORDER') {
    //('🎯 REDUCER: ADD_ORDER action received!', action);
  }
  // Skip logging UPDATE_CURRENT_TIME and other frequent actions to reduce console noise

  switch (action.type) {
    case ActionTypes.LOGIN: {
      // ('🔐 LOGIN ACTION RECEIVED:', {
      //   userType: action.payload?.userType,
      //   userEmail: action.payload?.email,
      //   permissions: action.payload?.permissions,
      //   hasSellerId: !!action.payload?.sellerId
      // });

      const sellerId = action.payload?.sellerId || null;
      const isStaffUser = action.payload?.userType === 'staff';

      // Save auth to localStorage (including sellerId and userType if provided)
      const authData = {
        isAuthenticated: true,
        currentUser: action.payload,
        userType: action.payload?.userType || 'seller',
        sellerId
      };
      localStorage.setItem('auth', JSON.stringify(authData));

      // For staff users, ensure permissions are fresh
      if (isStaffUser) {
        //('👤 Staff user logged in, ensuring fresh permissions...');
        // Permissions are already refreshed during auth, but we can add additional refresh logic here if needed
      }

      // Notify service worker that user is authenticated
      postMessageToServiceWorker({
        type: 'AUTHENTICATED',
        user: action.payload
      });
      postMessageToServiceWorker({ type: 'CACHE_APP_RESOURCES' }, { delay: 500 });

      // Mark staff login for data loading (handled by useEffect in components)
      if (isStaffUser) {
        //('👤 Staff user logged in - data will be loaded by components');
      }

      // Start auto-sync after login (skip initial sync since backgroundSyncWithBackend handles it)
      setTimeout(() => {
        if (syncService.isOnline()) {
          syncService.startAutoSync(appStoreFunctions, 30000, true); // Sync every 30 seconds, skip initial
        }
      }, 2000);

      let nextPlanBootstrap = state.planBootstrap || {
        isActive: false,
        hasCompleted: false,
        startedAt: null,
        completedAt: null
      };

      // Only do plan bootstrapping for sellers, not staff
      if (sellerId && !isStaffUser) {
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem(PLAN_LOADER_SESSION_KEY);
        }
        nextPlanBootstrap = {
          isActive: true,
          hasCompleted: false,
          startedAt: Date.now(),
          completedAt: null
        };
      } else {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(PLAN_LOADER_SESSION_KEY, 'true');
        }
        nextPlanBootstrap = {
          isActive: false,
          hasCompleted: true,
          startedAt: null,
          completedAt: Date.now()
        };
      }

      const nextStoreName = action.payload?.shopName && action.payload.shopName.trim()
        ? action.payload.shopName.trim()
        : action.payload?.owner?.shopName && action.payload.owner.shopName.trim()
          ? action.payload.owner.shopName.trim()
          : state.storeName;

      return {
        ...state,
        isAuthenticated: true,
        currentUser: action.payload,
        userType: action.payload?.userType || 'seller', // Set userType from payload or default to seller
        upiId: action.payload?.upiId
          || action.payload?.owner?.upiId
          || '',
        storeName: nextStoreName || state.storeName,
        planBootstrap: nextPlanBootstrap,
        allowedModules: null
      };
    }

    case ActionTypes.REFRESH_STAFF_PERMISSIONS: {

      // Update currentUser with fresh permissions
      const updatedUser = {
        ...state.currentUser,
        permissions: action.payload.permissions || {}
      };

      // Update localStorage with fresh permissions
      const authData = localStorage.getItem('auth');
      if (authData) {
        const parsedAuthData = JSON.parse(authData);
        parsedAuthData.currentUser = updatedUser;
        localStorage.setItem('auth', JSON.stringify(parsedAuthData));
      }

      // For staff users, set the default view to the first available permission
      const isStaffUser = state.userType === 'staff' || state.currentUser?.userType === 'staff';
      let newCurrentView = state.currentView;

      if (isStaffUser && action.payload.defaultView) {
        // For staff users, always set to first available permission on initial permissions load
        // This ensures they start on their permitted page, not dashboard
        if (!state.permissionsInitiallyLoaded) {
          newCurrentView = action.payload.defaultView;
        }
      }

      return {
        ...state,
        currentUser: updatedUser,
        currentView: newCurrentView,
        permissionsInitiallyLoaded: true
      };
    }

    case ActionTypes.SET_STAFF_PERMISSIONS_LOADING: {
      return {
        ...state,
        staffPermissionsLoading: action.payload.loading
      };
    }

    case ActionTypes.LOGOUT:
      // Clear all authentication data from localStorage
      const userId = state.currentUser?.email || state.currentUser?.uid || state.currentUser?._id;
      //(`🗑️ Clearing authentication data from localStorage`);
      try {
        // Clear main auth data
        localStorage.removeItem('auth');

        // Clear user-specific data caches if userId is available
        if (userId) {
          localStorage.removeItem(getUserStorageKey('customers', userId));
          localStorage.removeItem(getUserStorageKey('products', userId));
          localStorage.removeItem(getUserStorageKey('transactions', userId));
          localStorage.removeItem(getUserStorageKey('purchaseOrders', userId));
          localStorage.removeItem(getUserStorageKey('activities', userId));
          localStorage.removeItem(getUserStorageKey('settings', userId));
        }

        // Clear sync metadata
        const syncKeys = Object.keys(localStorage).filter(key => key.startsWith('sync_'));
        syncKeys.forEach(key => localStorage.removeItem(key));

        // Clear first login flag so premium loading shows again on next login
        localStorage.removeItem('hasLoggedInBefore');

        // Clear Firebase auth persistence data
        const firebaseKeys = Object.keys(localStorage).filter(key =>
          key.startsWith('firebase:') ||
          key.startsWith('firebaseLocalStorage') ||
          key.includes('firebase-auth')
        );
        firebaseKeys.forEach(key => localStorage.removeItem(key));

        //('✅ All authentication data cleared from localStorage');
      } catch (error) {
        console.warn('⚠️ Error clearing localStorage:', error);
      }


      // Stop auto-sync
      syncService.stopAutoSync();

      // Notify service worker that user logged out
      postMessageToServiceWorker({ type: 'LOGGED_OUT' });

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PLAN_LOADER_SESSION_KEY);
      }

      // Note: IndexedDB database deletion is now handled in the logout flow
      // in Settings.js performLogout() function using indexedDB.deleteDatabase()

      // Clear IndexedDB data based on user type (async operation) - backup in case database deletion fails
      const userType = state.currentUser?.userType;

      //(`🗑️ Processing logout for ${userType} (${userId})`);

      if (userType === 'seller') {
        //('🗑️ Clearing all IndexedDB data for seller logout...');

        // Clear all seller-related data stores
        const sellerStores = [
          STORES.customers,
          STORES.products,
          STORES.orders,
          STORES.transactions,
          STORES.purchaseOrders,
          STORES.categories,
          STORES.refunds,
          STORES.planDetails,
          STORES.settings,
          STORES.activities,
          STORES.syncMetadata,
          STORES.productBatches,
          STORES.planOrders
        ];

        // Clear stores asynchronously (don't block logout)
        sellerStores.forEach(storeName => {
          clearAllItems(storeName).catch(error => {
            console.warn(`⚠️ Error clearing IndexedDB store ${storeName}:`, error.message);
          });
        });

        //('✅ IndexedDB clearing initiated for seller logout');
      } else if (userType === 'staff') {
        //('👤 Staff logout - keeping seller data, clearing staff-specific data only');

        // For staff, only clear staff-specific data to preserve seller data access
        clearAllItems(STORES.staffPermissions).catch(error => {
          console.warn('⚠️ Error clearing staff permissions:', error.message);
        });

        //('✅ Staff permissions cleared');
      } else {
        //('❓ Unknown user type during logout - clearing minimal data');

        // For unknown user types, clear minimal data
        clearAllItems(STORES.activities).catch(error => {
          console.warn('⚠️ Error clearing activities:', error.message);
        });
      }

      return {
        ...state,
        isAuthenticated: false,
        currentUser: null,
        customers: [],
        products: [],
        transactions: [],
        purchaseOrders: [],
        expenses: [],
        activities: [],
        categories: [],
        currentPlan: 'basic',
        currentPlanDetails: null,
        aggregatedUsage: null,
        isSubscriptionActive: true,
        lowStockThreshold: 10,
        expiryDaysThreshold: 3,
        subscriptionDays: 30,
        upiId: '',
        planBootstrap: {
          isActive: false,
          hasCompleted: false,
          startedAt: null,
          completedAt: null
        }
      };

    case ActionTypes.SET_DARK_MODE:
      return {
        ...state,
        darkMode: action.payload
      };

    case ActionTypes.SET_LANGUAGE:
      return {
        ...state,
        currentLanguage: action.payload
      };

    case ActionTypes.SET_CURRENT_PLAN:
      return {
        ...state,
        currentPlan: action.payload
      };

    case ActionTypes.SET_CURRENT_PLAN_DETAILS:
      // Cache plan details to IndexedDB when they are set
      if (action.payload) {
        // Try to get sellerId from multiple possible locations
        const sellerId = state.currentUser?.sellerId ||
          state.currentUser?.id ||
          state.currentUser?._id ||
          state.sellerId;

        if (sellerId) {
          const recordId = `planDetails_${sellerId}`;
          const record = {
            id: recordId,
            sellerId: sellerId,
            data: action.payload,
            lastUpdated: new Date().toISOString()
          };

          // Cache asynchronously without blocking the UI
          setTimeout(() => {
            updateInIndexedDB(STORES.planDetails, record).catch(error => {
              console.error('Failed to cache plan details:', error);
            });
          }, 0);
        } else {
          console.warn('Cannot cache plan details - no sellerId found in state:', state);
        }
      }

      return {
        ...state,
        currentPlanDetails: action.payload,
        aggregatedUsage: calculateRealtimeAggregatedUsage({
          ...state,
          currentPlanDetails: action.payload
        })
      };

    case ActionTypes.SET_PLAN_ORDERS:
      return {
        ...state,
        planOrders: action.payload,
        aggregatedUsage: calculateRealtimeAggregatedUsage({
          ...state,
          planOrders: action.payload
        })
      };

    case ActionTypes.SET_PLAN_INVALID:
      return {
        ...state,
        isPlanInvalid: action.payload
      };

    case ActionTypes.SET_VOICE_LANGUAGE:
      return {
        ...state,
        voiceAssistantLanguage: action.payload
      };

    case ActionTypes.SET_CUSTOMERS:
      // Ensure all customers are normalized (have both dueAmount and balanceDue)
      const normalizedCustomers = (action.payload || []).map(customer => {
        // Ensure balanceDue is set from dueAmount if missing (for offline data)
        const dueAmount = customer.dueAmount !== undefined ? customer.dueAmount : (customer.balanceDue !== undefined ? customer.balanceDue : 0);
        return {
          ...customer,
          dueAmount: typeof dueAmount === 'number' ? dueAmount : parseFloat(dueAmount) || 0,
          balanceDue: typeof dueAmount === 'number' ? dueAmount : parseFloat(dueAmount) || 0
        };
      });
      // Only update if customers array actually changed (prevent unnecessary re-renders)
      if (arraysEqual(state.customers, normalizedCustomers, 'customers')) {
        return state;
      }
      return {
        ...state,
        customers: normalizedCustomers
      };

    case ActionTypes.ADD_CUSTOMER: {
      const isSyncedRecord = action.payload?.isSynced === true || action.payload?.syncedAt;

      if (!isSyncedRecord) {
        const capacity = checkPlanCapacity(state, 'customer');
        if (!capacity.allowed) {
          if (window.showToast) {
            window.showToast(capacity.message, 'warning', 5000);
          }
          return state;
        }
      }

      const newCustomer = {
        ...action.payload,
        isSynced: action.payload?.isSynced ?? false
      };

      addToIndexedDB(STORES.customers, newCustomer)
        .then(() => {
          registerBackgroundSync();
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update after IndexedDB save completes
          triggerSyncStatusUpdate();

          // Patch local plan details cache for immediate offline availability
          const sellerId = state.currentUser?.sellerId || state.currentUser?.id || state.currentUser?._id || state.sellerId;
          if (sellerId) {
            getAllItems(STORES.planDetails).then(cached => {
              const record = cached.find(r => r.sellerId === sellerId);
              if (record && record.data) {
                // Update nested summary
                if (record.data.planUsageSummary?.customers) {
                  record.data.planUsageSummary.customers.used = (record.data.planUsageSummary.customers.used || 0) + 1;
                }
                // Update legacy top-level counts
                if (typeof record.data.customersCount === 'number') record.data.customersCount++;
                if (typeof record.data.customerCurrentCount === 'number') record.data.customerCurrentCount++;

                updateInIndexedDB(STORES.planDetails, record).catch(e => console.warn('Failed to patch local plan usage', e));
              }
            });
          }
        })
        .catch(err => console.error('IndexedDB save error:', err));

      const nextCustomers = [newCustomer, ...state.customers];
      return {
        ...state,
        customers: nextCustomers,
        // Don't update currentPlanDetails directly - rely on aggregatedUsage calculation
        currentPlanDetails: state.currentPlanDetails,
        aggregatedUsage: calculateRealtimeAggregatedUsage({
          ...state,
          customers: nextCustomers,
          currentPlanDetails: state.currentPlanDetails
        })
      };
    }

    case ActionTypes.UPDATE_CUSTOMER:
      // ('🔄 UPDATE_CUSTOMER action received:', {
      //   customerId: action.payload.id,
      //   customerName: action.payload.name,
      //   isFromSyncCallback: action.payload.syncedAt !== undefined,
      //   hasAllFields: !!(action.payload.name && action.payload.mobileNumber)
      // });

      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isFromSyncCallback = action.payload.syncedAt !== undefined;

      // If this is from a sync callback, trigger instant sync status update
      if (isFromSyncCallback) {
        setTimeout(() => triggerSyncStatusUpdate(), 0);
      }

      const updatedCustomer = {
        ...action.payload,
        // Ensure all customer fields are properly set
        name: action.payload.name || '',
        mobileNumber: action.payload.mobileNumber || '',
        email: action.payload.email || '',
        address: action.payload.address || '',
        dueAmount: action.payload.dueAmount ?? action.payload.balanceDue ?? 0,
        balanceDue: action.payload.balanceDue ?? action.payload.dueAmount ?? 0,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      // ('📝 Updated customer data:', {
      //   id: updatedCustomer.id,
      //   name: updatedCustomer.name,
      //   mobileNumber: updatedCustomer.mobileNumber,
      //   email: updatedCustomer.email,
      //   dueAmount: updatedCustomer.dueAmount,
      //   isSynced: updatedCustomer.isSynced,
      //   isUpdate: updatedCustomer.isUpdate
      // });

      updateInIndexedDB(STORES.customers, updatedCustomer)
        .then(() => {
          registerBackgroundSync();
          // Show success message for user edits (not sync callbacks)
          if (!isFromSyncCallback && window.showToast) {
            const customerName = action.payload.name || action.payload.mobileNumber || 'Customer';
            window.showToast(`Customer "${customerName}" updated successfully!`, 'success');
          }

          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast('Couldn\'t update customer. Please try again.', 'error');
          }
        });
      // Only update if customer actually changed
      const existingCustomer = state.customers.find(c =>
        c.id === action.payload.id ||
        c._id === action.payload.id ||
        (action.payload._id && c._id === action.payload._id) ||
        (action.payload.localId && c.id === action.payload.localId)
      );

      if (existingCustomer && JSON.stringify(existingCustomer) === JSON.stringify(updatedCustomer)) {
        return state; // No change
      }
      // Trigger instant sync status update
      setTimeout(() => triggerSyncStatusUpdate(), 0);

      return {
        ...state,
        customers: state.customers.map(customer =>
          (customer.id === action.payload.id ||
            customer._id === action.payload.id ||
            (action.payload._id && customer._id === action.payload._id) ||
            (action.payload.localId && customer.id === action.payload.localId))
            ? updatedCustomer
            : customer
        )
      };

    case ActionTypes.DELETE_CUSTOMER:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const customerToDelete = state.customers.find(c => c.id === action.payload || c._id === action.payload);
      if (customerToDelete) {
        // ('🗑️ Deleting customer:', {
        //   id: customerToDelete.id,
        //   _id: customerToDelete._id,
        //   name: customerToDelete.name,
        //   hasMongoId: !!customerToDelete._id
        // });

        const deletedCustomer = {
          ...customerToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(), // Update timestamp to ensure sync priority
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.customers, deletedCustomer, true) // Skip validation for soft delete
          .then(() => {
            // ALSO Soft delete all associated transactions in IndexedDB (fetching from DB to be sure we get them all)
            getAllItems(STORES.customerTransactions).then(allTx => {
              const targetIds = [
                customerToDelete.id,
                customerToDelete._id,
                customerToDelete.localId
              ].filter(Boolean).map(id => id.toString());

              const txToDelete = allTx.filter(t => {
                const tCustId = t.customerId ? t.customerId.toString() : '';
                return targetIds.includes(tCustId) && !t.isDeleted;
              });

              if (txToDelete.length > 0) {
                // console.log(`🗑️ Found ${txToDelete.length} transactions to delete for customer ${customerToDelete.name}`);

                // Process deletions sequentially to avoid DB lock issues
                const deletePromises = txToDelete.map(t => {
                  const deletedTx = {
                    ...t,
                    isDeleted: true,
                    deletedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(), // Update timestamp to ensure sync priority
                    isSynced: false
                  };
                  return updateInIndexedDB(STORES.customerTransactions, deletedTx, true);
                });

                Promise.all(deletePromises).then(() => {
                  // Only trigger sync after ALL transactions are marked
                  registerBackgroundSync();
                  if (syncService.isOnline()) {
                    syncService.scheduleSync(appStoreFunctions);
                  }
                });
              } else {
                // No transactions, just sync the customer deletion
                registerBackgroundSync();
                if (syncService.isOnline()) {
                  syncService.scheduleSync(appStoreFunctions);
                }
              }
            });

            // Show success toast
            if (window.showToast) {
              window.showToast('Customer deleted.', 'success');
            }
          })
          .catch(err => {
            console.error('❌ IndexedDB update error:', err);
            if (window.showToast) {
              window.showToast('Couldn\'t delete customer. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        return {
          ...state,
          customers: state.customers.filter(c => c !== customerToDelete),
          // Also remove deleted transactions from state
          customerTransactions: state.customerTransactions.filter(t => {
            const idsToCheck = [
              customerToDelete.id,
              customerToDelete._id,
              customerToDelete.localId
            ].filter(Boolean).map(id => id.toString());
            const tCustId = t.customerId ? t.customerId.toString() : '';
            return !idsToCheck.includes(tCustId);
          }),
          currentPlanDetails: state.currentPlanDetails,
          aggregatedUsage: calculateRealtimeAggregatedUsage({
            ...state,
            customers: state.customers.filter(c => c.id !== action.payload),
            currentPlanDetails: state.currentPlanDetails
          })
        };
      }
      return state;

    case ActionTypes.SET_CUSTOMER_TRANSACTIONS:
      return {
        ...state,
        customerTransactions: action.payload
      };

    case ActionTypes.ADD_CUSTOMER_TRANSACTION: {
      // Check for rapid duplicates to prevent double-entries from rapid clicks or React double-renders
      const recentTransaction = state.customerTransactions.find(t => {
        if (!t || !t.createdAt) return false;
        const txDate = new Date(t.createdAt);
        const now = new Date();
        const timeDiff = Math.abs(now.getTime() - txDate.getTime());

        // If created in last 2 seconds and has same customer, type and amount
        return timeDiff < 2000 &&
          t.customerId === action.payload.customerId &&
          t.type === action.payload.type &&
          Math.abs((t.amount || 0) - (action.payload.amount || 0)) < 0.01;
      });

      if (recentTransaction) {
        console.warn('🚫 [ADD_CUSTOMER_TRANSACTION] BLOCKED - Duplicate transaction detected in state:', recentTransaction.id);
        return state;
      }

      const isSyncedRecord = action.payload?.isSynced === true || action.payload?.syncedAt;
      const newTransaction = {
        ...action.payload,
        isSynced: action.payload?.isSynced ?? false
      };

      // Use updateInIndexedDB (put) instead of addToIndexedDB (add) to handle ID conflicts gracefully
      updateInIndexedDB(STORES.customerTransactions, newTransaction)
        .then(() => {
          registerBackgroundSync();
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));

      return {
        ...state,
        customerTransactions: [newTransaction, ...state.customerTransactions]
      };
    }

    case ActionTypes.UPDATE_CUSTOMER_TRANSACTION: {
      const isFromSyncCallback = action.payload.syncedAt !== undefined;
      const updatedTransaction = {
        ...action.payload,
        isSynced: isFromSyncCallback ? true : false,
        isUpdate: isFromSyncCallback ? undefined : true,
        updatedAt: isFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      updateInIndexedDB(STORES.customerTransactions, updatedTransaction)
        .then(() => {
          registerBackgroundSync();
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));

      return {
        ...state,
        customerTransactions: state.customerTransactions.map(t =>
          (t.id === action.payload.id || t._id === action.payload.id || (action.payload._id && t._id === action.payload._id))
            ? updatedTransaction
            : t
        )
      };
    }

    case ActionTypes.DELETE_CUSTOMER_TRANSACTION: {
      const transactionToDelete = state.customerTransactions.find(t => t.id === action.payload || t._id === action.payload);
      if (transactionToDelete) {
        const deletedTransaction = {
          ...transactionToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false
        };

        updateInIndexedDB(STORES.customerTransactions, deletedTransaction, true)
          .then(() => {
            registerBackgroundSync();
            if (syncService.isOnline()) {
              syncService.scheduleSync(appStoreFunctions);
            }
            triggerSyncStatusUpdate();
          })
          .catch(err => console.error('IndexedDB update error:', err));

        return {
          ...state,
          customerTransactions: state.customerTransactions.filter(t => t.id !== action.payload && t._id !== action.payload)
        };
      }
      return state;
    }

    case ActionTypes.SET_PRODUCTS:
      //('🔄 REDUCER SET_PRODUCTS: Received products:', action.payload?.length || 0);
      //('🔄 REDUCER SET_PRODUCTS: Sample product:', action.payload?.[0]);
      //('🔄 REDUCER SET_PRODUCTS: Sample product batches:', action.payload?.[0]?.batches);

      // TEMPORARILY DISABLE arraysEqual check to force update
      // Only update if products array actually changed (prevent unnecessary re-renders)
      // if (arraysEqual(state.products, action.payload, 'products')) {
      //   //('🔄 REDUCER SET_PRODUCTS: Arrays equal, skipping update');
      //   return state;
      // }
      {
        const nextProducts = action.payload;
        //('🔄 REDUCER SET_PRODUCTS: Setting new products in state');
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        const newState = {
          ...state,
          products: nextProducts,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
        //('🔄 REDUCER SET_PRODUCTS: New state products sample:', newState.products?.[0]);
        //('🔄 REDUCER SET_PRODUCTS: New state products batches:', newState.products?.[0]?.batches);
        return newState;
      }

    case ActionTypes.SET_PRODUCT_BATCHES:
      return {
        ...state,
        productBatches: action.payload
      };

    case ActionTypes.ADD_PRODUCT_BATCH: {
      const newBatch = { ...action.payload, isSynced: action.payload.isSynced ?? false };
      // (Batch should already be in IndexedDB by component)
      // Trigger instant sync status update
      triggerSyncStatusUpdate();

      // Avoid adding duplicate to flat productBatches list
      const batchExistsInFlatList = (state.productBatches || []).some(b =>
        (b.id && b.id === newBatch.id) || (b._id && newBatch._id && b._id === newBatch._id)
      );

      let nextProductBatches = state.productBatches || [];
      if (!batchExistsInFlatList) {
        nextProductBatches = [newBatch, ...nextProductBatches];
      }

      return {
        ...state,
        productBatches: nextProductBatches,
        // ALSO add to the parent product's batches array for immediate UI consistency
        products: (state.products || []).map(product => {
          if (product.id === newBatch.productId || product._id === newBatch.productId) {
            // Check if batch already exists in product's batches array
            const batchExistsInProduct = (product.batches || []).some(b =>
              (b.id && b.id === newBatch.id) || (b._id && newBatch._id && b._id === newBatch._id)
            );

            if (batchExistsInProduct) {
              return product; // Already there, don't add again
            }

            return {
              ...product,
              batches: [newBatch, ...(product.batches || [])]
            };
          }
          return product;
        })
      };
    }

    case ActionTypes.UPDATE_PRODUCT_BATCH: {
      const isBatchFromSyncCallback = action.payload.syncedAt !== undefined;
      // Always trigger sync status update for visibility
      triggerSyncStatusUpdate();

      const updatedBatch = {
        ...action.payload,
        isSynced: isBatchFromSyncCallback ? true : false,
        updatedAt: isBatchFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      // Only update if batch actually changed (optimization)
      const existingBatch = (state.productBatches || []).find(b =>
        b.id === action.payload.id ||
        b._id === action.payload.id ||
        (action.payload._id && b._id === action.payload._id) ||
        (action.payload.localId && b.id === action.payload.localId)
      );

      if (existingBatch && JSON.stringify(existingBatch) === JSON.stringify(updatedBatch)) {
        return state; // No change needed
      }

      // Update state.productBatches (flat list for sync tracking)
      let nextProductBatches = state.productBatches || [];
      const batchIdx = nextProductBatches.findIndex(b =>
        b.id === action.payload.id ||
        b._id === action.payload.id ||
        (action.payload._id && b._id === action.payload._id) ||
        (action.payload.localId && b.id === action.payload.localId)
      );

      if (batchIdx === -1) {
        nextProductBatches = [updatedBatch, ...nextProductBatches];
      } else {
        nextProductBatches = nextProductBatches.map((batch, idx) =>
          idx === batchIdx ? updatedBatch : batch
        );
      }

      return {
        ...state,
        productBatches: nextProductBatches,
        // ALSO update the batch inside the parent product to reflect changes immediately in the UI
        products: (state.products || []).map(product => {
          if (product.id === action.payload.productId || product._id === action.payload.productId) {
            const productBatchesArr = product.batches || [];
            const pBatchIdx = productBatchesArr.findIndex(batch =>
              batch.id === action.payload.id ||
              batch._id === action.payload.id ||
              (action.payload._id && batch._id === action.payload._id) ||
              (action.payload.localId && batch.id === action.payload.localId)
            );

            let nextPBatches;
            if (pBatchIdx === -1) {
              nextPBatches = [updatedBatch, ...productBatchesArr];
            } else {
              nextPBatches = productBatchesArr.map((batch, idx) =>
                idx === pBatchIdx ? updatedBatch : batch
              );
            }

            return {
              ...product,
              batches: nextPBatches
            };
          }
          return product;
        })
      };
    }

    case ActionTypes.ADD_PRODUCT: {
      // Check for duplicate product (same name and description)
      const newProductName = (action.payload.name || '').trim().toLowerCase();
      const newProductDescription = (action.payload.description || '').trim().toLowerCase();

      // Find existing product with same name and description
      const duplicateProduct = state.products.find(p => {
        const existingName = (p.name || '').trim().toLowerCase();
        const existingDescription = (p.description || '').trim().toLowerCase();

        // Match if name is same and description is same (or both empty/null)
        return existingName === newProductName &&
          (existingDescription === newProductDescription ||
            (existingDescription === '' && newProductDescription === '') ||
            (existingDescription === null && newProductDescription === null) ||
            (existingDescription === undefined && newProductDescription === undefined));
      });

      if (duplicateProduct) {
        console.warn('⚠️ Duplicate product detected:', {
          name: action.payload.name,
          description: action.payload.description || 'No description',
          existingId: duplicateProduct.id
        });

        if (window.showToast) {
          window.showToast(
            `"${action.payload.name}" already exists. Edit the product to make changes.`,
            'warning'
          );
        }

        // Return state unchanged (don't add duplicate)
        return state;
      }

      // Step 1: Save to IndexedDB first with isSynced: false
      const isSyncedRecord = action.payload?.isSynced === true || action.payload?.syncedAt;

      if (!isSyncedRecord) {
        const capacity = checkPlanCapacity(state, 'product');
        if (!capacity.allowed) {
          if (window.showToast) {
            window.showToast(capacity.message, 'warning', 5000);
          }
          return state;
        }
      }

      const newProduct = {
        ...action.payload,
        isSynced: action.payload?.isSynced ?? false
      };

      addToIndexedDB(STORES.products, newProduct)
        .then(() => {
          registerBackgroundSync();
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update after IndexedDB save completes
          triggerSyncStatusUpdate();
        })
        .catch(err => {
          console.error('IndexedDB save error:', err);
          if (window.showToast) {
            window.showToast('Couldn\'t save product. Please try again.', 'error');
          }
        });
      {

        const nextProducts = [newProduct, ...state.products];
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        // const nextPlanDetails = !isSyncedRecord
        //   ? adjustPlanUsage(state.currentPlanDetails, { products: 1 })
        //   : state.currentPlanDetails;

        return {
          ...state,
          products: nextProducts,
          currentPlanDetails: state.currentPlanDetails,
          aggregatedUsage: calculateRealtimeAggregatedUsage({
            ...state,
            products: nextProducts,
            currentPlanDetails: state.currentPlanDetails
          }),
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
    }

    case ActionTypes.UPDATE_PRODUCT:
      // Distinguish between user edit and sync callback update
      const isProductFromSyncCallback = action.payload.syncedAt !== undefined;

      // If this is from a sync callback, trigger instant sync status update
      if (isProductFromSyncCallback) {
        triggerSyncStatusUpdate();
      }

      // Ensure id exists and is valid
      if (!action.payload.id) {
        console.error('❌ [UPDATE_PRODUCT] Product ID is missing!', action.payload);
        if (window.showToast) {
          window.showToast('Error: Product ID is missing. Cannot update product.', 'error');
        }
        return state;
      }

      // Find existing product in state FIRST to get the exact id type
      const existingProductInState = state.products.find(p =>
        p.id === action.payload.id ||
        String(p.id) === String(action.payload.id) ||
        (action.payload._id && p._id && String(p._id) === String(action.payload._id)) ||
        (action.payload.localId && (p.id === action.payload.localId || String(p.id) === String(action.payload.localId)))
      );

      if (!existingProductInState) {
        console.error('❌ [UPDATE_PRODUCT] Product not found in state! Cannot update:', {
          searchedId: action.payload.id,
          searchedMongoId: action.payload._id,
          totalProducts: state.products.length
        });
        return state; // Don't update if product doesn't exist in state
      }

      // CRITICAL: Use _id as id if it exists (matches what syncToIndexedDB does)
      // When backend syncs, it sets id: _id, so we need to match that
      // If no _id, use the original id
      const exactId = existingProductInState._id || existingProductInState.id;

      // Build updated product - use exact id from existing product
      // Explicitly preserve batches to ensure they don't get lost during sync updates
      const existingBatches = existingProductInState.batches || [];
      const { skipAutoSync, ...payloadData } = action.payload;
      const updatedProduct = {
        ...existingProductInState, // Start with existing product to preserve all fields
        ...payloadData, // Override with updated fields from form
        // Explicitly restore batches (in case they got overridden)
        // Use batches from payload if provided, otherwise preserve existing batches
        batches: action.payload.batches !== undefined ? action.payload.batches : existingBatches,
        // CRITICAL: Use _id as id if it exists (matches what syncToIndexedDB does)
        // This ensures the product matches what's in IndexedDB after backend sync
        id: exactId, // This is _id if exists, otherwise original id
        // Preserve _id if it exists
        _id: existingProductInState._id || action.payload._id,
        // If from sync callback, preserve isSynced: true
        // If batch update (flagged), preserve existing isSynced status to prevent dirtying parent
        // If user edit, ALWAYS set isSynced: false (so it syncs to MongoDB)
        isSynced: isProductFromSyncCallback
          ? true
          : (action.payload.isBatchUpdate ? existingProductInState.isSynced : false),
        // Add isUpdate flag only for user edits (not sync callbacks or batch updates)
        isUpdate: (isProductFromSyncCallback || action.payload.isBatchUpdate) ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isProductFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      // ('🔄 [UPDATE_PRODUCT] Updating product:', {
      //   id: updatedProduct.id,
      //   idType: typeof updatedProduct.id,
      //   originalId: existingProductInState.id,
      //   originalIdType: typeof existingProductInState.id,
      //   name: updatedProduct.name,
      //   quantity: updatedProduct.quantity,
      //   costPrice: updatedProduct.costPrice
      // });

      // Step 1: Verify product exists in IndexedDB BEFORE updating
      getAllItems(STORES.products)
        .then(existingProductsInDB => {
          // Find product in IndexedDB by id or _id
          const productInDB = existingProductsInDB.find(p =>
            p.id === exactId ||
            p._id === exactId ||
            (existingProductInState._id && p._id && String(p._id) === String(existingProductInState._id)) ||
            (existingProductInState.id && p.id === existingProductInState.id) ||
            (p.localId && (p.localId === exactId || String(p.localId) === String(exactId)))
          );

          if (!productInDB) {
            console.error('❌ [UPDATE_PRODUCT] Product NOT found in IndexedDB!', {
              searchedId: exactId,
              searchedIdType: typeof exactId,
              searchedMongoId: existingProductInState._id,
              totalProductsInDB: existingProductsInDB.length,
              sampleIds: existingProductsInDB.slice(0, 3).map(p => ({
                id: p.id,
                idType: typeof p.id,
                _id: p._id,
                name: p.name
              }))
            });
            throw new Error(`Product with id "${exactId}" not found in IndexedDB. Cannot update.`);
          }

          // Use the exact id from IndexedDB to ensure perfect matching
          const idFromDB = productInDB.id;
          updatedProduct.id = idFromDB; // Use IndexedDB's exact id

          // ('✅ [UPDATE_PRODUCT] Found product in IndexedDB, using exact id:', {
          //   idFromDB: idFromDB,
          //   idType: typeof idFromDB,
          //   name: productInDB.name
          // });

          // ('✅ [UPDATE_PRODUCT] Found product in IndexedDB:', {
          //   id: productInDB.id,
          //   idType: typeof productInDB.id,
          //   name: productInDB.name,
          //   matches: productInDB.id === exactId
          // });

          // Step 2: Save to IndexedDB (put() will update because id matches)
          return updateInIndexedDB(STORES.products, updatedProduct);
        })
        .then(() => {
          // ('✅ [UPDATE_PRODUCT] Product saved to IndexedDB successfully:', updatedProduct.id);

          // Step 3: Verify it was actually saved by reading it back
          return getAllItems(STORES.products);
        })
        .then(allProducts => {
          // Find saved product by id or _id
          const savedProduct = allProducts.find(p =>
            p.id === updatedProduct.id ||
            p._id === updatedProduct._id ||
            (existingProductInState._id && p._id && String(p._id) === String(existingProductInState._id)) ||
            (existingProductInState.id && p.id === existingProductInState.id)
          );
          if (savedProduct) {
            // ('✅ [UPDATE_PRODUCT] Verified product in IndexedDB after save:', {
            //   id: savedProduct.id,
            //   name: savedProduct.name,
            //   quantity: savedProduct.quantity,
            //   costPrice: savedProduct.costPrice,
            //   sellingPrice: savedProduct.sellingPrice,
            //   isSynced: savedProduct.isSynced
            // });

            // Verify the data actually changed
            if (savedProduct.name === updatedProduct.name &&
              savedProduct.quantity === updatedProduct.quantity) {
              //('✅ [UPDATE_PRODUCT] Product data verified - update successful!');
            } else {
              console.error('❌ [UPDATE_PRODUCT] Product data mismatch!', {
                expected: { name: updatedProduct.name, quantity: updatedProduct.quantity },
                actual: { name: savedProduct.name, quantity: savedProduct.quantity }
              });
            }
          } else {
            console.error('❌ [UPDATE_PRODUCT] Product NOT found in IndexedDB after save!', {
              searchedId: exactId,
              totalProducts: allProducts.length
            });
          }

          // Step 4: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline() && !action.payload.skipAutoSync) {
            syncService.scheduleSync(appStoreFunctions);
          }
        })
        .catch(err => {
          console.error('❌ [UPDATE_PRODUCT] IndexedDB save error:', err.message);
          console.error('Product data:', JSON.stringify(updatedProduct, null, 2));
          if (window.showToast) {
            window.showToast(`Couldn't update product: ${err.message}`, 'error');
          }
        });

      // Trigger instant sync status update
      triggerSyncStatusUpdate();

      // Step 3: Update state (optimistic update)
      // Match by both id and _id to ensure we replace, not add
      return {
        ...state,
        products: state.products.map(product => {
          // Match by id or _id
          const matches =
            product.id === exactId ||
            product._id === exactId ||
            (existingProductInState._id && product._id && String(product._id) === String(existingProductInState._id)) ||
            (existingProductInState.id && product.id === existingProductInState.id);

          return matches ? updatedProduct : product;
        })
      };

    case ActionTypes.SET_CURRENT_PRODUCT:
      return {
        ...state,
        currentProduct: action.payload
      };


    case ActionTypes.DELETE_PRODUCT_BATCH:
      triggerSyncStatusUpdate();
      return {
        ...state,
        productBatches: state.productBatches.filter(batch =>
          batch.id !== action.payload && batch._id !== action.payload
        ),
        // ALSO remove from the parent product's batches array for immediate UI consistency
        products: (state.products || []).map(product => ({
          ...product,
          batches: (product.batches || []).filter(batch =>
            batch.id !== action.payload && batch._id !== action.payload
          )
        }))
      };

    case ActionTypes.DELETE_PRODUCT:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const productToDelete = state.products.find(p => p.id === action.payload);
      if (productToDelete) {
        const deletedProduct = {
          ...productToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.products, deletedProduct, true) // Skip validation for soft delete
          .then(() => {
            //('✅ Product marked as deleted in IndexedDB:', action.payload);
            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.scheduleSync(appStoreFunctions);
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Product deleted.', 'success');
            }
          })
          .catch(err => {
            console.error('❌ IndexedDB update error:', err);
            if (window.showToast) {
              window.showToast('Couldn\'t delete product. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        const nextProducts = state.products.filter(p => p.id !== action.payload);
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        const nextPlanDetails = adjustPlanUsage(state.currentPlanDetails, { products: -1 });
        return {
          ...state,
          products: nextProducts,
          currentPlanDetails: nextPlanDetails,
          aggregatedUsage: nextPlanDetails?.planUsageSummary || state.aggregatedUsage,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
      return state;

    case ActionTypes.SET_PURCHASE_ORDERS:
      // Only update if purchaseOrders array actually changed (prevent unnecessary re-renders)
      if (arraysEqual(state.purchaseOrders, action.payload, 'purchaseOrders')) {
        return state;
      }
      return {
        ...state,
        purchaseOrders: action.payload
      };

    case ActionTypes.SET_ORDERS:
      // Mark all loaded orders as having stock already deducted (they came from backend/IndexedDB)
      // This prevents duplicate stock deduction when orders are loaded on page refresh
      //('🔧 [SET_ORDERS] Loading orders, marking all as stockDeducted: true');
      const ordersWithStockFlag = action.payload.map(order => {
        // Always mark loaded orders as having stock deducted (they're from backend/IndexedDB)
        // Only preserve false if explicitly set (shouldn't happen for loaded orders)
        const stockDeducted = order.stockDeducted === false ? false : true;
        //(`🔧 [SET_ORDERS] Order ${order.id}: stockDeducted=${order.stockDeducted} -> ${stockDeducted}`);
        return {
          ...order,
          stockDeducted: stockDeducted
        };
      });

      // Preserve unsynced orders from current state that aren't in fetched data
      // This ensures newly created orders appear immediately even if SET_ORDERS is called
      const fetchedOrderIds = new Set(ordersWithStockFlag.map(o => o.id || o._id).filter(Boolean));
      const unsyncedOrdersFromState = state.orders.filter(order => {
        const orderId = order.id || order._id;
        // Preserve orders that are unsynced and not in fetched data
        return orderId && !fetchedOrderIds.has(orderId) && (order.isSynced === false || order.isSynced === undefined);
      });

      // Merge fetched orders with unsynced orders from state
      const mergedOrders = [...ordersWithStockFlag, ...unsyncedOrdersFromState];

      // Sort by createdAt descending (newest first)
      mergedOrders.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
      });

      if (unsyncedOrdersFromState.length > 0) {
        //(`🔧 [SET_ORDERS] Preserving ${unsyncedOrdersFromState.length} unsynced orders from state`);
      }

      // Only update if orders array actually changed (prevent unnecessary re-renders)
      if (arraysEqual(state.orders, mergedOrders, 'orders')) {
        return state;
      }
      {
        const derived = recomputeDerivedData({ ...state, orders: mergedOrders });
        return {
          ...state,
          orders: mergedOrders,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }

    case ActionTypes.ADD_ORDER: {
      // Only log critical order creation info
      //('🎯 ADD_ORDER: Order ID:', action.payload.id, 'Total:', action.payload.totalAmount);
      const isSyncedRecord = action.payload?.isSynced === true || action.payload?.syncedAt;

      if (!isSyncedRecord) {
        const capacity = checkPlanCapacity(state, 'order');
        if (!capacity.allowed) {
          if (window.showToast) {
            window.showToast(capacity.message, 'warning', 5000);
          }
          console.warn('🚫 [ADD_ORDER] BLOCKED - Plan limit reached, preventing IndexedDB write.');
          return state;
        }
      }

      const newOrder = {
        ...action.payload,
        isSynced: action.payload?.isSynced ?? false
      };

      // Validate order has all required fields before saving
      if (!newOrder.id) {
        console.error('❌ Order validation failed: id is missing');
        if (window.showToast) {
          window.showToast('Order creation failed: Missing order ID', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.sellerId) {
        console.error('❌ Order validation failed: sellerId is missing');
        if (window.showToast) {
          window.showToast('Order creation failed: User not authenticated', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.items || newOrder.items.length === 0) {
        console.error('❌ Order validation failed: items array is empty');
        if (window.showToast) {
          window.showToast('Order creation failed: No items in order', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.totalAmount || newOrder.totalAmount <= 0) {
        console.error('❌ Order validation failed: totalAmount is invalid:', newOrder.totalAmount);
        if (window.showToast) {
          window.showToast('Order creation failed: Invalid total amount', 'error');
        }
        return state; // Don't update state if validation fails
      }

      // Skip validation for now since we already validated above
      // But we need to ensure costPrice is a number for each item
      const validatedOrder = {
        ...newOrder,
        // Ensure stockDeducted flag is preserved (default to false for new orders, true for synced orders)
        stockDeducted: newOrder.stockDeducted !== undefined ? newOrder.stockDeducted : (isSyncedRecord ? true : false),
        // Ensure dueAdded flag is preserved (default to false for new orders, true for synced orders)
        dueAdded: newOrder.dueAdded !== undefined ? newOrder.dueAdded : (isSyncedRecord ? true : false),
        items: newOrder.items.map(item => ({
          ...item,
          costPrice: typeof item.costPrice === 'number' ? item.costPrice : 0,
          sellingPrice: typeof item.sellingPrice === 'number' ? item.sellingPrice : 0,
          quantity: typeof item.quantity === 'number' ? item.quantity : 1
        }))
      };

      // Create order hash for duplicate detection
      const orderHash = createOrderHash(validatedOrder);
      //('🔑 [ADD_ORDER] Order hash created:', orderHash.substring(0, 50) + '...');

      // (Pending API calls logic removed for debounced sync)


      // Check if we just added an identical order in the last 5 seconds (state check)
      // This catches React Strict Mode double renders
      const recentOrder = state.orders.find(o => {
        if (!o || !o.createdAt) return false;
        const orderDate = new Date(o.createdAt);
        const now = new Date();
        const timeDiff = now.getTime() - orderDate.getTime();
        // Check if order was created in last 500ms (reduced from 1s to allow very fast separate entries)
        if (timeDiff > 500) return false;

        // Check if order has same hash
        const existingHash = createOrderHash(o);
        return existingHash === orderHash;
      });

      if (recentOrder) {
        console.warn('🚫 [ADD_ORDER] BLOCKED - Duplicate order detected in state (created within 5s):', recentOrder.id);
        console.warn('🚫 [ADD_ORDER] Current order ID:', validatedOrder.id);
        console.warn('🚫 [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
        // Don't process this duplicate order
        return state;
      }

      // Save to IndexedDB FIRST (always save locally)
      //('💾 Attempting to save order to IndexedDB...', validatedOrder.id);
      //('💾 Order data being saved:', JSON.stringify(validatedOrder, null, 2));

      updateInIndexedDB(STORES.orders, validatedOrder, true) // Skip validation since we validated above
        .then(async (result) => {
          // Register for background sync immediately after saving to IDB
          registerBackgroundSync();
          //('✅ Order successfully saved to IndexedDB!', validatedOrder.id, result);


          // IMMEDIATELY update inventory after order is saved to IndexedDB (works offline)
          //('📦 Updating inventory immediately after order save...');

          try {
            const inventoryResult = await updateInventoryAfterSale(validatedOrder);
            //('📦 Inventory update result:', inventoryResult);
            if (!inventoryResult.success) {
              console.error('❌ Failed to update inventory:', inventoryResult.error);
            } else {
              //('✅ Inventory updated successfully for order:', validatedOrder.id);

              // Update order in IDB to set stockDeducted: true
              // This confirms local deduction succeeded, preventing double deduction by backend on sync
              try {
                const orderWithStockDeducted = { ...validatedOrder, stockDeducted: true };
                // Use true to skip validation as we just want to update the flag
                await updateInIndexedDB(STORES.orders, orderWithStockDeducted, true);
                console.log('✅ Order marked as stockDeducted: true in IDB');
              } catch (flagErr) {
                console.error('⚠️ Failed to update stockDeducted flag, but inventory was updated:', flagErr);
                // Non-critical: Backend might double deduct if sync happens, but Frontend Batch Update will overwrite it.
                // Given Batch Update comes after Order Sync, consistency is likely preserved.
              }

              // REFRESH UI: Reload products and batches to show updated quantities
              //('🔄 Refreshing UI after inventory update...');
            }
          } catch (inventoryError) {
            console.error('❌ Exception updating inventory:', inventoryError);
          }

          // Verify order was saved
          setTimeout(async () => {
            try {
              const allOrders = await getAllItems(STORES.orders);
              const savedOrder = allOrders.find(o => o.id === validatedOrder.id || o.id?.toString() === validatedOrder.id?.toString());
              if (savedOrder) {
                //('✅ Verified: Order exists in IndexedDB', savedOrder.id);
              } else {
                console.error('❌ WARNING: Order not found in IndexedDB after save!', validatedOrder.id);
                console.error('❌ All orders in IndexedDB:', allOrders.map(o => ({ id: o.id, _id: o._id })));
              }
            } catch (verifyErr) {
              console.error('Error verifying order in IndexedDB:', verifyErr);
            }
          }, 100);

          // Step 2: Sync to backend if online (Debounced)
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
        })
        .catch(err => {
          console.error('❌ IndexedDB save error:', err);
          console.error('Error message:', err.message);
          console.error('Error stack:', err.stack);
          console.error('Error name:', err.name);
          console.error('Order data that failed:', JSON.stringify(validatedOrder, null, 2));

          // Check if it's a validation error
          if (err.message && err.message.includes('Validation failed')) {
            console.error('❌ VALIDATION ERROR - Order validation failed!');
            console.error('Order details:', {
              id: newOrder.id,
              sellerId: newOrder.sellerId,
              itemsCount: newOrder.items?.length,
              totalAmount: newOrder.totalAmount,
              paymentMethod: newOrder.paymentMethod
            });
          }

          if (window.showToast) {
            window.showToast(`Failed to save order: ${err.message}`, 'error');
          }
        });

      // Update state immediately (optimistic update)
      // Note: If save fails, the order will still be in state temporarily
      // but won't be in IndexedDB. The user will see an error message.
      // The order will be updated with _id and isSynced: true after successful backend sync
      // via the IndexedDB update callback above
      {
        const nextOrders = [validatedOrder, ...state.orders];
        const derived = recomputeDerivedData({ ...state, orders: nextOrders });
        triggerSyncStatusUpdate();

        // Patch local plan details cache for immediate offline availability
        const sellerId = state.currentUser?.sellerId || state.currentUser?.id || state.currentUser?._id || state.sellerId;
        if (sellerId) {
          getAllItems(STORES.planDetails).then(cached => {
            const record = cached.find(r => r.sellerId === sellerId);
            if (record && record.data) {
              // Update nested summary
              if (record.data.planUsageSummary?.orders) {
                record.data.planUsageSummary.orders.used = (record.data.planUsageSummary.orders.used || 0) + 1;
              }
              // Update legacy top-level counts to keep everything in sync
              if (typeof record.data.ordersCount === 'number') record.data.ordersCount++;
              if (typeof record.data.orderCurrentCount === 'number') record.data.orderCurrentCount++;

              updateInIndexedDB(STORES.planDetails, record).catch(e => console.warn('Failed to patch local plan usage for order', e));
            }
          });
        }
        // const nextPlanDetails = !isSyncedRecord
        //   ? adjustPlanUsage(state.currentPlanDetails, { orders: 1 })
        //   : state.currentPlanDetails;

        return {
          ...state,
          orders: nextOrders,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          currentPlanDetails: state.currentPlanDetails,
          aggregatedUsage: calculateRealtimeAggregatedUsage({
            ...state,
            orders: nextOrders,
            currentPlanDetails: state.currentPlanDetails
          }),
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
    }

    case ActionTypes.UPDATE_ORDER:
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isOrderFromSyncCallback = action.payload.syncedAt !== undefined;

      // If this is from a sync callback, trigger instant sync status update
      if (isOrderFromSyncCallback) {
        triggerSyncStatusUpdate();
      }

      const updatedOrder = {
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isOrderFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isOrderFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isOrderFromSyncCallback ? action.payload.updatedAt : new Date().toISOString(),
        // Preserve stockDeducted flag - if from sync, it should already be true
        stockDeducted: action.payload.stockDeducted !== undefined ? action.payload.stockDeducted : (isOrderFromSyncCallback ? true : action.payload.stockDeducted)
      };
      updateInIndexedDB(STORES.orders, updatedOrder)
        .then(() => {
          // Only sync if order is not already synced
          if (!updatedOrder.isSynced && syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }

          // Also patch the planDetails aggregated usage for immediate UI feedback if possible
          // This is an optimization for offline usage updates
          const sellerId = state.currentUser?.sellerId || state.currentUser?.id || state.currentUser?._id || state.sellerId;
          if (sellerId) {
            getAllItems(STORES.planDetails).then(cached => {
              const record = cached.find(r => r.sellerId === sellerId);
              if (record && record.data?.planUsageSummary?.orders) {
                // Simply increment used count in cache for consistency
                // Note: This is an approximation; full recalc happens in reducer
                // We do this to ensure next app load (if offline) sees somewhat updated data
                // record.data.planUsageSummary.orders.used += 0; // No-op, rely on reducer logic mainly
              }
            }).catch(() => { });
          }
        })
        .catch(err => {
          console.error('IndexedDB update error:', err.message);
        });

      // Find existing order by id or _id (handle both cases)
      const existingOrder = state.orders.find(order =>
        order.id === action.payload.id ||
        order._id === action.payload.id ||
        order.id === action.payload._id ||
        order._id === action.payload._id ||
        (action.payload.localId && (order.id === action.payload.localId || order._id === action.payload.localId))
      );

      // If order doesn't exist, add it (important for orders created online)
      if (!existingOrder) {
        //('🔄 [UPDATE_ORDER] Order not found in state, adding it:', action.payload.id || action.payload._id);
        const nextOrders = [updatedOrder, ...state.orders];
        const derivedForNew = recomputeDerivedData({ ...state, orders: nextOrders });
        return {
          ...state,
          orders: nextOrders,
          salesChartData: derivedForNew.salesChartData || state.salesChartData,
          profitChartData: derivedForNew.profitChartData || state.profitChartData,
          inventoryChartData: derivedForNew.inventoryChartData || state.inventoryChartData,
          dashboardTotals: derivedForNew.totals || state.dashboardTotals
        };
      }

      // Order exists, check if it actually changed
      if (JSON.stringify(existingOrder) === JSON.stringify(updatedOrder)) {
        return state; // No change
      }

      // Update existing order
      const nextOrders = state.orders.map(order =>
        (order.id === action.payload.id ||
          order._id === action.payload.id ||
          order.id === action.payload._id ||
          order._id === action.payload._id ||
          (action.payload.localId && order.id === action.payload.localId))
          ? updatedOrder
          : order
      );
      const derivedForUpdate = recomputeDerivedData({ ...state, orders: nextOrders });
      return {
        ...state,
        orders: nextOrders,
        salesChartData: derivedForUpdate.salesChartData || state.salesChartData,
        profitChartData: derivedForUpdate.profitChartData || state.profitChartData,
        inventoryChartData: derivedForUpdate.inventoryChartData || state.inventoryChartData,
        dashboardTotals: derivedForUpdate.totals || state.dashboardTotals
      };

    case ActionTypes.DELETE_ORDER:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const orderToDelete = state.orders.find(o => o.id === action.payload || o._id === action.payload);
      if (orderToDelete) {
        const deletedOrder = {
          ...orderToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.orders, deletedOrder, true) // Skip validation for soft delete
          .then(() => {
            //('✅ Order marked as deleted in IndexedDB:', action.payload);
            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.scheduleSync(appStoreFunctions);
            }
            // Trigger instant sync status update
            triggerSyncStatusUpdate();
            // Show success toast
            if (window.showToast) {
              window.showToast('Order deleted.', 'success');
            }
          })
          .catch(err => {
            console.error('❌ IndexedDB update error:', err);
            if (window.showToast) {
              window.showToast('Couldn\'t delete order. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        const nextOrders = state.orders.filter(o => o.id !== action.payload);
        const derived = recomputeDerivedData({ ...state, orders: nextOrders });
        return {
          ...state,
          orders: nextOrders,
          currentPlanDetails: adjustPlanUsage(state.currentPlanDetails, { orders: -1 }),
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
      return state;

    case ActionTypes.ADD_PURCHASE_ORDER:
      // Step 1: Save to IndexedDB first with isSynced: false
      const newPO = { ...action.payload, isSynced: false };
      addToIndexedDB(STORES.purchaseOrders, newPO)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));
      return {
        ...state,
        purchaseOrders: [newPO, ...state.purchaseOrders]
      };

    case ActionTypes.UPDATE_PURCHASE_ORDER:
      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isPOFromSyncCallback = action.payload.syncedAt !== undefined;

      // Always trigger sync status update for visibility
      triggerSyncStatusUpdate();

      const updatedPO = {
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isPOFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isPOFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isPOFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };
      updateInIndexedDB(STORES.purchaseOrders, updatedPO)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast('Couldn\'t update purchase order. Please try again.', 'error');
          }
        });
      // Only update if purchase order actually changed
      const existingPO = state.purchaseOrders.find(po =>
        po.id === action.payload.id ||
        po._id === action.payload.id ||
        (action.payload._id && po._id === action.payload._id) ||
        (action.payload.localId && po.id === action.payload.localId)
      );

      if (existingPO && JSON.stringify(existingPO) === JSON.stringify(updatedPO)) {
        return state; // No change
      }
      return {
        ...state,
        purchaseOrders: state.purchaseOrders.map(po =>
          (po.id === action.payload.id ||
            po._id === action.payload.id ||
            (action.payload._id && po._id === action.payload._id) ||
            (action.payload.localId && po.id === action.payload.localId))
            ? updatedPO
            : po
        )
      };

    case ActionTypes.DELETE_PURCHASE_ORDER:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const poToDelete = state.purchaseOrders.find(po => po.id === action.payload);
      if (poToDelete) {
        const deletedPO = {
          ...poToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        //('🗑️ [DELETE_PURCHASE_ORDER] Marking purchase order as deleted:', deletedPO.id);
        //('🗑️ [DELETE_PURCHASE_ORDER] Deleted PO data:', JSON.stringify(deletedPO, null, 2));

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.purchaseOrders, deletedPO, true) // Skip validation for soft delete
          .then(() => {
            //('✅ [DELETE_PURCHASE_ORDER] Purchase order marked as deleted in IndexedDB');
            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              //('🌐 [DELETE_PURCHASE_ORDER] Online - scheduling deletion sync...');
              syncService.scheduleSync(appStoreFunctions);
            } else {
              //('📴 [DELETE_PURCHASE_ORDER] Offline - deletion will sync when online');
            }
            // Trigger instant sync status update
            triggerSyncStatusUpdate();
            // Show success toast
            if (window.showToast) {
              window.showToast('Purchase order deleted.', 'success');
            }
          })
          .catch(err => {
            console.error('❌ [DELETE_PURCHASE_ORDER] IndexedDB update error:', err);
            if (window.showToast) {
              window.showToast('Couldn\'t delete purchase order. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        return {
          ...state,
          purchaseOrders: state.purchaseOrders.filter(po => po.id !== action.payload)
        };
      }
      return state;

    case ActionTypes.SET_TRANSACTIONS:
      // Only update if transactions array actually changed (prevent unnecessary re-renders)
      if (arraysEqual(state.transactions, action.payload, 'transactions')) {
        return state;
      }
      return {
        ...state,
        transactions: action.payload
      };

    case ActionTypes.ADD_TRANSACTION:
      // Step 1: Save to IndexedDB first with isSynced: false
      const newTransaction = { ...action.payload, isSynced: false };
      addToIndexedDB(STORES.transactions, newTransaction)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));
      return {
        ...state,
        transactions: [newTransaction, ...state.transactions]
      };

    case ActionTypes.UPDATE_TRANSACTION:
      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isTxFromSyncCallback = action.payload.syncedAt !== undefined;

      // Always trigger sync status update for visibility
      triggerSyncStatusUpdate();

      const updatedTransaction = {
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isTxFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isTxFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isTxFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };
      updateInIndexedDB(STORES.transactions, updatedTransaction)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast('Couldn\'t update transaction. Please try again.', 'error');
          }
        });
      // Only update if transaction actually changed
      const existingTransaction = state.transactions.find(t =>
        t.id === action.payload.id ||
        t._id === action.payload.id ||
        (action.payload._id && t._id === action.payload._id) ||
        (action.payload.localId && t.id === action.payload.localId)
      );

      if (existingTransaction && JSON.stringify(existingTransaction) === JSON.stringify(updatedTransaction)) {
        return state; // No change
      }
      return {
        ...state,
        transactions: state.transactions.map(transaction =>
          (transaction.id === action.payload.id ||
            transaction._id === action.payload.id ||
            (action.payload._id && transaction._id === action.payload._id) ||
            (action.payload.localId && transaction.id === action.payload.localId))
            ? updatedTransaction
            : transaction
        )
      };

    case ActionTypes.SET_ACTIVITIES: {
      const normalizedActivities = (action.payload || []).map(activity => {
        const { isSynced, ...rest } = activity || {};
        return rest;
      });
      return {
        ...state,
        activities: normalizedActivities
      };
    }

    case ActionTypes.ADD_ACTIVITY:
      // Sync to IndexedDB
      const activityToStore = { ...action.payload };
      delete activityToStore.isSynced;
      addToIndexedDB(STORES.activities, activityToStore).catch(err => console.error('IndexedDB sync error:', err));
      return {
        ...state,
        activities: [activityToStore, ...state.activities]
      };

    case ActionTypes.SET_CATEGORIES:
      // Only update if categories array actually changed (prevent unnecessary re-renders)
      if (arraysEqual(state.categories, action.payload, 'categories')) {
        return state;
      }
      return {
        ...state,
        categories: action.payload
      };

    case ActionTypes.ADD_CATEGORY:
      // Step 1: Save to IndexedDB first with isSynced: false
      const newCategory = { ...action.payload, isSynced: false };
      addToIndexedDB(STORES.categories, newCategory)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));
      return {
        ...state,
        categories: [newCategory, ...state.categories]
      };

    case ActionTypes.UPDATE_CATEGORY:
      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isCategoryFromSyncCallback = action.payload.syncedAt !== undefined;

      // Always trigger sync status update for visibility
      triggerSyncStatusUpdate();

      const updatedCategory = {
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isCategoryFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isCategoryFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isCategoryFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      updateInIndexedDB(STORES.categories, updatedCategory)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.scheduleSync(appStoreFunctions);
          }
          // Trigger instant sync status update
          triggerSyncStatusUpdate();
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast(`Failed to update category: ${err.message}`, 'error');
          }
        });

      // Only update if category actually changed
      const existingCategory = state.categories.find(c =>
        c.id === action.payload.id ||
        c._id === action.payload.id ||
        (action.payload._id && c._id === action.payload._id) ||
        (action.payload.localId && (c.id === action.payload.localId || c._id === action.payload._id))
      );
      if (existingCategory && JSON.stringify(existingCategory) === JSON.stringify(updatedCategory)) {
        return state; // No change
      }

      return {
        ...state,
        categories: state.categories.map(category =>
          category.id === action.payload.id ? updatedCategory : category
        )
      };

    case ActionTypes.DELETE_CATEGORY:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const categoryToDelete = state.categories.find(c => c.id === action.payload);
      if (categoryToDelete) {
        const deletedCategory = {
          ...categoryToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.categories, deletedCategory, true) // Skip validation for soft delete
          .then(() => {
            //('✅ Category marked as deleted in IndexedDB:', action.payload);
            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.scheduleSync(appStoreFunctions);
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Category deleted successfully', 'success');
            }
          })
          .catch(err => {
            console.error('❌ IndexedDB update error:', err);
            if (window.showToast) {
              window.showToast('Failed to delete category: ' + err.message, 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        return {
          ...state,
          categories: state.categories.filter(c => c.id !== action.payload)
        };
      }
      return state;

    case ActionTypes.SET_CURRENT_VIEW:
      return {
        ...state,
        currentView: action.payload
      };

    case ActionTypes.SET_LISTENING:
      return {
        ...state,
        isListening: action.payload
      };

    case ActionTypes.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload
      };

    case ActionTypes.FORCE_REFRESH:
      return {
        ...state,
        refreshTrigger: Date.now() // This will force re-render
      };

    case ActionTypes.SET_CUSTOMER_PAGE:
      return {
        ...state,
        customerCurrentPage: action.payload
      };

    case ActionTypes.SET_PRODUCT_PAGE:
      return {
        ...state,
        productCurrentPage: action.payload
      };

    case ActionTypes.SET_BILL_ITEMS:
      return {
        ...state,
        currentBillItems: action.payload
      };

    case ActionTypes.ADD_BILL_ITEM:
      return {
        ...state,
        currentBillItems: [...state.currentBillItems, action.payload]
      };

    case ActionTypes.REMOVE_BILL_ITEM:
      return {
        ...state,
        currentBillItems: state.currentBillItems.filter((_, index) => index !== action.payload)
      };

    case ActionTypes.CLEAR_BILL_ITEMS:
      return {
        ...state,
        currentBillItems: []
      };

    case ActionTypes.SET_BILLING_DRAFT:
      return {
        ...state,
        billingDraft: action.payload || null
      };

    case ActionTypes.SET_PO_ITEMS:
      return {
        ...state,
        currentPOItems: action.payload
      };

    case ActionTypes.ADD_PO_ITEM:
      return {
        ...state,
        currentPOItems: [...state.currentPOItems, action.payload]
      };

    case ActionTypes.REMOVE_PO_ITEM:
      return {
        ...state,
        currentPOItems: state.currentPOItems.filter((_, index) => index !== action.payload)
      };

    case ActionTypes.CLEAR_PO_ITEMS:
      return {
        ...state,
        currentPOItems: []
      };

    case ActionTypes.SET_REFUNDS: {
      // Preserve unsynced refunds
      const fetchedRefundIds = new Set(action.payload.map(r => r.id || r._id).filter(Boolean));
      const unsyncedRefunds = (state.refunds || []).filter(r => {
        const id = r.id || r._id;
        return id && !fetchedRefundIds.has(id) && r.isSynced === false;
      });

      const mergedRefunds = [...action.payload, ...unsyncedRefunds];
      mergedRefunds.sort((a, b) => {
        const dA = new Date(a.date || a.createdAt || 0).getTime();
        const dB = new Date(b.date || b.createdAt || 0).getTime();
        return dB - dA;
      });

      return {
        ...state,
        refunds: mergedRefunds
      };
    }

    case ActionTypes.ADD_REFUND:
      triggerSyncStatusUpdate();
      return {
        ...state,
        refunds: [action.payload, ...(state.refunds || [])]
      };

    case ActionTypes.UPDATE_REFUND:
      triggerSyncStatusUpdate();
      return {
        ...state,
        refunds: (state.refunds || []).map(ref =>
          (ref.id === action.payload.id || ref._id === action.payload.id || (action.payload._id && ref._id === action.payload._id))
            ? { ...ref, ...action.payload }
            : ref
        )
      };

    case ActionTypes.DELETE_REFUND:
      triggerSyncStatusUpdate();
      return {
        ...state,
        refunds: (state.refunds || []).filter(ref =>
          ref.id !== action.payload && ref._id !== action.payload
        )
      };

    case ActionTypes.SET_EXPENSES: {
      // Preserve unsynced expenses from current state that aren't in fetched data
      const fetchedExpenseIds = new Set(action.payload.map(e => e.id || e._id).filter(Boolean));
      const unsyncedExpenses = (state.expenses || []).filter(e => {
        const id = e.id || e._id;
        // Keep if it's not in fetched list, AND it is unsynced (local only)
        return id && !fetchedExpenseIds.has(id) && e.isSynced === false;
      });

      const mergedExpenses = [...action.payload, ...unsyncedExpenses];

      // Sort by date desc
      mergedExpenses.sort((a, b) => {
        const dA = new Date(a.date || a.createdAt || 0).getTime();
        const dB = new Date(b.date || b.createdAt || 0).getTime();
        return dB - dA;
      });

      return {
        ...state,
        expenses: mergedExpenses
      };
    }

    case ActionTypes.ADD_EXPENSE:
      triggerSyncStatusUpdate();
      return {
        ...state,
        expenses: [action.payload, ...(state.expenses || [])]
      };

    case ActionTypes.UPDATE_EXPENSE:
      triggerSyncStatusUpdate();
      return {
        ...state,
        expenses: (state.expenses || []).map(exp =>
          (exp.id === action.payload.id || exp._id === action.payload.id || (action.payload._id && exp._id === action.payload._id) || (action.payload.localId && exp.id === action.payload.localId))
            ? { ...exp, ...action.payload }
            : exp
        )
      };

    case ActionTypes.DELETE_EXPENSE:
      triggerSyncStatusUpdate();
      return {
        ...state,
        expenses: (state.expenses || []).filter(exp =>
          exp.id !== action.payload && exp._id !== action.payload
        )
      };

    case ActionTypes.SET_LOW_STOCK_THRESHOLD:
      return {
        ...state,
        lowStockThreshold: action.payload
      };

    case ActionTypes.SET_EXPIRY_DAYS_THRESHOLD:
      return {
        ...state,
        expiryDaysThreshold: action.payload
      };

    case ActionTypes.SET_SUBSCRIPTION_DAYS:
      return {
        ...state,
        subscriptionDays: action.payload
      };

    case ActionTypes.SET_SUBSCRIPTION_ACTIVE:
      return {
        ...state,
        isSubscriptionActive: action.payload
      };

    case ActionTypes.SET_SCANNER_ACTIVE:
      return {
        ...state,
        isScannerActive: action.payload
      };

    case ActionTypes.SET_SCANNER_TYPE:
      return {
        ...state,
        scannerType: action.payload
      };

    case ActionTypes.SET_SALES_CHART_DATA:
      return {
        ...state,
        salesChartData: action.payload
      };

    case ActionTypes.SET_PROFIT_CHART_DATA:
      return {
        ...state,
        profitChartData: action.payload
      };

    case ActionTypes.SET_INVENTORY_CHART_DATA:
      return {
        ...state,
        inventoryChartData: action.payload
      };

    case ActionTypes.SET_CUSTOMER_CHART_DATA:
      return {
        ...state,
        customerChartData: action.payload
      };

    case ActionTypes.UPDATE_CURRENT_TIME:
      // Only update if time actually changed (prevent unnecessary re-renders)
      if (state.currentTime === action.payload) {
        return state; // No change, return same state reference
      }
      return {
        ...state,
        currentTime: action.payload
      };

    case ActionTypes.SET_SYSTEM_STATUS:
      // Only update if status actually changed (prevent unnecessary re-renders)
      if (state.systemStatus === action.payload) {
        return state; // No change, return same state reference
      }
      return {
        ...state,
        systemStatus: action.payload
      };

    case ActionTypes.SET_DATA_FRESHNESS:
      return {
        ...state,
        dataFreshness: action.payload.freshness || 'loading',
        dataLastSynced: action.payload.lastSynced || state.dataLastSynced
      };

    case ActionTypes.SET_GST_NUMBER:
      return {
        ...state,
        gstNumber: action.payload
      };

    case ActionTypes.SET_STORE_NAME:
      return {
        ...state,
        storeName: action.payload
      };

    case ActionTypes.SET_UPI_ID: {
      const nextUpi = action.payload || '';
      const authRaw = localStorage.getItem('auth');
      if (authRaw) {
        try {
          const auth = JSON.parse(authRaw);
          if (auth.currentUser) {
            auth.currentUser = { ...auth.currentUser, upiId: nextUpi };
          }
          localStorage.setItem('auth', JSON.stringify(auth));
        } catch (e) {
          console.error('Error updating UPI ID in auth storage:', e);
        }
      }
      return {
        ...state,
        upiId: nextUpi,
        currentUser: state.currentUser ? { ...state.currentUser, upiId: nextUpi } : state.currentUser
      };
    }

    case ActionTypes.UPDATE_USER: {
      const updatedUser = action.payload;
      const authRaw = localStorage.getItem('auth');
      if (authRaw) {
        try {
          const auth = JSON.parse(authRaw);
          auth.currentUser = updatedUser;
          if (updatedUser?.sellerId) {
            auth.sellerId = updatedUser.sellerId;
          }
          localStorage.setItem('auth', JSON.stringify(auth));
        } catch (e) {
          console.error('Error updating user in auth storage:', e);
        }
      }
      return {
        ...state,
        currentUser: updatedUser,
        upiId: updatedUser?.upiId !== undefined ? (updatedUser.upiId || '') : state.upiId
      };
    }

    case ActionTypes.SET_CURRENCY_FORMAT:
      return {
        ...state,
        currencyFormat: action.payload
      };

    case ActionTypes.SET_VOICE_ASSISTANT_LANGUAGE:
      return {
        ...state,
        voiceAssistantLanguage: action.payload
      };

    case ActionTypes.SET_VOICE_ASSISTANT_ENABLED:
      return {
        ...state,
        voiceAssistantEnabled: action.payload
      };

    case ActionTypes.PLAN_BOOTSTRAP_START: {
      if (state.planBootstrap?.isActive || state.planBootstrap?.hasCompleted) {
        return state;
      }
      return {
        ...state,
        planBootstrap: {
          isActive: true,
          hasCompleted: false,
          startedAt: Date.now(),
          completedAt: null
        }
      };
    }

    case ActionTypes.PLAN_BOOTSTRAP_COMPLETE: {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(PLAN_LOADER_SESSION_KEY, 'true');
      }
      if (state.planBootstrap?.hasCompleted && !state.planBootstrap?.isActive) {
        return state;
      }
      return {
        ...state,
        planBootstrap: {
          isActive: false,
          hasCompleted: true,
          startedAt: state.planBootstrap?.startedAt || null,
          completedAt: Date.now()
        }
      };
    }

    case ActionTypes.PLAN_BOOTSTRAP_RESET: {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PLAN_LOADER_SESSION_KEY);
      }
      return {
        ...state,
        planBootstrap: {
          isActive: false,
          hasCompleted: false,
          startedAt: null,
          completedAt: null
        }
      };
    }

    default:
      if (action.type === 'ADD_ORDER' || action.type === 'FORCE_REFRESH') {
        // FORCE_REFRESH is expected to not have a case, but ADD_ORDER should have one
        if (action.type === 'ADD_ORDER') {
          console.error('❌ ADD_ORDER action reached default case! This means the case is not matching!');
          console.error('ActionTypes.ADD_ORDER:', ActionTypes.ADD_ORDER);
          console.error('action.type:', action.type);
          console.error('Are they equal?', action.type === ActionTypes.ADD_ORDER);
        }
      }
      return state;
  }
};

// Create context
const AppContext = createContext();

// Provider component
export const AppProvider = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const autoPlanSwitchState = useRef({
    inFlight: false, // For plan switching
    refreshing: false, // For auto-refresh checks
    lastAttemptKey: null,
    lastAttemptAt: 0,
    lastRefreshAt: 0,
    planDetailsInFlight: false, // For refreshCurrentPlanDetails
    lastPlanDetailsRefresh: 0   // For refreshCurrentPlanDetails
  });
  const upgradePromptState = useRef({
    lastTriggered: 0,
    hasShown: false
  });
  const lastSavedPlanDetailsRef = useRef({
    sellerId: null,
    hash: null
  });

  // Helper to provide IDB functions to sync service (renamed from implicit appStoreFunctions to avoid conflicts)
  const appStoreFunctions = useCallback((storeName) => {
    // Map store names to IndexedDB store constants
    const storeMap = {
      'products': STORES.products,
      'productBatches': STORES.productBatches,
      'orders': STORES.orders,
      'customers': STORES.customers,
      'transactions': STORES.transactions,
      'purchaseOrders': STORES.purchaseOrders,
      'categories': STORES.categories,
      'refunds': STORES.refunds,
      'expenses': STORES.expenses,
      'customerTransactions': STORES.customerTransactions // Added support for customer transactions
    };

    const storeConstant = storeMap[storeName];
    if (!storeConstant) return null;

    return {
      getAllItems: () => getAllItems(storeConstant),
      updateItem: (item) => updateInIndexedDB(storeConstant, item), // Uses updateInIndexedDB which handles put/add
      deleteItem: (id) => deleteFromIndexedDB(storeConstant, id)
    };
  }, []);

  // Track loadData calls
  let loadDataCallCount = 0;

  // Load data function (defined outside useEffect for manualRefresh access)
  const loadData = useCallback(async () => {
    // Prevent multiple simultaneous loadData calls
    if (window.loadDataInProgress) {
      console.log(`[LOAD DATA] Another loadData call is already in progress, skipping this call (flag: ${window.loadDataInProgress})`);
      return;
    }

    // Debounce: Skip if fully loaded very recently (< 2000ms)
    // This catches rapid re-renders or double-mounts
    const now = Date.now();
    if (state.lastDataLoadTime && (now - state.lastDataLoadTime < 2000)) {
      // console.log(`[LOAD DATA] Skipped redundant load (executed < 2s ago)`);
      return;
    }

    window.loadDataInProgress = true;
    console.log(`[LOAD DATA] Starting loadData call, set flag to true`);

    // Mark start time immediately to block racing calls
    dispatch({ type: ActionTypes.SET_LAST_DATA_LOAD_TIME, payload: now });

    loadDataCallCount++;
    console.log(`[LOAD DATA #${loadDataCallCount}] Manual data load triggered - STARTING REFRESH PROCESS`);
    console.trace('loadData call trace');

    // Import network utilities for connection-aware loading
    const { isSlowConnection } = await import('../utils/networkRetry');

    const slowConnection = isSlowConnection();
    // ('[MANUAL LOAD] Connection detected:', slowConnection ? 'slow' : 'fast');

    // Progressive loading strategy based on connection speed
    const loadEssentialDataOnly = slowConnection;

    try {
      // Step 1: Load from IndexedDB FIRST (immediate display)
      const essentialPromises = [
        getAllItems(STORES.products).catch(() => []), // Always load - needed for dashboard
        getAllItems(STORES.productBatches).catch(() => []), // Always load - needed for stock calculations
        getAllItems(STORES.categories).catch(() => []), // Always load - needed for forms
        getAllItems(STORES.planDetails).catch(() => []),
        getAllItems(STORES.activities).catch(() => [])
      ];

      const [indexedDBProducts, indexedDBProductBatches, indexedDBCategories, indexedDBPlanDetails, activities] = await Promise.all(essentialPromises);

      //(`🔗 DEBUG: IndexedDB loaded - Products: ${indexedDBProducts.length}, Batches: ${indexedDBProductBatches.length}`);
      //(`🔗 DEBUG: First few products:`, indexedDBProducts.slice(0, 2).map(p => ({ name: p.name, id: p.id || p._id, stock: p.stock })));
      //(`🔗 DEBUG: First few batches:`, indexedDBProductBatches.slice(0, 2).map(b => ({ id: b.id, productId: b.productId, quantity: b.quantity })));

      // Associate batches with products for stock calculations
      const activeProducts = indexedDBProducts.filter(i => i.isDeleted !== true);
      const activeBatches = indexedDBProductBatches.filter(i => i.isDeleted !== true);

      //(`🔗 DEBUG: About to associate ${activeBatches.length} batches with ${activeProducts.length} products`);
      //(`🔗 DEBUG: Sample products:`, activeProducts.slice(0, 2).map(p => ({ name: p.name, id: p.id })));
      //(`🔗 DEBUG: Sample batches:`, activeBatches.slice(0, 2).map(b => ({ productId: b.productId, quantity: b.quantity })));

      // Ensure batches are properly normalized (in case they weren't normalized when saved)
      const normalizedBatches = activeBatches.map(batch => normalizeProductBatch(batch));
      //(`🔗 NORMALIZE: Processed ${normalizedBatches.length} batches from IndexedDB`);

      // Check if any batches had their productId fixed
      const fixedBatches = normalizedBatches.filter((batch, index) => batch.productId !== activeBatches[index].productId);
      if (fixedBatches.length > 0) {
        //(`🔗 NORMALIZE: Fixed productId for ${fixedBatches.length} batches`);
        // (`🔗 NORMALIZE: Fixed batches:`, fixedBatches.map(b => ({
        //   id: b.id,
        //   oldProductId: activeBatches.find(ab => ab.id === b.id)?.productId,
        //   newProductId: b.productId,
        //   quantity: b.quantity
        // })));
      }

      const productsWithBatches = associateBatchesWithProducts(activeProducts, normalizedBatches);

      //(`🔗 DEBUG: Association complete. Sample results:`, productsWithBatches.slice(0, 3).map(p => ({ name: p.name, batchCount: p.batches?.length || 0 })));

      // Check for specific products that should have batches
      const productsWithBatchesCount = productsWithBatches.filter(p => p.batches && p.batches.length > 0).length;
      //(`🔗 DEBUG: Products with batches: ${productsWithBatchesCount}/${productsWithBatches.length}`);

      // Find products that should have batches but don't
      const productsWithoutBatches = productsWithBatches.filter(p => (!p.batches || p.batches.length === 0) && normalizedBatches.some(b => b.productId === p.id || b.productId === p._id));
      if (productsWithoutBatches.length > 0) {
        //(`🔗 DEBUG: Products that should have batches but don't:`, productsWithoutBatches.map(p => ({ name: p.name, id: p.id })));
        //(`🔗 DEBUG: Available batches for debugging:`, normalizedBatches.map(b => ({ productId: b.productId, quantity: b.quantity })));
      }

      // Update state with essential IndexedDB data immediately
      //(`🔄 STATE UPDATE: Setting products with batches to Redux state`);
      if (productsWithBatches.length > 0) {
        // (`🔄 STATE UPDATE: Products being set:`, productsWithBatches.slice(0, 3).map(p => ({
        //   name: p.name,
        //   id: p.id,
        //   hasBatches: !!p.batches,
        //   batchCount: p.batches?.length || 0
        // })));

        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: productsWithBatches });
        //(`✅ STATE UPDATE: Set ${productsWithBatches.length} products with batches in Redux state`);
      }
      if (normalizedBatches.length > 0) {
        dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: normalizedBatches });
        //(`✅ STATE UPDATE: Set ${normalizedBatches.length} normalized batches in Redux state`);
      }
      if (indexedDBCategories.length > 0) {
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: indexedDBCategories.filter(i => i.isDeleted !== true) });
      }

      // Load additional data based on connection speed
      let indexedDBCustomers = [];
      let indexedDBOrders = [];
      let indexedDBTransactions = [];
      let indexedDBPurchaseOrders = [];
      let indexedDBPlanOrders = [];
      let indexedDBExpenses = [];

      if (!loadEssentialDataOnly) {
        const additionalPromises = [
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.planOrders).catch(() => []),
          getAllItems(STORES.expenses).catch(() => [])
        ];

        [indexedDBCustomers, indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders, indexedDBPlanOrders, indexedDBExpenses] = await Promise.all(additionalPromises);

        // Update state with additional IndexedDB data
        if (indexedDBCustomers.length > 0) {
          dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: indexedDBCustomers.filter(i => i.isDeleted !== true) });
        }
        if (indexedDBOrders.length > 0) {
          dispatch({ type: ActionTypes.SET_ORDERS, payload: indexedDBOrders.filter(i => i.isDeleted !== true) });
        }
        if (indexedDBTransactions.length > 0) {
          dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: indexedDBTransactions.filter(i => i.isDeleted !== true) });
        }
        if (indexedDBPurchaseOrders.length > 0) {
          dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: indexedDBPurchaseOrders.filter(i => i.isDeleted !== true) });
        }
        if (indexedDBPlanOrders.length > 0) {
          dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: indexedDBPlanOrders.filter(i => i.isDeleted !== true) });
        }
        if (indexedDBExpenses.length > 0) {
          dispatch({ type: ActionTypes.SET_EXPENSES, payload: indexedDBExpenses.filter(i => i.isDeleted !== true) });
        }
      } else {
        dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'partial' } });
      }

      // Step 2: Sync with backend if online
      //('[MANUAL LOAD] About to check isOnline status...');
      const isOnlineStatus = await isOnline();
      //('[MANUAL LOAD] isOnline check result:', isOnlineStatus);
      dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: isOnlineStatus ? 'online' : 'offline' });

      if (isOnlineStatus) {
        //('[MANUAL LOAD] ✅ Online - proceeding with API calls');
        try {
          // Step A: First push all unsynced IndexedDB changes to MongoDB
          try {
            // Intentionally immediate sync on app load to ensure latest local changes are pushed
            await syncService.syncAll(appStoreFunctions);
          } catch (syncErr) {
            console.error('Initial online sync failed, proceeding to incremental sync:', syncErr);
          }

          // Mark data as being loaded
          dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'loading' } });

          // Perform auto-refresh of latest data
          try {
            //('🔄 Starting auto-refresh of latest data...');
            //('🔄 About to call autoRefreshLatestData()');
            const refreshResult = await autoRefreshLatestData();
            //('🔄 autoRefreshLatestData() returned:', refreshResult);

            // Check if plan is invalid
            if (refreshResult.planInvalid === true) {
              //('🚫 Plan invalid - restricting access but keeping data for read-only mode');

              // Set plan invalid state for sidebar access control
              dispatch({ type: ActionTypes.SET_PLAN_INVALID, payload: true });

              // Show plan expired message
              if (window.showToast) {
                window.showToast('Your plan has expired. You are in read-only mode.', 'warning');
              }

              // Do NOT clear data or return early - allow data processing below to happen
            } else {
              // Ensure plan is marked as valid if backend says so
              dispatch({ type: ActionTypes.SET_PLAN_INVALID, payload: false });
            }

            if (refreshResult.success && refreshResult.data) {
              //('✅ Auto-refresh completed:', refreshResult.message);
              //('🔄 UI Update: Processing data for Redux:', Object.keys(refreshResult.data));

              // Mark data as fresh immediately after successful delta sync
              //('🔄 DELTA SYNC SUCCESS - Setting dataFreshness to fresh');
              dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'fresh' } });

              // Update UI state with refreshed data
              // Special handling for products: associate with batches first
              const productsData = refreshResult.data.products?.data;
              const batchesData = refreshResult.data.productBatches?.data;

              if (productsData && Array.isArray(productsData)) {
                const filteredProducts = productsData.filter(item => item.isDeleted !== true);
                const filteredBatches = batchesData ? batchesData.filter(item => item.isDeleted !== true) : [];

                // Check if products already have batches from backend
                const productsAlreadyHaveBatches = filteredProducts.some(p => p.batches && p.batches.length > 0);

                let finalProducts;
                if (productsAlreadyHaveBatches) {
                  // Use products as-is from backend (they already have batches)
                  finalProducts = filteredProducts;
                } else {
                  // Fallback to association if needed
                  finalProducts = associateBatchesWithProducts(filteredProducts, filteredBatches);
                }

                dispatch({
                  type: ActionTypes.SET_PRODUCTS,
                  payload: finalProducts
                });
                //(`✅ UI Update: Dispatched SET_PRODUCTS for products`);
              }

              if (batchesData && Array.isArray(batchesData)) {
                const filteredBatches = batchesData.filter(item => item.isDeleted !== true);
                //(`🔄 UI Update: Updating productBatches with ${filteredBatches.length} items`);
                dispatch({
                  type: ActionTypes.SET_PRODUCT_BATCHES,
                  payload: filteredBatches
                });
                //(`✅ UI Update: Dispatched SET_PRODUCT_BATCHES for productBatches`);
              }


              // Optimize: Handle plan usage details directly from the /all response to avoid a separate API call
              if (refreshResult.planUsageSummary && refreshResult.planDetails) {
                //('🔄 UI Update: Processing plan usage summary from bulk response');
                const summary = refreshResult.planUsageSummary;
                const details = refreshResult.planDetails;

                // 1. Dispatch plan orders
                dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: details });

                // 2. Construct and dispatch current plan details
                // We attempt to preserve existing plan identity info while updating limits/usage
                // If we have an active plan in details, we can use it to update identity info too
                // SELECT IDENTITY PLAN: Prioritize Active Non-Mini > Latest Non-Mini > Active Mini > First
                let activePlan = details.find(d =>
                  d.status === 'active' && !d.isExpired &&
                  !((d.planType || '').toLowerCase().includes('mini') || (d.planType || '').toLowerCase().includes('topup'))
                );

                if (!activePlan) {
                  activePlan = details.find(d =>
                    !((d.planType || '').toLowerCase().includes('mini') || (d.planType || '').toLowerCase().includes('topup'))
                  );
                }

                if (!activePlan) {
                  activePlan = details.find(d => d.status === 'active' && !d.isExpired);
                }

                if (!activePlan) {
                  activePlan = details[0];
                }

                const updatedDetails = {
                  ...(state.currentPlanDetails || {}),

                  // Update identity if available from active plan
                  ...(activePlan ? {
                    planId: activePlan.planId,
                    planName: activePlan.planName,
                    planType: activePlan.planType,
                    status: activePlan.status,
                    expiryDate: activePlan.expiryDate,
                    remainingMs: activePlan.remainingMs,
                    unlockedModules: activePlan.unlockedModules || []
                  } : {}),

                  // Update limits and usage from summary
                  maxCustomers: summary.customers?.limit !== undefined ? (summary.customers.isUnlimited ? null : summary.customers.limit) : state.currentPlanDetails?.maxCustomers,
                  customerLimit: summary.customers?.limit !== undefined ? (summary.customers.isUnlimited ? null : summary.customers.limit) : state.currentPlanDetails?.customerLimit,

                  customersCount: summary.customers?.used,
                  customerCurrentCount: summary.customers?.used,

                  customersRemaining: summary.customers?.remaining,

                  maxProducts: summary.products?.limit !== undefined ? (summary.products.isUnlimited ? null : summary.products.limit) : state.currentPlanDetails?.maxProducts,
                  productLimit: summary.products?.limit !== undefined ? (summary.products.isUnlimited ? null : summary.products.limit) : state.currentPlanDetails?.productLimit,

                  productsCount: summary.products?.used,
                  productCurrentCount: summary.products?.used,
                  productsRemaining: summary.products?.remaining,

                  maxOrders: summary.orders?.limit !== undefined ? (summary.orders.isUnlimited ? null : summary.orders.limit) : state.currentPlanDetails?.maxOrders,
                  orderLimit: summary.orders?.limit !== undefined ? (summary.orders.isUnlimited ? null : summary.orders.limit) : state.currentPlanDetails?.orderLimit,

                  ordersCount: summary.orders?.used,
                  orderCurrentCount: summary.orders?.used,

                  ordersRemaining: summary.orders?.remaining,

                  planUsageSummary: summary,
                  planUsagePlans: details, // cache reference
                  lastUpdated: new Date().toISOString()
                };

                dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: updatedDetails });

                // CRITICAL FIX: Ensure subscription active status helps unlock the UI
                const isPlanActive = activePlan && activePlan.status === 'active' && !activePlan.isExpired;
                dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !!isPlanActive });

                // 3. Cache to IndexedDB for offline use
                if (state.currentUser?.sellerId) {
                  const recordId = `planDetails_${state.currentUser.sellerId}`;
                  updateInIndexedDB(STORES.planDetails, {
                    id: recordId,
                    sellerId: state.currentUser.sellerId,
                    data: updatedDetails,
                    planOrders: details,
                    lastUpdated: new Date().toISOString()
                  }).catch(e => console.error('Failed to cache plan usage from bulk sync:', e));
                }
              }

              // Handle other data types
              for (const [dataType, dataInfo] of Object.entries(refreshResult.data)) {
                if (dataType === 'products' || dataType === 'productBatches') {
                  continue; // Already handled above
                }

                if (dataInfo.data && Array.isArray(dataInfo.data)) {
                  //(`🔄 UI Update: Updating ${dataType} with ${dataInfo.data.length} items`);
                  if (dataInfo.data.length > 0) {
                    //(`🔄 UI Update: First ${dataType} item:`, dataInfo.data[0]);
                  } else {
                    //(`🔄 UI Update: Clearing ${dataType} (empty array received)`);
                  }

                  const actionType = getActionTypeForDataType(dataType);
                  if (actionType) {
                    const filteredData = dataInfo.data.filter(item => item.isDeleted !== true);
                    //(`🔄 UI Update: Dispatching ${actionType} for ${dataType} with ${filteredData.length} items (filtered from ${dataInfo.data.length})`);
                    dispatch({
                      type: actionType,
                      payload: filteredData
                    });
                    //(`✅ UI Update: Dispatched ${actionType} for ${dataType}`);
                  } else {
                    console.warn(`⚠️ UI Update: No action type found for ${dataType}`);
                  }
                } else {
                  //(`🔄 UI Update: No valid data to update for ${dataType}`);
                }
              }
            }
          } catch (refreshError) {
            console.error('❌ Error during auto-refresh:', refreshError);
            // Continue with existing data if refresh fails
          }

          // Always refresh plan orders on app load when online, regardless of auto-refresh result
          // try {
          //   //('🔄 PLAN ORDERS REFRESH: Fetching fresh plan orders on app load...');
          //   const planOrdersResult = await apiRequest('/data/plan-orders');
          //   if (planOrdersResult.success && planOrdersResult.data) {
          //     const planOrdersData = Array.isArray(planOrdersResult.data)
          //       ? planOrdersResult.data
          //       : planOrdersResult.data.data || [];

          //     // Clear existing plan orders and add fresh ones
          //     await clearAllItems(STORES.planOrders);
          //     if (planOrdersData.length > 0) {
          //       await addMultipleItems(STORES.planOrders, planOrdersData);
          //     }

          //     // Update UI state with fresh plan orders
          //     dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: planOrdersData.filter(i => i.isDeleted !== true) });
          //     //('✅ PLAN ORDERS REFRESH: Updated IndexedDB and UI with', planOrdersData.length, 'plan orders');

          //     // Update last fetch time for plan orders
          //     await updateLastFetchTime('planOrders', Date.now());
          //   } else {
          //     console.warn('⚠️ PLAN ORDERS REFRESH: Failed to fetch plan orders:', planOrdersResult.message);
          //   }
          // } catch (planOrdersError) {
          //   console.error('❌ PLAN ORDERS REFRESH: Error refreshing plan orders:', planOrdersError);
          // }
        } catch (backendError) {
          console.error('❌ Error syncing with backend:', backendError.message);
          // Keep IndexedDB data that was already shown
        }
      } else {
        //('[MANUAL LOAD] ❌ Offline - skipping API calls, using cached data only');
      }

      // Mark data as fresh
      dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'fresh' } });
    } catch (error) {
      console.error('Error loading data:', error);
      // Fallback to localStorage if IndexedDB fails
      const userId = state.currentUser?.email || state.currentUser?.uid;
      if (userId) {
        const savedCustomers = localStorage.getItem(getUserStorageKey('customers', userId));
        const savedProducts = localStorage.getItem(getUserStorageKey('products', userId));
        const savedTransactions = localStorage.getItem(getUserStorageKey('transactions', userId));
        const savedPurchaseOrders = localStorage.getItem(getUserStorageKey('purchaseOrders', userId));
        const savedActivities = localStorage.getItem(getUserStorageKey('activities', userId));

        if (savedCustomers) {
          dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: JSON.parse(savedCustomers) });
        }
        if (savedProducts) {
          dispatch({ type: ActionTypes.SET_PRODUCTS, payload: JSON.parse(savedProducts) });
        }
        if (savedTransactions) {
          dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: JSON.parse(savedTransactions) });
        }
        if (savedPurchaseOrders) {
          dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: JSON.parse(savedPurchaseOrders) });
        }
        if (savedActivities) {
          dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: JSON.parse(savedActivities) });
        }
      }
      dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'offline' });
    } finally {
      // Always clear the in-progress flag
      console.log(`[LOAD DATA] Completed loadData call, clearing flag`);
      window.loadDataInProgress = false;
    }
  }, [state.currentUser, dispatch]);


  // Initialize offline sync system
  useEffect(() => {
    //('🚀 Initializing offline sync system...');
    initializeOfflineSync(dispatch, ActionTypes);
  }, [dispatch]);

  const refreshCurrentPlanDetails = useCallback(async (force = false) => {
    // ('🔄 refreshCurrentPlanDetails called for user:', state.currentUser?.userType, state.currentUser?.sellerId);

    // Prevent duplicate parallel calls
    if (autoPlanSwitchState.current.planDetailsInFlight) {
      console.log('🔄 refreshCurrentPlanDetails: Request already in flight, skipping');
      return;
    }

    // Prevent rapid repeated calls (debounce 5s) unless forced
    const now = Date.now();
    const lastRefresh = autoPlanSwitchState.current.lastPlanDetailsRefresh || 0;
    if (!force && (now - lastRefresh < 5000)) {
      console.log('🔄 refreshCurrentPlanDetails: Called too recently (' + (now - lastRefresh) + 'ms), skipping');
      return;
    }

    // Ensure sellerId is available before making API calls
    const verifySellerId = () => {
      try {
        const auth = localStorage.getItem('auth');
        if (auth) {
          const authData = JSON.parse(auth);
          return authData.sellerId || authData.currentUser?.sellerId;
        }
        return state.currentUser?.sellerId || null;
      } catch (error) {
        console.error('Error verifying sellerId:', error);
        return state.currentUser?.sellerId || null;
      }
    };

    const currentSellerId = verifySellerId();
    if (!currentSellerId) {
      console.warn('⚠️ refreshCurrentPlanDetails: Seller ID not available, skipping API calls');
      return { success: false, error: 'Seller ID not available' };
    }

    // ('✅ refreshCurrentPlanDetails: Seller ID verified:', currentSellerId);

    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest('/data/current-plan'),
        apiRequest('/plans/usage')
      ]);

      // ('📡 Plan API responses:', {
      //   planSuccess: planResult.success,
      //   usageSuccess: usageResult.success,
      //   hasPlanData: !!planResult.data,
      //   hasUsageData: !!usageResult.data
      // });

      const planPayload = planResult.success && planResult.data
        ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

      let effectivePlan = planPayload;



      // Extract the correct plan for IDENTITY (Status, Name, Expiry) if payload is an array
      if (Array.isArray(planPayload)) {
        // Priority 1: Active Non-Mini Plan (The ideal state)
        let chosen = planPayload.find(p =>
          (p.status === 'active' || p.status === 'paid' || p.paymentStatus === 'completed') &&
          !p.isExpired &&
          (p.expiryDate ? new Date(p.expiryDate) > new Date() : true) &&
          !((p.planType || '').toLowerCase().includes('mini') || (p.planType || '').toLowerCase().includes('topup'))
        );

        // Priority 2: Latest Non-Mini Plan (even if expired) - prevents "Mini" from taking over identity
        if (!chosen) {
          chosen = planPayload.find(p =>
            !((p.planType || '').toLowerCase().includes('mini') || (p.planType || '').toLowerCase().includes('topup'))
          );
        }

        // Priority 3: Active Mini Plan (if user ONLY has mini plans)
        if (!chosen) {
          chosen = planPayload.find(p =>
            (p.status === 'active' || p.status === 'paid' || p.paymentStatus === 'completed') &&
            !p.isExpired
          );
        }

        // Fallback: Just take the first one
        effectivePlan = chosen || planPayload[0];
      }

      let combined = mergePlanDetailsWithUsage(effectivePlan, usagePayload);
      if (!combined && effectivePlan) {
        combined = { ...effectivePlan };
      }

      // Check if plan is reported as invalid by the backend
      if (planResult.planInvalid === true || (planResult.data && planResult.data.planInvalid === true)) {
        console.log('⛔ refreshCurrentPlanDetails: Plan reported as invalid by backend');
        dispatch({ type: ActionTypes.SET_PLAN_INVALID, payload: true });
      } else {
        // Plan is valid, ensure invalid flag is cleared
        dispatch({ type: ActionTypes.SET_PLAN_INVALID, payload: false });
      }

      if (combined) {
        // Only update if data has actually changed to avoid unnecessary re-renders
        const currentPlanDetails = state.currentPlanDetails;
        const hasChanged = !currentPlanDetails || JSON.stringify(currentPlanDetails) !== JSON.stringify(combined);

        if (hasChanged) {
          //('🔄 Plan details updated from backend');
          if (combined.planId) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combined.planId });
          } else if (planPayload?.planId) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planPayload.planId });
          }

          // Dispatch the usagePlans (planOrders) if available
          let finalPlanOrders = usagePayload?.planDetails || [];

          // Normalize plan orders first to ensure planType is available on the order object
          // This fixes the issue where planType might only exist inside the populated planId object
          finalPlanOrders = finalPlanOrders.map(order => {
            // Create a mutable clone
            const normalized = { ...order };

            // If planType is missing or empty, try to populate it from planId object
            if (!normalized.planType && normalized.planId && typeof normalized.planId === 'object') {
              // Try multiple potential property names for type
              const typeFromPlan = normalized.planId.planType || normalized.planId.type;
              if (typeFromPlan) {
                normalized.planType = typeFromPlan;
              }
            }
            return normalized;
          });

          // Critical Check: If the user has NO active non-mini plan (base plan),
          // we must NOT store usage/mini plans locally or in state.
          // This forces the system to treat them as expired/restricted, preventing loopholes.
          if (!hasActiveNonMiniPlan(finalPlanOrders)) {
            console.log('⛔ No active non-mini plan found. Filtering out mini/topup plans from storage/state.');

            // Expanded logic consistent with cache loading:
            // If we have NO active base plan, remove any ambiguous active plans (assumed mini).
            const BASE_PLANS = ['basic', 'standard', 'premium', 'pro', 'free'];

            finalPlanOrders = finalPlanOrders.filter(order => {
              let planType = (order.planType || '').toLowerCase();
              let planId = '';

              if (typeof order.planId === 'object' && order.planId) {
                planId = (order.planId.id || order.planId._id || '').toLowerCase();
                // Normalized step above should have handled this, but keep as fallback
                if (!planType) planType = (order.planId.planType || '').toLowerCase();
              } else if (typeof order.planId === 'string') {
                planId = (order.planId || '').toLowerCase();
              }

              const isMini = planType.includes('mini') || planId.includes('mini') || planId.includes('topup');
              const isBasePlan = BASE_PLANS.includes(planType) || BASE_PLANS.some(bp => planId.includes(bp));
              const isActive = (order.status === 'active' || order.status === 'paid' || order.paymentStatus === 'completed') &&
                (order.expiryDate && new Date(order.expiryDate) > new Date());

              // Rule: If it's explicitly mini, remove it.
              if (isMini) return false;

              // Rule: If it's Active but NOT explicitly a base plan, assume it's a mini/topup we missed and remove it.
              if (isActive && !isBasePlan) {
                return false;
              }

              return true;
            });
          }

          if (usagePayload && usagePayload.planDetails) {
            dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: finalPlanOrders });
          }

          dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combined || null });

          // Cache the updated plan details in IndexedDB for instant loading on refresh
          //('💾 Caching plan details in refreshCurrentPlanDetails');
          //('Current user object:', JSON.stringify(state.currentUser, null, 2));
          //('Current user sellerId:', state.currentUser?.sellerId);
          //('Current user _id:', state.currentUser?._id);
          //('Current user id:', state.currentUser?.id);
          //('State sellerId:', state.sellerId);
          //('State keys:', Object.keys(state));

          // Try to get sellerId from multiple possible locations
          const sellerId = state.currentUser?.sellerId ||
            state.currentUser?.id ||
            state.currentUser?._id ||
            state.sellerId;

          // ('Resolved sellerId locations checked:', {
          //   'state.currentUser?.sellerId': state.currentUser?.sellerId,
          //   'state.currentUser?.id': state.currentUser?.id,
          //   'state.currentUser?._id': state.currentUser?._id,
          //   'state.sellerId': state.sellerId,
          //   'final sellerId': sellerId
          // });

          //('Resolved sellerId:', sellerId);

          if (!sellerId) {
            console.error('❌ Cannot cache plan details - no sellerId found!');
            return;
          }

          const recordId = `planDetails_${sellerId}`;

          // CRITICAL: Ensure the merged data object also has the filtered planOrders
          if (combined) {
            combined.planUsagePlans = finalPlanOrders;

            // PRESERVE LOCAL USAGE DELTAS:
            // If local state has higher usage than the fresh backend data (likely due to unsynced local adds),
            // we must preserve that higher usage count in the cache to avoid "flashing" lower limits.
            if (state.currentPlanDetails?.planUsageSummary && combined.planUsageSummary) {
              const types = ['customers', 'orders', 'products'];
              types.forEach(type => {
                const localUsed = state.currentPlanDetails.planUsageSummary[type]?.used || 0;
                const remoteUsed = combined.planUsageSummary[type]?.used || 0;
                if (localUsed > remoteUsed) {
                  // console.log(`Preserving local usage for ${type}: ${localUsed} (backend sent ${remoteUsed})`);
                  combined.planUsageSummary[type].used = localUsed;
                  // Also update top-level legacy fields if they exist
                  if (type === 'customers') {
                    if (typeof combined.customersCount === 'number') combined.customersCount = localUsed;
                    if (typeof combined.customerCurrentCount === 'number') combined.customerCurrentCount = localUsed;
                  } else if (type === 'orders') {
                    if (typeof combined.ordersCount === 'number') combined.ordersCount = localUsed;
                    if (typeof combined.orderCurrentCount === 'number') combined.orderCurrentCount = localUsed;
                  } else if (type === 'products') {
                    if (typeof combined.productsCount === 'number') combined.productsCount = localUsed;
                    if (typeof combined.productCurrentCount === 'number') combined.productCurrentCount = localUsed;
                  }
                }
              });
            }
          }

          const record = {
            id: recordId,
            sellerId: sellerId,
            data: combined,
            planOrders: finalPlanOrders, // EXPLICITLY cache filtered planOrders
            lastUpdated: new Date().toISOString()
          };

          //('📝 Record to cache:', record);
          // Store complete plan details including usage summary using usagePlans for offline access
          updateInIndexedDB(STORES.planDetails, record).then(() => {
            console.log('✅ Plan details (including usage & planOrders) cached successfully for offline use');
          }).catch(cacheError => {
            console.error('❌ Failed to cache plan details:', cacheError);
          });
        } else {
          //('📋 Plan details unchanged from backend');
        }

        // Check if current plan is paused and can be reactivated
        if (combined && combined.status === 'paused' && combined.remainingMs > 0) {
          //('🔄 Current plan is paused but still valid, attempting to reactivate...');
          try {
            const reactivateResult = await apiRequest('/plans/reactivate-current', {
              method: 'POST'
            });

            if (reactivateResult.success) {
              //('✅ Successfully reactivated paused plan:', reactivateResult.data);

              // Refresh plan details again to get the updated status
              const [updatedPlanResult, updatedUsageResult] = await Promise.all([
                apiRequest('/data/current-plan'),
                apiRequest('/plans/usage')
              ]);

              if (updatedPlanResult.success && updatedUsageResult.success) {
                const updatedPlanPayload = updatedPlanResult.success && updatedPlanResult.data
                  ? (Array.isArray(updatedPlanResult.data) ? updatedPlanResult.data : updatedPlanResult.data.data || updatedPlanResult.data)
                  : null;

                const updatedUsagePayload = updatedUsageResult.success && updatedUsageResult.data && updatedUsageResult.data.summary
                  ? updatedUsageResult.data
                  : null;

                const updatedCombined = mergePlanDetailsWithUsage(updatedPlanPayload, updatedUsagePayload);

                if (updatedCombined) {
                  //('🔄 Updated plan details after reactivation');
                  if (updatedCombined.planId) {
                    dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: updatedCombined.planId });
                  }
                  if (updatedUsagePayload && updatedUsagePayload.planDetails) {
                    dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: updatedUsagePayload.planDetails });
                  }
                  dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: updatedCombined });
                }
              }
            } else {
              //('⚠️ Could not reactivate paused plan:', reactivateResult.message);
            }
          } catch (reactivateError) {
            console.error('❌ Error attempting to reactivate paused plan:', reactivateError);
          }
        }

        // Check if current plan is expired/invalid and try to switch to a valid alternative
        if (combined && (combined.isExpired || combined.status === 'expired' || (combined.remainingMs !== undefined && combined.remainingMs <= 0))) {
          // ('🔄 Current plan is expired/invalid, attempting to switch to valid alternative...');
          // ('🔄 Plan details:', {
          //   isExpired: combined.isExpired,
          //   status: combined.status,
          //   remainingMs: combined.remainingMs,
          //   planId: combined.planId,
          //   planName: combined.planName
          // });
          try {
            const switchResult = await apiRequest('/plans/switch-to-valid', {
              method: 'POST'
            });

            if (switchResult.success) {
              //('✅ Successfully switched to valid alternative plan:', switchResult.data);

              // Refresh plan details again to get the updated current plan
              const [switchedPlanResult, switchedUsageResult] = await Promise.all([
                apiRequest('/data/current-plan'),
                apiRequest('/plans/usage')
              ]);

              if (switchedPlanResult.success && switchedUsageResult.success) {
                const switchedPlanPayload = switchedPlanResult.success && switchedPlanResult.data
                  ? (Array.isArray(switchedPlanResult.data) ? switchedPlanResult.data : switchedPlanResult.data.data || switchedPlanResult.data)
                  : null;

                const switchedUsagePayload = switchedUsageResult.success && switchedUsageResult.data && switchedUsageResult.data.summary
                  ? switchedUsageResult.data
                  : null;

                const switchedCombined = mergePlanDetailsWithUsage(switchedPlanPayload, switchedUsagePayload);

                if (switchedCombined) {
                  //('🔄 Updated plan details after switching to alternative');
                  if (switchedCombined.planId) {
                    dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: switchedCombined.planId });
                  }
                  if (switchedUsagePayload && switchedUsagePayload.planDetails) {
                    dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: switchedUsagePayload.planDetails });
                  }
                  dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: switchedCombined });
                }
              }
            } else {
              //('⚠️ Could not switch to alternative plan:', switchResult.message);
            }
          } catch (switchError) {
            console.error('❌ Error attempting to switch to alternative plan:', switchError);
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing current plan details:', error);
    } finally {
      autoPlanSwitchState.current.planDetailsInFlight = false;
      autoPlanSwitchState.current.lastPlanDetailsRefresh = Date.now();
    }
  }, [dispatch]);

  // DEDICATED: Load plan details from IndexedDB immediately when sellerId is available
  useEffect(() => {
    const loadPlanDetailsFromCache = async () => {
      // Try to get sellerId from multiple possible locations
      const sellerId = state.currentUser?.sellerId ||
        state.currentUser?.id ||
        state.currentUser?._id ||
        state.sellerId;

      if (!sellerId) {
        //('⏭️ Skipping plan details cache load - no sellerId available yet');
        return;
      }

      //('🔍 Checking for cached plan details for sellerId:', sellerId);

      try {
        const cachedPlanDetails = await getAllItems(STORES.planDetails).catch(() => []);
        const planRecord = cachedPlanDetails.find(record => record && record.sellerId === sellerId);

        if (planRecord?.data) {
          //('✅ Found cached plan details, loading immediately:', planRecord.data);
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: planRecord.data });

          // CRITICAL: Restore plan orders from cache so aggregatedUsage can be calculated offline
          let restoredPlanOrders = planRecord.planOrders && Array.isArray(planRecord.planOrders) ? planRecord.planOrders : [];

          // Normalize cached plan orders too
          restoredPlanOrders = restoredPlanOrders.map(order => {
            const normalized = { ...order };
            if (!normalized.planType && normalized.planId && typeof normalized.planId === 'object') {
              const typeFromPlan = normalized.planId.planType || normalized.planId.type;
              if (typeFromPlan) {
                normalized.planType = typeFromPlan;
              }
            }
            return normalized;
          });

          // Apply strict filtering on CACHED data as well
          // If the cached data only has mini plans but no active base plan, we must PURGE it.
          if (!hasActiveNonMiniPlan(restoredPlanOrders) && restoredPlanOrders.length > 0) {
            console.log('⛔ Cached plan orders contain only mini/topup plans. Filtering them out to enforce write lock.');
            const originalLength = restoredPlanOrders.length;

            // Expanded logic:
            // If we have NO active base plan, then ANY active plan found here must be a mini or unknown plan
            // that shouldn't be giving access. We should remove it.
            // We keep: Expired plans (for history), or plans that are explicitly base plans.
            const BASE_PLANS = ['basic', 'standard', 'premium', 'pro', 'free'];

            restoredPlanOrders = restoredPlanOrders.filter(order => {
              let planType = (order.planType || '').toLowerCase();
              let planId = '';

              if (typeof order.planId === 'object' && order.planId) {
                planId = (order.planId.id || order.planId._id || '').toLowerCase();
                if (!planType) planType = (order.planId.planType || '').toLowerCase();
              } else if (typeof order.planId === 'string') {
                planId = (order.planId || '').toLowerCase();
              }

              const isMini = planType.includes('mini') || planId.includes('mini') || planId.includes('topup');
              const isBasePlan = BASE_PLANS.includes(planType) || BASE_PLANS.some(bp => planId.includes(bp));
              const isActive = (order.status === 'active' || order.status === 'paid' || order.paymentStatus === 'completed') &&
                (order.expiryDate && new Date(order.expiryDate) > new Date());

              // Rule: If it's explicitly mini, remove it.
              if (isMini) return false;

              // Rule: If it's Active but NOT explicitly a base plan, assume it's a mini/topup we missed and remove it.
              // (If it was a base plan, hasActiveNonMiniPlan would have been true, so we wouldn't be in this block.
              //  But if hasActiveNonMiniPlan returned false, maybe it's not considered "active base plan" but still "active"? 
              //  Logic: if we are here, we have NO active base subscription. So any "active" thing must be invalid or mini.)
              if (isActive && !isBasePlan) {
                // console.log('⚠️ Removing ambiguous active plan from cache:', order._id || order.id);
                return false;
              }

              return true;
            });

            // If we modified the list, let's update the cache immediately to prevent future issues
            if (restoredPlanOrders.length !== originalLength) {
              console.log('💾 Updating IndexedDB cache to remove invalid mini plans...');

              // Also update the data property to match
              if (planRecord.data) {
                planRecord.data.planUsagePlans = restoredPlanOrders;
              }

              const updatedRecord = {
                ...planRecord,
                planOrders: restoredPlanOrders,
                data: planRecord.data // Include updated data object
                // Force a status update if needed, though plan status comes from 'data' property
              };
              // Fire and forget update to clean up DB
              updateInIndexedDB(STORES.planDetails, updatedRecord).catch(e => console.error('Failed to clean up cached plan details:', e));
            }
          }

          if (restoredPlanOrders.length > 0) {
            console.log('✅ Restoring cached plan orders for offline usage calculation:', restoredPlanOrders.length);
            dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: restoredPlanOrders });
          } else {
            // Ensure state is cleared if filtering removed everything
            dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: [] });
          }

          if (planRecord.data.planId) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planRecord.data.planId });
          }
          if (typeof planRecord.data.isExpired === 'boolean') {
            dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !planRecord.data.isExpired });
          }

          // Update sync tracking
          lastSavedPlanDetailsRef.current = {
            sellerId,
            hash: JSON.stringify(planRecord.data)
          };

          //('🎯 UI updated with cached plan details - now fetching fresh data in background...');

          // Fetch fresh data in background
          setTimeout(async () => {
            try {
              //('🔄 Background fetch: Getting fresh plan details from server...');
              // This is the primary background refresh for plan details
              await refreshCurrentPlanDetails();
            } catch (error) {
              console.warn('Background plan details fetch failed:', error);
            }
          }, 500); // Small delay to let cached data settle

        } else {
          //('📭 No cached plan details found for sellerId:', sellerId);
          // No cache, fetch from server
          try {
            //('🌐 Fetching plan details from server (no cache available)...');
            await refreshCurrentPlanDetails();
          } catch (error) {
            console.warn('Initial plan details fetch failed:', error);
          }
        }
      } catch (error) {
        console.error('❌ Error loading plan details from cache:', error);
        // Still try to fetch from server
        try {
          await refreshCurrentPlanDetails();
        } catch (fetchError) {
          console.error('❌ Fallback plan details fetch also failed:', fetchError);
        }
      }
    };

    loadPlanDetailsFromCache();
  }, [state.currentUser?.sellerId, state.currentUser?.id, state.currentUser?._id, state.sellerId]);

  // Logout function with unsynced data protection
  const logoutWithDataProtection = async () => {
    try {
      //('🚪 Initiating logout with data protection check...');

      // Check for unsynced data before clearing IndexedDB
      const [products, customers, orders, transactions, purchaseOrders, productBatches, expenses, settings] = await Promise.all([
        getAllItems(STORES.products).catch(() => []),
        getAllItems(STORES.customers).catch(() => []),
        getAllItems(STORES.orders).catch(() => []),
        getAllItems(STORES.transactions).catch(() => []),
        getAllItems(STORES.purchaseOrders).catch(() => []),
        getAllItems(STORES.productBatches).catch(() => []),
        getAllItems(STORES.expenses).catch(() => []),
        getAllItems(STORES.settings).catch(() => [])
      ]);

      // Count unsynced items by type
      const unsyncedProducts = products.filter(item => item && item.isSynced === false);
      const unsyncedCustomers = customers.filter(item => item && item.isSynced === false);
      const unsyncedOrders = orders.filter(item => item && item.isSynced === false);
      const unsyncedTransactions = transactions.filter(item => item && item.isSynced === false);
      const unsyncedPurchaseOrders = purchaseOrders.filter(item => item && item.isSynced === false);
      const unsyncedProductBatches = productBatches.filter(item => item && item.isSynced === false);
      const unsyncedExpenses = expenses.filter(item => item && item.isSynced === false);
      const unsyncedCustomerTransactions = (state.customerTransactions || []).filter(item => item && item.isSynced === false);
      const unsyncedSettings = settings.filter(item => item && item.isSynced === false);

      const unsyncedData = {
        products: unsyncedProducts.length,
        customers: unsyncedCustomers.length,
        orders: unsyncedOrders.length,
        transactions: unsyncedTransactions.length,
        purchaseOrders: unsyncedPurchaseOrders.length,
        productBatches: unsyncedProductBatches.length,
        expenses: unsyncedExpenses.length,
        customerTransactions: unsyncedCustomerTransactions.length,
        settings: unsyncedSettings.length
      };

      const totalUnsynced = Object.values(unsyncedData).reduce((sum, count) => sum + count, 0);

      //(`📊 Logout data check: ${totalUnsynced} unsynced items found`);

      if (totalUnsynced > 0) {
        console.warn('⚠️ Logout blocked - found unsynced data in IndexedDB');
        console.log('🔄 Attempting to sync unsynced data before logout...');

        // Try to sync the data first
        let syncAttemptResult = null;
        try {
          // Intentionally immediate sync before logout to ensure all data is preserved
          syncAttemptResult = await syncService.syncAll(appStoreFunctions);
        } catch (syncError) {
          console.error('❌ Sync attempt failed:', syncError);
          syncAttemptResult = {
            success: false,
            error: syncError.message || 'Sync failed'
          };
        }

        // Check if sync was successful
        const [productsAfter, customersAfter, ordersAfter, transactionsAfter, purchaseOrdersAfter, productBatchesAfter, expensesAfter, settingsAfter] = await Promise.all([
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.productBatches).catch(() => []),
          getAllItems(STORES.expenses).catch(() => []),
          getAllItems(STORES.settings).catch(() => [])
        ]);

        const stillUnsynced = [
          ...productsAfter.filter(item => item && item.isSynced === false),
          ...customersAfter.filter(item => item && item.isSynced === false),
          ...ordersAfter.filter(item => item && item.isSynced === false),
          ...transactionsAfter.filter(item => item && item.isSynced === false),
          ...purchaseOrdersAfter.filter(item => item && item.isSynced === false),
          ...productBatchesAfter.filter(item => item && item.isSynced === false),
          ...expensesAfter.filter(item => item && item.isSynced === false),
          ...settingsAfter.filter(item => item && item.isSynced === false)
        ];

        // If sync succeeded, allow logout
        if (stillUnsynced.length === 0) {
          console.log('✅ All data synced successfully - proceeding with logout');
          dispatch({ type: ActionTypes.LOGOUT });
          return { success: true };
        }

        // Sync failed - determine the exact reason from the sync attempt
        let syncBlockReason = 'unknown';
        let syncBlockMessage = 'Cannot determine sync status. Please refresh the page and try again.';
        let technicalDetails = '';

        // Analyze the sync result to determine exact failure reason
        if (!navigator.onLine) {
          syncBlockReason = 'offline';
          syncBlockMessage = 'You are offline now. Please turn on your internet and refresh page to sync your complete data.';
          technicalDetails = 'Network Status: Offline. Your device has no internet connection. Sync cannot proceed without network connectivity.';
        } else if (state.systemStatus === 'offline') {
          syncBlockReason = 'offline';
          syncBlockMessage = 'You are offline now. Please turn on your internet and refresh page to sync your complete data.';
          technicalDetails = 'App detected offline status. Server may be unreachable or network connection is unstable.';
        } else if (isPlanExpired(state)) {
          syncBlockReason = 'plan_expired';
          syncBlockMessage = 'Your plan is expired. Upgrade your plan for complete data sync.';
          technicalDetails = 'Plan Status: Expired. The server is blocking sync operations because your subscription has expired. Please upgrade to continue.';
        } else if (syncAttemptResult && syncAttemptResult.error) {
          // Use the actual error from sync attempt
          const errorMsg = syncAttemptResult.error;

          // Parse common error patterns
          if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('authentication')) {
            syncBlockReason = 'auth_error';
            syncBlockMessage = 'Your session has expired. Please refresh the page or login again to sync your data.';
            technicalDetails = `Authentication Error: ${errorMsg}. Your session is no longer valid.`;
          } else if (errorMsg.includes('403') || errorMsg.includes('Forbidden') || errorMsg.includes('plan') || errorMsg.includes('expired')) {
            syncBlockReason = 'plan_expired';
            syncBlockMessage = 'Your plan is expired. Upgrade your plan for complete data sync.';
            technicalDetails = `Access Denied: ${errorMsg}. Your subscription plan does not allow this operation.`;
          } else if (errorMsg.includes('Network') || errorMsg.includes('fetch') || errorMsg.includes('ECONNREFUSED')) {
            syncBlockReason = 'offline';
            syncBlockMessage = 'Unable to connect to server. Please check your internet connection and refresh the page.';
            technicalDetails = `Network Error: ${errorMsg}. Cannot reach the server.`;
          } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
            syncBlockReason = 'sync_failed';
            syncBlockMessage = 'Server is taking too long to respond. Please try again later.';
            technicalDetails = `Timeout Error: ${errorMsg}. The server did not respond in time.`;
          } else if (errorMsg.includes('500') || errorMsg.includes('Internal Server Error')) {
            syncBlockReason = 'sync_failed';
            syncBlockMessage = 'Server error occurred. Please try again later or contact support.';
            technicalDetails = `Server Error: ${errorMsg}. The server encountered an internal error.`;
          } else {
            syncBlockReason = 'sync_error';
            syncBlockMessage = `Data sync failed: ${errorMsg}. Please refresh the page and try again.`;
            technicalDetails = `Sync Error: ${errorMsg}`;
          }
        } else if (syncService && syncService.isSyncing && syncService.isSyncing()) {
          syncBlockReason = 'syncing';
          syncBlockMessage = 'Data sync is in progress. Please wait a moment for sync to complete, then try logout again.';
          technicalDetails = 'Another sync operation is currently running. Please wait for it to complete.';
        } else {
          syncBlockReason = 'sync_failed';
          syncBlockMessage = 'Unable to connect to server. Please refresh the page and try again. If problem persists, contact support.';
          technicalDetails = `Sync failed but no specific error was captured. ${stillUnsynced.length} items remain unsynced. Check browser console for more details.`;
        }

        // Return detailed information for the UI to display
        return {
          success: false,
          hasUnsyncedData: true,
          unsyncedData,
          totalUnsynced: stillUnsynced.length,
          syncBlockReason,
          syncBlockMessage,
          technicalDetails
        };
      }

      //('✅ No unsynced data found - proceeding with logout');
      dispatch({ type: ActionTypes.LOGOUT });
      return { success: true };
    } catch (error) {
      console.error('❌ Error during logout data check:', error);
      // If we can't check, assume there might be unsynced data to be safe
      return {
        success: false,
        hasUnsyncedData: true,
        error: true,
        syncBlockReason: 'error',
        syncBlockMessage: 'Unable to verify data sync status. Please ensure all data is synced before logging out to prevent data loss.'
      };
    }
  };

  // Store dispatch reference for async operations
  useEffect(() => {
    setGlobalDispatch(dispatch);
    // Also set on window for global access (needed for auto-logout)
    window.globalDispatch = dispatch;
  }, [dispatch]);

  // Persist auth token to IndexedDB for Service Worker Background Sync
  useEffect(() => {
    const saveTokenToIDB = async () => {
      try {
        if (state.isAuthenticated) {
          const authStr = localStorage.getItem('auth');
          if (authStr) {
            const authData = JSON.parse(authStr);
            if (authData.token) {
              await updateInIndexedDB(STORES.settings, { id: 'auth_token', value: authData.token });
              // console.log('[AppContext] Saved auth token to IndexedDB for SW');
            }
          }
        }
      } catch (err) {
        console.error('[AppContext] Failed to save auth token to IDB:', err);
      }
    };
    saveTokenToIDB();
  }, [state.isAuthenticated]);

  // Periodic plan details refresh for sellers (every 15 minutes when online, only if user is active)
  useEffect(() => {
    if (!state.currentUser?.sellerId || state.systemStatus !== 'online') {
      return;
    }

    const interval = setInterval(async () => {
      // Only refresh if user has been active recently (within last 10 minutes)
      const lastActivity = state.currentUser?.lastActivityDate;
      if (lastActivity) {
        const lastActivityTime = new Date(lastActivity).getTime();
        const now = Date.now();
        const minutesSinceActivity = (now - lastActivityTime) / (1000 * 60);

        if (minutesSinceActivity > 10) {
          //('⏭️ Skipping periodic plan refresh - user inactive');
          return;
        }
      }

      try {
        //('🔄 Periodic plan details refresh...');
        await refreshCurrentPlanDetails();
      } catch (error) {
        console.error('Error during periodic plan refresh:', error);
      }
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(interval);
  }, [state.currentUser?.sellerId, state.systemStatus, refreshCurrentPlanDetails]);

  // Set store functions provider for sync service
  useEffect(() => {
    setGlobalDispatch(dispatch);
    setStoreFunctionsProvider(appStoreFunctions);
    // Also set the order hash pending checker so sync service can skip orders being processed
    setOrderHashPendingChecker(isOrderHashBeingProcessed);

    // Set callback to update state when items are synced by sync service
    setOnItemSyncedCallback((storeName, syncedItem) => {
      if (!globalDispatch) return;

      // Dispatch appropriate UPDATE action based on store type
      switch (storeName) {
        case 'orders':
          globalDispatch({ type: ActionTypes.UPDATE_ORDER, payload: syncedItem });
          break;
        case 'customers':
          globalDispatch({ type: ActionTypes.UPDATE_CUSTOMER, payload: syncedItem });
          break;
        case 'products':
          globalDispatch({ type: ActionTypes.UPDATE_PRODUCT, payload: syncedItem });
          break;
        case 'purchaseOrders':
          globalDispatch({ type: ActionTypes.UPDATE_PURCHASE_ORDER, payload: syncedItem });
          break;
        case 'transactions':
          globalDispatch({ type: ActionTypes.UPDATE_TRANSACTION, payload: syncedItem });
          break;
        case 'categories':
          globalDispatch({ type: ActionTypes.UPDATE_CATEGORY, payload: syncedItem });
          break;
        case 'refunds':
          // Refunds don't have a state action yet, but we can log it
          //(`[SYNC] Refund ${syncedItem.id} synced successfully`);
          break;
        case 'productBatches':
          globalDispatch({ type: ActionTypes.UPDATE_PRODUCT_BATCH, payload: syncedItem });
          break;
        case 'expenses':
          // Expenses support
          if (ActionTypes.UPDATE_EXPENSE) {
            globalDispatch({ type: ActionTypes.UPDATE_EXPENSE, payload: syncedItem });
          }
          break;
        case 'customerTransactions':
          globalDispatch({ type: ActionTypes.UPDATE_CUSTOMER_TRANSACTION, payload: syncedItem });
          break;
        default:
          console.warn(`[SYNC] Unknown store type for state update: ${storeName}`);
      }
    });

    // Set callback to trigger sync status update when sync completes
    setOnSyncCompletedCallback((syncResult) => {
      //('[SYNC] Sync completed, triggering status update:', syncResult);
      // Trigger sync status update to recalculate progress
      triggerSyncStatusUpdate();
    });
  }, []);

  // Listen for service worker messages (sync triggers, etc.)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = async (event) => {
      if (event.data?.type === 'TRIGGER_SYNC') {
        //('[PWA] Service worker requested sync');
        try {
          const onlineStatus = await isOnline();
          if (onlineStatus && state.isAuthenticated) {
            // Trigger sync when back online
            await syncService.syncAll(appStoreFunctions);
            if (window.showToast) {
              window.showToast('Data synced successfully', 'success');
            }
          }
        } catch (error) {
          console.error('[PWA] Sync trigger error:', error);
        }
      }
    };

    // Listen for messages from service worker
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [state.isAuthenticated]);

  // Load data when user is authenticated (triggered by pageshow events)
  useEffect(() => {
    //('[AUTH LOAD] useEffect triggered, isAuthenticated:', state.isAuthenticated);

    // Only load data if user is authenticated
    if (!state.isAuthenticated) {
      //('[AUTH LOAD] User not authenticated, skipping data load setup');
      return;
    }

    // Data loading is now handled by the pageshow event listener
    //('[AUTH LOAD] User authenticated - data loading will be triggered by page events');
  }, [state.currentUser, dispatch]);

  // Handle page refresh detection and API calls
  useEffect(() => {
    console.log('🔄 AppContext: Component mounted - setting up refresh detection');

    // Initialize session flag if not present (only reset if undefined)
    if (typeof window.loadDataCalledForSession === 'undefined') {
      window.loadDataCalledForSession = false;
    }

    const handlePageShow = (event) => {
      console.log('[PAGESHOW] Event fired', { persisted: event.persisted, isAuthenticated: state.isAuthenticated });
      // Only call API if user is authenticated
      if (!state.isAuthenticated) {
        console.log('🔄 AppContext: User not authenticated - skipping API call');
        return;
      }

      // event.persisted is true when page is loaded from cache (back/forward navigation)
      // event.persisted is false when page is loaded fresh (refresh, first load, direct navigation)
      if (!event.persisted) {
        // Check if background sync was recently completed after login (within last 30 seconds)
        const backgroundSyncTime = sessionStorage.getItem('backgroundSyncCompleted');
        const now = Date.now();
        const timeSinceBackgroundSync = backgroundSyncTime ? now - parseInt(backgroundSyncTime) : Infinity;

        console.log('[PAGESHOW] Checking background sync time', { timeSinceBackgroundSync, backgroundSyncTime });

        if (timeSinceBackgroundSync < 30000) {
          console.log(`🔄 AppContext: Background sync was completed ${timeSinceBackgroundSync}ms ago, skipping loadData`);
          window.loadDataCalledForSession = true;
          window.lastLoadDataTime = Date.now();
          // Clear the flag since we've handled it
          sessionStorage.removeItem('backgroundSyncCompleted');
        } else {
          console.log('🔄 AppContext: Fresh page load detected - calling API');
          window.loadDataCalledForSession = true;
          window.lastLoadDataTime = Date.now();
          loadData();
        }
      } else {
        console.log('🔄 AppContext: Page loaded from cache (navigation) - skipping API call');
      }
    };

    // Listen for pageshow event (fires when page becomes visible)
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [state.isAuthenticated]); // Add isAuthenticated as dependency

  // Reset session flags on logout to ensure next login triggers loadData
  useEffect(() => {
    if (!state.isAuthenticated) {
      window.loadDataCalledForSession = false;
      window.loadDataInProgress = false;
    }
  }, [state.isAuthenticated]);

  // Call loadData on initial mount or when isAuthenticated becomes true
  // This acts as a fallback for the pageshow event
  useEffect(() => {
    console.log('[FALLBACK EFFECT] Run', {
      isAuthenticated: state.isAuthenticated,
      loadDataCalledForSession: window.loadDataCalledForSession
    });

    if (state.isAuthenticated && !window.loadDataCalledForSession) {
      console.log('🔄 AppContext: Triggering initial data load from useEffect (Login/Refresh)');
      // Fix: Mark session as loaded to prevent duplicate call from pageshow event
      window.loadDataCalledForSession = true;
      window.lastLoadDataTime = Date.now();
      loadData();
    }
  }, [state.isAuthenticated, loadData]);



  // Function to load additional data on demand (for slow connections)
  const loadAdditionalData = useCallback(async () => {
    if (state.dataFreshness === 'partial') {
      //('[LAZY LOAD] Loading additional data on demand');

      try {
        const [
          customers,
          orders,
          transactions,
          purchaseOrders
        ] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => [])
        ]);

        // Update state with additional data
        dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: customers.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ORDERS, payload: orders.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: transactions.filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: purchaseOrders.filter(i => i.isDeleted !== true) });

        try {
          const expenses = await getAllItems(STORES.expenses).catch(() => []);
          dispatch({ type: ActionTypes.SET_EXPENSES, payload: expenses.filter(i => i.isDeleted !== true) });
          const customerTransactions = await getAllItems(STORES.customerTransactions).catch(() => []);
          dispatch({ type: ActionTypes.SET_CUSTOMER_TRANSACTIONS, payload: customerTransactions.filter(i => i.isDeleted !== true) });
        } catch (e) { console.error('Error lazy loading expenses/transactions:', e); }

        dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'full' } });
        //('[LAZY LOAD] Additional data loaded successfully');
      } catch (error) {
        console.error('[LAZY LOAD] Failed to load additional data:', error);
      }
    }
  }, [state.dataFreshness]);

  // Expose loadAdditionalData function globally for components to use
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.loadAdditionalData = loadAdditionalData;
    }
    return () => {
      if (typeof window !== 'undefined' && window.loadAdditionalData === loadAdditionalData) {
        delete window.loadAdditionalData;
      }
    };
  }, [loadAdditionalData]);

  // Load user-specific data when user changes
  useEffect(() => {
    const userId = state.currentUser?.email || state.currentUser?.uid;

    if (!userId) {
      // User logged out - clear all data from state but keep IndexedDB
      dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: [] });
      dispatch({ type: ActionTypes.SET_PRODUCTS, payload: [] });
      dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: [] });
      dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: [] });
      dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: [] });
      dispatch({ type: ActionTypes.SET_CATEGORIES, payload: [] });
      dispatch({ type: ActionTypes.SET_EXPENSES, payload: [] });
      return;
    }

    // Reload data when user changes - show IndexedDB first, then fetch from backend
    const loadUserData = async () => {
      try {
        // Step 1: Load from IndexedDB FIRST (immediate display)
        const [indexedDBCustomers, indexedDBProducts, indexedDBProductBatches, indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders, indexedDBCategories, indexedDBPlanDetails, activities, indexedDBPlanOrders, indexedDBExpenses, indexedDBCustomerTransactions] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.productBatches).catch(() => []), // Load batches for association
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.planDetails).catch(() => []),
          getAllItems(STORES.activities).catch(() => []),
          getAllItems(STORES.planOrders).catch(() => []),
          getAllItems(STORES.expenses).catch(() => []),
          getAllItems(STORES.customerTransactions).catch(() => [])
        ]);

        // Normalize IndexedDB data
        const normalizedIndexedDBCustomers = (indexedDBCustomers || []).map(customer => {
          const normalized = {
            ...customer,
            dueAmount: customer.dueAmount !== undefined ? customer.dueAmount : (customer.balanceDue !== undefined ? customer.balanceDue : 0),
            balanceDue: customer.dueAmount !== undefined ? customer.dueAmount : (customer.balanceDue !== undefined ? customer.balanceDue : 0),
            mobileNumber: customer.mobileNumber || customer.phone || ''
          };
          return normalized;
        });

        const normalizedIndexedDBProducts = (indexedDBProducts || []).map(product => {
          const stock = product.stock !== undefined ? product.stock : (product.quantity !== undefined ? product.quantity : 0);
          const costPrice = product.costPrice !== undefined ? product.costPrice : (product.unitPrice !== undefined ? product.unitPrice : 0);
          return {
            ...product,
            stock: stock,
            quantity: stock,
            costPrice: costPrice,
            unitPrice: costPrice
          };
        });

        // Normalize and associate batches with products
        const activeProducts = normalizedIndexedDBProducts.filter(i => i.isDeleted !== true);
        const activeBatches = (indexedDBProductBatches || []).filter(i => i.isDeleted !== true);
        const normalizedBatches = activeBatches.map(batch => normalizeProductBatch(batch));
        const productsWithBatches = associateBatchesWithProducts(activeProducts, normalizedBatches);

        // Show IndexedDB data immediately (exclude soft-deleted items)
        dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedIndexedDBCustomers || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: productsWithBatches });
        dispatch({ type: ActionTypes.SET_ORDERS, payload: (indexedDBOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (indexedDBTransactions || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (indexedDBPurchaseOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (indexedDBCategories || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: (indexedDBPlanOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: activities || [] });
        dispatch({ type: ActionTypes.SET_EXPENSES, payload: (indexedDBExpenses || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: (indexedDBProductBatches || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_CUSTOMER_TRANSACTIONS, payload: (indexedDBCustomerTransactions || []).filter(i => i.isDeleted !== true) });

        // Load plan details from IndexedDB for instant sidebar unlock
        const sellerId = state.currentUser?.sellerId || null;
        if (sellerId) {
          const planRecord = (indexedDBPlanDetails || []).find(record => record && record.sellerId === sellerId);
          if (planRecord?.data && !state.currentPlanDetails) {
            //('🚀 Loading plan details from IndexedDB for instant UI unlock');
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: planRecord.data });
            if (planRecord.data.planId) {
              dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planRecord.data.planId });
            }
            if (typeof planRecord.data.isExpired === 'boolean') {
              dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !planRecord.data.isExpired });
            }
            lastSavedPlanDetailsRef.current = {
              sellerId,
              hash: JSON.stringify(planRecord.data)
            };
          }
        }

        // Step 2: Fetch from backend if online (will replace IndexedDB data)
        const isOnlineStatus = await isOnline();
        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: isOnlineStatus ? 'online' : 'offline' });

        if (isOnlineStatus) {
          try {
            // Push unsynced IndexedDB changes to MongoDB for the current user
            try {
              // Intentionally immediate sync on user change to ensure data consistency
              await syncService.syncAll(appStoreFunctions);
            } catch (syncErr) {
              console.error('User-change online sync failed:', syncErr);
            }
          } catch (backendError) {
            console.error('❌ Error fetching user data from backend:', backendError.message);
            //('🛡️ IndexedDB data preserved due to backend error - no data loss');
          }

          // Background plan details refresh (non-blocking, delayed)
          // Background plan details refresh logic removed as it is handled by refreshCurrentPlanDetails logic thereafter
          // which now includes debounce and in-flight protection.
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'offline' });
      }
    };

    loadUserData();

    // For sellers, ensure plan details are loaded/refreshed
    // ('👤 User login useEffect - checking if should refresh plan details:', {
    //   userType: state.currentUser?.userType,
    //   sellerId: state.currentUser?.sellerId,
    //   hasSellerId: !!state.currentUser?.sellerId,
    //   isSeller: state.currentUser?.userType === 'seller'
    // });

    if (state.currentUser?.userType === 'seller' || state.currentUser?.sellerId) {
      // ('✅ Plan details refresh handled by loadPlanDetailsFromCache useEffect');
      // refreshCurrentPlanDetails().catch(error => { ... });
    } else {
      //('⏭️ Skipping plan details refresh - not a seller');
    }

    // Also load settings from localStorage (settings are small and user-specific)
    const savedSettings = localStorage.getItem(getUserStorageKey('settings', userId));
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        dispatch({ type: ActionTypes.SET_LOW_STOCK_THRESHOLD, payload: settings.lowStockThreshold });
        dispatch({ type: ActionTypes.SET_EXPIRY_DAYS_THRESHOLD, payload: settings.expiryDaysThreshold });
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_DAYS, payload: settings.subscriptionDays });
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: settings.isSubscriptionActive });
        dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: settings.currentPlan });
        if (settings.gstNumber) {
          dispatch({ type: ActionTypes.SET_GST_NUMBER, payload: settings.gstNumber });
        }
        if (settings.storeName) {
          dispatch({ type: ActionTypes.SET_STORE_NAME, payload: settings.storeName });
        }
        if (settings.voiceAssistantEnabled !== undefined) {
          dispatch({ type: ActionTypes.SET_VOICE_ASSISTANT_ENABLED, payload: settings.voiceAssistantEnabled });
        }
        if (settings.voiceAssistantLanguage) {
          dispatch({ type: ActionTypes.SET_VOICE_ASSISTANT_LANGUAGE, payload: settings.voiceAssistantLanguage });
        }
      } catch (e) {
        console.error('Error parsing settings:', e);
      }
    }
  }, [state.currentUser]);

  useEffect(() => {
    if (!state.isAuthenticated) return;
    const planDetails = state.currentPlanDetails;
    if (!planDetails) return;

    const switchState = autoPlanSwitchState.current;

    if (!planDetailsHasPlanOrderSource(planDetails)) {
      const nowMs = Date.now();
      if (!switchState.refreshing && nowMs - switchState.lastRefreshAt >= AUTO_REFRESH_COOLDOWN) {
        switchState.refreshing = true;
        (async () => {
          try {
            await refreshCurrentPlanDetails();
          } catch (usageRefreshError) {
            console.error('Error fetching plan usage details:', usageRefreshError);
          } finally {
            switchState.refreshing = false;
            switchState.lastRefreshAt = Date.now();
          }
        })();
      }
      return;
    }

    const navigateToViewIfAvailable = (view, options = {}) => {
      if (typeof window !== 'undefined' && typeof window.navigateToView === 'function') {
        window.navigateToView(view, options);
        return true;
      }
      return false;
    };

    const redirectToUpgrade = () => {
      if (state.currentView !== 'upgrade') {
        const navigated = navigateToViewIfAvailable('upgrade', { replace: true });
        if (!navigated) {
          dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'upgrade' });
        }
      }
    };

    const showUpgradePrompt = () => {
      if (upgradePromptState.current.hasShown) {
        return;
      }
      const now = Date.now();
      if (now - upgradePromptState.current.lastTriggered < 5000) {
        return;
      }
      upgradePromptState.current.lastTriggered = now;
      upgradePromptState.current.hasShown = true;
      if (typeof window !== 'undefined' && window.showToast) {
        window.showToast('Your subscription has expired. Upgrade now to continue using all features.', 'warning', 6000);
      }
    };

    const normalizedOrders = collectPlanOrdersFromDetails(planDetails);
    const now = Date.now();

    const completedOrders = normalizedOrders.filter((order) => {
      return isPaymentStatusCompleted(order.paymentStatus) || isPaymentStatusCompleted(order.status);
    });

    if (completedOrders.length === 0) {
      if (state.isSubscriptionActive !== false) {
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: false });
      }
      showUpgradePrompt();
      // redirectToUpgrade(); - Blocked to allow access to all pages
      return;
    }

    const activeOrders = completedOrders.filter((order) => !isPlanOrderExpired(order, now));
    if (activeOrders.length === 0) {
      if (state.isSubscriptionActive !== false) {
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: false });
      }
      showUpgradePrompt();
      // redirectToUpgrade(); - Blocked to allow access to all pages
      return;
    }

    if (state.isSubscriptionActive !== true) {
      dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: true });
    }
    upgradePromptState.current.hasShown = false;

    const currentPlanIdentifiers = [
      planDetails.planId,
      planDetails.plan_id,
      planDetails.plan?.planId,
      planDetails.plan?.plan_id,
      planDetails.plan?.id,
      planDetails.plan?.slug,
      planDetails.planKey,
      planDetails.plan?.key,
      planDetails.plan?.identifier,
      state.currentPlan
    ]
      .map(normalizePlanIdentifier)
      .filter(Boolean);

    const currentPlanKeySet = new Set(currentPlanIdentifiers);
    const activeMatchingCurrentPlanOrder = activeOrders.find((order) => currentPlanKeySet.has(order.planKey));
    const planExpired = isCurrentPlanExpired(planDetails, now);

    if (!planExpired && activeMatchingCurrentPlanOrder) {
      upgradePromptState.current.hasShown = false;
      return;
    }

    const nowMs = Date.now();

    if (planExpired && !switchState.refreshing) {
      const timeSinceRefresh = nowMs - switchState.lastRefreshAt;
      if (timeSinceRefresh >= AUTO_REFRESH_COOLDOWN && !switchState.inFlight) {
        switchState.refreshing = true;
        (async () => {
          try {
            await refreshCurrentPlanDetails();
          } catch (refreshError) {
            console.error('Error refreshing plan details after expiry:', refreshError);
          } finally {
            switchState.refreshing = false;
            switchState.lastRefreshAt = Date.now();
          }
        })();
        return;
      }
    }
    const sortedActiveOrders = activeOrders
      .slice()
      .sort((a, b) => {
        const aStart = a.startsAt ?? 0;
        const bStart = b.startsAt ?? 0;
        if (aStart !== bStart) return aStart - bStart;
        const aExpiry = a.expiresAt ?? Number.POSITIVE_INFINITY;
        const bExpiry = b.expiresAt ?? Number.POSITIVE_INFINITY;
        return aExpiry - bExpiry;
      });

    const targetOrder = planExpired
      ? (activeMatchingCurrentPlanOrder || sortedActiveOrders[0] || null)
      : (sortedActiveOrders.find((order) => !currentPlanKeySet.has(order.planKey)) || null);

    if (!targetOrder || !targetOrder.planId) {
      if (planExpired) {
        showUpgradePrompt();
        redirectToUpgrade();
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      redirectToUpgrade();
      return;
    }

    if (switchState.inFlight || switchState.refreshing) return;
    if (switchState.lastAttemptKey === targetOrder.key && (nowMs - switchState.lastAttemptAt) < AUTO_SWITCH_RETRY_WINDOW) {
      return;
    }

    switchState.inFlight = true;
    switchState.lastAttemptKey = targetOrder.key;
    switchState.lastAttemptAt = nowMs;

    (async () => {
      try {
        const payload = { planId: targetOrder.planId };
        if (targetOrder.planOrderId) {
          payload.planOrderId = targetOrder.planOrderId;
        }
        const result = await apiRequest('/data/plans/upgrade', {
          method: 'POST',
          body: payload
        });
        if (result.success) {
          await refreshCurrentPlanDetails();
          switchState.lastRefreshAt = Date.now();
        } else {
          console.warn('Automatic plan switch failed', result);
          showUpgradePrompt();
          // redirectToUpgrade(); - Blocked to allow access to all pages
        }
      } catch (error) {
        console.error('Automatic plan switch error:', error);
        showUpgradePrompt();
        // redirectToUpgrade(); - Blocked to allow access to all pages
      } finally {
        switchState.inFlight = false;
      }
    })();
  }, [
    state.isAuthenticated,
    state.currentPlanDetails,
    state.currentPlan,
    state.isSubscriptionActive,
    state.currentView,
    state.currentTime,
    dispatch,
    refreshCurrentPlanDetails
  ]);

  // Manual function to test plan switching (for debugging)
  const testSwitchToValidPlan = useCallback(async () => {
    //('🧪 Testing switch to valid plan...');
    try {
      const result = await apiRequest('/plans/switch-to-valid', { method: 'POST' });
      //('🧪 Switch result:', result);
      if (result.success) {
        // Refresh plan details
        await refreshCurrentPlanDetails();
        //('✅ Plan switched and details refreshed');
      }
    } catch (error) {
      console.error('❌ Switch test failed:', error);
    }
  }, [refreshCurrentPlanDetails]);

  // Expose for debugging
  const debugPlanSwitching = useMemo(() => ({
    testSwitchToValidPlan,
    refreshCurrentPlanDetails
  }), [testSwitchToValidPlan, refreshCurrentPlanDetails]);

  useEffect(() => {
    const sellerId = state.currentUser?.sellerId || null;
    if (!sellerId) {
      return;
    }

    const recordId = `planDetails_${sellerId}`;

    if (!state.currentPlanDetails) {
      return;
    }

    const dataHash = JSON.stringify(state.currentPlanDetails);
    if (
      lastSavedPlanDetailsRef.current.sellerId === sellerId &&
      lastSavedPlanDetailsRef.current.hash === dataHash
    ) {
      if (state.planBootstrap?.isActive && !state.planBootstrap?.hasCompleted) {
        dispatch({ type: ActionTypes.PLAN_BOOTSTRAP_COMPLETE });
      }
      return;
    }

    const record = {
      id: recordId,
      sellerId,
      planId: state.currentPlanDetails.planId || null,
      planName: state.currentPlanDetails.planName || null,
      data: state.currentPlanDetails,
      updatedAt: new Date().toISOString()
    };

    (async () => {
      let persisted = false;
      try {
        await updateInIndexedDB(STORES.planDetails, record);
        persisted = true;
      } catch {
        try {
          await addToIndexedDB(STORES.planDetails, record);
          persisted = true;
        } catch (error) {
          console.error('Error saving active plan details to IndexedDB:', error);
        }
      } finally {
        lastSavedPlanDetailsRef.current = { sellerId, hash: dataHash };
        if (persisted && state.planBootstrap?.isActive) {
          dispatch({ type: ActionTypes.PLAN_BOOTSTRAP_COMPLETE });
        }
      }
    })();
  }, [state.currentPlanDetails, state.currentUser?.sellerId, state.planBootstrap?.isActive, dispatch]);

  // Save user-specific data when it changes - batched to reduce localStorage writes
  useEffect(() => {
    const userId = state.currentUser?.email || state.currentUser?.uid;
    if (!userId) return;

    // Debounce localStorage writes to avoid excessive writes
    const timeoutId = setTimeout(() => {
      localStorage.setItem(getUserStorageKey('customers', userId), JSON.stringify(state.customers));
      localStorage.setItem(getUserStorageKey('products', userId), JSON.stringify(state.products));
      localStorage.setItem(getUserStorageKey('transactions', userId), JSON.stringify(state.transactions));
      localStorage.setItem(getUserStorageKey('purchaseOrders', userId), JSON.stringify(state.purchaseOrders));
      localStorage.setItem(getUserStorageKey('activities', userId), JSON.stringify(state.activities));
    }, 300); // Debounce by 300ms

    return () => clearTimeout(timeoutId);
  }, [state.customers, state.products, state.transactions, state.purchaseOrders, state.activities, state.currentUser]);

  useEffect(() => {
    const userId = state.currentUser?.email || state.currentUser?.uid;
    if (!userId) return;

    const settings = {
      lowStockThreshold: state.lowStockThreshold,
      expiryDaysThreshold: state.expiryDaysThreshold,
      subscriptionDays: state.subscriptionDays,
      isSubscriptionActive: state.isSubscriptionActive,
      currentPlan: state.currentPlan,
      gstNumber: state.gstNumber,
      storeName: state.storeName,
      upiId: state.upiId,
      voiceAssistantEnabled: state.voiceAssistantEnabled,
      voiceAssistantLanguage: state.voiceAssistantLanguage
    };
    localStorage.setItem(getUserStorageKey('settings', userId), JSON.stringify(settings));
  }, [state.lowStockThreshold, state.expiryDaysThreshold, state.subscriptionDays, state.isSubscriptionActive, state.currentPlan, state.gstNumber, state.storeName, state.voiceAssistantEnabled, state.voiceAssistantLanguage, state.currentUser]);

  // Update time every second - use useCallback to prevent recreation
  const updateTime = useCallback(() => {
    const newTime = new Date().toLocaleTimeString();
    // Only dispatch if time actually changed
    dispatch({ type: ActionTypes.UPDATE_CURRENT_TIME, payload: newTime });
  }, [dispatch]);

  useEffect(() => {
    let timerId = null;

    // Start timer
    timerId = setInterval(updateTime, 1000);

    // Initial update
    updateTime();

    return () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };
  }, [updateTime]);

  // Initialize app data - load from IndexedDB instantly on app start
  useEffect(() => {
    let isMounted = true;

    const initializeAppData = async () => {
      if (!isMounted) return;

      //('🚀 INITIALIZING APP: Loading data instantly from IndexedDB...');

      try {
        // Fast load all data from IndexedDB for instant UI display
        const indexedDBData = await fastLoadFromIndexedDB();

        if (isMounted && indexedDBData) {
          // Associate batches with products before setting state
          const activeProducts = (indexedDBData.products || []).filter(i => i.isDeleted !== true);
          const activeBatches = (indexedDBData.productBatches || []).filter(i => i.isDeleted !== true);
          const normalizedBatches = activeBatches.map(batch => normalizeProductBatch(batch));
          const productsWithBatches = associateBatchesWithProducts(activeProducts, normalizedBatches);

          // Load data into state immediately
          dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (indexedDBData.customers || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_PRODUCTS, payload: productsWithBatches });
          dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: normalizedBatches });
          dispatch({ type: ActionTypes.SET_ORDERS, payload: (indexedDBData.orders || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (indexedDBData.transactions || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (indexedDBData.purchaseOrders || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (indexedDBData.categories || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_REFUNDS, payload: (indexedDBData.refunds || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_EXPENSES, payload: (indexedDBData.expenses || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_CUSTOMER_TRANSACTIONS, payload: (indexedDBData.customerTransactions || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: (indexedDBData.activities || []).filter(i => i.isDeleted !== true) });

          // ('✅ APP INITIALIZED: IndexedDB data loaded instantly', {
          //   customers: indexedDBData.customers?.length || 0,
          //   products: indexedDBData.products?.length || 0,
          //   orders: indexedDBData.orders?.length || 0,
          //   dataSource: indexedDBData.dataSource
          // });

          // Set initial system status and data freshness based on data source
          if (indexedDBData.dataSource === 'indexeddb') {
            dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'loaded_from_cache' });
            dispatch({
              type: ActionTypes.SET_DATA_FRESHNESS,
              payload: { freshness: 'cached', lastSynced: null }
            });
          }
        }

        // After instant load, start background sync if online and user is authenticated
        // ('🔄 APP INIT: Checking if background sync should run...', {
        //   navigatorOnLine: navigator.onLine,
        //   isMounted,
        //   hasAuthData: !!localStorage.getItem('auth')
        // });

        // DISABLED: Background sync on app init - only sync on login now
        // if (navigator.onLine && isMounted && localStorage.getItem('auth')) {
        //   //('🚀 APP INIT: Starting background sync in 1 second...');
        //   setTimeout(() => {
        //     //('🚀 APP INIT: Executing background sync now...');
        //     backgroundSyncWithBackend(dispatch, ActionTypes).then(syncResult => {
        //       //('🔄 APP INIT: Background sync result:', syncResult);
        //       if (syncResult.success && isMounted) {
        //         //('🔄 Background sync completed after app initialization');
        //         dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
        //         dispatch({
        //           type: ActionTypes.SET_DATA_FRESHNESS,
        //           payload: { freshness: 'fresh', lastSynced: Date.now() }
        //         });
        //       } else if (isMounted) {
        //         // Sync failed but data is still from cache
        //         //('⚠️ APP INIT: Background sync failed, keeping cached data');
        //         dispatch({
        //           type: ActionTypes.SET_DATA_FRESHNESS,
        //           payload: { freshness: 'cached', lastSynced: null }
        //         });
        //       }
        //     }).catch(error => {
        //       console.error('Background sync failed after app init:', error);
        //       if (isMounted) {
        //         dispatch({
        //           type: ActionTypes.SET_DATA_FRESHNESS,
        //           payload: { freshness: 'cached', lastSynced: null }
        //         });
        //       }
        //     });
        //   }, 1000); // Small delay to allow UI to render first
        // } else {
        //   //('🚫 APP INIT: Skipping background sync', {
        //     navigatorOnLine: navigator.onLine,
        //     isMounted,
        //     hasAuthData: !!localStorage.getItem('auth')
        //   });
        // }

      } catch (error) {
        console.error('❌ APP INITIALIZATION ERROR: Failed to load IndexedDB data:', error);
        if (isMounted) {
          dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'error' });
        }
      }
    };

    // Initialize app data immediately
    initializeAppData();

    const handleOnline = async () => {
      // Give a small delay to ensure network is fully connected
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify we're actually online
      if (!navigator.onLine || !isMounted) return;

      // First, sync all unsynced local changes to MongoDB
      try {
        const allCustomers = await getAllItems(STORES.customers);
        const allProducts = await getAllItems(STORES.products);
        const allOrders = await getAllItems(STORES.orders);
        // Ensure any soft-deleted items are marked unsynced so they get pushed for deletion
        const markDeletedAsUnsynced = async (storeName, items) => {
          const updater = (item) => updateInIndexedDB(storeName, { ...item, isSynced: false }, true);
          const deletedSynced = items.filter(i => i.isDeleted === true && (i.isSynced === true || i.isSynced === 'true'));
          if (deletedSynced.length > 0) {
            await Promise.all(deletedSynced.map(updater).map(fn => fn));
          }
        };
        await markDeletedAsUnsynced(STORES.customers, allCustomers);
        await markDeletedAsUnsynced(STORES.products, allProducts);
        await markDeletedAsUnsynced(STORES.orders, allOrders);
        const unsyncedCustomers = allCustomers.filter(c => !c.isSynced);
        const unsyncedProducts = allProducts.filter(p => !p.isSynced);
        const unsyncedOrders = allOrders.filter(o => !o.isSynced);

        if (unsyncedCustomers.length > 0 || unsyncedProducts.length > 0 || unsyncedOrders.length > 0) {
          const syncResult = await syncService.syncAll(appStoreFunctions);

          if (syncResult.success && isMounted) {
            if (window.showToast) {
              window.showToast(`All offline changes synced! (${syncResult.summary?.totalSynced || 0} items)`, 'success');
            }
          } else if (isMounted) {
            if (window.showToast) {
              window.showToast('Some changes could not be synced. Will retry automatically.', 'warning');
            }
          }
        }
      } catch (syncError) {
        console.error('❌ Error syncing unsynced changes:', syncError.message);
        if (isMounted && window.showToast) {
          window.showToast('Error syncing offline changes. Will retry automatically.', 'error');
        }
      }

      if (!isMounted) return;

      // DISABLED: Background sync when coming online - only sync on login now
      // try {
      //   const syncResult = await backgroundSyncWithBackend(dispatch, ActionTypes);
      //
      //   if (syncResult.success) {
      //     //('✅ Background sync completed successfully');
      //     if (isMounted) {
      //       dispatch({
      //         type: ActionTypes.SET_DATA_FRESHNESS,
      //         payload: { freshness: 'fresh', lastSynced: Date.now() }
      //       });
      //     }
      //     // Refresh plan details for sellers when coming back online (delayed)
      //     if (state.currentUser?.userType === 'seller' || state.currentUser?.sellerId) {
      //       setTimeout(async () => {
      //         //('🔄 Refreshing plan details after coming online...');
      //         try {
      //           await refreshCurrentPlanDetails();
      //         } catch (planError) {
      //           console.error('Error refreshing plan details after coming online:', planError);
      //         }
      //       }, 1000); // Delay to avoid immediate interruption
      //     }
      //   } else {
      //     //('ℹ️ Background sync skipped or failed:', syncResult.reason);
      //     if (isMounted) {
      //       dispatch({
      //         type: ActionTypes.SET_DATA_FRESHNESS,
      //         payload: { freshness: 'cached', lastSynced: null }
      //       });
      //     }
      //   }
      //
      //   if (isMounted) {
      //     dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
      //   }
      // } catch (error) {
      //   console.error('Error during background sync:', error.message);
      //   if (isMounted) {
      //     dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
      //   }
      // }
    };

    const handleOffline = () => {
      if (isMounted) {
        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'offline' });
      }
    };

    // Also check immediately if already online when this effect runs
    if (navigator.onLine) {
      handleOnline();
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Empty deps - appStoreFunctions is stable and doesn't need to be in deps

  // Apply dark mode effect
  useEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.darkMode]);

  const collectUnsyncedStores = useCallback(async () => {
    const storesToCheck = [
      { key: 'customers', label: 'Customers', storeName: STORES.customers },
      { key: 'products', label: 'Products', storeName: STORES.products },
      { key: 'orders', label: 'Orders', storeName: STORES.orders },
      { key: 'transactions', label: 'Transactions', storeName: STORES.transactions },
      { key: 'purchaseOrders', label: 'Purchase Orders', storeName: STORES.purchaseOrders },
      { key: 'categories', label: 'Categories', storeName: STORES.categories },
      { key: 'productBatches', label: 'Product Batches', storeName: STORES.productBatches },
      { key: 'customerTransactions', label: 'Customer Transactions', storeName: STORES.customerTransactions },
      { key: 'settings', label: 'Settings', storeName: STORES.settings }
    ];

    const summaries = [];

    const isUnsyncedItem = (item) => {
      if (!item) return false;
      if (item.isSynced === false || item.isSynced === 'false') return true;
      if (item.syncError) return true;
      return false;
    };

    for (const entry of storesToCheck) {
      try {
        const items = await getAllItems(entry.storeName);
        const unsyncedItems = (items || []).filter(isUnsyncedItem);
        if (unsyncedItems.length > 0) {
          summaries.push({
            key: entry.key,
            label: entry.label,
            count: unsyncedItems.length
          });
        }
      } catch (error) {
        console.error(`[LOGOUT] Error checking unsynced items for ${entry.label}:`, error);
      }
    }

    return summaries;
  }, []);

  // Load staff permissions on app initialization
  useEffect(() => {
    // Load staff permissions from IndexedDB and server
    const authData = localStorage.getItem('auth');
    if (authData) {
      try {
        const parsedAuthData = JSON.parse(authData);
        const isStaffUser = parsedAuthData.userType === 'staff' || parsedAuthData.currentUser?.userType === 'staff';

        if (isStaffUser && parsedAuthData.isAuthenticated) {
          // Staff permissions loading is already set to true in initial state
          // Now load the actual permissions
          loadStaffPermissions();
        } else {
          //('❌ Not a staff user or not authenticated');
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    } else {
      //('❌ No auth data in localStorage');
    }

    const loadStaffPermissions = async () => {
      const authData = localStorage.getItem('auth');
      if (!authData) return;

      try {
        const parsedAuthData = JSON.parse(authData);
        if (parsedAuthData.userType === 'staff' && parsedAuthData.isAuthenticated) {
          // ('🔄 Loading staff permissions on app initialization...');

          const currentUser = parsedAuthData.currentUser;
          if (!currentUser?._id) return;

          // Loading state is already set above, no need to set again

          // First, try to load permissions from IndexedDB
          const { getStaffPermissions } = await import('../utils/indexedDB');
          const cachedPermissions = await getStaffPermissions(currentUser._id);

          if (cachedPermissions && Object.keys(cachedPermissions).length > 0) {

            // Find the first available permission to set as default view
            // Skip dashboard as default - only use it if it's the only permission available
            const permissionPriority = [
              'customers',
              'products',
              'inventory',
              'billing',
              'salesOrderHistory',
              'refunds',
              'purchaseOrders',
              'financial',
              'reports',
              'settings',
              'dashboard' // dashboard as last resort
            ];

            let firstAvailablePermission = 'dashboard'; // fallback
            for (const permission of permissionPriority) {
              if (cachedPermissions[permission] === true) {
                firstAvailablePermission = permission;
                break;
              }
            }

            // Update state with cached permissions and set default view
            dispatch({
              type: ActionTypes.REFRESH_STAFF_PERMISSIONS,
              payload: {
                permissions: cachedPermissions,
                defaultView: firstAvailablePermission
              }
            });
          } else {
            // Set empty permissions - user will see all options but should have no permissions
            dispatch({
              type: ActionTypes.REFRESH_STAFF_PERMISSIONS,
              payload: {
                permissions: {},
                defaultView: 'dashboard'
              }
            });
          }

          // Set loading complete
          dispatch({
            type: ActionTypes.SET_STAFF_PERMISSIONS_LOADING,
            payload: { loading: false }
          });

          // Check if we're online to refresh permissions from server
          const isOnline = await import('../utils/dataFetcher').then(module => module.isOnline());
          if (!isOnline) {
            //('📴 Skipping staff permission refresh - offline, using cached permissions');
            return;
          }

          //('🔄 Refreshing staff permissions from server...');

          // Import getStaffAuth dynamically
          const { getStaffAuth } = await import('../utils/api');

          const authResult = await getStaffAuth(
            currentUser.email,
            currentUser.uid || '',
            currentUser.displayName || currentUser.name || '',
            currentUser.profilePicture || currentUser.photoURL || ''
          );

          if (authResult.success && authResult.staff) {
            // ('✅ Staff permissions refreshed from server on app init:', {
            //   permissions: authResult.staff.permissions,
            //   userType: authResult.userType
            // });

            // Save updated permissions to IndexedDB
            const { saveStaffPermissions } = await import('../utils/indexedDB');
            try {
              await saveStaffPermissions(
                authResult.staff._id,
                authResult.staff.permissions,
                authResult.seller?._id || authResult.sellerId
              );
              //('💾 Staff permissions updated in IndexedDB');
            } catch (error) {
              console.error('❌ Failed to save updated permissions to IndexedDB:', error);
            }

            // Dispatch full authentication action (LOGIN) to update entire user state
            dispatch({
              type: ActionTypes.LOGIN,
              payload: {
                ...authResult.staff,
                userType: authResult.userType,
                sellerId: authResult.seller?._id
              }
            });
          } else {
            console.error('❌ Staff re-authentication failed on app init:', authResult.error);
            // If re-authentication fails, log the user out
            if (authResult.error && (authResult.error.includes('not found') || authResult.error.includes('inactive'))) {
              //('🚪 Logging out staff user due to authentication failure');
              localStorage.removeItem('auth');
              dispatch({ type: ActionTypes.LOGOUT });
              if (window.showToast) {
                window.showToast('Your account has been deactivated. Please contact your seller.', 'error');
              }
            }
          }
        }
      } catch (error) {
        console.error('💥 Error re-authenticating staff on app init:', error);
      }
    };

    // Load staff permissions after a short delay to ensure everything is initialized
    const timeoutId = setTimeout(loadStaffPermissions, 1500);

    return () => clearTimeout(timeoutId);
  }, [dispatch]);

  const handleLogoutRequest = useCallback(async () => {
    const initialUnsynced = await collectUnsyncedStores();

    if (initialUnsynced.length === 0) {
      return { success: true };
    }

    // Always attempt a sync, even if the device is currently offline.
    // If offline, syncService.syncAll will short-circuit quickly.
    // Intentionally immediate sync to clear queue before checking logout eligibility
    const syncResult = await syncService.syncAll(appStoreFunctions);
    const remainingUnsynced = await collectUnsyncedStores();

    if (remainingUnsynced.length === 0) {
      return {
        success: true,
        synced: initialUnsynced
      };
    }

    if (!syncService.isOnline()) {
      return {
        success: false,
        message: 'You are offline. Please reconnect to the internet so we can sync the pending changes before logging out.',
        unsynced: remainingUnsynced,
        toastType: 'error',
        offline: true
      };
    }

    const failureMessage = syncResult.success
      ? 'Some data could not be synced yet. Please wait a moment and try again.'
      : (syncResult.error === 'Sync in progress'
        ? 'A sync is already running. Please wait a moment and try again.'
        : 'Unable to sync all changes right now. Please try again shortly.');

    return {
      success: false,
      message: failureMessage,
      unsynced: remainingUnsynced,
      toastType: 'warning'
    };
  }, [collectUnsyncedStores]);

  const enhancedDispatch = useCallback(async (action) => {
    if (action?.type === 'REQUEST_LOGOUT') {
      return handleLogoutRequest();
    }

    // List of write actions to protect
    const writeActions = new Set([
      'ADD_CUSTOMER', 'UPDATE_CUSTOMER', 'DELETE_CUSTOMER',
      'ADD_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT',
      'ADD_PRODUCT_BATCH', 'UPDATE_PRODUCT_BATCH', 'DELETE_PRODUCT_BATCH',
      'ADD_PURCHASE_ORDER', 'UPDATE_PURCHASE_ORDER', 'DELETE_PURCHASE_ORDER',
      'ADD_ORDER', 'UPDATE_ORDER', 'DELETE_ORDER',
      'ADD_TRANSACTION', 'UPDATE_TRANSACTION',
      'ADD_CATEGORY', 'UPDATE_CATEGORY', 'DELETE_CATEGORY',
      'ADD_EXPENSE', 'UPDATE_EXPENSE', 'DELETE_EXPENSE',
      'UPDATE_USER', 'SET_GST_NUMBER', 'SET_STORE_NAME',
      'ADD_STAFF', 'UPDATE_STAFF', 'DELETE_STAFF',
      'PROCESS_REFUND'
    ]);

    // Check if the plan is expired or inactive using the utility function
    const expired = isPlanExpired(state);

    if (writeActions.has(action?.type) && expired) {
      if (window.showToast) {
        // Determine the specific reason for blocking to show a better message
        let blockMessage = 'Action blocked: Your plan has expired. Please upgrade to perform this task.';

        // Check if the reason is specifically because they only have mini plans
        const planOrders = state.planOrders || state.planUsagePlans || [];
        const onlyHasMini = planOrders.length > 0 && !hasActiveNonMiniPlan(planOrders);
        const currentIsMini = !planOrders.length && state.currentPlanDetails?.planType === 'mini';

        if (onlyHasMini || currentIsMini) {
          blockMessage = 'Action blocked: A base subscription plan is required to perform write operations. Mini plans alone are not enough.';
        }

        window.showToast(blockMessage, 'error');
      }
      return { success: false, message: 'Plan restricted' };
    }

    dispatch(action);
    return { success: true };
  }, [dispatch, handleLogoutRequest, state]);

  const derivedMetrics = useMemo(() => {
    try {
      return recomputeDerivedData(state);
    } catch (error) {
      console.error('Error computing derived metrics:', error);
      return {};
    }
  }, [state.orders, state.products, state.currentUser?.sellerId]);

  // Manual refresh function - forces full data sync without timestamps
  const manualRefresh = useCallback(async () => {
    try {
      console.log('🔄 MANUAL REFRESH: Starting full data refresh (no timestamps)');

      if (window.showToast) {
        window.showToast('Refreshing data...', 'info', 2000);
      }

      // Explicitly push local changes to backend first
      if (syncService.isOnline()) {
        try {
          console.log('🔄 MANUAL REFRESH: Pushing local changes to backend...');

          // Define local store functions provider to ensure all stores (especially productBatches) are covered
          const appStoreFunctionsLocal = (storeName) => {
            // Map store names to IndexedDB store constants
            const storeMap = {
              'products': STORES.products,
              'productBatches': STORES.productBatches,
              'orders': STORES.orders,
              'customers': STORES.customers,
              'transactions': STORES.transactions,
              'purchaseOrders': STORES.purchaseOrders,
              'categories': STORES.categories,
              'refunds': STORES.refunds,
              'expenses': STORES.expenses,
              'customerTransactions': STORES.customerTransactions,
              'settings': STORES.settings
            };

            const storeConstant = storeMap[storeName];
            if (!storeConstant) return null;

            return {
              getAllItems: () => getAllItems(storeConstant),
              updateItem: (item) => updateInIndexedDB(storeConstant, item),
              deleteItem: (id) => deleteFromIndexedDB(storeConstant, id)
            };
          };

          // Intentionally immediate sync during manual refresh
          await syncService.syncAll(appStoreFunctionsLocal);
          console.log('✅ MANUAL REFRESH: Local changes pushed successfully');

          // CRITICAL: Reload Redux state from IndexedDB NOW to reflect synced IDs (like customerId in orders)
          // This prevents duplicates that happen when Redux still has 'cust-123' but IDB has '674...'
          console.log('🔄 MANUAL REFRESH: Reloading Redux state from IndexedDB before backend fetch...');
          const [customers, products, orders, transactions, vOrders, productBatches, customerTransactions] = await Promise.all([
            getAllItems(STORES.customers),
            getAllItems(STORES.products),
            getAllItems(STORES.orders),
            getAllItems(STORES.transactions),
            getAllItems(STORES.purchaseOrders),
            getAllItems(STORES.productBatches),
            getAllItems(STORES.customerTransactions)
          ]);

          dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: customers.filter(c => !c.isDeleted) });
          dispatch({ type: ActionTypes.SET_PRODUCTS, payload: products.filter(p => !p.isDeleted) });
          dispatch({ type: ActionTypes.SET_ORDERS, payload: orders.filter(o => !o.isDeleted) });
          dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: transactions.filter(t => !t.isDeleted) });
          dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: vOrders.filter(v => !v.isDeleted) });
          dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: productBatches.filter(b => !b.isDeleted) });
          dispatch({ type: ActionTypes.SET_CUSTOMER_TRANSACTIONS, payload: customerTransactions.filter(t => !t.isDeleted) });
          console.log('✅ MANUAL REFRESH: Redux state reloaded from IndexedDB');
        } catch (pushError) {
          console.error('❌ MANUAL REFRESH: Push sync failed:', pushError);
        }
      }

      // Import backgroundSyncWithBackend
      const { backgroundSyncWithBackend } = await import('../utils/dataFetcher');

      // Call with forceFullSync: true to skip timestamps and get all data
      const result = await backgroundSyncWithBackend(dispatch, ActionTypes, {
        forceFullSync: true,
        showProgress: true
      });

      if (result.success && result.data) {
        console.log('✅ MANUAL REFRESH: Full data refresh completed successfully');

        // CRITICAL FIX: Dispatch the fresh data returned by backgroundSyncWithBackend
        // Previous code ignored the result, leaving the UI stale (showing pre-fetch IDB state)
        const {
          customers, products, orders, transactions, purchaseOrders,
          productBatches, categories, refunds, expenses, customerTransactions, planOrders
        } = result.data;

        // Dispatch updates to Redux store
        // Use batching/unstable_batchedUpdates if React version supports it, but separate dispatches are fine here
        if (customers) dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: customers });
        if (products) dispatch({ type: ActionTypes.SET_PRODUCTS, payload: products });
        if (orders) dispatch({ type: ActionTypes.SET_ORDERS, payload: orders });
        if (transactions) dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: transactions });
        if (purchaseOrders) dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: purchaseOrders });
        if (productBatches) dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: productBatches });
        if (categories) dispatch({ type: ActionTypes.SET_CATEGORIES, payload: categories });
        if (refunds) dispatch({ type: ActionTypes.SET_REFUNDS, payload: refunds });
        if (expenses) dispatch({ type: ActionTypes.SET_EXPENSES, payload: expenses });
        if (customerTransactions) dispatch({ type: ActionTypes.SET_CUSTOMER_TRANSACTIONS, payload: customerTransactions });

        // Process Plan Details if available in the result
        if (result.planUsageSummary && result.planDetails) {
          console.log('🔄 MANUAL REFRESH: Processing plan details from sync result');
          const summary = result.planUsageSummary;
          const details = result.planDetails;

          const rawPlanOrders = planOrders || details;

          // 1. Dispatch plan orders
          dispatch({ type: ActionTypes.SET_PLAN_ORDERS, payload: rawPlanOrders });

          // 2. Identity Selection Logic (Prioritize Non-Mini)
          let activePlan = details.find(d =>
            d.status === 'active' && !d.isExpired &&
            !((d.planType || '').toLowerCase().includes('mini') || (d.planType || '').toLowerCase().includes('topup'))
          );

          if (!activePlan) {
            activePlan = details.find(d =>
              !((d.planType || '').toLowerCase().includes('mini') || (d.planType || '').toLowerCase().includes('topup'))
            );
          }

          if (!activePlan) {
            activePlan = details.find(d => d.status === 'active' && !d.isExpired);
          }

          if (!activePlan) {
            activePlan = details[0];
          }

          const updatedDetails = {
            ...(state.currentPlanDetails || {}),

            // Update identity if available from active plan
            ...(activePlan ? {
              planId: activePlan.planId,
              planName: activePlan.planName,
              planType: activePlan.planType,
              status: activePlan.status,
              expiryDate: activePlan.expiryDate,
              remainingMs: activePlan.remainingMs,
              unlockedModules: activePlan.unlockedModules || []
            } : {}),

            // Update limits and usage from summary
            maxCustomers: summary.customers?.limit !== undefined ? (summary.customers.isUnlimited ? null : summary.customers.limit) : state.currentPlanDetails?.maxCustomers,
            customerLimit: summary.customers?.limit !== undefined ? (summary.customers.isUnlimited ? null : summary.customers.limit) : state.currentPlanDetails?.customerLimit,

            customersCount: summary.customers?.used,
            customerCurrentCount: summary.customers?.used,

            customersRemaining: summary.customers?.remaining,

            maxProducts: summary.products?.limit !== undefined ? (summary.products.isUnlimited ? null : summary.products.limit) : state.currentPlanDetails?.maxProducts,
            productLimit: summary.products?.limit !== undefined ? (summary.products.isUnlimited ? null : summary.products.limit) : state.currentPlanDetails?.productLimit,

            productsCount: summary.products?.used,
            productCurrentCount: summary.products?.used,
            productsRemaining: summary.products?.remaining,

            maxOrders: summary.orders?.limit !== undefined ? (summary.orders.isUnlimited ? null : summary.orders.limit) : state.currentPlanDetails?.maxOrders,
            orderLimit: summary.orders?.limit !== undefined ? (summary.orders.isUnlimited ? null : summary.orders.limit) : state.currentPlanDetails?.orderLimit,

            ordersCount: summary.orders?.used,
            orderCurrentCount: summary.orders?.used,

            ordersRemaining: summary.orders?.remaining,

            planUsageSummary: summary,
            planUsagePlans: details, // cache reference
            lastUpdated: new Date().toISOString()
          };

          dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: updatedDetails });

          // Unlock UI if active
          const isPlanActive = activePlan && activePlan.status === 'active' && !activePlan.isExpired;
          dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !!isPlanActive });

          // 3. Cache to IndexedDB
          if (state.currentUser?.sellerId) {
            const recordId = `planDetails_${state.currentUser.sellerId}`;
            updateInIndexedDB(STORES.planDetails, {
              id: recordId,
              sellerId: state.currentUser.sellerId,
              data: updatedDetails,
              planOrders: rawPlanOrders,
              lastUpdated: new Date().toISOString()
            }).then(() => console.log('✅ MANUAL REFRESH: Plan details cached to IndexedDB'))
              .catch(e => console.error('Failed to cache plan usage from manual sync:', e));
          }
        }

        console.log('✅ MANUAL REFRESH: UI updated with fresh data');

        if (window.showToast) {
          window.showToast('Data refreshed successfully!', 'success');
        }
        return { success: true };
      } else {
        console.error('❌ MANUAL REFRESH: Failed to refresh data:', result.reason);
        if (window.showToast) {
          window.showToast('Failed to refresh data. Please try again.', 'error');
        }
        return { success: false, reason: result.reason };
      }
    } catch (error) {
      console.error('❌ MANUAL REFRESH: Error during manual refresh:', error);
      if (window.showToast) {
        window.showToast('Error refreshing data: ' + error.message, 'error');
      }
      return { success: false, error: error.message };
    }
  }, [dispatch]);

  // Function to refresh latest data from server
  const refreshLatestData = useCallback(async (dataTypes = null) => {
    try {
      //('🔄 REFRESH: Starting latest data refresh for:', dataTypes || 'all types');

      // Get timestamps for the data types we want to refresh
      const timestamps = await getLatestFetchTimestamps();

      // If specific data types are requested, filter timestamps
      const filteredTimestamps = dataTypes
        ? Object.fromEntries(Object.entries(timestamps).filter(([key]) => dataTypes.includes(key)))
        : timestamps;

      if (Object.keys(filteredTimestamps).length === 0) {
        //('🔄 REFRESH: No valid timestamps found, skipping refresh');
        return { success: false, message: 'No valid timestamps found' };
      }

      // Fetch latest data
      const latestData = await fetchLatestData(filteredTimestamps);

      if (Object.keys(latestData).length === 0) {
        //('🔄 REFRESH: No new data found');
        return { success: true, message: 'No new data to refresh', data: {} };
      }

      // Merge data into IndexedDB and update UI state
      const mergeResult = await mergeLatestDataToIndexedDB(latestData, { updateFetchTimes: true });

      if (mergeResult) {
        // Update UI state with the new data
        for (const [dataType, dataInfo] of Object.entries(latestData)) {
          if (dataInfo.data && dataInfo.data.length > 0) {
            const actionType = getActionTypeForDataType(dataType);
            if (actionType) {
              dispatch({
                type: actionType,
                payload: dataInfo.data.filter(item => item.isDeleted !== true)
              });
            }
          }
        }

        //('✅ REFRESH: Successfully refreshed latest data');
        return {
          success: true,
          message: `Refreshed data for ${Object.keys(latestData).length} data types`,
          data: latestData
        };
      } else {
        console.error('❌ REFRESH: Failed to merge data');
        return { success: false, message: 'Failed to merge data' };
      }

    } catch (error) {
      console.error('❌ REFRESH: Error refreshing latest data:', error);
      return { success: false, message: error.message || 'Unknown error' };
    }
  }, [dispatch]);



  const toggleDarkMode = useCallback(() => {
    const newMode = !state.darkMode;
    dispatch({ type: ActionTypes.SET_DARK_MODE, payload: newMode });

    // Save to localStorage
    try {
      const currentSettings = JSON.parse(localStorage.getItem('settings') || '{}');
      currentSettings.darkMode = newMode;
      localStorage.setItem('settings', JSON.stringify(currentSettings));
    } catch (e) {
      console.error('Error saving dark mode setting:', e);
    }

    if (window.showToast) {
      window.showToast(newMode ? 'Dark mode enabled' : 'Light mode enabled', 'success');
    }
  }, [state.darkMode, dispatch]);

  // Sync pending local data to backend
  const syncPendingData = useCallback(async () => {
    if (!syncService.isOnline()) {
      return { success: false, message: 'Offline' };
    }

    try {
      console.log('🔄 SYNC PENDING: Pushing local changes to backend...');

      // Define local store functions provider to ensure all stores are covered
      const appStoreFunctionsLocal = (storeName) => {
        // Map store names to IndexedDB store constants
        const storeMap = {
          'products': STORES.products,
          'productBatches': STORES.productBatches,
          'orders': STORES.orders,
          'customers': STORES.customers,
          'transactions': STORES.transactions,
          'purchaseOrders': STORES.purchaseOrders,
          'categories': STORES.categories,
          'refunds': STORES.refunds,
          'expenses': STORES.expenses,
          'customerTransactions': STORES.customerTransactions,
          'settings': STORES.settings
        };

        const storeConstant = storeMap[storeName];
        if (!storeConstant) return null;

        return {
          getAllItems: () => getAllItems(storeConstant),
          updateItem: (item) => updateInIndexedDB(storeConstant, item),
          deleteItem: (id) => deleteFromIndexedDB(storeConstant, id)
        };
      };

      await syncService.syncAll(appStoreFunctionsLocal);
      console.log('✅ SYNC PENDING: Local changes pushed successfully');
      return { success: true };
    } catch (error) {
      console.error('❌ SYNC PENDING: Push sync failed:', error);
      return { success: false, error: error.message };
    }
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  // dispatch from useReducer is already stable and doesn't change
  // Only recreate when state actually changes
  const value = useMemo(() => ({
    state,
    dispatch: enhancedDispatch,
    derivedMetrics,
    refreshCurrentPlanDetails,
    refreshLatestData,
    manualRefresh,
    syncPendingData,
    debugPlanSwitching,
    logoutWithDataProtection,
    toggleDarkMode,
  }), [state, derivedMetrics, enhancedDispatch, refreshCurrentPlanDetails, refreshLatestData, manualRefresh, syncPendingData, debugPlanSwitching, logoutWithDataProtection, toggleDarkMode]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

// Custom hook to use the context
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export default AppContext;
