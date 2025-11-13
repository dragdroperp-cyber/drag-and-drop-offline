import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { useToast } from '../../hooks/useToast';
import {
  Users,
  Package,
  Receipt,
  TrendingUp,
  AlertTriangle,
  Clock,
  DollarSign,
  ShoppingCart,
  Truck,
  BarChart3,
  Calendar,
  CreditCard,
  Activity,
  Zap,
  Target,
  Award,
  X,
  ArrowRight,
  Download,
  Wallet,
  CheckCircle,
  ShieldCheck,
  BarChart2,
  LayoutGrid,
  Share2
} from 'lucide-react';
import { sanitizeMobileNumber } from '../../utils/validation';
import { getPlanLimits, isModuleUnlocked, getUpgradeMessage } from '../../utils/planUtils';
import { getSellerIdFromAuth } from '../../utils/api';
import { getAllItems, STORES } from '../../utils/indexedDB';
import { getPathForView } from '../../utils/navigation';
import SellerRegistrationModal from './SellerRegistrationModal';

const parseExpiryDate = (rawValue) => {
  if (!rawValue) {
    return null;
  }
  const parsedDate = new Date(rawValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const calculateExpiryCountdown = (expiryDate) => {
  if (!expiryDate) {
    return null;
  }
  const diff = expiryDate.getTime() - Date.now();
  if (diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSeconds = Math.floor(diff / 1000);
  return {
    expired: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
};

const formatCountdownValue = (value) => String(value ?? 0).padStart(2, '0');

const STAT_THEMES = {
  primary: { background: 'rgba(47, 60, 126, 0.12)', color: '#2F3C7E', border: 'rgba(47, 60, 126, 0.28)' },
  teal: { background: 'rgba(45, 212, 191, 0.14)', color: '#0F766E', border: 'rgba(15, 118, 110, 0.24)' },
  amber: { background: 'rgba(244, 162, 89, 0.16)', color: '#C2410C', border: 'rgba(194, 65, 12, 0.24)' },
  rose: { background: 'rgba(251, 113, 133, 0.16)', color: '#BE123C', border: 'rgba(190, 18, 60, 0.24)' },
  sky: { background: 'rgba(56, 189, 248, 0.18)', color: '#0369A1', border: 'rgba(3, 105, 161, 0.24)' },
  emerald: { background: 'rgba(74, 222, 128, 0.14)', color: '#047857', border: 'rgba(4, 120, 87, 0.22)' },
  purple: { background: 'rgba(196, 181, 253, 0.2)', color: '#6D28D9', border: 'rgba(109, 40, 217, 0.24)' },
  slate: { background: 'rgba(148, 163, 184, 0.16)', color: '#1E293B', border: 'rgba(30, 41, 59, 0.2)' }
};

const getStatTheme = (key) => STAT_THEMES[key] || STAT_THEMES.slate;

const Dashboard = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('7d');
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  
  // Show registration modal if profile is not completed
  const showRegistrationModal = !state.currentUser?.profileCompleted;

  const subscriptionExpiryRaw =
    state.subscription?.expiresAt ||
    state.currentPlanDetails?.expiresAt ||
    state.currentPlanDetails?.expiryDate ||
    null;

  const subscriptionExpiryDate = useMemo(
    () => parseExpiryDate(subscriptionExpiryRaw),
    [subscriptionExpiryRaw]
  );

  const [expiryCountdown, setExpiryCountdown] = useState(() =>
    calculateExpiryCountdown(subscriptionExpiryDate)
  );

  const daysRemaining = subscriptionExpiryDate
    ? Math.max(
        0,
        Math.ceil(
          (subscriptionExpiryDate.getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0;

  const planNameLabel =
    state.currentPlanDetails?.planName ||
    state.subscription?.planName ||
    (state.currentPlan
      ? state.currentPlan.charAt(0).toUpperCase() + state.currentPlan.slice(1)
      : null);

  const formattedExpiryDate = subscriptionExpiryDate
    ? subscriptionExpiryDate.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const planExpiryStatusText = formattedExpiryDate
    ? (planNameLabel
        ? `${planNameLabel} ${daysRemaining === 0 ? 'expired on' : 'expires on'} ${formattedExpiryDate}`
        : `Plan ${daysRemaining === 0 ? 'expired on' : 'expires on'} ${formattedExpiryDate}`)
    : (planNameLabel
        ? `${planNameLabel} expiry date not available`
        : 'Plan expiry date not available');

  useEffect(() => {
    let isActive = true;

    const refreshOrdersFromIndexedDB = async () => {
      try {
        const indexedDBOrders = await getAllItems(STORES.orders).catch(() => []);
        if (!isActive) return;

        const normalizedOrders = (indexedDBOrders || []).filter(order => order && order.isDeleted !== true);
        const currentOrders = (state.orders || []).filter(order => order && order.isDeleted !== true);

        const currentIds = new Map(
          currentOrders.map(order => {
            const key = (order.id || order._id || order.createdAt || '').toString();
            return [key, order];
          })
        );

        let hasChanges = normalizedOrders.length !== currentOrders.length;

        if (!hasChanges) {
          for (const incoming of normalizedOrders) {
            const key = (incoming.id || incoming._id || incoming.createdAt || '').toString();
            const existing = currentIds.get(key);
            if (!existing) {
              hasChanges = true;
              break;
            }

            const trackedFields = ['totalAmount', 'subtotal', 'discountPercent', 'taxPercent', 'updatedAt', 'isSynced'];
            const mismatch = trackedFields.some(field => {
              const incomingValue = incoming[field] ?? null;
              const existingValue = existing[field] ?? null;
              return JSON.stringify(incomingValue) !== JSON.stringify(existingValue);
            });

            if (mismatch) {
              hasChanges = true;
              break;
            }
          }
        }

        if (hasChanges) {
          dispatch({
            type: ActionTypes.SET_ORDERS,
            payload: normalizedOrders
          });
        }
      } catch (error) {
        console.error('Dashboard: Failed to refresh orders from IndexedDB', error);
      }
    };

    refreshOrdersFromIndexedDB();

    const handleTabFocus = () => {
      refreshOrdersFromIndexedDB();
    };

    window.addEventListener('focus', handleTabFocus);

    return () => {
      isActive = false;
      window.removeEventListener('focus', handleTabFocus);
    };
  }, [dispatch, state.orders, state.currentUser?.sellerId]);

  // Format large numbers to be more compact
  const formatNumber = (value) => `₹${Number(value || 0).toFixed(2)}`;
  const formatShortNumber = (value) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '₹0';
    if (num >= 1_00_00_000) return `₹${(num / 1_00_00_000).toFixed(1)}Cr`;
    if (num >= 1_00_000) return `₹${(num / 1_00_000).toFixed(1)}L`; // Lakhs
    if (num >= 1_000) return `₹${(num / 1_000).toFixed(1)}K`;
    return `₹${num.toFixed(0)}`;
  };

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  }, []);

  const buildWhatsAppInvoiceMessage = useCallback((order, sellerState, sanitizedCustomerMobile) => {
    if (!order) return '';

    const withNull = (value) =>
      value === null || value === undefined || value === '' ? 'null' : value;

    const storeName = withNull(
      sellerState.storeName || sellerState.currentUser?.shopName || sellerState.currentUser?.username
    );
    const storeAddress = withNull(sellerState.currentUser?.shopAddress);
    const storePhoneRaw =
      sellerState.currentUser?.phoneNumber ||
      sellerState.currentUser?.mobileNumber ||
      sellerState.currentUser?.phone ||
      sellerState.currentUser?.contact ||
      '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+91 ${storePhoneSanitized}`
      : withNull(storePhoneRaw);

    const invoiceDateObj = new Date(order.date || order.createdAt || order.updatedAt || Date.now());
    const invoiceDate = Number.isNaN(invoiceDateObj.getTime())
      ? 'null'
      : invoiceDateObj.toLocaleDateString('en-IN');

    const customerName = withNull(order.customerName || order.customer || 'Customer');
    const customerPhoneDisplay = sanitizedCustomerMobile
      ? `+91 ${sanitizedCustomerMobile}`
      : 'null';

    const subtotalRaw = Number(order.subtotal ?? order.subTotal ?? order.total ?? 0);
    const discountRaw = Number(order.discountAmount ?? order.discount ?? 0);
    const taxAmountRaw = Number(order.taxAmount ?? order.tax ?? 0);
    const totalRaw = Number(order.total ?? order.totalAmount ?? order.amount ?? subtotalRaw);

    const taxPercentSource = order.taxPercent ?? order.taxRate;
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

    const items = (order.items || []).map((item, index) => {
      const qty = Number(
        item.quantity ?? item.originalQuantity?.quantity ?? item.qty ?? 0
      );
      const unit = item.unit || item.originalQuantity?.unit || '';
      const lineRate = Number(
        item.unitSellingPrice ??
          item.sellingPrice ??
          item.price ??
          (qty > 0
            ? (item.totalSellingPrice ?? item.total ?? item.amount ?? 0) / qty
            : 0)
      );
      const lineTotal = Number(
        item.totalSellingPrice ?? item.total ?? item.amount ?? lineRate * qty
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

    const paymentModeLabel = withNull(getPaymentMethodLabel(order.paymentMethod));

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
  }, []);

  const findCustomerMobileForOrder = (order, customers) => {
    if (!order) return null;

    const sanitize = (value) => sanitizeMobileNumber(value) || null;

    // Check direct fields on order
    const directMobile =
      sanitize(order.customerMobile) ||
      sanitize(order.customerPhone) ||
      sanitize(order.phoneNumber);
    if (directMobile) return directMobile;

    // Try matching by customerId
    if (order.customerId && Array.isArray(customers)) {
      const matched = customers.find(
        (customer) =>
          customer.id === order.customerId ||
          customer._id === order.customerId ||
          customer.customerId === order.customerId
      );
      if (matched) {
        const matchedMobile =
          sanitize(matched.mobileNumber) ||
          sanitize(matched.phone) ||
          sanitize(matched.contactNumber);
        if (matchedMobile) return matchedMobile;
      }
    }

    // Try matching by customer name
    if (order.customerName && Array.isArray(customers)) {
      const normalizedOrderName = order.customerName.trim().toLowerCase();
      const matchedByName = customers.find((customer) =>
        (customer.name || '').trim().toLowerCase() === normalizedOrderName
      );
      if (matchedByName) {
        const matchedMobile =
          sanitize(matchedByName.mobileNumber) ||
          sanitize(matchedByName.phone) ||
          sanitize(matchedByName.contactNumber);
        if (matchedMobile) return matchedMobile;
      }
    }

    return null;
  };

  const handleShareTransaction = useCallback(
    (order) => {
      if (!order) return;

      const customerMobile =
        sanitizeMobileNumber(order.customerMobile || order.customerPhone || order.phoneNumber || '') ||
        findCustomerMobileForOrder(order, state.customers) ||
        sanitizeMobileNumber(state.currentUser?.phoneNumber || state.currentUser?.mobileNumber || '');

      if (!customerMobile) {
        showToast('No customer mobile number found for this invoice.', 'warning');
        return;
      }

      const message = buildWhatsAppInvoiceMessage(order, state, customerMobile);
      if (!message) {
        showToast('Unable to prepare invoice details for sharing.', 'error');
        return;
      }

      const targetNumber = customerMobile.length === 10 ? `91${customerMobile}` : customerMobile;
      const waUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');
    },
    [buildWhatsAppInvoiceMessage, showToast, state]
  );

  const formatCurrencyFull = (value) => `₹${(Number(value) || 0).toFixed(2)}`;

  const getPaymentMethodLabel = (method = 'cash') => {
    switch ((method || '').toLowerCase()) {
      case 'upi':
      case 'online':
        return 'Online Payment';
      case 'due':
      case 'credit':
        return 'Due (Credit)';
      case 'cash':
      default:
        return 'Cash';
    }
  };

  const getDaysRemainingColor = (days) => {
    if (days > 10) return 'text-green-700 bg-green-50 border-green-200';
    if (days > 3) return 'text-orange-700 bg-orange-50 border-orange-200';
    if (days > 0) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-red-700 bg-red-100 border-red-300';
  };

  const getDaysRemainingMessage = (days) => {
    if (days === 0) return 'Subscription Expired';
    if (days <= 3) return `${days} Day${days === 1 ? '' : 's'} Left - Recharge Now!`;
    if (days <= 10) return `${days} Days Left - Recharge Soon!`;
    return `${days} Days Remaining`;
  };

  useEffect(() => {
    if (!subscriptionExpiryDate) {
      setExpiryCountdown(null);
      return;
    }

    const updateCountdown = () => {
      setExpiryCountdown(calculateExpiryCountdown(subscriptionExpiryDate));
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 1000);

    return () => clearInterval(intervalId);
  }, [subscriptionExpiryDate]);

  // Helper function to get transaction/order date
  const getTransactionDate = (transaction) => {
    return transaction.date || transaction.createdAt || new Date().toISOString();
  };

  // Helper function to get order date
  const getOrderDate = (order) => {
    return order.createdAt || order.date || new Date().toISOString();
  };

  // Helper function to get purchase order date
  const getPurchaseOrderDate = (order) => {
    return order.date || order.createdAt || new Date().toISOString();
  };

  // Calculate date range based on timeRange selector
  const getDateRange = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let startDate = new Date(today);
    
    switch (timeRange) {
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
        startDate.setDate(today.getDate() - 30);
    }
    
    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);
    
    return { startDate, endDate };
  };

  const { startDate, endDate } = getDateRange();

  // Get sellerId to filter orders for this seller only
  const sellerId = getSellerIdFromAuth();
  
  // Filter orders by sellerId (sales/billing records)
  const belongsToSeller = (record, targetSellerId) => {
    if (!targetSellerId || !record) return true;

    const candidateIds = [
      record.sellerId,
      record.sellerID,
      record.seller_id,
      record._sellerId,
      record.seller?.id,
      record.seller?._id,
      record.seller?.sellerId,
      record.createdBy?.sellerId,
      record.createdBy?.sellerID,
      record.createdBy?._id,
    ]
      .filter(Boolean)
      .map((value) => value?.toString?.().trim?.())
      .filter(Boolean);

    if (candidateIds.length === 0) {
      return true;
    }

    return candidateIds.includes(targetSellerId.toString());
  };

  const sellerOrders = sellerId ? state.orders.filter(order => belongsToSeller(order, sellerId)) : state.orders;
  
  // Filter orders by date range
  const filteredOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= startDate && orderDate <= endDate;
  });

  // Filter purchase orders by date range and sellerId
  const sellerPurchaseOrders = sellerId
    ? state.purchaseOrders.filter(order => belongsToSeller(order, sellerId))
    : state.purchaseOrders;
  const filteredPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= startDate && orderDate <= endDate;
  });

  // Calculate comprehensive dashboard stats
  const totalCustomers = state.customers.length;
  const totalProducts = state.products.length;
  const totalOrders = sellerOrders.length;
  const totalPurchaseOrders = sellerPurchaseOrders.length;
  
  // Calculate total balance due (using dueAmount field from database)
  const totalBalanceDue = state.customers.reduce((sum, customer) => {
    return sum + (customer.dueAmount || customer.balanceDue || 0);
  }, 0);

  // Calculate total sales from orders (all time) - use totalAmount from Order model
  const totalSales = sellerOrders.reduce((sum, order) => {
    return sum + (order.totalAmount || 0);
  }, 0);

  // Calculate sales for selected time range from orders
  const rangeSales = filteredOrders.reduce((sum, order) => {
    return sum + (order.totalAmount || 0);
  }, 0);

  // Calculate total purchase value (all time) - filtered by sellerId
  const totalPurchaseValue = sellerPurchaseOrders.reduce((sum, order) => {
    return sum + (order.total || 0);
  }, 0);

  // Calculate purchase value for selected time range
  const rangePurchaseValue = filteredPurchaseOrders.reduce((sum, order) => {
    return sum + (order.total || 0);
  }, 0);

  // Calculate profit from orders: profit = sum((sellingPrice - costPrice) * quantity) for each item
  // Profit = Total Sales Revenue (from orders) - Total Purchase Costs (from purchase orders)
  const calculateProfitFromOrderItems = (orders) => {
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value)) || 0;

    return orders.reduce((totalProfit, order) => {
      if (!order.items || !Array.isArray(order.items)) return totalProfit;

      const orderProfit = order.items.reduce((orderItemProfit, item) => {
        const sellingPrice = toNumber(item.totalSellingPrice ?? item.sellingPrice);
        const costPrice = toNumber(item.totalCostPrice ?? item.costPrice);
        const itemProfit = sellingPrice - costPrice;
        return orderItemProfit + itemProfit;
      }, 0);

      return totalProfit + orderProfit;
    }, 0);
  };

  // Calculate profit for a specific date range
  const calculateProfitForRange = (orders, purchaseOrders, startDate, endDate) => {
    const filteredOrders = orders.filter(order => {
      const orderDate = new Date(getOrderDate(order));
      return orderDate >= startDate && orderDate <= endDate;
    });
    
    const filteredPurchaseOrders = purchaseOrders.filter(order => {
      const orderDate = new Date(getPurchaseOrderDate(order));
      return orderDate >= startDate && orderDate <= endDate;
    });
    
    // Use order items profit calculation (more accurate)
    return calculateProfitFromOrderItems(filteredOrders) - filteredPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
  };

  // Calculate low stock products
  const lowStockProducts = state.products.filter(product => 
    (product.quantity || product.stock || 0) <= state.lowStockThreshold
  );

  // Calculate expiring products
  const expiringProducts = state.products.filter(product => {
    if (!product.expiryDate) return false;
    const expiryDate = new Date(product.expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = expiryDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= state.expiryDaysThreshold && diffDays >= 0;
  });

  // Calculate pending payments (using dueAmount field from database)
  const pendingPayments = state.customers.filter(customer => 
    (customer.dueAmount || customer.balanceDue || 0) > 0
  ).length;

  // Calculate total profit (all time) using orders and purchase orders
  const totalProfit = calculateProfitFromOrderItems(sellerOrders) - sellerPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
  const profitMargin = totalSales > 0 ? ((totalProfit / totalSales) * 100) : 0;

  // Calculate today's sales and profit
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  
  const todayOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= todayStart && orderDate < todayEnd;
  });
  
  const todayPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= todayStart && orderDate < todayEnd;
  });
  
  const todaySales = todayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const todayProfit = calculateProfitFromOrderItems(todayOrders) - todayPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
  
  // Calculate monthly sales and profit
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  monthEnd.setHours(0, 0, 0, 0);
  
  const monthlyOrders = sellerOrders.filter(order => {
    const orderDate = new Date(getOrderDate(order));
    return orderDate >= monthStart && orderDate < monthEnd;
  });
  
  const monthlyPurchaseOrders = sellerPurchaseOrders.filter(order => {
    const orderDate = new Date(getPurchaseOrderDate(order));
    return orderDate >= monthStart && orderDate < monthEnd;
  });
  
  const monthlySales = monthlyOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const monthlyProfit = calculateProfitFromOrderItems(monthlyOrders) - monthlyPurchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);

  // Calculate range profit for selected time period
  const rangeProfit = calculateProfitForRange(
    sellerOrders, 
    sellerPurchaseOrders, 
    startDate, 
    endDate
  );

  // Recent transactions (orders) from IndexedDB (sorted by date, most recent first)
  // Orders are sales/billing records - use state.orders instead of state.transactions
  // Filter by sellerId
  const recentTransactions = [...(sellerOrders || [])]
    .sort((a, b) => {
      const dateA = new Date(getOrderDate(a));
      const dateB = new Date(getOrderDate(b));
      return dateB - dateA;
    })
    .slice(0, 5)
    .map(order => {
      const customer = order.customerId 
        ? state.customers.find(c => c.id === order.customerId || c._id === order.customerId)
        : null;
      return {
        id: order.id || order._id,
        customerName: customer?.name || order.customerName || 'Walk-in Customer',
        total: order.totalAmount || 0,
        paymentMethod: order.paymentMethod || 'cash',
        date: order.createdAt || order.date || new Date().toISOString(),
        subtotal: order.subtotal || 0,
        discountPercent: order.discountPercent || 0,
        taxPercent: order.taxPercent || 0,
        items: order.items || [],
        note: order.notes || '',
        orderId: order.id || order._id,
        rawOrder: order
      };
    });

  // Recent activities from IndexedDB (sorted by date, most recent first)
  // Show activities when there are no transactions
  const recentActivities = [...(state.activities || [])]
    .sort((a, b) => {
      const dateA = new Date(a.timestamp || a.createdAt || 0);
      const dateB = new Date(b.timestamp || b.createdAt || 0);
      return dateB - dateA;
    })
    .slice(0, 5);

  // Comprehensive stats array with met black/white theme and colorful icons
  const stats = [
    {
      name: 'Total Customers',
      value: totalCustomers,
      icon: Users,
      description: 'Active customers',
      theme: 'primary'
    },
    {
      name: 'Total Products',
      value: totalProducts,
      icon: Package,
      description: 'Items in inventory',
      theme: 'teal'
    },
    {
      name: "Today's Sales",
      value: formatNumber(todaySales),
      icon: DollarSign,
      description: 'Sales today from orders',
      theme: 'amber'
    },
    {
      name: "Today's Profit",
      value: formatNumber(todayProfit),
      icon: TrendingUp,
      description: 'Profit today (Sales - Purchases)',
      theme: 'emerald'
    },
    {
      name: 'Monthly Sales',
      value: formatNumber(monthlySales),
      icon: DollarSign,
      description: 'Sales this month from orders',
      theme: 'purple'
    },
    {
      name: 'Monthly Profit',
      value: formatNumber(monthlyProfit),
      icon: TrendingUp,
      description: 'Profit this month (Sales - Purchases)',
      theme: 'teal'
    },
    {
      name: timeRange === '1y' ? 'Total Sales' : `Sales (${timeRange})`,
      value: formatNumber(timeRange === '1y' ? totalSales : rangeSales),
      icon: DollarSign,
      description: timeRange === '1y' ? 'All time sales from orders' : 'Sales in selected period',
      theme: 'sky'
    },
    {
      name: 'Balance Due',
      value: formatNumber(totalBalanceDue),
      icon: CreditCard,
      description: 'Outstanding payments',
      theme: 'rose'
    },
    {
      name: 'Purchase Orders',
      value: totalPurchaseOrders,
      icon: Truck,
      description: 'Orders placed',
      theme: 'slate'
    },
    {
      name: 'Total Profit',
      value: formatNumber(totalProfit),
      icon: TrendingUp,
      description: 'All time profit (Sales - Purchases)',
      theme: 'emerald'
    },
    {
      name: 'Profit Margin',
      value: `${profitMargin.toFixed(1)}%`,
      icon: TrendingUp,
      description: 'Net profit ratio',
      theme: 'teal'
    },
    {
      name: `Profit (${timeRange})`,
      value: formatNumber(timeRange === '1y' ? totalProfit : rangeProfit),
      icon: TrendingUp,
      description: 'Profit in selected period',
      theme: 'purple'
    }
  ];

  const goToView = useCallback((view) => {
    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: view });
    navigate(getPathForView(view));
  }, [dispatch, navigate]);

  const quickActions = [
    {
      key: 'billing',
      label: 'New Bill',
      description: 'Generate an invoice instantly',
      icon: ShoppingCart,
      gradient: 'linear-gradient(135deg, rgba(47,60,126,0.92), rgba(31,40,88,0.94))',
      onClick: () => goToView('billing')
    },
    {
      key: 'products',
      label: 'Add Product',
      description: 'Expand your catalog',
      icon: Package,
      gradient: 'linear-gradient(135deg, rgba(99,102,241,0.88), rgba(76,29,149,0.92))',
      onClick: () => goToView('products')
    },
    {
      key: 'customers',
      label: 'Add Customer',
      description: 'Capture buyer details',
      icon: Users,
      gradient: 'linear-gradient(135deg, rgba(16,185,129,0.88), rgba(4,120,87,0.92))',
      onClick: () => goToView('customers')
    },
    {
      key: 'purchase',
      label: 'Purchase Order',
      description: 'Replenish inventory fast',
      icon: Truck,
      gradient: 'linear-gradient(135deg, rgba(244,162,89,0.9), rgba(217,119,6,0.92))',
      onClick: () => {
        if (!isModuleUnlocked('purchase', state.currentPlan, state.currentPlanDetails)) {
          if (window.showToast) window.showToast(getUpgradeMessage('purchase', state.currentPlan), 'warning');
        } else {
          goToView('purchase');
        }
      }
    }
  ];

  const timeRangeOptions = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '1y', label: 'Last year' }
  ];


  return (
    <div className="space-y-8 fade-in-up">
      {/* Welcome Section with Floating Boxes - Hidden on Mobile */}
      <div className="hidden lg:block" />

      {/* Subscription Status Alert */}
      {subscriptionExpiryDate && (
        <div className={`rounded-xl border-2 p-4 ${getDaysRemainingColor(daysRemaining)}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start space-x-3">
              <Clock className="h-6 w-6" />
              <div>
                <p className="font-semibold text-lg">
                  {getDaysRemainingMessage(daysRemaining)}
                </p>
                <p className="text-sm opacity-80">
                  {planExpiryStatusText}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:justify-end">
              {expiryCountdown ? (
                expiryCountdown.expired ? (
                  <div className="text-sm font-semibold">
                    Plan expired
                  </div>
                ) : (
                  <div className="flex items-center gap-2 sm:gap-3">
                    {[
                      { label: 'Days', value: expiryCountdown.days },
                      { label: 'Hours', value: expiryCountdown.hours },
                      { label: 'Minutes', value: expiryCountdown.minutes },
                      { label: 'Seconds', value: expiryCountdown.seconds },
                    ].map((segment) => (
                      <div
                        key={segment.label}
                        className="bg-white/80 text-gray-900 rounded-lg px-3 py-2 min-w-[64px] text-center shadow-sm"
                      >
                        <div className="text-xl font-bold leading-none">
                          {formatCountdownValue(segment.value)}
                        </div>
                        <div className="text-xs uppercase tracking-wide text-gray-600">
                          {segment.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-sm font-semibold">
                  No active plan
                </div>
              )}
              {daysRemaining <= 3 && (
                <button
                  onClick={() => goToView('upgrade')}
                  className="px-4 py-2 bg-[#1b1b1b] text-white rounded-lg hover:bg-[#252525] transition-colors"
                >
                  Recharge Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Time Range Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Business Overview</h2>
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80.p-1 shadow-sm">
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
      </div>

      {/* Stats Grid with Animations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const theme = getStatTheme(stat.theme);
          return (
            <div
              key={stat.name}
              className="stat-card animate-float-up group transition-all duration-300"
              style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'both' }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className="rounded-xl border p-3 transition group-hover:shadow-md"
                    style={{
                      backgroundColor: theme.background,
                      color: theme.color,
                      borderColor: theme.border
                    }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500 mb-1">{stat.name}</p>
                    <p className="text-2xl font-semibold text-slate-900" title={stat.value}>{stat.value}</p>
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* Alerts and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Alerts */}
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
            Important Alerts
          </h3>
          <div className="space-y-4">
            {lowStockProducts.length > 0 && (
              <div className="flex items-center p-4 bg-yellow-50 rounded-xl border-l-4 border-yellow-400">
                <AlertTriangle className="h-6 w-6 text-yellow-600 mr-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-yellow-800">
                    {lowStockProducts.length} products low in stock
                  </p>
                  <p className="text-sm text-yellow-600">
                    {lowStockProducts.slice(0, 3).map(product => product.name).join(', ')}
                    {lowStockProducts.length > 3 && ` and ${lowStockProducts.length - 3} more`}
                  </p>
                </div>
              </div>
            )}
            
            {expiringProducts.length > 0 && (
              <div className="flex items-center p-4 bg-red-50 rounded-xl border-l-4 border-red-400">
                <Clock className="h-6 w-6 text-red-600 mr-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-red-800">
                    {expiringProducts.length} products expiring soon
                  </p>
                  <p className="text-sm text-red-600">
                    {expiringProducts.slice(0, 3).map(product => product.name).join(', ')}
                    {expiringProducts.length > 3 && ` and ${expiringProducts.length - 3} more`}
                  </p>
                </div>
              </div>
            )}

            {pendingPayments > 0 && (
              <div className="flex items-center p-4 bg-blue-50 rounded-xl border-l-4 border-blue-400">
                <CreditCard className="h-6 w-6 text-blue-600 mr-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-blue-800">
                    {pendingPayments} customers have pending payments
                  </p>
                  <p className="text-sm text-blue-600">
                    Total outstanding: {formatNumber(totalBalanceDue)}
                  </p>
                </div>
              </div>
            )}
            
            {lowStockProducts.length === 0 && expiringProducts.length === 0 && pendingPayments === 0 && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Award className="h-8 w-8 text-green-600" />
                </div>
                <p className="text-green-600 font-semibold">All good! No alerts at this time</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card lg:col-span-2">
          <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
            <Receipt className="h-5 w-5 mr-2 text-green-600" />
            Recent Transactions
          </h3>
          <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
            {recentTransactions.length > 0 ? (
              recentTransactions.map((order, index) => (
                <div
                  key={order.id || index}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTransaction(order);
                      setShowTransactionModal(true);
                    }}
                    className="flex-1 text-left flex items-center focus:outline-none"
                  >
                    <div className="p-2 bg-green-100 rounded-lg mr-3">
                      <Receipt className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {order.customerName || 'Walk-in Customer'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getPaymentMethodLabel(order.paymentMethod)} • {new Date(order.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                      {order.items && order.items.length > 0 && (
                        <p className="text-xs text-gray-400 mt-1">
                          {order.items.length} item{order.items.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </button>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {formatNumber(order.total)}
                    </p>
                    <p className="text-xs text-green-600">Sale</p>
                  </div>
                </div>
              ))
            ) : recentActivities.length > 0 ? (
              recentActivities.map((activity, index) => {
                const activityDate = new Date(
                  activity.timestamp || activity.createdAt || Date.now()
                );

                // Get icon and color based on activity type
                const getActivityIcon = (type) => {
                  switch (type) {
                    case 'bill_generated':
                      return { icon: Receipt, color: 'bg-green-100 text-green-600' };
                    case 'po_status_changed':
                      return { icon: Truck, color: 'bg-blue-100 text-blue-600' };
                    case 'product_added':
                      return { icon: Package, color: 'bg-purple-100 text-purple-600' };
                    case 'customer_added':
                      return { icon: Users, color: 'bg-indigo-100 text-indigo-600' };
                    default:
                      return { icon: Activity, color: 'bg-gray-100 text-gray-600' };
                  }
                };

                const { icon: ActivityIcon, color } = getActivityIcon(activity.type);

                return (
                  <div
                    key={activity.id || index}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center">
                      <div className={`p-2 ${color} rounded-lg mr-3`}>
                        <ActivityIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {activity.message || 'Activity'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {activityDate.toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">
                        {activity.type || 'activity'}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <Receipt className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No recent transactions</p>
                <p className="text-xs text-gray-400 mt-2">Transactions will appear here after you make sales</p>
              </div>
            )}
          </div>
        </div>

      </div>
      
      {showTransactionModal && selectedTransaction && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Transaction Details</p>
                <h4 className="text-xl font-semibold text-gray-900">
                  {selectedTransaction.customerName || 'Walk-in Customer'}
                </h4>
                <p className="text-xs text-gray-500">
                  {new Date(selectedTransaction.date).toLocaleString('en-IN')} • {getPaymentMethodLabel(selectedTransaction.paymentMethod)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleShareTransaction(selectedTransaction)}
                  className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition hover:bg-primary-100"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
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

            <div className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase">Invoice ID</p>
                  <p className="font-medium text-gray-900">{selectedTransaction.orderId || selectedTransaction.id}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase">Total Paid</p>
                  <p className="font-semibold text-primary-600">{formatCurrencyFull(selectedTransaction.total)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase">Subtotal</p>
                  <p className="font-medium text-gray-900">{formatCurrencyFull(selectedTransaction.subtotal || 0)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 uppercase">Discount</p>
                  <p className="font-medium text-gray-900">
                    {Number(selectedTransaction.discountPercent || 0).toFixed(2)}%
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
                        const qty = Number(item.quantity ?? item.originalQuantity?.quantity ?? 0);
                        const unit = item.unit || item.originalQuantity?.unit || '';
                        const rate = Number(
                          item.unitSellingPrice ??
                          item.sellingPrice ??
                          item.price ??
                          (qty > 0 ? (item.totalSellingPrice ?? item.total ?? 0) / qty : 0)
                        ) || 0;
                        const total = Number(item.totalSellingPrice ?? item.total ?? rate * qty) || 0;
                        return (
                          <tr key={`${item.productId || item.name || idx}-${idx}`}>
                            <td className="px-4 py-2 text-gray-800">{item.name || '—'}</td>
                            <td className="px-4 py-2 text-center text-gray-600">{qty} {unit}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{formatCurrencyFull(rate)}</td>
                            <td className="px-4 py-2 text-right font-medium text-gray-700">{formatCurrencyFull(total)}</td>
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

            <div className="flex justify-end border-t border-gray-200 px-6 py-4">
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

      {/* New ERP Features Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
            <Zap className="h-5 w-5 mr-2 text-[var(--brand-primary)]" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className="group relative overflow-hidden rounded-2xl border border-white/25 bg-white/10 px-5 py-5 text-left text-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.6)] transition-transform duration-200 hover:-translate-y-1 hover:shadow-[0_32px_80px_-42px_rgba(15,23,42,0.65)] focus:outline-none"
                  style={{ background: action.gradient }}
                >
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-semibold tracking-tight">{action.label}</p>
                      <p className="text-xs text-white/75">{action.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-black" />
            Performance Metrics
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center">
                <Target className="h-5 w-5 text-black mr-3" />
                <div>
                  <p className="font-semibold text-gray-900">Sales Efficiency</p>
                  <p className="text-xs text-gray-600">Transactions per day</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-black">
                  {todayOrders.length || 0}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center">
                <BarChart3 className="h-5 w-5 text-black mr-3" />
                <div>
                  <p className="font-semibold text-gray-900">Inventory Value</p>
                  <p className="text-xs text-gray-600">Total stock value</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-black">
                  {formatNumber(state.products.reduce((sum, p) => {
                    const quantity = p.quantity || p.stock || 0;
                    const costPrice = p.costPrice || p.unitPrice || 0;
                    return sum + (quantity * costPrice);
                  }, 0))}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center">
                <TrendingUp className="h-5 w-5 text-black mr-3" />
                <div>
                  <p className="font-semibold text-gray-900">Avg Transaction</p>
                  <p className="text-xs text-gray-600">Per transaction</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-black">
                  ₹{totalSales > 0 && totalOrders > 0 ? (totalSales / totalOrders).toFixed(2) : '0.00'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Seller Registration Modal - Shows when profile is not completed */}
      <SellerRegistrationModal 
        isOpen={showRegistrationModal} 
        onClose={() => {
          // Modal closes automatically when profileCompleted becomes true
          // This callback is only used if user manually closes (when allowed)
        }} 
      />
    </div>
  );
};

export default Dashboard;

