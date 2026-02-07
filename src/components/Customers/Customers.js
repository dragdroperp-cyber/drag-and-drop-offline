import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
  Upload,
  CheckCircle2,
  AlertCircle,
  Play,
  ListChecks,
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

import { getAllItems, addItem, STORES, updateItem, updateMultipleItems } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import syncService from '../../services/syncService';

const CUSTOMER_SYSTEM_FIELDS = [
  { key: 'name', label: 'Customer Name', required: true, synonyms: ['customername', 'name', 'fullname'] },
  { key: 'mobileNumber', label: 'Mobile Number', required: true, synonyms: ['mobile', 'phone', 'contact', 'cell'] },
  { key: 'email', label: 'Email', required: false, synonyms: ['emailaddress', 'mail'] },
  { key: 'address', label: 'Address', required: false, synonyms: ['location', 'place'] },
  { key: 'dueAmount', label: 'Balance Due', required: false, synonyms: ['balance', 'due', 'outstanding'] },
];

const Customers = () => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importProgress, setImportProgress] = useState({ total: 0, processed: 0, success: 0, errors: [] });
  const [isImporting, setIsImporting] = useState(false);
  const [importLimitExceeded, setImportLimitExceeded] = useState(false);
  const [fileFormatStatus, setFileFormatStatus] = useState(null); // 'valid' | 'invalid' | null
  const [fileFormatMessage, setFileFormatMessage] = useState('');
  const [detectedFields, setDetectedFields] = useState([]);
  const [parsedCustomers, setParsedCustomers] = useState([]);
  const [fieldMappings, setFieldMappings] = useState({});
  const [showMapping, setShowMapping] = useState(false);
  const [processingItem, setProcessingItem] = useState(null);
  const [importPause, setImportPause] = useState({ active: false, error: null, resolve: null });
  const [limitExceededInfo, setLimitExceededInfo] = useState(null);
  const [showLimitConfirmation, setShowLimitConfirmation] = useState(false);
  const [showImportResults, setShowImportResults] = useState(false);
  const [importResults, setImportResults] = useState({ success: [], failed: [] });
  const cancelImportRef = useRef(false);
  const fileInputRef = useRef(null);
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
          doc.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
        }
      } catch (e) { }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(...COLORS.primary);
      doc.text('Inventory Studio', logoX + logoSize + 4, logoY + 7);

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
          doc.text('Inventory Studio', centerX + 0.5, gsY, { align: 'left' });
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

  const mappingStatus = useMemo(() => {
    if (!importFile) return { isComplete: false, reason: null };

    const missingRequired = CUSTOMER_SYSTEM_FIELDS.filter(f => f.required && !fieldMappings[f.key]);

    if (missingRequired.length > 0) {
      return {
        isComplete: false,
        reason: `Required fields missing: ${missingRequired.map(f => f.label).join(', ')}`
      };
    }

    return { isComplete: true, reason: null };
  }, [importFile, fieldMappings]);

  // Auto-verify mapping whenever fieldMappings change
  useEffect(() => {
    const autoVerifyMapping = async () => {
      if (!importFile || !mappingStatus.isComplete) {
        setParsedCustomers([]);
        setImportLimitExceeded(false);
        return;
      }

      try {
        const fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(importFile);
        });

        const fileExtension = importFile.name.split('.').pop().toLowerCase();
        let rawItems = [];
        if (fileExtension === 'csv') rawItems = parseCSV(fileText);
        else rawItems = parseJSON(fileText);

        const mappedItems = rawItems.map(raw => {
          const item = {};
          CUSTOMER_SYSTEM_FIELDS.forEach(sf => {
            const mappedHeader = fieldMappings[sf.key];
            if (mappedHeader) {
              item[sf.key] = raw[mappedHeader];
            }
          });
          return item;
        });

        setParsedCustomers(mappedItems);

        // Limit check for customers
        const { maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
        const currentCustomersCount = state.customers.filter(c => !c.isDeleted).length;
        const customersToImport = mappedItems.length;
        const totalAfterImport = currentCustomersCount + customersToImport;

        if (maxCustomers !== Infinity && totalAfterImport > maxCustomers) {
          setImportLimitExceeded(true);
          setLimitExceededInfo({
            current: currentCustomersCount,
            toImport: customersToImport,
            max: maxCustomers,
            available: Math.max(0, maxCustomers - currentCustomersCount)
          });
        } else {
          setImportLimitExceeded(false);
        }
      } catch (error) {
        console.error('Error auto-verifying mapping:', error);
      }
    };

    autoVerifyMapping();
  }, [fieldMappings, importFile, mappingStatus.isComplete, state.customers, state.currentPlan, state.currentPlanDetails]);

  const parseCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const items = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const values = [];
      let currentValue = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          if (inQuotes && line[j + 1] === '"') {
            currentValue += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());

      if (values.length > 0 && values.some(v => v)) {
        const item = {};
        headers.forEach((header, index) => {
          item[header] = values[index] !== undefined ? values[index] : '';
        });
        items.push(item);
      }
    }

    return items;
  };

  const parseJSON = (jsonText) => {
    try {
      const data = JSON.parse(jsonText);
      if (!Array.isArray(data)) {
        return [data];
      }
      return data;
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }
  };

  const validateCustomerImport = (customer, index) => {
    const errors = [];

    // 1. Strict Name Validation
    if (!customer.name || !String(customer.name).trim()) {
      errors.push(`Row ${index + 1}: Customer name is required`);
    }

    // 2. Strict Mobile Number Validation
    const rawMobile = String(customer.mobileNumber || '').trim();
    if (!rawMobile) {
      errors.push(`Row ${index + 1}: Mobile number is required`);
    } else {
      // Allow leading +, then digits only. Length between 7-15
      const mobileRegex = /^\+?[0-9]{7,15}$/;
      if (!mobileRegex.test(rawMobile.replace(/\s/g, ''))) {
        errors.push(`Row ${index + 1}: Invalid mobile number format ("${rawMobile}"). Only digits and optional leading + are allowed.`);
      }
    }

    // 3. Strict Numeric Validation (dueAmount/balanceDue)
    const rawDue = String(customer.dueAmount ?? 0).trim().replace(/,/g, '');
    if (rawDue && isNaN(Number(rawDue))) {
      errors.push(`Row ${index + 1}: Balance Due must be a numeric value (found "${rawDue}")`);
    }

    // Default values and numeric conversion if no errors
    if (errors.length === 0) {
      customer.dueAmount = parseFloat(rawDue) || 0;
      customer.balanceDue = customer.dueAmount;
    }

    return { customer, errors };
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension !== 'csv' && extension !== 'json') {
        if (window.showToast) {
          window.showToast('Please select a CSV or JSON file', 'error');
        }
        return;
      }

      setImportFile(file);
      setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
      setImportLimitExceeded(false);
      setLimitExceededInfo(null);
      setFileFormatStatus(null);
      setFileFormatMessage('');
      setDetectedFields([]);

      try {
        const fileText = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });

        let rawItems = [];
        if (extension === 'csv') rawItems = parseCSV(fileText);
        else rawItems = parseJSON(fileText);

        if (rawItems.length > 0) {
          const headers = Object.keys(rawItems[0]);
          setDetectedFields(headers);

          // Auto-mapping based on key names or synonyms
          const initialMappings = {};
          CUSTOMER_SYSTEM_FIELDS.forEach(sf => {
            const match = headers.find(h =>
              h.toLowerCase() === sf.key.toLowerCase() ||
              (sf.synonyms && sf.synonyms.includes(h.toLowerCase()))
            );
            if (match) initialMappings[sf.key] = match;
          });

          setFieldMappings(initialMappings);
          setFileFormatStatus('valid');
          setShowMapping(true);
        } else {
          throw new Error('File is empty');
        }
      } catch (error) {
        setFileFormatStatus('invalid');
        setFileFormatMessage(error.message);
      }
    }
  };

  const importCustomersAction = async (limit = null) => {
    try {
      setIsImporting(true);
      setShowLimitConfirmation(false);
      cancelImportRef.current = false;

      let items = parsedCustomers;
      if (limit && limit > 0) {
        items = items.slice(0, limit);
      }

      setImportProgress(prev => ({ ...prev, total: items.length, processed: 0, success: 0, errors: [] }));
      setImportResults({ success: [], failed: [] });

      const sellerId = state.currentUser?.sellerId || state.currentUser?.id;
      let successCount = 0;
      const errors = [];
      const processedMobiles = new Set();

      for (let i = 0; i < items.length; i++) {
        if (cancelImportRef.current) break;

        const currentItem = items[i];
        setProcessingItem({
          index: i + 1,
          total: items.length,
          name: currentItem.name || 'Unnamed'
        });

        // Small delay for UI smoothness
        await new Promise(r => setTimeout(r, 50));

        const { customer, errors: validationErrors } = validateCustomerImport(currentItem, i);

        if (validationErrors.length > 0) {
          const msg = validationErrors.join('; ');
          errors.push(msg);
          setImportProgress(prev => ({ ...prev, processed: i + 1, errors: [...prev.errors, msg] }));
          setImportResults(prev => ({
            ...prev,
            failed: [...prev.failed, { row: i + 1, name: currentItem.name || 'Unnamed', reason: msg }]
          }));

          // Pause on error same as product page
          await new Promise((resolve) => {
            setImportPause({ active: true, error: msg, resolve });
          });
          continue;
        }

        // Duplicate check within file and existing state
        const normalizedMobile = sanitizeMobileNumber(customer.mobileNumber);
        const isDuplicate = processedMobiles.has(normalizedMobile) || state.customers.some(
          c => !c.isDeleted && sanitizeMobileNumber(c.mobileNumber || c.phone) === normalizedMobile
        );

        if (isDuplicate) {
          const msg = `Row ${i + 1}: Duplicate mobile number detected (${customer.mobileNumber})`;
          errors.push(msg);
          setImportProgress(prev => ({ ...prev, processed: i + 1, errors: [...prev.errors, msg] }));
          setImportResults(prev => ({
            ...prev,
            failed: [...prev.failed, { row: i + 1, name: customer.name || 'Unnamed', reason: 'Duplicate mobile number' }]
          }));

          // Pause on duplicate error
          await new Promise((resolve) => {
            setImportPause({ active: true, error: msg, resolve });
          });
          continue;
        }

        const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const newCustomer = {
          ...customer,
          id: newId,
          localId: newId,
          sellerId: sellerId,
          createdAt: new Date().toISOString(),
          isActive: true,
          isDeleted: false,
          isSynced: false
        };

        dispatch({ type: 'ADD_CUSTOMER', payload: newCustomer });

        // Handle opening balance transaction if applicable
        if (newCustomer.dueAmount !== 0) {
          const transaction = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            sellerId: sellerId,
            customerId: newId,
            type: newCustomer.dueAmount > 0 ? 'opening_balance' : 'payment',
            amount: Math.abs(newCustomer.dueAmount),
            date: new Date().toISOString(),
            description: newCustomer.dueAmount > 0 ? 'Opening Balance (Import)' : 'Opening Advance (Import)',
            previousBalance: 0,
            currentBalance: newCustomer.dueAmount,
            isSynced: false,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
          };
          dispatch({ type: ActionTypes.ADD_CUSTOMER_TRANSACTION, payload: transaction });
        }

        processedMobiles.add(normalizedMobile);
        successCount++;
        setImportProgress(prev => ({ ...prev, processed: i + 1, success: successCount }));
        setImportResults(prev => ({
          ...prev,
          success: [...prev.success, { row: i + 1, name: newCustomer.name, detail: newCustomer.mobileNumber }]
        }));
      }

      setProcessingItem(null);

      if (successCount > 0) {
        if (window.showToast) {
          window.showToast(
            `Successfully imported ${successCount} customers${errors.length > 0 ? `. ${errors.length} error(s) occurred.` : ''}`,
            errors.length > 0 ? 'warning' : 'success'
          );
        }
      }

      setTimeout(() => {
        setIsImporting(false);
        setShowImportModal(false);
        setImportFile(null);
        setShowImportResults(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setFileFormatStatus(null);
      }, 1000);

    } catch (error) {
      setIsImporting(false);
      setProcessingItem(null);
      if (window.showToast) window.showToast(`Import error: ${error.message}`, 'error');
    }
  };

  const handleCloseResults = () => {
    setShowImportResults(false);
    setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
    setImportResults({ success: [], failed: [] });
  };

  const handleCancelImport = () => {
    cancelImportRef.current = true;
    setIsImporting(false);
    setProcessingItem(null);
    setShowImportModal(false);
    setImportFile(null);
    // setImportProgress({ total: 0, processed: 0, success: 0, errors: [] }); // REMOVED to show results in summary modal
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileFormatStatus(null);
    setShowMapping(false);
    setImportPause(prev => {
      if (prev.resolve) prev.resolve();
      return { active: false, error: null, resolve: null };
    });
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Simple Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 dark:text-blue-400 shrink-0">
            <Users className="h-7 w-7 sm:h-8 sm:w-8" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              {getTranslation('customers', state.currentLanguage)}
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">
              {getTranslation('customersSubtitle', state.currentLanguage)}
            </p>
            {(!isUnlimited(maxCustomers) && remainingCustomers < 15) && (
              <p className="text-xs mt-2 inline-flex items-center px-2 py-1 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                <AlertCircle className="h-3 w-3 mr-1" />
                {getTranslation('customerLimitLeft', state.currentLanguage)}: {remainingCustomers}
              </p>
            )}
          </div>
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
            <button
              onClick={() => setShowImportModal(true)}
              className="btn-secondary flex items-center text-sm dark:text-slate-200"
            >
              <Upload className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Import</span>
              <span className="sm:hidden">Import</span>
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
            <div className="text-center py-20 px-4 rounded-3xl bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 shadow-sm">
              <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="h-10 w-10 text-blue-500 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {searchTerm ? getTranslation('noCustomersFound', state.currentLanguage) : 'Start Building Your Client Base'}
              </h3>
              <p className="text-gray-500 dark:text-slate-400 mb-8 max-w-sm mx-auto">
                {searchTerm ? getTranslation('adjustSearchTerms', state.currentLanguage) : 'Keep track of your customers, their order history, and outstanding balances all in one place.'}
              </p>
              {!searchTerm && (
                <button
                  onClick={handleOpenAddModal}
                  className="btn-primary inline-flex items-center gap-2 px-6 py-3"
                >
                  <Plus className="h-5 w-5" />
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

      {/* Import Modal */}
      {showImportModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-white dark:bg-slate-900 z-[200] flex flex-col animate-in fade-in duration-200">
          <div className="w-full h-full flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-2 sm:p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
                  <Upload className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white leading-tight">
                    Import Customers
                  </h3>
                  <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Upload your customer data in CSV or JSON format
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelImport}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
              >
                <X className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50 dark:bg-black/20">

              {/* Instructions Card */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                  <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-slate-900 dark:text-white text-base mb-1">
                      Customer Data Format
                    </h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                      To ensure your customers are imported correctly, your file <b>must</b> follow the structure below.
                      The first row should contain the headers.
                    </p>

                    {/* Visual Table Guide */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                      {/* Desktop Table View */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="px-4 py-3 whitespace-nowrap">name <span className="text-red-500">*</span></th>
                              <th className="px-4 py-3 whitespace-nowrap">mobileNumber <span className="text-red-500">*</span></th>
                              <th className="px-4 py-3 whitespace-nowrap">email</th>
                              <th className="px-4 py-3 whitespace-nowrap">address</th>
                              <th className="px-4 py-3 whitespace-nowrap">dueAmount</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-slate-900 divide-y divide-indigo-50 dark:divide-slate-800">
                            <tr className="text-slate-600 dark:text-slate-400">
                              <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white border-r border-dashed border-indigo-100 dark:border-slate-800">John Doe</td>
                              <td className="px-4 py-2.5">9876543210</td>
                              <td className="px-4 py-2.5">john@example.com</td>
                              <td className="px-4 py-2.5">123 Street, City</td>
                              <td className="px-4 py-2.5">500</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Badge View */}
                      <div className="md:hidden p-4 bg-white dark:bg-slate-900">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Required & Optional Headers:</p>
                        <div className="flex flex-wrap gap-2">
                          {CUSTOMER_SYSTEM_FIELDS.map((field) => (
                            <div
                              key={field.key}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${field.required
                                ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/40 text-red-600 dark:text-red-400'
                                : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                }`}
                            >
                              {field.label}
                              {field.required && <span className="ml-1 text-red-500">*</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                        Allowed: .csv, .json
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload Section */}
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="customer-import-upload"
                />

                {!importFile ? (
                  <label
                    htmlFor="customer-import-upload"
                    className="group relative flex flex-col items-center justify-center p-10 border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 hover:bg-white dark:bg-slate-800/50 dark:hover:bg-slate-800 rounded-2xl cursor-pointer transition-all duration-200 hover:border-blue-500 dark:hover:border-blue-500"
                  >
                    <div className="p-4 rounded-full bg-white dark:bg-slate-700 shadow-sm group-hover:scale-110 group-hover:shadow-md transition-all duration-200 mb-4">
                      <Upload className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                    </div>
                    <p className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-1">
                      Click to upload file
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      or drag and drop CSV/JSON here
                    </p>
                  </label>
                ) : (
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-900/10 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-semibold text-slate-900 dark:text-white truncate">
                            {importFile.name}
                          </p>
                          {fileFormatStatus === 'valid' && mappingStatus.isComplete && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                              <CheckCircle2 className="h-3 w-3" />
                              Eligible
                            </span>
                          )}
                          {(fileFormatStatus === 'invalid' || (fileFormatStatus === 'valid' && !mappingStatus.isComplete)) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                              <AlertCircle className="h-3 w-3" />
                              Not Eligible
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {(importFile.size / 1024).toFixed(1)} KB
                        </p>
                        {fileFormatStatus === 'invalid' && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium bg-red-50 dark:bg-red-900/10 p-2 rounded-lg border border-red-100 dark:border-red-900/20">
                            {fileFormatMessage}
                          </p>
                        )}
                        {fileFormatStatus === 'valid' && !mappingStatus.isComplete && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium bg-amber-50 dark:bg-amber-900/10 p-2 rounded-lg border border-amber-100 dark:border-amber-900/20">
                            {mappingStatus.reason}
                          </p>
                        )}
                        {fileFormatStatus === 'valid' && parsedCustomers.length > 0 && (
                          <div className="flex items-center gap-2 mt-2 text-xs">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {parsedCustomers.length} Customers Found
                            </span>
                            {importLimitExceeded ? (
                              <span className="text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                                Limit Exceeded
                              </span>
                            ) : (
                              <span className="text-green-600 dark:text-green-400 font-bold">
                                Ready to Import
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setImportFile(null);
                          setShowMapping(false);
                          setImportProgress({ total: 0, processed: 0, success: 0, errors: [] });
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>

                    {/* Field Mapping Step */}
                    {showMapping && (
                      <div className="mt-6 border-t border-slate-100 dark:border-slate-700 pt-5">
                        <div className="flex items-center justify-between mb-4">
                          <h5 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                            Map File Fields
                          </h5>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium italic">
                            Match your file columns to system fields
                          </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                          {CUSTOMER_SYSTEM_FIELDS.map((field) => (
                            <div key={field.key} className={`grid grid-cols-1 sm:grid-cols-2 gap-3 items-center p-3 rounded-xl transition-all ${field.required && !fieldMappings[field.key]
                              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30 shadow-sm'
                              : 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800 hover:border-blue-200 dark:hover:border-blue-900/30'
                              } border`}>
                              <div>
                                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                  <span className="flex items-center gap-1.5">
                                    {field.label}
                                    {field.required && <span className="text-red-500 font-black">*</span>}
                                  </span>
                                </label>
                              </div>
                              <select
                                value={fieldMappings[field.key] || ''}
                                onChange={(e) => setFieldMappings(prev => ({ ...prev, [field.key]: e.target.value }))}
                                className={`w-full text-xs py-2 px-3 rounded-lg border focus:ring-2 focus:ring-blue-500/20 outline-none transition-all ${fieldMappings[field.key]
                                  ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 border-dashed'
                                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                  }`}
                              >
                                <option value="">-- Ignore Field --</option>
                                {detectedFields.map(df => (
                                  <option key={df} value={df}>{df}</option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Progress Section */}
              {isImporting && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-lg animate-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        Importing Customers...
                      </p>
                    </div>
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                      {Math.round((importProgress.processed / importProgress.total) * 100)}%
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mb-4 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${(importProgress.processed / importProgress.total) * 100}%` }}
                    ></div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total</p>
                      <p className="text-lg font-bold text-slate-900 dark:text-white">{importProgress.total}</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/10 p-3 rounded-xl border border-green-100 dark:border-green-900/20 text-center">
                      <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Success</p>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400">{importProgress.success}</p>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/10 p-3 rounded-xl border border-red-100 dark:border-red-900/20 text-center">
                      <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Errors</p>
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">{importProgress.errors.length}</p>
                    </div>
                  </div>

                  {processingItem && (
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 italic">
                      <span className="inline-block w-1 h-1 rounded-full bg-slate-400 animate-pulse"></span>
                      Now processing: <span className="font-bold text-slate-700 dark:text-slate-200">{processingItem.name}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Summary of Errors */}
              {importProgress.errors.length > 0 && !isImporting && (
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-2xl p-5">
                  <h5 className="text-sm font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Import Errors ({importProgress.errors.length})
                  </h5>
                  <div className="max-h-40 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {importProgress.errors.map((error, idx) => (
                      <p key={idx} className="text-xs text-red-600 dark:text-red-400 bg-white/50 dark:bg-black/20 p-2 rounded-lg border border-red-50 dark:border-red-900/30">
                        {error}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-6 border-t border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row items-center gap-3 sm:justify-between bg-white dark:bg-slate-900 shrink-0">
              <div className="text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
                {importLimitExceeded ? (
                  limitExceededInfo?.available === 0 ? (
                    <span className="text-red-500 font-bold flex items-center gap-1 sm:justify-start justify-center">
                      <AlertCircle className="h-4 w-4" />
                      Plan limit reached! (0 slots left). Please upgrade to continue.
                    </span>
                  ) : (
                    <span className="text-amber-500 font-bold flex items-center gap-1 sm:justify-start justify-center">
                      <AlertTriangle className="h-3 w-3" />
                      Plan limit exceeded. You can only import {limitExceededInfo?.available} more customers.
                    </span>
                  )
                ) : (
                  "Ready to import your customers. This action cannot be undone."
                )}
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  disabled={isImporting}
                  onClick={handleCancelImport}
                  className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all disabled:opacity-50"
                >
                  {importProgress.success > 0 ? 'Close' : 'Cancel'}
                </button>
                <button
                  onClick={() => {
                    if (importLimitExceeded) {
                      setShowLimitConfirmation(true);
                    } else {
                      importCustomersAction();
                    }
                  }}
                  disabled={!importFile || isImporting || !mappingStatus.isComplete || (importLimitExceeded && limitExceededInfo?.available === 0)}
                  className={`flex-1 sm:flex-none px-8 py-2.5 text-sm font-bold bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:shadow-none transition-all flex items-center justify-center gap-2 ${isImporting ? 'animate-pulse' : ''}`}
                >
                  {isImporting ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Start Import
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Limit Confirmation Modal */}
      {showLimitConfirmation && limitExceededInfo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 border border-amber-100 dark:border-amber-900/30">
            <div className="bg-amber-50 dark:bg-amber-900/10 p-6 flex flex-col items-center text-center border-b border-amber-100 dark:border-amber-900/20">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4 shadow-inner">
                <AlertTriangle className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-amber-900 dark:text-amber-300">Insufficient Plan Limit</h3>
              <p className="mt-2 text-sm text-amber-800/80 dark:text-amber-400/80 leading-relaxed">
                You are trying to import <b>{limitExceededInfo.toImport}</b> customers, but your plan only has space for <b>{limitExceededInfo.available}</b> more.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  <span>Import Detail</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Available Limit</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{limitExceededInfo.available}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">File Data</span>
                  <span className="text-sm font-bold text-slate-900 dark:text-white">{limitExceededInfo.toImport}</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <span className="text-sm font-bold text-blue-600">To be Imported</span>
                  <span className="text-sm font-black text-blue-600">{limitExceededInfo.available}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 text-center italic">
                Only the first {limitExceededInfo.available} customers will be synced.
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => setShowLimitConfirmation(false)}
                  className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => importCustomersAction(limitExceededInfo.available)}
                  className="px-4 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all"
                >
                  Confirm & Sync
                </button>
              </div>
              <button
                onClick={() => {
                  setShowLimitConfirmation(false);
                  if (typeof navigate === 'function') {
                    navigate('/settings/subscription');
                  } else {
                    window.location.hash = '/settings/subscription';
                  }
                }}
                className="w-full py-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm hover:bg-black transition-all flex items-center justify-center gap-2 mt-1"
              >
                <Plus className="h-4 w-4" />
                Upgrade Plan for Full Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Results Modal */}
      {showImportResults && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-white dark:bg-slate-900 z-[210] flex flex-col animate-in fade-in duration-300">
          <div className="w-full h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-indigo-600 dark:text-indigo-400">
                  <ListChecks className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import Summary</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Final results for your customer import</p>
                </div>
              </div>
              <button
                onClick={handleCloseResults}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50 dark:bg-black/20 custom-scrollbar">
              {/* Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Items</p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">{importResults.success.length + importResults.failed.length}</p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-2xl border border-green-100 dark:border-green-900/20 text-center">
                  <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Success</p>
                  <p className="text-2xl font-black text-green-600 dark:text-green-400">{importResults.success.length}</p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-2xl border border-red-100 dark:border-red-900/20 text-center">
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Failed</p>
                  <p className="text-2xl font-black text-red-600 dark:text-red-400">{importResults.failed.length}</p>
                </div>
              </div>

              {/* Detailed Lists */}
              <div className="space-y-4">
                {/* Failed Items */}
                {importResults.failed.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-2 px-1">
                      <AlertTriangle className="h-4 w-4" />
                      Failed Items Details
                    </h4>
                    <div className="space-y-2">
                      {importResults.failed.map((item, idx) => (
                        <div key={idx} className="bg-red-50/50 dark:bg-red-900/5 p-3 rounded-xl border border-red-100/50 dark:border-red-900/20 flex items-start gap-3">
                          <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] font-bold">
                            #{item.row}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{item.name}</p>
                            <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 italic leading-relaxed">
                              {item.reason}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Successful Items */}
                {importResults.success.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider flex items-center gap-2 px-1">
                      <CheckCircle2 className="h-4 w-4" />
                      Successfully Imported
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {importResults.success.map((item, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
                          <div className="shrink-0 w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{item.name}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{item.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 sm:p-6 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                onClick={handleCloseResults}
                className="w-full sm:w-auto px-10 py-3.5 bg-slate-900 dark:bg-blue-600 text-white rounded-xl font-bold text-sm shadow-xl active:scale-[0.98] transition-all"
              >
                Got it, Thanks!
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* Processing Loader Overlay - Same as Product Page */}
      {
        isImporting && processingItem && !importPause.active && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-white/20 animate-in zoom-in-95 duration-200 text-center">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-full border-4 border-slate-100 dark:border-slate-800"></div>
                <div
                  className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0% 100%)' }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center font-black text-blue-600">
                  {Math.floor((processingItem.index / processingItem.total) * 100)}%
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Importing Customer
              </h3>
              <div className="flex flex-col gap-1 items-center">
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400 truncate max-w-full italic px-4">
                  "{processingItem.name}"
                </span>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                  Processing {processingItem.index} of {processingItem.total}
                </span>
              </div>
              <div className="mt-8 flex justify-center">
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      }

      {/* Import Error Pause Modal - Same as Product Page */}
      {
        importPause.active && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[400] bg-red-950/40 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-0 max-w-md w-full shadow-2xl border border-red-200 dark:border-red-900/30 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="bg-red-50 dark:bg-red-900/10 p-6 flex flex-col items-center text-center border-b border-red-100 dark:border-red-900/20">
                <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 mb-4 shadow-inner">
                  <AlertTriangle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-red-900 dark:text-red-100 uppercase tracking-tight">Import Paused</h3>
                <p className="text-xs text-red-600 dark:text-red-400/80 font-bold uppercase tracking-widest mt-1">An error occurred in your data</p>
              </div>
              <div className="p-8">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 mb-8 shadow-sm">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-relaxed italic">
                    "{importPause.error}"
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      const resolve = importPause.resolve;
                      setImportPause({ active: false, error: null, resolve: null });
                      if (resolve) resolve();
                    }}
                    className="w-full py-4 rounded-2xl bg-slate-900 dark:bg-blue-600 text-white font-bold text-sm shadow-xl hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>SKIP AND CONTINUE IMPORT</span>
                  </button>
                  <button
                    onClick={handleCancelImport}
                    className="w-full py-3 rounded-2xl text-slate-400 hover:text-red-500 font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    <span>Cancel Entire Process</span>
                  </button>
                </div>
              </div>
              <div className="px-8 py-4 bg-slate-50/50 dark:bg-transparent text-[10px] text-center text-slate-400 font-medium">
                You can fix this error in your file and try importing again later if needed.
              </div>
            </div>
          </div>,
          document.body
        )
      }
    </div >
  );
};

export default Customers;
