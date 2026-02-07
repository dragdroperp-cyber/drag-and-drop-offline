import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp, triggerSyncStatusUpdate, isPlanExpired } from '../../context/AppContext';
import { PageSkeleton, SkeletonStats, SkeletonCard } from '../UI/SkeletonLoader';
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
  XCircle,
  IndianRupee,
  Calendar
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import { fetchOrders, fetchTransactions, fetchVendorOrders, fetchCustomers, isOnline, syncToIndexedDB } from '../../utils/dataFetcher';
import { apiRequest, getSellerIdFromAuth } from '../../utils/api';
import syncService from '../../services/syncService';
import { addWatermarkToPDF } from '../../utils/pdfUtils';

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
  const [saleMode, setSaleMode] = useState('normal'); // 'normal' | 'direct'
  const [isLoading, setIsLoading] = useState(() => {
    // Avoid loading flicker if data is already in state
    const hasData = state.orders?.length > 0 || state.transactions?.length > 0 || state.refunds?.length > 0;
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
        const hasExistingData = state.orders?.length > 0 || state.transactions?.length > 0 || state.refunds?.length > 0;
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
  }, []); // Only run once on mount to prevent infinite loop since dispatch is unstable

  // Expenses sync is now handled by background sync via AppContext

  const handleAddExpense = async (e) => {
    e.preventDefault();

    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to add expenses.', 'warning', 8000);
      }
      return;
    }

    if (state.isReadOnlyMode) {
      if (window.showToast) {
        window.showToast('Action Blocked: Account active on another device.', 'error');
      }
      return;
    }
    const parsedAmount = parseFloat(newExpense.amount.toString().replace(/,/g, ''));
    if (!parsedAmount || parsedAmount <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }

    setIsSubmittingExpense(true);

    // Create optimistic expense object
    const optimisticExpense = {
      ...newExpense,
      amount: parsedAmount,
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Temp ID
      _id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      date: newExpense.date || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isSynced: false
    };

    try {
      // 1. Optimistic UI update via Global State (Instant Feedback)
      dispatch({ type: 'ADD_EXPENSE', payload: optimisticExpense });

      // 2. Close Modal & Reset Form
      setShowExpenseModal(false);
      setNewExpense({ amount: '', category: 'Tea/Coffee', description: '', date: new Date().toISOString().split('T')[0] });
      setExpensePage(1); // Reset to first page to see the new expense

      showToast("Expense added", "success");

      // 3. Defer IndexedDB and Sync operations to allow immediate UI render
      setTimeout(async () => {
        try {
          // Save to IndexedDB (asynchronous)
          await import('../../utils/indexedDB').then(({ addItem, STORES }) =>
            addItem(STORES.expenses, optimisticExpense)
          );

          // Trigger Sync Status and Schedule Sync
          triggerSyncStatusUpdate();

          if (syncService.isOnline()) {
            syncService.scheduleSync();
          }
        } catch (bgError) {
          console.error("Background save error:", bgError);
        }
      }, 0);

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

  const confirmDeleteExpense = () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to delete expenses.', 'warning', 8000);
      }
      return;
    }

    if (state.isReadOnlyMode) {
      if (window.showToast) {
        window.showToast('Action Blocked: Account active on another device.', 'error');
      }
      return;
    }
    if (!expenseToDelete) return;
    const id = expenseToDelete;

    // Optimistic UI Update: Immediately remove from UI
    setShowDeleteConfirmModal(false);
    setExpenseToDelete(null);
    dispatch({ type: 'DELETE_EXPENSE', payload: id });
    showToast("Expense deleted", "success");

    // Background Process: Update DB and Sync
    (async () => {
      try {
        // Soft delete in IndexedDB (Mark as deleted and unsynced for backend sync)
        const { getItem, updateItem, STORES } = await import('../../utils/indexedDB');

        const expense = await getItem(STORES.expenses, id);
        if (expense) {
          const deletedExpense = {
            ...expense,
            isDeleted: true,
            isSynced: false,
            updatedAt: new Date().toISOString()
          };
          await updateItem(STORES.expenses, deletedExpense);
        }

        // Trigger Sync Status Update (Instant UI Feedback)
        triggerSyncStatusUpdate();

        // Trigger Sync
        if (syncService.isOnline()) {
          syncService.scheduleSync();
        }

      } catch (err) {
        console.error("Expense error:", err);
        showToast("Error deleting expense (background)", "error");
        // Theoretically reset state here if critical, but for deletion it's rare to fail locally
      }
    })();
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
      ? `${formatCurrency(subtotalRaw)}`
      : '₹null';
    const discountDisplay = Number.isFinite(discountRaw)
      ? `${formatCurrency(discountRaw)}`
      : '₹null';
    const taxAmountDisplay = Number.isFinite(taxAmountRaw)
      ? `${formatCurrency(taxAmountRaw)}`
      : '₹null';
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}%`
      : 'null';
    const totalDisplay = Number.isFinite(totalRaw)
      ? `${formatCurrency(totalRaw)}`
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
      const rateCol = (Number.isFinite(lineRate) ? lineRate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'null').padStart(
        rateWidth,
        ' '
      );
      const totalCol = (Number.isFinite(lineTotal) ? lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'null').padStart(
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
      '       Powered by Inventory Studio',
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

  const getFinancialMonthsData = (orders = []) => {
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
    // 1. Revenues (Filtered Orders already account for seller, status, discounts and delivery)
    orders.forEach(o => {
      const oDate = new Date(o.createdAt || o.date);
      if (oDate >= startDate && oDate <= end) {
        const key = getKey(oDate);
        if (dataMap.has(key)) {
          const entry = dataMap.get(key);
          entry.revenue += (o.totalAmount || 0);
        }
      }
    });

    // 1.5 Subtract Refunds (Net Revenue)
    const sellerRefunds = filterBySeller(state.refunds || []);
    sellerRefunds.forEach(refund => {
      // Determine Refund Date
      let refundDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;
      if (!refundDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          refundDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          refundDate = new Date(0);
        }
      }

      if (isNaN(refundDate.getTime()) || refundDate < startDate || refundDate > endDate) return;

      const key = getKey(refundDate);
      if (!dataMap.has(key)) return;

      // Calculate Refund Amount (Respecting Sale Mode)
      let amountToSubtract = 0;
      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
      const originalOrder = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      if (originalOrder && originalOrder.items) {
        const allItems = originalOrder.items;
        const filteredItems = allItems.filter(item => {
          const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
          return (saleMode === 'normal') ? !isArrDProduct : isArrDProduct;
        });

        // Calculate Proportional Factor
        const totalItemsSum = allItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const filteredItemsSum = filteredItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const propFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;

        if (Array.isArray(refund.items) && refund.items.length > 0) {
          // Item-specific refund
          refund.items.forEach(ri => {
            const riPid = normalizeId(ri.productId || ri.product_id || ri._id || ri.id);
            let isMatch = false;

            const matchedOriginalItem = filteredItems.find(item => {
              const iPid = normalizeId(item.productId || item.product_id || item._id || item.id);
              const namesMatch = item.name && ri.name && item.name.trim().toLowerCase() === ri.name.trim().toLowerCase();
              return (iPid === riPid && iPid) || (namesMatch);
            });

            if (matchedOriginalItem) {
              const qty = Number(ri.qty || 0);
              const rate = Number(ri.rate || 0);
              amountToSubtract += (qty * rate);
            }
          });
        } else {
          // Global refund amount
          const totalAmt = Number(refund.totalRefundAmount || refund.amount || 0);
          amountToSubtract += (totalAmt * propFactor);
        }
      } else {
        // Fallback or ignore if no order found (consistent with Reports)
        amountToSubtract = 0;
      }

      // Subtract from Map
      if (dataMap.has(key)) {
        const entry = dataMap.get(key);
        entry.revenue -= amountToSubtract;
      }
    });

    // 2. Expenses (Purchase Orders) - EXCLUDED FROM PROFIT CALCULATION
    // Purchase Orders are inventory assets, not immediate expenses for profit/loss
    /* 
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
    */

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



  const filteredOrders = useMemo(() => {
    // Pre-process refunds for efficient lookup
    const refundsByOrder = new Map();
    const rawRefunds = state.refunds || [];
    const sellerRefunds = filterBySeller(rawRefunds);

    sellerRefunds.forEach(refund => {
      const orderId = normalizeId(refund.orderId || refund.order_id);
      if (!orderId) return;

      if (!refundsByOrder.has(orderId)) {
        refundsByOrder.set(orderId, []);
      }
      refundsByOrder.get(orderId).push(refund);
    });

    return filterBySeller(state.orders)
      .filter(order => {
        if (order.isDeleted) return false;

        // Match SalesOrderHistory logic: for online orders, only count if 'Delivered'
        if (order.orderSource === 'online' && order.orderStatus !== 'Delivered') {
          return false;
        }

        const orderDate = new Date(order.createdAt || order.date || 0);
        return orderDate >= startDate && orderDate <= endDate;
      })
      .map(order => {
        // Check if order has items
        if (!order.items || !Array.isArray(order.items)) return null;

        // Filter items based on mode
        const filteredItems = order.items.filter(item => {
          const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
          if (saleMode === 'normal') {
            return !isArrDProduct; // Exclude D-Products in Normal Mode
          } else {
            return isArrDProduct; // Include ONLY D-Products in Direct Mode
          }
        });

        // If no items left after filter, exclude this order
        if (filteredItems.length === 0) return null;

        // Recalculate totals for the filtered items
        const totalItemsSum = order.items.reduce((sum, item) => {
          return sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0);
        }, 0);

        const filteredItemsSum = filteredItems.reduce((sum, item) => {
          return sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0);
        }, 0);

        // Consistent logic with SalesOrderHistory for delivery charge and discount
        const originalGrandTotal = Number(order.totalAmount || order.total || 0);
        const discount = Number(order.discount || order.discountAmount || 0);

        // Infer delivery charge if missing
        let deliveryCharge = Number(order.deliveryCharge || 0);
        if (!deliveryCharge && originalGrandTotal > (totalItemsSum - discount + 1)) {
          deliveryCharge = originalGrandTotal - (totalItemsSum - discount);
        }

        // Net Product Sales (Total paid minus delivery)
        const netProductSales = originalGrandTotal - deliveryCharge;

        // Calculate proportional share for this mode
        const proportionalFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;
        let finalCalculatedTotal = proportionalFactor * originalGrandTotal;
        const deliveryShare = proportionalFactor * deliveryCharge;

        // --- REFUND DEDUCTION LOGIC REMOVED ---
        // Refunds are now handled as separate period-based metrics
        // -----------------------------

        // Return a new order object with filtered items and recalculated totals
        return {
          ...order,
          items: filteredItems,
          totalAmount: finalCalculatedTotal, // This is now Gross Sales
          total: finalCalculatedTotal,
          deliveryCharge: deliveryShare
        };
      })
      .filter(Boolean);
  }, [state.orders, state.refunds, startDate, endDate, saleMode]);

  // Extract pending orders separately (Online orders not Delivered/Cancelled)
  const pendingOrdersData = useMemo(() => {
    return filterBySeller(state.orders || []).filter(order => {
      if (order.isDeleted) return false;
      const isPending = order.orderSource === 'online' && !['Delivered', 'Cancelled'].includes(order.orderStatus);
      if (!isPending) return false;
      const orderDate = new Date(order.createdAt || order.date || 0);
      return orderDate >= startDate && orderDate <= endDate;
    }).map(order => {
      if (!order.items || !Array.isArray(order.items)) return null;
      const filteredItems = order.items.filter(item => {
        const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
        return (saleMode === 'normal') ? !isArrDProduct : isArrDProduct;
      });
      if (filteredItems.length === 0) return null;

      const totalItemsSum = order.items.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
      const filteredItemsSum = filteredItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
      const originalGrandTotal = Number(order.totalAmount || order.total || 0);
      const discount = Number(order.discount || order.discountAmount || 0);

      let deliveryCharge = Number(order.deliveryCharge || 0);
      if (!deliveryCharge && originalGrandTotal > (totalItemsSum - discount + 1)) {
        deliveryCharge = originalGrandTotal - (totalItemsSum - discount);
      }
      const netProductSales = originalGrandTotal - deliveryCharge;
      const proportionalFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;
      const finalCalculatedTotal = proportionalFactor * originalGrandTotal;
      const deliveryShare = proportionalFactor * deliveryCharge;
      const totalWithDelivery = finalCalculatedTotal;

      // Calculate COGS for these filtered items
      const totalCogsForFilteredItems = filteredItems.reduce((sum, item) => {
        return sum + Number(item.totalCostPrice ?? item.costPrice ?? item.purchasePrice ?? item.unitCost ?? item.basePrice ?? 0);
      }, 0);

      const pendingProfit = finalCalculatedTotal - totalCogsForFilteredItems;

      return {
        ...order,
        totalAmount: totalWithDelivery, // Pending sales includes delivery
        totalCogs: totalCogsForFilteredItems,
        pendingProfit: pendingProfit,
        deliveryCharge: deliveryShare
      };
    }).filter(Boolean);
  }, [state.orders, startDate, endDate, saleMode]);

  const { labels: chartLabels, revenues: monthlyRevenue, expenses: monthlyExpenses } = useMemo(() =>
    getFinancialMonthsData(filteredOrders),
    [filteredOrders, state.purchaseOrders, state.expenses, startDate, endDate]
  );

  const filteredPurchaseOrders = filterBySeller(state.purchaseOrders).filter(po => {
    if (po.isDeleted) return false;
    // Only count completed orders as expenses
    if (po.status !== 'completed') return false;
    const poDate = new Date(po.createdAt || po.orderDate || po.date || po.updatedAt || 0);
    return poDate >= startDate && poDate <= endDate;
  });

  // ✅ Financial metrics (filtered by time range)

  // Calculate refunds and refunded costs for the filtered orders
  const { totalRefunds, totalRefundedCost } = useMemo(() => {
    let refundAmount = 0;
    let refundCost = 0;

    const periodRefunds = filterBySeller(state.refunds || []).filter(refund => {
      const rDateValue = refund.refundDate || refund.createdAt || refund.date;
      if (!rDateValue) return false;
      const refundDate = new Date(rDateValue);
      if (Number.isNaN(refundDate.getTime())) return false;
      return refundDate >= startDate && refundDate <= endDate;
    });

    periodRefunds.forEach(refund => {
      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
      const originalOrder = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      let propFactor = 0;
      let orderItemsFiltered = [];

      if (originalOrder && originalOrder.items) {
        const allItems = originalOrder.items;
        const filteredItems = allItems.filter(item => {
          const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
          return (saleMode === 'normal') ? !isArrDProduct : isArrDProduct;
        });
        orderItemsFiltered = filteredItems;
        const totalItemsSum = allItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const filteredItemsSum = filteredItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        propFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;
      }

      if (Array.isArray(refund.items) && refund.items.length > 0) {
        refund.items.forEach(ri => {
          const riPid = normalizeId(ri.productId || ri.product_id || ri._id || ri.id);
          let isMatch = false;
          let matchedOriginalItem = null;

          if (originalOrder) {
            matchedOriginalItem = orderItemsFiltered.find(item => {
              const iPid = normalizeId(item.productId || item.product_id || item._id || item.id);
              const namesMatch = item.name && ri.name && item.name.trim().toLowerCase() === ri.name.trim().toLowerCase();
              return (iPid === riPid && iPid) || (namesMatch);
            });
            if (matchedOriginalItem) isMatch = true;
          }

          if (isMatch) {
            const qty = toNumber(ri.qty || 0);
            const rate = toNumber(ri.rate || 0);
            refundAmount += (qty * rate);

            if (matchedOriginalItem) {
              const origQty = toNumber(matchedOriginalItem.quantity || matchedOriginalItem.qty || 1);
              const unitCost = toNumber(matchedOriginalItem.totalCostPrice ?? matchedOriginalItem.costPrice ?? 0) / (origQty || 1);
              refundCost += (qty * unitCost);
            }
          }
        });
      } else {
        refundAmount += toNumber(refund.totalRefundAmount || refund.amount || 0) * propFactor;
      }
    });

    return { totalRefunds: refundAmount, totalRefundedCost: refundCost };
  }, [state.refunds, state.orders, startDate, endDate, saleMode]);

  // Comprehensive business-wide refunds for the period (independent of Sale Mode)
  const businessWideRefunds = useMemo(() => {
    return filterBySeller(state.refunds || []).filter(refund => {
      let refundDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;

      if (!refundDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          refundDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          refundDate = new Date(0);
        }
      }

      return refundDate >= startDate && refundDate <= endDate;
    }).reduce((sum, refund) => sum + Number(refund.totalRefundAmount || refund.amount || 0), 0);
  }, [state.refunds, state.orders, sellerIdentifiers, startDate, endDate]);

  // Use orders (sales) for revenue (Net Sales = Gross Sales - Refunds)
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0) - totalRefunds;
  const totalDeliveryCharges = filteredOrders.reduce((sum, o) => sum + (o.deliveryCharge || 0), 0);
  const totalPendingSales = pendingOrdersData.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const totalPendingProfit = pendingOrdersData.reduce((sum, o) => sum + (o.pendingProfit || 0), 0);
  const totalPendingDelivery = pendingOrdersData.reduce((sum, o) => sum + (o.deliveryCharge || 0), 0);

  // Calculate COGS from order items
  const calculateCogsFromOrderItems = (orders) => {
    const toNumber = (v) => (typeof v === 'number' ? v : parseFloat(v)) || 0;
    return orders.reduce((totalCogs, order) => {
      if (!order.items || !Array.isArray(order.items)) return totalCogs;

      const orderCogs = order.items.reduce((itemCogs, item) => {
        // Dashboard logic: totalCostPrice ?? costPrice
        const unitCost = toNumber(item.costPrice ?? item.purchasePrice ?? item.unitCost ?? item.basePrice ?? 0);
        const totalCostProp = toNumber(item.totalCostPrice);

        // Match Dashboard Logic:
        const finalItemCost = totalCostProp > 0 ? totalCostProp : unitCost;

        return itemCogs + finalItemCost;
      }, 0);

      return totalCogs + orderCogs;
    }, 0);
  };

  // Calculate COGS (Cost of Goods Sold) (Net COGS = Gross COGS - Refunded Cost)
  const grossCogs = calculateCogsFromOrderItems(filteredOrders);
  const totalCogs = grossCogs - totalRefundedCost;

  // Calculate profit from sales (Revenue - COGS)
  // This is now Net Gross Profit (Net Sales - Net COGS)
  const profitFromSales = totalRevenue - totalCogs;

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

  // Total Expenses for Profit Calculation = Operating Expenses ONLY
  // Purchase Orders are NOT included in expenses for Net Profit
  const totalExpenses = totalPettyExpenses;

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

  // Net Profit = (Net Gross Profit - Expenses)
  // profitFromSales (totalRevenue - totalCogs) is now Net Gross Profit
  const netProfit = profitFromSales - (saleMode === 'direct' ? 0 : totalPettyExpenses);
  // Total Business Outflow (for cash flow understanding, not profit/loss)
  const totalBusinessOutflow = totalPurchaseExpenses + totalPettyExpenses;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // Requirement 3: Strict Ledger Reliance (Calculate from transactions instead of cached balance)
  const totalReceivables = useMemo(() => {
    return (state.customerTransactions || []).reduce((sum, t) => {
      if (t.isDeleted) return sum;
      const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
      const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);
      if (isPayment) return sum - Number(t.amount || 0);
      if (isCredit) return sum + Number(t.amount || 0);
      return sum;
    }, 0);
  }, [state.customerTransactions]);

  const totalPayables = useMemo(() => {
    return (state.supplierTransactions || []).reduce((sum, t) => {
      if (t.isDeleted) return sum;
      const isPayment = ['payment', 'cash', 'online', 'upi', 'card'].includes(t.type);
      const isCredit = ['due', 'add_due', 'opening_balance', 'purchase_order'].includes(t.type);
      if (isPayment) return sum - Number(t.amount || 0);
      if (isCredit) return sum + Number(t.amount || 0);
      return sum;
    }, 0);
  }, [state.supplierTransactions]);

  const customersWithDebt = useMemo(() => {
    const balances = {};
    (state.customerTransactions || []).forEach(t => {
      if (t.isDeleted) return;
      const cId = t.customerId?.toString();
      if (!cId) return;
      if (!balances[cId]) balances[cId] = 0;

      const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
      const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);
      if (isPayment) balances[cId] -= Number(t.amount || 0);
      else if (isCredit) balances[cId] += Number(t.amount || 0);
    });
    return Object.values(balances).filter(b => b > 0.05).length;
  }, [state.customerTransactions]);

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

    // 1. Sum Gross Sales by Method
    filteredOrders.forEach((order) => {
      const method = (order.paymentMethod || '').toString().toLowerCase().trim();
      const totalAmount = order.totalAmount || order.total || 0;

      if (method === 'split') {
        totals.split = (totals.split || 0) + totalAmount;
      } else {
        const normalized = normalizePaymentMethod(order.paymentMethod);
        totals[normalized] = (totals[normalized] || 0) + totalAmount;
      }
    });

    // 2. Subtract Refunds from Methods (Net Sales logic)
    const sellerRefunds = filterBySeller(state.refunds || []);
    sellerRefunds.forEach(refund => {
      // Determine Refund Date (using same logic as elsewhere)
      let refundDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;
      if (!refundDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          refundDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          refundDate = new Date(0); // Fallback
        }
      }

      // Check if refund belongs to selected range
      if (isNaN(refundDate.getTime()) || refundDate < startDate || refundDate > endDate) return;

      // Calculate Refund Amount (Respecting Sale Mode)
      let amountToSubtract = 0;
      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
      const originalOrder = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      if (originalOrder && originalOrder.items) {
        // --- Sale Mode Filter ---
        const allItems = originalOrder.items;
        const filteredItems = allItems.filter(item => {
          const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
          return (saleMode === 'normal') ? !isArrDProduct : isArrDProduct;
        });

        // Proportional Factor for Mode
        const totalItemsSum = allItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const filteredItemsSum = filteredItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const propFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;

        // Calculate specific refund amount
        if (Array.isArray(refund.items) && refund.items.length > 0) {
          refund.items.forEach(ri => {
            const riPid = normalizeId(ri.productId || ri.product_id || ri._id || ri.id);
            const matchedOriginalItem = filteredItems.find(item => {
              const iPid = normalizeId(item.productId || item.product_id || item._id || item.id);
              return (iPid === riPid && iPid) || (item.name && ri.name && item.name.trim().toLowerCase() === ri.name.trim().toLowerCase());
            });
            if (matchedOriginalItem) {
              amountToSubtract += (Number(ri.qty || 0) * Number(ri.rate || 0));
            }
          });
        } else {
          amountToSubtract += (Number(refund.totalRefundAmount || refund.amount || 0) * propFactor);
        }

        // --- Subtract from Method ---
        if (amountToSubtract > 0) {
          const method = (originalOrder.paymentMethod || '').toString().toLowerCase().trim();
          if (method === 'split') {
            totals.split -= amountToSubtract;
          } else {
            const normalized = normalizePaymentMethod(originalOrder.paymentMethod);
            if (totals[normalized] !== undefined) {
              totals[normalized] -= amountToSubtract;
            }
          }
        }
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

    // 1.5 Subtract Hourly Refunds
    const sellerRefunds = filterBySeller(state.refunds || []);
    sellerRefunds.forEach(refund => {
      // Determine Refund Date
      let refundDate = refund.createdAt || refund.date ? new Date(refund.createdAt || refund.date) : null;
      if (!refundDate) {
        const orderId = (refund.orderId || refund.order_id || '').toString();
        const originalOrder = (state.orders || []).find(o => (o._id || o.id || '').toString() === orderId);
        if (originalOrder) {
          refundDate = new Date(originalOrder.createdAt || originalOrder.date || 0);
        } else {
          refundDate = new Date(0);
        }
      }

      // Check if refund belongs to selected date
      if (formatDate(refundDate) !== selectedDate) return;

      const hour = refundDate.getHours();

      // Calculate Refund Amount (Respecting Sale Mode)
      let amountToSubtract = 0;
      const rid = (refund.orderId || refund.orderID || refund.order_id || '').toString();
      const originalOrder = (state.orders || []).find(o =>
        (o._id && o._id.toString() === rid) ||
        (o.id && o.id.toString() === rid)
      );

      if (originalOrder && originalOrder.items) {
        const allItems = originalOrder.items;
        const filteredItems = allItems.filter(item => {
          const isArrDProduct = item.isDProduct === true || String(item.isDProduct) === 'true';
          return (saleMode === 'normal') ? !isArrDProduct : isArrDProduct;
        });

        const totalItemsSum = allItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const filteredItemsSum = filteredItems.reduce((sum, item) => sum + Number(item.totalSellingPrice ?? item.total ?? item.amount ?? item.sellingPrice ?? 0), 0);
        const propFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;

        if (Array.isArray(refund.items) && refund.items.length > 0) {
          refund.items.forEach(ri => {
            const riPid = normalizeId(ri.productId || ri.product_id || ri._id || ri.id);
            const matchedOriginalItem = filteredItems.find(item => {
              const iPid = normalizeId(item.productId || item.product_id || item._id || item.id);
              return (iPid === riPid && iPid) || (item.name && ri.name && item.name.trim().toLowerCase() === ri.name.trim().toLowerCase());
            });
            if (matchedOriginalItem) {
              amountToSubtract += (Number(ri.qty || 0) * Number(ri.rate || 0));
            }
          });
        } else {
          amountToSubtract += (Number(refund.totalRefundAmount || refund.amount || 0) * propFactor);
        }
      } else {
        amountToSubtract = 0;
      }

      // Subtract from Hourly Revenue
      hourlyRevenue[hour] -= amountToSubtract;
    });

    // 2. Hourly Expenses (Purchase Orders) - EXCLUDED
    /*
    filteredPurchaseOrders.forEach(po => {
      if (po.isDeleted || po.status !== 'completed') return;
      const poDate = new Date(po.createdAt || po.orderDate || po.date);
      if (formatDate(poDate) === selectedDate) {
        const hour = poDate.getHours();
        hourlyExpenses[hour] += (resolvePurchaseOrderTotal(po) || 0);
      }
    });
    */

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
        escapeValue("Total Refunds"),
        escapeValue(formatCurrencySmart(totalRefunds, state.currencyFormat)),
        escapeValue(getTranslation('allMethods', state.currentLanguage)),
        escapeValue(getTranslation('completed', state.currentLanguage))
      ]);

      rows.push([
        escapeValue(getTranslation('summary', state.currentLanguage)),
        escapeValue(formatDate(new Date())),
        escapeValue('Delivery Charges'),
        escapeValue(formatCurrencySmart(totalDeliveryCharges, state.currencyFormat)),
        escapeValue(getTranslation('onlinePayment', state.currentLanguage)),
        escapeValue(getTranslation('completed', state.currentLanguage))
      ]);

      rows.push([
        escapeValue(getTranslation('summary', state.currentLanguage)),
        escapeValue(formatDate(new Date())),
        escapeValue(getTranslation('netProfit', state.currentLanguage)),
        escapeValue(formatCurrencySmart(netProfit, state.currencyFormat)),
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
          totalDeliveryCharges,
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
      // Helper to normalize text (remove camelCase)
      const normalizeText = (text) => text ? text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, str => str.toUpperCase()) : '';
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const COLORS = {
        primary: [47, 60, 126], // #2F3C7E
        secondary: [236, 72, 153], // #EC4899 (Pink)
        success: [16, 185, 129], // #10B981
        gray: [100, 116, 139],
        lightBg: [248, 250, 252],
        border: [226, 232, 240],
        black: [15, 23, 42],
        white: [255, 255, 255]
      };

      const formatPDFCurrency = (val) => {
        return `Rs. ${Number(val || 0).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;
      };


      /* ================= HEADER ================= */
      const headerHeight = 52;
      pdf.setFillColor(250, 251, 255); // Light tint
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');

      // Top Accent Bar
      pdf.setFillColor(...COLORS.primary);
      pdf.rect(0, 0, pageWidth, 2.5, 'F');

      /* -------- LOGO & APP BRANDING -------- */
      const logoX = margin;
      const logoY = 8;
      const logoSize = 18;

      const publicUrl = process.env.PUBLIC_URL || '';
      const defaultLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
      const sellerLogo = state.storeLogo || state.currentUser?.logoUrl;
      const logoUrl = sellerLogo || defaultLogo;

      try {
        const loadImage = (src) => new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = reject;
          img.src = src;
        });

        let logoBase64;
        try {
          logoBase64 = await loadImage(logoUrl);
        } catch (e) {
          if (logoUrl !== defaultLogo) {
            logoBase64 = await loadImage(defaultLogo);
          }
        }

        if (logoBase64) {
          pdf.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
        }
      } catch (e) {
        console.warn('Logo could not be loaded for PDF:', e.message);
      }

      // Application Name (Modern Branding)
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(...COLORS.primary);
      pdf.text('Inventory Studio', logoX + logoSize + 4, logoY + 10);

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      pdf.text('ULTIMATE BILLING & GST SOLUTION', logoX + logoSize + 4, logoY + 15);

      /* -------- SHOP INFO SECTION (Modern Box) -------- */
      const boxW = (pageWidth / 2) - margin;
      const boxY = logoY + 24;

      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(margin, boxY - 2, boxW + 8, 26, 2, 2, 'F');
      pdf.setDrawColor(...COLORS.border);
      pdf.setLineWidth(0.1);
      pdf.roundedRect(margin, boxY - 2, boxW + 8, 26, 2, 2, 'S');

      let currentDetailY = boxY + 4;
      const drawShopLine = (label, val) => {
        if (!val) return;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.black);
        pdf.text(`${label}:`, margin + 4, currentDetailY);

        pdf.setFont('helvetica', 'bold'); // Bolder value
        pdf.setTextColor(...COLORS.black);
        const displayVal = String(val).substring(0, 60);
        pdf.text(displayVal, margin + 25, currentDetailY);
        currentDetailY += 5;
      };

      drawShopLine('Shop Name', state.storeName || state.currentUser?.shopName || 'My Store');
      drawShopLine('Address', state.storeAddress || state.currentUser?.shopAddress);
      drawShopLine('Contact', state.storePhone || state.currentUser?.mobileNumber);
      drawShopLine('GSTIN', state.storeGstin);

      /* -------- RIGHT META -------- */
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setTextColor(...COLORS.black);
      pdf.text('FINANCIAL ANALYSIS REPORT', pageWidth - margin, 14, { align: 'right' });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.gray);
      const periodStr = timeRange === 'custom'
        ? `${formatDate(customDateRange.start)} - ${formatDate(customDateRange.end)}`
        : timeRange.toUpperCase();
      pdf.text(`Month Period: ${periodStr}`, pageWidth - margin, 20, { align: 'right' });
      pdf.text(`Sale Type: ${saleMode === 'direct' ? 'DIRECT SALE' : 'NORMAL SALE'}`, pageWidth - margin, 25, { align: 'right' });

      pdf.setFillColor(...COLORS.primary);
      pdf.roundedRect(pageWidth - 75, 29, 60, 7, 1.5, 1.5, 'F');
      pdf.setTextColor(...COLORS.white);
      pdf.setFontSize(7.5);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`GEN: ${formatDateTime(new Date())}`, pageWidth - margin - 15, 33.5, { align: 'right' });

      /* ================= SUMMARY CARDS ================= */
      const startY = headerHeight + 10;
      const cardH = 22;
      const metrics = [
        { label: normalizeText(getTranslation('revenue', state.currentLanguage)), value: formatPDFCurrency(totalRevenue), color: COLORS.primary },
        { label: 'Total Refunds', value: formatPDFCurrency(totalRefunds), color: COLORS.secondary },
        { label: normalizeText(getTranslation('expenses', state.currentLanguage)), value: formatPDFCurrency(totalExpenses), color: COLORS.secondary },
        { label: normalizeText(getTranslation('netProfit', state.currentLanguage)), value: formatPDFCurrency(netProfit), color: COLORS.success }
      ];

      const cardW = (pageWidth - margin * 2 - ((metrics.length - 1) * 4)) / metrics.length;

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 4);

        // Premium Card
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(x, startY, cardW, cardH, 2.5, 2.5, 'F');
        pdf.setDrawColor(...COLORS.border);
        pdf.setLineWidth(0.1);
        pdf.roundedRect(x, startY, cardW, cardH, 2.5, 2.5, 'S');

        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.gray);
        pdf.text(m.label.toUpperCase(), x + 6, startY + 8);

        pdf.setFontSize(14); // Increased size
        pdf.setFont('helvetica', 'bold'); // Ensure bold
        pdf.setTextColor(...COLORS.black);
        pdf.text(m.value, x + 6, startY + 16);
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
      pdf.text(normalizeText(getTranslation('selectedPeriodSummary', state.currentLanguage)), margin, y);

      y += 6;
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.gray);
      const periodLabel = timeRange === 'custom'
        ? `${formatDate(customDateRange.start)} to ${formatDate(customDateRange.end)}`
        : timeRange.toUpperCase();
      pdf.text(`${normalizeText(getTranslation('analysisForPeriod', state.currentLanguage))}: ${periodLabel}`, margin, y);
      y += 15; // Increased gap after subtitle to 15mm

      const summaryData = [
        [normalizeText(getTranslation('salesSection', state.currentLanguage)), normalizeText(getTranslation('revenueSales', state.currentLanguage)), formatCurrencySmart(totalRevenue, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('salesSection', state.currentLanguage)), normalizeText(getTranslation('cogs', state.currentLanguage)), formatCurrencySmart(totalCogs, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('opexSection', state.currentLanguage)), normalizeText(getTranslation('operatingExpenses', state.currentLanguage)), formatCurrencySmart(totalPettyExpenses, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('profitSection', state.currentLanguage)), normalizeText(getTranslation('netProfit', state.currentLanguage)), formatCurrencySmart(netProfit, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('profitSection', state.currentLanguage)), normalizeText(getTranslation('profitMargin', state.currentLanguage)), `${profitMargin.toFixed(2)}%`],
        [normalizeText(getTranslation('cashSection', state.currentLanguage)), normalizeText(getTranslation('stockPurchases', state.currentLanguage)), formatCurrencySmart(totalPurchaseExpenses, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('creditSection', state.currentLanguage)), normalizeText(getTranslation('totalReceivables', state.currentLanguage)), formatCurrencySmart(totalReceivables, state.currencyFormat).replace(/₹/g, 'Rs ')],
        [normalizeText(getTranslation('creditSection', state.currentLanguage)), normalizeText(getTranslation('customersWithDebt', state.currentLanguage)), customersWithDebt.toString()]
      ];

      const rowH_summary = 12;
      const tableW_summary = pageWidth - margin * 2;
      const colW_summary = [45, 150, tableW_summary - 195];
      const headers_summary = [
        normalizeText(getTranslation('sectionHeader', state.currentLanguage)),
        normalizeText(getTranslation('metricHeader', state.currentLanguage)),
        normalizeText(getTranslation('valueHeader', state.currentLanguage))
      ];

      // --- Draw Summary Header (Premium Rounded Style) ---
      pdf.setFillColor(245, 247, 255);
      pdf.roundedRect(margin, y, tableW_summary, 12, 2, 2, 'F');
      pdf.setTextColor(...COLORS.primary);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10.5);

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
        pdf.setFont('helvetica', 'bold'); // Bolder row data
        pdf.setTextColor(...COLORS.black);
        pdf.text(row[1], margin + colW_summary[0] + 8, y + 8);

        // Value Column
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.primary);
        pdf.text(row[2], margin + tableW_summary - 8, y + 8, { align: 'right' });

        y += rowH_summary + 2; // Increase vertical step between rows to 14mm total (12 height + 2 gap)
      }

      /* ================= FOOTER ================= */
      // Powered By Logo Logic
      let gsLogoBase64 = null;
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
        const gsLogoRes = await fetch(gsLogo).catch(() => null);
        if (gsLogoRes && gsLogoRes.ok) {
          const blob = await gsLogoRes.blob();
          gsLogoBase64 = await new Promise(r => {
            const reader = new FileReader();
            reader.onloadend = () => r(reader.result);
            reader.readAsDataURL(blob);
          });
        }
      } catch (e) { }

      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        if (pageCount > 1) {
          pdf.text(`${getTranslation('page', state.currentLanguage)} ${i} ${getTranslation('ofPage', state.currentLanguage)} ${pageCount}`, margin, pageHeight - 10);
        }

        // Powered By Branding
        if (gsLogoBase64) {
          const gsY = pageHeight - 7;
          const centerX = pageWidth / 2;
          pdf.setFontSize(6);
          pdf.setTextColor(160, 160, 160);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', centerX - 5, gsY, { align: 'right' });
          pdf.addImage(gsLogoBase64, 'PNG', centerX - 4.2, gsY - 2.8, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Inventory Studio', centerX + 0.5, gsY, { align: 'left' });
        }

        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        pdf.setFont('helvetica', 'normal');
        pdf.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      // Add watermark
      await addWatermarkToPDF(pdf, state.storeLogo || undefined);

      const pdfBlob = pdf.output('blob');
      downloadFile(
        `Financial_Analysis_${new Date().toISOString().split('T')[0]}.pdf`,
        pdfBlob,
        'application/pdf'
      );
      if (window.showToast) {
        window.showToast('Financial report exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error in exportFinancialPDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // Show loading state while initial data loads (Removed to allow immediate render)
  // if (isLoading && state.orders.length === 0 && state.transactions.length === 0) { ... }

  const timeRangeOptions = [
    { value: 'today', label: getTranslation('timeRange_today', state.currentLanguage) },
    { value: '7d', label: getTranslation('timeRange_7d', state.currentLanguage) },
    { value: '30d', label: getTranslation('timeRange_30d', state.currentLanguage) },
    { value: 'custom', label: getTranslation('timeRange_custom', state.currentLanguage) }
  ]; // End of timeRangeOptions
  // Closing the new flex container for Time Range and Actions at the end of the controls section.
  // I need to find where the main container ends. It ends at line ~1850? 
  // Wait, I can't close the div here blindly.
  // I need to find the specific closing tag for the header controls div. 
  // I will use a separate replacement chunk for the closing tag.


  return (
    <div className="space-y-8 fade-in-up pb-20">
      {/* Simple Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 dark:text-blue-400 shrink-0">
            <TrendingUp className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              {getTranslation('financialAnalytics', state.currentLanguage)}
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">
              {getTranslation('trackYourEarnings', state.currentLanguage)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Sale Mode Toggle */}
          <div className="bg-gray-100 dark:bg-slate-800 p-1 rounded-xl flex items-center">
            <button
              onClick={() => setSaleMode('normal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${saleMode === 'normal'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                }`}
            >
              Normal
            </button>
            <button
              onClick={() => setSaleMode('direct')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${saleMode === 'direct'
                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                }`}
            >
              Direct
            </button>
          </div>

          {/* Expenses Button */}
          <button
            onClick={() => {
              if (isPlanExpired(state)) {
                if (window.showToast) window.showToast('Plan expired. Upgrade to add expenses.', 'error');
                return;
              }
              setNewExpense(prev => ({ ...prev, date: new Date().toISOString().split('T')[0] }));
              setShowExpenseModal(true);
            }}
            className="btn-secondary inline-flex items-center justify-center text-sm px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl transition-all"
          >
            <Wallet className="h-4 w-4 mr-2 text-rose-500" />
            <span>{getTranslation('addExpense', state.currentLanguage)}</span>
          </button>

          {/* Export Button */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(true)}
              className="btn-secondary inline-flex items-center justify-center text-sm px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl transition-all"
            >
              <Download className="h-4 w-4 mr-2" />
              <span>{getTranslation('export', state.currentLanguage)}</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-100 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-1">
                  <button
                    onClick={() => { exportFinancialCSV(); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-green-500" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={() => { exportFinancialJSON(); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                  >
                    <FileJson className="h-4 w-4 text-blue-500" />
                    <span>Export JSON</span>
                  </button>
                  <button
                    onClick={() => { exportFinancialPDF(); setShowExportMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4 text-red-500" />
                    <span>Export PDF</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Time Range Filter */}
          <div className="bg-white dark:bg-slate-800 p-1 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm flex items-center">
            <select
              value={timeRange}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setTempCustomRange({ ...customDateRange });
                  setShowCustomDateModal(true);
                } else {
                  setTimeRange(e.target.value);
                }
              }}
              className="bg-transparent text-sm font-medium text-gray-700 dark:text-slate-200 border-none outline-none focus:ring-0 cursor-pointer pl-3 pr-8 py-1.5"
              style={{ backgroundImage: 'none' }}
            >
              {timeRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="1y">{getTranslation('lastYear', state.currentLanguage)}</option>
              <option value="all">{getTranslation('allTime', state.currentLanguage)}</option>
            </select>
            <ChevronDown className="h-4 w-4 text-gray-400 mr-2" />
          </div>
        </div>
      </div>

      {/* Date Range Display if Custom */}
      {timeRange === 'custom' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-sm w-fit mx-auto sm:mx-0">
          <CalendarRange className="h-4 w-4" />
          <span>
            {formatDate(startDate)} - {formatDate(endDate)}
          </span>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Total Sales */}
        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform duration-300">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalRevenue', state.currentLanguage)}</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalRevenue)}>
              {formatCurrencySmart(totalRevenue, state.currencyFormat)}
            </h3>
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">+{filteredOrders.length} orders</span>
              <span className="text-slate-400 dark:text-slate-500 ml-1">inc. returns</span>
            </div>
          </div>
        </div>

        {/* Net Profit */}
        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform duration-300">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('netProfit', state.currentLanguage)}</p>
            <h3 className={`text-2xl font-bold tracking-tight ${netProfit >= 0 ? 'text-gray-900 dark:text-white' : 'text-rose-600 dark:text-rose-400'}`} title={formatCurrency(netProfit)}>
              {formatCurrencySmart(netProfit, state.currencyFormat)}
            </h3>
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
              <span className="bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">{profitMargin.toFixed(1)}% Margin</span>
            </div>
          </div>
        </div>

        {/* Total Expenses */}
        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform duration-300">
            <TrendingDown className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('expenses', state.currentLanguage)}</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalPettyExpenses)}>
              {formatCurrencySmart(totalPettyExpenses, state.currencyFormat)}
            </h3>
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
              <span className="bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded">Operational & Petty</span>
            </div>
          </div>
        </div>

        {/* Total Due */}
        <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full group">
          <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform duration-300">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="mt-2 text-left">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalReceivables', state.currentLanguage)}</p>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight" title={formatCurrency(totalReceivables)}>
              {formatCurrencySmart(totalReceivables, state.currencyFormat)}
            </h3>
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              <span className="bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">To Collect</span>
            </div>
          </div>
        </div>
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
          <div className="fixed inset-0 z-[1200] flex items-end md:items-center justify-center bg-black/60 overflow-hidden">
            <div className="bg-white dark:bg-slate-800 !rounded-none md:rounded-3xl shadow-2xl w-full md:max-w-xl fixed inset-0 md:relative md:inset-auto !h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 dark:border-slate-700 m-0">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 flex-shrink-0 bg-gray-50/50 dark:bg-slate-800/50">
                <div>
                  <p className="text-[10px] font-black text-slate-900 dark:text-slate-100 uppercase tracking-widest mb-1">{getTranslation('receiptDetails', state.currentLanguage)}</p>
                  <h4 className="text-2xl font-black text-gray-900 dark:text-white">
                    {selectedTransaction.customerName || getTranslation('walkInCustomer', state.currentLanguage)}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                      {new Date(selectedTransaction.date).toLocaleString()}
                    </p>
                    <span className="text-gray-300 dark:text-slate-600">•</span>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {getPaymentMethodLabel(selectedTransaction.paymentMethod)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleShareTransaction(selectedTransaction)}
                    className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-slate-900 dark:text-slate-100 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-all shadow-sm"
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
          <div className="fixed inset-0 z-[1200] flex items-end md:items-center justify-center bg-black/60">
            <div className="bg-white dark:bg-slate-800 !rounded-none md:rounded-3xl shadow-2xl w-full md:max-w-2xl fixed inset-0 md:relative md:inset-auto !h-full md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 dark:border-slate-700 m-0">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 bg-gray-50/50 dark:bg-slate-800/50">
                <div>
                  <p className="text-[10px] font-black text-slate-900 dark:text-slate-100 uppercase tracking-widest mb-1">{getTranslation('purchaseOrderDetails', state.currentLanguage)}</p>
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
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-indigo-50 text-slate-900 dark:bg-indigo-900/30 dark:text-slate-100">
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
              className="mt-4 text-sm text-slate-900 font-medium hover:underline"
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
            className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[1050] transition-opacity duration-300 ${isClosingExpense ? 'opacity-0' : 'animate-fadeIn'}`}
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
              className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-lg border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[85vh] m-0"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
                <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                  {getTranslation('addExpense', state.currentLanguage)}
                </h2>
                <button
                  onClick={handleCloseExpenseModal}
                  className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 custom-scrollbar bg-white dark:bg-slate-900">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('amount', state.currentLanguage)} (₹) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <IndianRupee className="h-5 w-5 text-gray-400 dark:text-slate-500" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newExpense.amount}
                      onChange={(e) => {
                        const value = e.target.value;
                        const rawValue = value.replace(/,/g, '');
                        if (value === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                          const parts = rawValue.split('.');
                          if (parts[0].length > 0) {
                            parts[0] = Number(parts[0]).toLocaleString('en-IN');
                          }
                          setNewExpense({ ...newExpense, amount: parts.join('.') });
                        }
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder-gray-300"
                      placeholder="0.00"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                      {getTranslation('categoryHeader', state.currentLanguage)} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={newExpense.category}
                        onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                        className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none cursor-pointer"
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
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                      {getTranslation('date', state.currentLanguage)}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Calendar className="h-4 w-4 text-gray-400 dark:text-slate-500" />
                      </div>
                      <input
                        type="date"
                        value={newExpense.date}
                        onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 ml-1">
                    {getTranslation('descriptionHeader', state.currentLanguage)} ({getTranslation('optional', state.currentLanguage)})
                  </label>
                  <textarea
                    value={newExpense.description}
                    onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                    className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none h-24"
                    placeholder={getTranslation('expenseDescriptionPlaceholder', state.currentLanguage)}
                  ></textarea>
                </div>

                <div className="p-6 pt-0 pb-8 md:pb-6 bg-white dark:bg-slate-900 flex-shrink-0 -mx-6 -mb-6 mt-4">
                  <button
                    onClick={handleAddExpense}
                    disabled={!newExpense.amount || isSubmittingExpense}
                    className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed action-button-write"
                  >
                    {isSubmittingExpense ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        {getTranslation('saving', state.currentLanguage)}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {getTranslation('addExpense', state.currentLanguage)}
                      </>
                    )}
                  </button>
                </div>

                {false && state.expenses && state.expenses.length > 0 && (
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
                                className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors action-button-write"
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
        showDeleteConfirmModal && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all duration-300"
            onClick={() => setShowDeleteConfirmModal(false)}
          >
            <style>{`
              @keyframes modalPop {
                  0% { opacity: 0; transform: scale(0.95) translateY(10px); }
                  100% { opacity: 1; transform: scale(1) translateY(0); }
              }
            `}</style>
            <div
              className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 w-full max-w-sm border border-gray-100 dark:border-slate-700 relative overflow-hidden animate-[modalPop_0.3s_ease-out_forwards] m-4 md:m-0"
              onClick={e => e.stopPropagation()}
            >
              {/* Decorative background blob */}
              <div className="absolute top-0 right-0 p-0 opacity-50 pointer-events-none">
                <div className="w-32 h-32 bg-red-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
              </div>

              <div className="flex flex-col items-center text-center relative z-10">
                <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-6 ring-8 ring-red-50/50 dark:ring-red-900/10">
                  <Trash2 className="h-9 w-9 text-red-600 dark:text-red-400" strokeWidth={1.5} />
                </div>

                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                  {getTranslation('deleteExpenseQuestion', state.currentLanguage)}
                </h3>

                <p className="text-gray-500 dark:text-slate-400 mb-8 leading-relaxed text-[15px]">
                  {getTranslation('deleteExpenseConfirm', state.currentLanguage)}
                </p>

                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => setShowDeleteConfirmModal(false)}
                    className="flex-1 py-3.5 px-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-slate-700 active:scale-[0.98] transition-all"
                  >
                    {getTranslation('cancel', state.currentLanguage)}
                  </button>
                  <button
                    onClick={confirmDeleteExpense}
                    className="flex-1 py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg shadow-red-200 dark:shadow-red-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 action-button-write"
                  >
                    <span>{getTranslation('deleteOrder', state.currentLanguage)?.replace('Order', '') || 'Delete'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      }
      {/* Custom Date Modal */}
      {
        showCustomDateModal && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <CalendarRange className="h-5 w-5 text-slate-900 dark:text-white" />
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
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('endDate', state.currentLanguage)}</label>
                  <input
                    type="date"
                    value={tempCustomRange.end}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setCustomDateRange(tempCustomRange);
                      setTimeRange('custom');
                      setShowCustomDateModal(false);
                    }}
                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl transition-all shadow-lg"
                  >
                    {getTranslation('applyFilter', state.currentLanguage)}
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
          className={`fixed inset-0 z-[1200] flex items-end md:items-center justify-center bg-black/60 transition-opacity duration-300 ${isClosingBreakdown ? 'opacity-0' : 'animate-fadeIn'}`}
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
            className="bg-white dark:bg-slate-800 w-full h-full md:h-auto md:max-h-[95vh] md:max-w-4xl rounded-none md:rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-slate-700 fixed inset-0 md:relative md:inset-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  {getTranslation('financialBreakdown', state.currentLanguage)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {getTranslation('hourlyAnalysisFor', state.currentLanguage)} <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedDate}</span>
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
