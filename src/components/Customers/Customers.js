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
import PaymentAllocationModal from './PaymentAllocationModal';

import OrderHistoryModal from './OrderHistoryModal';
import WhatsAppBillModal from './WhatsAppBillModal';
import HistorySelectionModal from './HistorySelectionModal';
import TransactionHistoryModal from './TransactionHistoryModal';
import { getPlanLimits, canAddCustomer, getDistributedPlanLimits, getRemainingCapacity, isUnlimited } from '../../utils/planUtils';
import { sanitizeMobileNumber } from '../../utils/validation';

import { getAllItems, addItem, STORES, updateItem } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
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
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [allocationData, setAllocationData] = useState(null);
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
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      ...customerData,
      createdAt: new Date().toISOString()
    };
    newCustomer.localId = newCustomer.id; // Ensure localId is set

    dispatch({ type: 'ADD_CUSTOMER', payload: newCustomer });

    // Create opening balance transaction (always, for audit trail)
    const initialBalance = parseFloat(customerData.dueAmount || 0);
    const transaction = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      sellerId: customerData.sellerId || state.currentUser?.sellerId || state.currentUser?.id,
      customerId: newCustomer.id,
      type: initialBalance >= 0 ? 'opening_balance' : 'payment', // Positive or Zero = Opening Balance
      amount: Math.abs(initialBalance),
      date: new Date().toISOString(),
      description: initialBalance >= 0 ? 'Opening Balance' : 'Opening Advance',
      previousBalance: 0,
      currentBalance: initialBalance,
      isSynced: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
    };

    dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });

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
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          sellerId: customerData.sellerId || oldCustomer.sellerId,
          customerId: customerData._id || customerData.id,
          type: diff > 0 ? 'due' : 'payment',
          amount: Math.abs(diff),
          date: new Date().toISOString(),
          description: diff > 0 ? 'Manual Balance Increase' : 'Manual Balance Decrease',
          previousBalance: oldDue,
          currentBalance: newDue,
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

  const processPayment = async (amount, paymentType, description, allocationMap = {}) => {
    // Note: Validation checks are done in handlePaymentSubmit wrapper

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
      isSynced: false,
      isPaymentUpdate: true,
      syncedAt: undefined,
      syncError: undefined
    };

    console.log('💰 CUSTOMER PAYMENT: Prepared updated customer data', {
      customerId: updatedCustomer.id,
      newBalance,
      isSynced: updatedCustomer.isSynced
    });

    // Create Customer Transaction Record
    const transaction = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      sellerId: selectedCustomer.sellerId,
      customerId: selectedCustomer._id || selectedCustomer.id,
      type: paymentType === 'receive' ? 'payment' : 'add_due',
      amount: paymentAmount,
      date: new Date().toISOString(),
      description: description ? description : (paymentType === 'receive' ? 'Payment Received' : 'Amount Given/Refunded'),
      note: description,
      previousBalance: currentBalance,
      currentBalance: newBalance,
      isSynced: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
    };

    // Update Allocated Orders (Clear/Reduce Due)
    // We receive a map { [orderId]: amountToPay }
    const allocatedOrderIds = Object.keys(allocationMap);
    if (allocationMap && allocatedOrderIds.length > 0) {
      allocatedOrderIds.forEach(orderId => {
        const order = state.orders.find(o => o.id === orderId);
        const allocatedAmount = Number(allocationMap[orderId] || 0);

        if (order && allocatedAmount > 0) {
          let currentDue = 0;
          if (order.paymentMethod === 'split' && order.splitPaymentDetails) {
            currentDue = Number(order.splitPaymentDetails.dueAmount || 0);
          } else if (order.paymentMethod === 'due' || order.paymentMethod === 'credit') {
            currentDue = Number(order.totalAmount || order.total || 0);
          }

          const newDue = parseFloat(Math.max(0, currentDue - allocatedAmount).toFixed(2));
          const isCleared = newDue <= 0.1;

          const cash = Number((order.splitPaymentDetails?.cashAmount || 0) + allocatedAmount);
          const online = Number(order.splitPaymentDetails?.onlineAmount || 0);
          const dueAmountFinal = isCleared ? 0 : newDue;

          // Determine payment method and split type
          let finalPaymentMethod = 'split';
          let finalSplitDetails = {
            cashAmount: cash,
            onlineAmount: online,
            dueAmount: dueAmountFinal
          };

          // Count active payment categories
          const activeMethods = [];
          if (cash > 0) activeMethods.push('cash');
          if (online > 0) activeMethods.push('online');
          if (dueAmountFinal > 0) activeMethods.push('due');

          if (activeMethods.length > 1) {
            finalPaymentMethod = 'split';
            // Set type for backend compatibility
            if (activeMethods.includes('cash') && activeMethods.includes('online') && activeMethods.includes('due')) {
              finalSplitDetails.type = 'cash_online_due';
            } else if (activeMethods.includes('cash') && activeMethods.includes('online')) {
              finalSplitDetails.type = 'cash_online';
            } else if (activeMethods.includes('online') && activeMethods.includes('due')) {
              finalSplitDetails.type = 'online_due';
            } else if (activeMethods.includes('cash') && activeMethods.includes('due')) {
              finalSplitDetails.type = 'cash_due';
            }
          } else {
            // Simplify if only one or zero methods are active
            if (activeMethods.length === 1) {
              finalPaymentMethod = activeMethods[0] === 'online' ? 'upi' : activeMethods[0];
            } else {
              // Defaults to cash if everything is zero for some reason (shouldn't happen here)
              finalPaymentMethod = 'cash';
            }
            finalSplitDetails = undefined;
          }

          const updatedOrder = {
            ...order,
            paymentMethod: finalPaymentMethod,
            splitPaymentDetails: finalSplitDetails,
            allPaymentClear: isCleared,
            updatedAt: new Date().toISOString()
          };

          updateItem(STORES.orders, updatedOrder);
          dispatch({ type: 'UPDATE_ORDER', payload: updatedOrder });
        }
      });
    }

    // Dispatch Updates
    dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });
    dispatch({ type: 'UPDATE_CUSTOMER', payload: updatedCustomer });

    // Close modal immediately for better UX
    setShowPaymentModal(false);
    setShowAllocationModal(false);
    setAllocationData(null);
    setSelectedCustomer(null);

    console.log('💰 CUSTOMER PAYMENT: Local state updated, now attempting API sync');

    // Sync Attempt
    try {
      if (syncService.isOnline()) {
        syncService.scheduleSync();
      } else {
        if (window.showToast) window.showToast(getTranslation('paymentSavedLocally', state.currentLanguage), 'warning');
      }
    } catch (syncError) {
      console.error('💰 CUSTOMER PAYMENT: Sync scheduling failed', syncError);
      if (window.showToast) window.showToast(getTranslation('paymentSavedLocally', state.currentLanguage), 'warning');
    }

    // Confirmation Toast
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

  const handleAllocationConfirm = (allocationMap) => {
    if (allocationData) {
      processPayment(allocationData.amount, allocationData.type, allocationData.description, allocationMap);
    }
  };

  const handlePaymentSubmit = (amount, paymentType = 'receive', description = '') => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast(getTranslation('planExpiredPayment', state.currentLanguage), 'warning', 8000);
      }
      return;
    }
    if (!selectedCustomer || amount <= 0) return;

    // Check for pending orders for allocation
    if (paymentType === 'receive') {
      // Robustly match against all possible customer identifiers
      const targetIds = [
        selectedCustomer.id,
        selectedCustomer._id,
        selectedCustomer.localId
      ].filter(Boolean).map(id => id.toString());

      const pendingOrders = (state.orders || []).filter(o => {
        const orderCustomerId = o.customerId ? o.customerId.toString() : '';
        const matchesCustomer = targetIds.includes(orderCustomerId);

        return matchesCustomer &&
          !o.isDeleted &&
          !o.allPaymentClear &&
          (
            (o.paymentMethod === 'split' && (o.splitPaymentDetails?.dueAmount || 0) > 0) ||
            (o.paymentMethod === 'due' || o.paymentMethod === 'credit')
          );
      });

      if (pendingOrders.length > 0) {
        setAllocationData({ amount, type: paymentType, description, pendingOrders });
        setShowPaymentModal(false);
        setShowAllocationModal(true);
        return;
      }
    }

    // Standard processing
    processPayment(amount, paymentType, description);
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

  /* ================= MODERN PDF EXPORT (THEMED) ================= */
  const exportCustomersPDF = async () => {
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      /* ================= CONFIG ================= */
      const COLORS = {
        primary: [47, 60, 126], // #2F3C7E
        secondary: [236, 72, 153], // #EC4899 (Pink)
        success: [16, 185, 129], // #10B981
        gray: [100, 116, 139],
        lightBg: [248, 250, 252],
        border: [226, 232, 240],
        black: [15, 23, 42], // #0F172A
        white: [255, 255, 255]
      };

      const formatPDFCurrency = (val) => {
        const amount = Number(val || 0);
        const isWhole = amount % 1 === 0;
        return `Rs. ${amount.toLocaleString('en-IN', {
          minimumFractionDigits: isWhole ? 0 : 2,
          maximumFractionDigits: 2
        })}`;
      };



      /* -------- HELPERS -------- */
      const safeDrawText = (pdf, text, x, y, options = {}) => {
        const isHindi = /[\u0900-\u097F\u20B9]/.test(text);
        if (isHindi) {
          try {
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
            pdf.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
          } catch (e) {
            pdf.text(text, x, y, options); // Fallback
          }
        } else {
          pdf.text(text, x, y, options);
        }
      };

      /* ================= HEADER ================= */
      const headerHeight = 28;
      doc.setFillColor(...COLORS.white);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');
      doc.setDrawColor(...COLORS.primary);
      doc.setLineWidth(1.5);
      doc.line(0, headerHeight - 1, pageWidth, headerHeight - 1);

      /* -------- LOGO & APP NAME -------- */
      const logoX = margin;
      const logoY = 10;
      const logoSize = 16;

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
          doc.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
        }
      } catch (e) { }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...COLORS.primary);
      doc.text('Grocery studio', logoX + logoSize + 4, logoY + 7);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      doc.text('Advanced Billing & Inventory Solution', logoX + logoSize + 4, logoY + 11);

      /* -------- RIGHT META -------- */
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      safeDrawText(doc, `${getTranslation('customerReport', state.currentLanguage)}`, pageWidth - margin, logoY + 5, { align: 'right', color: '#000000', fontSize: 14 });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.gray);
      safeDrawText(doc, `Type: Full List`, pageWidth - margin, logoY + 11, { align: 'right', color: '#787878', fontSize: 9 });

      const today = new Date();
      safeDrawText(doc, `Date: ${formatDate(today)}`, pageWidth - margin, logoY + 16, { align: 'right', color: '#787878', fontSize: 9 });

      /* -------- CENTER SHOP INFO -------- */
      let currentY = headerHeight + 10;

      // Shop Name (Big & Bold)
      if (state.storeName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(...COLORS.black);
        doc.text(state.storeName, pageWidth / 2, currentY, { align: 'center' });
        currentY += 7;
      }

      // Address & other info (Smaller, Centered)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.gray);

      const details = [];
      if (state.storeAddress) details.push(state.storeAddress);
      if (state.storePhone) details.push(`Contact: ${state.storePhone}`);
      if (state.storeGstin) details.push(`GSTIN: ${state.storeGstin}`);

      if (details.length > 0) {
        doc.text(details.join(' | '), pageWidth / 2, currentY, { align: 'center' });
        currentY += 8;
      } else {
        currentY += 5;
      }

      /* ================= SUMMARY CARDS ================= */
      let y = currentY + 2;
      const cardW = (contentWidth - 6) / 3;
      const cardH = 22;

      const total = state.customers.length;
      const dueCount = state.customers.filter(c => (c.balanceDue || 0) > 0).length;
      const dueSum = state.customers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);

      const metrics = [
        { label: getTranslation('totalCustomersLabel', state.currentLanguage), value: total.toString(), color: COLORS.primary },
        { label: getTranslation('withBalanceDue', state.currentLanguage), value: dueCount.toString(), color: COLORS.secondary },
        { label: getTranslation('totalOutstandingLabel', state.currentLanguage), value: formatPDFCurrency(dueSum), color: COLORS.gray } // Using gray/red for outstanding
      ];

      metrics.forEach((m, i) => {
        const x = margin + i * (cardW + 3);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');
        doc.setDrawColor(...COLORS.border);
        doc.setLineWidth(0.1);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'S');

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.gray);
        safeDrawText(doc, m.label, x + 4, y + 8, { color: '#787878', fontSize: 7.5 });

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(i === 2 && dueSum > 0 ? 220 : COLORS.primary[0], i === 2 && dueSum > 0 ? 38 : COLORS.primary[1], i === 2 && dueSum > 0 ? 38 : COLORS.primary[2]); // Red for due if > 0
        safeDrawText(doc, m.value, x + 4, y + 16, { color: i === 2 && dueSum > 0 ? '#DC2626' : '#2F3C7E', fontSize: 16 });
      });

      y += cardH + 15;

      /* ================= TABLE ================= */
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      safeDrawText(doc, getTranslation('customerList', state.currentLanguage), margin, y, { color: '#000000', fontSize: 10.5 });
      y += 6.5;

      const headers = [
        'S.No.',
        getTranslation('customerNameHeader', state.currentLanguage),
        getTranslation('mobileHeader', state.currentLanguage),
        getTranslation('emailHeader', state.currentLanguage),
        { text: getTranslation('balanceDueHeader', state.currentLanguage), align: 'right' }
      ];

      // Portrait Weights (Total ~180mm)
      const colWeights = [
        { w: 15, align: 'center' }, // S.No.
        { w: 55, align: 'center' }, // Name (Header Center) - Reduced from 60
        { w: 35, align: 'center' }, // Mobile (Centered) - Reduced from 40
        { w: 45, align: 'center' }, // Email (Header Center) - Reduced from 50
        { w: 30, align: 'right' } // Balance
      ];

      const tableWidth = colWeights.reduce((a, b) => a + b.w, 0);

      // Header row
      doc.setFillColor(245, 247, 255);
      doc.rect(margin, y, tableWidth, 10, 'F');

      // Header Outline
      doc.setDrawColor(...COLORS.border);
      doc.setLineWidth(0.1);
      doc.rect(margin, y, tableWidth, 10, 'S');

      // Header Vertical Lines
      let vHeaderX = margin;
      colWeights.forEach((col, i) => {
        if (i < colWeights.length - 1) {
          vHeaderX += col.w;
          doc.line(vHeaderX, y, vHeaderX, y + 10);
        }
      });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.primary);

      let hX = margin;
      headers.forEach((h, i) => {
        const headerText = typeof h === 'object' ? h.text : h;
        const align = (typeof h === 'object' ? h.align : colWeights[i].align) || 'left';
        let drawX = hX + 2;
        if (align === 'center') drawX = hX + (colWeights[i].w / 2);
        if (align === 'right') drawX = hX + colWeights[i].w - 2;

        safeDrawText(doc, headerText, drawX, y + 6.5, { align, color: '#2F3C7E', fontSize: 9 });
        hX += colWeights[i].w;
      });

      y += 10;

      doc.setFontSize(9);
      doc.setTextColor(...COLORS.black);

      state.customers.forEach((customer, index) => {
        const rowH = 10;
        if (y + rowH > pageHeight - 20) {
          doc.addPage();
          y = 20;

          // Redraw Header
          doc.setFillColor(245, 247, 255);
          doc.rect(margin, y, tableWidth, 10, 'F');

          // Header Outline
          doc.setDrawColor(...COLORS.border);
          doc.setLineWidth(0.1);
          doc.rect(margin, y, tableWidth, 10, 'S');

          // Header Vertical Lines
          let vHeaderRepeatX = margin;
          colWeights.forEach((col, i) => {
            if (i < colWeights.length - 1) {
              vHeaderRepeatX += col.w;
              doc.line(vHeaderRepeatX, y, vHeaderRepeatX, y + 10);
            }
          });

          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...COLORS.primary);

          let rHX = margin;
          headers.forEach((h, i) => {
            const headerText = typeof h === 'object' ? h.text : h;
            // Enforce center alignment
            let drawX = rHX + (colWeights[i].w / 2);
            safeDrawText(doc, headerText, drawX, y + 6.5, { align: 'center', color: '#2F3C7E', fontSize: 9 });
            rHX += colWeights[i].w;
          });
          y += 10;
        }

        if (index % 2 === 1) {
          doc.setFillColor(252, 253, 255);
          doc.rect(margin, y, tableWidth, rowH, 'F');
        }

        // Row Outline
        doc.setDrawColor(...COLORS.border);
        doc.setLineWidth(0.1);
        doc.rect(margin, y, tableWidth, rowH, 'S');

        // Row Vertical Lines
        let vRowX = margin;
        colWeights.forEach((col, i) => {
          if (i < colWeights.length - 1) {
            vRowX += col.w;
            doc.line(vRowX, y, vRowX, y + rowH);
          }
        });

        doc.setTextColor(...COLORS.black);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        let rowX = margin;

        // S.No. (Centered)
        safeDrawText(doc, (index + 1).toString(), rowX + (colWeights[0].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[0].w;

        // Name (Centered)
        safeDrawText(doc, customer.name.substring(0, 30), rowX + (colWeights[1].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[1].w;

        // Mobile (Centered)
        safeDrawText(doc, customer.mobileNumber || customer.phone || '-', rowX + (colWeights[2].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[2].w;

        // Email (Centered)
        safeDrawText(doc, customer.email || '-', rowX + (colWeights[3].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[3].w;

        // Balance (Centered)
        const balance = customer.balanceDue || 0;
        if (balance > 0) doc.setTextColor(220, 38, 38); // Red for debt
        else if (balance < 0) doc.setTextColor(16, 185, 129); // Green for credit
        else doc.setTextColor(...COLORS.black);

        doc.setFont('helvetica', 'bold');
        safeDrawText(doc, formatPDFCurrency(balance), rowX + (colWeights[4].w / 2), y + 6.5, { align: 'center', fontSize: 9 });
        doc.setFont('helvetica', 'normal');

        y += rowH;
      });

      /* ================= FOOTER ================= */
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

      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.text(`Page ${i} of ${totalPages}`, margin, pageHeight - 10);

        // Powered By Branding
        if (gsLogoBase64) {
          const gsY = pageHeight - 7;
          const centerX = pageWidth / 2;
          doc.setFontSize(6);
          doc.setTextColor(160, 160, 160);
          doc.setFont('helvetica', 'normal');
          doc.text('Powered by ', centerX - 5, gsY, { align: 'right' });
          doc.addImage(gsLogoBase64, 'PNG', centerX - 4.2, gsY - 2.8, 3.5, 3.5);
          doc.setFont('helvetica', 'bold');
          doc.text('Grocery Studio', centerX + 0.5, gsY, { align: 'left' });
        }

        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.setFont('helvetica', 'normal');
        doc.text(`${state.storeName || 'Store'} - Customer Report`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      }

      // Add watermark
      await addWatermarkToPDF(doc, sellerLogo || undefined);

      doc.save(`customers-report-${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
      if (window.showToast) {
        window.showToast(getTranslation('exportPDFSuccess', state.currentLanguage), 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('PDF Export Error: ', error);
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
            let avatarGradient;
            if (numericBalance > 0) {
              avatarGradient = 'from-red-500 to-red-600';
            } else if (numericBalance < 0) {
              avatarGradient = 'from-emerald-500 to-emerald-600';
            } else {
              avatarGradient = 'from-sky-500 to-blue-500';
            }
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

      {showAllocationModal && allocationData && (
        <PaymentAllocationModal
          customer={selectedCustomer}
          paymentAmount={allocationData.amount}
          pendingOrders={allocationData.pendingOrders}
          onClose={() => {
            setShowAllocationModal(false);
            setAllocationData(null);
            // We do NOT clear selectedCustomer here to prevent context loss if they cancel allocation but maybe want to return?
            // Actually, if they close allocation, it might be confusing. 
            // Standard UX: Cancel allocation returns to nothing.
            // Or use onConfirm([]) to skip?
            // The modal has "Skip Allocation".
            // If they click 'X', just close modal.
            // But main customer view remains.
          }}
          onConfirm={handleAllocationConfirm}
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
          customer={state.customers.find(c => c.id === historyCustomer.id) || historyCustomer}
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
