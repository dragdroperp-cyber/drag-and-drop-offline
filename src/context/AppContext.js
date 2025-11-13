import React, { createContext, useContext, useReducer, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  addItem as addToIndexedDB, 
  updateItem as updateInIndexedDB, 
  deleteItem as deleteFromIndexedDB,
  getAllItems,
  STORES
} from '../utils/indexedDB';
import syncService, { setStoreFunctionsProvider } from '../services/syncService';
import { 
  fetchAllData, 
  fetchCustomers, 
  fetchProducts, 
  fetchTransactions, 
  fetchVendorOrders, 
  fetchCategories,
  isOnline,
  syncToIndexedDB
} from '../utils/dataFetcher';
import { apiRequest, createOrder } from '../utils/api';
import { setOrderHashPendingChecker, setOnItemSyncedCallback } from '../services/syncService';
import { getPlanLimits, canAddCustomer, canAddProduct, canAddOrder } from '../utils/planUtils';
import { getViewFromPath } from '../utils/navigation';

// Track pending order API calls to prevent duplicates
// Key: order content hash, Value: order ID
const pendingOrderApiCalls = new Map();

// Store dispatch reference for async operations to update state
let globalDispatch = null;

export const setGlobalDispatch = (dispatch) => {
  globalDispatch = dispatch;
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
  
  let authState = { isAuthenticated: false, currentUser: null };
  if (savedAuth) {
    try {
      authState = JSON.parse(savedAuth);
    } catch (e) {
      console.error('Error parsing saved auth:', e);
    }
  }
  
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
    
    // Language settings
    currentLanguage: settingsState.currentLanguage,
    voiceAssistantLanguage: settingsState.voiceAssistantLanguage,
    voiceAssistantEnabled: settingsState.voiceAssistantEnabled,
    
    // Data
    customers: [],
    products: [],
    purchaseOrders: [],
    orders: [], // Sales/billing records (Order model)
    transactions: [], // ONLY for plan purchases (Transaction model)
    activities: [],
    categories: [],
    
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

const isCurrentPlanExpired = (planDetails, referenceTime) => {
  if (!planDetails) return false;
  if (planDetails.isExpired === true) return true;
  const expiryTimestamp = getCurrentPlanExpiryTimestamp(planDetails);
  if (expiryTimestamp === null) return false;
  return expiryTimestamp <= referenceTime;
};

// Action types
export const ActionTypes = {
  // Authentication
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  
  // Language
  SET_LANGUAGE: 'SET_LANGUAGE',
  SET_VOICE_LANGUAGE: 'SET_VOICE_LANGUAGE',
  
  // Plan management
  SET_CURRENT_PLAN: 'SET_CURRENT_PLAN',
  SET_CURRENT_PLAN_DETAILS: 'SET_CURRENT_PLAN_DETAILS',
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
  SET_SYSTEM_STATUS: 'SET_SYSTEM_STATUS'
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

// Reducer function
const appReducer = (state, action) => {
  // Only log critical actions (skip UPDATE_CURRENT_TIME and other frequent actions)
  if (action.type === 'ADD_ORDER') {
    console.log('🎯 REDUCER: ADD_ORDER action received!', action);
  }
  // Skip logging UPDATE_CURRENT_TIME and other frequent actions to reduce console noise
  
  switch (action.type) {
    case ActionTypes.LOGIN: {
      const sellerId = action.payload?.sellerId || null;

      // Save auth to localStorage (including sellerId if provided)
      const authData = {
        isAuthenticated: true, 
        currentUser: action.payload,
        sellerId
      };
      localStorage.setItem('auth', JSON.stringify(authData));
      
      // Notify service worker that user is authenticated
      postMessageToServiceWorker({
        type: 'AUTHENTICATED',
        user: action.payload
      });
      postMessageToServiceWorker({ type: 'CACHE_APP_RESOURCES' }, { delay: 500 });
      
      // Start auto-sync after login
      setTimeout(() => {
        if (syncService.isOnline()) {
          syncService.startAutoSync(getStoreFunctions, 30000); // Sync every 30 seconds
          // Also do an immediate sync
          syncService.syncAll(getStoreFunctions).catch(err => console.error('Initial sync error:', err));
        }
      }, 2000);
      
      let nextPlanBootstrap = state.planBootstrap || {
        isActive: false,
        hasCompleted: false,
        startedAt: null,
        completedAt: null
      };

      if (sellerId) {
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
        upiId: action.payload?.upiId
          || action.payload?.owner?.upiId
          || '',
        storeName: nextStoreName || state.storeName,
        planBootstrap: nextPlanBootstrap,
        allowedModules: null
      };
    }
      
    case ActionTypes.LOGOUT:
      // Clear auth from localStorage
      localStorage.removeItem('auth');
      
      // Stop auto-sync
      syncService.stopAutoSync();
      
      // Notify service worker that user logged out
      postMessageToServiceWorker({ type: 'LOGGED_OUT' });
      
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PLAN_LOADER_SESSION_KEY);
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
      return {
        ...state,
        currentPlanDetails: action.payload
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
      if (state.customers.length === normalizedCustomers.length && 
          state.customers.every((item, idx) => {
            const newItem = normalizedCustomers[idx];
            return newItem && item.id === newItem.id && 
                   JSON.stringify(item) === JSON.stringify(newItem);
          })) {
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
      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isFromSyncCallback = action.payload.syncedAt !== undefined;
      
      const updatedCustomer = { 
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };
      
      updateInIndexedDB(STORES.customers, updatedCustomer)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
      if (syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Customer updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast('Couldn\'t update customer. Please try again.', 'error');
          }
        });
      // Only update if customer actually changed
      const existingCustomer = state.customers.find(c => c.id === action.payload.id);
      if (existingCustomer && JSON.stringify(existingCustomer) === JSON.stringify(updatedCustomer)) {
        return state; // No change
      }
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
            console.log('✅ Customer marked as deleted in IndexedDB:', action.payload);
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
            console.error('❌ IndexedDB update error:', err);
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
      // Only update if products array actually changed (deep comparison)
      if (state.products.length === action.payload.length && 
          state.products.every((item, idx) => {
            const newItem = action.payload[idx];
            return newItem && item.id === newItem.id && 
                   JSON.stringify(item) === JSON.stringify(newItem);
          })) {
        return state;
      }
      {
        const nextProducts = action.payload;
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        return {
          ...state,
          products: nextProducts,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
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
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
      if (syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(err => console.error('MongoDB sync error:', err));
          }
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
      // Step 1: Save to IndexedDB first
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isProductFromSyncCallback = action.payload.syncedAt !== undefined;
      const suppressProductSync = action.meta?.suppressProductSync === true;
      
      const updatedProduct = { 
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: suppressProductSync ? true : (isProductFromSyncCallback ? true : false),
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isProductFromSyncCallback || suppressProductSync ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isProductFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
      };
      
      updateInIndexedDB(STORES.products, updatedProduct)
        .then(() => {
          // Step 2: After IndexedDB save succeeds, sync to MongoDB if online
          if (!suppressProductSync && syncService.isOnline()) {
            syncService.syncAll(getStoreFunctions).catch(() => {
              if (window.showToast) {
                window.showToast('Product updated. We\'ll retry syncing shortly.', 'info');
              }
            });
          }
        })
        .catch(err => {
          console.error('IndexedDB save error:', err.message);
          if (window.showToast) {
            window.showToast('Couldn\'t update product. Please try again.', 'error');
          }
        });
      // Only update if product actually changed
      const existingProduct = state.products.find(p => p.id === action.payload.id);
      if (existingProduct && JSON.stringify(existingProduct) === JSON.stringify(updatedProduct)) {
        return state; // No change
      }
      {
        const nextProducts = state.products.map(product =>
          product.id === action.payload.id ? updatedProduct : product
        );
        const derived = recomputeDerivedData({ ...state, products: nextProducts });
        return {
          ...state,
          products: nextProducts,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
      
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
            console.log('✅ Product marked as deleted in IndexedDB:', action.payload);
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
            console.error('❌ IndexedDB update error:', err);
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
      // Only update if purchaseOrders array actually changed (deep comparison)
      if (state.purchaseOrders.length === action.payload.length && 
          state.purchaseOrders.every((item, idx) => {
            const newItem = action.payload[idx];
            return newItem && item.id === newItem.id && 
                   JSON.stringify(item) === JSON.stringify(newItem);
          })) {
        return state;
      }
      return {
        ...state,
        purchaseOrders: action.payload
      };
      
    case ActionTypes.SET_ORDERS:
      // Only update if orders array actually changed (deep comparison)
      if (state.orders.length === action.payload.length && 
          state.orders.every((item, idx) => {
            const newItem = action.payload[idx];
            return newItem && item.id === newItem.id && 
                   JSON.stringify(item) === JSON.stringify(newItem);
          })) {
        return state;
      }
      {
        const derived = recomputeDerivedData({ ...state, orders: action.payload });
        return {
          ...state,
          orders: action.payload,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
      
    case ActionTypes.ADD_ORDER: {
      // Only log critical order creation info
      console.log('🎯 ADD_ORDER: Order ID:', action.payload.id, 'Total:', action.payload.totalAmount);
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
        items: newOrder.items.map(item => ({
          ...item,
          costPrice: typeof item.costPrice === 'number' ? item.costPrice : 0,
          sellingPrice: typeof item.sellingPrice === 'number' ? item.sellingPrice : 0,
          quantity: typeof item.quantity === 'number' ? item.quantity : 1
        }))
      };
      
      // Create order hash for duplicate detection
      const orderHash = createOrderHash(validatedOrder);
      console.log('🔑 [ADD_ORDER] Order hash created:', orderHash.substring(0, 50) + '...');
      console.log('🔑 [ADD_ORDER] Current pending calls:', Array.from(pendingOrderApiCalls.keys()).map(h => h.substring(0, 30) + '...'));
      
      // ATOMIC CHECK: Check and set pending flag in one operation to prevent race conditions
      const isOnlineStatus = syncService.isOnline();
      if (isOnlineStatus) {
        // Check if an API call is already in progress for this order content
        if (pendingOrderApiCalls.has(orderHash)) {
          const existingOrderId = pendingOrderApiCalls.get(orderHash);
          console.warn('🚫 [ADD_ORDER] BLOCKED - Duplicate order prevented (pending API call exists):', existingOrderId);
          console.warn('🚫 [ADD_ORDER] Current order ID:', validatedOrder.id);
          console.warn('🚫 [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
          // Don't process this order at all - return state without changes
          return state;
        }
        
        // Mark this order as being processed IMMEDIATELY (atomically, before any async operations)
        pendingOrderApiCalls.set(orderHash, validatedOrder.id);
        console.log('✅ [ADD_ORDER] ALLOWED - Marked order as pending API call:', validatedOrder.id);
        console.log('✅ [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
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
        console.warn('🚫 [ADD_ORDER] Current order ID:', validatedOrder.id);
        console.warn('🚫 [ADD_ORDER] Order hash:', orderHash.substring(0, 50) + '...');
        // Remove from pending calls if we added it
        if (isOnlineStatus && pendingOrderApiCalls.has(orderHash)) {
          pendingOrderApiCalls.delete(orderHash);
        }
        // Don't process this duplicate order
        return state;
      }
      
      // Save to IndexedDB FIRST (always save locally)
      console.log('💾 Attempting to save order to IndexedDB...', validatedOrder.id);
      console.log('💾 Order data being saved:', JSON.stringify(validatedOrder, null, 2));
      
      updateInIndexedDB(STORES.orders, validatedOrder, true) // Skip validation since we validated above
        .then((result) => {
          console.log('✅ Order successfully saved to IndexedDB!', validatedOrder.id, result);
          
          // Verify order was saved
          setTimeout(async () => {
            try {
              const allOrders = await getAllItems(STORES.orders);
              const savedOrder = allOrders.find(o => o.id === validatedOrder.id || o.id?.toString() === validatedOrder.id?.toString());
              if (savedOrder) {
                console.log('✅ Verified: Order exists in IndexedDB', savedOrder.id);
              } else {
                console.error('❌ WARNING: Order not found in IndexedDB after save!', validatedOrder.id);
                console.error('❌ All orders in IndexedDB:', allOrders.map(o => ({ id: o.id, _id: o._id })));
              }
            } catch (verifyErr) {
              console.error('Error verifying order in IndexedDB:', verifyErr);
            }
          }, 100);
          
          // Step 2: Create order on backend immediately if online (ONE TIME ONLY)
          // Note: Duplicate check already done above, and order is already marked as pending
          if (isOnlineStatus && pendingOrderApiCalls.has(createOrderHash(validatedOrder))) {
            console.log('🌐 [ADD_ORDER] Online - scheduling ONE-TIME order creation API call...');
            // Use a small delay to ensure IndexedDB write is complete
            setTimeout(async () => {
              const orderHash = createOrderHash(validatedOrder);
              // Double-check that this order is still pending (in case it was removed)
              if (!pendingOrderApiCalls.has(orderHash)) {
                console.warn('⚠️ [ADD_ORDER] Order was removed from pending calls, skipping API call:', validatedOrder.id);
                return;
              }
              
              console.log('🌐 [ADD_ORDER] ⏰ Timeout executed - Creating order on backend via API (ONE ATTEMPT)...', validatedOrder.id);
              console.log('🌐 [ADD_ORDER] Order to create:', JSON.stringify(validatedOrder, null, 2));
              console.log('🌐 [ADD_ORDER] createOrder function available:', typeof createOrder);
              
              try {
                // ONE-TIME API call - no retries, no fallback
                console.log('🌐 [ADD_ORDER] Calling createOrder function (ONE TIME ONLY)...');
                if (typeof createOrder !== 'function') {
                  console.error('❌ [ADD_ORDER] createOrder is not a function!', createOrder);
                  throw new Error('createOrder function not available');
                }
                
                const createResult = await createOrder(validatedOrder);
                
                // Remove from pending calls immediately after API call (success or failure)
                pendingOrderApiCalls.delete(orderHash);
                console.log('🌐 [ADD_ORDER] Removed order from pending calls:', validatedOrder.id);
                console.log('🌐 [ADD_ORDER] createOrder result:', createResult);
                
                if (createResult.success) {
                  console.log('✅ Order created on backend successfully!', createResult._id);
                  
                  // Update order in IndexedDB with _id and isSynced: true
                  const syncedOrder = {
                    ...validatedOrder,
                    _id: createResult._id,
                    isSynced: true,
                    syncedAt: new Date().toISOString()
                  };
                  
                  updateInIndexedDB(STORES.orders, syncedOrder, true) // Skip validation for synced order
                    .then(() => {
                      console.log('✅ Order marked as synced in IndexedDB:', syncedOrder.id);
                      // Update React state with synced order only if it still exists
                      const existing = state.orders.find(o => o.id === syncedOrder.id);
                      if (existing && globalDispatch) {
                        globalDispatch({ type: ActionTypes.UPDATE_ORDER, payload: syncedOrder, meta: { fromSync: true } });
                      }
                    })
                    .catch(syncErr => {
                      console.error('❌ Failed to mark order as synced in IndexedDB:', syncErr);
                    });
                  
                  // if (window.showToast) {
                  //   // window.showToast('Order created.', 'success');
                  // }
                } else {
                  // API call failed - don't retry, just mark as unsynced and let sync service handle it
                  console.warn('⚠️ [ADD_ORDER] API call failed (ONE-TIME attempt):', createResult.error);
                  console.warn('⚠️ [ADD_ORDER] Order saved to IndexedDB with isSynced: false. Will be synced by background sync service.');
                  
                  // Order is already saved to IndexedDB with isSynced: false (from validatedOrder)
                  // No need to update it - it will be picked up by the sync service automatically
                  
                  if (window.showToast) {
                    window.showToast('Order saved. We\'ll sync it shortly.', 'info');
                  }
                }
              } catch (error) {
                // API call threw an error - don't retry, just mark as unsynced
                console.error('❌ [ADD_ORDER] Error creating order on backend (ONE-TIME attempt failed):', error);
                console.error('❌ [ADD_ORDER] Order saved to IndexedDB with isSynced: false. Will be synced by background sync service.');
                
                // Remove from pending calls on error (already done above, but just in case)
                pendingOrderApiCalls.delete(orderHash);
                console.log('🌐 [ADD_ORDER] Removed order from pending calls after error:', validatedOrder.id);
                
                // Order is already saved to IndexedDB with isSynced: false
                // No need to retry - background sync service will handle it
                
                if (window.showToast) {
                  window.showToast('Order saved. We\'ll sync it shortly.', 'info');
                }
              }
            }, 200);
          } else if (!isOnlineStatus) {
            console.log('📴 Offline - Order saved to IndexedDB, will sync when online');
            if (window.showToast) {
              window.showToast('Order saved offline. We\'ll sync once you\'re online.', 'success');
            }
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
      }
    }
      
    case ActionTypes.UPDATE_ORDER:
      // Distinguish between user edit and sync callback update
      // Sync callback has 'syncedAt' field, user edit doesn't
      const isOrderFromSyncCallback = action.payload.syncedAt !== undefined;
      
      const updatedOrder = { 
        ...action.payload,
        // If from sync callback, preserve isSynced: true
        // If user edit, ALWAYS set isSynced: false
        isSynced: isOrderFromSyncCallback ? true : false,
        // Add isUpdate flag only for user edits (not sync callbacks)
        isUpdate: isOrderFromSyncCallback ? undefined : true,
        // Track when the update happened (only for user edits, sync has its own timestamp)
        updatedAt: isOrderFromSyncCallback ? action.payload.updatedAt : new Date().toISOString()
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
          console.error('IndexedDB update error:', err.message);
        });
      // Only update if order actually changed
      const existingOrder = state.orders.find(order => order.id === action.payload.id);
      if (existingOrder && JSON.stringify(existingOrder) === JSON.stringify(updatedOrder)) {
        return state; // No change
      }
      {
        const nextOrders = state.orders.map(order => order.id === action.payload.id ? updatedOrder : order);
        const derived = recomputeDerivedData({ ...state, orders: nextOrders });
        return {
          ...state,
          orders: nextOrders,
          salesChartData: derived.salesChartData || state.salesChartData,
          profitChartData: derived.profitChartData || state.profitChartData,
          inventoryChartData: derived.inventoryChartData || state.inventoryChartData,
          dashboardTotals: derived.totals || state.dashboardTotals
        };
      }
      
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
            console.log('✅ Order marked as deleted in IndexedDB:', action.payload);
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
          console.error('IndexedDB save error:', err.message);
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
        
        console.log('🗑️ [DELETE_PURCHASE_ORDER] Marking purchase order as deleted:', deletedPO.id);
        console.log('🗑️ [DELETE_PURCHASE_ORDER] Deleted PO data:', JSON.stringify(deletedPO, null, 2));
        
        // Update in IndexedDB (soft delete - mark as deleted)
        updateInIndexedDB(STORES.purchaseOrders, deletedPO, true) // Skip validation for soft delete
          .then(() => {
            console.log('✅ [DELETE_PURCHASE_ORDER] Purchase order marked as deleted in IndexedDB');
            // Sync deletion to MongoDB if online
            if (syncService.isOnline()) {
              console.log('🌐 [DELETE_PURCHASE_ORDER] Online - syncing deletion to backend...');
              syncService.syncAll(getStoreFunctions).catch(err => console.error('Delete sync error:', err));
            } else {
              console.log('📴 [DELETE_PURCHASE_ORDER] Offline - deletion will sync when online');
            }
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
      // Only update if transactions array actually changed (deep comparison)
      if (state.transactions.length === action.payload.length && 
          state.transactions.every((item, idx) => {
            const newItem = action.payload[idx];
            return newItem && item.id === newItem.id && 
                   JSON.stringify(item) === JSON.stringify(newItem);
          })) {
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
          console.error('IndexedDB save error:', err.message);
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
          console.error('IndexedDB save error:', err.message);
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
            console.log('✅ Category marked as deleted in IndexedDB:', action.payload);
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

  const refreshCurrentPlanDetails = useCallback(async () => {
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
        if (combined.planId) {
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combined.planId });
        } else if (planPayload?.planId) {
          dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planPayload.planId });
        }
      }

      dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combined || null });
    } catch (error) {
      console.error('Error refreshing current plan details:', error);
    }
  }, [dispatch]);
  
  // Store dispatch reference for async operations
  useEffect(() => {
    setGlobalDispatch(dispatch);
  }, [dispatch]);
  
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
        default:
          console.warn(`[SYNC] Unknown store type for state update: ${storeName}`);
      }
    });
  }, []);

  // Load data on mount - show IndexedDB first, then fetch from backend
  useEffect(() => {
    const loadData = async () => {
      try {
        // Step 1: Load from IndexedDB FIRST (immediate display)
        const [
          indexedDBCustomers,
          indexedDBProducts,
          indexedDBOrders,
          indexedDBTransactions,
          indexedDBPurchaseOrders,
          indexedDBCategories,
          indexedDBPlanDetails,
          activities
        ] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.planDetails).catch(() => []),
          getAllItems(STORES.activities).catch(() => [])
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

        // Show IndexedDB data immediately (exclude soft-deleted items)
        dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedIndexedDBCustomers || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (normalizedIndexedDBProducts || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ORDERS, payload: (indexedDBOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (indexedDBTransactions || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (indexedDBPurchaseOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (indexedDBCategories || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: activities || [] });

        const sellerId = state.currentUser?.sellerId || null;
        if (sellerId) {
          const planRecord = (indexedDBPlanDetails || []).find(record => record && record.sellerId === sellerId);
          if (planRecord?.data && !state.currentPlanDetails) {
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: planRecord.data });
            if (planRecord.data.planId) {
              dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: planRecord.data.planId });
            }
            if (typeof planRecord.data.isExpired === 'boolean') {
              dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: !planRecord.data.isExpired });
            }
          }
          if (planRecord?.data) {
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
            // Step A: First push all unsynced IndexedDB changes to MongoDB
            try {
              await syncService.syncAll(getStoreFunctions);
            } catch (syncErr) {
              console.error('Initial online sync failed, proceeding to fetch backend:', syncErr);
            }
            // Step B: Then fetch fresh data from MongoDB
            const result = await apiRequest('/data/all', { method: 'GET' });
            
            if (result.success && result.data?.data) {
              const { customers, products, orders, transactions, purchaseOrders, categories } = result.data.data;

              // Normalize backend data
              const normalizedBackendCustomers = (customers || []).map(customer => {
                const normalized = {
                  ...customer,
                  dueAmount: customer.dueAmount || 0,
                  balanceDue: customer.dueAmount || 0,
                  mobileNumber: customer.mobileNumber || customer.phone || ''
                };
                return normalized;
              });
              
              const normalizedBackendProducts = (products || []).map(product => {
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

              // Update IndexedDB with backend data
              await Promise.all([
                syncToIndexedDB(STORES.customers, normalizedBackendCustomers),
                syncToIndexedDB(STORES.products, normalizedBackendProducts),
                syncToIndexedDB(STORES.orders, orders || []),
                syncToIndexedDB(STORES.transactions, transactions || []),
                syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || []),
                syncToIndexedDB(STORES.categories, categories || [])
              ]);

              // Replace state with backend data (exclude soft-deleted just in case)
              dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedBackendCustomers || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (normalizedBackendProducts || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_ORDERS, payload: (orders || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (transactions || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (purchaseOrders || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (categories || []).filter(i => i.isDeleted !== true) });
            }
          } catch (backendError) {
            console.error('❌ Error fetching from backend:', backendError.message);
            // Keep IndexedDB data that was already shown
          }
        }
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
      }
    };

    // Load data on mount
    loadData();
  }, []); // Only run on mount

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
        const [indexedDBCustomers, indexedDBProducts, indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders, indexedDBCategories, activities] = await Promise.all([
          getAllItems(STORES.customers).catch(() => []),
          getAllItems(STORES.products).catch(() => []),
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.categories).catch(() => []),
          getAllItems(STORES.activities).catch(() => [])
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

        // Show IndexedDB data immediately (exclude soft-deleted items)
        dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedIndexedDBCustomers || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (normalizedIndexedDBProducts || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ORDERS, payload: (indexedDBOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (indexedDBTransactions || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (indexedDBPurchaseOrders || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (indexedDBCategories || []).filter(i => i.isDeleted !== true) });
        dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: activities || [] });

        // Step 2: Fetch from backend if online (will replace IndexedDB data)
        const isOnlineStatus = await isOnline();
        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: isOnlineStatus ? 'online' : 'offline' });
        
        if (isOnlineStatus) {
          try {
            // Step A: First push all unsynced IndexedDB changes to MongoDB for the current user
            try {
              await syncService.syncAll(getStoreFunctions);
            } catch (syncErr) {
              console.error('User-change online sync failed, proceeding to fetch backend:', syncErr);
            }
            // Step B: Then fetch fresh data from MongoDB
            const result = await apiRequest('/data/all', { method: 'GET' });
            
            if (result.success && result.data?.data) {
              const { customers, products, orders, transactions, purchaseOrders, categories } = result.data.data;
              
              // Normalize backend data
              const normalizedBackendCustomers = (customers || []).map(customer => {
                const normalized = {
                  ...customer,
                  dueAmount: customer.dueAmount || 0,
                  balanceDue: customer.dueAmount || 0,
                  mobileNumber: customer.mobileNumber || customer.phone || ''
                };
                return normalized;
              });
              
              const normalizedBackendProducts = (products || []).map(product => {
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

              // Update IndexedDB with backend data
              await Promise.all([
                syncToIndexedDB(STORES.customers, normalizedBackendCustomers),
                syncToIndexedDB(STORES.products, normalizedBackendProducts),
                syncToIndexedDB(STORES.orders, orders || []),
                syncToIndexedDB(STORES.transactions, transactions || []),
                syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || []),
                syncToIndexedDB(STORES.categories, categories || [])
              ]);

              // Replace state with backend data (exclude soft-deleted just in case)
              dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedBackendCustomers || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (normalizedBackendProducts || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_ORDERS, payload: (orders || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (transactions || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (purchaseOrders || []).filter(i => i.isDeleted !== true) });
              dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (categories || []).filter(i => i.isDeleted !== true) });
              
            }
          } catch (backendError) {
            console.error('❌ Error fetching user data from backend:', backendError.message);
          }
          
          // Fetch aggregated plan details and usage
          let planData = null;
          let planIdFromBackend = null;
          try {
            const planResult = await apiRequest('/data/current-plan');
            if (planResult.success && planResult.data) {
              const rawPlanData = Array.isArray(planResult.data) ? planResult.data : planResult.data.data || planResult.data;
              if (rawPlanData) {
                planData = rawPlanData;
                planIdFromBackend = rawPlanData.planId || null;
              }
            }
          } catch (planError) {
            console.error('Error fetching current plan details:', planError);
          }

          let usagePayload = null;
          try {
            const usageResult = await apiRequest('/plans/usage');
            if (usageResult.success && usageResult.data && usageResult.data.summary) {
              usagePayload = usageResult.data;
            }
          } catch (usageError) {
            console.error('Error fetching plan usage summary:', usageError);
          }

          let combinedPlanDetails = mergePlanDetailsWithUsage(planData, usagePayload);
          if (!combinedPlanDetails && planData) {
            combinedPlanDetails = { ...planData };
          }

          if (combinedPlanDetails) {
            if (planIdFromBackend && !combinedPlanDetails.planId) {
              combinedPlanDetails.planId = planIdFromBackend;
            }
            dispatch({ type: ActionTypes.SET_CURRENT_PLAN_DETAILS, payload: combinedPlanDetails });
            if (combinedPlanDetails.planId) {
              dispatch({ type: ActionTypes.SET_CURRENT_PLAN, payload: combinedPlanDetails.planId });
            }
          }
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'offline' });
      }
    };
    
    loadUserData();
    
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
      redirectToUpgrade();
      return;
    }

    const activeOrders = completedOrders.filter((order) => !isPlanOrderExpired(order, now));
    if (activeOrders.length === 0) {
      if (state.isSubscriptionActive !== false) {
        dispatch({ type: ActionTypes.SET_SUBSCRIPTION_ACTIVE, payload: false });
      }
      showUpgradePrompt();
      redirectToUpgrade();
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
          redirectToUpgrade();
        }
      } catch (error) {
        console.error('Automatic plan switch error:', error);
        showUpgradePrompt();
        redirectToUpgrade();
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

  // Listen for online/offline events and refresh data accordingly
  useEffect(() => {
    let isMounted = true;
    
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
        console.error('❌ Error syncing unsynced changes:', syncError.message);
        if (isMounted && window.showToast) {
          window.showToast('Error syncing offline changes. Will retry automatically.', 'error');
        }
      }
      
      if (!isMounted) return;
      
      // Then, fetch latest data from backend to ensure we have the most up-to-date data
      try {
        const data = await fetchAllData();
        const activities = await getAllItems(STORES.activities).catch(() => []);

        // Normalize customers - ensure mobileNumber is set (convert phone to mobileNumber if needed)
        const normalizedCustomers = (data.customers || []).map(customer => {
          if (customer.phone && !customer.mobileNumber) {
            return { ...customer, mobileNumber: customer.phone };
          }
          if (!customer.mobileNumber && customer.phone) {
            return { ...customer, mobileNumber: customer.phone };
          }
          return customer;
        });
        
        if (isMounted) {
          dispatch({ type: ActionTypes.SET_CUSTOMERS, payload: (normalizedCustomers || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_PRODUCTS, payload: (data.products || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_ORDERS, payload: (data.orders || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_TRANSACTIONS, payload: (data.transactions || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: (data.purchaseOrders || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_CATEGORIES, payload: (data.categories || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_ACTIVITIES, payload: (activities || []).filter(i => i.isDeleted !== true) });
          dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
        }
      } catch (error) {
        console.error('Error refreshing data after coming online:', error.message);
        if (isMounted) {
          dispatch({ type: ActionTypes.SET_SYSTEM_STATUS, payload: 'online' });
        }
      }
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
        console.error(`[LOGOUT] Error checking unsynced items for ${entry.label}:`, error);
      }
    }

    return summaries;
  }, []);

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
      console.error('Error computing derived metrics:', error);
      return {};
    }
  }, [state.orders, state.products, state.currentUser?.sellerId]);

  // Memoize context value to prevent unnecessary re-renders
  // dispatch from useReducer is already stable and doesn't change
  // Only recreate when state actually changes
  const value = useMemo(() => ({
    state,
    dispatch: enhancedDispatch,
    derivedMetrics
  }), [state, derivedMetrics, enhancedDispatch]);

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
