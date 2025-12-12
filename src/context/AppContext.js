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
  initializeOfflineSync
} from '../utils/dataFetcher';
import { apiRequest, createOrder } from '../utils/api';
import { setOrderHashPendingChecker, setOnItemSyncedCallback, setOnSyncCompletedCallback } from '../services/syncService';
import { getPlanLimits, canAddCustomer, canAddProduct, canAddOrder, calculateAggregatedUsageFromPlanOrders } from '../utils/planUtils';
import { getViewFromPath } from '../utils/navigation';
import syncManager, { performFullSync, resetSyncMetadata, COLLECTION_MAP } from '../services/syncManager';

// Helper function for efficient array comparison (prevents unnecessary re-renders)
const arraysEqual = (arr1, arr2, dataType = 'unknown') => {
  console.log(`🔍 arraysEqual check for ${dataType}:`, {
    arr1Length: arr1.length,
    arr2Length: arr2.length,
    firstItem1: arr1[0] ? {
      id: arr1[0].id,
      name: arr1[0].name,
      updatedAt: arr1[0].updatedAt,
      isSynced: arr1[0].isSynced,
      isDeleted: arr1[0].isDeleted,
      ...(dataType === 'customers' ? {
        dueAmount: arr1[0].dueAmount,
        balanceDue: arr1[0].balanceDue,
        email: arr1[0].email
      } : {})
    } : null,
    firstItem2: arr2[0] ? {
      id: arr2[0].id,
      name: arr2[0].name,
      updatedAt: arr2[0].updatedAt,
      isSynced: arr2[0].isSynced,
      isDeleted: arr2[0].isDeleted,
      ...(dataType === 'customers' ? {
        dueAmount: arr2[0].dueAmount,
        balanceDue: arr2[0].balanceDue,
        email: arr2[0].email
      } : {})
    } : null
  });

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
      //(`🔍 arraysEqual: Different IDs at index ${i} (${item1.id} vs ${item2.id}) - UPDATE NEEDED`);
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

      return;
    }

    const parsedAuthData = JSON.parse(authData);
    if (parsedAuthData.userType !== 'staff') {

      return;
    }

    const currentUser = parsedAuthData.currentUser;
    if (!currentUser?.email) {

      return;
    }

    // Import getStaffAuth dynamically to avoid circular imports
    const { getStaffAuth } = await import('../utils/api');

    const authResult = await getStaffAuth(
      currentUser.email,
      currentUser.uid || '',
      currentUser.displayName || currentUser.name || '',
      currentUser.profilePicture || currentUser.photoURL || ''
    );

    if (authResult.success && authResult.staff) {

      // Save updated permissions to IndexedDB
      const { saveStaffPermissions } = await import('../utils/indexedDB');
      try {
        await saveStaffPermissions(
          authResult.staff._id,
          authResult.staff.permissions,
          authResult.seller?._id || authResult.sellerId
        );

      } catch (error) {

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

      if (window.showToast) {
        window.showToast('Failed to update permissions', 'error');
      }
    }
  } catch (error) {

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
    const dayKey = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
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
    upiId: ''
  };

  const hasPlanBootstrapCompleted = typeof window !== 'undefined' && sessionStorage.getItem(PLAN_LOADER_SESSION_KEY) === 'true';

  if (savedSettings) {
    try {
      const parsed = JSON.parse(savedSettings);
      settingsState = { ...settingsState, ...parsed };
    } catch (e) {

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
    voiceAssistantEnabled: settingsState.voiceAssistantEnabled,

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
    aggregatedUsage: null, // Aggregated usage from all valid plan orders

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

    // Subscription system
    subscriptionDays: settingsState.subscriptionDays,
    isSubscriptionActive: settingsState.isSubscriptionActive,
    currentPlan: settingsState.currentPlan,
    currentPlanDetails: null, // Will be fetched from backend

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

// Transform plan details into aggregated usage format expected by components
const transformPlanDetailsToAggregatedUsage = (planDetails) => {
  if (!planDetails) return null;

  return {
    products: {
      used: planDetails.totalProducts || 0,
      limit: planDetails.maxProducts === Infinity ? 'Unlimited' : (planDetails.maxProducts || 0)
    },
    customers: {
      used: planDetails.totalCustomers || 0,
      limit: planDetails.maxCustomers === Infinity ? 'Unlimited' : (planDetails.maxCustomers || 0)
    },
    orders: {
      used: planDetails.totalOrders || 0,
      limit: planDetails.maxOrders === Infinity ? 'Unlimited' : (planDetails.maxOrders || 0)
    }
  };
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
  SET_AGGREGATED_USAGE: 'SET_AGGREGATED_USAGE',
  SET_PLAN_ORDERS: 'SET_PLAN_ORDERS',
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
  REPLACE_PURCHASE_ORDER: 'REPLACE_PURCHASE_ORDER',
  REMOVE_PURCHASE_ORDER_BY_ID: 'REMOVE_PURCHASE_ORDER_BY_ID',
  DELETE_PURCHASE_ORDER: 'DELETE_PURCHASE_ORDER',

  SET_ORDERS: 'SET_ORDERS',
  ADD_ORDER: 'ADD_ORDER',
  UPDATE_ORDER: 'UPDATE_ORDER',
  DELETE_ORDER: 'DELETE_ORDER',

  SET_TRANSACTIONS: 'SET_TRANSACTIONS',
  ADD_TRANSACTION: 'ADD_TRANSACTION',
  UPDATE_TRANSACTION: 'UPDATE_TRANSACTION',

  SET_ACTIVITIES: 'SET_ACTIVITIES',
  ADD_ACTIVITY: 'ADD_ACTIVITY',

  // Categories
  SET_CATEGORIES: 'SET_CATEGORIES',
  ADD_CATEGORY: 'ADD_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',

  // UI state
  SET_CURRENT_VIEW: 'SET_CURRENT_VIEW',
  SET_LISTENING: 'SET_LISTENING',
  SET_LOADING: 'SET_LOADING',
  FORCE_REFRESH: 'FORCE_REFRESH',

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

// Helper function to get store functions for sync service (defined outside reducer)
const getStoreFunctions = (storeName) => {
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
    productBatches: {
      getAllItems: () => getAllItems(STORES.productBatches),
      updateItem: (item) => updateInIndexedDB(STORES.productBatches, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.productBatches, id)
    },
    refunds: {
      getAllItems: () => getAllItems(STORES.refunds),
      updateItem: (item) => updateInIndexedDB(STORES.refunds, item),
      deleteItem: (id) => deleteFromIndexedDB(STORES.refunds, id)
    }
  };
  return storeMap[storeName];
};

const formatPlanLimitLabel = (value) => (value === Infinity ? 'Unlimited' : value);

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
  const limits = getPlanLimits(state.currentPlan, state.currentPlanDetails);
  const planNameLabel = getPlanNameLabel(state);

  const configs = {
    customer: {
      current: state.customers.filter(customer => !customer.isDeleted).length,
      limit: limits.maxCustomers,
      canAdd: (count) => canAddCustomer(count, state.currentPlan, state.currentPlanDetails),
      label: 'customer',
      plural: 'customers'
    },
    product: {
      current: state.products.filter(product => !product.isDeleted).length,
      limit: limits.maxProducts,
      canAdd: (count) => canAddProduct(count, state.currentPlan, state.currentPlanDetails),
      label: 'product',
      plural: 'products'
    },
    order: {
      current: state.orders.filter(order => !order.isDeleted).length,
      limit: limits.maxOrders,
      canAdd: (count) => canAddOrder(count, state.currentPlan, state.currentPlanDetails),
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
const associateBatchesWithProducts = (products, batches) => {
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
const appReducer = (state, action) => {
  // Only log critical actions (skip UPDATE_CURRENT_TIME and other frequent actions)
  if (action.type === 'ADD_ORDER') {
    // Removed debug log
  }
  // Skip logging UPDATE_CURRENT_TIME and other frequent actions to reduce console noise

  switch (action.type) {
    case ActionTypes.LOGIN: {

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

      }

      // Start auto-sync after login (skip initial sync since backgroundSyncWithBackend handles it)
      setTimeout(() => {
        if (syncService.isOnline()) {
          syncService.startAutoSync(getStoreFunctions, 30000, true); // Sync every 30 seconds, skip initial
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

      } catch (error) {

      }

      // Stop auto-sync
      syncService.stopAutoSync();

      // Notify service worker that user logged out
      postMessageToServiceWorker({ type: 'LOGGED_OUT' });

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PLAN_LOADER_SESSION_KEY);
      }

      // Delete entire IndexedDB database on logout (async operation)

      const { deleteDatabase, resetDatabaseFlags } = require('../utils/indexedDB');

      // Reset database flags
      resetDatabaseFlags();

      deleteDatabase().then(() => {

      }).catch(error => {

      });

      // Clear IndexedDB data based on user type (async operation) - backup in case database deletion fails
      const userType = state.currentUser?.userType;

      //(`🗑️ Processing logout for ${userType} (${userId})`);

      if (userType === 'seller') {

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
          // STORES.planOrders removed - using planDetails for limits and usage
        ];

        // Clear stores asynchronously (don't block logout)
        sellerStores.forEach(storeName => {
          clearAllItems(storeName).catch(error => {

          });
        });

      } else if (userType === 'staff') {

        // For staff, only clear staff-specific data to preserve seller data access
        clearAllItems(STORES.staffPermissions).catch(error => {

        });

      } else {

        // For unknown user types, clear minimal data
        clearAllItems(STORES.activities).catch(error => {

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
        activities: [],
        categories: [],
        currentPlan: 'basic',
        currentPlanDetails: null,
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
      // Transform plan details to aggregated usage format and set it
      const aggregatedUsage = transformPlanDetailsToAggregatedUsage(action.payload);

      // Only cache plan details to IndexedDB when explicitly requested (e.g., from upgrade page)
      if (action.payload && action.cacheInIndexedDB) {
        console.log('💾 Explicitly caching plan details in IndexedDB (cacheInIndexedDB=true)');

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
          console.log('💾 SAVING PLAN DETAILS TO IndexedDB:', {
            id: record.id,
            sellerId: record.sellerId,
            data: record.data,
            unlockedModules: record.data?.unlockedModules,
            unlockedModulesType: typeof record.data?.unlockedModules,
            unlockedModulesLength: Array.isArray(record.data?.unlockedModules) ? record.data.unlockedModules.length : 'not array'
          });

          setTimeout(() => {
            updateInIndexedDB(STORES.planDetails, record).catch(error => {
              console.warn('❌ Failed to cache plan details in IndexedDB:', error);
            });
          }, 0);
        }
      } else if (action.payload) {
        console.log('💾 Skipping plan details cache in IndexedDB (cacheInIndexedDB=false or no payload)', {
          hasPayload: !!action.payload,
          cacheInIndexedDB: action.cacheInIndexedDB
        });
      }

      return {
        ...state,
        currentPlanDetails: action.payload,
        aggregatedUsage: aggregatedUsage
      };

    case ActionTypes.SET_AGGREGATED_USAGE:
      return {
        ...state,
        aggregatedUsage: action.payload
      };

    // SET_PLAN_ORDERS removed - using planDetails for limits and usage

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
          if (syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
          }
          // Trigger instant sync status update after IndexedDB save completes
          triggerSyncStatusUpdate();
        })
        .catch(err => console.error('IndexedDB save error:', err));

      const nextPlanDetails = !isSyncedRecord
        ? adjustPlanUsage(state.currentPlanDetails, { customers: 1 })
        : state.currentPlanDetails;

      return {
        ...state,
        customers: [newCustomer, ...state.customers],
        currentPlanDetails: nextPlanDetails
      };
    }

    case ActionTypes.UPDATE_CUSTOMER:
      console.log('🔄 UPDATE_CUSTOMER action received:', {
        customerId: action.payload.id,
        customerName: action.payload.name,
        isFromSyncCallback: action.payload.syncedAt !== undefined,
        isPaymentUpdate: action.payload.isPaymentUpdate,
        currentIsSynced: action.payload.isSynced,
        hasAllFields: !!(action.payload.name && action.payload.mobileNumber)
      });

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
        // If user edit, ALWAYS set isSynced: false (unless explicitly set in payload)
        isSynced: isFromSyncCallback ? true : (action.payload.isSynced !== undefined ? action.payload.isSynced : false),
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      console.log('🔄 UPDATE_CUSTOMER: Final customer object', {
        customerId: updatedCustomer.id,
        customerName: updatedCustomer.name,
        isSynced: updatedCustomer.isSynced,
        isPaymentUpdate: updatedCustomer.isPaymentUpdate,
        dueAmount: updatedCustomer.dueAmount,
        fromSyncCallback: isFromSyncCallback
      });

      updateInIndexedDB(STORES.customers, updatedCustomer)
        .then(() => {
          // Show success message for user edits (not sync callbacks)
          if (!isFromSyncCallback && window.showToast) {
            const customerName = action.payload.name || action.payload.mobileNumber || 'Customer';
            // Only show success for non-payment updates, payment updates have their own messages
            if (!action.payload.isUpdate) {
            window.showToast(`Customer "${customerName}" updated successfully!`, 'success');
            }
          }

          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          // Skip automatic sync for payment updates - they handle sync manually
          if (!action.payload.isPaymentUpdate && syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Customer updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {

          if (window.showToast) {
            window.showToast('Couldn\'t update customer. Please try again.', 'error');
          }
        });
      // Only update if customer actually changed
      const existingCustomer = state.customers.find(c => c.id === action.payload.id);
      if (existingCustomer && JSON.stringify(existingCustomer) === JSON.stringify(updatedCustomer)) {
        return state; // No change
      }
      // Trigger instant sync status update
      setTimeout(() => triggerSyncStatusUpdate(), 0);

      return {
        ...state,
        customers: state.customers.map(customer =>
          customer.id === action.payload.id ? updatedCustomer : customer
        )
      };

    case ActionTypes.DELETE_CUSTOMER:
      // Soft delete: Mark as deleted with isSynced: false instead of actually deleting
      const customerToDelete = state.customers.find(c => c.id === action.payload);
      if (customerToDelete) {

        const deletedCustomer = {
          ...customerToDelete,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          isSynced: false // Mark as unsynced so deletion syncs to backend
        };

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.customers, deletedCustomer, true) // Skip validation for soft delete
          .then(() => {

            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Customer deleted.', 'success');
            }
          })
          .catch(err => {

            if (window.showToast) {
              window.showToast('Couldn\'t delete customer. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        return {
          ...state,
          customers: state.customers.filter(c => c.id !== action.payload),
          currentPlanDetails: adjustPlanUsage(state.currentPlanDetails, { customers: -1 })
        };
      }
      return state;

    case ActionTypes.SET_PRODUCTS:

      // TEMPORARILY DISABLE arraysEqual check to force update
      // Only update if products array actually changed (prevent unnecessary re-renders)
      // if (arraysEqual(state.products, action.payload, 'products')) {
      //   //('🔄 REDUCER SET_PRODUCTS: Arrays equal, skipping update');
      //   return state;
      // }
      {
        const nextProducts = action.payload;

        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        const newState = {
          ...state,
          products: nextProducts,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };

        return newState;
      }

    case ActionTypes.SET_PRODUCT_BATCHES:
      return {
        ...state,
        productBatches: action.payload
      };

    case ActionTypes.UPDATE_PRODUCT_BATCH:
      console.log('[UPDATE_PRODUCT_BATCH] Updating batch:', {
        payload: { id: action.payload.id, _id: action.payload._id, productId: action.payload.productId },
        existingBatchesCount: state.productBatches.length
      });

      // Update existing product batch with new data from backend
      const updatedBatches = state.productBatches.map(batch => {
        const matches = batch.id === action.payload.id || batch._id === action.payload._id;
        if (matches) {
          console.log('[UPDATE_PRODUCT_BATCH] Found matching batch:', {
            batch: { id: batch.id, _id: batch._id },
            updatingTo: { id: action.payload.id, _id: action.payload._id }
          });
          return { ...batch, ...action.payload };
        }
        return batch;
      });

      // Also update the batch references in products, or add the batch if it's not associated yet
      const updatedProducts = state.products.map(product => {
        const productId = product._id || product.id;
        const shouldHaveThisBatch = productId === action.payload.productId ||
                                   productId?.toString() === action.payload.productId?.toString();

        if (shouldHaveThisBatch) {
          console.log('[UPDATE_PRODUCT_BATCH] Product should have this batch:', {
            product: { id: product.id, _id: product._id, name: product.name },
            batch: { id: action.payload.id, productId: action.payload.productId }
          });

          let updatedProductBatches = product.batches || [];

          // Check if batch is already in the product's batches
          const existingBatchIndex = updatedProductBatches.findIndex(batch =>
            batch.id === action.payload.id || batch._id === action.payload._id
          );

          if (existingBatchIndex >= 0) {
            // Update existing batch
            console.log('[UPDATE_PRODUCT_BATCH] Updating existing batch in product');
            updatedProductBatches[existingBatchIndex] = { ...updatedProductBatches[existingBatchIndex], ...action.payload };
          } else {
            // Add new batch to product
            console.log('[UPDATE_PRODUCT_BATCH] Adding new batch to product');
            updatedProductBatches = [...updatedProductBatches, action.payload];
          }

          return {
            ...product,
            batches: updatedProductBatches
          };
        } else if (product.batches && product.batches.length > 0) {
          // Update existing batch references in other products
          const updatedProductBatches = product.batches.map(batch =>
            batch.id === action.payload.id || batch._id === action.payload._id
              ? { ...batch, ...action.payload }
              : batch
          );
          return {
            ...product,
            batches: updatedProductBatches
          };
        }
        return product;
      });

      console.log('[UPDATE_PRODUCT_BATCH] Update complete:', {
        updatedBatchesCount: updatedBatches.length,
        updatedProductsCount: updatedProducts.length,
        productsWithBatches: updatedProducts.filter(p => p.batches?.length > 0).length
      });

      return {
        ...state,
        productBatches: updatedBatches,
        products: updatedProducts
      };

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
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
          }
          // Trigger instant sync status update after IndexedDB save completes
          triggerSyncStatusUpdate();
        })
        .catch(err => {

          if (window.showToast) {
            window.showToast('Couldn\'t save product. Please try again.', 'error');
          }
        });
      {

        const nextProducts = [newProduct, ...state.products];
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        return {
          ...state,
          products: nextProducts,
          currentPlanDetails: !isSyncedRecord
            ? adjustPlanUsage(state.currentPlanDetails, { products: 1 })
            : state.currentPlanDetails,
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

        if (window.showToast) {
          window.showToast('Error: Product ID is missing. Cannot update product.', 'error');
        }
        return state;
      }

      // Find existing product in state FIRST to get the exact id type
      const existingProductInState = state.products.find(p => 
        p.id === action.payload.id || 
        String(p.id) === String(action.payload.id) ||
        (action.payload._id && p._id && String(p._id) === String(action.payload._id))
      );

      if (!existingProductInState) {

        return state; // Don't update if product doesn't exist in state
      }

      // CRITICAL: Use _id as id if it exists (matches what syncToIndexedDB does)
      // When backend syncs, it sets id: _id, so we need to match that
      // If no _id, use the original id
      const exactId = existingProductInState._id || existingProductInState.id;

      // Build updated product - use exact id from existing product
      const existingBatches = existingProductInState.batches || [];
      const newBatches = action.payload.batches || [];

      // If payload has batches (like when adding new batches), use them
      // Otherwise preserve existing batches (for sync updates that shouldn't change batches)
      const finalBatches = newBatches.length > 0 ? newBatches : existingBatches;

      const updatedProduct = {
        ...existingProductInState, // Start with existing product to preserve all fields
        ...action.payload, // Override with updated fields from form
        // Handle batches appropriately
        batches: finalBatches,
        // CRITICAL: Use _id as id if it exists (matches what syncToIndexedDB does)
        // This ensures the product matches what's in IndexedDB after backend sync
        id: exactId, // This is _id if exists, otherwise original id
        // Preserve _id if it exists
        _id: existingProductInState._id || action.payload._id,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false (so it syncs to MongoDB)
        isSynced: isProductFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isProductFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isProductFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };

      // Step 1: Verify product exists in IndexedDB BEFORE updating
      getAllItems(STORES.products)
        .then(existingProductsInDB => {
          // Find product in IndexedDB by id or _id
          const productInDB = existingProductsInDB.find(p => 
            p.id === exactId || 
            p._id === exactId ||
            (existingProductInState._id && p._id && String(p._id) === String(existingProductInState._id)) ||
            (existingProductInState.id && p.id === existingProductInState.id)
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

          // Step 2: Save to IndexedDB (put() will update because id matches)
          return updateInIndexedDB(STORES.products, updatedProduct);
        })
        .then(() => {

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

            // Verify the data actually changed
            if (savedProduct.name === updatedProduct.name && 
                savedProduct.quantity === updatedProduct.quantity) {

            } else {

            }
          } else {

          }

          // Step 4: After IndexedDB save succeeds, sync to MongoDB if online
          if (syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Product updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {

          console.error('Product data:', JSON.stringify(updatedProduct, null, 2));
          if (window.showToast) {
            window.showToast(`Couldn't update product: ${err.message}`, 'error');
          }
        });

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

            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Product deleted.', 'success');
            }
          })
          .catch(err => {

            if (window.showToast) {
              window.showToast('Couldn\'t delete product. Please try again.', 'error');
            }
          });

        // Remove from state (UI) but keep in IndexedDB for sync
        const nextProducts = state.products.filter(p => p.id !== action.payload);
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        return {
          ...state,
          products: nextProducts,
          currentPlanDetails: adjustPlanUsage(state.currentPlanDetails, { products: -1 }),
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

      const ordersWithStockFlag = action.payload.map(order => {
        // Always mark loaded orders as having stock deducted (they're from backend/IndexedDB)
        // Only preserve false if explicitly set (shouldn't happen for loaded orders)
        const stockDeducted = order.stockDeducted === false ? false : true;

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
      const isSyncedRecord = action.payload?.isSynced === true || action.payload?.syncedAt;

      if (!isSyncedRecord) {
        const capacity = checkPlanCapacity(state, 'order');
        if (!capacity.allowed) {
          if (window.showToast) {
            window.showToast(capacity.message, 'warning', 5000);
          }

          return state;
        }
      }

      const newOrder = {
        ...action.payload,
        isSynced: action.payload?.isSynced ?? false
      };

      // Validate order has all required fields before saving
      if (!newOrder.id) {

        if (window.showToast) {
          window.showToast('Order creation failed: Missing order ID', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.sellerId) {

        if (window.showToast) {
          window.showToast('Order creation failed: User not authenticated', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.items || newOrder.items.length === 0) {

        if (window.showToast) {
          window.showToast('Order creation failed: No items in order', 'error');
        }
        return state; // Don't update state if validation fails
      }

      if (!newOrder.totalAmount || newOrder.totalAmount <= 0) {

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
        items: newOrder.items.map(item => ({
          ...item,
          costPrice: typeof item.costPrice === 'number' ? item.costPrice : 0,
          sellingPrice: typeof item.sellingPrice === 'number' ? item.sellingPrice : 0,
          quantity: typeof item.quantity === 'number' ? item.quantity : 1
        }))
      };

      // Create order hash for duplicate detection
      const orderHash = createOrderHash(validatedOrder);

      // ATOMIC CHECK: Check and set pending flag in one operation to prevent race conditions
      const isOnlineStatus = syncService.isOnline();
      if (isOnlineStatus) {
        // Check if an API call is already in progress for this order content
        if (pendingOrderApiCalls.has(orderHash)) {
          const existingOrderId = pendingOrderApiCalls.get(orderHash);
          console.warn('🚫 [ADD_ORDER] BLOCKED - Duplicate order prevented (pending API call exists):', existingOrderId);

          console.warn('🚫 [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
          // Don't process this order at all - return state without changes
          return state;
        }

        // Mark this order as being processed IMMEDIATELY (atomically, before any async operations)
        pendingOrderApiCalls.set(orderHash, validatedOrder.id);
      }

      // Check if we just added an identical order in the last 5 seconds (state check)
      // This catches React Strict Mode double renders
      const recentOrder = state.orders.find(o => {
        if (!o || !o.createdAt) return false;
        const orderDate = new Date(o.createdAt);
        const now = new Date();
        const timeDiff = now.getTime() - orderDate.getTime();
        // Check if order was created in last 5 seconds
        if (timeDiff > 5000) return false;

        // Check if order has same hash
        const existingHash = createOrderHash(o);
        return existingHash === orderHash;
      });

      if (recentOrder) {
        console.warn('🚫 [ADD_ORDER] BLOCKED - Duplicate order detected in state (created within 5s):', recentOrder.id);

        console.warn('🚫 [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
        // Remove from pending calls if we added it
        if (isOnlineStatus && pendingOrderApiCalls.has(orderHash)) {
          pendingOrderApiCalls.delete(orderHash);
        }
        // Don't process this duplicate order
        return state;
      }

      // Save to IndexedDB FIRST (always save locally)

      //('💾 Order data being saved:', JSON.stringify(validatedOrder, null, 2));

      updateInIndexedDB(STORES.orders, validatedOrder, true) // Skip validation since we validated above
        .then(async (result) => {

          // IMMEDIATELY update inventory after order is saved to IndexedDB (works offline)
          try {
            const inventoryResult = await updateInventoryAfterSale(validatedOrder);
            if (!inventoryResult.success) {

            } else {
            }
          } catch (inventoryError) {

          }

          // Verify order was saved
          setTimeout(async () => {
            try {
              const allOrders = await getAllItems(STORES.orders);
              const savedOrder = allOrders.find(o => o.id === validatedOrder.id || o.id?.toString() === validatedOrder.id?.toString());
              if (savedOrder) {

              } else {

                console.error('❌ All orders in IndexedDB:', allOrders.map(o => ({ id: o.id, _id: o._id })));
              }
            } catch (verifyErr) {

            }
          }, 100);

          // Step 2: Create order on backend immediately if online (ONE TIME ONLY)
          // Note: Duplicate check already done above, and order is already marked as pending
          if (isOnlineStatus && pendingOrderApiCalls.has(createOrderHash(validatedOrder))) {
            // Use a small delay to ensure IndexedDB write is complete
            setTimeout(async () => {
              const orderHash = createOrderHash(validatedOrder);
              // Double-check that this order is still pending (in case it was removed)
              if (!pendingOrderApiCalls.has(orderHash)) {

                return;
              }

              try {
                // ONE-TIME API call - no retries, no fallback
                if (typeof createOrder !== 'function') {

                  throw new Error('createOrder function not available');
                }

                const createResult = await createOrder(validatedOrder);

                // Remove from pending calls immediately after API call (success or failure)
                pendingOrderApiCalls.delete(orderHash);

                if (createResult.success) {

                  // Update order in IndexedDB with _id and isSynced: true
                  // Preserve stockDeducted flag (should be true since stock was already deducted)
                  const syncedOrder = {
                    ...validatedOrder,
                    _id: createResult._id,
                    isSynced: true,
                    syncedAt: new Date().toISOString(),
                    stockDeducted: validatedOrder.stockDeducted !== undefined ? validatedOrder.stockDeducted : true // Ensure flag is preserved
                  };

                  updateInIndexedDB(STORES.orders, syncedOrder, true) // Skip validation for synced order
                    .then(() => {

                      // Always update React state with synced order (add if doesn't exist, update if exists)
                      if (globalDispatch) {
                        globalDispatch({ type: ActionTypes.UPDATE_ORDER, payload: syncedOrder, meta: { fromSync: true } });
                      }
                    })
                    .catch(syncErr => {

                    });

                  // if (window.showToast) {
                  //   // window.showToast('Order created.', 'success');
                  // }
                } else {
                  // API call failed - don't retry, just mark as unsynced and let sync service handle it
                  console.warn('⚠️ [ADD_ORDER] API call failed (ONE-TIME attempt):', createResult.error);

                  // Order is already saved to IndexedDB with isSynced: false (from validatedOrder)
                  // No need to update it - it will be picked up by the sync service automatically

                  if (window.showToast) {
                    window.showToast('Order saved. We\'ll sync it shortly.', 'info');
                  }
                }
              } catch (error) {
                // API call threw an error - don't retry, just mark as unsynced
                console.error('❌ [ADD_ORDER] Error creating order on backend (ONE-TIME attempt failed):', error);

                // Remove from pending calls on error (already done above, but just in case)
                pendingOrderApiCalls.delete(orderHash);

                // Order is already saved to IndexedDB with isSynced: false
                // No need to retry - background sync service will handle it

                if (window.showToast) {
                  window.showToast('Order saved. We\'ll sync it shortly.', 'info');
                }
              }
            }, 200);
          } else if (!isOnlineStatus) {

            if (window.showToast) {
              window.showToast('Order saved offline. We\'ll sync once you\'re online.', 'success');
            }
          }
        })
        .catch(err => {

          console.error('Order data that failed:', JSON.stringify(validatedOrder, null, 2));

          // Check if it's a validation error
          if (err.message && err.message.includes('Validation failed')) {

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
        return {
          ...state,
          orders: nextOrders,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          currentPlanDetails: !isSyncedRecord
            ? adjustPlanUsage(state.currentPlanDetails, { orders: 1 })
            : state.currentPlanDetails,
          dashboardTotals: derived.totals || state.dashboardTotals
        };

        // Trigger instant sync status update
        triggerSyncStatusUpdate();
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
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Order updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {

        });

      // Find existing order by id or _id (handle both cases)
      const existingOrder = state.orders.find(order => 
        order.id === action.payload.id || 
        order._id === action.payload.id || 
        order.id === action.payload._id ||
        order._id === action.payload._id
      );

      // If order doesn't exist, add it (important for orders created online)
      if (!existingOrder) {

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
        (order.id === action.payload.id || order._id === action.payload.id || order.id === action.payload._id || order._id === action.payload._id)
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
      const orderToDelete = state.orders.find(o => o.id === action.payload);
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

            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Order deleted.', 'success');
            }
          })
          .catch(err => {

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
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
      }
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

      // If this is from a sync callback, trigger instant sync status update
      if (isPOFromSyncCallback) {
        triggerSyncStatusUpdate();
      }

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
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Purchase order updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {

          if (window.showToast) {
            window.showToast('Couldn\'t update purchase order. Please try again.', 'error');
          }
        });
      // Only update if purchase order actually changed
      const existingPO = state.purchaseOrders.find(po => po.id === action.payload.id);
      if (existingPO && JSON.stringify(existingPO) === JSON.stringify(updatedPO)) {
        return state; // No change
      }
      return {
        ...state,
        purchaseOrders: state.purchaseOrders.map(po =>
          po.id === action.payload.id ? updatedPO : po
        )
      };

    case ActionTypes.REPLACE_PURCHASE_ORDER:
      // Replace a purchase order (used during sync when local temp ID is replaced with MongoDB ID)
      const { tempId, newOrder } = action.payload;

      state.purchaseOrders.forEach((po, index) => {

      });

      const existingOrderIndex = state.purchaseOrders.findIndex(po => po.id === tempId);

      if (existingOrderIndex === -1) {

        //('⚠️ [REPLACE_PURCHASE_ORDER] Available order IDs:', state.purchaseOrders.map(po => po.id));

        // Check if order with MongoDB ID already exists (prevent duplicates)
        const mongoOrderExists = state.purchaseOrders.some(po => po.id === newOrder.id);
        if (mongoOrderExists) {

          return {
            ...state,
            purchaseOrders: state.purchaseOrders.map(po =>
              po.id === newOrder.id ? { ...newOrder, isSynced: true } : po
            )
          };
        } else {

          return {
            ...state,
            purchaseOrders: [...state.purchaseOrders, { ...newOrder, isSynced: true }]
          };
        }
      }

      // Replace the temp order with the MongoDB order
      const updatedOrders = [...state.purchaseOrders];
      updatedOrders[existingOrderIndex] = { ...newOrder, isSynced: true };

      //('✅ [REPLACE_PURCHASE_ORDER] Replacement completed. New state orders:', updatedOrders.map(po => ({ id: po.id, isSynced: po.isSynced })));

      return {
        ...state,
        purchaseOrders: updatedOrders
      };

    case ActionTypes.REMOVE_PURCHASE_ORDER_BY_ID:
      // Remove a purchase order by ID (used for cleanup during sync)
      const orderIdToRemove = action.payload;

      state.purchaseOrders.forEach((po, index) => {

      });

      const filteredOrders = state.purchaseOrders.filter(po => po.id !== orderIdToRemove);
      //('🗑️ [REMOVE_PURCHASE_ORDER_BY_ID] Orders after removal:', filteredOrders.map(po => ({ id: po.id, supplier: po.supplierName })));

      return {
        ...state,
        purchaseOrders: filteredOrders
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

        //('🗑️ [DELETE_PURCHASE_ORDER] Deleted PO data:', JSON.stringify(deletedPO, null, 2));

        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.purchaseOrders, deletedPO, true) // Skip validation for soft delete
          .then(() => {

            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {

              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            } else {

            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Purchase order deleted.', 'success');
            }
          })
          .catch(err => {

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
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
      }
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

      // If this is from a sync callback, trigger instant sync status update
      if (isTxFromSyncCallback) {
        triggerSyncStatusUpdate();
      }

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
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Transaction updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {

          if (window.showToast) {
            window.showToast('Couldn\'t update transaction. Please try again.', 'error');
          }
        });
      // Only update if transaction actually changed
      const existingTransaction = state.transactions.find(t => t.id === action.payload.id);
      if (existingTransaction && JSON.stringify(existingTransaction) === JSON.stringify(updatedTransaction)) {
        return state; // No change
      }
      return {
        ...state,
        transactions: state.transactions.map(transaction =>
          transaction.id === action.payload.id ? updatedTransaction : transaction
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
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
      }
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

      // If this is from a sync callback, trigger instant sync status update
      if (isCategoryFromSyncCallback) {
        triggerSyncStatusUpdate();
      }

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
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Category updated locally but sync failed. Will retry automatically.', 'warning');
              }
            });
          }
        })
        .catch(err => {

          if (window.showToast) {
            window.showToast(`Failed to update category: ${err.message}`, 'error');
          }
        });

      // Only update if category actually changed
      const existingCategory = state.categories.find(c => c.id === action.payload.id);
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

            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            }
            // Show success toast
            if (window.showToast) {
              window.showToast('Category deleted successfully', 'success');
            }
          })
          .catch(err => {

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

        }
      }
      return {
        ...state,
        currentUser: updatedUser,
        upiId: updatedUser?.upiId !== undefined ? (updatedUser.upiId || '') : state.upiId
      };
    }

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
    inFlight: false,
    refreshing: false,
    lastAttemptKey: null,
    lastAttemptAt: 0,
    lastRefreshAt: 0
  });
  const upgradePromptState = useRef({
    lastTriggered: 0,
    hasShown: false
  });
  const lastSavedPlanDetailsRef = useRef({
    sellerId: null,
    hash: null
  });

  // Initialize offline sync system
  useEffect(() => {

    initializeOfflineSync(dispatch, ActionTypes);
  }, [dispatch]);

  const refreshCurrentPlanDetails = useCallback(async () => {

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

        return state.currentUser?.sellerId || null;
      }
    };

    const currentSellerId = verifySellerId();
    if (!currentSellerId) {

      return { success: false, error: 'Seller ID not available' };
    }

    try {
      const [planResult, usageResult] = await Promise.all([
        apiRequest('/data/current-plan'),
        apiRequest('/plans/usage')
      ]);

      const planPayload = planResult.success && planResult.data
        ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
        : null;

      const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
        ? usageResult.data
        : null;

      let combined = mergePlanDetailsWithUsage(planPayload, usagePayload);
      if (!combined && planPayload) {
        combined = { ...planPayload };
      }

      if (combined) {
        // Only update if data has actually changed to avoid unnecessary re-renders
        const currentPlanDetails = state.currentPlanDetails;
        const hasChanged = !currentPlanDetails || JSON.stringify(currentPlanDetails) !== JSON.stringify(combined);

        if (hasChanged) {

          if (combined.planId) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combined.planId });
          } else if (planPayload?.planId) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planPayload.planId });
          }

          dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combined || null, cacheInIndexedDB: false });

          // Only cache plan details in IndexedDB when explicitly on upgrade page
          const isOnUpgradePage = state.currentView === 'upgrade';
          if (isOnUpgradePage) {
            console.log('💾 Caching plan details in IndexedDB (on upgrade page)');

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
                data: combined,
                lastUpdated: new Date().toISOString()
              };

              updateInIndexedDB(STORES.planDetails, record).then(() => {
                console.log('✅ Plan details cached in IndexedDB');
              }).catch(cacheError => {
                console.warn('❌ Failed to cache plan details in IndexedDB:', cacheError);
              });
            }
          } else {
            console.log('💾 Skipping plan details cache in IndexedDB (not on upgrade page)', {
              currentView: state.currentView
            });
          }
        } else {

        }

        // Check if current plan is paused and can be reactivated
        if (combined && combined.status === 'paused' && combined.remainingMs > 0) {

          try {
            const reactivateResult = await apiRequest('/plans/reactivate-current', {
              method: 'POST'
            });

            if (reactivateResult.success) {

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

                  if (updatedCombined.planId) {
                    dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: updatedCombined.planId });
                  }
                  dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: updatedCombined, cacheInIndexedDB: false });
                }
              }
            } else {

            }
          } catch (reactivateError) {

          }
        }

        // Check if current plan is expired/invalid and try to switch to a valid alternative
        if (combined && (combined.isExpired || combined.status === 'expired' || (combined.remainingMs !== undefined && combined.remainingMs <= 0))) {

          try {
            const switchResult = await apiRequest('/plans/switch-to-valid', {
              method: 'POST'
            });

            if (switchResult.success) {

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

                  if (switchedCombined.planId) {
                    dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: switchedCombined.planId });
                  }
                  dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: switchedCombined, cacheInIndexedDB: false });
                }
              }
            } else {

            }
          } catch (switchError) {

          }
        }
      }
    } catch (error) {

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

        return;
      }

      try {
        const cachedPlanDetails = await getAllItems(STORES.planDetails).catch(() => []);
        const planRecord = cachedPlanDetails.find(record => record && record.sellerId === sellerId);

        if (planRecord?.data) {

          dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: planRecord.data, cacheInIndexedDB: false });
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

          // Fetch fresh data in background
          setTimeout(async () => {
            try {

              await refreshCurrentPlanDetails();
            } catch (error) {

            }
          }, 500); // Small delay to let cached data settle

        } else {

          // No cache, fetch from server
          try {
            //('🌐 Fetching plan details from server (no cache available)...');
            await refreshCurrentPlanDetails();
          } catch (error) {

          }
        }
      } catch (error) {

        // Still try to fetch from server
        try {
          await refreshCurrentPlanDetails();
        } catch (fetchError) {

        }
      }
    };

    loadPlanDetailsFromCache();
  }, [state.currentUser?.sellerId, state.currentUser?.id, state.currentUser?._id, state.sellerId]);

  // Logout function with unsynced data protection
  const logoutWithDataProtection = async () => {
    try {

      // Check for unsynced data before clearing IndexedDB
      const [products, customers, orders, transactions, purchaseOrders, productBatches] = await Promise.all([
        getAllItems(STORES.products).catch(() => []),
        getAllItems(STORES.customers).catch(() => []),
        getAllItems(STORES.orders).catch(() => []),
        getAllItems(STORES.transactions).catch(() => []),
        getAllItems(STORES.purchaseOrders).catch(() => []),
        getAllItems(STORES.productBatches).catch(() => [])
      ]);

      // Check if all items are synced (isSynced flag)
      const allData = [...products, ...customers, ...orders, ...transactions, ...purchaseOrders, ...productBatches];
      const hasUnsyncedData = allData.some(item =>
        item && item.isSynced === false
      );

      if (hasUnsyncedData) {

        // Show warning toast with clear instructions
        if (window.showToast) {
          window.showToast('Cannot logout - you have unsynced data. Please connect to internet and sync your data to cloud first, otherwise this data may be lost.', 'warning');
        }

        // Don't proceed with logout
        return false;
      }

      dispatch({ type: ActionTypes.LOGOUT });
      return true;
    } catch (error) {

      // If we can't check, assume there might be unsynced data to be safe
      if (window.showToast) {
        window.showToast('Unable to verify data sync status. Please sync data before logging out.', 'warning');
      }
      return false;
    }
  };

  // Store dispatch reference for async operations
  useEffect(() => {
    setGlobalDispatch(dispatch);
    // Also set on window for global access (needed for auto-logout)
    window.globalDispatch = dispatch;
  }, [dispatch]);

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

          return;
        }
      }

      try {

        await refreshCurrentPlanDetails();
      } catch (error) {

      }
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(interval);
  }, [state.currentUser?.sellerId, state.systemStatus, refreshCurrentPlanDetails]);

  // Set store functions provider for sync service
  useEffect(() => {
    setStoreFunctionsProvider(getStoreFunctions);
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
        case 'productBatches':
          globalDispatch({ type: ActionTypes.UPDATE_PRODUCT_BATCH, payload: syncedItem });
          break;
        case 'refunds':
          // Refunds don't have a state action yet, but we can log it

          break;
        default:

      }
    });

    // Set callback to trigger sync status update when sync completes
    setOnSyncCompletedCallback(async (syncResult) => {
      console.log('🔄🔄🔄 SYNC COMPLETED CALLBACK TRIGGERED:', {
        success: syncResult?.success,
        totalSynced: syncResult?.totalSynced,
        totalFailed: syncResult?.totalFailed,
        results: syncResult?.results
      });

      // Trigger sync status update to recalculate progress
      triggerSyncStatusUpdate();

      // If sync was successful, trigger a full data refresh to get updated quantities
      if (syncResult && syncResult.success) {
        console.log('🔄 SYNC COMPLETED: Triggering full data refresh to get updated product quantities');
        try {
          // Trigger a full data refresh by calling the /all API
          await fetchAllData();
        } catch (error) {
          console.error('❌ SYNC COMPLETED: Error refreshing data after sync:', error);
        }
      }
    });
  }, []);

  // Listen for service worker messages (sync triggers, etc.)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = async (event) => {
      if (event.data?.type === 'TRIGGER_SYNC') {

          try {
            const onlineStatus = await isOnline();
            if (onlineStatus && state.isAuthenticated) {
              // Trigger sync when back online
              await syncService.syncAll(getStoreFunctions);
              if (window.showToast) {
                window.showToast('Data synced successfully', 'success');
              }
            }
          } catch (error) {

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

    // Only load data if user is authenticated
    if (!state.isAuthenticated) {

      return;
    }

    // Data loading is now handled by the pageshow event listener

  }, [state.currentUser, dispatch]);

  // Handle page refresh detection and API calls
  useEffect(() => {

    // Reset session flag on component mount (new page load)
    window.loadDataCalledForSession = false;

    // Call API on initial load and browser refreshes
    const handlePageShow = (event) => {
      // Only call API if user is authenticated
      if (!state.isAuthenticated) {

        return;
      }

      // event.persisted is true when page is loaded from cache (back/forward navigation)
      // event.persisted is false when page is loaded fresh (refresh, first load, direct navigation)
      if (!event.persisted) {
        // Check if background sync was recently completed after login (within last 30 seconds)
        const backgroundSyncTime = sessionStorage.getItem('backgroundSyncCompleted');
        const now = Date.now();
        const timeSinceBackgroundSync = backgroundSyncTime ? now - parseInt(backgroundSyncTime) : Infinity;

        if (timeSinceBackgroundSync < 30000) {

          window.loadDataCalledForSession = true;
          window.lastLoadDataTime = Date.now();
          // Clear the flag since we've handled it
          sessionStorage.removeItem('backgroundSyncCompleted');
        } else {

          window.loadDataCalledForSession = true;
          window.lastLoadDataTime = Date.now();
          loadData();
        }
      } else {
        //('🔄 AppContext: Page loaded from cache (navigation) - skipping API call');
      }
    };

    // Listen for pageshow event (fires when page becomes visible)
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [state.isAuthenticated]); // Add isAuthenticated as dependency

  // Data loading is now handled entirely by the pageshow event
  // This prevents race conditions and duplicate API calls

  // Track loadData calls
  let loadDataCallCount = 0;

  // Load data function (defined outside useEffect for manualRefresh access)
  const loadData = useCallback(async () => {
    // Prevent multiple simultaneous loadData calls
    if (window.loadDataInProgress) {
      //(`[LOAD DATA] Another loadData call is already in progress, skipping this call (flag: ${window.loadDataInProgress})`);
      return;
    }

    window.loadDataInProgress = true;

    loadDataCallCount++;

    // Import network utilities for connection-aware loading
    const { isSlowConnection } = await import('../utils/networkRetry');

    const slowConnection = isSlowConnection();

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

      //(`🔗 DEBUG: First few products:`, indexedDBProducts.slice(0, 2).map(p => ({ name: p.name, id: p.id || p._id, stock: p.stock })));
      //(`🔗 DEBUG: First few batches:`, indexedDBProductBatches.slice(0, 2).map(b => ({ id: b.id, productId: b.productId, quantity: b.quantity })));

      // Load plan details from IndexedDB if available
      if (indexedDBPlanDetails.length > 0) {
        const planRecord = indexedDBPlanDetails[0]; // Should only be one current plan
        const currentPlanDetails = planRecord.data || planRecord; // Handle both structures

        console.log('📋 LOADING PLAN DETAILS FROM IndexedDB:', {
          recordId: planRecord.id,
          hasDataField: !!planRecord.data,
          planId: currentPlanDetails.planId,
          unlockedModules: currentPlanDetails.unlockedModules,
          unlockedModulesType: typeof currentPlanDetails.unlockedModules,
          unlockedModulesLength: Array.isArray(currentPlanDetails.unlockedModules) ? currentPlanDetails.unlockedModules.length : 'not array',
          isExpired: currentPlanDetails.isExpired,
          fullDetails: currentPlanDetails
        });

        // Ensure unlockedModules is an array
        if (currentPlanDetails && !Array.isArray(currentPlanDetails.unlockedModules)) {
          console.warn('⚠️ unlockedModules is not an array, fixing:', currentPlanDetails.unlockedModules);
          currentPlanDetails.unlockedModules = currentPlanDetails.unlockedModules ?
            [currentPlanDetails.unlockedModules] : [];
        }

        dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: currentPlanDetails, cacheInIndexedDB: false });
        if (currentPlanDetails.planId) {
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: currentPlanDetails.planId });
        }

        // Set subscription active status based on plan data
        const hasActivePlan = currentPlanDetails && !currentPlanDetails.isExpired;
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: hasActivePlan });
      } else {
        console.log('📋 NO PLAN DETAILS FOUND IN IndexedDB');
      }

      // Associate batches with products for stock calculations
      const activeProducts = indexedDBProducts.filter(i => i.isDeleted !== true);
      const activeBatches = indexedDBProductBatches.filter(i => i.isDeleted !== true);

      //(`🔗 DEBUG: Sample products:`, activeProducts.slice(0, 2).map(p => ({ name: p.name, id: p.id })));
      //(`🔗 DEBUG: Sample batches:`, activeBatches.slice(0, 2).map(b => ({ productId: b.productId, quantity: b.quantity })));

      // Ensure batches are properly normalized (in case they weren't normalized when saved)
      const normalizedBatches = activeBatches.map(batch => normalizeProductBatch(batch));

      // Check if any batches had their productId fixed
      const fixedBatches = normalizedBatches.filter((batch, index) => batch.productId !== activeBatches[index].productId);
      if (fixedBatches.length > 0) {

        console.log(`🔗 NORMALIZE: Fixed batches:`, fixedBatches.map(b => ({
          id: b.id,
          oldProductId: activeBatches.find(ab => ab.id === b.id)?.productId,
          newProductId: b.productId,
          quantity: b.quantity
        })));
      }

      const productsWithBatches = associateBatchesWithProducts(activeProducts, normalizedBatches);

      //(`🔗 DEBUG: Association complete. Sample results:`, productsWithBatches.slice(0, 3).map(p => ({ name: p.name, batchCount: p.batches?.length || 0 })));

      // Check for specific products that should have batches
      const productsWithBatchesCount = productsWithBatches.filter(p => p.batches && p.batches.length > 0).length;

      // Find products that should have batches but don't
      const productsWithoutBatches = productsWithBatches.filter(p => (!p.batches || p.batches.length === 0) && normalizedBatches.some(b => b.productId === p.id || b.productId === p._id));
      if (productsWithoutBatches.length > 0) {
        //(`🔗 DEBUG: Products that should have batches but don't:`, productsWithoutBatches.map(p => ({ name: p.name, id: p.id })));
        //(`🔗 DEBUG: Available batches for debugging:`, normalizedBatches.map(b => ({ productId: b.productId, quantity: b.quantity })));
      }

      // Update state with essential IndexedDB data immediately

      if (productsWithBatches.length > 0) {
        console.log(`🔄 STATE UPDATE: Products being set:`, productsWithBatches.slice(0, 3).map(p => ({
          name: p.name,
          id: p.id,
          hasBatches: !!p.batches,
          batchCount: p.batches?.length || 0
        })));

        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: productsWithBatches });

      }
      if (normalizedBatches.length > 0) {
        dispatch({ type: ActionTypes.SET_PRODUCT_BATCHES, payload: normalizedBatches });

      }
      if (indexedDBCategories.length > 0) {
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: indexedDBCategories.filter(i => i.isDeleted !== true) });
      }

      // Load additional data based on connection speed
      let indexedDBCustomers = [];
      let indexedDBOrders = [];
      let indexedDBTransactions = [];
      let indexedDBPurchaseOrders = [];
      if (!loadEssentialDataOnly) {
        const additionalPromises = [
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => [])
          // planOrders removed - using planDetails for limits and usage
        ];

        [indexedDBCustomers, indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders] = await Promise.all(additionalPromises);

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
// planOrders no longer stored in IndexedDB - using planDetails for limits and usage
      } else {
        dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'partial' } });
      }

      // Step 2: Sync with backend if online

      const isOnlineStatus = await isOnline();

      dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: isOnlineStatus ? 'online' : 'offline' });

      if (isOnlineStatus) {

        try {
          // Step A: First push all unsynced IndexedDB changes to MongoDB
          console.log('🔄🔄🔄 STARTING SYNC ALL');
          try {
            await syncService.syncAll(getStoreFunctions);
            console.log('🔄🔄🔄 SYNC ALL COMPLETED');
          } catch (syncErr) {
            console.error('🔄🔄🔄 SYNC ALL ERROR:', syncErr);
          }

          // Mark data as being loaded
          dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'loading' } });

          // Perform auto-refresh of latest data
          console.log('🔄🔄🔄 STARTING AUTO REFRESH');
          try {
            const refreshResult = await autoRefreshLatestData();
            console.log('🔄🔄🔄 AUTO REFRESH COMPLETED:', refreshResult);
            // Check if plan is invalid - don't lock UI, just show warning
            if (refreshResult.planInvalid === true) {
              // Show plan expired warning but don't lock UI or redirect
              if (window.showToast) {
                window.showToast('Your plan has expired. You can still view data but cannot create, update, or delete items. Please upgrade your plan.', 'warning', 8000);
              }

              // Continue with normal data loading - user can still see their data
              // Backend will prevent operations for expired plans
            }

            if (refreshResult.success && refreshResult.data) {

              //('🔄 UI Update: Processing data for Redux:', Object.keys(refreshResult.data));

              // Mark data as fresh immediately after successful delta sync

              dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'fresh' } });

              // Always refresh plan orders on app load when online
              try {

                const planOrdersResult = await apiRequest('/data/plan-orders');
                if (planOrdersResult.success && planOrdersResult.data) {
                  const planOrdersData = Array.isArray(planOrdersResult.data)
                    ? planOrdersResult.data
                    : planOrdersResult.data.data || [];

                  // Clear existing plan orders and add fresh ones
                  await clearAllItems(STORES.planOrders);
                  if (planOrdersData.length > 0) {
                    await addMultipleItems(STORES.planOrders, planOrdersData);
                  }

                  // Update UI state with fresh plan orders
                  // planOrders no longer stored in IndexedDB - using planDetails for limits and usage
                } else {

                }
              } catch (planOrdersError) {

              }

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

              }

              if (batchesData && Array.isArray(batchesData)) {
                const filteredBatches = batchesData.filter(item => item.isDeleted !== true);

                dispatch({
                  type: ActionTypes.SET_PRODUCT_BATCHES,
                  payload: filteredBatches
                });

              }

              // Handle other data types
              for (const [dataType, dataInfo] of Object.entries(refreshResult.data)) {
                if (dataType === 'products' || dataType === 'productBatches') {
                  continue; // Already handled above
                }

                if (dataInfo.data && Array.isArray(dataInfo.data)) {

                  if (dataInfo.data.length > 0) {

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

                  } else {

                  }
                } else {

                }
              }
            }
          } catch (refreshError) {
            console.error('🔄🔄🔄 AUTO REFRESH ERROR:', refreshError);

            // Continue with existing data if refresh fails
          }
        } catch (backendError) {

          // Keep IndexedDB data that was already shown
        }
      } else {

      }

      // Mark data as fresh
      dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'fresh' } });
    } catch (error) {

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

      window.loadDataInProgress = false;
    }
  }, [state.currentUser, dispatch]);

  // Manual refresh function for debugging
  const manualRefresh = useCallback(async () => {

    await loadData();
  }, [loadData]);

  // Function to load additional data on demand (for slow connections)
  const loadAdditionalData = useCallback(async () => {
    if (state.dataFreshness === 'partial') {

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

        dispatch({ type: ActionTypes.SET_DATA_FRESHNESS, payload: { freshness: 'full' } });

      } catch (error) {

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
      return;
    }

    // Reload data when user changes - show IndexedDB first, then fetch from backend
    const loadUserData = async () => {
      try {
        // Step 1: Load from IndexedDB FIRST (immediate display)
        const [indexedDBCustomers, indexedDBProducts, indexedDBProductBatches, indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders, indexedDBCategories, indexedDBPlanDetails, activities] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.productBatches).catch(() => []), // Load batches for association
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.planDetails).catch(() => []),
          getAllItems(STORES.activities).catch(() => [])
          // planOrders removed - using planDetails for limits and usage
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
        // planOrders no longer stored in IndexedDB - using planDetails for limits and usage
        dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: activities || [] });

        // Load plan details from IndexedDB for instant sidebar unlock
        const sellerId = state.currentUser?.sellerId || null;
        if (sellerId) {
          const planRecord = (indexedDBPlanDetails || []).find(record => record && record.sellerId === sellerId);
          if (planRecord?.data && !state.currentPlanDetails) {
            const planDetails = planRecord.data;

            // Ensure unlockedModules is an array
            if (planDetails && !Array.isArray(planDetails.unlockedModules)) {
              console.warn('⚠️ unlockedModules is not an array in loaded plan details, fixing:', planDetails.unlockedModules);
              planDetails.unlockedModules = planDetails.unlockedModules ?
                [planDetails.unlockedModules] : [];
            }

            console.log('📋 LOADING PLAN DETAILS FROM IndexedDB (alternative location):', {
              planId: planDetails.planId,
              unlockedModules: planDetails.unlockedModules,
              unlockedModulesType: typeof planDetails.unlockedModules,
              unlockedModulesLength: Array.isArray(planDetails.unlockedModules) ? planDetails.unlockedModules.length : 'not array'
            });

            dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: planDetails, cacheInIndexedDB: false });
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
              await syncService.syncAll(getStoreFunctions);
            } catch (syncErr) {

            }
          } catch (backendError) {

          }

          // Background plan details refresh (non-blocking, delayed)
          setTimeout(async () => {
            try {

              const [planResult, usageResult] = await Promise.all([
                apiRequest('/data/current-plan'),
                apiRequest('/plans/usage')
              ]);

              const planPayload = planResult.success && planResult.data
                ? (Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data)
                : null;

              const usagePayload = usageResult.success && usageResult.data && usageResult.data.summary
                ? usageResult.data
                : null;

              let combined = mergePlanDetailsWithUsage(planPayload, usagePayload);
              if (!combined && planPayload) {
                combined = { ...planPayload };
              }

              if (combined) {

                // Only update if data has changed
                const currentData = state.currentPlanDetails;
                const hasChanged = !currentData || JSON.stringify(currentData) !== JSON.stringify(combined);

                if (hasChanged) {

                  if (combined.planId) {
                    dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combined.planId });
                  }
                  dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combined || null, cacheInIndexedDB: false });
                } else {

                }
              }
            } catch (error) {

            }
          }, 2000); // Longer delay to prioritize user interaction
        }
      } catch (error) {

        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'offline' });
      }
    };

    loadUserData();

    // For sellers, ensure plan details are loaded/refreshed

    if (state.currentUser?.userType === 'seller' || state.currentUser?.sellerId) {

      refreshCurrentPlanDetails().catch(error => {

      });
    } else {

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
      // Allow access to all pages even with expired plans
      return;
    }

    const activeOrders = completedOrders.filter((order) => !isPlanOrderExpired(order, now));
    if (activeOrders.length === 0) {
      if (state.isSubscriptionActive !== false) {
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: false });
      }
      showUpgradePrompt();
      // Allow access to all pages even with expired plans
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
        // Allow access to all pages even with expired plans
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Allow access even when offline - don't redirect
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

          showUpgradePrompt();
          // Allow access to all pages even when plan switching fails
        }
      } catch (error) {

        showUpgradePrompt();
        // Allow access to all pages even when plan switching fails
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

    try {
      const result = await apiRequest('/plans/switch-to-valid', { method: 'POST' });

      if (result.success) {
        // Refresh plan details
        await refreshCurrentPlanDetails();

      }
    } catch (error) {

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

    // Only save planDetails to IndexedDB when on upgrade page, not on every page refresh
    const isOnUpgradePage = state.currentView === 'upgrade';
    if (!isOnUpgradePage) {
      console.log('💾 Skipping planDetails save to IndexedDB (not on upgrade page)', {
        currentView: state.currentView,
        isOnUpgradePage
      });
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
          dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: (indexedDBData.activities || []).filter(i => i.isDeleted !== true) });

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
        console.log('🔄 APP INIT: Checking if background sync should run...', {
          navigatorOnLine: navigator.onLine,
          isMounted,
          hasAuthData: !!localStorage.getItem('auth')
        });

        // Background sync on app init - process any pending sync operations
        if (navigator.onLine && isMounted && localStorage.getItem('auth')) {

          setTimeout(() => {

            backgroundSyncWithBackend(dispatch, ActionTypes, { skipDataFetch: true }).then(syncResult => {

              if (syncResult.success && isMounted) {

                dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
                dispatch({
                  type: ActionTypes.SET_DATA_FRESHNESS,
                  payload: { freshness: 'fresh', lastSynced: Date.now() }
                });
              } else if (isMounted) {
                // Sync failed but data is still from cache

                dispatch({
                  type: ActionTypes.SET_DATA_FRESHNESS,
                  payload: { freshness: 'cached', lastSynced: null }
                });
              }
            }).catch(error => {

              if (isMounted) {
                dispatch({
                  type: ActionTypes.SET_DATA_FRESHNESS,
                  payload: { freshness: 'cached', lastSynced: null }
                });
              }
            });
          }, 1000); // Small delay to allow UI to render first
        } else {
          console.log('🚫 APP INIT: Skipping background sync', {
            navigatorOnLine: navigator.onLine,
            isMounted,
            hasAuthData: !!localStorage.getItem('auth')
          });
        }

      } catch (error) {

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
          const syncResult = await syncService.syncAll(getStoreFunctions);

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
  }, []); // Empty deps - getStoreFunctions is stable and doesn't need to be in deps

  const collectUnsyncedStores = useCallback(async () => {
    const storesToCheck = [
      { key: 'customers', label: 'Customers', storeName: STORES.customers },
      { key: 'products', label: 'Products', storeName: STORES.products },
      { key: 'orders', label: 'Orders', storeName: STORES.orders },
      { key: 'transactions', label: 'Transactions', storeName: STORES.transactions },
      { key: 'purchaseOrders', label: 'Purchase Orders', storeName: STORES.purchaseOrders },
      { key: 'categories', label: 'Categories', storeName: STORES.categories }
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

        }
      } catch (error) {

      }
    } else {

    }

    const loadStaffPermissions = async () => {
      const authData = localStorage.getItem('auth');
      if (!authData) return;

      try {
        const parsedAuthData = JSON.parse(authData);
        if (parsedAuthData.userType === 'staff' && parsedAuthData.isAuthenticated) {

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

            return;
          }

          // Import getStaffAuth dynamically
          const { getStaffAuth } = await import('../utils/api');

          const authResult = await getStaffAuth(
            currentUser.email,
            currentUser.uid || '',
            currentUser.displayName || currentUser.name || '',
            currentUser.profilePicture || currentUser.photoURL || ''
          );

          if (authResult.success && authResult.staff) {

            // Save updated permissions to IndexedDB
            const { saveStaffPermissions } = await import('../utils/indexedDB');
            try {
              await saveStaffPermissions(
                authResult.staff._id,
                authResult.staff.permissions,
                authResult.seller?._id || authResult.sellerId
              );

            } catch (error) {

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

            // If re-authentication fails, log the user out
            if (authResult.error && (authResult.error.includes('not found') || authResult.error.includes('inactive'))) {

              localStorage.removeItem('auth');
              dispatch({ type: ActionTypes.LOGOUT });
              if (window.showToast) {
                window.showToast('Your account has been deactivated. Please contact your seller.', 'error');
              }
            }
          }
        }
      } catch (error) {

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
    const syncResult = await syncService.syncAll(getStoreFunctions);
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

    dispatch(action);
    return { success: true };
  }, [dispatch, handleLogoutRequest]);

  const derivedMetrics = useMemo(() => {
    try {
      return recomputeDerivedData(state);
    } catch (error) {

      return {};
    }
  }, [state.orders, state.products, state.currentUser?.sellerId]);

  // Function to refresh latest data from server
  const refreshLatestData = useCallback(async (dataTypes = null) => {
    try {

      // Get timestamps for the data types we want to refresh
      const timestamps = await getLatestFetchTimestamps();

      // If specific data types are requested, filter timestamps
      const filteredTimestamps = dataTypes
        ? Object.fromEntries(Object.entries(timestamps).filter(([key]) => dataTypes.includes(key)))
        : timestamps;

      if (Object.keys(filteredTimestamps).length === 0) {

        return { success: false, message: 'No valid timestamps found' };
      }

      // Fetch latest data
      const latestData = await fetchLatestData(filteredTimestamps);

      if (Object.keys(latestData).length === 0) {

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

        return {
          success: true,
          message: `Refreshed data for ${Object.keys(latestData).length} data types`,
          data: latestData
        };
      } else {

        return { success: false, message: 'Failed to merge data' };
      }

    } catch (error) {

      return { success: false, message: error.message || 'Unknown error' };
    }
  }, [dispatch]);

  // Helper function to get action type for data type
  const getActionTypeForDataType = (dataType) => {
    const actionMap = {
      customers: ActionTypes.SET_CUSTOMERS,
      products: ActionTypes.SET_PRODUCTS,
      orders: ActionTypes.SET_ORDERS,
      transactions: ActionTypes.SET_TRANSACTIONS,
      purchaseOrders: ActionTypes.SET_PURCHASE_ORDERS,
      vendorOrders: ActionTypes.SET_PURCHASE_ORDERS,
      categories: ActionTypes.SET_CATEGORIES
    };
    return actionMap[dataType];
  };

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
    debugPlanSwitching,
    logoutWithDataProtection,
  }), [state, derivedMetrics, enhancedDispatch, refreshCurrentPlanDetails, refreshLatestData, manualRefresh, debugPlanSwitching, logoutWithDataProtection]);

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
