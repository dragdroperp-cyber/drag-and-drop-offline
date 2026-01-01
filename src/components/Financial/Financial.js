import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp, triggerSyncStatusUpdate, isPlanExpired } from '../../context/AppContext';
import jsPDF from 'jspdf';
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  Receipt,
  BarChart3,
  PieChart,
  Download,
  Calculator,
  Truck,
  Target,
  AlertCircle,
  X,
  Share2,
  CalendarRange,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileJson,
  Loader,
  Bell,
  Plus,
  Trash2,
  Wallet,
  ChevronLeft,
  ChevronRight,
  XCircle
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import { fetchOrders, fetchTransactions, fetchVendorOrders, fetchCustomers, isOnline, syncToIndexedDB } from '../../utils/dataFetcher';
import { apiRequest, getSellerIdFromAuth } from '../../utils/api';
import syncService from '../../services/syncService';

import { sanitizeMobileNumber } from '../../utils/validation';
import { formatDate } from '../../utils/dateUtils';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement);

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const resolvePurchaseOrderItemTotal = (item = {}) => {
  if (!item) return 0;
  const subtotal = toNumber(item.subtotal ?? item.total ?? item.lineTotal, 0);
  if (subtotal) return subtotal;
  const price = toNumber(item.price ?? item.costPrice ?? item.unitPrice ?? item.rate ?? 0, 0);
  const quantity = toNumber(item.quantity ?? item.qty ?? item.count ?? 1, 1);
  return price * quantity;
};

const resolvePurchaseOrderTotal = (purchaseOrder = {}) => {
  if (!purchaseOrder) return 0;
  const directTotal = toNumber(purchaseOrder.total ?? purchaseOrder.grandTotal ?? purchaseOrder.amount ?? purchaseOrder.totalAmount, 0);
  if (directTotal > 0) return directTotal;
  if (Array.isArray(purchaseOrder.items) && purchaseOrder.items.length > 0) {
    return purchaseOrder.items.reduce((sum, item) => sum + resolvePurchaseOrderItemTotal(item), 0);
  }
  return 0;
};

const Financial = () => {
  const { state, dispatch } = useApp();
  const [timeRange, setTimeRange] = useState('today');
  const [isLoading, setIsLoading] = useState(() => {
    // Avoid loading flicker if data is already in state
    const hasData = state.orders?.length > 0 || state.transactions?.length > 0;
    return !hasData && state.dataFreshness === 'loading';
  });
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState(null);
  const [showPurchaseOrderModal, setShowPurchaseOrderModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  // Custom Date Range State
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [tempCustomRange, setTempCustomRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  // State for Chart Drill-down
  const [selectedDate, setSelectedDate] = useState(null);
  const [isClosingBreakdown, setIsClosingBreakdown] = useState(false);

  const handleCloseBreakdown = () => {
    setIsClosingBreakdown(true);
    setTimeout(() => {
      setSelectedDate(null);
      setIsClosingBreakdown(false);
    }, 400);
  };

  // Expenses State managed via Global State
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [isClosingExpense, setIsClosingExpense] = useState(false);

  const handleCloseExpenseModal = () => {
    setIsClosingExpense(true);
    setTimeout(() => {
      setShowExpenseModal(false);
      setIsClosingExpense(false);
    }, 400);
  };

  const [newExpense, setNewExpense] = useState({ amount: '', category: 'Tea/Coffee', description: '', date: new Date().toISOString().split('T')[0] });
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);
  const [expensePage, setExpensePage] = useState(1);
  const expensesPerPage = 5;
  const exportMenuRef = useRef(null);
  const sellerIdFromAuth = (() => {
    try {
      return getSellerIdFromAuth();
    } catch (error) {

      return null;
    }
  })();

  const normalizeId = (value) => {
    if (!value && value !== 0) return null;
    const stringValue = value?.toString?.().trim?.();
    return stringValue || null;
  };

  const sellerIdentifiers = new Set(
    [
      sellerIdFromAuth,
      state.currentUser?.sellerId,
      state.currentUser?.id,
      state.currentUser?._id,
      state.currentUser?.userId,
      state.currentUser?.uid,
      state.currentUser?.storeId,
      state.currentUser?.profile?.sellerId,
      state.sellerId,
      state.storeId,
    ]
      .map(normalizeId)
      .filter(Boolean)
  );

  const belongsToSeller = (record, identifiers) => {
    if (!record || !(identifiers instanceof Set) || identifiers.size === 0) return true;

    const candidateIds = [
      record.sellerId,
      record.sellerID,
      record.seller_id,
      record._sellerId,
      record.seller?.id,
      record.seller?._id,
      record.seller?.sellerId,
      record.storeId,
      record.store?.id,
      record.store?._id,
      record.vendorId,
      record.createdBy?.sellerId,
      record.createdBy?.sellerID,
      record.createdBy?._id,
      record.meta?.sellerId,
      record.meta?.storeId,
      record.owner?.sellerId,
    ]
      .map(normalizeId)
      .filter(Boolean);

    if (candidateIds.length === 0) {
      return true;
    }

    return candidateIds.some((candidate) => identifiers.has(candidate));
  };

  const filterBySeller = (records = []) => {
    if (!Array.isArray(records) || sellerIdentifiers.size === 0) return records || [];
    return records.filter((record) => belongsToSeller(record, sellerIdentifiers));
  };

  // Load data: IndexedDB first, then MongoDB
  useEffect(() => {
    const loadFinancialData = async () => {
      try {
        // Only show loading if we don't have data in state yet
        const hasExistingData = state.orders?.length > 0 || state.transactions?.length > 0;
        if (!hasExistingData) {
          setIsLoading(true);
        }

        // Step 1: Load from IndexedDB FIRST (immediate display)
        const [indexedDBOrders, indexedDBTransactions, indexedDBPurchaseOrders, indexedDBCustomers] = await Promise.all([
          getAllItems(STORES.orders).catch(() => []),
          getAllItems(STORES.transactions).catch(() => []),
          getAllItems(STORES.purchaseOrders).catch(() => []),
          getAllItems(STORES.customers).catch(() => [])
        ]);

        // Normalize IndexedDB data
        const normalizedCustomers = (indexedDBCustomers || []).map(customer => ({
          ...customer,
          dueAmount: customer.dueAmount !== undefined ? customer.dueAmount : (customer.balanceDue !== undefined ? customer.balanceDue : 0),
          balanceDue: customer.dueAmount !== undefined ? customer.dueAmount : (customer.balanceDue !== undefined ? customer.balanceDue : 0),
          mobileNumber: customer.mobileNumber || customer.phone || ''
        }));

        // Update state with IndexedDB data immediately
        dispatch({ type: 'SET_ORDERS', payload: indexedDBOrders || [] });
        dispatch({ type: 'SET_TRANSACTIONS', payload: indexedDBTransactions || [] });
        dispatch({ type: 'SET_PURCHASE_ORDERS', payload: indexedDBPurchaseOrders || [] });
        dispatch({ type: 'SET_CUSTOMERS', payload: normalizedCustomers });

        // Load Expenses from IndexedDB
        const indexedDBExpenses = await getAllItems(STORES.expenses).catch(() => []);
        dispatch({ type: 'SET_EXPENSES', payload: indexedDBExpenses || [] });

        setIsLoading(false);

        // DISABLED: Financial component data fetch - only sync on login now
        // ... (rest of commented out code)
      } catch (error) {

        setIsLoading(false);
      }
    };

    loadFinancialData();
  }, [dispatch]);

  // Expenses sync is now handled by background sync via AppContext

  const handleAddExpense = async (e) => {
    e.preventDefault();

    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to add expenses.', 'warning', 8000);
      }
      return;
    }
    if (!newExpense.amount || newExpense.amount <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    setIsSubmittingExpense(true);

    // Create optimistic expense object
    const optimisticExpense = {
      ...newExpense,
      id: `temp_${Date.now()}`, // Temp ID
      _id: `temp_${Date.now()}`,
      date: newExpense.date || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isSynced: false
    };

    try {
      // 1. Optimistic UI update via Global State (Dispatched below)
      setShowExpenseModal(false);
      setNewExpense({ amount: '', category: 'Tea/Coffee', description: '', date: new Date().toISOString().split('T')[0] });
      setExpensePage(1); // Reset to first page to see the new expense


      // 2. Save to IndexedDB (Offline support)
      await import('../../utils/indexedDB').then(({ addItem, STORES }) =>
        addItem(STORES.expenses, optimisticExpense)
      );

      // 3. Add to Sync Queue (Background Sync)
      // DISABLED: Sync handled by generic syncService
      // const { addToSyncQueue, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      // await addToSyncQueue('expense_create', optimisticExpense);

      // 4. Update Global State
      dispatch({ type: 'ADD_EXPENSE', payload: optimisticExpense });

      // 5. Trigger Sync Status Update (Instant UI Feedback)
      triggerSyncStatusUpdate();

      // 6. Trigger Sync (Debounced if Online)
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      }

      showToast("Expense added", "success");

    } catch (err) {
      console.error("Expense error:", err);
      showToast("Error saving expense", "error");
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  // Delete Confirmation State
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);

  const handleDeleteExpense = (id) => {
    setExpenseToDelete(id);
    setShowDeleteConfirmModal(true);
  };

  const confirmDeleteExpense = async () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to delete expenses.', 'warning', 8000);
      }
      return;
    }
    if (!expenseToDelete) return;
    const id = expenseToDelete;

    // Optimistic UI update via Global State (Dispatched below)
    // const previousExpenses = [...state.expenses];

    try {
      // Delete from IndexedDB locally first
      const { deleteItem, STORES } = await import('../../utils/indexedDB');
      await deleteItem(STORES.expenses, id);

      // Add to Sync Queue
      const { addToSyncQueue, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      await addToSyncQueue('expense_delete', { id });

      // Update Global State
      dispatch({ type: 'DELETE_EXPENSE', payload: id });

      // Trigger Sync Status Update (Instant UI Feedback)
      triggerSyncStatusUpdate();

      // Trigger Sync
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      }

      showToast("Expense deleted", "success");

    } catch (err) {
      console.error("Expense error:", err);
      showToast("Error deleting expense", "error");
    } finally {
      setShowDeleteConfirmModal(false);
      setExpenseToDelete(null);
    }
  };

  // ✅ Helper functions must come before use
  const normalizePaymentMethod = (method) => {
    const value = (method || '').toString().toLowerCase();
    if (value === 'card' || value === 'upi' || value === 'online') return 'online';
    if (value === 'due' || value === 'credit') return 'due';
    return 'cash';
  };

  const getPaymentMethodLabel = (method) => {
    const normalized = normalizePaymentMethod(method);
    switch (normalized) {
      case 'online':
        return getTranslation('onlinePayment', state.currentLanguage) || 'Online Payment';
      case 'due':
        return getTranslation('due', state.currentLanguage) || 'Due (Credit)';
      default:
        return getTranslation('cash', state.currentLanguage) || 'Cash';
    }
  };



  const showToast = (message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  };

  const buildWhatsAppInvoiceMessage = (transaction, sanitizedCustomerMobile) => {
    if (!transaction) {
      return '';
    }

    const withNull = (value) =>
      value === null || value === undefined || value === '' ? 'null' : value;

    const storeName = withNull(
      state.storeName || state.currentUser?.shopName || state.currentUser?.username
    );
    const storeAddress = withNull(state.currentUser?.shopAddress);
    const storePhoneRaw =
      state.currentUser?.phoneNumber ||
      state.currentUser?.mobileNumber ||
      state.currentUser?.phone ||
      state.currentUser?.contact ||
      '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+91 ${storePhoneSanitized}`
      : withNull(storePhoneRaw);

    const invoiceDateObj = new Date(
      transaction.date || transaction.createdAt || transaction.updatedAt || Date.now()
    );
    const invoiceDate = Number.isNaN(invoiceDateObj.getTime())
      ? 'null'
      : formatDate(invoiceDateObj);

    const customerName = withNull(transaction.customerName || transaction.customer || 'Customer');
    const customerPhoneDisplay = sanitizedCustomerMobile
      ? `+91 ${sanitizedCustomerMobile}`
      : 'null';

    const subtotalRaw = toNumber(
      transaction.subtotal ?? transaction.subTotal ?? transaction.total ?? 0,
      0
    );
    const discountRaw = toNumber(
      transaction.discountAmount ?? transaction.discount ?? 0,
      0
    );
    const taxAmountRaw = toNumber(
      transaction.taxAmount ?? transaction.tax ?? 0,
      0
    );
    const totalRaw = toNumber(
      transaction.total ?? transaction.totalAmount ?? transaction.amount ?? subtotalRaw,
      0
    );

    const taxPercentSource = transaction.taxPercent ?? transaction.taxRate;
    const taxPercentRaw =
      taxPercentSource !== undefined && taxPercentSource !== null
        ? Number(taxPercentSource)
        : subtotalRaw > 0
          ? (taxAmountRaw / subtotalRaw) * 100
          : null;

    const subtotalDisplay = Number.isFinite(subtotalRaw)
      ? `₹${subtotalRaw.toFixed(2)}`
      : '₹null';
    const discountDisplay = Number.isFinite(discountRaw)
      ? `₹${discountRaw.toFixed(2)}`
      : '₹null';
    const taxAmountDisplay = Number.isFinite(taxAmountRaw)
      ? `₹${taxAmountRaw.toFixed(2)}`
      : '₹null';
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}%`
      : 'null';
    const totalDisplay = Number.isFinite(totalRaw)
      ? `₹${totalRaw.toFixed(2)}`
      : '₹null';

    const quantityWidth = 8;
    const rateWidth = 8;
    const amountWidth = 10;
    const headerLine = `${'Item'.padEnd(12, ' ')}${'Qty'.padStart(
      quantityWidth,
      ' '
    )}   ${'Rate'.padStart(rateWidth, ' ')}   ${'Amount'.padStart(amountWidth, ' ')}`;

    const items = (transaction.items || []).map((item, index) => {
      const qty = toNumber(
        item.quantity ?? item.originalQuantity?.quantity ?? item.qty ?? 0,
        0
      );
      const unit = item.unit || item.originalQuantity?.unit || '';
      const lineRate = toNumber(
        item.unitSellingPrice ??
        item.sellingPrice ??
        item.price ??
        (qty > 0
          ? (item.totalSellingPrice ?? item.total ?? item.amount ?? 0) / qty
          : 0),
        0
      );
      const lineTotal = toNumber(
        item.totalSellingPrice ?? item.total ?? item.amount ?? lineRate * qty,
        0
      );
      const name = (item.name || item.productName || `Item ${index + 1}`).slice(0, 12).padEnd(12, ' ');
      const qtyCol = (Number.isFinite(qty) ? qty.toString() : 'null').padStart(quantityWidth, ' ');
      const rateCol = (Number.isFinite(lineRate) ? lineRate.toFixed(2) : 'null').padStart(
        rateWidth,
        ' '
      );
      const totalCol = (Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : 'null').padStart(
        amountWidth,
        ' '
      );
      return `${name}${qtyCol}   ${rateCol}   ${totalCol}${unit ? ` ${unit}` : ''}`;
    });

    const itemsSection = items.length
      ? items.join('\n')
      : `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(
        rateWidth,
        ' '
      )}   ${'null'.padStart(amountWidth, ' ')}`;

    const paymentModeLabel = withNull(getPaymentMethodLabel(transaction.paymentMethod));

    const divider = '--------------------------------';

    const lines = [
      '             INVOICE',
      '',
      divider,
      `Shop Name : ${storeName}`,
      `Address   : ${storeAddress}`,
      `Phone     : ${storePhoneDisplay}`,
      `Date      : ${invoiceDate}`,
      divider,
      `Customer Name : ${customerName}`,
      `Customer Phone: ${customerPhoneDisplay}`,
      divider,
      headerLine,
      itemsSection,
      divider,
      `Subtotal     : ${subtotalDisplay}`,
      `Discount     : ${discountDisplay}`,
      `Tax (${taxPercentDisplay})     : ${taxAmountDisplay}`,
      divider,
      `Grand Total  : ${totalDisplay}`,
      `Payment Mode : ${paymentModeLabel}`,
      'Thank you for shopping with us!',
      divider,
      '       Powered by Drag & Drop',
      divider
    ];

    return lines.join('\n');
  };

  const handleShareTransaction = (transaction) => {
    if (!transaction) {
      return;
    }

    const customerMobile = sanitizeMobileNumber(
      transaction.customerMobile || transaction.customerPhone || transaction.phoneNumber || ''
    );

    if (!customerMobile) {
      showToast('No customer mobile number found for this invoice.', 'warning');
      return;
    }

    const message = buildWhatsAppInvoiceMessage(transaction, customerMobile);
    if (!message) {
      showToast('Unable to prepare invoice details for sharing.', 'error');
      return;
    }

    const targetNumber = customerMobile.length === 10 ? `91${customerMobile}` : customerMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  };

  const formatDateTime = (value) => {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const options = {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      };
      return new Intl.DateTimeFormat('en-IN', options).format(date);
    } catch (error) {
      return value;
    }
  };

  const getPaymentMethodBadgeClass = (method) => {
    const m = (method || '').toLowerCase();
    if (m === 'cash') return 'bg-green-50 text-green-700';
    if (m === 'card' || m === 'upi' || m === 'online') return 'bg-blue-50 text-blue-700';
    if (m === 'due' || m === 'credit') return 'bg-red-50 text-red-700';
    if (m === 'split') return 'bg-purple-50 text-purple-700';
    return 'bg-gray-50 text-gray-700';
  };

  const formatDisplayDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : formatDate(date);
  };

  const getPurchaseOrderStatusBadge = (status = 'pending') => {
    const baseClasses = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold';
    const normalized = (status || 'pending').toLowerCase();
    switch (normalized) {
      case 'completed':
        return `${baseClasses} bg-emerald-100 text-emerald-700`;
      case 'cancelled':
      case 'canceled':
        return `${baseClasses} bg-rose-100 text-rose-700`;
      case 'in-progress':
      case 'processing':
        return `${baseClasses} bg-sky-100 text-sky-700`;
      case 'pending':
      default:
        return `${baseClasses} bg-amber-100 text-amber-700`;
    }
  };

  const getPurchaseOrderStatusLabel = (status = 'pending') => {
    const normalized = (status || 'pending').toString().trim();
    if (!normalized) return getTranslation('pending', state.currentLanguage);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };


  // Helper function to get date range based on timeRange selector
  const getDateRange = () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0); // Start of today
    let startDate = new Date(todayStart);

    switch (timeRange) {
      case 'today':
        return { startDate: todayStart, endDate: today };
      case '7d':
        startDate.setDate(today.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(today.getDate() - 30);
        break;
      case 'custom':
        const s = new Date(customDateRange.start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(customDateRange.end);
        e.setHours(23, 59, 59, 999);
        return { startDate: s, endDate: e };
      case '1y':
        startDate.setFullYear(today.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        return { startDate: todayStart, endDate: today };
    }

    return { startDate, endDate: today };
  };

  // Filter orders and purchase orders by date range
  const { startDate, endDate } = getDateRange();

  const getFinancialMonthsData = () => {
    // If invalid dates, return empty
    if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { labels: [], revenues: [], expenses: [] };
    }

    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Determine interval: Daily if <= 60 days, Monthly otherwise
    const isDaily = diffDays <= 60;

    const labels = [];
    const revenues = [];
    const expenses = [];
    const dataMap = new Map();

    // Helper to generate key
    const getKey = (date) => {
      if (isDaily) return formatDate(date);
      return date.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
    };

    // Initialize bins
    const loopDate = new Date(startDate);
    // Clone end date to safe-guard mutation
    const end = new Date(endDate);

    // Loop to creates keys (x-axis labels)
    while (loopDate <= end) {
      const key = getKey(loopDate);
      if (!dataMap.has(key)) {
        labels.push(key);
        dataMap.set(key, { revenue: 0, expense: 0 });
      }
      // Increment
      if (isDaily) {
        loopDate.setDate(loopDate.getDate() + 1);
      } else {
        // Move to next month start to ensure we don't stick on a day like 31st and skip feb
        loopDate.setDate(1);
        loopDate.setMonth(loopDate.getMonth() + 1);
      }
    }

    // Populate Data
    // 1. Revenues (Orders)
    state.orders.forEach(o => {
      if (o.isDeleted) return;
      const oDate = new Date(o.createdAt || o.date);
      if (oDate >= startDate && oDate <= end) {
        const key = getKey(oDate);
        if (dataMap.has(key)) {
          const entry = dataMap.get(key);
          entry.revenue += (o.totalAmount || 0);
        }
      }
    });

    // 2. Expenses (Purchase Orders)
    state.purchaseOrders.forEach(po => {
      if (po.isDeleted) return;
      if (po.status !== 'completed') return;
      const poDate = new Date(po.createdAt || po.orderDate || po.date);
      if (poDate >= startDate && poDate <= end) {
        const key = getKey(poDate);
        if (dataMap.has(key)) {
          const entry = dataMap.get(key);
          entry.expense += (resolvePurchaseOrderTotal(po) || 0);
        }
      }
    });

    // 3. Expenses (Petty Expenses)
    (state.expenses || []).forEach(exp => {
      const expDate = new Date(exp.date || exp.createdAt);
      if (expDate >= startDate && expDate <= end) {
        const key = getKey(expDate);
        if (dataMap.has(key)) {
          const entry = dataMap.get(key);
          entry.expense += (Number(exp.amount) || 0);
        }
      }
    });

    // Unzip map to arrays
    labels.forEach(label => {
      const entry = dataMap.get(label);
      revenues.push(entry.revenue);
      expenses.push(entry.expense);
    });

    return { labels, revenues, expenses };
  };

  const { labels: chartLabels, revenues: monthlyRevenue, expenses: monthlyExpenses } = useMemo(() => getFinancialMonthsData(), [state.orders, state.purchaseOrders, state.expenses, startDate, endDate]);

  const filteredOrders = filterBySeller(state.orders).filter(order => {
    const orderDate = new Date(order.createdAt || order.date || 0);
    return orderDate >= startDate && orderDate <= endDate;
  });

  const filteredPurchaseOrders = filterBySeller(state.purchaseOrders).filter(po => {
    if (po.isDeleted) return false;
    // Only count completed orders as expenses
    if (po.status !== 'completed') return false;
    const poDate = new Date(po.createdAt || po.orderDate || po.date || po.updatedAt || 0);
    return poDate >= startDate && poDate <= endDate;
  });

  // ✅ Financial metrics (filtered by time range)
  // Use orders (sales) for revenue, not transactions (plan purchases)
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  // Calculate profit from order items: profit = sum((sellingPrice - costPrice)) for each item
  // This matches the dashboard calculation method
  const calculateProfitFromOrderItems = (orders) => {
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value)) || 0;

    return orders.reduce((totalProfit, order) => {
      if (!order.items || !Array.isArray(order.items)) return totalProfit;

      const orderProfit = order.items.reduce((orderItemProfit, item) => {
        const sellingPrice = toNumber(item.totalSellingPrice ?? item.sellingPrice ?? 0);
        const costPrice = toNumber(item.totalCostPrice ?? item.costPrice ?? 0);
        const itemProfit = sellingPrice - costPrice;
        return orderItemProfit + itemProfit;
      }, 0);

      return totalProfit + orderProfit;
    }, 0);
  };

  // Calculate profit from order items (this is Revenue - COGS)
  const profitFromSales = calculateProfitFromOrderItems(filteredOrders);

  // Operating expenses = Purchase Orders (filtered by time range)
  // Purchase orders represent inventory purchases/expenses
  const totalPurchaseExpenses = filteredPurchaseOrders.reduce((sum, po) => sum + (resolvePurchaseOrderTotal(po) || 0), 0);

  // Expenses Filter
  const filteredDailyExpenses = useMemo(() => {
    return (Array.isArray(state.expenses) ? state.expenses : [])
      .filter(exp => {
        if (!exp) return false;
        try {
          // Robust date parsing handling both ISO strings and YYYY-MM-DD
          let expTime;
          const dateStr = exp.date || exp.createdAt;

          if (!dateStr) return false;

          // If simple date string YYYY-MM-DD, treat as local midnight
          if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            expTime = new Date(y, m - 1, d).getTime();
          } else {
            expTime = new Date(dateStr).getTime();
          }

          if (Number.isNaN(expTime)) return false;

          return expTime >= startDate.getTime() && expTime <= endDate.getTime();
        } catch (e) {
          return false;
        }
      })
      .sort((a, b) => {
        // Sort by date descending (newest first)
        const dateA = new Date(a.date || a.createdAt).getTime();
        const dateB = new Date(b.date || b.createdAt).getTime();
        if (dateA === dateB) {
          return (b.id || b._id || '').toString().localeCompare((a.id || a._id || '').toString());
        }
        return dateB - dateA;
      });
  }, [state.expenses, startDate, endDate]);

  const totalPettyExpenses = filteredDailyExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  const totalExpenses = totalPurchaseExpenses + totalPettyExpenses;

  // Pagination Logic for Expenses
  const indexOfLastExpense = expensePage * expensesPerPage;
  const indexOfFirstExpense = indexOfLastExpense - expensesPerPage;
  const currentExpenses = filteredDailyExpenses.slice(indexOfFirstExpense, indexOfLastExpense);
  const totalExpensePages = Math.ceil(filteredDailyExpenses.length / expensesPerPage);

  const nextPage = () => {
    if (expensePage < totalExpensePages) setExpensePage(expensePage + 1);
  };

  const prevPage = () => {
    if (expensePage > 1) setExpensePage(expensePage - 1);
  };

  // Net Profit = (Revenue - COGS) - Petty Expenses
  // totalPurchaseExpenses reflects money spent on stock replenishment, not an immediate expense for profit calc
  const netProfit = profitFromSales - totalPettyExpenses;
  const totalCogs = totalRevenue - profitFromSales;
  const totalBusinessExpenses = totalCogs + totalPettyExpenses;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  const totalReceivables = state.customers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);
  const customersWithDebt = state.customers.filter(c => (c.balanceDue || 0) > 0).length;

  // Calculate payment methods and amounts using filtered orders
  const calculatePaymentMethods = () => {
    const counts = { cash: 0, online: 0, due: 0, split: 0 };

    filteredOrders.forEach((order) => {
      const method = (order.paymentMethod || '').toString().toLowerCase().trim();
      if (method === 'split') {
        counts.split = (counts.split || 0) + 1;
      } else {
        const normalized = normalizePaymentMethod(order.paymentMethod);
        counts[normalized] = (counts[normalized] || 0) + 1;
      }
    });

    return [counts.cash, counts.online, counts.due, counts.split];
  };

  const calculatePaymentMethodAmounts = () => {
    const totals = { cash: 0, online: 0, due: 0, split: 0 };

    filteredOrders.forEach((order) => {
      const method = (order.paymentMethod || '').toString().toLowerCase().trim();
      const totalAmount = order.totalAmount || order.total || 0;

      if (method === 'split') {
        // For split payments, add the total amount to split category only
        // This represents orders that used multiple payment methods
        totals.split = (totals.split || 0) + totalAmount;
      } else {
        // For non-split payments, add to the respective category
        const normalized = normalizePaymentMethod(order.paymentMethod);
        totals[normalized] = (totals[normalized] || 0) + totalAmount;
      }
    });

    return [totals.cash, totals.online, totals.due, totals.split];
  };

  // Calculate split payment breakdown (cash, online, due amounts from split payments)
  const calculateSplitPaymentBreakdown = () => {
    const breakdown = { cash: 0, online: 0, due: 0 };

    filteredOrders.forEach((order) => {
      const method = (order.paymentMethod || '').toString().toLowerCase().trim();

      if (method === 'split' && order.splitPaymentDetails) {
        const splitDetails = order.splitPaymentDetails;
        breakdown.cash = breakdown.cash + (Number(splitDetails.cashAmount) || 0);
        breakdown.online = breakdown.online + (Number(splitDetails.onlineAmount) || 0);
        breakdown.due = breakdown.due + (Number(splitDetails.dueAmount) || 0);
      }
    });

    return breakdown;
  };

  const revenueChartData = {
    labels: chartLabels,
    datasets: [
      {
        label: getTranslation('revenue', state.currentLanguage),
        data: monthlyRevenue,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: getTranslation('expenses', state.currentLanguage),
        data: monthlyExpenses,
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  };

  const paymentMethodCounts = calculatePaymentMethods();
  const paymentMethodAmounts = calculatePaymentMethodAmounts();
  const paymentMethodLabels = [
    getTranslation('cash', state.currentLanguage),
    getTranslation('onlinePayment', state.currentLanguage),
    getTranslation('dueCredit', state.currentLanguage),
    getTranslation('splitPayment', state.currentLanguage)
  ];
  const splitPaymentBreakdown = calculateSplitPaymentBreakdown();

  // Filter out zero values for better visualization
  const filteredLabels = [];
  const filteredAmounts = [];
  const filteredCounts = [];

  paymentMethodLabels.forEach((label, index) => {
    if (paymentMethodAmounts[index] > 0) {
      filteredLabels.push(label);
      filteredAmounts.push(paymentMethodAmounts[index]);
      filteredCounts.push(paymentMethodCounts[index]);
    }
  });

  // Use amounts for better financial visualization
  const paymentMethodData = {
    labels: filteredLabels,
    datasets: [
      {
        label: `${getTranslation('amount', state.currentLanguage)} (₹)`,
        data: filteredAmounts,
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',   // Cash - Green
          'rgba(59, 130, 246, 0.8)',  // Online - Blue
          'rgba(239, 68, 68, 0.8)',   // Due - Red
          'rgba(168, 85, 247, 0.8)',  // Split - Purple
        ].slice(0, filteredLabels.length),
        borderColor: [
          'rgba(34, 197, 94, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(239, 68, 68, 1)',
          'rgba(168, 85, 247, 1)',
        ].slice(0, filteredLabels.length),
        borderWidth: 2,
        hoverOffset: 4,
      },
    ],
  };

  // Hourly breakdown chart data for selected date (Revenue vs Expenses)
  const hourlyFinancialChartData = useMemo(() => {
    if (!selectedDate) return { labels: [], datasets: [] };

    const hours = Array.from({ length: 24 }, (_, i) => {
      const d = new Date();
      d.setHours(i, 0, 0, 0);
      try {
        return d.toLocaleTimeString([], { hour: 'numeric', hour12: true });
      } catch (e) {
        return `${i}:00`;
      }
    });

    const hourlyRevenue = new Array(24).fill(0);
    const hourlyExpenses = new Array(24).fill(0);

    // 1. Hourly Revenue
    filteredOrders.forEach(order => {
      if (order.isDeleted) return;
      const orderDate = new Date(order.createdAt || order.date);
      if (formatDate(orderDate) === selectedDate) {
        const hour = orderDate.getHours();
        hourlyRevenue[hour] += (order.totalAmount || 0);
      }
    });

    // 2. Hourly Expenses (Purchase Orders)
    filteredPurchaseOrders.forEach(po => {
      if (po.isDeleted || po.status !== 'completed') return;
      const poDate = new Date(po.createdAt || po.orderDate || po.date);
      if (formatDate(poDate) === selectedDate) {
        const hour = poDate.getHours();
        hourlyExpenses[hour] += (resolvePurchaseOrderTotal(po) || 0);
      }
    });

    // 3. Hourly Expenses (Petty Expenses)
    (state.expenses || []).forEach(exp => {
      const expDate = new Date(exp.date || exp.createdAt);
      if (formatDate(expDate) === selectedDate) {
        const hour = expDate.getHours();
        hourlyExpenses[hour] += (Number(exp.amount) || 0);
      }
    });

    return {
      labels: hours,
      datasets: [
        {
          label: getTranslation('hourlyRevenue', state.currentLanguage),
          data: hourlyRevenue,
          borderColor: '#10b981', // Emerald 500
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#10b981',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4
        },
        {
          label: getTranslation('hourlyExpenses', state.currentLanguage),
          data: hourlyExpenses,
          borderColor: '#ef4444', // Red 500
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#ef4444',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4
        }
      ]
    };
  }, [selectedDate, filteredOrders, filteredPurchaseOrders, state.expenses]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { usePointStyle: true, padding: 20 },
      },
    },
    scales: {
      y: { beginAtZero: true },
      x: { grid: { display: false } },
    },
  };

  const pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: 12,
            weight: '500'
          }
        },
        onClick: (e, legendItem) => {
          // Allow toggling legend items
        }
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            const index = context.dataIndex;
            const count = filteredCounts[index] || 0;
            return `${label}: ${formatCurrencySmart(value, state.currencyFormat)} (${count} ${count === 1 ? getTranslation('order', state.currentLanguage) : getTranslation('orders', state.currentLanguage)}, ${percentage}%)`;
          }
        },
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 12
        },
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1
      },
      generateLabels: function (chart) {
        const data = chart.data;
        if (data.labels.length && data.datasets.length) {
          return data.labels.map((label, i) => {
            const dataset = data.datasets[0];
            const value = dataset.data[i];
            const count = filteredCounts[i] || 0;
            const total = filteredAmounts.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            return {
              text: `${label}: ₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${count} ${count === 1 ? getTranslation('order', state.currentLanguage) : getTranslation('orders', state.currentLanguage)}, ${percentage}%)`,
              fillStyle: dataset.backgroundColor[i],
              strokeStyle: dataset.borderColor[i],
              lineWidth: dataset.borderWidth,
              hidden: false,
              index: i
            };
          });
        }
        return [];
      }
    },
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const downloadFile = (filename, content, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const escapeValue = (value) => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const exportFinancialCSV = () => {
    try {
      const headers = [
        getTranslation('typeHeader', state.currentLanguage),
        getTranslation('dateHeader', state.currentLanguage),
        getTranslation('descriptionHeader', state.currentLanguage),
        getTranslation('amountHeader', state.currentLanguage),
        getTranslation('paymentMethodHeader', state.currentLanguage),
        getTranslation('statusHeader', state.currentLanguage)
      ];
      const rows = [];

      // Add summary financial data instead of individual transactions
      rows.push([
        escapeValue(getTranslation('summary', state.currentLanguage)),
        escapeValue(formatDate(new Date())),
        escapeValue(getTranslation('totalRevenue', state.currentLanguage)),
        escapeValue(formatCurrencySmart(totalRevenue, state.currencyFormat)),
        escapeValue(getTranslation('allMethods', state.currentLanguage)),
        escapeValue(getTranslation('completed', state.currentLanguage))
      ]);

      rows.push([
        escapeValue(getTranslation('summary', state.currentLanguage)),
        escapeValue(formatDate(new Date())),
        escapeValue(getTranslation('totalExpenses', state.currentLanguage)),
        escapeValue(formatCurrencySmart(totalExpenses, state.currencyFormat)),
        escapeValue(getTranslation('allMethods', state.currentLanguage)),
        escapeValue(getTranslation('completed', state.currentLanguage))
      ]);

      rows.push([
        escapeValue(getTranslation('summary', state.currentLanguage)),
        escapeValue(formatDate(new Date())),
        escapeValue(getTranslation('netProfit', state.currentLanguage)),
        escapeValue(formatCurrencySmart(totalRevenue - totalExpenses, state.currencyFormat)),
        escapeValue(getTranslation('notApplicable', state.currentLanguage)),
        escapeValue(getTranslation('calculated', state.currentLanguage))
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      downloadFile(
        `financial-report-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast('Financial report exported as CSV.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportFinancialJSON = () => {
    try {
      const reportData = {
        summary: {
          totalRevenue,
          totalExpenses,
          netProfit,
          profitMargin: profitMargin.toFixed(2),
          totalReceivables,
          customersWithDebt
        },
        // Removed individual transaction details - export focuses on summary data only
        generatedAt: new Date().toISOString(),
        shopName: state.currentUser?.shopName || 'Store'
      };

      downloadFile(
        `financial-report-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(reportData, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast('Financial report exported as JSON.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportFinancialPDF = async () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const COLORS = {
        primary: [47, 60, 126],
        gray: [120, 120, 120],
        lightBg: [248, 249, 253],
        border: [230, 230, 230],
        black: [0, 0, 0],
        white: [255, 255, 255]
      };
      /* ================= HEADER ================= */
      const headerHeight = 28;

      // White header
      pdf.setFillColor(...COLORS.white);
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');

      // Bottom accent line
      pdf.setDrawColor(...COLORS.primary);
      pdf.setLineWidth(1.5);
      pdf.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

      /* -------- LOGO -------- */
      const logoX = margin;
      const logoY = 6;
      const logoMax = 16;

      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const logoUrl = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;

        const res = await fetch(logoUrl);
        if (res.ok) {
          const blob = await res.blob();
          const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });

          const img = new Image();
          img.src = base64;
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = resolve;
          });

          let w = logoMax;
          let h = logoMax;
          const ratio = img.width / img.height;

          if (ratio > 1) h = w / ratio;
          else w = h * ratio;

          pdf.addImage(base64, 'PNG', logoX, logoY, w, h);
        }
      } catch (e) {
        // fail silently
      }

      /* -------- APP NAME -------- */
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(...COLORS.primary);
      pdf.text(state.currentUser?.shopName || 'Drag & Drop', logoX + 22, 15);

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text(getTranslation('financialManagement', state.currentLanguage), logoX + 22, 19);

      /* -------- RIGHT META -------- */
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.black);
      pdf.text(getTranslation('financialReport', state.currentLanguage), pageWidth - margin, 14, { align: 'right' });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text(
        formatDate(new Date()),
        pageWidth - margin,
        19,
        { align: 'right' }
      );

      /* ================= SUMMARY CARDS ================= */
      const startY = headerHeight + 10;
      const cardW = (pageWidth - margin * 2 - 8) / 3;
      const cardH = 22;

      const metrics = [
        { label: getTranslation('revenue', state.currentLanguage), value: formatCurrencySmart(totalRevenue, state.currencyFormat) },
        { label: getTranslation('expenses', state.currentLanguage), value: formatCurrencySmart(totalBusinessExpenses, state.currencyFormat) },
        { label: getTranslation('netProfit', state.currentLanguage), value: formatCurrencySmart(netProfit, state.currencyFormat) }
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 4);
        pdf.setFillColor(235, 236, 240);
        pdf.rect(x + 1, startY + 1, cardW, cardH, 'F');
        pdf.setFillColor(...COLORS.white);
        pdf.rect(x, startY, cardW, cardH, 'F');
        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.gray);
        pdf.text(m.label.toUpperCase(), x + 4, startY + 7);
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.primary);
        pdf.text(String(m.value), x + 4, startY + 16);
      });

      /* ================= SUMMARY TABLE ================= */
      let y = startY + cardH + 20;

      if (y + 100 > pageHeight) {
        pdf.addPage();
        y = 20;
      }

      pdf.setDrawColor(...COLORS.primary);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);

      y += 8;
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.primary);
      pdf.text(getTranslation('selectedPeriodSummary', state.currentLanguage), margin, y);

      y += 6;
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.gray);
      const periodLabel = timeRange === 'custom'
        ? `${formatDate(customDateRange.start)} to ${formatDate(customDateRange.end)}`
        : timeRange.toUpperCase();
      pdf.text(`${getTranslation('analysisForPeriod', state.currentLanguage)}: ${periodLabel}`, margin, y);
      y += 15; // Increased gap after subtitle to 15mm

      const summaryData = [
        [getTranslation('salesSection', state.currentLanguage), getTranslation('revenueSales', state.currentLanguage), formatCurrencySmart(totalRevenue, state.currencyFormat)],
        [getTranslation('salesSection', state.currentLanguage), getTranslation('cogs', state.currentLanguage), formatCurrencySmart(totalCogs, state.currencyFormat)],
        [getTranslation('opexSection', state.currentLanguage), getTranslation('operatingExpenses', state.currentLanguage), formatCurrencySmart(totalPettyExpenses, state.currencyFormat)],
        [getTranslation('profitSection', state.currentLanguage), getTranslation('netProfit', state.currentLanguage), formatCurrencySmart(netProfit, state.currencyFormat)],
        [getTranslation('profitSection', state.currentLanguage), getTranslation('profitMargin', state.currentLanguage), `${profitMargin.toFixed(2)}%`],
        [getTranslation('cashSection', state.currentLanguage), getTranslation('stockPurchases', state.currentLanguage), formatCurrencySmart(totalPurchaseExpenses, state.currencyFormat)],
        [getTranslation('creditSection', state.currentLanguage), getTranslation('totalReceivables', state.currentLanguage), formatCurrencySmart(totalReceivables, state.currencyFormat)],
        [getTranslation('creditSection', state.currentLanguage), getTranslation('customersWithDebt', state.currentLanguage), customersWithDebt.toString()]
      ];

      const rowH_summary = 12;
      const tableW_summary = pageWidth - margin * 2;
      const colW_summary = [45, 150, tableW_summary - 195];
      const headers_summary = [
        getTranslation('sectionHeader', state.currentLanguage),
        getTranslation('metricHeader', state.currentLanguage),
        getTranslation('valueHeader', state.currentLanguage)
      ];

      // --- Draw Summary Header ---
      pdf.setFillColor(...COLORS.primary);
      pdf.rect(margin, y, tableW_summary, 12, 'F');
      pdf.setTextColor(...COLORS.white);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);

      headers_summary.forEach((label, i) => {
        const x = margin + colW_summary.slice(0, i).reduce((a, b) => a + b, 0);
        if (i === 2) {
          pdf.text(label, margin + tableW_summary - 8, y + 8, { align: 'right' });
        } else {
          pdf.text(label, x + 8, y + 8);
        }
      });

      y += 12 + 5; // Move to bottom of header (12mm) AND add a 5mm gap before the first data row

      // --- Draw Summary Rows ---
      let lastSection = '';
      for (let i = 0; i < summaryData.length; i++) {
        const row = summaryData[i];

        // Page break logic
        if (y + rowH_summary > pageHeight - 20) {
          pdf.addPage();
          y = 20;
          pdf.setFillColor(...COLORS.primary);
          pdf.rect(margin, y, tableW_summary, 12, 'F');
          pdf.setTextColor(...COLORS.white);
          pdf.setFont('helvetica', 'bold');
          headers_summary.forEach((label, j) => {
            const x = margin + colW_summary.slice(0, j).reduce((a, b) => a + b, 0);
            if (j === 2) pdf.text(label, margin + tableW_summary - 8, y + 8, { align: 'right' });
            else pdf.text(label, x + 8, y + 8);
          });
          y += 12 + 5;
        }

        if (i % 2 === 1) {
          pdf.setFillColor(...COLORS.lightBg);
          pdf.rect(margin, y, tableW_summary, rowH_summary, 'F');
        }

        pdf.setFontSize(10);

        // Section Column
        if (row[0] !== lastSection) {
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(...COLORS.gray);
          pdf.text(row[0], margin + 8, y + 8);
          lastSection = row[0];
        }

        // Metric Column
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...COLORS.black);
        pdf.text(row[1], margin + colW_summary[0] + 8, y + 8);

        // Value Column
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.primary);
        pdf.text(row[2], margin + tableW_summary - 8, y + 8, { align: 'right' });

        y += rowH_summary + 2; // Increase vertical step between rows to 14mm total (12 height + 2 gap)
      }

      /* ================= FOOTER ================= */
      const pageCount = pdf.internal.getNumberOfPages();

      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        pdf.text(`${getTranslation('page', state.currentLanguage)} ${i} ${getTranslation('ofPage', state.currentLanguage)} ${pageCount}`, margin, pageHeight - 10);
        pdf.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      pdf.save(`financial-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Financial report exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // Show loading state while initial data loads
  if (isLoading && state.orders.length === 0 && state.transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader className="h-10 w-10 text-indigo-600 animate-spin" />
        <p className="text-gray-500 dark:text-slate-400 font-medium">{getTranslation('analyzingFinancialData', state.currentLanguage)}</p>
      </div>
    );
  }

  const timeRangeOptions = [
    { value: 'today', label: getTranslation('timeRange_today', state.currentLanguage) },
    { value: '7d', label: getTranslation('timeRange_7d', state.currentLanguage) },
    { value: '30d', label: getTranslation('timeRange_30d', state.currentLanguage) },
    { value: 'custom', label: getTranslation('timeRange_custom', state.currentLanguage) },
    { value: 'all', label: getTranslation('timeRange_all', state.currentLanguage) }
  ];

  return (
    <div className="space-y-6 sm:space-y-8 fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('financialAnalytics', state.currentLanguage)}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{getTranslation('financialSubtitle', state.currentLanguage)}</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-full sm:w-auto flex items-center justify-evenly sm:justify-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm overflow-x-auto no-scrollbar">
            {timeRangeOptions.map((option) => {
              const isActive = timeRange === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (option.value === 'custom') {
                      setTempCustomRange({ ...customDateRange });
                      setShowCustomDateModal(true);
                    } else {
                      setTimeRange(option.value);
                    }
                  }}
                  className={`flex-1 sm:flex-none text-center whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${isActive
                    ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#2f3c7e] dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => {
                if (isPlanExpired(state)) {
                  if (window.showToast) {
                    window.showToast('Access Restricted: A base subscription plan is required to add expenses.', 'warning');
                  }
                  return;
                }
                setShowExpenseModal(true);
              }}
              className={`h-10 flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 rounded-lg text-sm font-medium transition-colors shadow-sm whitespace-nowrap ${isPlanExpired(state)
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                : 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30'
                }`}
              disabled={isPlanExpired(state)}
            >
              <Wallet className="h-4 w-4" />
              {getTranslation('addExpense', state.currentLanguage)}
            </button>

            <div className="relative flex-1 sm:flex-none" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(true)}
                className="h-10 w-full sm:w-auto px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <Download className="h-4 w-4" />
                <span>{getTranslation('export', state.currentLanguage)}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
              </button>
              {showExportMenu && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                  <div
                    className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{getTranslation('exportReports', state.currentLanguage)}</h3>
                      <button
                        onClick={() => setShowExportMenu(false)}
                        className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="p-2 space-y-1">
                      <button
                        onClick={() => {
                          exportFinancialCSV();
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                          <FileSpreadsheet className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsCSV', state.currentLanguage)}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('csvFormatDesc', state.currentLanguage)}</span>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          exportFinancialJSON();
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                          <FileJson className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsJSON', state.currentLanguage)}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('jsonFormatDesc', state.currentLanguage)}</span>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          exportFinancialPDF();
                          setShowExportMenu(false);
                        }}
                        className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                      >
                        <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsPDF', state.currentLanguage)}</span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printablePdfDesc', state.currentLanguage)}</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { id: 'totalRevenue', title: getTranslation('totalRevenue', state.currentLanguage), value: totalRevenue, color: 'emerald', icon: <TrendingUp /> },
          { id: 'totalExpenses', title: getTranslation('totalExpenses', state.currentLanguage), value: totalBusinessExpenses, color: 'red', icon: <TrendingDown /> },
          { id: 'netProfit', title: getTranslation('netProfit', state.currentLanguage), value: netProfit, color: 'indigo', icon: <Calculator /> },
          { id: 'receivables', title: getTranslation('receivables', state.currentLanguage), value: totalReceivables, color: 'amber', icon: <CreditCard /> },
        ].map((card, idx) => (
          <div key={idx} className="relative bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            {/* Icon Top Right */}
            <div className={`absolute top-4 right-4 p-2.5 rounded-xl ${card.color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
              card.color === 'red' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                card.color === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' :
                  'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              }`}>
              {React.cloneElement(card.icon, { className: 'h-5 w-5' })}
            </div>

            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{card.title}</p>
              <p className={`text-2xl font-semibold whitespace-nowrap overflow-x-auto scrollbar-hide ${card.id === 'totalRevenue' ? 'text-emerald-600' :
                card.id === 'totalExpenses' ? 'text-rose-600' :
                  card.id === 'netProfit' ? (card.value >= 0 ? 'text-emerald-600' : 'text-rose-600') :
                    card.id === 'receivables' ? 'text-amber-600' :
                      'text-gray-900 dark:text-white'
                }`} title={formatCurrency(card.value)}>
                {formatCurrencySmart(card.value, state.currencyFormat)}
              </p>
              {card.id === 'totalExpenses' && totalBusinessExpenses > 0 && (
                <p className="text-[10px] text-gray-500 mt-2">
                  {getTranslation('cogs', state.currentLanguage)}: <span title={formatCurrency(totalCogs)}>{formatCurrencySmart(totalCogs, state.currencyFormat)}</span> • {getTranslation('petty', state.currentLanguage)}: <span title={formatCurrency(totalPettyExpenses)}>{formatCurrencySmart(totalPettyExpenses, state.currencyFormat)}</span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{getTranslation('revenueVsExpenses', state.currentLanguage)}</h2>
          <div className="h-[300px]">
            <Bar
              data={revenueChartData}
              options={{
                ...chartOptions,
                onClick: (event, elements, chart) => {
                  if (elements && elements.length > 0) {
                    const index = elements[0].index;
                    const label = revenueChartData.labels[index];
                    if (label) setSelectedDate(label);
                  }
                },
                plugins: {
                  ...chartOptions.plugins,
                  legend: {
                    ...chartOptions.plugins.legend,
                    labels: {
                      ...chartOptions.plugins.legend.labels,
                      color: state.darkMode ? '#94a3b8' : '#64748b'
                    }
                  }
                },
                scales: {
                  y: {
                    ...chartOptions.scales.y,
                    grid: { color: state.darkMode ? 'rgba(148, 163, 184, 0.1)' : 'rgba(0, 0, 0, 0.05)' },
                    ticks: { color: state.darkMode ? '#94a3b8' : '#64748b' }
                  },
                  x: {
                    ...chartOptions.scales.x,
                    ticks: { color: state.darkMode ? '#94a3b8' : '#64748b' }
                  }
                }
              }}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">{getTranslation('paymentMethods', state.currentLanguage)}</h2>
          <div className="h-[300px] mb-4">
            <Pie
              data={paymentMethodData}
              options={{
                ...pieChartOptions,
                plugins: {
                  ...pieChartOptions.plugins,
                  legend: {
                    ...pieChartOptions.plugins.legend,
                    labels: {
                      ...pieChartOptions.plugins.legend.labels,
                      color: state.darkMode ? '#94a3b8' : '#64748b'
                    }
                  }
                }
              }}
            />
          </div>
          <div className="space-y-2">
            {paymentMethodLabels.map((label, index) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-slate-400">{label}</span>
                <span className="font-semibold text-gray-900 dark:text-white" title={formatCurrency(paymentMethodAmounts[index])}>
                  {formatCurrencySmart(paymentMethodAmounts[index], state.currencyFormat)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" />
            {getTranslation('financialAlertsInsights', state.currentLanguage)}
          </h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {totalReceivables > 0 && (
              <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-100 dark:border-amber-900/30 flex items-start gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-md">
                  <CreditCard className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider mb-1">{getTranslation('receivablesAction', state.currentLanguage)}</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    {getTranslation('outstandingDebtMsg', state.currentLanguage)
                      .replace('{amount}', formatCurrencySmart(totalReceivables, state.currencyFormat))
                      .replace('{count}', customersWithDebt)}
                  </p>
                </div>
              </div>
            )}

            {profitMargin < 15 && profitMargin > 0 && (
              <div className="p-4 bg-rose-50 dark:bg-rose-900/10 rounded-lg border border-rose-100 dark:border-rose-900/30 flex items-start gap-3">
                <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-md">
                  <TrendingDown className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-rose-800 dark:text-rose-400 uppercase tracking-wider mb-1">{getTranslation('marginAlert', state.currentLanguage)}</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    {getTranslation('lowMarginMsg', state.currentLanguage).replace('{margin}', profitMargin.toFixed(1))}
                  </p>
                </div>
              </div>
            )}

            {netProfit < 0 && (
              <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30 flex items-start gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-md">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-red-800 dark:text-red-400 uppercase tracking-wider mb-1">{getTranslation('operatingLoss', state.currentLanguage)}</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    {getTranslation('negativeProfitMsg', state.currentLanguage).replace('{amount}', formatCurrencySmart(Math.abs(netProfit), state.currencyFormat))}
                  </p>
                </div>
              </div>
            )}

            {totalReceivables === 0 && profitMargin >= 15 && netProfit >= 0 && (
              <div className="col-span-full py-8 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mb-4">
                  <Target className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{getTranslation('financialHealthExcellent', state.currentLanguage)}</h4>
                <p className="text-gray-500 dark:text-slate-400 text-sm max-w-sm">
                  {getTranslation('financialHealthMsg', state.currentLanguage)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {
        showTransactionModal && selectedTransaction && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 overflow-y-auto py-4">
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col my-auto border border-gray-100 dark:border-slate-700">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 flex-shrink-0 bg-gray-50/50 dark:bg-slate-800/50">
                <div>
                  <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1">{getTranslation('receiptDetails', state.currentLanguage)}</p>
                  <h4 className="text-2xl font-black text-gray-900 dark:text-white">
                    {selectedTransaction.customerName || getTranslation('walkInCustomer', state.currentLanguage)}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                      {new Date(selectedTransaction.date).toLocaleString()}
                    </p>
                    <span className="text-gray-300 dark:text-slate-600">•</span>
                    <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {getPaymentMethodLabel(selectedTransaction.paymentMethod)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleShareTransaction(selectedTransaction)}
                    className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all shadow-sm"
                    title="Share Bill"
                  >
                    <Share2 className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTransactionModal(false);
                      setSelectedTransaction(null);
                    }}
                    className="p-3 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-2xl transition-all"
                    aria-label="Close modal"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1 dark:bg-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('date', state.currentLanguage)}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {formatDateTime(selectedTransaction.createdAt || selectedTransaction.date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('customerName', state.currentLanguage)}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedTransaction.customerName || getTranslation('walkInCustomer', state.currentLanguage)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('mobile', state.currentLanguage)}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedTransaction.customerMobile || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('payment', state.currentLanguage)}</p>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getPaymentMethodBadgeClass(selectedTransaction.paymentMethod)}`}>
                      {selectedTransaction.paymentMethod || 'N/A'}
                    </span>
                  </div>
                  {(() => {
                    const paymentMethod = (selectedTransaction.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = selectedTransaction.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="sm:col-span-2">
                          <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">{getTranslation('splitPaymentBreakdown', state.currentLanguage)}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                              <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">{getTranslation('cash', state.currentLanguage)}</p>
                              <p className="text-lg font-bold text-green-900 dark:text-green-100" title={formatCurrency(cashAmount)}>
                                {formatCurrencySmart(cashAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                              <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">{getTranslation('online', state.currentLanguage)}</p>
                              <p className="text-lg font-bold text-blue-900 dark:text-blue-100" title={formatCurrency(onlineAmount)}>
                                {formatCurrencySmart(onlineAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                              <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">{getTranslation('due', state.currentLanguage)}</p>
                              <p className="text-lg font-bold text-red-900 dark:text-red-100" title={formatCurrency(dueAmount)}>
                                {formatCurrencySmart(dueAmount, state.currencyFormat)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div className="sm:col-span-2">
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">{getTranslation('totalAmount', state.currentLanguage)}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white" title={formatCurrency(selectedTransaction.totalAmount || selectedTransaction.total)}>
                      {formatCurrencySmart(selectedTransaction.totalAmount || selectedTransaction.total, state.currencyFormat)}
                    </p>
                  </div>
                </div>

                {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                  <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                      <thead className="bg-gray-100 dark:bg-slate-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                            {getTranslation('productHeader', state.currentLanguage)}
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                            {getTranslation('quantityHeader', state.currentLanguage)}
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                            {getTranslation('rateHeaderCap', state.currentLanguage)}
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                            {getTranslation('totalHeaderCap', state.currentLanguage)}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                        {selectedTransaction.items.map((item, idx) => {
                          const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                          return (
                            <tr key={`${item.productId || item.name || idx}-${idx}`} className="dark:bg-slate-800">
                              <td className="px-4 py-2 text-gray-800 dark:text-slate-200">
                                <span className="truncate block max-w-[200px]" title={item.name || '—'}>{item.name || '—'}</span>
                              </td>
                              <td className="px-4 py-2 text-center text-gray-600 dark:text-slate-400">
                                {qty} {unit}
                              </td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-400" title={formatCurrency(rate)}>{formatCurrencySmart(rate, state.currencyFormat)}</td>
                              <td className="px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-200" title={formatCurrency(total)}>
                                {formatCurrencySmart(total, state.currencyFormat)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedTransaction.note && (
                  <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 rounded-xl p-3 text-sm text-primary-700 dark:text-primary-300">
                    <p className="text-xs uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-1">{getTranslation('note', state.currentLanguage)}</p>
                    {selectedTransaction.note}
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-gray-200 dark:border-slate-700 px-6 py-4 flex-shrink-0 dark:bg-slate-800/50">
                <button
                  type="button"
                  onClick={() => {
                    setShowTransactionModal(false);
                    setSelectedTransaction(null);
                  }}
                  className="btn-secondary dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600"
                >
                  {getTranslation('close', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Purchase Order Detail Modal */}
      {
        showPurchaseOrderModal && selectedPurchaseOrder && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 dark:border-slate-700">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 bg-gray-50/50 dark:bg-slate-800/50">
                <div>
                  <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1">{getTranslation('purchaseOrderDetails', state.currentLanguage)}</p>
                  <h4 className="text-2xl font-black text-gray-900 dark:text-white">
                    {selectedPurchaseOrder.supplierName || getTranslation('unknownSupplier', state.currentLanguage)}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs font-bold text-gray-500 dark:text-slate-400">
                      PO #{(selectedPurchaseOrder.id || selectedPurchaseOrder._id || '').toString().slice(-8).toUpperCase()}
                    </p>
                    <span className="text-gray-300 dark:text-slate-600">•</span>
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                      {formatDisplayDate(selectedPurchaseOrder.createdAt || selectedPurchaseOrder.orderDate || selectedPurchaseOrder.date)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPurchaseOrderModal(false);
                    setSelectedPurchaseOrder(null);
                  }}
                  className="p-3 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-2xl transition-all"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 dark:bg-slate-800">
                {/* Status and Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{getTranslation('status', state.currentLanguage)}</p>
                    <span className={getPurchaseOrderStatusBadge(selectedPurchaseOrder.status)}>
                      {getPurchaseOrderStatusLabel(selectedPurchaseOrder.status)}
                    </span>
                  </div>
                  {selectedPurchaseOrder.expectedDeliveryDate && (
                    <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3">
                      <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{getTranslation('expectedDelivery', state.currentLanguage)}</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {formatDisplayDate(selectedPurchaseOrder.expectedDeliveryDate)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Items */}
                {selectedPurchaseOrder.items && selectedPurchaseOrder.items.length > 0 && (
                  <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                      <thead className="bg-gray-100 dark:bg-slate-700">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-slate-300">{getTranslation('productHeader', state.currentLanguage)}</th>
                          <th className="px-4 py-2 text-center font-medium text-gray-600 dark:text-slate-300">{getTranslation('quantityHeader', state.currentLanguage)}</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300">{getTranslation('priceValueHeader', state.currentLanguage)}</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300">{getTranslation('total', state.currentLanguage)}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                        {selectedPurchaseOrder.items.map((item, idx) => {
                          const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

                          return (
                            <tr key={idx} className="dark:bg-slate-800">
                              <td className="px-4 py-2 text-gray-800 dark:text-slate-200">
                                <span className="truncate block max-w-[200px]" title={item.productName || item.name || '—'}>
                                  {item.productName || item.name || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-center text-gray-600 dark:text-slate-400">
                                {qty} {unit}
                              </td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-400" title={formatCurrency(rate)}>
                                {formatCurrencySmart(rate, state.currencyFormat)}
                              </td>
                              <td className="px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-200" title={formatCurrency(total)}>
                                {formatCurrencySmart(total, state.currencyFormat)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Total */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{getTranslation('totalAmount', state.currentLanguage)}</span>
                    <span className="text-2xl font-bold text-blue-900 dark:text-blue-100" title={formatCurrency(resolvePurchaseOrderTotal(selectedPurchaseOrder))}>
                      {formatCurrencySmart(resolvePurchaseOrderTotal(selectedPurchaseOrder), state.currencyFormat)}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {selectedPurchaseOrder.notes && (
                  <div className="bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-700 rounded-xl p-3 text-sm text-gray-700 dark:text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">{getTranslation('notes', state.currentLanguage)}</p>
                    {selectedPurchaseOrder.notes}
                  </div>
                )}
              </div>

              <div className="flex justify-end border-t border-gray-200 dark:border-slate-700 px-6 py-4 dark:bg-slate-800/50">
                <button
                  type="button"
                  onClick={() => {
                    setShowPurchaseOrderModal(false);
                    setSelectedPurchaseOrder(null);
                  }}
                  className="btn-secondary dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600"
                >
                  {getTranslation('close', state.currentLanguage)}
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Expenses Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 text-rose-500" />
            {getTranslation('pettyExpenses', state.currentLanguage)}
          </h2>
          {filteredDailyExpenses.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-slate-400">
              {getTranslation('total', state.currentLanguage)}: <span title={formatCurrency(totalPettyExpenses)}>{formatCurrencySmart(totalPettyExpenses, state.currencyFormat)}</span>
            </span>
          )}
        </div>

        {filteredDailyExpenses.length > 0 ? (
          <div>
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-slate-700/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 rounded-l-lg">{getTranslation('date', state.currentLanguage)}</th>
                    <th className="px-4 py-3">{getTranslation('categoryHeader', state.currentLanguage)}</th>
                    <th className="px-4 py-3">{getTranslation('descriptionHeader', state.currentLanguage)}</th>
                    <th className="px-4 py-3 text-right">{getTranslation('amount', state.currentLanguage)}</th>
                    <th className="px-4 py-3 rounded-r-lg text-center">{getTranslation('actionsHeader', state.currentLanguage)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {currentExpenses.map((exp) => (
                    <tr key={exp._id || exp.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {formatDisplayDate(exp.date)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                          {getTranslation('expenseCategories', state.currentLanguage)?.[exp.category] || exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                        {exp.description || '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white" title={formatCurrency(exp.amount)}>
                        {formatCurrencySmart(exp.amount, state.currencyFormat)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => {
                            if (isPlanExpired(state)) {
                              if (window.showToast) window.showToast('Plan expired. Upgrade to manage expenses.', 'error');
                              return;
                            }
                            handleDeleteExpense(exp.id || exp._id);
                          }}
                          disabled={isPlanExpired(state)}
                          className={`p-1 text-rose-500 hover:bg-rose-50 rounded dark:hover:bg-rose-900/20 transition-colors ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title="Delete Expense"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
              {currentExpenses.map((exp) => (
                <div key={exp._id || exp.id} className="p-4 bg-gray-50 dark:bg-slate-900/40 rounded-xl border border-gray-100 dark:border-slate-700">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                        {formatDisplayDate(exp.date)}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {getTranslation('expenseCategories', state.currentLanguage)?.[exp.category] || exp.category}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if (isPlanExpired(state)) {
                          if (window.showToast) window.showToast('Plan expired. Upgrade to manage expenses.', 'error');
                          return;
                        }
                        handleDeleteExpense(exp.id || exp._id);
                      }}
                      disabled={isPlanExpired(state)}
                      className={`p-2 text-rose-500 bg-rose-50 dark:bg-rose-900/20 rounded-lg ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex justify-between items-end mt-3">
                    <p className="text-sm text-gray-600 dark:text-slate-400 italic flex-1 mr-4">
                      {exp.description || getTranslation('noDescription', state.currentLanguage)}
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white" title={formatCurrency(exp.amount)}>
                      {formatCurrencySmart(exp.amount, state.currencyFormat)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {totalExpensePages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-700 px-4 py-3 mt-4">
                <div className="text-sm text-gray-500 dark:text-slate-400">
                  {getTranslation('showingRecords', state.currentLanguage)
                    .replace('{start}', indexOfFirstExpense + 1)
                    .replace('{end}', Math.min(indexOfLastExpense, filteredDailyExpenses.length))
                    .replace('{total}', filteredDailyExpenses.length)
                    .replace('{items}', getTranslation('expenses', state.currentLanguage))
                  }
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={prevPage}
                    disabled={expensePage === 1}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
                    {getTranslation('page', state.currentLanguage)} {expensePage} {getTranslation('of', state.currentLanguage)} {totalExpensePages}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={expensePage === totalExpensePages}
                    className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
            <Wallet className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500 dark:text-slate-400">{getTranslation('noExpensesPeriod', state.currentLanguage)}</p>
            <button
              onClick={() => {
                if (isPlanExpired(state)) {
                  if (window.showToast) window.showToast('Plan expired. Upgrade to manage expenses.', 'error');
                  return;
                }
                setShowExpenseModal(true);
              }}
              className="mt-4 text-sm text-indigo-600 font-medium hover:underline"
            >
              {getTranslation('addFirstExpense', state.currentLanguage)}
            </button>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {
        showExpenseModal && (
          <div
            className={`fixed inset-0 z-[1050] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isClosingExpense ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={(e) => { if (e.target === e.currentTarget) handleCloseExpenseModal(); }}
          >
            <style>{`
              @keyframes slideUp {
                  from { transform: translateY(100%); }
                  to { transform: translateY(0); }
              }
              @keyframes slideDown {
                  from { transform: translateY(0); }
                  to { transform: translateY(100%); }
              }
            `}</style>
            <div
              style={{ animation: `${isClosingExpense ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
              className="bg-white dark:bg-slate-800 w-full max-w-md rounded-none sm:rounded-b-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-slate-700 max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 flex-shrink-0">
                <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2">
                  <div className="bg-rose-100 dark:bg-rose-900/30 p-2 rounded-xl">
                    <Wallet className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  {getTranslation('addExpense', state.currentLanguage)}
                </h3>
                <button
                  onClick={handleCloseExpenseModal}
                  className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-slate-800">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('amount', state.currentLanguage)} (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newExpense.amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^[0-9]*\.?[0-9]*$/.test(value)) {
                        setNewExpense({ ...newExpense, amount: value });
                      }
                    }}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all"
                    placeholder="0.00"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('categoryHeader', state.currentLanguage)} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={newExpense.category}
                      onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all appearance-none cursor-pointer"
                    >
                      {[
                        { id: 'Tea/Coffee', label: getTranslation('teaCoffee', state.currentLanguage) },
                        { id: 'Cleaning', label: getTranslation('cleaning', state.currentLanguage) },
                        { id: 'Transport', label: getTranslation('transport', state.currentLanguage) },
                        { id: 'Utility', label: getTranslation('utility', state.currentLanguage) },
                        { id: 'Maintenance', label: getTranslation('maintenance', state.currentLanguage) },
                        { id: 'Salaries', label: getTranslation('salaries', state.currentLanguage) },
                        { id: 'Rent', label: getTranslation('rent', state.currentLanguage) },
                        { id: 'Other', label: getTranslation('other', state.currentLanguage) }
                      ].map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('date', state.currentLanguage)}
                  </label>
                  <input
                    type="date"
                    value={newExpense.date}
                    onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('descriptionHeader', state.currentLanguage)} ({getTranslation('optional', state.currentLanguage)})
                  </label>
                  <textarea
                    value={newExpense.description}
                    onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all resize-none h-24"
                    placeholder={getTranslation('expenseDescriptionPlaceholder', state.currentLanguage)}
                  ></textarea>
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={handleCloseExpenseModal}
                    className="flex-1 py-3 text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium transition-colors"
                  >
                    {getTranslation('cancel', state.currentLanguage)}
                  </button>
                  <button
                    onClick={handleAddExpense}
                    disabled={!newExpense.amount}
                    className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-200 dark:shadow-none flex items-center justify-center gap-2"
                  >
                    {isSubmittingExpense ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        {getTranslation('saving', state.currentLanguage)}
                      </>
                    ) : (
                      <>
                        <Plus className="h-5 w-5" />
                        {getTranslation('addExpense', state.currentLanguage)}
                      </>
                    )}
                  </button>
                </div>

                {state.expenses && state.expenses.length > 0 && (
                  <div className="pt-6 border-t border-gray-100 dark:border-slate-700">
                    <h4 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                      <span>{getTranslation('expensesFor', state.currentLanguage) || 'Expenses for'} {new Date(newExpense.date).toLocaleDateString()}</span>
                      <span className="text-[10px] bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full text-gray-600 dark:text-slate-300">
                        {state.expenses.filter(exp => {
                          if (!exp.date && !exp.createdAt) return false;
                          const expD = new Date(exp.date || exp.createdAt);
                          const selD = new Date(newExpense.date);
                          return expD.getDate() === selD.getDate() &&
                            expD.getMonth() === selD.getMonth() &&
                            expD.getFullYear() === selD.getFullYear();
                        }).length} items
                      </span>
                    </h4>
                    <div className="space-y-3">
                      {state.expenses.filter(exp => {
                        if (!exp.date && !exp.createdAt) return false;
                        const expD = new Date(exp.date || exp.createdAt);
                        const selD = new Date(newExpense.date);
                        return expD.getDate() === selD.getDate() &&
                          expD.getMonth() === selD.getMonth() &&
                          expD.getFullYear() === selD.getFullYear();
                      })
                        .sort((a, b) => {
                          const dateA = new Date(a.createdAt || a.date || 0);
                          const dateB = new Date(b.createdAt || b.date || 0);
                          // If dates are equal (or invalid/missing), fallback to ID comparison if accessible (assuming newer IDs are higher/newer)
                          if (dateA.getTime() === dateB.getTime()) {
                            return (b.id || b._id || '').toString().localeCompare((a.id || a._id || '').toString());
                          }
                          return dateB - dateA;
                        })
                        .slice(0, 5)
                        .map((exp, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900/30 rounded-xl border border-gray-100 dark:border-slate-800">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="w-8 h-8 flex-shrink-0 rounded-full bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center text-rose-600 dark:text-rose-400 font-bold text-xs">
                                {exp.category ? exp.category[0] : 'E'}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white capitalize truncate">{exp.category}</p>
                                {exp.description && <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{exp.description}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="font-bold text-gray-900 dark:text-white">{formatCurrencySmart(exp.amount, state.currencyFormat)}</span>
                              <button
                                onClick={() => handleDeleteExpense(exp.id || exp._id)}
                                className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                                title={getTranslation('deleteExpense', state.currentLanguage) || 'Delete'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      {state.expenses.filter(exp => {
                        const expD = new Date(exp.date || exp.createdAt);
                        const selD = new Date(newExpense.date);
                        return expD.getDate() === selD.getDate() &&
                          expD.getMonth() === selD.getMonth() &&
                          expD.getFullYear() === selD.getFullYear();
                      }).length === 0 && (
                          <div className="text-center py-4 bg-gray-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700">
                            <p className="text-sm text-gray-500 dark:text-slate-400">
                              {getTranslation('noExpensesForDate', state.currentLanguage) || 'No expenses recorded for this date'}
                            </p>
                          </div>
                        )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      {/* Delete Confirmation Modal */}
      {
        showDeleteConfirmModal && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirmModal(false)}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2rem] shadow-2xl p-6 text-center animate-slideUp border border-gray-100 dark:border-slate-700" onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{getTranslation('deleteExpenseQuestion', state.currentLanguage)}</h3>
              <p className="text-gray-500 dark:text-slate-400 mb-6 leading-relaxed">
                {getTranslation('deleteExpenseConfirm', state.currentLanguage)}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirmModal(false)}
                  className="flex-1 py-3 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {getTranslation('cancel', state.currentLanguage)}
                </button>
                <button
                  onClick={confirmDeleteExpense}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 dark:shadow-none"
                >
                  {getTranslation('deleteOrder', state.currentLanguage)?.replace('Order', '') || 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Custom Date Modal */}
      {
        showCustomDateModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-indigo-600" />
                  {getTranslation('selectRange', state.currentLanguage)}
                </h3>
                <button
                  onClick={() => setShowCustomDateModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('startDate', state.currentLanguage)}</label>
                  <input
                    type="date"
                    value={tempCustomRange.start}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('endDate', state.currentLanguage)}</label>
                  <input
                    type="date"
                    value={tempCustomRange.end}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setCustomDateRange(tempCustomRange);
                      setTimeRange('custom');
                      setShowCustomDateModal(false);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
                  >
                    {getTranslation('applyFilter', state.currentLanguage)}
                  </button>
                  <button
                    onClick={() => setShowCustomDateModal(false)}
                    className="w-full py-3 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                  >
                    {getTranslation('cancel', state.currentLanguage)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
      {/* Hourly Details Modal */}
      {selectedDate && (
        <div
          className={`fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isClosingBreakdown ? 'opacity-0' : 'animate-fadeIn'}`}
          onClick={handleCloseBreakdown}
        >
          <style>{`
            @keyframes slideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }
            @keyframes slideDown {
                from { transform: translateY(0); }
                to { transform: translateY(100%); }
            }
          `}</style>
          <div
            key={isClosingBreakdown ? 'closing' : 'opening'}
            style={{ animation: `${isClosingBreakdown ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
            className="bg-white dark:bg-slate-800 w-full h-[95vh] sm:h-auto sm:max-h-[95vh] sm:max-w-4xl rounded-none sm:rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-slate-700 relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  {getTranslation('financialBreakdown', state.currentLanguage)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {getTranslation('hourlyAnalysisFor', state.currentLanguage)} <span className="font-semibold text-indigo-600 dark:text-indigo-400">{selectedDate}</span>
                </p>
              </div>
              <button
                onClick={handleCloseBreakdown}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                aria-label="Close"
              >
                <XCircle className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6">
              <div className="h-80">
                <Line
                  data={hourlyFinancialChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                          usePointStyle: true,
                          boxWidth: 8
                        }
                      },
                      tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        titleColor: '#1e293b',
                        bodyColor: '#475569',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                          label: function (context) {
                            return `${context.dataset.label}: ${formatCurrencySmart(context.parsed.y, state.currencyFormat)}`;
                          }
                        }
                      }
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        grid: {
                          color: 'rgba(0, 0, 0, 0.05)',
                        },
                        ticks: {
                          callback: function (value) {
                            return formatCurrencySmart(value, state.currencyFormat);
                          }
                        }
                      },
                      x: {
                        grid: {
                          display: false
                        }
                      }
                    },
                    interaction: {
                      mode: 'nearest',
                      axis: 'x',
                      intersect: false
                    }
                  }}
                />
              </div>

              <div className="mt-6 flex justify-end gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wide font-bold">{getTranslation('totalRevenue', state.currentLanguage)}</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                    {formatCurrencySmart(
                      hourlyFinancialChartData.datasets[0].data.reduce((a, b) => a + b, 0),
                      state.currencyFormat
                    )}
                  </p>
                </div>
                <div className="bg-rose-50 dark:bg-rose-900/20 px-4 py-3 rounded-xl border border-rose-100 dark:border-rose-900/30">
                  <p className="text-xs text-rose-600 dark:text-rose-400 uppercase tracking-wide font-bold">{getTranslation('totalExpenses', state.currentLanguage)}</p>
                  <p className="text-xl font-bold text-rose-900 dark:text-rose-100 mt-1">
                    {formatCurrencySmart(
                      hourlyFinancialChartData.datasets[1].data.reduce((a, b) => a + b, 0),
                      state.currencyFormat
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default Financial;
