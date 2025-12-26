import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
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
} from 'lucide-react';
import jsPDF from 'jspdf';
import AddCustomerModal from './AddCustomerModal';
import EditCustomerModal from './EditCustomerModal';
import PaymentModal from './PaymentModal';
import OrderHistoryModal from './OrderHistoryModal';
import WhatsAppBillModal from './WhatsAppBillModal';
import { getPlanLimits, canAddCustomer } from '../../utils/planUtils';
import { sanitizeMobileNumber } from '../../utils/validation';
import { getAllItems, STORES } from '../../utils/indexedDB';

const Customers = () => {
  const { state, dispatch } = useApp();
  const [searchTerm, setSearchTerm] = useState('');

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

  const activeCustomers = state.customers.filter(customer => !customer.isDeleted);

  // Plan limits (exclude walk-in customer from usage calculations)
  const { maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
  const totalCustomers = activeCustomers.length;
  const atCustomerLimit = !canAddCustomer(totalCustomers, state.currentPlan, state.currentPlanDetails);
  const customerLimitLabel = maxCustomers === Infinity ? 'Unlimited' : maxCustomers;

  const planNameLabel = state.currentPlanDetails?.planName
    || (state.currentPlan ? `${state.currentPlan.charAt(0).toUpperCase()}${state.currentPlan.slice(1)}` : 'Current');

  const showPlanUpgradeWarning = () => {
    const limitMessage = `You've reached the customer limit (${customerLimitLabel}) for the ${planNameLabel} plan. Upgrade now to unlock more customer slots instantly.`;
    setPlanLimitMessage(limitMessage);
    if (window.showToast) {
      window.showToast(limitMessage, 'warning', 5000);
    }
  };

  // Filter customers based on search term
  const filteredCustomers = activeCustomers.filter(customer => {
    const mobileNumber = customer.mobileNumber || customer.phone || ''; // Backward compatibility
    return (
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mobileNumber.includes(searchTerm) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when search changes or itemsPerPage changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, itemsPerPage]);

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
        window.showToast('Walk-in customer already exists.', 'info');
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
    if (atCustomerLimit) {
      showPlanUpgradeWarning();
      return;
    }
    setPlanLimitMessage('');
    setShowAddModal(true);
  };

  const handleEditCustomer = (customerData) => {

    dispatch({ type: 'UPDATE_CUSTOMER', payload: customerData });
    // Close modal immediately - success message will show from the action
    setShowEditModal(false);
    setSelectedCustomer(null);
  };

  const handleDeleteCustomer = (customerId) => {
    // Find the customer to check balance due
    const customer = state.customers.find(c => c.id === customerId);

    if (customer && (customer.isWalkIn || (customer.name || '').trim().toLowerCase() === 'walk-in customer')) {
      if (window.showToast) {
        window.showToast('Walk-in customer cannot be deleted.', 'warning');
      }
      return;
    }

    // Prevent deletion if customer has outstanding balance
    if (customer && (customer.balanceDue || 0) !== 0) {
      const balanceDue = Math.abs(customer.balanceDue || 0);
      if (window.showToast) {
        window.showToast(
          `Cannot delete customer. Outstanding balance of ₹${balanceDue.toFixed(2)} must be cleared first.`,
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
        window.showToast('Customer deleted successfully.', 'success');
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

  const handlePaymentSubmit = async (amount, paymentType = 'receive') => {
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

    // Step 1: Update local state and IndexedDB immediately
    dispatch({ type: 'UPDATE_CUSTOMER', payload: updatedCustomer });

    console.log('💰 CUSTOMER PAYMENT: Local state updated, now attempting API sync');

    // Step 2: Immediately attempt to sync with backend
    try {
      const { syncService } = await import('../../services/syncService');
      const { getStoreFunctions } = await import('../../utils/indexedDB');

      console.log('💰 CUSTOMER PAYMENT: Starting sync attempt');

      // Check if online first
      if (syncService.isOnline()) {
        console.log('💰 CUSTOMER PAYMENT: Online, attempting sync');

        const syncResult = await syncService.syncAll(getStoreFunctions);

        console.log('💰 CUSTOMER PAYMENT: Sync result received', syncResult);

        if (syncResult.success && syncResult.synced > 0) {
          console.log('💰 CUSTOMER PAYMENT: Sync successful');
          if (window.showToast) {
            window.showToast('✅ Payment synced to cloud successfully', 'success');
          }
        } else {
          console.log('💰 CUSTOMER PAYMENT: Sync completed but no items synced or failed');
          if (window.showToast) {
            window.showToast('⚠️ Payment saved locally. Will sync when online.', 'warning');
          }
        }
      } else {
        console.log('💰 CUSTOMER PAYMENT: Offline, customer marked as unsynced');
        if (window.showToast) {
          window.showToast('⚠️ Payment saved locally. Will sync when online.', 'warning');
        }
      }
    } catch (syncError) {
      console.error('💰 CUSTOMER PAYMENT: Sync failed with error', syncError);
      if (window.showToast) {
        window.showToast('⚠️ Payment saved locally. Will sync when online.', 'warning');
      }
    }

    // Step 3: Show payment confirmation message
    if (window.showToast) {
      const paymentTypeText = paymentType === 'receive' ? 'Payment received' : 'Payment given';

      if (newBalance < 0) {
        window.showToast(`${paymentTypeText}. Customer now has ₹${Math.abs(newBalance).toFixed(2)} credit.`, 'success');
      } else if (newBalance === 0) {
        window.showToast(`${paymentTypeText}. Balance cleared.`, 'success');
      } else {
        window.showToast(`${paymentTypeText}. Remaining balance ₹${newBalance.toFixed(2)}.`, 'success');
      }
    }

    setShowPaymentModal(false);
    setSelectedCustomer(null);
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

  const exportCustomersPDF = () => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.setFont('helvetica', 'normal');

      // Header
      pdf.setFontSize(18);
      pdf.text('Customer Report', pageWidth / 2, 15, { align: 'center' });

      // Store info line
      pdf.setFontSize(11);
      pdf.text(`${state.username || 'Grocery Store'}  |  Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 22, { align: 'center' });

      // Summary band
      pdf.setDrawColor(230);
      pdf.setFillColor(245, 247, 250);
      pdf.rect(10, 28, pageWidth - 20, 18, 'F');
      pdf.setTextColor(60);
      pdf.setFontSize(10);
      const total = state.customers.length;
      const dueCount = state.customers.filter(c => (c.balanceDue || 0) > 0).length;
      const dueSum = state.customers.reduce((sum, c) => sum + (c.balanceDue || 0), 0).toFixed(2);
      pdf.text(`Total Customers: ${total}`, 14, 40);
      pdf.text(`With Balance Due: ${dueCount}`, 70, 40);
      pdf.text(`Total Outstanding: Rs ${dueSum}`, 130, 40);

      // Table header
      const startY = 52;
      const colX = { idx: 12, name: 25, mobileNumber: 90, email: 130, balance: 180 };
      pdf.setFillColor(234, 238, 243);
      pdf.setDrawColor(220);
      pdf.rect(10, startY - 6, pageWidth - 20, 8, 'F');
      pdf.setTextColor(30);
      pdf.setFontSize(10);
      pdf.text('#', colX.idx, startY);
      pdf.text('Name', colX.name, startY);
      pdf.text('Mobile Number', colX.mobileNumber, startY);
      pdf.text('Email', colX.email, startY);
      pdf.text('Balance Due (Rs)', colX.balance, startY, { align: 'right' });

      // Rows
      let y = startY + 6;
      pdf.setTextColor(50);
      pdf.setFontSize(9);
      state.customers.forEach((customer, index) => {
        if (y > pageHeight - 20) {
          pdf.addPage();
          // redraw header on new page
          pdf.setFillColor(234, 238, 243);
          pdf.setDrawColor(220);
          pdf.rect(10, 10, pageWidth - 20, 8, 'F');
          pdf.setTextColor(30);
          pdf.setFontSize(10);
          pdf.text('#', colX.idx, 16);
          pdf.text('Name', colX.name, 16);
          pdf.text('Mobile Number', colX.mobileNumber, 16);
          pdf.text('Email', colX.email, 16);
          pdf.text('Balance Due (Rs)', colX.balance, 16, { align: 'right' });
          y = 24;
          pdf.setTextColor(50);
          pdf.setFontSize(9);
        }

        const bal = (customer.balanceDue || 0).toFixed(2);
        const mobileNumber = customer.mobileNumber || customer.phone || ''; // Backward compatibility
        pdf.text(String(index + 1), colX.idx, y);
        pdf.text((customer.name || '').toString().substring(0, 20), colX.name, y);
        pdf.text(mobileNumber.toString().substring(0, 12), colX.mobileNumber, y);
        pdf.text((customer.email || '').toString().substring(0, 18), colX.email, y);
        pdf.text(`Rs ${bal}`, colX.balance, y, { align: 'right' });
        y += 6;
      });

      // Footer page numbers
      const pageCount = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(120);
        pdf.text(`Page ${i} of ${pageCount}`, 12, pageHeight - 8);
        pdf.text(`${state.username || 'Grocery Store'} • Customer Report`, pageWidth - 12, pageHeight - 8, { align: 'right' });
      }

      pdf.save(`customers-report-${new Date().toISOString().split('T')[0]}.pdf`);

      if (window.showToast) {
        window.showToast('Customer report exported successfully!', 'success');
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error generating PDF. Please try again.', 'error');
      }
    }
  };

  const exportCustomersJSON = () => {
    try {
      const data = state.customers.map((customer) => ({
        id: customer.id,
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
        window.showToast('Customer data exported as JSON.', 'success');
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting JSON. Please try again.', 'error');
      }
    }
  };

  const exportCustomersCSV = () => {
    try {
      const headers = ['Name', 'Mobile Number', 'Email', 'Address', 'Balance Due'];
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
        window.showToast('Customer data exported as CSV.', 'success');
      }
    } catch (error) {

      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Simple Premium Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
            {totalCustomers} {totalCustomers === 1 ? 'customer' : 'customers'} • Limit: {customerLimitLabel}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="btn-secondary flex items-center text-sm"
            >
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
              <span className="sm:hidden">Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute left-0 right-0 mt-2 w-full sm:w-48 sm:right-0 sm:left-auto rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden z-50">
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersPDF();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <FileText className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                  PDF Report
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersCSV();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <FileSpreadsheet className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                  CSV Spreadsheet
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersJSON();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <FileJson className="h-4 w-4 text-gray-600 dark:text-slate-400" />
                  JSON Dataset
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleOpenAddModal}
            className="btn-primary flex items-center text-sm"
          >
            <Plus className="h-4 w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Add Customer</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Simple Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <label htmlFor="customer-search" className="sr-only">Search customers</label>
          <input
            id="customer-search"
            type="text"
            placeholder="Search by name, phone, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`input-field h-11 w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-colors focus:border-[#2F3C7E] focus:ring-2 focus:ring-[#2F3C7E]/20 ${searchTerm ? 'pr-10' : ''}`}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
            >
              ×
            </button>
          )}
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
                          {numericBalance > 0 ? 'Payment Due' : numericBalance < 0 ? 'Credit Available' : 'Settled'}
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
                            title="Send Bill Reminder"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          <a
                            href={`tel:${customer.mobileNumber || customer.phone}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                            title="Call"
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
                        <span className="italic">No phone number</span>
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
                        {isCredit ? '-' : ''}₹{Math.abs(numericBalance).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="px-5 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-700 flex items-center gap-3">
                  <button
                    onClick={() => handlePayment(customer)}
                    className={`flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center justify-center gap-2 ${hasBalance
                      ? 'bg-gradient-to-r from-gray-900 to-gray-800 dark:from-white dark:to-gray-100 text-white dark:text-gray-900 hover:from-black hover:to-gray-900 dark:hover:from-gray-100 dark:hover:to-gray-200'
                      : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-white border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                      }`}
                  >
                    <CreditCard className="h-4 w-4" />
                    <span>{hasBalance ? 'Pay Now' : 'Add Cash'}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setSelectedCustomer(customer);
                        setShowEditModal(true);
                      }}
                      className="p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors border border-transparent hover:border-blue-100 dark:hover:border-blue-900/30"
                      title="Edit Details"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleViewOrderHistory(customer)}
                      className="p-2.5 rounded-xl text-gray-500 dark:text-slate-400 hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20 dark:hover:text-purple-400 transition-colors border border-transparent hover:border-purple-100 dark:hover:border-purple-900/30"
                      title="View History"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCustomer(customer.id)}
                      disabled={(customer.balanceDue || 0) !== 0}
                      className={`p-2.5 rounded-xl transition-colors border border-transparent ${(customer.balanceDue || 0) !== 0
                        ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed'
                        : 'text-gray-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 hover:border-red-100 dark:hover:border-red-900/30'
                        }`}
                      title={
                        (customer.balanceDue || 0) !== 0
                          ? 'Clear balance to delete'
                          : 'Delete Customer'
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
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No customers found</h3>
              <p className="text-gray-600 dark:text-slate-400 mb-6">
                {searchTerm ? 'Try adjusting your search terms.' : 'Get started by adding your first customer.'}
              </p>
              {!searchTerm && (
                <button
                  onClick={handleOpenAddModal}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Customer
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
            Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{Math.min(startIndex + itemsPerPage, filteredCustomers.length)}</span> of <span className="font-semibold">{filteredCustomers.length}</span> {filteredCustomers.length === 1 ? 'customer' : 'customers'}
          </div>
          <div className="flex items-center gap-1">
            {/* First Page Button */}
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>

            {/* Previous Page Button */}
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Previous page"
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
                      ? 'bg-[#2f3c7e] text-white shadow-sm'
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
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Last Page Button */}
            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Last page"
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && customerToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 animate-fade-in border border-gray-100 dark:border-slate-700">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Delete Customer?</h3>
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  This action cannot be undone. The customer will be permanently removed from your records.
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
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Name:</span>
                  <span className="text-sm text-gray-900 dark:text-white">{customerToDelete.name}</span>
                </div>
                {customerToDelete.mobileNumber && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Phone:</span>
                    <span className="text-sm text-gray-900 dark:text-white">{customerToDelete.mobileNumber}</span>
                  </div>
                )}
                {customerToDelete.email && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Email:</span>
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
                Cancel
              </button>
              <button
                onClick={confirmDeleteCustomer}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
              >
                Delete Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
