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
import AddSupplierModal from './AddSupplierModal';
import EditSupplierModal from './EditSupplierModal';
import SupplierPaymentModal from './SupplierPaymentModal';
import PaymentAllocationModal from './PaymentAllocationModal';

import HistorySelectionModal from './HistorySelectionModal';
import SupplierTransactionHistoryModal from './SupplierTransactionHistoryModal';
import SupplierOrderHistoryModal from './SupplierOrderHistoryModal';
import WhatsAppBillModal from './WhatsAppBillModal';

import { getPlanLimits, getRemainingCapacity, isUnlimited } from '../../utils/planUtils'; // Not used for suppliers but imported for consistency check if needed
import { sanitizeMobileNumber } from '../../utils/validation';

import { getAllItems, addItem, STORES, updateItem } from '../../utils/indexedDB';
import { formatDate } from '../../utils/dateUtils';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
import syncService from '../../services/syncService';

const Suppliers = () => {
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


  // History Modals
  const [showHistorySelectionModal, setShowHistorySelectionModal] = useState(false);
  const [showSupplierOrderHistoryModal, setShowSupplierOrderHistoryModal] = useState(false);
  // const [orderHistorySupplier, setOrderHistorySupplier] = useState(null); // Not needed as we use historySupplier
  const [showTransactionHistoryModal, setShowTransactionHistoryModal] = useState(false);
  const [historySupplier, setHistorySupplier] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState(null);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsAppSupplier, setWhatsAppSupplier] = useState(null);
  const exportMenuRef = useRef(null);

  // Refresh Purchase Orders (VendorOrders)
  useEffect(() => {
    let isActive = true;

    const refreshPurchaseOrdersFromIndexedDB = async () => {
      try {
        const indexedDBOrders = await getAllItems(STORES.purchaseOrders).catch(() => []);
        if (!isActive) return;

        const normalizedOrders = (indexedDBOrders || []).filter(order => order && order.isDeleted !== true);
        const currentOrders = (state.purchaseOrders || []).filter(order => order && order.isDeleted !== true);

        if (normalizedOrders.length !== currentOrders.length) {
          dispatch({
            type: ActionTypes.SET_PURCHASE_ORDERS,
            payload: normalizedOrders
          });
          return;
        }

        // Deep compare/sync logic could be added here similar to Customers.js
      } catch (error) {
        console.warn('Error refreshing purchase orders', error);
      }
    };

    refreshPurchaseOrdersFromIndexedDB();

    const handleFocus = () => refreshPurchaseOrdersFromIndexedDB();
    window.addEventListener('focus', handleFocus);

    return () => {
      isActive = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [dispatch, state.purchaseOrders]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (exportMenuRef.current && typeof exportMenuRef.current.contains === 'function' && event.target && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut
  useKeyboardShortcut('n', false, true, () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        // Assuming generic message or add 'planExpiredAddSupplier' key later
        window.showToast('Plan expired. Please upgrade to add suppliers.', 'warning', 8000);
      }
      return;
    }
    setShowAddModal(true);
  });

  // Responsive pagination
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    const updateItemsPerPage = () => {
      if (window.innerWidth >= 1025) {
        setItemsPerPage(25);
      } else {
        setItemsPerPage(10);
      }
    };

    updateItemsPerPage();
    window.addEventListener('resize', updateItemsPerPage);
    return () => window.removeEventListener('resize', updateItemsPerPage);
  }, []);

  const activeSuppliers = useMemo(() => {
    return (state.suppliers || [])
      .filter(supplier => !supplier.isDeleted)
      .sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return dateB - dateA;
      });
  }, [state.suppliers]);

  // Use memoized live supplier to ensure Modals receive latest updates (e.g. from sync)
  const activeSupplier = useMemo(() => {
    if (!selectedSupplier) return null;
    return state.suppliers.find(s => s.id === selectedSupplier.id) || selectedSupplier;
  }, [selectedSupplier, state.suppliers]);

  // Filter suppliers
  const filteredSuppliers = activeSuppliers.filter(supplier => {
    const mobileNumber = supplier.mobileNumber || supplier.phone || '';
    const matchesSearch = (
      (supplier.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      mobileNumber.includes(searchTerm) ||
      (supplier.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const rawBalance = supplier.balanceDue ?? supplier.dueAmount ?? 0;
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
  const totalPages = Math.ceil(filteredSuppliers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedSuppliers = filteredSuppliers.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, itemsPerPage]);

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Simplified ellipsis logic
      if (currentPage <= 3) {
        [1, 2, 3, 4, 'ellipsis', totalPages].forEach(p => pages.push(p));
      } else if (currentPage >= totalPages - 2) {
        [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages].forEach(p => pages.push(p));
      } else {
        [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages].forEach(p => pages.push(p));
      }
    }
    return pages;
  };

  // Calculate stats for payment modal
  const dueOrders = useMemo(() => {
    if (!selectedSupplier || !state.purchaseOrders) return [];

    const supplierName = (selectedSupplier.name || '').trim().toLowerCase();

    return state.purchaseOrders.filter(order => {
      if (order.isDeleted) return false;
      const orderSupplier = (order.supplierName || '').trim().toLowerCase();
      if (orderSupplier !== supplierName) return false;

      // Filter for Due Orders (Standard)
      // Must NOT be cancelled (unless we want to pay for cancelled orders? No).
      if (order.status === 'cancelled') return false;

      const total = Number(order.total || 0);
      const paid = Number(order.amountPaid || 0);
      const due = order.balanceDue !== undefined ? Number(order.balanceDue) : Math.max(0, total - paid);

      return due > 0.01;
    });
  }, [selectedSupplier, state.purchaseOrders]);

  const dueOrdersStats = useMemo(() => ({
    count: dueOrders.length,
    total: dueOrders.reduce((sum, o) => sum + (o.balanceDue || (o.total - o.amountPaid)), 0)
  }), [dueOrders]);

  const refundableOrders = useMemo(() => {
    if (!selectedSupplier || !state.purchaseOrders) return [];
    const supplierName = (selectedSupplier.name || '').trim().toLowerCase();

    return state.purchaseOrders.filter(order => {
      if (order.isDeleted) return false;
      const orderSupplier = (order.supplierName || '').trim().toLowerCase();
      if (orderSupplier !== supplierName) return false;

      // Filter for Refundable Orders (Cancelled with Payment)
      if (order.status !== 'cancelled') return false;
      const paid = Number(order.amountPaid || 0);
      return paid > 0.01;
    });
  }, [selectedSupplier, state.purchaseOrders]);

  const refundableOrdersStats = useMemo(() => ({
    count: refundableOrders.length,
    total: refundableOrders.reduce((sum, o) => sum + (Number(o.amountPaid) || 0), 0)
  }), [refundableOrders]);


  const handleAddSupplier = (supplierData) => {
    const newSupplier = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      ...supplierData,
      createdAt: new Date().toISOString()
    };
    newSupplier.localId = newSupplier.id;

    dispatch({ type: ActionTypes.ADD_SUPPLIER, payload: newSupplier });

    // Create opening balance transaction if needed
    const initialBalance = parseFloat(supplierData.dueAmount || 0);
    if (initialBalance !== 0) {
      const transaction = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        sellerId: supplierData.sellerId || state.currentUser?.sellerId || state.currentUser?.id,
        supplierId: newSupplier.id,
        type: initialBalance >= 0 ? 'opening_balance' : 'payment',
        amount: Math.abs(initialBalance),
        date: new Date().toISOString(),
        description: initialBalance >= 0 ? 'Opening Balance (Payable)' : 'Opening Advance',
        previousBalance: 0,
        currentBalance: initialBalance,
        isSynced: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
      };
      dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: transaction });
    }

    setShowAddModal(false);
    return true;
  };

  const handleEditSupplier = (supplierData) => {
    if (isPlanExpired(state)) {
      if (window.showToast) window.showToast('Plan expired.', 'warning');
      return;
    }

    const oldSupplier = state.suppliers.find(c =>
      (c.id && c.id === supplierData.id) ||
      (c._id && c._id === supplierData.id) ||
      (supplierData._id && c._id === supplierData._id) ||
      (supplierData.localId && supplierData.localId === c.id)
    );

    if (oldSupplier) {
      const oldDue = parseFloat(oldSupplier.dueAmount || oldSupplier.balanceDue || 0);
      const newDue = parseFloat(supplierData.dueAmount || supplierData.balanceDue || 0);
      const diff = newDue - oldDue;

      if (Math.abs(diff) > 0.01) {
        const transaction = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          sellerId: supplierData.sellerId || oldSupplier.sellerId,
          supplierId: supplierData._id || supplierData.id,
          type: diff > 0 ? 'due' : 'payment', // Due means we owe MORE. Payment means we owe LESS.
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

        dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: transaction });

        supplierData.isSynced = false;
        supplierData.syncedAt = undefined;
      }
    }

    dispatch({ type: ActionTypes.UPDATE_SUPPLIER, payload: supplierData });
    setShowEditModal(false);
    setSelectedSupplier(null);
  };

  const handleDeleteSupplier = (supplierId) => {
    if (isPlanExpired(state)) {
      if (window.showToast) window.showToast('Plan expired.', 'warning');
      return;
    }
    const supplier = state.suppliers.find(s => s.id === supplierId);

    if (supplier && (supplier.balanceDue || 0) !== 0) {
      if (window.showToast) {
        window.showToast(`Cannot delete supplier with outstanding balance: ${Math.abs(supplier.balanceDue || 0).toFixed(2)}`, 'error');
      }
      return;
    }

    setSupplierToDelete(supplier);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteSupplier = () => {
    if (supplierToDelete) {
      dispatch({ type: ActionTypes.DELETE_SUPPLIER, payload: supplierToDelete.id });
      if (window.showToast) {
        window.showToast('Supplier deleted.', 'success');
      }
    }
    setShowDeleteConfirm(false);
    setSupplierToDelete(null);
  };

  const handlePayment = (supplier) => {
    setSelectedSupplier(supplier);
    setShowPaymentModal(true);
  };

  const handleViewTransactionHistory = (supplier) => {
    setHistorySupplier(supplier);
    setShowHistorySelectionModal(true);
  };

  // Logic for Transaction History
  const getSupplierTransactions = (supplierId) => {
    // Robust matching of ID
    const targetIds = [supplierId].filter(Boolean).map(id => id.toString());
    if (selectedSupplier) {
      targetIds.push(selectedSupplier.id, selectedSupplier._id, selectedSupplier.localId);
    }

    const uniqueTargetIds = [...new Set(targetIds.filter(Boolean).map(id => id.toString()))];

    return (state.supplierTransactions || []).filter(t => {
      const tSupId = t.supplierId ? t.supplierId.toString() : '';
      return uniqueTargetIds.includes(tSupId) && !t.isDeleted;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  // Process Payment (Paying Supplier or Receiving Refund)
  const processPayment = async (amount, paymentType, description, allocationMap = {}) => {
    // ... (Logics for balancing remain same, omitted for brevity in replacement if unchanged, but I need to include updated Order processing) ...
    // RE-INCLUSION of processPayment Logic with UPDATES:

    // Use live supplier data to prevent overwriting with stale state
    const currentSupplier = state.suppliers.find(s => s.id === selectedSupplier.id) || selectedSupplier;

    const currentBalanceRaw = currentSupplier.dueAmount ?? currentSupplier.balanceDue ?? 0;
    const currentBalance = parseFloat(currentBalanceRaw) || 0;
    const paymentAmount = parseFloat(amount) || 0;

    let newBalance = currentBalance;
    if (paymentType === 'give') {
      newBalance = parseFloat((currentBalance - paymentAmount).toFixed(2));
    } else {
      // 'receive' - Refund/Add Due
      newBalance = parseFloat((currentBalance + paymentAmount).toFixed(2));
    }

    // NEW: Handle Order Allocations
    if (Object.keys(allocationMap).length > 0) {
      const updatedOrders = [];

      for (const [orderId, allocatedAmount] of Object.entries(allocationMap)) {
        const order = state.purchaseOrders.find(o => o.id === orderId);
        if (order) {
          const currentPaid = Number(order.amountPaid || 0);
          let newPaid = currentPaid;
          let newDue = 0;

          if (paymentType === 'receive') {
            // Refund Logic: Decrease Paid Amount
            newPaid = Math.max(0, currentPaid - allocatedAmount);
            // If cancelled, due stays 0. Else calc due.
            if (order.status === 'cancelled') {
              newDue = 0;
            } else {
              newDue = Math.max(0, (Number(order.total || 0) - newPaid));
            }
          } else {
            // Payment Logic: Increase Paid Amount
            const currentDue = order.balanceDue !== undefined ? Number(order.balanceDue) : (Number(order.total || 0) - currentPaid);
            newPaid = currentPaid + allocatedAmount;
            newDue = Math.max(0, currentDue - allocatedAmount);
          }

          const updatedOrder = {
            ...order,
            amountPaid: newPaid,
            balanceDue: newDue,
            // Update statuses
            paymentStatus: newDue <= 0.01 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid'),
            isSynced: false,
            updatedAt: new Date().toISOString()
          };

          // Special status fix for cancelled refunds
          if (paymentType === 'receive' && order.status === 'cancelled') {
            // If fully refunded (paid == 0), maybe we can say it's settled?
            // But status is 'cancelled'. Leave it.
          }

          updatedOrders.push(updatedOrder);

          // Update IndexedDB
          await updateItem(STORES.purchaseOrders, updatedOrder);
        }
      }

      // Update State
      if (updatedOrders.length > 0) {
        const newOrdersList = state.purchaseOrders.map(o => {
          const updated = updatedOrders.find(u => u.id === o.id);
          return updated || o;
        });
        dispatch({ type: ActionTypes.SET_PURCHASE_ORDERS, payload: newOrdersList });
      }
    }

    const updatedSupplier = {
      ...currentSupplier,
      dueAmount: newBalance,
      balanceDue: newBalance,
      isSynced: false,
      isUpdate: true,
      syncedAt: undefined
    };

    const transaction = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      localId: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      sellerId: currentSupplier.sellerId,
      supplierId: currentSupplier._id || currentSupplier.id,
      type: paymentType === 'give' ? 'payment' : 'refund', // Use 'refund' type? Or 'add_due'? History modal handles 'refund'. Let's use 'refund' for 'receive' here?
      // Wait, history modal handles 'refund' type. Previous logic used 'add_due' for 'receive', but 'refund' is better if it is a refund.
      // But 'receive' covers 'add_due' (Purchase on Credit) too?
      // If we are allocating to cancelled orders, it is DEFINITELY a refund.
      // If no allocation, it might be just money received.
      // Let's stick to: if paymentType is 'receive', use 'refund' if it's decreasing paid amount, or 'add_due' if it isn't? 
      // User requested "Receive Refund" so let's use 'refund' type to match new history logic.
      amount: paymentAmount,
      date: new Date().toISOString(),
      description: description ? description : (paymentType === 'give' ? 'Payment to Supplier' : 'Refund Received'),
      note: description,
      previousBalance: currentBalance,
      currentBalance: newBalance,
      isSynced: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      userInfo: state.currentUser ? { name: state.currentUser.displayName, email: state.currentUser.email } : null
    };

    dispatch({ type: ActionTypes.ADD_SUPPLIER_TRANSACTION, payload: transaction });
    dispatch({ type: ActionTypes.UPDATE_SUPPLIER, payload: updatedSupplier });

    setShowPaymentModal(false);
    setSelectedSupplier(null);
    if (window.showToast) window.showToast('Transaction recorded successfully.', 'success');
  };

  const handlePaymentSubmit = (amount, paymentType, description) => {
    // Check for due orders if we are paying the supplier
    if (paymentType === 'give' && dueOrdersStats.count > 0 && amount > 0) {
      setAllocationData({
        amount,
        paymentType,
        description,
        supplier: activeSupplier
      });
      setShowPaymentModal(false);
      setShowAllocationModal(true);
      return;
    }

    // Check for refundable orders if we are receiving refund
    if (paymentType === 'receive' && refundableOrdersStats.count > 0 && amount > 0) {
      setAllocationData({
        amount,
        paymentType,
        description,
        supplier: activeSupplier
      });
      setShowPaymentModal(false);
      setShowAllocationModal(true);
      return;
    }

    processPayment(amount, paymentType, description);
  };

  const handleAllocationConfirm = async (allocationMap) => {
    if (!allocationData) return;
    const { amount, paymentType, description } = allocationData;

    // Process the payment with allocation
    await processPayment(amount, paymentType, description, allocationMap);

    setShowAllocationModal(false);
    setAllocationData(null);
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
  const exportSuppliersPDF = async () => {
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

      // Add Watermark
      const addWatermark = (pdfDoc) => {
        const totalPages = pdfDoc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
          pdfDoc.setPage(i);
          pdfDoc.saveGraphicsState();
          pdfDoc.setGState(new pdfDoc.GState({ opacity: 0.03 }));
          pdfDoc.setFontSize(60);
          pdfDoc.setFont('helvetica', 'bold');
          pdfDoc.setTextColor(...COLORS.primary);
          pdfDoc.text('SUPPLIER REPORT', pageWidth / 2, pageHeight / 2, {
            align: 'center',
            angle: 45
          });
          pdfDoc.restoreGraphicsState();
        }
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
          doc.addImage(base64, 'PNG', logoX, logoY, logoSize, logoSize);
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
      safeDrawText(doc, 'Supplier Report', pageWidth - margin, logoY + 5, { align: 'right', color: '#000000', fontSize: 14 });

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

      const total = state.suppliers.length;
      const dueCount = state.suppliers.filter(c => (c.balanceDue || 0) > 0).length;
      const dueSum = state.suppliers.reduce((sum, c) => sum + (c.balanceDue || 0), 0);

      const metrics = [
        { label: 'Total Suppliers', value: total.toString(), color: COLORS.primary },
        { label: 'With Balance Due', value: dueCount.toString(), color: COLORS.secondary },
        { label: 'Total Outstanding', value: formatPDFCurrency(dueSum), color: COLORS.gray }
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
      safeDrawText(doc, 'Supplier List', margin, y, { color: '#000000', fontSize: 10.5 });
      y += 6.5;

      const headers = [
        'S.No.',
        'Supplier Name',
        'Mobile',
        'Email',
        { text: 'Balance Due', align: 'right' }
      ];

      // Portrait Weights (Total ~180mm)
      const colWeights = [
        { w: 15, align: 'center' }, // S.No.
        { w: 55, align: 'center' }, // Name
        { w: 35, align: 'center' }, // Mobile
        { w: 45, align: 'center' }, // Email
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

      state.suppliers.forEach((supplier, index) => {
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
        safeDrawText(doc, supplier.name.substring(0, 30), rowX + (colWeights[1].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[1].w;

        // Mobile (Centered)
        safeDrawText(doc, supplier.mobileNumber || supplier.phone || '-', rowX + (colWeights[2].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[2].w;

        // Email (Centered)
        safeDrawText(doc, supplier.email || '-', rowX + (colWeights[3].w / 2), y + 6.5, { align: 'center', color: '#000000', fontSize: 9 });
        rowX += colWeights[3].w;

        // Balance (Centered)
        const balance = supplier.balanceDue || 0;
        if (balance > 0) doc.setTextColor(220, 38, 38); // Red for debt
        else if (balance < 0) doc.setTextColor(16, 185, 129); // Green for credit
        else doc.setTextColor(...COLORS.black);

        doc.setFont('helvetica', 'bold');
        safeDrawText(doc, formatPDFCurrency(balance), rowX + (colWeights[4].w / 2), y + 6.5, { align: 'center', fontSize: 9 });
        doc.setFont('helvetica', 'normal');

        y += rowH;
      });

      /* ================= FOOTER ================= */
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.gray);
        doc.text(`Page ${i} of ${totalPages}`, margin, pageHeight - 10);
        doc.text(`${state.storeName || 'Store'} - Supplier Report`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      }

      addWatermark(doc);

      doc.save(`suppliers-report-${formatDate(new Date()).replace(/\//g, '-')}.pdf`);
      if (window.showToast) {
        window.showToast('Export successful!', 'success');
      }
      setShowExportMenu(false);
    } catch (error) {
      console.error('PDF Export Error: ', error);
      if (window.showToast) {
        window.showToast('Export failed', 'error');
      }
    }
  };

  const exportSuppliersJSON = () => {
    try {
      const data = state.suppliers.map((supplier) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: supplier.name,
        mobileNumber: supplier.mobileNumber || supplier.phone || '',
        email: supplier.email || '',
        address: supplier.address || '',
        balanceDue: Number(supplier.balanceDue ?? supplier.dueAmount ?? 0) || 0,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt
      }));

      downloadFile(
        `suppliers-${new Date().toISOString().split('T')[0]}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );

      if (window.showToast) {
        window.showToast('Export successful!', 'success');
      }
    } catch (error) {
      if (window.showToast) {
        window.showToast('Export failed', 'error');
      }
    }
  };

  const exportSuppliersCSV = () => {
    try {
      const headers = [
        'Supplier Name',
        'Mobile',
        'Email',
        'Address',
        'Balance Due'
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

      const rows = state.suppliers.map((supplier) => [
        escapeValue(supplier.name || ''),
        escapeValue(supplier.mobileNumber || supplier.phone || ''),
        escapeValue(supplier.email || ''),
        escapeValue(supplier.address || ''),
        escapeValue((Number(supplier.balanceDue ?? supplier.dueAmount ?? 0) || 0).toFixed(2))
      ]);

      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

      downloadFile(
        `suppliers-${new Date().toISOString().split('T')[0]}.csv`,
        csvContent,
        'text/csv;charset=utf-8;'
      );

      if (window.showToast) {
        window.showToast('Export successful!', 'success');
      }
    } catch (error) {
      if (window.showToast) {
        window.showToast('Export failed', 'error');
      }
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Header Row: Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Suppliers</h1>
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
                    <h3 className="font-semibold text-gray-900 dark:text-white">Export Suppliers</h3>
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
                        exportSuppliersCSV();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 dark:bg-green-500/10 dark:text-green-500 dark:group-hover:bg-green-500/20 transition-colors">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as CSV</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Spreadsheet format</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportSuppliersJSON();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-500 dark:group-hover:bg-blue-500/20 transition-colors">
                        <FileJson className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as JSON</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Raw data format</span>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        exportSuppliersPDF();
                        setShowExportMenu(false);
                      }}
                      className="w-full text-left px-4 py-3.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 rounded-xl flex items-center gap-3 transition-colors group"
                    >
                      <div className="p-2 rounded-lg bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-500/10 dark:text-red-500 dark:group-hover:bg-red-500/20 transition-colors">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-900 dark:text-white font-semibold">Export as PDF</span>
                        <span className="text-xs text-gray-500 dark:text-slate-400">Printable document</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center text-sm"
            disabled={isPlanExpired(state)}
          >
            <Plus className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Add Supplier</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <label htmlFor="supplier-search" className="sr-only">Search suppliers...</label>
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400 dark:text-slate-500" />
          </div>
          <input
            id="supplier-search"
            type="text"
            placeholder="Search suppliers..."
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
            <option value="all">All Suppliers</option>
            <option value="due">Payment Due</option>
            <option value="credit">Advance Paid</option>
            <option value="settled">Settled</option>
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Supplier Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paginatedSuppliers.map(supplier => {
          const rawBalance = supplier.balanceDue ?? supplier.dueAmount ?? 0;
          const numericBalance = typeof rawBalance === 'number' ? rawBalance : parseFloat(rawBalance) || 0;
          const isCredit = numericBalance < 0;
          const hasBalance = numericBalance !== 0;

          // Generate a consistent gradient based on name
          const gradients = [
            'from-blue-500 to-indigo-600',
            'from-emerald-500 to-teal-600',
            'from-orange-500 to-red-600',
            'from-purple-500 to-pink-600',
            'from-cyan-500 to-blue-600',
          ];
          const gradientIndex = (supplier.name || 'S').charCodeAt(0) % gradients.length;
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
              key={supplier.id}
              className="group relative bg-white dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-xl border border-gray-200/60 dark:border-slate-700 transition-all duration-300 overflow-hidden flex flex-col"
            >
              {/* Decorative top border - Color coded by status */}
              <div className={`h-1.5 w-full ${topBorderClass}`}></div>

              <div className="p-5 flex-1 flex flex-col">
                {/* Header: Avatar & Name */}
                <div className="flex items-start gap-4 mb-4">
                  <div className={`flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-white font-bold text-xl shadow-md transform group-hover:scale-105 transition-transform duration-300`}>
                    {(supplier.name || 'S')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate" title={supplier.name}>
                      {supplier.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${numericBalance > 0
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30'
                        : numericBalance < 0
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30'
                          : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400 border border-gray-200 dark:border-slate-600'
                        }`}>
                        {numericBalance > 0 ? 'Payment Due' : numericBalance < 0 ? 'Advance' : 'Settled'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Details */}
                <div className="space-y-2 mb-5">
                  {(supplier.mobileNumber || supplier.phone) ? (
                    <div className="flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-slate-400 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors group/phone">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-gray-500">PH</span>
                        </div>
                        <span className="font-medium truncate">{supplier.mobileNumber || supplier.phone}</span>
                      </div>

                      {/* Call Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setWhatsAppSupplier(supplier);
                            setShowWhatsAppModal(true);
                          }}
                          className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 transition-colors"
                          title="WhatsApp"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const phone = (supplier.mobileNumber || supplier.phone || '').replace(/\D/g, '');
                            if (phone) {
                              window.open(`tel:${phone}`, '_self');
                            } else if (window.showToast) {
                              window.showToast('No phone number available', 'error');
                            }
                          }}
                          className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                          title="Call"
                        >
                          <Phone className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-slate-600 p-2">
                      <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-slate-700">
                        <span className="text-xs font-bold">PH</span>
                      </div>
                      <span className="italic">No phone number</span>
                    </div>
                  )}

                  {supplier.email ? (
                    <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-slate-400 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-gray-500">@</span>
                      </div>
                      <span className="truncate">{supplier.email}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-sm text-gray-400 dark:text-slate-600 p-2">
                      <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-slate-700">
                        <span className="text-xs font-bold">@</span>
                      </div>
                      <span className="italic">No email address</span>
                    </div>
                  )}
                </div>

                {/* Balance Block */}
                <div className="mt-auto pt-4 border-t border-gray-100 dark:border-slate-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">Balance</span>
                    <span className={`text-lg font-bold ${numericBalance > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : numericBalance < 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-900 dark:text-white'
                      }`}>
                      {formatCurrency(Math.abs(numericBalance))} {numericBalance > 0 ? '(Due)' : numericBalance < 0 ? '(Adv)' : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="px-5 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-700 flex items-center gap-3">
                <button
                  onClick={() => {
                    if (isPlanExpired(state)) {
                      if (window.showToast) window.showToast('Plan expired.', 'error');
                      return;
                    }
                    handlePayment(supplier);
                  }}
                  disabled={isPlanExpired(state)}
                  className={`flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center justify-center gap-2 ${hasBalance
                    ? 'bg-gradient-to-r from-gray-900 to-gray-800 dark:from-white dark:to-gray-100 text-white dark:text-gray-900 hover:from-black hover:to-gray-900 dark:hover:from-gray-100 dark:hover:to-gray-200'
                    : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-white border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                    } ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>{hasBalance ? 'Pay / Record' : 'Record'}</span>
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (isPlanExpired(state)) return;
                      setSelectedSupplier(supplier);
                      setShowEditModal(true);
                    }}
                    disabled={isPlanExpired(state)}
                    className={`p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors border border-transparent hover:border-blue-100 dark:hover:border-blue-900/30 ${isPlanExpired(state) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="Edit Details"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setHistorySupplier(supplier);
                      setShowHistorySelectionModal(true);
                    }}
                    className="p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-purple-50 hover:text-slate-900 dark:hover:bg-purple-900/20 dark:hover:text-purple-400 transition-colors border border-transparent hover:border-purple-100 dark:hover:border-purple-900/30"
                    title="View History"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteSupplier(supplier.id)}
                    disabled={(supplier.balanceDue || 0) !== 0 || isPlanExpired(state)}
                    className={`p-2.5 rounded-xl transition-colors border border-transparent ${(supplier.balanceDue || 0) !== 0 || isPlanExpired(state)
                      ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed'
                      : 'text-gray-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 hover:border-red-100 dark:hover:border-red-900/30'
                      }`}
                    title={(supplier.balanceDue || 0) !== 0 ? 'Clear balance first' : 'Delete Supplier'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-6 border-t border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          Showing {Math.min(filteredSuppliers.length, (currentPage - 1) * itemsPerPage + 1)} to {Math.min(filteredSuppliers.length, currentPage * itemsPerPage)} of {filteredSuppliers.length} suppliers
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-50 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {[...Array(totalPages)].map((_, i) => (
            <button
              key={i + 1}
              onClick={() => setCurrentPage(i + 1)}
              className={`w-10 h-10 rounded-lg text-sm font-bold transition-all ${currentPage === i + 1
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-50 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {showAddModal && <AddSupplierModal onClose={() => setShowAddModal(false)} onSubmit={handleAddSupplier} existingSuppliers={activeSuppliers} />}
      {showEditModal && selectedSupplier && (
        <EditSupplierModal
          onClose={() => { setShowEditModal(false); setSelectedSupplier(null); }}
          onSubmit={handleEditSupplier}
          supplier={activeSupplier}
          existingSuppliers={activeSuppliers}
        />
      )}
      {showPaymentModal && selectedSupplier && (
        <SupplierPaymentModal
          onClose={() => { setShowPaymentModal(false); setSelectedSupplier(null); }}
          onSubmit={handlePaymentSubmit}
          supplier={activeSupplier}
          dueOrdersStats={dueOrdersStats}
          refundableOrdersStats={refundableOrdersStats}
        />
      )}

      {showHistorySelectionModal && historySupplier && (
        <HistorySelectionModal
          customer={historySupplier}
          type="supplier"
          onClose={() => setShowHistorySelectionModal(false)}
          onSelectOrderHistory={() => setShowSupplierOrderHistoryModal(true)}
          onSelectTransactionHistory={() => setShowTransactionHistoryModal(true)}
        />
      )}

      {showSupplierOrderHistoryModal && historySupplier && (
        <SupplierOrderHistoryModal
          supplier={historySupplier}
          orders={state.purchaseOrders || []}
          onClose={() => setShowSupplierOrderHistoryModal(false)}
        />
      )}

      {showTransactionHistoryModal && historySupplier && (
        <SupplierTransactionHistoryModal
          supplier={historySupplier}
          onClose={() => setShowTransactionHistoryModal(false)}
          transactions={getSupplierTransactions(historySupplier.id)}
        />
      )}

      {showAllocationModal && allocationData && (
        <PaymentAllocationModal
          supplier={allocationData.supplier}
          paymentAmount={allocationData.amount}
          mode={allocationData.paymentType === 'receive' ? 'refund' : 'payment'}
          pendingOrders={
            (state.purchaseOrders || []).filter(o => {
              if (o.isDeleted) return false;
              const supplierName = (allocationData.supplier.name || '').trim().toLowerCase();
              const orderSupplier = (o.supplierName || '').trim().toLowerCase();
              if (orderSupplier !== supplierName) return false;

              if (allocationData.paymentType === 'receive') {
                // Refund Mode: Cancelled & Paid > 0
                if (o.status !== 'cancelled') return false;
                return (Number(o.amountPaid) || 0) > 0.01;
              } else {
                // Payment Mode: Due > 0 (and NOT cancelled)
                if (o.status === 'cancelled') return false;
                const total = Number(o.total || 0);
                const paid = Number(o.amountPaid || 0);
                const due = o.balanceDue !== undefined ? Number(o.balanceDue) : Math.max(0, total - paid);
                return due > 0.01;
              }
            })
          }
          onClose={() => {
            setShowAllocationModal(false);
            setAllocationData(null);
          }}
          onConfirm={handleAllocationConfirm}
        />
      )}
      {showWhatsAppModal && whatsAppSupplier && (
        <WhatsAppBillModal
          customer={whatsAppSupplier}
          orders={state.purchaseOrders || []}
          onClose={() => setShowWhatsAppModal(false)}
        />
      )}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold mb-2 dark:text-white">Delete Supplier?</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">Are you sure you want to delete {supplierToDelete?.name}? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 bg-gray-100 dark:bg-slate-800 font-bold rounded-lg dark:text-white">Cancel</button>
              <button onClick={confirmDeleteSupplier} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Suppliers;
