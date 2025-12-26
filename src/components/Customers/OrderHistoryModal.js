import React, { useMemo, useState, useCallback } from 'react';
import { X, Receipt, ShoppingCart, Share2, Filter, CheckCircle } from 'lucide-react';
import { sanitizeMobileNumber } from '../../utils/validation';
import { useApp } from '../../context/AppContext';
import { API_BASE_URL } from '../../utils/api';

import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDateTime, formatDate } from '../../utils/dateUtils';

const OrderHistoryModal = ({ customer, orders, onClose }) => {
  const { state, dispatch } = useApp();
  const [filterType, setFilterType] = useState('all');
  const [filterDate, setFilterDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const customerOrders = useMemo(() => {
    if (!customer || !orders?.length) return [];

    // Filter orders by customer mobile number only
    const customerMobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || '');

    // If customer has no mobile number, return empty array
    if (!customerMobile) {
      return [];
    }

    return orders
      .filter((order) => {
        if (!order || order.isDeleted) return false;

        // Match by mobile number only
        const orderCustomerMobile = sanitizeMobileNumber(order.customerMobile || '');

        if (orderCustomerMobile && customerMobile && orderCustomerMobile === customerMobile) {
          return true;
        }

        return false;
      })
      .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
  }, [customer, orders]);

  const toNumeric = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const deriveSubtotalFromItems = (order) => {
    if (!order || !Array.isArray(order.items)) return 0;
    return order.items.reduce((sum, item) => {
      const price = toNumeric(item.sellingPrice) ?? toNumeric(item.price) ?? 0;
      const qty = toNumeric(item.quantity) ?? 0;
      return sum + price * qty;
    }, 0);
  };

  const roundAmount = (value) => {
    const numeric = Number(value) || 0;
    return Math.round((numeric + Number.EPSILON) * 100) / 100;
  };

  const computeFinancialBreakdown = (order) => {
    const storedSubtotal = toNumeric(order.subtotal) ?? 0;
    const itemsSubtotal = deriveSubtotalFromItems(order);
    const fallbackTotal = toNumeric(order.totalAmount) ?? toNumeric(order.total) ?? 0;
    const rawSubtotal = storedSubtotal > 0 ? storedSubtotal : (itemsSubtotal > 0 ? itemsSubtotal : fallbackTotal);

    const storedDiscountPercentValue = toNumeric(order.discountPercent);
    const storedDiscountAmount = toNumeric(order.discountAmount) ?? toNumeric(order.discount) ?? 0;

    let discountPercent = storedDiscountPercentValue;
    if (discountPercent === null) {
      discountPercent = rawSubtotal > 0 ? (storedDiscountAmount / rawSubtotal) * 100 : 0;
    }
    if (!Number.isFinite(discountPercent)) {
      discountPercent = 0;
    }

    const resolvedDiscountAmount = storedDiscountAmount > 0
      ? storedDiscountAmount
      : (rawSubtotal * discountPercent) / 100;
    const discountAmount = roundAmount(resolvedDiscountAmount);

    const taxableBase = Math.max(0, rawSubtotal - discountAmount);

    const storedTaxPercentValue = toNumeric(order.taxPercent);
    const storedTaxAmount = toNumeric(order.taxAmount) ?? toNumeric(order.tax) ?? 0;

    let taxPercent = storedTaxPercentValue;
    if (taxPercent === null) {
      taxPercent = taxableBase > 0 ? (storedTaxAmount / taxableBase) * 100 : 0;
    }
    if (!Number.isFinite(taxPercent)) {
      taxPercent = 0;
    }

    const resolvedTaxAmount = storedTaxAmount > 0
      ? storedTaxAmount
      : (taxableBase * taxPercent) / 100;
    const taxAmount = roundAmount(resolvedTaxAmount);

    const rawTotal = toNumeric(order.totalAmount) ?? toNumeric(order.total) ?? 0;
    const netTotal = rawTotal > 0 ? rawTotal : roundAmount(Math.max(0, taxableBase + taxAmount));

    return {
      subtotal: roundAmount(rawSubtotal),
      discountPercent: roundAmount(discountPercent),
      discountAmount,
      taxPercent: roundAmount(taxPercent),
      taxAmount,
      netTotal
    };
  };

  const toLocalDateKey = useCallback((raw) => {
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year} -${month} -${day} `;
  }, []);

  const extractOrderDate = useCallback((order) => {
    if (!order) return null;
    const raw = order.date || order.createdAt || order.updatedAt || order.invoiceDate;
    return toLocalDateKey(raw);
  }, [toLocalDateKey]);

  const filteredOrders = useMemo(() => {
    if (filterType === 'all') return customerOrders;

    const todayIso = toLocalDateKey(Date.now());

    if (filterType === 'today') {
      return customerOrders.filter((order) => extractOrderDate(order) === todayIso);
    }

    if (filterType === 'date' && filterDate) {
      return customerOrders.filter((order) => extractOrderDate(order) === filterDate);
    }

    return customerOrders;
  }, [customerOrders, extractOrderDate, filterType, filterDate, toLocalDateKey]);

  const totals = filteredOrders.reduce((acc, order) => {
    const breakdown = computeFinancialBreakdown(order);
    acc.totalSpend += breakdown.netTotal;
    acc.totalSubtotal += breakdown.subtotal;
    acc.totalDiscount += breakdown.discountAmount;
    acc.totalTax += breakdown.taxAmount;
    return acc;
  }, { totalSpend: 0, totalSubtotal: 0, totalDiscount: 0, totalTax: 0 });

  const { totalSpend, totalSubtotal, totalDiscount, totalTax } = totals;

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(message, type, duration);
    }
  }, []);

  const buildWhatsAppMessage = useCallback((order) => {
    if (!order) return '';
    const breakdown = computeFinancialBreakdown(order);
    const orderDate = formatDateTime(order.createdAt || order.date || new Date().toISOString());
    const invoiceDate = (() => {
      try {
        const date = new Date(order.createdAt || order.date || Date.now());
        if (Number.isNaN(date.getTime())) return orderDate;
        return formatDate(date);
      } catch {
        return orderDate;
      }
    })();

    const withNull = (value) => {
      if (value === null || value === undefined || value === '') {
        return 'null';
      }
      return value;
    };

    const storeName = withNull(state.storeName || state.currentUser?.shopName || state.currentUser?.username);
    const storeAddress = withNull(state.currentUser?.address || state.shopAddress);
    const storePhoneRaw = state.currentUser?.phoneNumber || state.currentUser?.mobile || state.currentUser?.mobileNumber || state.currentUser?.contact || '';
    const storePhoneSanitized = sanitizeMobileNumber(storePhoneRaw);
    const storePhoneDisplay = storePhoneSanitized
      ? `+ 91 ${storePhoneSanitized} `
      : withNull(storePhoneRaw);
    const customerName = withNull(customer?.name || order.customerName);
    const customerPhoneSanitized = sanitizeMobileNumber(customer?.mobileNumber || customer?.phone || order.customerMobile || '');
    const customerPhoneDisplay = customerPhoneSanitized || 'null';

    const quantityWidth = 8;
    const rateWidth = 8;
    const amountWidth = 10;
    const headerLine = `${'Item'.padEnd(12, ' ')}${'Qty'.padStart(quantityWidth, ' ')}   ${'Rate'.padStart(rateWidth, ' ')}   ${'Amount'.padStart(amountWidth, ' ')} `;

    const items = (order.items || []).map((item) => {
      const qty = Number(item.quantity ?? 0) || 0;
      const rate = Number(item.sellingPrice ?? item.price ?? 0) || 0;
      const total = qty * rate;
      const qtyDisplay = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
      const rateDisplay = rate.toFixed(2);
      const totalDisplay = total.toFixed(2);
      const name = (item.name || 'null').slice(0, 12).padEnd(12, ' ');
      const qtyCol = qtyDisplay.padStart(quantityWidth, ' ');
      const rateCol = rateDisplay.padStart(rateWidth, ' ');
      const totalCol = totalDisplay.padStart(amountWidth, ' ');
      return `${name}${qtyCol}   ${rateCol}   ${totalCol} `;
    }).join('\n');

    const divider = '--------------------------------';
    const headerTitle = '             INVOICE';
    const storeLine = `Shop Name: ${storeName} `;
    const addressLine = `Address: ${storeAddress} `;
    const phoneLine = `Phone: ${storePhoneDisplay} `;
    const dateLine = `Date: ${withNull(invoiceDate)} `;
    const paymentMode = (order.paymentMethod || 'null').toString().trim();
    const formattedPaymentMode = paymentMode.toLowerCase() === 'null'
      ? 'null'
      : paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();
    const discountAmount = Number.isFinite(breakdown.discountAmount)
      ? `₹${breakdown.discountAmount.toFixed(2)} `
      : '₹null';
    const subtotalAmount = Number.isFinite(breakdown.subtotal)
      ? `₹${breakdown.subtotal.toFixed(2)} `
      : '₹null';
    const netTotalAmount = Number.isFinite(breakdown.netTotal)
      ? `₹${breakdown.netTotal.toFixed(2)} `
      : '₹null';
    const taxPercentRaw = Number.isFinite(breakdown.taxPercent) ? breakdown.taxPercent : null;
    const taxPercentDisplay = taxPercentRaw === null
      ? 'null'
      : `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `;
    const taxAmountDisplay = Number.isFinite(breakdown.taxAmount)
      ? `₹${breakdown.taxAmount.toFixed(2)} `
      : '₹null';

    const lines = [
      headerTitle,
      '',
      divider,
      storeLine,
      addressLine,
      phoneLine,
      dateLine,
      divider,
      `Customer Name: ${customerName} `,
      `Customer Phone: ${customerPhoneDisplay} `,
      divider,
      headerLine,
      items || `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(rateWidth, ' ')}   ${'null'.padStart(amountWidth, ' ')} `,
      divider,
      `Subtotal: ${subtotalAmount} `,
      `Discount: ${discountAmount} `,
      `Tax(${taxPercentDisplay})     : ${taxAmountDisplay} `,
      divider,
      `Grand Total: ${netTotalAmount} `,
      `Payment Mode: ${formattedPaymentMode} `,
      'Thank you for shopping with us!',
      divider,
      '        Powered by Drag & Drop',
      divider
    ];

    return lines.join('\n');
  }, [customer?.name, customer?.mobileNumber, customer?.phone, state]);

  const handleShareOrder = useCallback((order) => {
    const message = buildWhatsAppMessage(order);
    if (!message) {
      showToast('Unable to prepare invoice details for sharing.', 'error');
      return;
    }

    const customerMobileRaw = customer?.mobileNumber || customer?.phone || order?.customerMobile || '';
    const sanitizedMobile = sanitizeMobileNumber(customerMobileRaw);

    if (!sanitizedMobile) {
      showToast('No valid customer mobile number found to share the bill.', 'warning');
      return;
    }

    const encodedMessage = encodeURIComponent(message);
    const targetNumber = sanitizedMobile.length === 10 ? `91${sanitizedMobile} ` : sanitizedMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${encodedMessage}`;
    window.open(waUrl, '_blank');
  }, [buildWhatsAppMessage, customer, showToast]);

  const handleMarkPaid = useCallback(async (order) => {
    if (!window.confirm("Mark this order as fully paid? (Received via Cash)")) return;

    // Use latest state to avoid stale data
    const latestOrder = state.orders.find(o => (o.id === order.id || o._id === order.id)) || order;
    const latestCustomer = state.customers.find(c => (c.id === customer.id || c._id === customer.id)) || customer;

    let updatedOrder = { ...latestOrder, updatedAt: new Date().toISOString() };
    let paidAmount = 0;
    const isDue = (latestOrder.paymentMethod === 'due');
    const isSplitDue = (latestOrder.paymentMethod === 'split');

    if (isDue) {
      paidAmount = Number(latestOrder.totalAmount || 0);
      updatedOrder.allPaymentClear = true;
    } else if (isSplitDue) {
      const details = latestOrder.splitPaymentDetails || {};
      paidAmount = Number(details.dueAmount || 0);
      updatedOrder.allPaymentClear = true;
    } else {
      return;
    }

    // 1. Sync to Backend first
    try {
      const token = localStorage.getItem('token');
      const sellerId = latestOrder.sellerId || (state.currentUser && (state.currentUser.id || state.currentUser._id));
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-seller-id': sellerId
      };

      // Sync Order
      await fetch(`${API_BASE_URL}/sync/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sellerId, items: [updatedOrder] })
      });

      // Customer sync handled by backend automatically based on order update
      showToast('Payment synced to server!', 'success');
    } catch (error) {
      console.error("Sync failed", error);
      showToast("Synced locally only. Checking network...", "warning");
    }

    // 2. Update Local State
    if (state.orders) {
      const updatedOrdersList = state.orders.map(o => (o.id === order.id || o._id === order.id) ? updatedOrder : o);
      dispatch({ type: 'SET_ORDERS', payload: updatedOrdersList });
    }

    if (latestCustomer && paidAmount > 0) {
      const updatedCustomer = {
        ...latestCustomer,
        dueAmount: Math.max(0, (Number(latestCustomer.dueAmount) || 0) - paidAmount),
        updatedAt: new Date().toISOString()
      };
      dispatch({ type: 'UPDATE_CUSTOMER', payload: updatedCustomer });
    }
  }, [customer, dispatch, showToast, state.orders, state.customers]);

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[1050] p-0 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-3xl sm:max-h-[90vh] flex flex-col overflow-hidden transition-colors">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-gray-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                Order History
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg sm:hidden transition-colors"
                aria-label="Close order history"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 mb-3 break-words line-clamp-1" title={`${customer?.name || 'Customer'} • ${filteredOrders.length} orders • Net paid ${formatCurrency(totalSpend)}`}>
              {customer?.name || 'Customer'} • {filteredOrders.length} orders • Net paid <span className="text-emerald-600 font-bold">{formatCurrency(totalSpend)}</span>
            </p>
            <div className="grid grid-cols-2 lg:flex lg:flex-wrap gap-2 text-[10px] sm:text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-slate-700/50 px-2 py-1.5 text-gray-600 dark:text-slate-300 border border-gray-100 dark:border-slate-700 min-w-0">
                <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                <span className="truncate">Subtotal <span className="text-emerald-600 font-bold">{formatCurrency(totalSubtotal)}</span></span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-slate-700/50 px-2 py-1.5 text-gray-600 dark:text-slate-300 border border-gray-100 dark:border-slate-700 min-w-0">
                <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="truncate">Disc <span className="text-rose-600 font-bold">{formatCurrency(roundAmount(totalDiscount))}</span></span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-slate-700/50 px-2 py-1.5 text-gray-600 dark:text-slate-300 border border-gray-100 dark:border-slate-700 min-w-0">
                <span className="h-2 w-2 rounded-full bg-purple-500 flex-shrink-0" />
                <span className="truncate">Tax {formatCurrency(roundAmount(totalTax))}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1.5 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/30 min-w-0">
                <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="truncate font-bold">Total {formatCurrency(roundAmount(totalSpend))}</span>
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-field !py-1.5 !px-3 text-sm"
            >
              <option value="all">All Orders</option>
              <option value="today">Today</option>
              <option value="date">Specific Date</option>
            </select>
            {filterType === 'date' && (
              <input
                type="date"
                value={filterDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setFilterDate(e.target.value)}
                className="input-field !py-1.5 !px-3 text-sm"
              />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hidden sm:flex p-2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
            aria-label="Close order history"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile Filters */}
        <div className="px-4 pt-3 pb-3 sm:hidden border-b border-gray-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-600 dark:text-slate-400">Filter Orders</label>
            <div className="flex items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="input-field text-sm flex-1"
              >
                <option value="all">All Orders</option>
                <option value="today">Today</option>
                <option value="date">Specific Date</option>
              </select>
              {filterType === 'date' && (
                <input
                  type="date"
                  value={filterDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="input-field text-sm flex-1"
                />
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 pt-4 space-y-4 min-h-0">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-slate-500">
              <ShoppingCart className="h-12 w-12 text-gray-300 dark:text-slate-700 mb-4" />
              <p className="text-sm font-medium">No orders found for this selection.</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const orderItems = order.items || [];
              const breakdown = computeFinancialBreakdown(order);

              return (
                <div
                  key={order.id}
                  className="rounded-lg sm:rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-700/40 hover:border-primary-200 dark:hover:border-primary-800 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Invoice ID: {order.id?.slice(-8) || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 break-words">{formatDateTime(order.createdAt || order.date)}</p>
                    </div>
                    <div className="flex items-center justify-between sm:block sm:text-right">
                      <div>
                        <p className="text-lg sm:text-xl font-semibold text-emerald-600">{formatCurrency(breakdown.netTotal)}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mt-0.5">{order.paymentMethod || 'cash'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleShareOrder(order)}
                        className="sm:mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary-100 dark:border-primary-900 bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors active:scale-95"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Share Bill</span>
                        <span className="sm:hidden">Share</span>
                        <span className="sm:hidden">Share</span>
                      </button>

                      {/* Pay Button for Due Orders */
                        (() => {
                          const isDue = (order.paymentMethod === 'due');
                          const isSplitDue = (order.paymentMethod === 'split' && (order.splitPaymentDetails?.dueAmount > 0));

                          if (isDue || isSplitDue) {
                            return (
                              <button
                                type="button"
                                onClick={() => handleMarkPaid(order)}
                                className="sm:mt-2 sm:ml-2 inline-flex items-center gap-1.5 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors active:scale-95"
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Mark Paid</span>
                                <span className="sm:hidden">Pay</span>
                              </button>
                            );
                          }
                          return null;
                        })()}
                    </div>
                  </div>
                  {(() => {
                    const paymentMethod = (order.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = order.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="px-4 sm:px-5 pb-3">
                          <p className="text-[10px] sm:text-sm text-gray-500 dark:text-slate-400 mb-2 font-bold uppercase tracking-wider">Payment Breakdown</p>
                          <div className="grid grid-cols-3 gap-2 sm:gap-3">
                            <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-xl p-2 sm:p-3 min-w-0">
                              <p className="text-[9px] sm:text-xs text-green-600 dark:text-green-400 font-bold uppercase mb-0.5 truncate text-center">Cash</p>
                              <p className="text-sm sm:text-lg font-black text-green-700 dark:text-green-300 whitespace-nowrap overflow-x-auto scrollbar-hide text-center" title={formatCurrency(cashAmount)}>
                                {formatCurrencySmart(cashAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl p-2 sm:p-3 min-w-0">
                              <p className="text-[9px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold uppercase mb-0.5 truncate text-center">Online</p>
                              <p className="text-sm sm:text-lg font-black text-blue-700 dark:text-blue-300 whitespace-nowrap overflow-x-auto scrollbar-hide text-center" title={formatCurrency(onlineAmount)}>
                                {formatCurrencySmart(onlineAmount, state.currencyFormat)}
                              </p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-2 sm:p-3 min-w-0">
                              <p className="text-[9px] sm:text-xs text-red-600 dark:text-red-400 font-bold uppercase mb-0.5 truncate text-center">Due</p>
                              <div className="text-sm sm:text-lg font-black text-red-700 dark:text-red-300 flex items-center justify-center gap-1.5 truncate">
                                {(order.allPaymentClear && dueAmount > 0) ? (
                                  <>
                                    <span className="line-through text-red-900/30 dark:text-red-100/30 text-[10px] sm:text-sm">{formatCurrency(dueAmount)}</span>
                                    <span>{formatCurrency(0)}</span>
                                  </>
                                ) : (
                                  <span className="whitespace-nowrap overflow-x-auto scrollbar-hide text-rose-700 dark:text-rose-300" title={formatCurrency(order.allPaymentClear ? 0 : dueAmount)}>
                                    {formatCurrencySmart(order.allPaymentClear ? 0 : dueAmount, state.currencyFormat)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {orderItems.length > 0 && (
                    <div className="px-4 sm:px-5 pb-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2.5 min-w-0">
                          <p className="text-[9px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-black tracking-widest mb-1 truncate">Subtotal</p>
                          <p className="text-xs sm:text-sm font-black text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(breakdown.subtotal)}>
                            {formatCurrencySmart(breakdown.subtotal, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2.5 min-w-0">
                          <p className="text-[9px] sm:text-xs text-rose-600 dark:text-rose-400 uppercase font-black tracking-widest mb-1 truncate">Disc ({(breakdown.discountPercent || 0).toFixed(0)}%)</p>
                          <p className="text-xs sm:text-sm font-black text-rose-600 dark:text-rose-400 whitespace-nowrap overflow-x-auto scrollbar-hide font-black" title={`- ${formatCurrency(breakdown.discountAmount)}`}>
                            - {formatCurrencySmart(breakdown.discountAmount, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2.5 min-w-0">
                          <p className="text-[9px] sm:text-xs text-purple-600 dark:text-purple-400 uppercase font-black tracking-widest mb-1 truncate">Tax ({(breakdown.taxPercent || 0).toFixed(0)}%)</p>
                          <p className="text-xs sm:text-sm font-black text-purple-600 dark:text-purple-400 whitespace-nowrap overflow-x-auto scrollbar-hide font-black" title={`+ ${formatCurrency(breakdown.taxAmount)}`}>
                            + {formatCurrencySmart(breakdown.taxAmount, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2.5 min-w-0">
                          <p className="text-[9px] sm:text-xs text-emerald-700 dark:text-emerald-300 uppercase font-black tracking-widest mb-1 truncate">Total</p>
                          <p className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300 whitespace-nowrap overflow-x-auto scrollbar-hide font-black" title={formatCurrency(breakdown.netTotal)}>
                            {formatCurrencySmart(breakdown.netTotal, state.currencyFormat)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-800 rounded-lg sm:rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-xs sm:text-sm">
                          <thead className="bg-gray-100 dark:bg-slate-700">
                            <tr>
                              <th className="px-3 sm:px-4 py-2 text-left font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">Item</th>
                              <th className="px-3 sm:px-4 py-2 text-center font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">Qty</th>
                              <th className="px-3 sm:px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">Rate</th>
                              <th className="px-3 sm:px-4 py-2 text-right font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {orderItems.map((item, idx) => {
                              // quantity
                              const qty = Number(item.quantity ?? item.originalQuantity?.quantity ?? 0) || 0;

                              // prefer explicit total fields if available
                              const totalValue = Number(item.totalSellingPrice ?? item.total ?? item.sellingPrice ?? item.price ?? 0) || 0;

                              // If qty > 0, compute per-unit rate from totalValue (handles cases where sellingPrice is total)
                              // Otherwise, try to read a per-unit field directly
                              const rate = qty > 0
                                ? (totalValue / qty)
                                : Number(item.unitSellingPrice ?? item.sellingPrice ?? item.price ?? 0) || 0;

                              // Always compute line total from rate*qty (keeps display consistent)
                              const lineTotal = Number((rate * qty)) || totalValue; // fallback to totalValue if qty === 0

                              return (
                                <tr key={idx}>
                                  <td className="px-3 sm:px-4 py-2 text-gray-800 dark:text-slate-200 break-words max-w-[120px] sm:max-w-none">{item.name}</td>
                                  <td className="px-3 sm:px-4 py-2 text-center text-gray-600 dark:text-slate-400 whitespace-nowrap">{qty} {item.unit || item.quantityUnit || ''}</td>
                                  <td className="px-3 sm:px-4 py-2 text-right text-gray-600 dark:text-slate-400 whitespace-nowrap">{formatCurrency(rate)}</td>
                                  <td className="px-3 sm:px-4 py-2 text-right font-medium text-gray-700 dark:text-slate-300 whitespace-nowrap">{formatCurrency(lineTotal)}</td>
                                </tr>
                              );
                            })}

                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderHistoryModal;
