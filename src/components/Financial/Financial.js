import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp, triggerSyncStatusUpdate } from '../../context/AppContext';
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
  ChevronRight
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { calculateItemRateAndTotal, formatCurrency } from '../../utils/orderUtils';
import { fetchOrders, fetchTransactions, fetchVendorOrders, fetchCustomers, isOnline, syncToIndexedDB } from '../../utils/dataFetcher';
import { apiRequest, getSellerIdFromAuth } from '../../utils/api';
import { sanitizeMobileNumber } from '../../utils/validation';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

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

  // Expenses State managed via Global State
  const [showExpenseModal, setShowExpenseModal] = useState(false);
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
        setIsLoading(true);

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
      // This ensures it syncs even if app is closed or offline immediately
      const { addToSyncQueue, backgroundSyncWithBackend } = await import('../../utils/dataFetcher');
      await addToSyncQueue('expense_create', optimisticExpense);

      // 4. Update Global State
      dispatch({ type: 'ADD_EXPENSE', payload: optimisticExpense });

      // 5. Trigger Sync Status Update (Instant UI Feedback)
      triggerSyncStatusUpdate();

      // 6. Trigger Sync (Process Queue Immediately if Online)
      // We don't await this because we want to return control to UI
      backgroundSyncWithBackend(dispatch, {});

      showToast("Expense added", "success");

    } catch (err) {
      console.error("Expense error:", err);
      showToast("Error saving expense", "error");
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return;

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
      backgroundSyncWithBackend(dispatch, {});

      showToast("Expense deleted", "success");

    } catch (err) {
      console.error("Delete error:", err);
      // We already updated UI, so just warn
      showToast("Error processing delete", "error");
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
        return 'Online Payment';
      case 'due':
        return 'Due (Credit)';
      default:
        return 'Cash';
    }
  };

  const calculateMonthlyRevenue = () => {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthlyData = [];

    for (let i = 0; i < 6; i++) {
      const month = new Date(sixMonthsAgo);
      month.setMonth(month.getMonth() + i);
      // Use orders (sales) for revenue, not transactions
      const monthOrders = state.orders.filter(o => {
        const oDate = new Date(o.createdAt || o.date);
        return (
          oDate.getMonth() === month.getMonth() &&
          oDate.getFullYear() === month.getFullYear()
        );
      });
      const monthRevenue = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      monthlyData.push(monthRevenue);
    }
    return monthlyData;
  };

  const calculateMonthlyExpenses = (revenues) => {
    // 30% of revenue assumed as expenses
    return revenues.map(r => r * 0.3);
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
      : invoiceDateObj.toLocaleDateString('en-IN');

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
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-IN');
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
    if (!normalized) return 'Pending';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

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
      case '90d':
        startDate.setDate(today.getDate() - 90);
        break;
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

  // Net Profit = Profit from Sales - Purchase Orders (expenses) - Petty Expenses
  const netProfit = profitFromSales - totalExpenses;
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

  // ✅ Chart Data
  const monthlyRevenue = calculateMonthlyRevenue();
  const monthlyExpenses = calculateMonthlyExpenses(monthlyRevenue);

  const revenueChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Revenue',
        data: monthlyRevenue,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 2,
        borderRadius: 8,
      },
      {
        label: 'Expenses',
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
  const paymentMethodLabels = ['Cash', 'Online Payment', 'Due (Credit)', 'Split Payment'];
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
        label: 'Amount (₹)',
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
            return `${label}: ₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${count} ${count === 1 ? 'order' : 'orders'}, ${percentage}%)`;
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
              text: `${label}: ₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${count} ${count === 1 ? 'order' : 'orders'}, ${percentage}%)`,
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
      const headers = ['Type', 'Date', 'Description', 'Amount', 'Payment Method', 'Status'];
      const rows = [];

      // Add summary financial data instead of individual transactions
      rows.push([
        escapeValue('Summary'),
        escapeValue(new Date().toLocaleDateString()),
        escapeValue('Total Revenue'),
        escapeValue(totalRevenue),
        escapeValue('All Methods'),
        escapeValue('Completed')
      ]);

      rows.push([
        escapeValue('Summary'),
        escapeValue(new Date().toLocaleDateString()),
        escapeValue('Total Expenses'),
        escapeValue(totalExpenses),
        escapeValue('All Methods'),
        escapeValue('Completed')
      ]);

      rows.push([
        escapeValue('Summary'),
        escapeValue(new Date().toLocaleDateString()),
        escapeValue('Net Profit'),
        escapeValue(totalRevenue - totalExpenses),
        escapeValue('N/A'),
        escapeValue('Calculated')
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

  const exportFinancialPDF = () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Theme colors
      const brandPrimary = { r: 47, g: 60, b: 126 };
      const brandAccent = { r: 244, g: 162, b: 89 };
      const brandPrimaryLight = { r: 71, g: 85, b: 145 };
      const brandPrimaryUltraLight = { r: 248, g: 249, b: 253 };
      const textPrimary = { r: 15, g: 23, b: 42 };
      const textSecondary = { r: 100, g: 116, b: 150 };

      // Header
      pdf.setFillColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
      pdf.rect(0, 0, pageWidth, 24, 'F');

      pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
      pdf.rect(0, 0, pageWidth, 2.5, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text('Drag & Drop', 15, 15);

      pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
      pdf.rect(15, 17, 48, 1.8, 'F');

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.text('Financial Report', pageWidth - 15, 15, { align: 'right' });

      pdf.setFontSize(8);
      pdf.setTextColor(250, 250, 250);
      const shopInfo = `${state.currentUser?.shopName || 'Store'}  •  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`;
      pdf.text(shopInfo, pageWidth - 15, 21, { align: 'right' });

      // Summary Cards
      const summaryY = 29;
      const cardHeight = 16;
      const cardSpacing = 3.5;
      const cardWidth = (pageWidth - 30 - (cardSpacing * 3)) / 4;

      const summaryCards = [
        { label: 'Total Revenue', value: `₹${totalRevenue.toFixed(2)}`, bgColor: brandPrimaryUltraLight, accentColor: { r: 34, g: 197, b: 94 } },
        { label: 'Total Expenses', value: `₹${totalExpenses.toFixed(2)}`, bgColor: brandPrimaryUltraLight, accentColor: { r: 239, g: 68, b: 68 } },
        { label: 'Net Profit', value: `₹${netProfit.toFixed(2)}`, bgColor: brandPrimaryUltraLight, accentColor: brandPrimary },
        { label: 'Receivables', value: `₹${totalReceivables.toFixed(2)}`, bgColor: brandPrimaryUltraLight, accentColor: brandAccent }
      ];

      summaryCards.forEach((card, index) => {
        const cardX = 10 + (index * (cardWidth + cardSpacing));

        pdf.setFillColor(card.bgColor.r, card.bgColor.g, card.bgColor.b);
        pdf.rect(cardX, summaryY, cardWidth, cardHeight, 'F');

        pdf.setDrawColor(brandPrimaryLight.r, brandPrimaryLight.g, brandPrimaryLight.b);
        pdf.setLineWidth(0.15);
        pdf.rect(cardX, summaryY, cardWidth, cardHeight, 'D');

        pdf.setFillColor(card.accentColor.r, card.accentColor.g, card.accentColor.b);
        pdf.rect(cardX, summaryY, cardWidth, 1.5, 'F');

        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text(card.label.toUpperCase(), cardX + 2.5, summaryY + 6);

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(card.accentColor.r, card.accentColor.g, card.accentColor.b);
        const valueLines = pdf.splitTextToSize(card.value, cardWidth - 5);
        pdf.text(valueLines[0], cardX + 2.5, summaryY + 12.5);
      });

      // Financial Details Section
      let y = summaryY + cardHeight + 8;
      const leftMargin = 12;
      const rightMargin = pageWidth - 12;
      const sectionWidth = pageWidth - 24;

      // Summary Table
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(textPrimary.r, textPrimary.g, textPrimary.b);
      pdf.text('Financial Summary', leftMargin, y);

      y += 6;
      const summaryData = [
        ['Metric', 'Value'],
        ['Total Revenue', `₹${totalRevenue.toFixed(2)}`],
        ['Total Expenses', `₹${totalExpenses.toFixed(2)}`],
        ['Net Profit', `₹${netProfit.toFixed(2)}`],
        ['Profit Margin', `${profitMargin.toFixed(2)}%`],
        ['Total Receivables', `₹${totalReceivables.toFixed(2)}`],
        ['Customers with Debt', customersWithDebt.toString()]
      ];

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      summaryData.forEach((row, idx) => {
        if (idx === 0) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFillColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
          pdf.rect(leftMargin, y - 5, sectionWidth, 6, 'F');
          pdf.setTextColor(255, 255, 255);
        } else {
          pdf.setFont('helvetica', 'normal');
          pdf.setFillColor(idx % 2 === 0 ? brandPrimaryUltraLight.r : 255, idx % 2 === 0 ? brandPrimaryUltraLight.g : 255, idx % 2 === 0 ? brandPrimaryUltraLight.b : 255);
          pdf.rect(leftMargin, y - 5, sectionWidth, 5, 'F');
          pdf.setTextColor(textPrimary.r, textPrimary.g, textPrimary.b);
        }
        pdf.text(row[0], leftMargin + 2, y);
        pdf.text(row[1], rightMargin - 2, y, { align: 'right' });
        y += idx === 0 ? 6 : 5;
      });

      // Footer
      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);

        pdf.setFillColor(brandPrimaryUltraLight.r, brandPrimaryUltraLight.g, brandPrimaryUltraLight.b);
        pdf.rect(0, pageHeight - 10, pageWidth, 10, 'F');

        pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
        pdf.rect(0, pageHeight - 10, pageWidth, 1, 'F');

        pdf.setDrawColor(brandPrimaryLight.r, brandPrimaryLight.g, brandPrimaryLight.b);
        pdf.setLineWidth(0.15);
        pdf.line(0, pageHeight - 10, pageWidth, pageHeight - 10);

        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text(`Page ${i} of ${pageCount}`, 12, pageHeight - 5);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
        pdf.text(`${state.currentUser?.shopName || 'Store'}`, pageWidth - 12, pageHeight - 5, { align: 'right' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text('Drag & Drop', pageWidth - 12, pageHeight - 2.5, { align: 'right' });
      }

      pdf.save(`financial-report-${new Date().toISOString().split('T')[0]}.pdf`);
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
        <p className="text-gray-500 dark:text-slate-400 font-medium">Analyzing financial data...</p>
      </div>
    );
  }

  const timeRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' }
  ];

  return (
    <div className="space-y-8 fade-in-up dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Financial Analytics</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Real-time performance metrics and revenue tracking</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm overflow-x-auto max-w-[100vw] sm:max-w-none no-scrollbar">
            {timeRangeOptions.map((option) => {
              const isActive = timeRange === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimeRange(option.value)}
                  className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${isActive
                    ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#2f3c7e] dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {/* Add Expense Button */}
          <button
            onClick={() => setShowExpenseModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Wallet className="h-4 w-4" />
            Add Expense
          </button>

          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                <button
                  onClick={exportFinancialPDF}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  PDF Report
                </button>
                <button
                  onClick={exportFinancialCSV}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  CSV (Excel)
                </button>
                <button
                  onClick={exportFinancialJSON}
                  className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                >
                  <FileJson className="h-4 w-4" />
                  JSON Data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { title: 'Total Revenue', value: totalRevenue, color: 'emerald', icon: <TrendingUp /> },
          { title: 'Total Expenses', value: totalExpenses, color: 'red', icon: <TrendingDown /> },
          { title: 'Net Profit', value: netProfit, color: 'indigo', icon: <Calculator /> },
          { title: 'Receivables', value: totalReceivables, color: 'amber', icon: <CreditCard /> },
        ].map((card, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 p-3 sm:p-6 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm transition-all hover:shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className={`p-2 sm:p-3 rounded-lg w-fit ${card.color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' :
                card.color === 'red' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                  card.color === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' :
                    'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                }`}>
                {React.cloneElement(card.icon, { className: 'h-6 w-6' })}
              </div>
              <div>
                <p className="text-[10px] sm:text-sm text-gray-600 dark:text-slate-400">{card.title}</p>
                <p className={`text-sm sm:text-2xl font-bold ${card.color === 'red' && card.value > 0 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                  ₹{card.value.toLocaleString('en-IN', { minimumFractionDigits: i === 1 ? 0 : 2, maximumFractionDigits: 2 })}
                </p>
                {card.title === 'Total Expenses' && totalExpenses > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    PO: ₹{totalPurchaseExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })} • Petty: ₹{totalPettyExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Revenue vs Expenses</h2>
          <div className="h-[300px]">
            <Bar
              data={revenueChartData}
              options={{
                ...chartOptions,
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
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Payment Methods</h2>
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
                <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(paymentMethodAmounts[index])}</span>
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
            Financial Alerts & Insights
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
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider mb-1">Receivables Action</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    ₹{totalReceivables.toLocaleString('en-IN')} outstanding from {customersWithDebt} customers.
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
                  <p className="text-xs font-bold text-rose-800 dark:text-rose-400 uppercase tracking-wider mb-1">Margin Alert</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    Low profit margin of {profitMargin.toFixed(1)}%. Review your pricing strategy.
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
                  <p className="text-xs font-bold text-red-800 dark:text-red-400 uppercase tracking-wider mb-1">Operating Loss</p>
                  <p className="text-sm text-gray-700 dark:text-slate-200">
                    Negative net profit of ₹{Math.abs(netProfit).toLocaleString('en-IN')}.
                  </p>
                </div>
              </div>
            )}

            {totalReceivables === 0 && profitMargin >= 15 && netProfit >= 0 && (
              <div className="col-span-full py-8 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mb-4">
                  <Target className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Financial Health: Excellent</h4>
                <p className="text-gray-500 dark:text-slate-400 text-sm max-w-sm">
                  Your business is performing well! No outstanding debts and healthy margins detected.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {showTransactionModal && selectedTransaction && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 overflow-y-auto py-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col my-auto border border-gray-100 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 flex-shrink-0 bg-gray-50/50 dark:bg-slate-800/50">
              <div>
                <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1">Receipt Details</p>
                <h4 className="text-2xl font-black text-gray-900 dark:text-white">
                  {selectedTransaction.customerName || 'Walk-in Customer'}
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
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Date</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatDateTime(selectedTransaction.createdAt || selectedTransaction.date)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Name</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedTransaction.customerName || 'Walk-in Customer'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Mobile</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {selectedTransaction.customerMobile || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Payment Method</p>
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
                        <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">Split Payment Breakdown</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                            <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Cash</p>
                            <p className="text-lg font-bold text-green-900 dark:text-green-100">{formatCurrency(cashAmount)}</p>
                          </div>
                          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                            <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">Online</p>
                            <p className="text-lg font-bold text-blue-900 dark:text-blue-100">{formatCurrency(onlineAmount)}</p>
                          </div>
                          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                            <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">Due</p>
                            <p className="text-lg font-bold text-red-900 dark:text-red-100">{formatCurrency(dueAmount)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="sm:col-span-2">
                  <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Total Amount</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {formatCurrency(selectedTransaction.totalAmount || selectedTransaction.total)}
                  </p>
                </div>
              </div>

              {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                    <thead className="bg-gray-100 dark:bg-slate-700">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                          Item
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                          Qty
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                          Rate
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide">
                          Total
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
                            <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-400">{formatCurrency(rate)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-200">
                              {formatCurrency(total)}
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
                  <p className="text-xs uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-1">Note</p>
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
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Order Detail Modal */}
      {showPurchaseOrderModal && selectedPurchaseOrder && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-100 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 px-8 py-6 bg-gray-50/50 dark:bg-slate-800/50">
              <div>
                <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1">Purchase Order Detail</p>
                <h4 className="text-2xl font-black text-gray-900 dark:text-white">
                  {selectedPurchaseOrder.supplierName || 'Unknown Supplier'}
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
                  <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Status</p>
                  <span className={getPurchaseOrderStatusBadge(selectedPurchaseOrder.status)}>
                    {getPurchaseOrderStatusLabel(selectedPurchaseOrder.status)}
                  </span>
                </div>
                {selectedPurchaseOrder.expectedDeliveryDate && (
                  <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Expected Delivery</p>
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
                        <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-slate-300">Item</th>
                        <th className="px-4 py-2 text-center font-medium text-gray-600 dark:text-slate-300">Qty</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300">Price</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300">Total</th>
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
                            <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-400">
                              {formatCurrency(rate)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-200">
                              {formatCurrency(total)}
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
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Amount</span>
                  <span className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                    {formatCurrency(resolvePurchaseOrderTotal(selectedPurchaseOrder))}
                  </span>
                </div>
              </div>

              {/* Notes */}
              {selectedPurchaseOrder.notes && (
                <div className="bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-700 rounded-xl p-3 text-sm text-gray-700 dark:text-slate-300">
                  <p className="text-xs uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">Notes</p>
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
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Expenses Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Wallet className="h-5 w-5 text-rose-500" />
            Petty Expenses
          </h2>
          {filteredDailyExpenses.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-slate-400">
              Total: {formatCurrency(totalPettyExpenses)}
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
                    <th className="px-4 py-3 rounded-l-lg">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 rounded-r-lg text-center">Action</th>
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
                          {exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                        {exp.description || '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                        {formatCurrency(exp.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDeleteExpense(exp.id || exp._id)}
                          className="p-1 text-rose-500 hover:bg-rose-50 rounded dark:hover:bg-rose-900/20 transition-colors"
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
                        {exp.category}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteExpense(exp.id || exp._id)}
                      className="p-2 text-rose-500 bg-rose-50 dark:bg-rose-900/20 rounded-lg"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex justify-between items-end mt-3">
                    <p className="text-sm text-gray-600 dark:text-slate-400 italic flex-1 mr-4">
                      {exp.description || 'No description'}
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {formatCurrency(exp.amount)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {totalExpensePages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-700 px-4 py-3 mt-4">
                <div className="text-sm text-gray-500 dark:text-slate-400">
                  Showing {indexOfFirstExpense + 1} to {Math.min(indexOfLastExpense, filteredDailyExpenses.length)} of {filteredDailyExpenses.length} entries
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
                    Page {expensePage} of {totalExpensePages}
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
            <p className="text-gray-500 dark:text-slate-400">No expenses recorded for this period</p>
            <button
              onClick={() => setShowExpenseModal(true)}
              className="mt-4 text-sm text-indigo-600 font-medium hover:underline"
            >
              Add your first expense
            </button>
          </div>
        )}
      </div>

      {/* Add Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-slideUp">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Wallet className="h-5 w-5 text-rose-500" />
                Add New Expense
              </h3>
              <button
                onClick={() => setShowExpenseModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Amount (₹) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={newExpense.amount}
                  onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  placeholder="0.00"
                  min="1"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={newExpense.category}
                  onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="Tea/Coffee">Tea / Coffee</option>
                  <option value="Cleaning">Cleaning Supplies</option>
                  <option value="Transport">Transport / Delivery</option>
                  <option value="Utility">Utility Bills</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Salaries">Staff Salaries</option>
                  <option value="Rent">Shop Rent</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={newExpense.date}
                  onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={newExpense.description}
                  onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none h-20"
                  placeholder="e.g. Snacks for staff"
                ></textarea>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExpense}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-medium shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {isSubmittingExpense ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Financial;
