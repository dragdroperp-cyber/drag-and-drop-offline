import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp, ActionTypes, isPlanExpired } from '../../context/AppContext';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import {
  Plus,
  Download,
  Edit,
  Trash2,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
  Eye,
  FileText,
  FileSpreadsheet,
  FileJson,
  X,
  AlertTriangle,
  Phone,
  MessageCircle,
  Search,
  Filter,
  ChevronDown,
} from 'lucide-react';
import jsPDF from 'jspdf';
import AddCustomerModal from './AddCustomerModal';
import EditCustomerModal from './EditCustomerModal';
import PaymentModal from './PaymentModal';
import OrderHistoryModal from './OrderHistoryModal';
import WhatsAppBillModal from './WhatsAppBillModal';
import HistorySelectionModal from './HistorySelectionModal';
import TransactionHistoryModal from './TransactionHistoryModal';
import { getPlanLimits, canAddCustomer, getDistributedPlanLimits, getRemainingCapacity, isUnlimited } from '../../utils/planUtils';
import { sanitizeMobileNumber } from '../../utils/validation';

import { getAllItems, addItem, STORES } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import syncService from '../../services/syncService';

const Customers = () => {
  const { state, dispatch } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'due', 'credit', 'settled'

  // Load additional data if not already loaded (for slow connections)
  useEffect(() => {
    if (state.dataFreshness === 'partial' && window.loadAdditionalData) {
      window.loadAdditionalData();
    }
  }, [state.dataFreshness]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [orderHistoryCustomer, setOrderHistoryCustomer] = useState(null);
  const [showHistorySelection, setShowHistorySelection] = useState(false);
  const [showTransactionHistoryModal, setShowTransactionHistoryModal] = useState(false);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState(null);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsAppCustomer, setWhatsAppCustomer] = useState(null);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    const refreshOrdersFromIndexedDB = async () => {
      try {
        const indexedDBOrders = await getAllItems(STORES.orders).catch(() => []);
        if (!isActive) return;

        const normalizedOrders = (indexedDBOrders || []).filter(order => order && order.isDeleted !== true);
        const currentOrders = (state.orders || []).filter(order => order && order.isDeleted !== true);

        if (normalizedOrders.length !== currentOrders.length) {
          dispatch({
            type: ActionTypes.SET_ORDERS,
            payload: normalizedOrders
          });
          return;
        }

        const currentOrdersMap = new Map(
          currentOrders.map(order => {
            const key = (order.id || order._id || order.createdAt || '').toString();
            return [key, order];
          })
        );

        let hasDifference = false;

        for (const incoming of normalizedOrders) {
          const key = (incoming.id || incoming._id || incoming.createdAt || '').toString();
          const existing = currentOrdersMap.get(key);
          if (!existing) {
            hasDifference = true;
            break;
          }

          const fieldsToCompare = [
            'totalAmount',
            'subtotal',
            'discountPercent',
            'taxPercent',
            'updatedAt',
            'isSynced'
          ];

          const mismatch = fieldsToCompare.some(field => {
            const incomingValue = incoming[field] ?? null;
            const existingValue = existing[field] ?? null;
            return JSON.stringify(incomingValue) !== JSON.stringify(existingValue);
          });

          if (mismatch) {
            hasDifference = true;
            break;
          }
        }

        if (hasDifference) {
          dispatch({
            type: ActionTypes.SET_ORDERS,
            payload: normalizedOrders
          });
        }
      } catch (error) {

      }
    };

    refreshOrdersFromIndexedDB();

    const handleFocus = () => refreshOrdersFromIndexedDB();
    window.addEventListener('focus', handleFocus);

    return () => {
      isActive = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [dispatch, state.orders]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut: Shift + N to open add customer modal
  useKeyboardShortcut('n', false, true, () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredAddCustomer', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    setShowAddModal(true);
  });

  // Responsive pagination: 10 for mobile, 25 for desktop
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    const updateItemsPerPage = () => {
      if (window.innerWidth >= 1025) {
        // Desktop (1025px and above)
        setItemsPerPage(25);
      } else {
        // Mobile/Tablet (below 1025px)
        setItemsPerPage(10);
      }
    };

    updateItemsPerPage();
    window.addEventListener('resize', updateItemsPerPage);
    return () => window.removeEventListener('resize', updateItemsPerPage);
  }, []);

  const activeCustomers = useMemo(() => {
    return state.customers
      .filter(customer => !customer.isDeleted)
      .sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA;
      });
  }, [state.customers]);

  // Plan limits (exclude walk-in customer from usage calculations)
  const { maxCustomers } = getDistributedPlanLimits(state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);
  const totalCustomers = activeCustomers.length;
  const remainingCustomers = getRemainingCapacity(activeCustomers.length, state.aggregatedUsage, 'customers', state.currentPlan, state.currentPlanDetails);
  const atCustomerLimit = remainingCustomers <= 0 && !isUnlimited(maxCustomers);
  const customerLimitLabel = isUnlimited(maxCustomers) ? getTranslation('unlimited', state.currentLanguage) : maxCustomers;

  const planNameLabel = state.currentPlanDetails?.planName
    || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : getTranslation('settings', state.currentLanguage));

  const showPlanUpgradeWarning = () => {
    const limitMessage = `You've reached the customer limit (${customerLimitLabel}) for the ${planNameLabel} plan. Upgrade now to unlock more customer slots instantly.`;
    setPlanLimitMessage(limitMessage);
    if (window.showToast) {
      window.showToast(limitMessage, 'warning', 5000);
    }
  };

  // Filter customers based on search term and filter status
  const filteredCustomers = activeCustomers.filter(customer => {
    const mobileNumber = customer.mobileNumber || customer.phone || ''; // Backward compatibility
    const matchesSearch = (
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mobileNumber.includes(searchTerm) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const rawBalance = customer.balanceDue ?? customer.dueAmount ?? 0;
    const balance = parseFloat(rawBalance) || 0;

    let matchesFilter = true;
    if (filterStatus === 'due') {
      matchesFilter = balance > 0;
    } else if (filterStatus === 'credit') {
      matchesFilter = balance < 0;
    } else if (filterStatus === 'settled') {
      matchesFilter = balance === 0;
    }

    return matchesSearch && matchesFilter;
  });

  // Pagination
  const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when search changes or filter changes or itemsPerPage changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, itemsPerPage]);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total pages is less than max visible
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show pages with ellipsis
      if (currentPage <= 3) {
        // Show first pages
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Show last pages
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show middle pages
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

  const handleAddCustomer = (customerData) => {
    const normalizedName = (customerData.name || '').trim().toLowerCase();
    if (normalizedName === 'walk-in customer') {
      if (window.showToast) {
        window.showToast(getTranslation('walkInCustomerExists', state.currentLanguage), 'info');
      }
      setShowAddModal(false);
      return false;
    }

    if (atCustomerLimit) {
      showPlanUpgradeWarning();
      return false;
    }

    const newCustomer = {
      id: Date.now().toString(),
      ...customerData,
      createdAt: new Date().toISOString()
    };
    dispatch({ type: 'ADD_CUSTOMER', payload: newCustomer });
    setShowAddModal(false);
    setPlanLimitMessage('');
    return true;
  };

  const handleOpenAddModal = () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredAddCustomer', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    if (atCustomerLimit) {
      showPlanUpgradeWarning();
      return;
    }
    setPlanLimitMessage('');
    setShowAddModal(true);
  };

  const handleEditCustomer = (customerData) => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredEditCustomer', state.currentLanguage), 'warning', 8000);
      }
      return;
    }

    // Check for balance change and create transaction
    const oldCustomer = state.customers.find(c =>
      (c.id && c.id === customerData.id) ||
      (c._id && c._id === customerData.id) ||
      (customerData._id && c._id === customerData._id) ||
      (customerData.localId && customerData.localId === c.id)
    );

    if (oldCustomer) {
      const oldDue = parseFloat(oldCustomer.dueAmount || oldCustomer.balanceDue || 0);
      const newDue = parseFloat(customerData.dueAmount || customerData.balanceDue || 0);
      const diff = newDue - oldDue;

      console.log('📝 CUSTOMER EDIT: Checking for balance change', {
        customerId: customerData.id,
        oldDue,
        newDue,
        diff
      });

      if (Math.abs(diff) > 0.01) {
        const transaction = {
          id: Date.now().toString(),
          localId: Date.now().toString(),
          sellerId: customerData.sellerId || oldCustomer.sellerId,
          customerId: customerData._id || customerData.id,
          type: diff > 0 ? 'due' : 'payment',
          amount: Math.abs(diff),
          date: new Date().toISOString(),
          description: diff > 0 ? 'Manual Balance Increase' : 'Manual Balance Decrease',
          isSynced: false,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
        };

        console.log('📝 CUSTOMER EDIT: Balance changed, creating transaction', transaction);

        dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });

        // Mark customer as unsynced if balance changed
        customerData.isSynced = false;
        customerData.syncedAt = undefined;
      }
    } else {
      console.warn('📝 CUSTOMER EDIT: Could not find old customer for comparison', { customerId: customerData.id });
    }

    dispatch({ type: 'UPDATE_CUSTOMER', payload: customerData });
    // Close modal immediately - success message will show from the action
    setShowEditModal(false);
    setSelectedCustomer(null);
  };

  const handleDeleteCustomer = (customerId) => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredDeleteCustomer', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    // Find the customer to check balance due
    const customer = state.customers.find(c => c.id === customerId);

    if (customer && (customer.isWalkIn || (customer.name || '').trim().toLowerCase() === 'walk-in customer')) {
      if (window.showToast) {
        window.showToast(getTranslation('walkInDeleteError', state.currentLanguage), 'warning');
      }
      return;
    }

    // Prevent deletion if customer has outstanding balance
    if (customer && (customer.balanceDue || 0) !== 0) {
      const balanceDue = Math.abs(customer.balanceDue || 0);
      if (window.showToast) {
        window.showToast(
          getTranslation('outstandingBalanceDeleteError', state.currentLanguage).replace('{amount}', balanceDue.toFixed(2)),
          'error'
        );
      }
      return;
    }

    // Show delete confirmation modal
    setCustomerToDelete(customer);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteCustomer = () => {
    if (customerToDelete) {
      dispatch({ type: 'DELETE_CUSTOMER', payload: customerToDelete.id });
      if (window.showToast) {
        window.showToast(getTranslation('customerDeleted', state.currentLanguage), 'success');
      }
    }
    setShowDeleteConfirm(false);
    setCustomerToDelete(null);
  };

  const handlePayment = (customer) => {
    setSelectedCustomer(customer);
    setShowPaymentModal(true);
  };

  const handleViewOrderHistory = (customer) => {
    setOrderHistoryCustomer(customer);
    setShowOrderHistoryModal(true);
  };

  const handlePaymentSubmit = async (amount, paymentType = 'receive', description = '') => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredPayment', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    if (!selectedCustomer || amount <= 0) {
      return;
    }

    console.log('💰 CUSTOMER PAYMENT: Starting payment process', {
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      amount,
      paymentType
    });

    const currentBalanceRaw = selectedCustomer.dueAmount ?? selectedCustomer.balanceDue ?? 0;
    const currentBalance = parseFloat(currentBalanceRaw) || 0;
    const paymentAmount = parseFloat(amount) || 0;

    // Calculate new balance based on payment type
    // 'receive' = customer pays you (reduces balance)
    // 'give' = you pay/refund customer (increases balance)
    const newBalance = paymentType === 'receive'
      ? parseFloat((currentBalance - paymentAmount).toFixed(2))
      : parseFloat((currentBalance + paymentAmount).toFixed(2));

    const updatedCustomer = {
      ...selectedCustomer,
      dueAmount: newBalance,
      balanceDue: newBalance,
      // Explicitly mark as NOT synced - this must happen before any API call
      isSynced: false,
      // Mark this as a payment update for special handling
      isPaymentUpdate: true,
      // Clear any previous sync data
      syncedAt: undefined,
      syncError: undefined
    };

    console.log('💰 CUSTOMER PAYMENT: Prepared updated customer data', {
      customerId: updatedCustomer.id,
      newBalance,
      isSynced: updatedCustomer.isSynced,
      hasSyncedAt: !!updatedCustomer.syncedAt
    });

    // Create Customer Transaction Record
    const transaction = {
      id: Date.now().toString(), // local ID
      localId: Date.now().toString(),
      sellerId: selectedCustomer.sellerId,
      customerId: selectedCustomer._id || selectedCustomer.id,
      type: paymentType === 'receive' ? 'payment' : 'add_due',
      amount: paymentAmount,
      date: new Date().toISOString(),
      description: description ? description : (paymentType === 'receive' ? 'Payment Received' : 'Amount Given/Refunded'),
      note: description,
      isSynced: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
    };

    // Create Customer Transaction Record and Update local state
    dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });
    dispatch({ type: 'UPDATE_CUSTOMER', payload: updatedCustomer });

    // Close modal immediately for better UX
    setShowPaymentModal(false);
    setSelectedCustomer(null);

    console.log('💰 CUSTOMER PAYMENT: Local state updated, now attempting API sync');

    // Step 2: Immediately attempt to sync with backend
    try {
      console.log('💰 CUSTOMER PAYMENT: Starting sync attempt');
      // Check if online first
      if (syncService.isOnline()) {
        console.log('💰 CUSTOMER PAYMENT: Online, scheduling sync');
        syncService.scheduleSync();
      } else {
        console.log('💰 CUSTOMER PAYMENT: Offline, customer marked as unsynced');
        if (window.showToast) {
          window.showToast(getTranslation('paymentSavedLocally', state.currentLanguage), 'warning');
        }
      }
    } catch (syncError) {
      console.error('💰 CUSTOMER PAYMENT: Sync scheduling failed', syncError);
      if (window.showToast) {
        window.showToast(getTranslation('paymentSavedLocally', state.currentLanguage), 'warning');
      }
    }

    // Step 3: Show payment confirmation message
    if (window.showToast) {
      const paymentTypeText = paymentType === 'receive' ? getTranslation('paymentReceived', state.currentLanguage) : getTranslation('paymentGiven', state.currentLanguage);

      if (newBalance < 0) {
        window.showToast(getTranslation('customerCreditBalance', state.currentLanguage).replace('{type}', paymentTypeText).replace('{amount}', Math.abs(newBalance).toFixed(2)), 'success');
      } else if (newBalance === 0) {
        window.showToast(getTranslation('balanceCleared', state.currentLanguage).replace('{type}', paymentTypeText), 'success');
      } else {
        window.showToast(getTranslation('remainingBalance', state.currentLanguage).replace('{type}', paymentTypeText).replace('{amount}', newBalance.toFixed(2)), 'success');
      }
    }
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportCustomersPDF = async () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4'); // Landscape for better fit, or 'p' if few columns
      // Using 'p' (Portrait) might be better for customers if columns are few, but standardizing to 'l' is safer or matching previous
      // Previous Customers was 'p'. But Reports is 'l'. The user asked for "like reports pdf".
      // Reports PDF is 'l' (landscape). I will switch to 'l' for headers to span nicely, 
      // or keep 'p' if columns are really few. 
      // Customers has only 4 columns: Name, Mobile, Email, Balance. 
      // 'p' is probably fine width-wise, but to match "theme and font like reports", 
      // the Reports PDF is landscape (297mm width).
      // I'll stick to 'l' to be safe and consistent with "Reports" style layout which assumes wider header space.

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
        // fail silently
      }

      /* -------- APP NAME -------- */
      pdf.setFontSize(16);
      pdf.setTextColor(...COLORS.primary);
      safeDrawText(pdf, state.storeName || 'Store', logoX + 22, 15, { fontSize: 16, color: `rgb(${COLORS.primary.join(',')})` });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...COLORS.gray);
      safeDrawText(pdf, getTranslation('customerManagement', state.currentLanguage), logoX + 22, 19, { fontSize: 9, color: `rgb(${COLORS.gray.join(',')})` });

      /* -------- RIGHT META -------- */
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...COLORS.black);
      safeDrawText(pdf, getTranslation('customerReport', state.currentLanguage), pageWidth - margin, 14, { align: 'right', fontSize: 12, color: `rgb(${COLORS.black.join(',')})` });

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

      const total = state.customers.length;
      const dueCount = state.customers.filter(c => (c.balanceDue || 0) > 0).length;
      const dueSum = state.customers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);

      const metrics = [
        { label: getTranslation('totalCustomersLabel', state.currentLanguage), value: total.toString() },
        { label: getTranslation('withBalanceDue', state.currentLanguage), value: dueCount.toString() },
        { label: getTranslation('totalOutstandingLabel', state.currentLanguage), value: formatCurrency(dueSum) }
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
      safeDrawText(pdf, getTranslation('customerList', state.currentLanguage), margin, y, { fontSize: 15, color: `rgb(${COLORS.primary.join(',')})` });

      /* ================= TABLE ================= */
      const headers = [
        getTranslation('customerNameHeader', state.currentLanguage),
        getTranslation('mobileHeader', state.currentLanguage),
        getTranslation('emailHeader', state.currentLanguage),
        getTranslation('balanceDueHeader', state.currentLanguage)
      ];
      const colW = [70, 50, 80, 60];
      const tableWidth = colW.reduce((a, b) => a + b, 0);

      y += 6;

      // Header row
      pdf.setFillColor(...COLORS.lightBg);
      pdf.rect(margin, y, tableWidth, 9, 'F');

      pdf.setFontSize(11);
      pdf.setTextColor(...COLORS.primary);

      headers.forEach((h, i) => {
        const x = margin + colW.slice(0, i).reduce((a, b) => a + b, 0);
        const align = i === 3 ? 'right' : 'left';
        // Center alignment as per style requested but let's keep headers centered mostly
        safeDrawText(pdf, h, x + colW[i] / 2, y + 6, { align: 'center', fontSize: 11, color: `rgb(${COLORS.primary.join(',')})` });
      });

      y += 9;
      pdf.setFontSize(10);
      pdf.setTextColor(...COLORS.black);

      state.customers.forEach((customer, index) => {
        const rowH = 8;
        if (y + rowH > pageHeight - 20) {
          pdf.addPage();
          y = 20;
        }

        if (index % 2 === 1) {
          pdf.setFillColor(...COLORS.lightBg);
          pdf.rect(margin, y, tableWidth, rowH, 'F');
        }

        const row = [
          customer.name.length > 35 ? customer.name.substring(0, 32) + '...' : customer.name,
          customer.mobileNumber || '-',
          customer.email || '-',
          formatCurrency(customer.balanceDue || 0)
        ];

        row.forEach((val, j) => {
          const x = margin + colW.slice(0, j).reduce((a, b) => a + b, 0);
          safeDrawText(pdf, String(val), x + colW[j] / 2, y + 5.5, { align: 'center', fontSize: 9.5 });
        });

        y += rowH;
      });



      /* ================= FOOTER ================= */
      const pageCount = pdf.internal.getNumberOfPages();

      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.gray);
        pdf.text(`${getTranslation('page', state.currentLanguage)} ${i} ${getTranslation('ofPage', state.currentLanguage)} ${pageCount}`, margin, pageHeight - 10);
        pdf.text(
          state.currentUser?.shopName || getTranslation('store', state.currentLanguage),
          pageWidth - margin,
          pageHeight - 10,
          { align: 'right' }
        );
      }

      pdf.save(`customers-${new Date().toISOString().split('T')[0]}.pdf`);
      if (window.showToast) {
        window.showToast(getTranslation('exportPDFSuccess', state.currentLanguage), 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage), 'error');
      }
    }
  };

  const exportCustomersJSON = () => {
    try {
      const data = state.customers.map((customer) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: customer.name,
        mobileNumber: customer.mobileNumber || customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
        balanceDue: Number(customer.balanceDue ?? customer.dueAmount ?? 0) || 0,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      }));

      downloadFile(
        `customers-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );

      if (window.showToast) {
        window.showToast(getTranslation('exportJSONSuccess', state.currentLanguage), 'success');
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage), 'error');
      }
    }
  };

  const exportCustomersCSV = () => {
    try {
      const headers = [
        getTranslation('customerNameHeader', state.currentLanguage),
        getTranslation('mobileHeader', state.currentLanguage),
        getTranslation('emailHeader', state.currentLanguage),
        getTranslation('addressHeader', state.currentLanguage),
        getTranslation('balanceDueHeader', state.currentLanguage)
      ];
      const escapeValue = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        if (stringValue.includes(',') || stringValue.includes('\n')) {
          return `"${stringValue}"`;
        }
        return stringValue;
      };

      const rows = state.customers.map((customer) => [
        escapeValue(customer.name || ''),
        escapeValue(customer.mobileNumber || customer.phone || ''),
        escapeValue(customer.email || ''),
        escapeValue(customer.address || ''),
        escapeValue((Number(customer.balanceDue ?? customer.dueAmount ?? 0) || 0).toFixed(2))
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

      downloadFile(
        `customers-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );

      if (window.showToast) {
        window.showToast(getTranslation('exportCSVSuccess', state.currentLanguage), 'success');
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast(getTranslation('exportError', state.currentLanguage), 'error');
      }
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Simple Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{getTranslation('customers', state.currentLanguage)}</h1>
          {(!isUnlimited(maxCustomers) && remainingCustomers < 15) && (
            <p className="text-sm mt-1">
              <span className="text-red-600 dark:text-red-400 font-medium">
                ({getTranslation('customerLimitLeft', state.currentLanguage)}: {remainingCustomers})
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(true)}
              className="btn-secondary flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50 dark:text-slate-200"
            >
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">{getTranslation('export', state.currentLanguage)}</span>
              <span className="sm:hidden">{getTranslation('export', state.currentLanguage)}</span>
            </button>
            {showExportMenu && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowExportMenu(false)}>
                <div
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-slate-700"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{getTranslation('exportCustomers', state.currentLanguage)}</h3>
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
                        exportCustomersCSV();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsCSV', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('spreadsheetFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportCustomersJSON();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                        <FileJson className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsJSON', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('rawDataFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportCustomersPDF();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">{getTranslation('exportAsPDF', state.currentLanguage)}</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{getTranslation('printableDocumentFormat', state.currentLanguage)}</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleOpenAddModal}
            className="btn-primary flex items-center text-sm"
            disabled={isPlanExpired(state)}
          >
            <Plus className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">{getTranslation('addCustomer', state.currentLanguage)}</span>
            <span className="sm:hidden">{getTranslation('add', state.currentLanguage)}</span>
          </button>
        </div>
      </div>

      {/* Simple Search Bar & Filter */}
      {/* Enhanced Search Bar & Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <label htmlFor="customer-search" className="sr-only">{getTranslation('searchCustomersPlaceholder', state.currentLanguage)}</label>
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
          </div>
          <input
            id="customer-search"
            type="text"
            placeholder={getTranslation('searchCustomersPlaceholder', state.currentLanguage)}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-10 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm focus:shadow-md outline-none"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="w-full sm:w-56 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Filter className="h-4 w-4 text-gray-500 dark:text-slate-400" />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm outline-none appearance-none cursor-pointer"
          >
            <option value="all">{getTranslation('all', state.currentLanguage) || 'All Customers'}</option>
            <option value="due">{getTranslation('due', state.currentLanguage) || 'Payment Due'}</option>
            <option value="credit">{getTranslation('credit', state.currentLanguage) || 'Store Credit'}</option>
            <option value="settled">{getTranslation('settled', state.currentLanguage) || 'Settled'}</option>
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Simple Premium Customers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {paginatedCustomers.length > 0 ? (
          paginatedCustomers.map((customer) => {
            const rawBalance = customer.balanceDue ?? customer.dueAmount ?? 0;
            const numericBalance = typeof rawBalance === 'number' ? rawBalance : parseFloat(rawBalance) || 0;
            const isCredit = numericBalance < 0;
            const hasBalance = numericBalance !== 0;

            // Generate a consistent gradient based on name length/char code
            const gradients = [
              'from-blue-500 to-indigo-600',
              'from-emerald-500 to-teal-600',
              'from-orange-500 to-red-600',
              'from-purple-500 to-pink-600',
              'from-cyan-500 to-blue-600',
            ];
            const gradientIndex = (customer.name || 'C').charCodeAt(0) % gradients.length;
            const avatarGradient = gradients[gradientIndex];
            // Determine top border color based on balance status
            let topBorderClass = 'hidden';
            if (numericBalance > 0) {
              topBorderClass = 'bg-gradient-to-r from-red-500 to-red-600';
            } else if (numericBalance < 0) {
              topBorderClass = 'bg-gradient-to-r from-emerald-500 to-emerald-600';
            }

            return (
              <div
                key={customer.id}
                className="group relative bg-white dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-xl border border-gray-200/60 dark:border-slate-700 transition-all duration-300 overflow-hidden flex flex-col"
              >
                {/* Decorative top border - Color coded by status */}
                <div className={`h-1.5 w-full ${topBorderClass}`}></div>

                <div className="p-5 flex-1 flex flex-col">
                  {/* Header: Avatar & Name */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-white font-bold text-xl shadow-md transform group-hover:scale-105 transition-transform duration-300`}>
                      {(customer.name || 'C')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate" title={customer.name}>
                        {customer.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${numericBalance > 0
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30'
                          : numericBalance < 0
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30'
                            : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400 border border-gray-200 dark:border-slate-600'
                          }`}>
                          {numericBalance > 0 ? getTranslation('paymentDue', state.currentLanguage) : numericBalance < 0 ? getTranslation('creditAvailable', state.currentLanguage) : getTranslation('settled', state.currentLanguage)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Contact Details */}
                  <div className="space-y-2 mb-5">
                    {(customer.mobileNumber || customer.phone) ? (
                      <div className="flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-slate-400 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors group/phone">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-gray-500">PH</span>
                          </div>
                          <span className="font-medium truncate">{customer.mobileNumber || customer.phone}</span>
                        </div>

                        {/* Call Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setWhatsAppCustomer(customer);
                              setShowWhatsAppModal(true);
                            }}
                            className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 transition-colors"
                            title={getTranslation('sendBillReminder', state.currentLanguage)}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          <a
                            href={`tel:${customer.mobileNumber || customer.phone}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                            title={getTranslation('call', state.currentLanguage)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-slate-600 p-2">
                        <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-slate-700">
                          <span className="text-xs font-bold">PH</span>
                        </div>
                        <span className="italic">{getTranslation('noPhoneNumber', state.currentLanguage)}</span>
                      </div>
                    )}

                    {customer.email ? (
                      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-400 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-gray-500">@</span>
                        </div>
                        <span className="truncate">{customer.email}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-slate-600 p-2">
                        <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-slate-700">
                          <span className="text-xs font-bold">@</span>
                        </div>
                        <span className="italic">{getTranslation('noEmailAddress', state.currentLanguage)}</span>
                      </div>
                    )}
                  </div>

                  {/* Balance Block */}
                  <div className="mt-auto pt-4 border-t border-gray-100 dark:border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">{getTranslation('balance', state.currentLanguage)}</span>
                      <span className={`text-lg font-bold ${numericBalance > 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : numericBalance < 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-gray-900 dark:text-white'
                        }`}>
                        {isCredit ? '-' : ''}{formatCurrency(Math.abs(numericBalance))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="px-5 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-700 flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (isPlanExpired(state)) {
                        if (window.showToast) window.showToast('Plan expired. Upgrade to manage payments.', 'error');
                        return;
                      }
                      handlePayment(customer);
                    }}
                    disabled={isPlanExpired(state)}
                    className={`flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center justify-center gap-2 ${hasBalance
                      ? 'bg-gradient-to-r from-gray-900 to-gray-800 dark:from-white dark:to-gray-100 text-white dark:text-gray-900 hover:from-black hover:to-gray-900 dark:hover:from-gray-100 dark:hover:to-gray-200'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-white border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                      } ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <CreditCard className="h-4 w-4" />
                    <span>{hasBalance ? getTranslation('payNow', state.currentLanguage) : getTranslation('addCash', state.currentLanguage)}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (isPlanExpired(state)) return;
                        setSelectedCustomer(customer);
                        setShowEditModal(true);
                      }}
                      disabled={isPlanExpired(state)}
                      className={`p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors border border-transparent hover:border-blue-100 dark:hover:border-blue-900/30 ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={getTranslation('editDetails', state.currentLanguage)}
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setHistoryCustomer(customer);
                        setShowHistorySelection(true);
                      }}
                      className="p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-purple-50 hover:text-slate-900 dark:hover:bg-purple-900/20 dark:hover:text-purple-400 transition-colors border border-transparent hover:border-purple-100 dark:hover:border-purple-900/30"
                      title={getTranslation('viewHistory', state.currentLanguage)}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCustomer(customer.id)}
                      disabled={(customer.balanceDue || 0) !== 0 || isPlanExpired(state)}
                      className={`p-2.5 rounded-xl transition-colors border border-transparent ${(customer.balanceDue || 0) !== 0 || isPlanExpired(state)
                        ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed'
                        : 'text-gray-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 hover:border-red-100 dark:hover:border-red-900/30'
                        }`}
                      title={
                        (customer.balanceDue || 0) !== 0
                          ? getTranslation('clearBalanceToDelete', state.currentLanguage)
                          : getTranslation('deleteCustomer', state.currentLanguage)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full">
            <div className="text-center py-16 px-4 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700">
              <Users className="h-12 w-12 text-gray-400 dark:text-slate-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{getTranslation('noCustomersFound', state.currentLanguage)}</h3>
              <p className="text-gray-600 dark:text-slate-400 mb-6">
                {searchTerm ? getTranslation('adjustSearchTerms', state.currentLanguage) : getTranslation('getStartedAddingCustomer', state.currentLanguage)}
              </p>
              {!searchTerm && (
                <button
                  onClick={handleOpenAddModal}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {getTranslation('addCustomer', state.currentLanguage)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 px-4 py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
          <div className="text-sm text-gray-700 dark:text-slate-300">
            {getTranslation('showing', state.currentLanguage)} <span className="font-semibold">{startIndex + 1}</span> {getTranslation('to', state.currentLanguage)} <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredCustomers.length)}</span> {getTranslation('of', state.currentLanguage)} <span className="font-semibold">{filteredCustomers.length}</span> {filteredCustomers.length === 1 ? getTranslation('customer', state.currentLanguage) : getTranslation('customers', state.currentLanguage)}
          </div>
          <div className="flex items-center gap-1">
            {/* First Page Button */}
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={getTranslation('firstPage', state.currentLanguage)}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>

            {/* Previous Page Button */}
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={getTranslation('previousPage', state.currentLanguage)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Page Number Buttons */}
            <div className="flex items-center gap-1 mx-2">
              {getPageNumbers().map((page, index) => {
                if (page === 'ellipsis') {
                  return (
                    <span key={`ellipsis-${index}`} className="px-2 text-gray-500 dark:text-slate-500">
                      ...
                    </span>
                  );
                }
                return (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`min-w-[36px] px-3 py-2 text-sm font-medium rounded-lg transition-colors ${currentPage === page
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                      }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            {/* Next Page Button */}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={getTranslation('nextPage', state.currentLanguage)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Last Page Button */}
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={getTranslation('lastPage', state.currentLanguage)}
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddCustomerModal
          existingCustomers={state.customers}
          planLimitError={planLimitMessage}
          onClearPlanLimitError={() => setPlanLimitMessage('')}
          onClose={() => {
            setShowAddModal(false);
            setPlanLimitMessage('');
          }}
          onSubmit={handleAddCustomer}
        />
      )}

      {showEditModal && selectedCustomer && (
        <EditCustomerModal
          customer={selectedCustomer}
          onClose={() => {
            setShowEditModal(false);
            setSelectedCustomer(null);
          }}
          onSubmit={handleEditCustomer}
        />
      )}

      {showPaymentModal && selectedCustomer && (
        <PaymentModal
          customer={selectedCustomer}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedCustomer(null);
          }}
          onSubmit={handlePaymentSubmit}
        />
      )}

      {showOrderHistoryModal && orderHistoryCustomer && (
        <OrderHistoryModal
          customer={orderHistoryCustomer}
          orders={state.orders}
          onClose={() => {
            setShowOrderHistoryModal(false);
            setOrderHistoryCustomer(null);
          }}
        />
      )}

      {showWhatsAppModal && whatsAppCustomer && (
        <WhatsAppBillModal
          customer={whatsAppCustomer}
          orders={state.orders}
          onClose={() => {
            setShowWhatsAppModal(false);
            setWhatsAppCustomer(null);
          }}
        />
      )}

      {showHistorySelection && historyCustomer && (
        <HistorySelectionModal
          customer={historyCustomer}
          onClose={() => {
            setShowHistorySelection(false);
          }}
          onSelectOrderHistory={() => {
            setOrderHistoryCustomer(historyCustomer);
            setShowOrderHistoryModal(true);
          }}
          onSelectTransactionHistory={() => {
            setShowTransactionHistoryModal(true);
          }}
        />
      )}

      {showTransactionHistoryModal && historyCustomer && (
        <TransactionHistoryModal
          customer={historyCustomer}
          transactions={state.customerTransactions}
          onClose={() => {
            setShowTransactionHistoryModal(false);
            setHistoryCustomer(null);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && customerToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 animate-fade-in border border-gray-100 dark:border-slate-700">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">{getTranslation('deleteCustomerConfirmTitle', state.currentLanguage)}</h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  {getTranslation('deleteCustomerConfirmText', state.currentLanguage)}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setCustomerToDelete(null);
                }}
                className="flex-shrink-0 p-1.5 text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Customer Details */}
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4 mb-6 border border-gray-200 dark:border-slate-600">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{getTranslation('name', state.currentLanguage)}:</span>
                  <span className="text-sm text-gray-900 dark:text-white">{customerToDelete.name}</span>
                </div>
                {customerToDelete.mobileNumber && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{getTranslation('phone', state.currentLanguage)}:</span>
                    <span className="text-sm text-gray-900 dark:text-white">{customerToDelete.mobileNumber}</span>
                  </div>
                )}
                {customerToDelete.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{getTranslation('email', state.currentLanguage)}:</span>
                    <span className="text-sm text-gray-900 dark:text-white">{customerToDelete.email}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setCustomerToDelete(null);
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
              >
                {getTranslation('cancel', state.currentLanguage)}
              </button>
              <button
                onClick={confirmDeleteCustomer}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
              >
                {getTranslation('deleteCustomer', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
