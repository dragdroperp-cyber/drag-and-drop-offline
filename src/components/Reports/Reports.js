import React, { useState, useMemo } from 'react';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { useApp } from '../../context/AppContext';
import { PageSkeleton, SkeletonStats, SkeletonCard } from '../UI/SkeletonLoader';
import {
  BarChart3,
  TrendingUp,
  Package,
  Users,
  ShoppingCart,
  Truck,
  CreditCard,
  Download,
  CalendarRange,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileJson,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Wallet,
  X,
  Calendar,
  Clock,
  IndianRupee
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import jsPDF from 'jspdf';
import { getTranslation } from '../../utils/translations';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import { getSellerIdFromAuth } from '../../utils/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement);

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

const Reports = () => {
  const { state } = useApp();
  const [timeRange, setTimeRange] = useState('today');
  const [saleMode, setSaleMode] = useState('normal'); // 'normal' | 'direct'
  const [isLoading, setIsLoading] = useState(() => {
    // Avoid loading flicker if data is already in state
    const hasData = state.orders?.length > 0 || state.refunds?.length > 0;
    return !hasData && state.dataFreshness === 'loading';
  });

  // Manage loading state
  React.useEffect(() => {
    // Set loading to false after data is available or after a timeout
    const hasData = state.orders && state.refunds;
    if (hasData) {
      setIsLoading(false);
    } else {
      // Fallback timeout to prevent infinite loading
      const timer = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [state.orders, state.refunds]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [tempCustomRange, setTempCustomRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [isClosingBreakdown, setIsClosingBreakdown] = useState(false);

  const handleCloseBreakdown = () => {
    setIsClosingBreakdown(true);
    setTimeout(() => {
      setSelectedDate(null);
      setIsClosingBreakdown(false);
    }, 400);
  };
  const exportMenuRef = React.useRef(null);

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
    ]
      .map(normalizeId)
      .filter(Boolean);
    if (candidateIds.length === 0) return true;
    return candidateIds.some((candidate) => identifiers.has(candidate));
  };

  const filterBySeller = (records = []) => {
    if (!Array.isArray(records) || sellerIdentifiers.size === 0) return records || [];
    return records.filter((record) => belongsToSeller(record, sellerIdentifiers));
  };

  // Helper function to get date range based on timeRange selector
  const getDateRange = () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
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
      default:
        return { startDate: todayStart, endDate: today };
    }

    return { startDate, endDate: today };
  };

  const { startDate, endDate } = getDateRange();

  // Filter data by date range and seller
  const filteredOrders = useMemo(() => {
    // Pre-process refunds for efficient lookup
    const sellerRefunds = filterBySeller(state.refunds || []);
    const refundsByOrder = new Map();

    sellerRefunds.forEach(refund => {
      const orderId = normalizeId(refund.orderId || refund.order_id);
      if (!orderId) return;

      if (!refundsByOrder.has(orderId)) {
        refundsByOrder.set(orderId, []);
      }
      refundsByOrder.get(orderId).push(refund);
    });

    return filterBySeller(state.orders || [])
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

        // Infer delivery charge if missing (matches SalesOrderHistory)
        let deliveryCharge = Number(order.deliveryCharge || 0);
        if (!deliveryCharge && originalGrandTotal > (totalItemsSum - discount + 1)) {
          deliveryCharge = originalGrandTotal - (totalItemsSum - discount);
        }

        const netProductSales = originalGrandTotal - deliveryCharge;
        const proportionalFactor = totalItemsSum > 0 ? (filteredItemsSum / totalItemsSum) : 0;
        let finalCalculatedTotal = proportionalFactor * originalGrandTotal;
        const deliveryShare = proportionalFactor * deliveryCharge;

        // --- REFUND DEDUCTION LOGIC REMOVED ---
        // Refunds are now handled as separate period-based metrics (totalRefunds, totalRefundedCost)
        // -----------------------------
        // -----------------------------

        const totalWithDelivery = finalCalculatedTotal + deliveryShare;

        // Return a new order object with filtered items and recalculated totals
        return {
          ...order,
          items: filteredItems,
          totalAmount: finalCalculatedTotal, // This is now Gross Sales (filtered by mode)
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
        totalAmount: totalWithDelivery,
        totalCogs: totalCogsForFilteredItems,
        pendingProfit: pendingProfit,
        deliveryCharge: deliveryShare
      };
    }).filter(Boolean);
  }, [state.orders, startDate, endDate, saleMode]);

  const filteredPurchaseOrders = filterBySeller(state.purchaseOrders || []).filter(po => {
    if (po.isDeleted) return false;
    // Only count completed orders as expenses
    if (po.status !== 'completed') return false;
    const poDate = new Date(po.createdAt || po.orderDate || po.date || po.updatedAt || 0);
    return poDate >= startDate && poDate <= endDate;
  });

  const sanitizeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const normalizeOrderItems = (order) => Array.isArray(order?.items) ? order.items : [];

  const calculateOrderRevenue = (order) => {
    const explicitTotal = sanitizeNumber(order?.totalAmount ?? order?.total);
    if (explicitTotal > 0) return explicitTotal;
    return normalizeOrderItems(order).reduce((sum, item) => {
      const quantity = sanitizeNumber(item?.quantity);
      const sellingPrice = sanitizeNumber(item?.totalSellingPrice ?? item?.sellingPrice ?? item?.price ?? item?.unitPrice);
      return sum + sellingPrice;
    }, 0);
  };

  const calculateOrderCost = (order) => {
    const sanitizeNumber = (v) => (typeof v === 'number' ? v : parseFloat(v)) || 0;
    return normalizeOrderItems(order).reduce((sum, item) => {
      // Dashboard logic: totalCostPrice ?? costPrice (fallback to unit cost essentially, or assuming costPrice is total if totalCostPrice missing)
      const unitCost = sanitizeNumber(item.costPrice ?? item.purchasePrice ?? item.unitCost ?? item.basePrice ?? 0);
      const totalCostProp = sanitizeNumber(item.totalCostPrice);

      // Match Dashboard Logic:
      // return sum + toNumber(item.totalCostPrice ?? item.costPrice ?? 0);
      const finalItemCost = totalCostProp > 0 ? totalCostProp : unitCost;

      return sum + finalItemCost;
    }, 0);
  };



  const resolvePurchaseOrderTotal = (purchaseOrder) => {
    if (!purchaseOrder) return 0;
    const directTotal = sanitizeNumber(purchaseOrder.total ?? purchaseOrder.grandTotal ?? purchaseOrder.amount ?? purchaseOrder.totalAmount, 0);
    if (directTotal > 0) return directTotal;
    if (Array.isArray(purchaseOrder.items) && purchaseOrder.items.length > 0) {
      return purchaseOrder.items.reduce((sum, item) => {
        const subtotal = sanitizeNumber(item.subtotal ?? item.total ?? item.lineTotal, 0);
        if (subtotal) return sum + subtotal;
        const price = sanitizeNumber(item.price ?? item.costPrice ?? item.unitPrice ?? item.rate ?? 0, 0);
        const quantity = sanitizeNumber(item.quantity ?? item.qty ?? item.count ?? 1, 1);
        return sum + (price * quantity);
      }, 0);
    }
    return 0;
  };

  const normalizePaymentMethod = (method) => {
    const value = (method || '').toString().toLowerCase();
    if (value === 'card' || value === 'upi' || value === 'online') return 'online';
    if (value === 'due' || value === 'credit') return 'due';
    return 'cash';
  };

  // ========== SALES SUMMARY ==========

  // Calculate refunds and refunded costs for the PERIOD (not just for the filtered orders)
  const { totalRefunds, totalRefundedCost } = useMemo(() => {
    let refundAmount = 0;
    let refundCost = 0;

    // Filter refunds by date range and seller
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
            const qty = Number(ri.qty || 0);
            const rate = Number(ri.rate || 0);
            refundAmount += (qty * rate);

            if (matchedOriginalItem) {
              const origQty = Number(matchedOriginalItem.quantity || matchedOriginalItem.qty || 1);
              const unitCost = Number(matchedOriginalItem.totalCostPrice ?? matchedOriginalItem.costPrice ?? 0) / (origQty || 1);
              refundCost += (qty * unitCost);
            }
          }
        });
      } else {
        const totalAmt = Number(refund.totalRefundAmount || refund.amount || 0);
        refundAmount += (totalAmt * propFactor);
      }
    });

    return { totalRefunds: refundAmount, totalRefundedCost: refundCost };
  }, [state.refunds, state.orders, startDate, endDate, saleMode]);

  // businessWideRefunds replaced by totalRefunds (which is now correctly calculated for period + saleMode)
  // Business-wide refunds (using same date fallback logic for consistency)
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
    }).reduce((sum, refund) => sum + (Number(refund.totalRefundAmount || refund.amount || 0)), 0);
  }, [state.refunds, state.orders, sellerIdentifiers, startDate, endDate]);

  const totalSales = filteredOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0) - totalRefunds;
  const totalOrders = filteredOrders.length;
  const totalDeliveryCharges = filteredOrders.reduce((sum, order) => sum + (order.deliveryCharge || 0), 0);

  // Pending orders logic
  const totalPendingSales = pendingOrdersData.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const totalPendingDelivery = pendingOrdersData.reduce((sum, order) => sum + (order.deliveryCharge || 0), 0);
  const totalPendingOrders = pendingOrdersData.length;
  const totalPendingProfit = pendingOrdersData.reduce((sum, order) => sum + (order.pendingProfit || 0), 0);

  // COGS Calculation
  // Gross COGS (Original Items)
  const grossCogs = filteredOrders.reduce((sum, order) => sum + calculateOrderCost(order), 0);
  // Net COGS = Gross COGS - Refunded Cost (as per user request for Net Sales Revenue view)
  const totalCogs = grossCogs - totalRefundedCost;

  const totalDiscount = filteredOrders.reduce((sum, order) => sum + sanitizeNumber(order.discount || order.discountAmount || 0), 0);
  const totalTax = filteredOrders.reduce((sum, order) => sum + sanitizeNumber(order.tax || order.taxAmount || 0), 0);

  // Operating expenses
  const totalExpenses = filteredPurchaseOrders.reduce((sum, po) => sum + (resolvePurchaseOrderTotal(po) || 0), 0);

  // Petty Expenses
  const totalPettyExpenses = (state.expenses || []).reduce((sum, exp) => {
    const expDate = new Date(exp.date || exp.createdAt);
    if (expDate >= startDate && expDate <= endDate) {
      return sum + sanitizeNumber(exp.amount);
    }
    return sum;
  }, 0);

  // Gross Profit = Net Sales - Net COGS
  const grossProfit = totalSales - totalCogs;

  // Net Profit
  // Profit = (Sales - Gross COGS) - (Refunds - Refunded Cost) - Expenses
  // totalSales (Net) = GrossSales - Refunds
  // totalCogs (Net) = GrossCOGS - RefundedCost
  // Profit = (GrossSales - Refunds) - (GrossCOGS - RefundedCost) - Expenses
  // Profit = NetSales - NetCOGS - Expenses
  // Profit = grossProfit - Expenses

  const confirmedGrossProfit = grossProfit;
  const netProfit = confirmedGrossProfit - (saleMode === 'direct' ? 0 : totalPettyExpenses);
  const profitMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;



  // Sales chart data (daily for selected range)
  const salesChartData = useMemo(() => {
    const days = [];
    const salesMap = new Map();
    // Calculate difference in days (inclusive of start and end, hence ceil might give N for N days span if times align, but let's be safe)
    // Actually simpler: just iterate date from start to end.

    // Safety check just in case dates are invalid
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return { labels: [], datasets: [] };

    const loopDate = new Date(startDate);
    while (loopDate <= endDate) {
      const dayKey = formatDate(loopDate);
      days.push(dayKey);
      salesMap.set(dayKey, 0);
      // Advance by 1 day
      loopDate.setDate(loopDate.getDate() + 1);
    }

    filteredOrders.forEach(order => {
      const orderDate = new Date(order.createdAt || order.date);
      if (!Number.isNaN(orderDate.getTime()) && orderDate >= startDate && orderDate <= endDate) {
        const dayKey = formatDate(orderDate);
        if (salesMap.has(dayKey)) {
          salesMap.set(dayKey, salesMap.get(dayKey) + (order.totalAmount || 0));
        }
      }
    });

    return {
      labels: days,
      datasets: [{
        label: 'Sales',
        data: days.map(day => salesMap.get(day) || 0),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 2,
        borderRadius: 8,
      }]
    };
  }, [filteredOrders, startDate, endDate]);

  // ========== STOCK SUMMARY ==========
  const totalProducts = state.products.length;
  const lowStockThreshold = state.lowStockThreshold || 10;
  const lowStockCount = state.products.filter(p => {
    const stock = sanitizeNumber(p.quantity ?? p.stock ?? 0);
    return stock > 0 && stock <= lowStockThreshold;
  }).length;
  const outOfStockCount = state.products.filter(p => {
    const stock = sanitizeNumber(p.quantity ?? p.stock ?? 0);
    return stock <= 0;
  }).length;

  // Stock chart data
  const stockChartData = useMemo(() => {
    const categories = [
      getTranslation('inStock', state.currentLanguage),
      getTranslation('lowStock', state.currentLanguage),
      getTranslation('outOfStock', state.currentLanguage)
    ];
    const inStockCount = totalProducts - lowStockCount - outOfStockCount;
    return {
      labels: categories,
      datasets: [{
        data: [inStockCount, lowStockCount, outOfStockCount],
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(249, 115, 22, 0.8)',
          'rgba(239, 68, 68, 0.8)',
        ],
        borderColor: [
          'rgba(34, 197, 94, 1)',
          'rgba(249, 115, 22, 1)',
          'rgba(239, 68, 68, 1)',
        ],
        borderWidth: 2,
      }]
    };
  }, [totalProducts, lowStockCount, outOfStockCount]);

  // ========== PURCHASE SUMMARY ==========
  const totalPurchaseAmount = filteredPurchaseOrders.reduce((sum, po) => sum + resolvePurchaseOrderTotal(po), 0);
  const pendingPurchaseOrders = filteredPurchaseOrders.filter(po => {
    const status = (po.status || 'pending').toLowerCase();
    return status === 'pending' || status === 'processing' || status === 'in-progress';
  }).length;

  // Purchase chart data
  const purchaseChartData = useMemo(() => {
    const statusCounts = {
      completed: 0,
      pending: 0,
      cancelled: 0
    };

    filteredPurchaseOrders.forEach(po => {
      const status = (po.status || 'pending').toLowerCase();
      if (status === 'completed') statusCounts.completed++;
      else if (status === 'cancelled' || status === 'canceled') statusCounts.cancelled++;
      else statusCounts.pending++;
    });

    return {
      labels: ['Completed', 'Pending', 'Cancelled'],
      datasets: [{
        data: [statusCounts.completed, statusCounts.pending, statusCounts.cancelled],
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(249, 115, 22, 0.8)',
          'rgba(239, 68, 68, 0.8)',
        ],
        borderColor: [
          'rgba(34, 197, 94, 1)',
          'rgba(249, 115, 22, 1)',
          'rgba(239, 68, 68, 1)',
        ],
        borderWidth: 2,
      }]
    };
  }, [filteredPurchaseOrders]);

  // ========== PAYMENT SUMMARY ==========
  const paymentSummary = useMemo(() => {
    const summary = { cash: 0, online: 0, due: 0 };
    filteredOrders.forEach(order => {
      const amount = sanitizeNumber(order.totalAmount || 0);
      const method = normalizePaymentMethod(order.paymentMethod);

      // Handle split payments
      if (order.paymentMethod === 'split' && order.splitPaymentDetails) {
        summary.cash += sanitizeNumber(order.splitPaymentDetails.cashAmount || 0);
        summary.online += sanitizeNumber(order.splitPaymentDetails.onlineAmount || 0);
        summary.due += sanitizeNumber(order.splitPaymentDetails.dueAmount || 0);
      } else {
        summary[method] += amount;
      }
    });
    return summary;
  }, [filteredOrders]);

  const totalCashReceived = paymentSummary.cash;
  const totalOnlineReceived = paymentSummary.online;
  // Requirement 3: Strict Ledger Reliance (Calculate from transactions instead of cached balance)
  const totalOutstandingDue = useMemo(() => {
    return (state.customerTransactions || []).reduce((sum, t) => {
      if (t.isDeleted) return sum;
      const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
      const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);
      if (isPayment) return sum - sanitizeNumber(t.amount);
      if (isCredit) return sum + sanitizeNumber(t.amount);
      return sum;
    }, 0);
  }, [state.customerTransactions]);

  const totalPayables = useMemo(() => {
    return (state.supplierTransactions || []).reduce((sum, t) => {
      if (t.isDeleted) return sum;
      const isPayment = ['payment', 'cash', 'online', 'upi', 'card'].includes(t.type);
      const isCredit = ['due', 'add_due', 'opening_balance', 'purchase_order'].includes(t.type);
      if (isPayment) return sum - sanitizeNumber(t.amount);
      if (isCredit) return sum + sanitizeNumber(t.amount);
      return sum;
    }, 0);
  }, [state.supplierTransactions]);

  // ========== DETAILED ANALYTICS (NEW) ==========


  const dailyTransactions = useMemo(() => {
    if (!selectedDate) return [];
    return filteredOrders.filter(order => {
      const orderDate = new Date(order.createdAt || order.date);
      return formatDate(orderDate) === selectedDate;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [selectedDate, filteredOrders]);

  // Payment chart data
  const paymentChartData = useMemo(() => {
    return {
      labels: ['Cash', 'Online', 'Due'],
      datasets: [{
        data: [totalCashReceived, totalOnlineReceived, totalOutstandingDue],
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(249, 115, 22, 0.8)',
        ],
        borderColor: [
          'rgba(34, 197, 94, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(249, 115, 22, 1)',
        ],
        borderWidth: 2,
      }]
    };
  }, [totalCashReceived, totalOnlineReceived, totalOutstandingDue]);

  // Hourly breakdown chart data for selected date
  const hourlySalesChartData = useMemo(() => {
    if (!selectedDate) return { labels: [], datasets: [] };

    const hours = Array.from({ length: 24 }, (_, i) => {
      const d = new Date();
      d.setHours(i, 0, 0, 0);
      return d.toLocaleTimeString([], { hour: 'numeric', hour12: true });
    });

    const hourlySales = new Array(24).fill(0);
    const hourlyProfit = new Array(24).fill(0);

    filteredOrders.forEach(order => {
      const orderDate = new Date(order.createdAt || order.date);
      if (formatDate(orderDate) === selectedDate) {
        const hour = orderDate.getHours();
        const revenue = order.totalAmount || 0;
        const cost = calculateOrderCost(order);
        hourlySales[hour] += revenue;
        hourlyProfit[hour] += (revenue - cost);
      }
    });

    return {
      labels: hours,
      datasets: [
        {
          label: getTranslation('hourlySales', state.currentLanguage),
          data: hourlySales,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#4f46e5',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4
        },
        {
          label: getTranslation('hourlyProfit', state.currentLanguage),
          data: hourlyProfit,
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
        }
      ]
    };
  }, [selectedDate, filteredOrders]);

  // Chart options
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          padding: 10,
          font: { size: 11 }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 10,
        cornerRadius: 8,
      }
    },
    // Global interaction settings for better click/hover detection
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    },
    hover: {
      mode: 'nearest',
      intersect: false,
      axis: 'x'
    }
  };

  const barChartOptions = {
    ...chartOptions,
    onClick: function (event, elements, chart) {
      const chartInstance = chart || this;

      // 1. Check if Chart.js detected elements based on our interaction config
      if (elements && elements.length > 0) {
        const index = elements[0].index;
        const dateLabel = salesChartData.labels[index];
        if (dateLabel) {
          setSelectedDate(dateLabel);
          return;
        }
      }

      // 2. Fallback: Manual check for clicks on the scale labels
      if (chartInstance && chartInstance.scales) {
        const xAxis = chartInstance.scales.x;
        if (xAxis) {
          const rawIndex = xAxis.getValueForPixel(event.x);
          const index = Math.round(rawIndex);

          if (index !== undefined && index >= 0 && index < salesChartData.labels.length) {
            // Optional: Verify click is somewhat near the chart vertically to avoid false positives?
            // For now, we assume user intent is clear if they click within the canvas width.
            const dateLabel = salesChartData.labels[index];
            if (dateLabel) {
              setSelectedDate(dateLabel);
            }
          }
        }
      }
    },
    onHover: function (event, chartElement, chart) {
      const target = event.native ? event.native.target : event.target;

      // If Chart.js found elements (pointer), use that
      if (chartElement && chartElement.length > 0) {
        target.style.cursor = 'pointer';
        return;
      }

      // Fallback check for axis area
      const chartInstance = chart || this;
      if (chartInstance && chartInstance.scales) {
        const xAxis = chartInstance.scales.x;
        if (xAxis) {
          const rawIndex = xAxis.getValueForPixel(event.x);
          const index = Math.round(rawIndex);

          if (index !== undefined && index >= 0 && index < salesChartData.labels.length) {
            target.style.cursor = 'pointer';
            return;
          }
        }
      }
      target.style.cursor = 'default';
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        ticks: {
          callback: function (value) {
            return formatCurrencySmart(value, state.currencyFormat);
          }
        }
      }
    }
  };

  // Export functions
  const downloadFile = (filename, content, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

  const exportReportsCSV = () => {
    try {
      const headers = [getTranslation('section', state.currentLanguage), getTranslation('metric', state.currentLanguage), getTranslation('value', state.currentLanguage)];
      const rows = [
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalSales', state.currentLanguage), formatCurrencySmart(totalSales, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), 'Total Refunds', formatCurrencySmart(totalRefunds, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), 'Pending Orders', totalPendingOrders],
        [getTranslation('salesSummary', state.currentLanguage), 'Pending Sales', formatCurrencySmart(totalPendingSales, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), 'Delivery Charges', formatCurrencySmart(totalDeliveryCharges, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('cogs', state.currentLanguage) || 'COGS', formatCurrencySmart(totalCogs, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('discount', state.currentLanguage) || 'Discount', formatCurrencySmart(totalDiscount, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('tax', state.currentLanguage) || 'Tax', formatCurrencySmart(totalTax, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalOrders', state.currentLanguage), totalOrders],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('netProfit', state.currentLanguage), formatCurrencySmart(netProfit, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('profitMargin', state.currentLanguage) || 'Profit Margin', `${profitMargin.toFixed(2)}%`],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('products', state.currentLanguage), totalProducts],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('lowStockLabel', state.currentLanguage), lowStockCount],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('outOfStockLabel', state.currentLanguage), outOfStockCount],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('totalPurchaseAmount', state.currentLanguage), formatCurrencySmart(totalPurchaseAmount, state.currencyFormat)],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('pendingOrdersLabel', state.currentLanguage), pendingPurchaseOrders],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('pettyExpenses', state.currentLanguage) || 'Petty Expenses', formatCurrencySmart(totalPettyExpenses, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('cashReceived', state.currentLanguage), formatCurrencySmart(totalCashReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('onlineReceived', state.currentLanguage), formatCurrencySmart(totalOnlineReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('outstandingDue', state.currentLanguage), formatCurrencySmart(totalOutstandingDue, state.currencyFormat)],
      ];

      const csvContent = [headers.join(','), ...rows.map(row => row.map(escapeValue).join(','))].join('\n');
      downloadFile(
        `reports-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );
      if (window.showToast) {
        window.showToast('Reports exported as CSV.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  const exportReportsJSON = () => {
    try {
      const reportData = {
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          range: timeRange
        },
        salesSummary: {
          totalSales,
          totalOrders,
          totalPendingSales,
          totalPendingOrders,
          totalDeliveryCharges,
          totalPendingDelivery,
          netProfit
        },
        stockSummary: {
          totalProducts,
          lowStockCount,
          outOfStockCount
        },
        purchaseSummary: {
          totalPurchaseAmount,
          pendingPurchaseOrders
        },
        paymentSummary: {
          totalCashReceived,
          totalOnlineReceived,
          totalOutstandingDue
        },
        generatedAt: new Date().toISOString(),
        shopName: state.currentUser?.shopName || 'Store'
      };

      downloadFile(
        `reports-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(reportData, null, 2),
        'application/json'
      );
      if (window.showToast) {
        window.showToast('Reports exported as JSON.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportReportsPDF = async () => {
    try {
      const reportSettings = state.currentPlanDetails?.sellerSettings?.reportSettings || {};
      const orientation = reportSettings.orientation === 'portrait' ? 'p' : 'l';
      const themeColor = reportSettings.themeColor || '#2F3C7E';

      // Convert hex to RGB for jsPDF
      const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16)
        ] : [47, 60, 126];
      };

      const pdf = new jsPDF(orientation, 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
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

      // Helper to draw text with Hindi support
      const safeDrawText = (doc, text, x, y, options = {}) => {
        const isHindi = /[\u0900-\u097F\u20B9]/.test(text);
        const fontStyle = options.fontStyle || 'normal';
        if (isHindi) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const fontSize = options.fontSize || 10;
          ctx.font = `${fontStyle} ${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
          const metrics = ctx.measureText(text);
          canvas.width = metrics.width * 2;
          canvas.height = fontSize * 2.5;
          ctx.scale(2, 2);
          ctx.fillStyle = options.color || '#000000';
          ctx.font = `${fontStyle} ${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
          ctx.fillText(text, 0, fontSize);
          const dataUrl = canvas.toDataURL('image/png');
          const w = metrics.width / 3.78;
          const h = fontSize * 1.5 / 3.78;
          let drawX = x;
          if (options.align === 'right') drawX -= w;
          else if (options.align === 'center') drawX -= w / 2;
          doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
        } else {
          // Set color and font size for non-Hindi text
          if (options.fontSize) doc.setFontSize(options.fontSize);
          doc.setFont('helvetica', fontStyle);
          if (options.color) {
            if (options.color.startsWith('rgb')) {
              const matches = options.color.match(/\d+/g);
              if (matches && matches.length >= 3) {
                doc.setTextColor(parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2]));
              }
            } else {
              doc.setTextColor(options.color);
            }
          } else {
            // Default to black if no color provided
            doc.setTextColor(0, 0, 0);
          }
          doc.text(text, x, y, options);
        }
      };

      // Add Watermark
      const addWatermark = (doc) => {
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
          doc.setPage(i);
          doc.saveGraphicsState();
          doc.setGState(new doc.GState({ opacity: 0.03 }));
          doc.setFontSize(60);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...COLORS.primary);
          doc.text('REPORTS & ANALYTICS', pageWidth / 2, pageHeight / 2, {
            align: 'center',
            angle: 45
          });
          doc.restoreGraphicsState();
        }
      };

      /* ================= HEADER ================= */
      const headerHeight = 52;
      pdf.setFillColor(250, 251, 255);
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');

      // Top Accent Bar
      pdf.setFillColor(...COLORS.primary);
      pdf.rect(0, 0, pageWidth, 2.5, 'F');

      /* -------- LOGO & APP BRANDING -------- */
      const logoX = margin;
      const logoY = 6;
      const logoSize = 18;

      const publicUrl = process.env.PUBLIC_URL || '';
      const defaultLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
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
      pdf.text('Grocery studio', logoX + logoSize + 4, logoY + 10);

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

      const shopName = state.currentUser?.shopName || state.storeName || 'Store';
      const shopAddress = state.currentUser?.shopAddress || '';
      const shopMobile = state.currentUser?.mobileNumber || state.currentUser?.phoneNumber || '';

      drawShopLine('Shop Name', shopName);
      drawShopLine('Address', shopAddress);
      drawShopLine('Contact', shopMobile);
      drawShopLine('GSTIN', state.storeGtin);

      /* -------- RIGHT META -------- */
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setTextColor(...COLORS.black);
      pdf.text(getTranslation('reportsTitle', state.currentLanguage) || 'REPORTS SUMMARY', pageWidth - margin, 14, { align: 'right' });

      pdf.setFont('helvetica', 'bold'); // Bolder period
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.gray);
      pdf.text(
        `Month Period: ${timeRange === 'custom' ? `${formatDate(customDateRange.start)} - ${formatDate(customDateRange.end)}` : timeRange.toUpperCase()}`,
        pageWidth - margin,
        20,
        { align: 'right' }
      );
      pdf.text(
        `Sale Type: ${saleMode === 'direct' ? 'DIRECT SALE' : 'NORMAL SALE'}`,
        pageWidth - margin,
        25,
        { align: 'right' }
      );

      pdf.setFillColor(...COLORS.primary);
      pdf.roundedRect(pageWidth - 75, 29, 60, 7, 1.5, 1.5, 'F');
      pdf.setTextColor(...COLORS.white);
      pdf.setFontSize(7.5);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`GEN: ${formatDateTime(new Date())}`, pageWidth - margin - 15, 33.5, { align: 'right' });
      let y = headerHeight + 10;
      if (reportSettings.showSummary !== false) {
        const cardW = (contentWidth - 12) / 4;
        const cardH = 22;

        const metrics = [
          { label: getTranslation('totalSales', state.currentLanguage), value: formatPDFCurrency(totalSales) },
          { label: getTranslation('totalOrders', state.currentLanguage), value: totalOrders.toString() },
          { label: getTranslation('netProfit', state.currentLanguage), value: formatPDFCurrency(netProfit) },
          { label: getTranslation('totalProducts', state.currentLanguage), value: totalProducts.toString() }
        ];

        metrics.forEach((m, i) => {
          const x = margin + i * (cardW + 4);

          // Premium Card
          pdf.setFillColor(255, 255, 255);
          pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
          pdf.setDrawColor(...COLORS.border);
          pdf.setLineWidth(0.1);
          pdf.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

          pdf.setFontSize(7.5);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(...COLORS.gray);
          safeDrawText(pdf, m.label.toUpperCase(), x + 6, y + 8, { fontSize: 7.5, color: `rgb(${COLORS.gray.join(',')})` });

          pdf.setFontSize(14); // Increased size
          pdf.setFont('helvetica', 'bold'); // Ensure bold
          pdf.setTextColor(...COLORS.black);
          safeDrawText(pdf, String(m.value), x + 6, y + 16, { fontSize: 13, color: '#000000' });
        });
        y += cardH + 16;
      } else {
        y += 4;
      }

      /* ================= TABLE TITLE ================= */

      pdf.setDrawColor(...COLORS.border);
      pdf.line(margin, y, pageWidth - margin, y);

      y += 8;
      safeDrawText(pdf, getTranslation('detailedReportSummary', state.currentLanguage), margin, y, { fontSize: 15, color: `rgb(${COLORS.primary.join(',')})` });

      // Date range info
      const displayRange = timeRange === 'custom'
        ? `${formatDate(customDateRange.start)} - ${formatDate(customDateRange.end)}`
        : (timeRangeOptions.find(opt => opt.value === timeRange)?.label || 'All Time');
      safeDrawText(pdf, `${getTranslation('period', state.currentLanguage)}: ${displayRange}`, pageWidth - margin, y, { align: 'right', fontSize: 9, color: `rgb(${COLORS.gray.join(',')})` });

      /* ================= TABLE ================= */
      y += 12; // Gap after title

      const reportDataRows = [
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalSales', state.currentLanguage), formatCurrencySmart(totalSales, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), 'Pending Orders', totalPendingOrders.toString()],
        [getTranslation('salesSummary', state.currentLanguage), 'Pending Sales', formatCurrencySmart(totalPendingSales, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), 'Delivery Charges', formatCurrencySmart(totalDeliveryCharges, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('cogs', state.currentLanguage) || 'COGS', formatCurrencySmart(totalCogs, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('discount', state.currentLanguage) || 'Discount', formatCurrencySmart(totalDiscount, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('tax', state.currentLanguage) || 'Tax', formatCurrencySmart(totalTax, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalOrders', state.currentLanguage), totalOrders.toString()],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('netProfit', state.currentLanguage), formatCurrencySmart(netProfit, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('profitMargin', state.currentLanguage) || 'Profit Margin', `${profitMargin.toFixed(2)}%`],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('totalProducts', state.currentLanguage), totalProducts.toString()],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('lowStockLabel', state.currentLanguage), lowStockCount.toString()],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('outOfStockLabel', state.currentLanguage), outOfStockCount.toString()],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('totalPurchaseAmount', state.currentLanguage), formatCurrencySmart(totalPurchaseAmount, state.currencyFormat)],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('pendingOrdersLabel', state.currentLanguage), pendingPurchaseOrders.toString()],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('pettyExpenses', state.currentLanguage) || 'Petty Expenses', formatCurrencySmart(totalPettyExpenses, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('cashReceived', state.currentLanguage), formatCurrencySmart(totalCashReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('onlineReceived', state.currentLanguage), formatCurrencySmart(totalOnlineReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('outstandingDue', state.currentLanguage), formatCurrencySmart(totalOutstandingDue, state.currencyFormat)],
      ];

      const rowH = 10;
      const colW = [contentWidth * 0.35, contentWidth * 0.40, contentWidth * 0.25];
      const headers = [
        getTranslation('section', state.currentLanguage),
        getTranslation('metric', state.currentLanguage),
        getTranslation('value', state.currentLanguage)
      ];

      // Table Header (Modern Rounded Style)
      pdf.setFillColor(245, 247, 255);
      pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
      pdf.setTextColor(...COLORS.primary);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10.5);

      headers.forEach((h, i) => {
        const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
        if (i === 2) safeDrawText(pdf, h, margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 10, color: `rgb(${COLORS.primary.join(',')})` });
        else safeDrawText(pdf, h, x + 6, y + 6.5, { fontSize: 10, color: `rgb(${COLORS.primary.join(',')})` });
      });

      y += 12; // Header 10 + 2 range gap

      // Table Rows
      let currentSection = '';
      reportDataRows.forEach((row, idx) => {
        if (y + rowH > pageHeight - 20) {
          pdf.addPage();
          y = 20;
          pdf.setFillColor(245, 247, 255);
          pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
          pdf.setTextColor(...COLORS.primary);
          headers.forEach((h, i) => {
            const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
            if (i === 2) safeDrawText(pdf, h, margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 10, color: `rgb(${COLORS.primary.join(',')})` });
            else safeDrawText(pdf, h, x + 6, y + 6.5, { fontSize: 10, color: `rgb(${COLORS.primary.join(',')})` });
          });
          y += 12;
        }

        if (idx % 2 === 1) {
          pdf.setFillColor(...COLORS.lightBg);
          pdf.rect(margin, y, contentWidth, rowH, 'F');
        }

        pdf.setFontSize(9.5);

        if (row[0] !== currentSection) {
          safeDrawText(pdf, row[0], margin + 6, y + 6.5, { fontSize: 9.5, color: `rgb(${COLORS.gray.join(',')})` });
          currentSection = row[0];
        }

        // Bolder metric and value
        safeDrawText(pdf, row[1], margin + colW[0] + 6, y + 6.5, { fontSize: 9.5, color: `rgb(${COLORS.black.join(',')})`, fontStyle: 'bold' });
        safeDrawText(pdf, row[2], margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 9.5, color: `rgb(${COLORS.primary.join(',')})`, fontStyle: 'bold' });

        y += rowH;
      });

      /* ================= FOOTER ================= */
      const pageCount = pdf.internal.getNumberOfPages();

      // Powered By Logo Logic
      let gsLogoBase64 = null;
      try {
        const publicUrl = process.env.PUBLIC_URL || '';
        const gsLogo = `${publicUrl}/assets/grocery-store-logo-removebg-preview.png`;
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
          pdf.setTextColor(160, 160, 160); // Light gray
          pdf.setFont('helvetica', 'normal');
          pdf.text('Powered by ', centerX - 5, gsY, { align: 'right' });
          pdf.addImage(gsLogoBase64, 'PNG', centerX - 4.2, gsY - 2.8, 3.5, 3.5);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Grocery Studio', centerX + 0.5, gsY, { align: 'left' });
        }

        // Shop Name Right ALign
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
      await addWatermarkToPDF(pdf, sellerLogo || undefined);

      const pdfBlob = pdf.output('blob');
      downloadFile(
        `Business_Report_${new Date().toISOString().split('T')[0]}.pdf`,
        pdfBlob,
        'application/pdf'
      );
      if (window.showToast) {
        window.showToast('Reports exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error in exportReportsPDF:', error);
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  // Close export menu on outside click
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ================= RENDER ================= */
  /* ================= RENDER ================= */
  // Removed blocking loader to allow immediate render



  const timeRangeOptions = [
    { value: 'today', label: getTranslation('timeRange_today', state.currentLanguage) },
    { value: '7d', label: getTranslation('timeRange_7d', state.currentLanguage) },
    { value: '30d', label: getTranslation('timeRange_30d', state.currentLanguage) },
    { value: 'custom', label: getTranslation('timeRange_custom', state.currentLanguage) }
  ];

  return (
    <div className="space-y-6 sm:space-y-8 fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('reportsTitle', state.currentLanguage)}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{getTranslation('reportsSubtitle', state.currentLanguage)}</p>
        </div>

        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Sale Mode Toggle */}
          <div className="flex flex-wrap items-center justify-center gap-1 w-full sm:w-auto sm:inline-flex rounded-xl sm:rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setSaleMode('normal')}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm whitespace-nowrap ${saleMode === 'normal'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              Normal Sale
            </button>
            <button
              type="button"
              onClick={() => setSaleMode('direct')}
              className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm whitespace-nowrap ${saleMode === 'direct'
                ? 'bg-slate-900 text-white shadow'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
              Direct Sale
            </button>
          </div>

          {/* Modern Time Range Filter */}
          <div className="inline-flex gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm w-fit">
            {timeRangeOptions.map((option, i) => {
              const isActive = timeRange === option.value;
              return (
                <span
                  key={option.value}
                  onClick={() => {
                    if (option.value === 'custom') {
                      setTempCustomRange({ ...customDateRange });
                      setShowCustomDateModal(true);
                    } else {
                      setTimeRange(option.value);
                    }
                  }}
                  className={`px-5 py-2 text-sm font-medium rounded-full cursor-pointer ${isActive
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 dark:text-slate-300'
                    }`}
                >
                  {option.label}
                </span>
              );
            })}
          </div>

          {/* Export Menu */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              {getTranslation('export', state.currentLanguage)}
            </button>

            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.showToast) window.showToast('Starting CSV Export...', 'info');
                        exportReportsCSV();
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
                        exportReportsJSON();
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.showToast) window.showToast('Generating PDF...', 'info');
                        setTimeout(() => {
                          exportReportsPDF();
                        }, 100);
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

      {/* Sales Summary */}
      <div className="card">
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('salesSummary', state.currentLanguage)}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('salesSummaryDesc', state.currentLanguage)}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6 auto-rows-[1fr]">
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              <IndianRupee className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalSales', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400" title={formatCurrency(totalSales)}>
                {formatCurrencySmart(totalSales, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
              <XCircle className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Total Refunds</p>
              {(isLoading || (state.dataFreshness === 'loading' && (!state.refunds || state.refunds.length === 0))) ? (
                <SkeletonCard className="h-8 w-32 bg-rose-200 dark:bg-rose-900/30 rounded" />
              ) : (
                <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400" title={formatCurrency(businessWideRefunds)}>
                  {formatCurrencySmart(businessWideRefunds, state.currencyFormat)}
                </p>
              )}
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-slate-900 dark:text-slate-100">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalOrders', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{totalOrders}</p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Delivery Charges</p>
              <p className="text-2xl font-semibold text-sky-600 dark:text-sky-400" title={formatCurrency(totalDeliveryCharges)}>
                {formatCurrencySmart(totalDeliveryCharges, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
              <Clock className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Pending Orders</p>
              <p className="text-2xl font-semibold text-blue-600 dark:text-blue-400">{totalPendingOrders}</p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
              <IndianRupee className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Pending Sales</p>
              <p className="text-2xl font-semibold text-orange-600 dark:text-orange-400" title={formatCurrency(totalPendingSales)}>
                {formatCurrencySmart(totalPendingSales, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('netProfit', state.currentLanguage)}</p>
              <p className={`text-2xl font-semibold ${netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} title={formatCurrency(netProfit)}>
                {formatCurrencySmart(netProfit, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md h-full">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400">
              <IndianRupee className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">Pending Profit</p>
              <p className={`text-2xl font-semibold ${totalPendingProfit >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-rose-600 dark:text-rose-400'}`} title={formatCurrency(totalPendingProfit)}>
                {formatCurrencySmart(totalPendingProfit, state.currencyFormat)}
              </p>
            </div>
          </div>
        </div>
        <div className="h-64">
          <Bar data={salesChartData} options={barChartOptions} />
        </div>
      </div>

      {/* Stock Summary */}
      <div className="card">
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('stockSummary', state.currentLanguage)}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('stockSummaryDesc', state.currentLanguage)}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
              <Package className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalProducts', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{totalProducts}</p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('lowStockLabel', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{lowStockCount}</p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
              <XCircle className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('outOfStockLabel', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400">{outOfStockCount}</p>
            </div>
          </div>
        </div>
        <div className="h-48 flex items-center justify-center">
          <div className="w-64">
            <Pie data={stockChartData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Purchase Summary */}
      <div className="card">
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('purchaseSummary', state.currentLanguage)}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('purchaseSummaryDesc', state.currentLanguage)}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalPurchaseAmount', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400" title={formatCurrency(totalPurchaseAmount)}>
                {formatCurrencySmart(totalPurchaseAmount, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('pendingOrdersLabel', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{pendingPurchaseOrders}</p>
            </div>
          </div>
        </div>
        <div className="h-48 flex items-center justify-center">
          <div className="w-64">
            <Pie data={purchaseChartData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Payment Summary */}
      <div className="card">
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('paymentSummary', state.currentLanguage)}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{getTranslation('paymentSummaryDesc', state.currentLanguage)}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('cashReceived', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(totalCashReceived)}>
                {formatCurrencySmart(totalCashReceived, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400">
              <CreditCard className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('onlineReceived', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(totalOnlineReceived)}>
                {formatCurrencySmart(totalOnlineReceived, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('outstandingDueLabel', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-rose-600 dark:text-rose-400" title={formatCurrency(totalOutstandingDue)}>
                {formatCurrencySmart(totalOutstandingDue, state.currencyFormat)}
              </p>
            </div>
          </div>
        </div>
        <div className="h-48 flex items-center justify-center">
          <div className="w-64">
            <Pie data={paymentChartData} options={chartOptions} />
          </div>
        </div>
      </div>


      {/* Custom Date Modal */}
      {showCustomDateModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-slate-900 dark:text-white" />
                {getTranslation('selectRange', state.currentLanguage)}
              </h3>
              <button
                onClick={() => setShowCustomDateModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                aria-label="Close"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('startDate', state.currentLanguage)}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="date"
                    value={tempCustomRange.start}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{getTranslation('endDate', state.currentLanguage)}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Calendar className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="date"
                    value={tempCustomRange.end}
                    onChange={e => setTempCustomRange({ ...tempCustomRange, end: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 outline-none transition-all dark:[&::-webkit-calendar-picker-indicator]:filter dark:[&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
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
                  {getTranslation('applyRange', state.currentLanguage)}
                </button>

              </div>
            </div>
          </div>
        </div>
      )}

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
                  {getTranslation('salesBreakdown', state.currentLanguage)}
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
                  data={hourlySalesChartData}
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
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wide font-bold">{getTranslation('totalProfitForDay', state.currentLanguage)}</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                    {formatCurrencySmart(
                      hourlySalesChartData.datasets[1].data.reduce((a, b) => a + b, 0),
                      state.currencyFormat
                    )}
                  </p>
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                  <p className="text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wide font-bold">{getTranslation('totalSalesForDay', state.currentLanguage)}</p>
                  <p className="text-xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">
                    {formatCurrencySmart(
                      hourlySalesChartData.datasets[0].data.reduce((a, b) => a + b, 0),
                      state.currencyFormat
                    )}
                  </p>
                </div>
              </div>

              {/* Transactions List */}
              <div className="mt-8 border-t border-gray-100 dark:border-slate-700 pt-6">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {getTranslation('recentTransactions', state.currentLanguage) || 'Recent Transactions'}
                </h4>
                <div className="overflow-x-auto max-h-60 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white dark:bg-slate-800 z-10">
                      <tr className="border-b border-gray-100 dark:border-slate-700">
                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">{getTranslation('time', state.currentLanguage) || 'Time'}</th>
                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">{getTranslation('customer', state.currentLanguage)}</th>
                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">{getTranslation('items', state.currentLanguage)}</th>
                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase">{getTranslation('payment', state.currentLanguage)}</th>
                        <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase text-right">{getTranslation('total', state.currentLanguage)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {dailyTransactions.map((order, index) => {
                        const orderDate = new Date(order.createdAt || order.date);
                        const timeStr = orderDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const items = normalizeOrderItems(order);
                        const itemCount = items.reduce((sum, item) => sum + sanitizeNumber(item.quantity), 0);
                        const total = calculateOrderRevenue(order);

                        return (
                          <tr key={order.id || index} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                            <td className="py-3 px-4 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">{timeStr}</td>
                            <td className="py-3 px-4 text-sm text-gray-600 dark:text-slate-300">
                              {order.customerName || order.customer?.name || getTranslation('walkInCustomer', state.currentLanguage)}
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-600 dark:text-slate-300">{itemCount} items</td>
                            <td className="py-3 px-4 text-sm text-gray-600 dark:text-slate-300 capitalize">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${(order.paymentMethod || 'cash').toLowerCase() === 'cash'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                                }`}>
                                {order.paymentMethod || 'Cash'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-sm font-bold text-gray-900 dark:text-white text-right">
                              {formatCurrencySmart(total, state.currencyFormat)}
                            </td>
                          </tr>
                        );
                      })}
                      {dailyTransactions.length === 0 && (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">
                            {getTranslation('noTransactions', state.currentLanguage)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default Reports;
