import React, { useState, useMemo } from 'react';
import { formatDate } from '../../utils/dateUtils';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { useApp } from '../../context/AppContext';
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
  Wallet
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import jsPDF from 'jspdf';
import { getTranslation } from '../../utils/translations';
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
  const filteredOrders = filterBySeller(state.orders || []).filter(order => {
    if (order.isDeleted) return false;
    const orderDate = new Date(order.createdAt || order.date || 0);
    return orderDate >= startDate && orderDate <= endDate;
  });

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
    return normalizeOrderItems(order).reduce((sum, item) => {
      const costPrice = sanitizeNumber(item?.totalCostPrice ?? item?.costPrice ?? item?.purchasePrice ?? item?.unitCost ?? item?.basePrice);
      return sum + costPrice;
    }, 0);
  };

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
  const totalSales = filteredOrders.reduce((sum, order) => sum + calculateOrderRevenue(order), 0);
  const totalOrders = filteredOrders.length;

  // Calculate profit from order items (this is Revenue - COGS)
  const profitFromSales = calculateProfitFromOrderItems(filteredOrders);

  // Operating expenses = Purchase Orders (filtered by time range)
  // Purchase orders represent inventory purchases/expenses
  const totalExpenses = filteredPurchaseOrders.reduce((sum, po) => sum + (resolvePurchaseOrderTotal(po) || 0), 0);

  // Net Profit = Profit from Sales - Purchase Orders (expenses)
  // This matches the Financial page calculation: profit from items - purchase orders
  const netProfit = profitFromSales - totalExpenses;

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
          salesMap.set(dayKey, salesMap.get(dayKey) + calculateOrderRevenue(order));
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
  const totalOutstandingDue = state.customers.reduce((sum, c) => sum + sanitizeNumber(c.balanceDue ?? c.dueAmount ?? 0), 0);

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
        hourlySales[hour] += calculateOrderRevenue(order);
        hourlyProfit[hour] += calculateProfitFromOrderItems([order]);
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

  const exportReportsCSV = () => {
    try {
      const headers = [getTranslation('section', state.currentLanguage), getTranslation('metric', state.currentLanguage), getTranslation('value', state.currentLanguage)];
      const rows = [
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalSales', state.currentLanguage), formatCurrencySmart(totalSales, state.currencyFormat)],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalOrders', state.currentLanguage), totalOrders],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('netProfit', state.currentLanguage), formatCurrencySmart(netProfit, state.currencyFormat)],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('products', state.currentLanguage), totalProducts],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('lowStockThreshold', state.currentLanguage), lowStockCount],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('outOfStock', state.currentLanguage), outOfStockCount],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('purchaseSummary', state.currentLanguage), formatCurrencySmart(totalPurchaseAmount, state.currencyFormat)],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('pending', state.currentLanguage), pendingPurchaseOrders],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('cash', state.currentLanguage), formatCurrencySmart(totalCashReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('online', state.currentLanguage), formatCurrencySmart(totalOnlineReceived, state.currencyFormat)],
        [getTranslation('paymentSummary', state.currentLanguage), getTranslation('due', state.currentLanguage), formatCurrencySmart(totalOutstandingDue, state.currencyFormat)],
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
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
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

      /* -------- HELPERS -------- */
      const safeDrawText = (doc, text, x, y, options = {}) => {
        const isHindi = /[\u0900-\u097F\u20B9]/.test(text);
        if (isHindi) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const fontSize = options.fontSize || 10;
          ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
          const metrics = ctx.measureText(text);
          canvas.width = metrics.width * 2;
          canvas.height = fontSize * 2.5;
          ctx.scale(2, 2);
          ctx.fillStyle = options.color || '#000000';
          ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
          ctx.fillText(text, 0, fontSize);
          const dataUrl = canvas.toDataURL('image/png');
          const w = metrics.width / 3.78;
          const h = fontSize * 1.5 / 3.78;
          let drawX = x;
          if (options.align === 'right') drawX -= w;
          else if (options.align === 'center') drawX -= w / 2;
          doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
        } else {
          doc.text(text, x, y, options);
        }
      };

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
        console.warn('Logo could not be loaded for PDF:', e.message);
      }

      /* -------- APP NAME -------- */
      pdf.setFontSize(16);
      pdf.setTextColor(...COLORS.primary);
      safeDrawText(pdf, state.storeName || 'Store', logoX + 22, 15, { fontSize: 16, color: `rgb(${COLORS.primary.join(',')})` });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      safeDrawText(pdf, getTranslation('detailedReportSummary', state.currentLanguage), logoX + 22, 19, { fontSize: 9, color: `rgb(${COLORS.gray.join(',')})` });

      /* -------- RIGHT META -------- */
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.black);
      safeDrawText(pdf, getTranslation('reportsTitle', state.currentLanguage), pageWidth - margin, 14, { align: 'right', fontSize: 12, color: `rgb(${COLORS.black.join(',')})` });

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
      const cardW = (pageWidth - margin * 2 - 12) / 4;
      const cardH = 22;

      const metrics = [
        { label: getTranslation('totalSales', state.currentLanguage), value: formatCurrencySmart(totalSales, state.currencyFormat) },
        { label: getTranslation('totalOrders', state.currentLanguage), value: totalOrders.toString() },
        { label: getTranslation('netProfit', state.currentLanguage), value: formatCurrencySmart(netProfit, state.currencyFormat) },
        { label: getTranslation('totalProducts', state.currentLanguage), value: totalProducts.toString() }
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 4);

        // Card shadow
        pdf.setFillColor(235, 236, 240);
        pdf.rect(x + 1, startY + 1, cardW, cardH, 'F');

        // Card body
        pdf.setFillColor(...COLORS.white);
        pdf.rect(x, startY, cardW, cardH, 'F');

        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.gray);
        safeDrawText(pdf, m.label, x + 4, startY + 7, { fontSize: 8, color: `rgb(${COLORS.gray.join(',')})` });

        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.primary);
        safeDrawText(pdf, String(m.value), x + 4, startY + 16, { fontSize: 13, color: `rgb(${COLORS.primary.join(',')})` });
      });

      /* ================= TABLE TITLE ================= */
      let y = startY + cardH + 14;

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
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('totalOrders', state.currentLanguage), totalOrders.toString()],
        [getTranslation('salesSummary', state.currentLanguage), getTranslation('netProfit', state.currentLanguage), formatCurrencySmart(netProfit, state.currencyFormat)],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('totalProducts', state.currentLanguage), totalProducts.toString()],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('lowStockLabel', state.currentLanguage), lowStockCount.toString()],
        [getTranslation('stockSummary', state.currentLanguage), getTranslation('outOfStockLabel', state.currentLanguage), outOfStockCount.toString()],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('totalPurchaseAmount', state.currentLanguage), formatCurrencySmart(totalPurchaseAmount, state.currencyFormat)],
        [getTranslation('purchaseSummary', state.currentLanguage), getTranslation('pendingOrdersLabel', state.currentLanguage), pendingPurchaseOrders.toString()],
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

      // Table Header
      pdf.setFillColor(...COLORS.primary);
      pdf.rect(margin, y, contentWidth, 10, 'F');
      pdf.setTextColor(...COLORS.white);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);

      headers.forEach((h, i) => {
        const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
        if (i === 2) safeDrawText(pdf, h, margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 10, color: '#ffffff' });
        else safeDrawText(pdf, h, x + 6, y + 6.5, { fontSize: 10, color: '#ffffff' });
      });

      y += 12; // Header 10 + 2 range gap

      // Table Rows
      let currentSection = '';
      reportDataRows.forEach((row, idx) => {
        if (y + rowH > pageHeight - 20) {
          pdf.addPage();
          y = 20;
          pdf.setFillColor(...COLORS.primary);
          pdf.rect(margin, y, contentWidth, 10, 'F');
          pdf.setTextColor(...COLORS.white);
          headers.forEach((h, i) => {
            const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
            if (i === 2) safeDrawText(pdf, h, margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 10, color: '#ffffff' });
            else safeDrawText(pdf, h, x + 6, y + 6.5, { fontSize: 10, color: '#ffffff' });
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

        safeDrawText(pdf, row[1], margin + colW[0] + 6, y + 6.5, { fontSize: 9.5, color: `rgb(${COLORS.black.join(',')})` });
        safeDrawText(pdf, row[2], margin + contentWidth - 6, y + 6.5, { align: 'right', fontSize: 9.5, color: `rgb(${COLORS.primary.join(',')})` });

        y += rowH;
      });

      /* ================= FOOTER ================= */
      const pageCount = pdf.internal.getNumberOfPages();

      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        if (pageCount > 1) {
          pdf.text(`${getTranslation('page', state.currentLanguage)} ${i} ${getTranslation('ofPage', state.currentLanguage)} ${pageCount}`, margin, pageHeight - 10);
        }
        pdf.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      setShowExportMenu(false);
    } catch (error) {
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
  if (!state.orders || !state.products) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('reportsTitle', state.currentLanguage)}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{getTranslation('reportsSubtitle', state.currentLanguage)}</p>
        </div>

        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Modern Time Range Filter */}
          <div className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 p-1 shadow-sm backdrop-blur-sm">
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
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition sm:text-sm ${isActive
                    ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                    : 'text-slate-600 dark:text-slate-300 hover:text-[#2f3c7e] dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-700'
                    }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Export Menu */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              {getTranslation('export', state.currentLanguage)}
              <ChevronDown className={`h-4 w-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-100 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{getTranslation('exportReports', state.currentLanguage)}</h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{getTranslation('chooseHowToExport', state.currentLanguage) || 'Choose format'}</p>
                </div>

                <div className="p-2 space-y-1">
                  <button
                    onClick={exportReportsCSV}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg group transition-colors"
                  >
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg group-hover:scale-110 transition-transform">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">{getTranslation('exportAsCSV', state.currentLanguage)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('csvFormatDesc', state.currentLanguage)}</p>
                    </div>
                  </button>

                  <button
                    onClick={exportReportsJSON}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg group transition-colors"
                  >
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg group-hover:scale-110 transition-transform">
                      <FileJson className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">{getTranslation('exportAsJSON', state.currentLanguage)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('jsonFormatDesc', state.currentLanguage)}</p>
                    </div>
                  </button>

                  <button
                    onClick={exportReportsPDF}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg group transition-colors"
                  >
                    <div className="p-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg group-hover:scale-110 transition-transform">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">{getTranslation('exportAsPDF', state.currentLanguage)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printablePdfDesc', state.currentLanguage)}</p>
                    </div>
                  </button>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalSales', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(totalSales)}>
                {formatCurrencySmart(totalSales, state.currencyFormat)}
              </p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalOrders', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{totalOrders}</p>
            </div>
          </div>
          <div className="relative bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 transition-all hover:shadow-md">
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('netProfit', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(netProfit)}>
                {formatCurrencySmart(netProfit, state.currencyFormat)}
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
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{outOfStockCount}</p>
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
            <div className="absolute top-4 right-4 p-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-2">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tracking-wide uppercase">{getTranslation('totalPurchaseAmount', state.currentLanguage)}</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(totalPurchaseAmount)}>
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
              <p className="text-2xl font-semibold text-gray-900 dark:text-white" title={formatCurrency(totalOutstandingDue)}>
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
                <CalendarRange className="h-5 w-5 text-indigo-600" />
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
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  {getTranslation('applyRange', state.currentLanguage)}
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
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 uppercase tracking-wide font-bold">{getTranslation('totalSalesForDay', state.currentLanguage)}</p>
                  <p className="text-xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">
                    {formatCurrencySmart(
                      hourlySalesChartData.datasets[0].data.reduce((a, b) => a + b, 0),
                      state.currencyFormat
                    )}
                  </p>
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
