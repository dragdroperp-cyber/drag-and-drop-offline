import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
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
  FileJson
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
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState(null);
  const [showPurchaseOrderModal, setShowPurchaseOrderModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);
  const sellerIdFromAuth = (() => {
    try {
      return getSellerIdFromAuth();
    } catch (error) {
      console.error('Financial: failed to extract sellerId from auth', error);
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
        setIsLoading(false);

        // Step 2: Fetch from MongoDB if online (compare and update if different)
        const online = await isOnline();
        if (online) {
          try {
            const result = await apiRequest('/data/all', { method: 'GET' });
            
            if (result.success && result.data?.data) {
              const { orders, transactions, purchaseOrders, customers } = result.data.data;

              // Normalize backend data
              const normalizedBackendCustomers = (customers || []).map(customer => ({
                ...customer,
                dueAmount: customer.dueAmount || 0,
                balanceDue: customer.dueAmount || 0,
                mobileNumber: customer.mobileNumber || customer.phone || ''
              }));

              // Compare with IndexedDB data to see if different
              // Use a simple comparison: check if lengths are different or if IDs don't match
              const ordersChanged = (indexedDBOrders?.length || 0) !== (orders?.length || 0) ||
                (orders?.length > 0 && indexedDBOrders?.length > 0 && 
                 orders[0]?._id !== indexedDBOrders[0]?._id && orders[0]?.id !== indexedDBOrders[0]?.id);
              
              const transactionsChanged = (indexedDBTransactions?.length || 0) !== (transactions?.length || 0) ||
                (transactions?.length > 0 && indexedDBTransactions?.length > 0 && 
                 transactions[0]?._id !== indexedDBTransactions[0]?._id && transactions[0]?.id !== indexedDBTransactions[0]?.id);
              
              const purchaseOrdersChanged = (indexedDBPurchaseOrders?.length || 0) !== (purchaseOrders?.length || 0) ||
                (purchaseOrders?.length > 0 && indexedDBPurchaseOrders?.length > 0 && 
                 purchaseOrders[0]?._id !== indexedDBPurchaseOrders[0]?._id && purchaseOrders[0]?.id !== indexedDBPurchaseOrders[0]?.id);
              
              const customersChanged = (normalizedCustomers?.length || 0) !== (normalizedBackendCustomers?.length || 0) ||
                (normalizedBackendCustomers?.length > 0 && normalizedCustomers?.length > 0 && 
                 normalizedBackendCustomers[0]?._id !== normalizedCustomers[0]?._id && normalizedBackendCustomers[0]?.id !== normalizedCustomers[0]?.id);

              // Update state if MongoDB data is different or if we want to always refresh from MongoDB
              // For now, always update if MongoDB has data (more reliable source)
              if (orders || transactions || purchaseOrders || customers) {
                if (ordersChanged || transactionsChanged || purchaseOrdersChanged || customersChanged || 
                    (orders?.length > 0 || transactions?.length > 0 || purchaseOrders?.length > 0)) {
                  dispatch({ type: 'SET_ORDERS', payload: orders || [] });
                  dispatch({ type: 'SET_TRANSACTIONS', payload: transactions || [] });
                  dispatch({ type: 'SET_PURCHASE_ORDERS', payload: purchaseOrders || [] });
                  dispatch({ type: 'SET_CUSTOMERS', payload: normalizedBackendCustomers });
                  
                  // Update IndexedDB with MongoDB data
                  await Promise.all([
                    syncToIndexedDB(STORES.orders, orders || []),
                    syncToIndexedDB(STORES.transactions, transactions || []),
                    syncToIndexedDB(STORES.purchaseOrders, purchaseOrders || []),
                    syncToIndexedDB(STORES.customers, normalizedBackendCustomers)
                  ]);
                }
              }
            }
          } catch (backendError) {
            console.error('Error fetching financial data from MongoDB:', backendError);
            // Keep IndexedDB data that was already shown
          }
        }
      } catch (error) {
        console.error('Error loading financial data:', error);
        setIsLoading(false);
      }
    };

    loadFinancialData();
  }, [dispatch]);

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
  const totalExpenses = filteredPurchaseOrders.reduce((sum, po) => sum + (resolvePurchaseOrderTotal(po) || 0), 0);
  
  // Net Profit = Profit from Sales - Purchase Orders (expenses)
  // This matches the dashboard calculation: profit from items - purchase orders
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
          label: function(context) {
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
      generateLabels: function(chart) {
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
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
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
      console.error('Error exporting financial CSV:', error);
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
      console.error('Error exporting financial JSON:', error);
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
      console.error('Error generating PDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // Show loading state while initial data loads
  if (isLoading && state.orders.length === 0 && state.transactions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading financial data...</p>
        </div>
      </div>
    );
  }

  const timeRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '1y', label: 'All Time' }
  ];

  return (
    <div className="space-y-8 fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Financial Management</h2>
          <p className="text-gray-600 mt-2">Track revenue, expenses, and performance</p>
        </div>

        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Modern Time Range Filter - Similar to Dashboard */}
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
            {timeRangeOptions.map((option) => {
              const isActive = timeRange === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimeRange(option.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${
                    isActive
                      ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                      : 'text-slate-600 hover:text-[#2f3c7e] hover:bg-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="btn-secondary flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold"
            >
              <Download className="h-4 w-4" />
              Export Report
              <ChevronDown className={`h-4 w-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                <button
                  onClick={exportFinancialPDF}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileText className="h-4 w-4 text-red-600" />
                  <span>Export as PDF</span>
                </button>
                <button
                  onClick={exportFinancialJSON}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileJson className="h-4 w-4 text-yellow-600" />
                  <span>Export as JSON</span>
                </button>
                <button
                  onClick={exportFinancialCSV}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span>Export as CSV</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: 'Total Revenue', value: totalRevenue, color: 'green', icon: <TrendingUp /> },
          { title: 'Total Expenses', value: totalExpenses, color: 'red', icon: <TrendingDown /> },
          { title: 'Net Profit', value: netProfit, color: 'blue', icon: <Calculator /> },
          { title: 'Receivables', value: totalReceivables, color: 'orange', icon: <CreditCard /> },
        ].map((card, i) => (
          <div key={i} className="stat-card flex items-center">
            <div className={`p-3 bg-${card.color}-100 rounded-xl text-${card.color}-600`}>{card.icon}</div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{card.title}</p>
              <p className="text-2xl font-bold text-gray-900">₹{card.value.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <BarChart3 className="h-5 w-5 mr-2 text-blue-600" /> Revenue vs Expenses
          </h3>
          <div className="h-64">
            <Bar data={revenueChartData} options={chartOptions} />
          </div>
        </div>

        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <PieChart className="h-5 w-5 mr-2 text-purple-600" /> Payment Methods (Revenue)
          </h3>
          <div className="h-80 mb-2">
            <Pie data={paymentMethodData} options={pieChartOptions} />
          </div>
          <div className="mt-4 space-y-2">
            {paymentMethodLabels.map((label, index) => {
              const amount = paymentMethodAmounts[index] || 0;
              const count = paymentMethodCounts[index] || 0;
              const total = paymentMethodAmounts.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0';
              const colorMap = {
                'Cash': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-900', chartColor: 'rgba(34, 197, 94, 0.8)' },
                'Online Payment': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', chartColor: 'rgba(59, 130, 246, 0.8)' },
                'Due (Credit)': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', chartColor: 'rgba(239, 68, 68, 0.8)' },
                'Split Payment': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', chartColor: 'rgba(168, 85, 247, 0.8)' }
              };
              const colors = colorMap[label] || { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900', chartColor: 'rgba(156, 163, 175, 0.8)' };
              const isSplitPayment = label === 'Split Payment';
              
              return (
                <div key={index} className={`rounded-lg border ${colors.bg} ${colors.border} ${colors.text}`}>
                  <div className={`flex items-center justify-between p-3 ${isSplitPayment ? 'border-b border-purple-200' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: colors.chartColor }}
                      />
                      <span className="font-semibold text-sm">{label}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-base">₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="text-xs opacity-75">{count} {count === 1 ? 'order' : 'orders'} • {percentage}%</div>
                    </div>
                  </div>
                  {isSplitPayment && amount > 0 && (
                    <div className="p-3 pt-2 space-y-1.5 bg-purple-100/30">
                      <p className="text-xs font-medium text-purple-800 mb-2">Breakdown:</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-green-50 border border-green-200 rounded p-2">
                          <p className="text-xs text-green-700 font-medium mb-0.5">Cash</p>
                          <p className="text-sm font-bold text-green-900">₹{splitPaymentBreakdown.cash.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded p-2">
                          <p className="text-xs text-blue-700 font-medium mb-0.5">Online</p>
                          <p className="text-sm font-bold text-blue-900">₹{splitPaymentBreakdown.online.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded p-2">
                          <p className="text-xs text-red-700 font-medium mb-0.5">Due</p>
                          <p className="text-sm font-bold text-red-900">₹{splitPaymentBreakdown.due.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>


      {/* Alerts */}
      <div className="card">
        <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <AlertCircle className="h-5 w-5 mr-2 text-yellow-600" /> Financial Alerts
        </h3>

        {totalReceivables > 0 && (
          <div className="p-4 bg-yellow-50 rounded-xl border-l-4 border-yellow-400 mb-3">
            <AlertCircle className="h-6 w-6 text-yellow-600 inline mr-2" />
            <span className="font-semibold">Outstanding Receivables:</span> ₹{totalReceivables.toFixed(2)}
          </div>
        )}

        {profitMargin < 10 && (
          <div className="p-4 bg-red-50 rounded-xl border-l-4 border-red-400 mb-3">
            <TrendingDown className="h-6 w-6 text-red-600 inline mr-2" />
            Low Profit Margin ({profitMargin.toFixed(1)}%)
          </div>
        )}

        {netProfit < 0 && (
          <div className="p-4 bg-red-50 rounded-xl border-l-4 border-red-400 mb-3">
            <AlertCircle className="h-6 w-6 text-red-600 inline mr-2" />
            Negative Profit: ₹{Math.abs(netProfit).toFixed(2)}
          </div>
        )}

        {totalReceivables === 0 && profitMargin >= 10 && netProfit >= 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Target className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-green-600 font-semibold">Great! Your finances are healthy 🎯</p>
          </div>
        )}
      </div>
      {showTransactionModal && selectedTransaction && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4 overflow-y-auto py-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col my-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 flex-shrink-0">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Transaction Details</p>
                <h4 className="text-xl font-semibold text-gray-900">
                  {selectedTransaction.customerName || 'Walk-in Customer'}
                </h4>
                <p className="text-xs text-gray-500">
                  {new Date(selectedTransaction.date).toLocaleString()} • {getPaymentMethodLabel(selectedTransaction.paymentMethod)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleShareTransaction(selectedTransaction)}
                  className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition hover:bg-primary-100"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share Bill
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTransactionModal(false);
                    setSelectedTransaction(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                  aria-label="Close transaction details"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Date</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatDateTime(selectedTransaction.createdAt || selectedTransaction.date)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Customer Name</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {selectedTransaction.customerName || 'Walk-in Customer'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Customer Mobile</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {selectedTransaction.customerMobile || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Payment Method</p>
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
                        <p className="text-sm text-gray-600 mb-2">Split Payment Breakdown</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                            <p className="text-xs text-green-700 font-medium mb-1">Cash</p>
                            <p className="text-lg font-bold text-green-900">{formatCurrency(cashAmount)}</p>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-xs text-blue-700 font-medium mb-1">Online</p>
                            <p className="text-lg font-bold text-blue-900">{formatCurrency(onlineAmount)}</p>
                          </div>
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <p className="text-xs text-red-700 font-medium mb-1">Due</p>
                            <p className="text-lg font-bold text-red-900">{formatCurrency(dueAmount)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="sm:col-span-2">
                  <p className="text-sm text-gray-600 mb-1">Total Amount</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(selectedTransaction.totalAmount || selectedTransaction.total)}
                  </p>
                </div>
              </div>

              {selectedTransaction.items && selectedTransaction.items.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Item
                        </th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Qty
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Rate
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedTransaction.items.map((item, idx) => {
                        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                        return (
                          <tr key={`${item.productId || item.name || idx}-${idx}`}>
                            <td className="px-4 py-2 text-gray-800">
                              <span className="truncate block max-w-[200px]" title={item.name || '—'}>{item.name || '—'}</span>
                            </td>
                            <td className="px-4 py-2 text-center text-gray-600">
                              {qty} {unit}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(rate)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-700">
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
                <div className="bg-primary-50 border border-primary-100 rounded-xl p-3 text-sm text-primary-700">
                  <p className="text-xs uppercase tracking-wide text-primary-600 mb-1">Note</p>
                  {selectedTransaction.note}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-gray-200 px-6 py-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowTransactionModal(false);
                  setSelectedTransaction(null);
                }}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Order Detail Modal */}
      {showPurchaseOrderModal && selectedPurchaseOrder && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Purchase Order Details</p>
                <h4 className="text-xl font-semibold text-gray-900">
                  {selectedPurchaseOrder.supplierName || 'Unknown Supplier'}
                </h4>
                <p className="text-xs text-gray-500">
                  PO #{(selectedPurchaseOrder.id || selectedPurchaseOrder._id || '').toString().slice(-8).toUpperCase()}
                  {' • '}
                  {formatDisplayDate(selectedPurchaseOrder.createdAt || selectedPurchaseOrder.orderDate || selectedPurchaseOrder.date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPurchaseOrderModal(false);
                  setSelectedPurchaseOrder(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Status and Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
                  <span className={getPurchaseOrderStatusBadge(selectedPurchaseOrder.status)}>
                    {getPurchaseOrderStatusLabel(selectedPurchaseOrder.status)}
                  </span>
                </div>
                {selectedPurchaseOrder.expectedDeliveryDate && (
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Expected Delivery</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatDisplayDate(selectedPurchaseOrder.expectedDeliveryDate)}
                    </p>
                  </div>
                )}
              </div>

              {/* Items */}
              {selectedPurchaseOrder.items && selectedPurchaseOrder.items.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                        <th className="px-4 py-2 text-center font-medium text-gray-600">Qty</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Price</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedPurchaseOrder.items.map((item, idx) => {
                        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

                        return (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-gray-800">
                              <span className="truncate block max-w-[200px]" title={item.productName || item.name || '—'}>
                                {item.productName || item.name || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center text-gray-600">
                              {qty} {unit}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {formatCurrency(rate)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-gray-700">
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
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-700">Total Amount</span>
                  <span className="text-2xl font-bold text-blue-900">
                    {formatCurrency(resolvePurchaseOrderTotal(selectedPurchaseOrder))}
                  </span>
                </div>
              </div>

              {/* Notes */}
              {selectedPurchaseOrder.notes && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-700">
                  <p className="text-xs uppercase tracking-wide text-gray-600 mb-1">Notes</p>
                  {selectedPurchaseOrder.notes}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setShowPurchaseOrderModal(false);
                  setSelectedPurchaseOrder(null);
                }}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Financial;
