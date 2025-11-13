import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import { 
  Plus, 
  Download, 
  Edit, 
  Trash2, 
  CreditCard,
  ChevronLeft,
  ChevronRight,   
  Users,
  Eye,
  FileText,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';
import jsPDF from 'jspdf';
import AddCustomerModal from './AddCustomerModal';
import EditCustomerModal from './EditCustomerModal';
import PaymentModal from './PaymentModal';
import OrderHistoryModal from './OrderHistoryModal';
import { getPlanLimits, canAddCustomer } from '../../utils/planUtils';
import { sanitizeMobileNumber } from '../../utils/validation';
import { getAllItems, STORES } from '../../utils/indexedDB';

const Customers = () => {
  const { state, dispatch } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [orderHistoryCustomer, setOrderHistoryCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
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
        console.error('Customers: Failed to refresh orders from IndexedDB', error);
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
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const itemsPerPage = state.itemsPerPage;

  const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
  const walkInOrders = useMemo(
    () =>
      state.orders.filter(order =>
        (order.customerName || '').trim().toLowerCase() === 'walk-in customer'
      ),
    [state.orders]
  );

  const walkInCustomer = useMemo(() => {
    const totalSpend = walkInOrders.reduce(
      (sum, order) => sum + (Number(order.totalAmount) || Number(order.total) || 0),
      0
    );
    return {
      id: 'walk-in-customer',
      name: 'Walk-in Customer',
      mobileNumber: '',
      phone: '',
      email: '',
      address: 'Point of Sale • walk-in purchases',
      balanceDue: 0,
      dueAmount: 0,
      createdAt: walkInOrders[walkInOrders.length - 1]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      orderCount: walkInOrders.length,
      totalSpend,
      isWalkIn: true
    };
  }, [walkInOrders]);

  const hasWalkInCustomer = activeCustomers.some(customer =>
    (customer.name || '').trim().toLowerCase() === 'walk-in customer'
  );

  const activeCustomersWithWalkIn = hasWalkInCustomer
    ? activeCustomers
    : [walkInCustomer, ...activeCustomers];

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
  const filteredCustomers = activeCustomersWithWalkIn.filter(customer => {
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

    // Professional confirm using toast-like inline confirm
    const proceed = () => dispatch({ type: 'DELETE_CUSTOMER', payload: customerId });
    if (window?.showToastConfirm) {
      // If a confirm API exists in Layout, use it
      window.showToastConfirm({
        title: 'Delete customer?',
        message: 'This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: proceed
      });
      return;
    }
    // Fallback: styled custom confirm dialog
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-40 z-[1000] flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-sm w-full p-5">
        <h3 class="text-lg font-semibold text-gray-900 mb-1">Delete customer?</h3>
        <p class="text-sm text-gray-600 mb-4">This action cannot be undone.</p>
        <div class="flex justify-end space-x-2">
          <button id="cc-cancel" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button id="cc-confirm" class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = () => document.body.removeChild(overlay);
    overlay.querySelector('#cc-cancel').onclick = cleanup;
    overlay.querySelector('#cc-confirm').onclick = () => { cleanup(); proceed(); };
  };

  const handlePayment = (customer) => {
    setSelectedCustomer(customer);
    setShowPaymentModal(true);
  };

  const handleViewOrderHistory = (customer) => {
    setOrderHistoryCustomer(customer);
    setShowOrderHistoryModal(true);
  };

  const handlePaymentSubmit = (amount) => {
    if (!selectedCustomer || amount <= 0) {
      return;
    }

    const currentBalanceRaw = selectedCustomer.dueAmount ?? selectedCustomer.balanceDue ?? 0;
    const currentBalance = parseFloat(currentBalanceRaw) || 0;
    const paymentAmount = parseFloat(amount) || 0;
    const newBalance = parseFloat((currentBalance - paymentAmount).toFixed(2));

    const updatedCustomer = {
      ...selectedCustomer,
      dueAmount: newBalance,
      balanceDue: newBalance
    };

    console.log('Payment submit - Customer data:', updatedCustomer);
    console.log('dueAmount:', updatedCustomer.dueAmount, 'balanceDue:', updatedCustomer.balanceDue);

    dispatch({ type: 'UPDATE_CUSTOMER', payload: updatedCustomer });

    if (window.showToast) {
      if (newBalance < 0) {
        window.showToast(`Payment recorded. Customer now has ₹${Math.abs(newBalance).toFixed(2)} credit.`, 'success');
      } else if (newBalance === 0) {
        window.showToast('Payment recorded. Balance cleared.', 'success');
      } else {
        window.showToast(`Payment recorded. Remaining balance ₹${newBalance.toFixed(2)}.`, 'success');
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
      console.error('Error generating PDF:', error);
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
      console.error('Error exporting JSON:', error);
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
      console.error('Error exporting CSV:', error);
      if (window.showToast) {
        window.showToast('Error exporting CSV. Please try again.', 'error');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Plan limit: {customerLimitLabel} | Used: {totalCustomers}
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="btn-secondary flex items-center justify-center w-full sm:w-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </button>
            {showExportMenu && (
              <div className="absolute left-0 right-0 mt-2 w-full sm:w-48 sm:right-0 sm:left-auto rounded-2xl border border-slate-200 bg-white/90 shadow-xl backdrop-blur-sm ring-1 ring-black/5 overflow-hidden z-10">
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersPDF();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-indigo-50 hover:via-sky-50 hover:to-blue-50 transition"
                >
                  <FileText className="h-4 w-4 text-indigo-500" />
                  PDF Report
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersCSV();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-emerald-50 hover:via-teal-50 hover:to-cyan-50 transition"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                  CSV Spreadsheet
                </button>
                <button
                  onClick={() => {
                    setShowExportMenu(false);
                    exportCustomersJSON();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 hover:bg-gradient-to-r hover:from-amber-50 hover:via-orange-50 hover:to-yellow-50 transition"
                >
                  <FileJson className="h-4 w-4 text-amber-500" />
                  JSON Dataset
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleOpenAddModal}
            className="btn-primary flex items-center justify-center w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label htmlFor="customer-search" className="sr-only">Search customers</label>
          <div className="relative group">
            <input
              id="customer-search"
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`input-field h-11 w-full rounded-xl border border-gray-200 bg-white/90 px-4 text-sm placeholder:text-gray-400 shadow-sm transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100 focus:bg-white ${searchTerm ? 'pr-20' : 'pr-4'}`}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-1.5 right-1.5 inline-flex items-center rounded-lg bg-primary-50 px-3 text-xs font-semibold text-primary-600 shadow-sm transition hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Customers grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {paginatedCustomers.length > 0 ? (
          paginatedCustomers.map((customer) => {
            const isWalkInCustomer =
              customer.isWalkIn ||
              ((customer.name || '').trim().toLowerCase() === 'walk-in customer');

            return (
              <div key={customer.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {customer.name}
                    </h3>
                    {(customer.mobileNumber || customer.phone) && (
                      <p className="text-sm text-gray-600 mt-1">{customer.mobileNumber || customer.phone}</p>
                    )}
                    {customer.email && (
                      <p className="text-sm text-gray-600">{customer.email}</p>
                    )}
                    <div className="mt-3">
                      {(() => {
                        const rawBalance = customer.balanceDue ?? customer.dueAmount ?? 0;
                        const numericBalance = typeof rawBalance === 'number' ? rawBalance : parseFloat(rawBalance) || 0;
                        const isCredit = numericBalance < 0;
                        return (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            numericBalance > 0
                              ? 'bg-red-100 text-red-800'
                              : numericBalance < 0
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {isCredit ? `Credit: ₹${Math.abs(numericBalance).toFixed(2)}` : `Balance: ₹${numericBalance.toFixed(2)}`}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {!isWalkInCustomer && (
                      <button
                        onClick={() => handlePayment(customer)}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                        title="Record Payment"
                      >
                        <CreditCard className="h-4 w-4" />
                      </button>
                    )}
                    {!isWalkInCustomer && (
                      <button
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setShowEditModal(true);
                        }}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Edit Customer"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleViewOrderHistory(customer)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Order History"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    {!isWalkInCustomer && (
                      <button
                        onClick={() => handleDeleteCustomer(customer.id)}
                        disabled={(customer.balanceDue || 0) !== 0}
                        className={`p-2 rounded-lg ${
                          (customer.balanceDue || 0) !== 0
                            ? 'text-gray-300 cursor-not-allowed opacity-50'
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={
                          (customer.balanceDue || 0) !== 0
                            ? `Cannot delete. Outstanding balance: ₹${Math.abs(customer.balanceDue || 0).toFixed(2)}`
                            : 'Delete Customer'
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full text-center py-12">
            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
            <p className="text-gray-500 mb-4">
              {searchTerm ? 'Try adjusting your search terms' : 'Get started by adding your first customer'}
            </p>
            {!searchTerm && (
              <button
                onClick={handleOpenAddModal}
                className="btn-primary"
              >
                Add Customer
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredCustomers.length)} of {filteredCustomers.length} customers
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-2 text-sm font-medium text-gray-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              <ChevronRight className="h-4 w-4" />
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
    </div>
  );
};

export default Customers;
