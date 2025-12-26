import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Calendar,
  Download,
  Eye,
  Receipt,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  FileSpreadsheet,
  FileJson,
  X,
  Share2,
  CalendarRange,
  XCircle,
  ShoppingCart
} from 'lucide-react';
import jsPDF from 'jspdf';
import { sanitizeMobileNumber } from '../../utils/validation';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDate, formatDateTime } from '../../utils/dateUtils';



const SalesOrderHistory = () => {
  const { state } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [customDateRange, setCustomDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [tempCustomRange, setTempCustomRange] = useState({ ...customDateRange });
  const exportMenuRef = useRef(null);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  // Get all orders (excluding deleted) and enrich with customer details
  const allOrders = useMemo(() => {
    return (state.orders || []).filter(order => !order.isDeleted).map(order => {
      // Enrich with customer details if missing
      if ((!order.customerName || !order.customerMobile) && order.customerId) {
        const customer = state.customers.find(c => c.id === order.customerId || c._id === order.customerId);
        if (customer) {
          return {
            ...order,
            customerName: order.customerName || customer.name,
            customerMobile: order.customerMobile || customer.mobileNumber || customer.phone || ''
          };
        }
      }
      return order;
    });
  }, [state.orders, state.customers]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let filtered = allOrders;

    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(order => {
        const customerName = (order.customerName || '').toLowerCase();
        const customerMobile = (order.customerMobile || '').toLowerCase();
        return customerName.includes(searchLower) ||
          customerMobile.includes(searchLower);
      });
    }

    // Payment method filter
    if (filterPaymentMethod !== 'all') {
      filtered = filtered.filter(order => {
        const paymentMethod = (order.paymentMethod || '').toLowerCase();
        if (filterPaymentMethod.toLowerCase() === 'online') {
          return paymentMethod === 'card' || paymentMethod === 'upi' || paymentMethod === 'online' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.onlineAmount > 0);
        }
        if (filterPaymentMethod.toLowerCase() === 'cash') {
          return paymentMethod === 'cash' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.cashAmount > 0);
        }
        if (filterPaymentMethod.toLowerCase() === 'due') {
          return paymentMethod === 'due' || paymentMethod === 'credit' ||
            (paymentMethod === 'split' && order.splitPaymentDetails && order.splitPaymentDetails.dueAmount > 0);
        }
        return paymentMethod === filterPaymentMethod.toLowerCase();
      });
    }

    // Date range filter
    if (filterDateRange !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      filtered = filtered.filter(order => {
        const orderDate = new Date(order.createdAt || order.date || 0);
        if (Number.isNaN(orderDate.getTime())) return false;
        orderDate.setHours(0, 0, 0, 0);

        switch (filterDateRange) {
          case 'today':
            return orderDate.getTime() === today.getTime();
          case 'week':
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return orderDate >= weekAgo;
          case 'month':
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return orderDate >= monthAgo;
          case 'custom':
            const customStart = new Date(customDateRange.start);
            customStart.setHours(0, 0, 0, 0);
            const customEnd = new Date(customDateRange.end);
            customEnd.setHours(23, 59, 59, 999);
            return orderDate >= customStart && orderDate <= customEnd;
          default:
            return true;
        }
      });
    }

    // Sort by date (newest first)
    return filtered.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date || 0);
      const dateB = new Date(b.createdAt || b.date || 0);
      return dateB - dateA;
    });
  }, [allOrders, searchTerm, filterPaymentMethod, filterDateRange, customDateRange]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }
    return pages;
  };

  // Calculate stats
  const totalSales = filteredOrders.reduce((sum, order) => {
    return sum + (Number(order.totalAmount) || Number(order.total) || 0);
  }, 0);

  const cashSales = filteredOrders
    .filter(order => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return order.splitPaymentDetails.cashAmount > 0;
      }
      return method === 'cash';
    })
    .reduce((sum, order) => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return sum + (order.splitPaymentDetails.cashAmount || 0);
      }
      return sum + (Number(order.totalAmount) || Number(order.total) || 0);
    }, 0);

  const onlineSales = filteredOrders
    .filter(order => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return order.splitPaymentDetails.onlineAmount > 0;
      }
      return method === 'card' || method === 'upi' || method === 'online';
    })
    .reduce((sum, order) => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return sum + (order.splitPaymentDetails.onlineAmount || 0);
      }
      return sum + (Number(order.totalAmount) || Number(order.total) || 0);
    }, 0);

  const dueSales = filteredOrders
    .filter(order => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return order.splitPaymentDetails.dueAmount > 0;
      }
      return method === 'due' || method === 'credit';
    })
    .reduce((sum, order) => {
      const method = (order.paymentMethod || '').toLowerCase();
      if (method === 'split' && order.splitPaymentDetails) {
        return sum + (order.splitPaymentDetails.dueAmount || 0);
      }
      return sum + (Number(order.totalAmount) || Number(order.total) || 0);
    }, 0);

  // Export functions
  const exportToCSV = () => {
    const headers = ['Customer Name', 'Customer Mobile', 'Payment Method', 'Total Amount', 'Date'];
    const rows = filteredOrders.map(order => [
      order.customerName || '',
      order.customerMobile || '',
      getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails) || '',
      (Number(order.totalAmount) || Number(order.total) || 0).toFixed(2),
      formatDate(order.createdAt || order.date)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-orders-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportToJSON = () => {
    const dataStr = JSON.stringify(filteredOrders, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-orders-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF('l', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      /* ================= CONFIG ================= */
      const margin = 15;
      const formatCurrency = (v) => `Rs. ${(Number(v) || 0).toFixed(2)}`;
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
      doc.setFillColor(...COLORS.white);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');

      // Bottom accent line
      doc.setDrawColor(...COLORS.primary);
      doc.setLineWidth(1.5);
      doc.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

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

          doc.addImage(base64, 'PNG', logoX, logoY, w, h);
        }
      } catch (e) {
        // fail silently
      }

      /* -------- APP NAME -------- */
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(...COLORS.primary);
      doc.text('Drag & Drop', logoX + 22, 15);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      doc.text('Sales Orders Management', logoX + 22, 19);

      /* -------- RIGHT META -------- */
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      doc.text('Sales Orders Report', pageWidth - margin, 14, { align: 'right' });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);

      let periodText = `Generated: ${formatDate(new Date())}`;

      if (filterDateRange === 'today') {
        periodText = `Period: Today`;
      } else if (filterDateRange === 'week') {
        periodText = `Period: Last 7 Days`;
      } else if (filterDateRange === 'month') {
        periodText = `Period: Last 30 Days`;
      } else if (filterDateRange === 'custom' && customDateRange.start && customDateRange.end) {
        periodText = `Period: ${formatDate(customDateRange.start)} - ${formatDate(customDateRange.end)}`;
      }

      doc.text(periodText, pageWidth - margin, 19, { align: 'right' });

      /* ================= SUMMARY CARDS ================= */
      const startY = headerHeight + 10;
      const cardW = (pageWidth - margin * 2 - 12) / 4;
      const cardH = 22;

      const totalValue = filteredOrders.reduce((acc, curr) => acc + (Number(curr.totalAmount) || Number(curr.total) || 0), 0);
      const paidValue = filteredOrders.reduce((acc, curr) => {
        const method = (curr.paymentMethod || '').toLowerCase();
        if (method === 'split' && curr.splitPaymentDetails) {
          return acc + (curr.splitPaymentDetails.cashAmount || 0) + (curr.splitPaymentDetails.onlineAmount || 0);
        }
        if (method === 'cash' || method === 'card' || method === 'upi' || method === 'online') {
          return acc + (Number(curr.totalAmount) || Number(curr.total) || 0);
        }
        return acc;
      }, 0);
      const dueValue = filteredOrders.reduce((acc, curr) => {
        const method = (curr.paymentMethod || '').toLowerCase();
        if (method === 'split' && curr.splitPaymentDetails) {
          return acc + (curr.splitPaymentDetails.dueAmount || 0);
        }
        if (method === 'due' || method === 'credit') {
          return acc + (Number(curr.totalAmount) || Number(curr.total) || 0);
        }
        return acc;
      }, 0);

      const metrics = [
        { label: 'Total Sales', value: formatCurrency(totalValue) },
        { label: 'Received', value: formatCurrency(paidValue) },
        { label: 'Due', value: formatCurrency(dueValue) },
        { label: 'Total Orders', value: filteredOrders.length.toString() }
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 4);

        // Card shadow
        doc.setFillColor(235, 236, 240);
        doc.rect(x + 1, startY + 1, cardW, cardH, 'F');

        // Card body
        doc.setFillColor(...COLORS.white);
        doc.rect(x, startY, cardW, cardH, 'F');

        doc.setFontSize(9);
        doc.setTextColor(...COLORS.gray);
        doc.text(m.label.toUpperCase(), x + 4, startY + 7);

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.primary);
        doc.text(String(m.value), x + 4, startY + 16);
      });

      /* ================= TABLE TITLE ================= */
      let y = startY + cardH + 14;

      doc.setDrawColor(...COLORS.border);
      doc.line(margin, y, pageWidth - margin, y);

      y += 8;
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.primary);
      doc.text('Order Details', margin, y);

      /* ================= TABLE ================= */
      const headers = ['Order ID', 'Date', 'Customer', 'Items', 'Amount', 'Payment', 'Status'];

      // Landscape A4 width = 297mm. Margins = 15mm * 2 = 30mm. Content Width = 267mm.
      // We will distribute the width proportionally.
      const contentWidth = pageWidth - (margin * 2);

      const colWeights = [15, 13, 22, 8, 15, 14, 13]; // Sum = 100
      const colW_adjusted = colWeights.map(w => (contentWidth * w) / 100);

      y += 6;

      // Header row
      doc.setFillColor(...COLORS.lightBg);
      doc.rect(margin, y, contentWidth, 9, 'F');

      doc.setFontSize(11);
      doc.setTextColor(...COLORS.primary);

      headers.forEach((h, i) => {
        const x = margin + colW_adjusted.slice(0, i).reduce((a, b) => a + b, 0);
        // Center alignment
        doc.text(h, x + colW_adjusted[i] / 2, y + 6, { align: 'center' });
      });

      y += 9;
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.black);

      filteredOrders.forEach((order, index) => {
        const rowH = 8;
        if (y + rowH > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }

        if (index % 2 === 1) {
          doc.setFillColor(...COLORS.lightBg);
          doc.rect(margin, y, contentWidth, rowH, 'F');
        }

        const row = [
          order.id ? order.id.toString().slice(-6) : '-',
          formatDate(order.createdAt || order.date),
          (order.customerName || 'Walk-in').substring(0, 15),
          (order.items || []).length.toString(),
          formatCurrency(order.totalAmount || 0),
          order.paymentMethod || 'Cash',
          order.status || 'Completed'
        ];

        row.forEach((val, j) => {
          const x = margin + colW_adjusted.slice(0, j).reduce((a, b) => a + b, 0);
          doc.text(String(val), x + colW_adjusted[j] / 2, y + 5.5, { align: 'center' });
        });

        y += rowH;
      });


      /* ================= FOOTER ================= */
      const pageCount = doc.internal.getNumberOfPages();

      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.text(`Page ${i} of ${pageCount} `, margin, pageHeight - 10);
        doc.text(
          state.currentUser?.shopName || 'Store',
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      doc.save(`sales - orders - ${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast('Sales Report exported as PDF.', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  const handleViewOrder = (order) => {
    setSelectedOrder(order);
    setShowOrderDetails(true);
  };

  const getPaymentMethodBadgeClass = (method) => {
    const m = (method || '').toLowerCase();
    if (m === 'cash') return 'bg-green-50 text-green-700';
    if (m === 'card' || m === 'upi' || m === 'online') return 'bg-blue-50 text-blue-700';
    if (m === 'due' || m === 'credit') return 'bg-red-50 text-red-700';
    return 'bg-gray-50 text-gray-700';
  };

  const getPaymentMethodLabel = (method, splitDetails) => {
    const m = (method || '').toLowerCase();
    if (m === 'split' && splitDetails) {
      const parts = [];
      if (splitDetails.cashAmount > 0) parts.push(`Cash: ₹${splitDetails.cashAmount.toFixed(2)} `);
      if (splitDetails.onlineAmount > 0) parts.push(`Online: ₹${splitDetails.onlineAmount.toFixed(2)} `);
      if (splitDetails.dueAmount > 0) parts.push(`Due: ₹${splitDetails.dueAmount.toFixed(2)} `);
      return `Split(${parts.join(', ')})`;
    }
    if (m === 'cash') return 'Cash';
    if (m === 'card') return 'Card';
    if (m === 'upi') return 'UPI';
    if (m === 'online') return 'Online';
    if (m === 'due' || m === 'credit') return 'Due/Credit';
    return method || 'N/A';
  };

  const buildWhatsAppInvoiceMessage = (order) => {
    if (!order) return '';

    const withNull = (value) =>
      value === null || value === undefined || value === '' ? 'null' : value;

    const storeName = withNull(
      state.storeName || state.currentUser?.shopName || state.currentUser?.username || 'Store'
    );
    const storeAddress = withNull(state.currentUser?.shopAddress || '');
    const storePhoneRaw =
      state.currentUser?.phoneNumber ||
      state.currentUser?.mobileNumber ||
      state.currentUser?.phone ||
      state.currentUser?.contact ||
      '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+ 91 ${storePhoneSanitized} `
      : withNull(storePhoneRaw);

    const invoiceDateObj = new Date(order.createdAt || order.date || Date.now());
    const invoiceDate = Number.isNaN(invoiceDateObj.getTime())
      ? 'null'
      : formatDate(invoiceDateObj);

    const customerName = withNull(order.customerName || 'Customer');
    const customerMobileSanitized = sanitizeMobileNumber(order.customerMobile || '');
    const customerPhoneDisplay = customerMobileSanitized
      ? `+ 91 ${customerMobileSanitized} `
      : 'null';

    const toNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const subtotalRaw = toNumber(order.subtotal ?? order.subTotal ?? order.totalAmount ?? order.total ?? 0, 0);
    const discountRaw = toNumber(order.discountAmount ?? order.discount ?? 0, 0);
    const taxAmountRaw = toNumber(order.taxAmount ?? order.tax ?? 0, 0);
    const totalRaw = toNumber(order.totalAmount ?? order.total ?? subtotalRaw, 0);

    const taxPercentSource = order.taxPercent ?? order.taxRate;
    const taxPercentRaw =
      taxPercentSource !== undefined && taxPercentSource !== null
        ? Number(taxPercentSource)
        : subtotalRaw > 0
          ? (taxAmountRaw / subtotalRaw) * 100
          : null;

    const subtotalDisplay = Number.isFinite(subtotalRaw)
      ? `₹${subtotalRaw.toFixed(2)} `
      : '₹null';
    const discountDisplay = Number.isFinite(discountRaw)
      ? `₹${discountRaw.toFixed(2)} `
      : '₹null';
    const taxAmountDisplay = Number.isFinite(taxAmountRaw)
      ? `₹${taxAmountRaw.toFixed(2)} `
      : '₹null';
    const taxPercentDisplay = Number.isFinite(taxPercentRaw)
      ? `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `
      : 'null';
    const totalDisplay = Number.isFinite(totalRaw)
      ? `₹${totalRaw.toFixed(2)} `
      : '₹null';

    // Column widths optimized for WhatsApp display
    // WhatsApp may collapse spaces, so we use wider columns and ensure proper spacing
    const itemWidth = 30; // Wider for better readability on WhatsApp
    const quantityWidth = 10; // Wider for centering
    const rateWidth = 15; // Wider for currency values
    const amountWidth = 16; // Wider for large amounts
    const spacing = '  |  '; // Use pipe separator for better visual separation on WhatsApp
    const spacingLength = spacing.length;

    // Calculate total line width for consistency
    const totalLineWidth = itemWidth + spacingLength + quantityWidth + spacingLength + rateWidth + spacingLength + amountWidth;

    // Helper to ensure exact width (truncates or pads as needed)
    // This ensures every column cell is exactly its width - critical for alignment
    const ensureWidth = (text, width, align = 'left') => {
      const textStr = String(text || '');
      if (textStr.length > width) {
        return textStr.substring(0, width);
      }
      if (align === 'center') {
        const padding = Math.floor((width - textStr.length) / 2);
        return ' '.repeat(padding) + textStr + ' '.repeat(width - textStr.length - padding);
      } else if (align === 'right') {
        return textStr.padStart(width, ' ');
      } else {
        return textStr.padEnd(width, ' ');
      }
    };

    // Helper to center-align text within a column width (ensures exact width)
    const centerInColumn = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length >= width) {
        return textStr.substring(0, width);
      }
      const padding = Math.floor((width - textStr.length) / 2);
      const leftPad = ' '.repeat(padding);
      const rightPad = ' '.repeat(width - textStr.length - padding);
      return leftPad + textStr + rightPad;
    };

    // Helper to left-align and wrap text within a column width (ensures exact width)
    const leftAlignAndWrap = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length <= width) {
        return [ensureWidth(textStr, width)];
      }
      // Wrap text if it exceeds width
      const lines = [];
      let remaining = textStr;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          lines.push(ensureWidth(remaining, width));
          break;
        }
        // Try to break at word boundary
        let breakPoint = width;
        const spaceIndex = remaining.lastIndexOf(' ', width);
        if (spaceIndex > width * 0.5) {
          breakPoint = spaceIndex;
        }
        const line = remaining.substring(0, breakPoint);
        lines.push(ensureWidth(line, width));
        remaining = remaining.substring(breakPoint).trim();
      }
      return lines;
    };

    // Helper to center-align text within exact width
    // Optimized for WhatsApp - uses more padding for better visual centering
    const centerInWidth = (text, width) => {
      const textStr = String(text || '');
      if (textStr.length >= width) {
        return textStr.substring(0, width);
      }
      const totalPadding = width - textStr.length;
      const leftPadding = Math.floor(totalPadding / 2);
      const rightPadding = totalPadding - leftPadding;
      // Use multiple spaces for better visibility on WhatsApp
      const result = ' '.repeat(Math.max(1, leftPadding)) + textStr + ' '.repeat(Math.max(1, rightPadding));
      // Ensure result is exactly 'width' characters
      if (result.length > width) {
        return result.substring(0, width);
      }
      return result.padEnd(width, ' ');
    };

    // Helper to wrap text within a column width (ensures exact width for each line)
    // Each column wraps independently - no column affects another
    const wrapColumn = (text, width, align = 'left') => {
      const textStr = String(text || '');
      if (textStr.length <= width) {
        if (align === 'center') {
          return [centerInWidth(textStr, width)];
        } else if (align === 'right') {
          return [textStr.padStart(width, ' ')];
        } else {
          return [textStr.padEnd(width, ' ')];
        }
      }
      // Wrap text if it exceeds width - each line is exactly 'width' characters
      const lines = [];
      let remaining = textStr;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          if (align === 'center') {
            lines.push(centerInWidth(remaining, width));
          } else if (align === 'right') {
            lines.push(remaining.padStart(width, ' '));
          } else {
            lines.push(remaining.padEnd(width, ' '));
          }
          break;
        }
        // Break at exact width for numbers, try word boundary for text
        let breakPoint = width;
        if (align === 'left' && remaining.includes(' ')) {
          const spaceIndex = remaining.lastIndexOf(' ', width);
          if (spaceIndex > width * 0.5) {
            breakPoint = spaceIndex;
          }
        }
        const line = remaining.substring(0, breakPoint);
        // Ensure each line is exactly 'width' characters
        if (align === 'center') {
          lines.push(centerInWidth(line, width));
        } else if (align === 'right') {
          lines.push(line.padStart(width, ' '));
        } else {
          lines.push(line.padEnd(width, ' '));
        }
        remaining = remaining.substring(breakPoint).trim();
      }
      return lines;
    };

    // Helper to format and wrap numbers (always center-aligned, can wrap if needed)
    // Returns array of lines, each exactly 'width' characters, perfectly centered
    const formatNumberColumn = (value, width, isCurrency = false) => {
      let text;
      if (Number.isFinite(value)) {
        if (isCurrency) {
          text = `₹${value.toFixed(2)} `;
        } else {
          text = value.toString();
        }
      } else {
        text = 'null';
      }
      // Wrap if needed and return array of lines - each line is exactly 'width' characters, centered
      return wrapColumn(text, width, 'center');
    };

    // Create a row with exact width - columns are completely independent
    // Optimized for WhatsApp display
    const createRow = (itemCol, qtyCol, rateCol, amountCol) => {
      // Each column is already exactly its width, spacing uses pipe for better visibility
      // Format: [Item]  |  [Qty]  |  [Rate]  |  [Amount]
      const row = `${itemCol}${spacing}${qtyCol}${spacing}${rateCol}${spacing}${amountCol} `;
      // Ensure row maintains exact width for alignment
      if (row.length !== totalLineWidth) {

      }
      return ensureWidth(row, totalLineWidth);
    };

    // No longer using table format - items are displayed as bullet points

    // Create empty column cells (exact width) - used when other columns wrap
    const createEmptyCol = (width) => {
      // Empty column is just spaces - exactly 'width' characters
      return ' '.repeat(width);
    };

    const orderItems = order.items || [];

    // Format items as bullet points instead of table
    const formatItemAsPoint = (item, index) => {
      const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
      const name = item.name || item.productName || `Item ${index + 1} `;

      // Format: • Item Name - Qty x Rate = Amount
      const qtyText = qty.toString();
      const rateText = `₹${rate.toFixed(2)} `;
      const totalText = `₹${total.toFixed(2)} `;

      let itemLine = `• ${name} `;
      if (qty > 0) {
        itemLine += ` - ${qtyText}${unit ? ` ${unit}` : ''} x ${rateText} = ${totalText} `;
      } else {
        itemLine += ` - ${totalText} `;
      }

      return itemLine;
    };

    // Create items section as bullet points
    let itemsSection;
    if (orderItems.length > 0) {
      const itemPoints = orderItems.map((item, index) => formatItemAsPoint(item, index));
      itemsSection = itemPoints.join('\n');
    } else {
      itemsSection = '• No items';
    }

    const paymentModeLabel = withNull(getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails));

    const divider = '--------------------------------';

    const lines = [
      '             INVOICE',
      '',
      divider,
      `Shop Name: ${storeName} `,
      `Address: ${storeAddress} `,
      `Phone: ${storePhoneDisplay} `,
      `Date: ${invoiceDate} `,
      divider,
      `Customer Name: ${customerName} `,
      `Customer Phone: ${customerPhoneDisplay} `,
      divider,
      'Items:',
      '',
      itemsSection,
      divider,
      `Subtotal: ${subtotalDisplay} `,
      `Discount: ${discountDisplay} `,
      `Tax(${taxPercentDisplay})     : ${taxAmountDisplay} `,
      divider,
      `Grand Total: ${totalDisplay} `,
      `Payment Mode: ${paymentModeLabel} `,
      'Thank you for shopping with us!',
      divider,
      '       Powered by Drag & Drop',
      divider
    ];

    return lines.join('\n');
  };

  const handleShareInvoice = (order) => {
    if (!order) return;

    const customerMobile = sanitizeMobileNumber(order.customerMobile || '');

    if (!customerMobile) {
      if (window.showToast) {
        window.showToast('No customer mobile number found for this invoice.', 'warning');
      }
      return;
    }

    const message = buildWhatsAppInvoiceMessage(order);
    if (!message) {
      if (window.showToast) {
        window.showToast('Unable to prepare invoice details for sharing.', 'error');
      }
      return;
    }

    const targetNumber = customerMobile.length === 10 ? `91${customerMobile} ` : customerMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Sales Order History</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">View and manage all your sales orders</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(true)}
              className="btn-secondary flex items-center gap-2 text-sm px-3 sm:px-4 py-2 touch-manipulation dark:text-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Export Orders</h3>
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
                        exportToCSV();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as CSV</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Spreadsheet format (Excel, Numbers)</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportToJSON();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                        <FileJson className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as JSON</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Raw data format for backup</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportToPDF();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as PDF</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Printable document format</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Search */}
          <div>
            <label htmlFor="order-search" className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
              Search Orders
            </label>
            <input
              id="order-search"
              type="text"
              placeholder="Search by customer name or mobile..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="input-field w-full text-sm sm:text-base"
            />
          </div>

          {/* Filter Pills Row */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            {/* Payment Method Filter */}
            <div className="flex-1 flex flex-col">
              <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Payment Method</label>
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm w-full h-[44px] sm:h-[42px]">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'cash', label: 'Cash' },
                  { value: 'online', label: 'Online' },
                  { value: 'due', label: 'Due/Credit' }
                ].map((option) => {
                  const isActive = filterPaymentMethod === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setFilterPaymentMethod(option.value);
                        setCurrentPage(1);
                      }}
                      className={`px-2 sm:px-3 py-2 sm:py-1.5 text-xs font-medium rounded-full transition flex-1 h-full flex items-center justify-center touch-manipulation ${isActive
                        ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                        : 'text-slate-600 active:bg-gray-100'
                        }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="flex-1 flex flex-col">
              <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">Date Range</label>
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm w-full h-[44px] sm:h-[42px]">
                {[
                  { value: 'all', label: 'All Time' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: 'Last 7 Days' },
                  { value: 'custom', label: 'Custom' }
                ].map((option) => {
                  const isActive = filterDateRange === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (option.value === 'custom') {
                          setTempCustomRange({ ...customDateRange });
                          setShowCustomDateModal(true);
                        } else {
                          setFilterDateRange(option.value);
                          setCurrentPage(1);
                        }
                      }}
                      className={`px-2 sm:px-3 py-2 sm:py-1.5 text-xs font-medium rounded-full transition flex-1 h-full flex items-center justify-center touch-manipulation ${isActive
                        ? 'bg-gradient-to-r from-[#2f3c7e] to-[#18224f] text-white shadow'
                        : 'text-slate-600 active:bg-gray-100'
                        }`}
                    >
                      <span className="hidden sm:inline">{option.label}</span>
                      <span className="sm:hidden">{option.value === 'all' ? 'All' : option.value === 'today' ? 'Today' : option.value === 'week' ? '7 Days' : 'Custom'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 pr-12">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 truncate">Total Orders</p>
              <p className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white leading-none overflow-visible" title={filteredOrders.length}>
                {filteredOrders.length}
              </p>
            </div>
            <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center">
                <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 pr-12">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 truncate">Total Sales</p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 leading-snug whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(totalSales)}>
                {formatCurrencySmart(totalSales, state.currencyFormat)}
              </p>
            </div>
            <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-50 dark:bg-green-900/30 rounded-2xl flex items-center justify-center">
                <IndianRupee className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 pr-12">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 truncate">Cash Sales</p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 leading-snug whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(cashSales)}>
                {formatCurrencySmart(cashSales, state.currencyFormat)}
              </p>
            </div>
            <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
                <IndianRupee className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 pr-12">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 truncate">Online Sales</p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 leading-snug whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(onlineSales)}>
                {formatCurrencySmart(onlineSales, state.currencyFormat)}
              </p>
            </div>
            <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-50 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
                <IndianRupee className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Orders Table - Desktop View */}
      <div className="card hidden lg:block bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Customer</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Mobile</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Payment Method</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {paginatedOrders.length > 0 ? (
                paginatedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                      {order.customerName || 'Walk-in Customer'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-center">
                      {order.customerMobile || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPaymentMethodBadgeClass(order.paymentMethod)}`}>
                        {order.paymentMethod || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-emerald-600 text-center">
                      {formatCurrency(order.totalAmount || order.total)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-slate-300 text-center">
                      {formatDateTime(order.createdAt || order.date)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewOrder(order)}
                          className="p-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {order.customerMobile && (
                          <button
                            onClick={() => handleShareInvoice(order)}
                            className="p-2 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                            title="Share Invoice on WhatsApp"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center">
                    <Receipt className="h-12 w-12 text-gray-400 dark:text-slate-600 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-slate-400">No orders found</p>
                    {searchTerm || filterPaymentMethod !== 'all' || filterDateRange !== 'all' ? (
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-2">Try adjusting your filters</p>
                    ) : null}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Orders Cards - Mobile/Tablet View */}
      <div className="lg:hidden space-y-3">
        {paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => (
            <div key={order.id} className="card p-4 hover:shadow-md transition-shadow bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                    {order.customerName || 'Walk-in Customer'}
                  </h3>
                  {order.customerMobile && (
                    <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{order.customerMobile}</p>
                  )}
                </div>
                <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleViewOrder(order)}
                    className="p-2.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors touch-manipulation"
                    title="View Details"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                  {order.customerMobile && (
                    <button
                      onClick={() => handleShareInvoice(order)}
                      className="p-2.5 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors touch-manipulation"
                      title="Share Invoice on WhatsApp"
                    >
                      <Share2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">Amount</p>
                  <p className="text-xl font-black text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(order.totalAmount || order.total)}>
                    {formatCurrencySmart(order.totalAmount || order.total, state.currencyFormat)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1 truncate">Payment</p>
                  <div className="truncate">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${getPaymentMethodBadgeClass(order.paymentMethod)}`}>
                      {getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails) || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-widest">{formatDateTime(order.createdAt || order.date)}</p>
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">#{order.id.slice(-6).toUpperCase()}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="card p-12 text-center">
            <Receipt className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-base">No orders found</p>
            {searchTerm || filterPaymentMethod !== 'all' || filterDateRange !== 'all' ? (
              <p className="text-sm text-gray-500 mt-2">Try adjusting your filters</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 mt-4 sm:mt-6 px-3 sm:px-4 py-3 sm:py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="text-xs sm:text-sm text-gray-700 dark:text-slate-300 text-center sm:text-left">
            Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
            <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of{' '}
            <span className="font-semibold">{filteredOrders.length}</span> orders
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            {getPageNumbers().map((page, index) => (
              <React.Fragment key={index}>
                {page === 'ellipsis' ? (
                  <span className="px-1 sm:px-2 text-gray-500 dark:text-slate-500 text-xs sm:text-sm">...</span>
                ) : (
                  <button
                    onClick={() => handlePageChange(page)}
                    className={`px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors touch-manipulation ${currentPage === page
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 active:bg-gray-50 dark:active:bg-slate-600'
                      }`}
                  >
                    {page}
                  </button>
                )}
              </React.Fragment>
            ))}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 sm:p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg active:bg-gray-50 dark:active:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {showOrderDetails && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Order Details</h2>
              <button
                onClick={() => {
                  setShowOrderDetails(false);
                  setSelectedOrder(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 active:bg-gray-100 dark:active:bg-slate-700 rounded-lg transition-colors touch-manipulation"
                aria-label="Close"
              >
                <X className="h-5 w-5 sm:h-5 sm:w-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 sm:p-6">
              <div className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Date</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{formatDateTime(selectedOrder.createdAt || selectedOrder.date)}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Name</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{selectedOrder.customerName || 'Walk-in Customer'}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Customer Mobile</p>
                    <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words">{selectedOrder.customerMobile || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Payment Method</p>
                    <span className={`inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium ${getPaymentMethodBadgeClass(selectedOrder.paymentMethod)}`}>
                      {getPaymentMethodLabel(selectedOrder.paymentMethod, selectedOrder.splitPaymentDetails) || 'N/A'}
                    </span>
                  </div>
                  {(() => {
                    const paymentMethod = (selectedOrder.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = selectedOrder.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="sm:col-span-2">
                          <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-2">Split Payment Breakdown</p>
                          <div className="grid grid-cols-3 gap-2 sm:gap-3">
                            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-2.5 sm:p-3">
                              <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">Cash</p>
                              <p className="text-base sm:text-lg font-bold text-green-900 dark:text-green-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(cashAmount)}>
                                {formatCurrencySmart(cashAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 sm:p-3">
                              <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">Online</p>
                              <p className="text-base sm:text-lg font-bold text-blue-900 dark:text-blue-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(onlineAmount)}>
                                {formatCurrencySmart(onlineAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-2.5 sm:p-3">
                              <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-1">Due</p>
                              <p className="text-base sm:text-lg font-bold text-red-900 dark:text-red-100 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(dueAmount)}>
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
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-1">Total Amount</p>
                    <p className="text-xl sm:text-2xl font-bold text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(selectedOrder.totalAmount || selectedOrder.total)}>
                      {formatCurrencySmart(selectedOrder.totalAmount || selectedOrder.total, state.currencyFormat)}
                    </p>
                  </div>
                </div>

                {selectedOrder.items && selectedOrder.items.length > 0 && (
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 sm:mb-4">Order Items</h3>
                    {/* Desktop Table View */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-700/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Product</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Quantity</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Price</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">Total</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                          {selectedOrder.items.map((item, index) => {
                            const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                            return (
                              <tr key={index}>
                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{item.name || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-right">
                                  {qty} {unit}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300 text-right">
                                  {formatCurrency(rate)}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right">
                                  {formatCurrency(total)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile Card View */}
                    <div className="sm:hidden space-y-3">
                      {selectedOrder.items.map((item, index) => {
                        const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                        return (
                          <div key={index} className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                            <div className="flex items-start justify-between mb-2">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white flex-1 pr-2">{item.name || 'N/A'}</p>
                              <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(total)}</p>
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-400">
                              <span>{qty} {unit}</span>
                              <span>@ {formatCurrency(rate)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Custom Date Modal */}
      {showCustomDateModal && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-slideUp">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-indigo-600" />
                Custom Range
              </h3>
              <button
                onClick={() => setShowCustomDateModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Start Date</label>
                <input
                  type="date"
                  value={tempCustomRange.start}
                  onChange={e => setTempCustomRange({ ...tempCustomRange, start: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">End Date</label>
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
                    setFilterDateRange('custom');
                    setShowCustomDateModal(false);
                    setCurrentPage(1);
                  }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg"
                >
                  Apply Range
                </button>
                <button
                  onClick={() => setShowCustomDateModal(false)}
                  className="w-full py-3 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesOrderHistory;
