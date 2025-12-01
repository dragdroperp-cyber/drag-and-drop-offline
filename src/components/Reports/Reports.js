import React, { useState, useMemo } from 'react';
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
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import jsPDF from 'jspdf';
import { getSellerIdFromAuth } from '../../utils/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

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

  const { startDate, endDate } = getDateRange();

  // Filter data by date range and seller
  const filteredOrders = filterBySeller(state.orders || []).filter(order => {
    if (order.isDeleted) return false;
    const orderDate = new Date(order.createdAt || order.date || 0);
    return orderDate >= startDate && orderDate <= endDate;
  });

  const filteredPurchaseOrders = filterBySeller(state.purchaseOrders || []).filter(po => {
    if (po.isDeleted) return false;
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
    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const maxDays = Math.min(daysDiff, 30); // Limit to 30 days for readability
    
    for (let i = 0; i < maxDays; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dayKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days.push(dayKey);
      salesMap.set(dayKey, 0);
    }

    filteredOrders.forEach(order => {
      const orderDate = new Date(order.createdAt || order.date);
      if (!Number.isNaN(orderDate.getTime()) && orderDate >= startDate && orderDate <= endDate) {
        const dayKey = orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (salesMap.has(dayKey)) {
          salesMap.set(dayKey, salesMap.get(dayKey) + calculateOrderRevenue(order));
        }
      }
    });

    return {
      labels: days,
      datasets: [{
          label: 'Sales (₹)',
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
    const categories = ['In Stock', 'Low Stock', 'Out of Stock'];
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
    }
  };

  const barChartOptions = {
    ...chartOptions,
    scales: {
      x: { grid: { display: false } },
      y: { 
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        ticks: {
          callback: function(value) {
              return '₹' + value.toLocaleString('en-IN');
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
      const headers = ['Section', 'Metric', 'Value'];
      const rows = [
        ['Sales Summary', 'Total Sales', `₹${totalSales.toFixed(2)}`],
        ['Sales Summary', 'Total Orders', totalOrders],
        ['Sales Summary', 'Net Profit', `₹${netProfit.toFixed(2)}`],
        ['Stock Summary', 'Total Products', totalProducts],
        ['Stock Summary', 'Low Stock Count', lowStockCount],
        ['Stock Summary', 'Out of Stock Count', outOfStockCount],
        ['Purchase Summary', 'Total Purchase Amount', `₹${totalPurchaseAmount.toFixed(2)}`],
        ['Purchase Summary', 'Pending Purchase Orders', pendingPurchaseOrders],
        ['Payment Summary', 'Cash Received', `₹${totalCashReceived.toFixed(2)}`],
        ['Payment Summary', 'Online Received', `₹${totalOnlineReceived.toFixed(2)}`],
        ['Payment Summary', 'Outstanding Due', `₹${totalOutstandingDue.toFixed(2)}`],
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
      console.error('Error exporting CSV:', error);
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
      console.error('Error exporting JSON:', error);
      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportReportsPDF = () => {
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
      const borderColor = { r: 226, g: 232, b: 240 };

      // Page margins
      const topMargin = 20;
      const bottomMargin = 20;
      const leftMargin = 15;
      const rightMargin = 15;
      const contentWidth = pageWidth - leftMargin - rightMargin;

      // Header Section with Logo Area
      const headerHeight = 28;
      pdf.setFillColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
      pdf.rect(0, 0, pageWidth, headerHeight, 'F');
      
      // Accent bar at top
      pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
      pdf.rect(0, 0, pageWidth, 3, 'F');

      // Logo area (styled box)
      const logoBoxSize = 18;
      const logoX = leftMargin;
      const logoY = 8;
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(brandAccent.r, brandAccent.g, brandAccent.b);
      pdf.setLineWidth(0.5);
      pdf.rect(logoX, logoY, logoBoxSize, logoBoxSize, 'FD');
      
      // App name next to logo
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.text('Drag & Drop', logoX + logoBoxSize + 6, logoY + 7);

      // Underline accent
      pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
      pdf.rect(logoX + logoBoxSize + 6, logoY + 9, 50, 2, 'F');

      // Report title and date on right
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text('Business Reports', pageWidth - rightMargin, logoY + 5, { align: 'right' });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(240, 240, 240);
      try {
        const reportDate = new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          weekday: 'long'
        });
        pdf.text(reportDate, pageWidth - rightMargin, logoY + 11, { align: 'right' });
      } catch (dateError) {
        pdf.text(new Date().toLocaleDateString('en-US'), pageWidth - rightMargin, logoY + 11, { align: 'right' });
      }
      
      pdf.setFontSize(8);
      pdf.setTextColor(220, 220, 220);
      const shopInfo = `${state.currentUser?.shopName || 'Store'}`;
      pdf.text(shopInfo, pageWidth - rightMargin, logoY + 16, { align: 'right' });

      // Summary Cards Section
      const summaryY = headerHeight + 12;
      const cardHeight = 20;
      const cardSpacing = 4;
      const cardWidth = (contentWidth - (cardSpacing * 3)) / 4;

      const summaryCards = [
        { label: 'Total Sales', value: `₹${totalSales.toFixed(2)}`, accentColor: { r: 34, g: 197, b: 94 } },
        { label: 'Total Orders', value: totalOrders.toString(), accentColor: brandPrimary },
        { label: 'Net Profit', value: `₹${netProfit.toFixed(2)}`, accentColor: { r: 59, g: 130, b: 246 } },
        { label: 'Products', value: totalProducts.toString(), accentColor: brandAccent }
      ];

      summaryCards.forEach((card, index) => {
        const cardX = leftMargin + (index * (cardWidth + cardSpacing));
        
        // Card background
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
        pdf.setLineWidth(0.3);
        pdf.rect(cardX, summaryY, cardWidth, cardHeight, 'FD');
        
        // Accent top border
        pdf.setFillColor(card.accentColor.r, card.accentColor.g, card.accentColor.b);
        pdf.rect(cardX, summaryY, cardWidth, 2.5, 'F');
        
        // Label
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text(card.label.toUpperCase(), cardX + 4, summaryY + 8);
        
        // Value
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(card.accentColor.r, card.accentColor.g, card.accentColor.b);
        const valueLines = pdf.splitTextToSize(card.value, cardWidth - 8);
        pdf.text(valueLines[0], cardX + 4, summaryY + 15);
      });

      // Section Divider
      let y = summaryY + cardHeight + 15;
      pdf.setDrawColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
      pdf.setLineWidth(0.5);
      pdf.line(leftMargin, y, pageWidth - rightMargin, y);
      
      // Section Title
      y += 8;
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
      pdf.text('Detailed Report Summary', leftMargin, y);

      // Date range info
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
      const timeRangeLabel = timeRangeOptions.find(opt => opt.value === timeRange)?.label || 'All Time';
      pdf.text(`Period: ${timeRangeLabel}`, pageWidth - rightMargin, y, { align: 'right' });

      // Reports Data Table
      y += 10;
      const tableStartY = y;
      const rowHeight = 7;
      const headerHeight_table = 8;
      const cellPadding = 4;

      const reportData = [
        ['Section', 'Metric', 'Value'],
        ['Sales Summary', 'Total Sales', `₹${totalSales.toFixed(2)}`],
        ['Sales Summary', 'Total Orders', totalOrders.toString()],
        ['Sales Summary', 'Net Profit', `₹${netProfit.toFixed(2)}`],
        ['Stock Summary', 'Total Products', totalProducts.toString()],
        ['Stock Summary', 'Low Stock', lowStockCount.toString()],
        ['Stock Summary', 'Out of Stock', outOfStockCount.toString()],
        ['Purchase Summary', 'Total Purchase Amount', `₹${totalPurchaseAmount.toFixed(2)}`],
        ['Purchase Summary', 'Pending Orders', pendingPurchaseOrders.toString()],
        ['Payment Summary', 'Cash Received', `₹${totalCashReceived.toFixed(2)}`],
        ['Payment Summary', 'Online Received', `₹${totalOnlineReceived.toFixed(2)}`],
        ['Payment Summary', 'Outstanding Due', `₹${totalOutstandingDue.toFixed(2)}`],
      ];

      // Column widths
      const col1Width = contentWidth * 0.35;
      const col2Width = contentWidth * 0.40;
      const col3Width = contentWidth * 0.25;

      reportData.forEach((row, idx) => {
        const currentY = tableStartY + (idx * rowHeight) + (idx === 0 ? 0 : headerHeight_table - rowHeight);
        
        if (idx === 0) {
          // Table Header
          pdf.setFillColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
          pdf.rect(leftMargin, currentY - headerHeight_table + 2, contentWidth, headerHeight_table, 'F');
          
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(10);
          pdf.setTextColor(255, 255, 255);
          
          pdf.text(row[0], leftMargin + cellPadding, currentY - 2);
          pdf.text(row[1], leftMargin + col1Width + cellPadding, currentY - 2);
          pdf.text(row[2], pageWidth - rightMargin - cellPadding, currentY - 2, { align: 'right' });
        } else {
          // Table Rows
          const bgColor = idx % 2 === 0 
            ? { r: brandPrimaryUltraLight.r, g: brandPrimaryUltraLight.g, b: brandPrimaryUltraLight.b }
            : { r: 255, g: 255, b: 255 };
          
          pdf.setFillColor(bgColor.r, bgColor.g, bgColor.b);
          pdf.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
          pdf.setLineWidth(0.1);
          pdf.rect(leftMargin, currentY - rowHeight + 2, contentWidth, rowHeight, 'FD');
          
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(textPrimary.r, textPrimary.g, textPrimary.b);
          
          pdf.text(row[0], leftMargin + cellPadding, currentY - 2);
          pdf.text(row[1], leftMargin + col1Width + cellPadding, currentY - 2);
          
          pdf.setFont('helvetica', 'bold');
          pdf.text(row[2], pageWidth - rightMargin - cellPadding, currentY - 2, { align: 'right' });
        }
      });

      // Footer
      const pageCount = pdf.internal.getNumberOfPages();
      const footerHeight = 15;
      const footerY = pageHeight - footerHeight;
      
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        
        // Footer background
        pdf.setFillColor(brandPrimaryUltraLight.r, brandPrimaryUltraLight.g, brandPrimaryUltraLight.b);
        pdf.rect(0, footerY, pageWidth, footerHeight, 'F');
        
        // Footer top border
        pdf.setFillColor(brandAccent.r, brandAccent.g, brandAccent.b);
        pdf.rect(0, footerY, pageWidth, 1.5, 'F');
        
        // Footer border line
        pdf.setDrawColor(borderColor.r, borderColor.g, borderColor.b);
        pdf.setLineWidth(0.3);
        pdf.line(0, footerY, pageWidth, footerY);
        
        // Page number
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text(`Page ${i} of ${pageCount}`, leftMargin, footerY + 10);
        
        // Generated date
        try {
          const now = new Date();
          const generatedDate = now.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
          }) + ' ' + now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          });
          pdf.text(`Generated: ${generatedDate}`, leftMargin + 50, footerY + 10);
        } catch (dateError) {
          pdf.text(`Generated: ${new Date().toISOString().split('T')[0]}`, leftMargin + 50, footerY + 10);
        }
        
        // Shop name
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(brandPrimary.r, brandPrimary.g, brandPrimary.b);
        pdf.text(`${state.currentUser?.shopName || 'Store'}`, pageWidth - rightMargin, footerY + 6, { align: 'right' });
        
        // App name
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(textSecondary.r, textSecondary.g, textSecondary.b);
        pdf.text('Drag & Drop', pageWidth - rightMargin, footerY + 11, { align: 'right' });
      }

      pdf.save(`reports-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Reports exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('Error generating PDF:', error);
      console.error('Error details:', error.message, error.stack);
      if (window.showToast) {
        window.showToast(`Error generating PDF: ${error.message || 'Please try again.'}`, 'error');
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

  const timeRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '1y', label: 'All Time' }
  ];

  const formatCurrency = (value) => `₹${sanitizeNumber(value).toFixed(2)}`;

  return (
    <div className="space-y-6 fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Business Reports</h1>
          <p className="text-sm text-gray-600 mt-1">Essential business insights and analytics</p>
        </div>
        
        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* Modern Time Range Filter */}
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
          
          {/* Export Menu */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="btn-secondary flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold"
            >
              <Download className="h-4 w-4" />
              Export
              <ChevronDown className={`h-4 w-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                <button
                  onClick={exportReportsPDF}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileText className="h-4 w-4 text-red-600" />
                  <span>Export as PDF</span>
                </button>
                <button
                  onClick={exportReportsJSON}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <FileJson className="h-4 w-4 text-yellow-600" />
                  <span>Export as JSON</span>
                </button>
                <button
                  onClick={exportReportsCSV}
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

      {/* Sales Summary */}
      <div className="card">
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Sales Summary</h3>
          <p className="text-sm text-gray-600">Revenue, orders, and net profit for selected period</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('emerald').background,
                    color: getStatTheme('emerald').color,
                    borderColor: getStatTheme('emerald').border
                  }}
                >
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Sales</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalSales)}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('primary').background,
                    color: getStatTheme('primary').color,
                    borderColor: getStatTheme('primary').border
                  }}
                >
                  <ShoppingCart className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Orders</p>
                  <p className="text-2xl font-semibold text-slate-900">{totalOrders}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('sky').background,
                    color: getStatTheme('sky').color,
                    borderColor: getStatTheme('sky').border
                  }}
                >
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Net Profit</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(netProfit)}</p>
                </div>
              </div>
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
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Stock Summary</h3>
          <p className="text-sm text-gray-600">Product inventory status and alerts</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('slate').background,
                    color: getStatTheme('slate').color,
                    borderColor: getStatTheme('slate').border
                  }}
                >
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Products</p>
                  <p className="text-2xl font-semibold text-slate-900">{totalProducts}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('amber').background,
                    color: getStatTheme('amber').color,
                    borderColor: getStatTheme('amber').border
                  }}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Low Stock</p>
                  <p className="text-2xl font-semibold text-slate-900">{lowStockCount}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('rose').background,
                    color: getStatTheme('rose').color,
                    borderColor: getStatTheme('rose').border
                  }}
                >
                  <XCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Out of Stock</p>
                  <p className="text-2xl font-semibold text-slate-900">{outOfStockCount}</p>
        </div>
            </div>
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
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Purchase Summary</h3>
          <p className="text-sm text-gray-600">Purchase orders and pending items</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('purple').background,
                    color: getStatTheme('purple').color,
                    borderColor: getStatTheme('purple').border
                  }}
                >
                  <Truck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Purchase Amount</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalPurchaseAmount)}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('amber').background,
                    color: getStatTheme('amber').color,
                    borderColor: getStatTheme('amber').border
                  }}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Pending Orders</p>
                  <p className="text-2xl font-semibold text-slate-900">{pendingPurchaseOrders}</p>
                </div>
              </div>
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
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Payment Summary</h3>
          <p className="text-sm text-gray-600">Payment methods and outstanding dues</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('emerald').background,
                    color: getStatTheme('emerald').color,
                    borderColor: getStatTheme('emerald').border
                  }}
                >
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Cash Received</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalCashReceived)}</p>
                </div>
              </div>
        </div>
      </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('sky').background,
                    color: getStatTheme('sky').color,
                    borderColor: getStatTheme('sky').border
                  }}
                >
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Online Received</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalOnlineReceived)}</p>
                </div>
                    </div>
                    </div>
                  </div>
          <div className="stat-card bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl border p-2.5 transition"
                  style={{
                    backgroundColor: getStatTheme('amber').background,
                    color: getStatTheme('amber').color,
                    borderColor: getStatTheme('amber').border
                  }}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-500 mb-1">Outstanding Due</p>
                  <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalOutstandingDue)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="h-48 flex items-center justify-center">
          <div className="w-64">
            <Pie data={paymentChartData} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
