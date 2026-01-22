import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { X, Receipt, ShoppingCart, Share2, Filter } from 'lucide-react';
import { sanitizeMobileNumber } from '../../utils/validation';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { API_BASE_URL } from '../../utils/api';

import { formatCurrency, formatCurrencyCompact, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDateTime, formatDate } from '../../utils/dateUtils';
import { getTranslation } from '../../utils/translations';
import { STORES, updateItem } from '../../utils/indexedDB';

const OrderHistoryModal = ({ customer, orders, onClose }) => {
  const { state, dispatch } = useApp();
  const [filterType, setFilterType] = useState('all');
  const [filterDate, setFilterDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [isClosing, setIsClosing] = useState(false);


  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };
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

  const getPaymentMethodLabel = (method, splitDetails) => {
    const m = (method || '').toLowerCase();
    if (m === 'split' && splitDetails) {
      const parts = [];
      if (splitDetails.cashAmount > 0) parts.push(`${getTranslation('cash', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.cashAmount, state.currencyFormat)}`);
      if (splitDetails.onlineAmount > 0) parts.push(`${getTranslation('online', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.onlineAmount, state.currencyFormat)}`);
      if (splitDetails.creditAmount > 0) parts.push(`${getTranslation('creditUsed', state.currentLanguage) || 'Credit Used'}: ${formatCurrencySmart(splitDetails.creditAmount, state.currencyFormat)}`);
      if (splitDetails.dueAmount > 0) parts.push(`${getTranslation('due', state.currentLanguage)}: ${formatCurrencySmart(splitDetails.dueAmount, state.currencyFormat)}`);
      return parts.join(', ');
    }
    if (m === 'cash') return getTranslation('cash', state.currentLanguage);
    if (m === 'online') return getTranslation('online', state.currentLanguage);
    if (m === 'due' || m === 'credit') return getTranslation('due', state.currentLanguage);
    return method || 'N/A';
  };

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
    const headerLine = `${(getTranslation('itemHeader', state.currentLanguage) || 'Item').padEnd(12, ' ')}${(getTranslation('qtyHeader', state.currentLanguage) || 'Qty').padStart(quantityWidth, ' ')}   ${(getTranslation('rateHeader', state.currentLanguage) || 'Rate').padStart(rateWidth, ' ')}   ${(getTranslation('amount', state.currentLanguage) || 'Amount').padStart(amountWidth, ' ')} `;

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
    const headerTitle = `             ${getTranslation('invoiceUppercase', state.currentLanguage)}`;
    const storeLine = `${getTranslation('shopNameLabel', state.currentLanguage) || 'Shop Name'}: ${storeName} `;
    const addressLine = `${getTranslation('addressOptionalLabel', state.currentLanguage) || 'Address'}: ${storeAddress} `;
    const phoneLine = `${getTranslation('mobileNumberLabel', state.currentLanguage) || 'Phone'}: ${storePhoneDisplay} `;
    const dateLine = `${getTranslation('date', state.currentLanguage) || 'Date'}: ${withNull(invoiceDate)} `;
    const paymentMode = (order.paymentMethod || 'null').toString().trim();
    const formattedPaymentMode = paymentMode.toLowerCase() === 'null'
      ? 'null'
      : paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();
    const discountAmount = Number.isFinite(breakdown.discountAmount)
      ? `${formatCurrency(breakdown.discountAmount)} `
      : '₹null';
    const subtotalAmount = Number.isFinite(breakdown.subtotal)
      ? `${formatCurrency(breakdown.subtotal)} `
      : '₹null';
    const netTotalAmount = Number.isFinite(breakdown.netTotal)
      ? `${formatCurrency(breakdown.netTotal)} `
      : '₹null';
    const taxPercentRaw = Number.isFinite(breakdown.taxPercent) ? breakdown.taxPercent : null;
    const taxPercentDisplay = taxPercentRaw === null
      ? 'null'
      : `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}% `;
    const taxAmountDisplay = Number.isFinite(breakdown.taxAmount)
      ? `${formatCurrency(breakdown.taxAmount)} `
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
      `${getTranslation('customerName', state.currentLanguage) || 'Customer Name'}: ${customerName} `,
      `${getTranslation('mobile', state.currentLanguage) || 'Customer Phone'}: ${customerPhoneDisplay} `,
      divider,
      headerLine,
      items || `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(rateWidth, ' ')}   ${'null'.padStart(amountWidth, ' ')} `,
      divider,
      `${getTranslation('subtotal', state.currentLanguage)}: ${subtotalAmount} `,
      `${getTranslation('discount', state.currentLanguage)}: ${discountAmount} `,
      `${getTranslation('tax', state.currentLanguage)}(${taxPercentDisplay})     : ${taxAmountDisplay} `,
      divider,
      `${getTranslation('total', state.currentLanguage)}: ${netTotalAmount} `,
      `${getTranslation('paymentMethod', state.currentLanguage)}: ${formattedPaymentMode} `,
      getTranslation('thankYouMessage', state.currentLanguage) || 'Thank you for shopping with us!',
      divider,
      `        ${getTranslation('poweredBy', state.currentLanguage) || 'Powered by Drag & Drop'}`,
      divider
    ];

    return lines.join('\n');
  }, [customer?.name, customer?.mobileNumber, customer?.phone, state]);

  const handleShareOrder = useCallback((order) => {
    const message = buildWhatsAppMessage(order);
    if (!message) {
      showToast(getTranslation('invoiceShareError', state.currentLanguage), 'error');
      return;
    }

    const customerMobileRaw = customer?.mobileNumber || customer?.phone || order?.customerMobile || '';
    const sanitizedMobile = sanitizeMobileNumber(customerMobileRaw);

    if (!sanitizedMobile) {
      showToast(getTranslation('noMobileForShare', state.currentLanguage), 'warning');
      return;
    }

    const encodedMessage = encodeURIComponent(message);
    const targetNumber = sanitizedMobile.length === 10 ? `91${sanitizedMobile} ` : sanitizedMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${encodedMessage}`;
    window.open(waUrl, '_blank');
  }, [buildWhatsAppMessage, customer, showToast]);




  return (
    <div
      className={`fixed inset-0 bg-gray-900/60 flex items-end md:items-center justify-center z-[1050] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
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
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
        className="bg-white dark:bg-slate-800 !rounded-none md:!rounded-2xl shadow-2xl w-full md:max-w-3xl !h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden transition-all fixed inset-0 md:relative md:inset-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                <Receipt className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {getTranslation('orderHistory', state.currentLanguage)}
                </h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {customer?.name}
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseModal}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-gray-400 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/30">
              <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">
                {getTranslation('orders', state.currentLanguage)}
              </p>
              <p className="text-base sm:text-lg font-black text-blue-700 dark:text-blue-300">
                {filteredOrders.length}
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-100 dark:border-emerald-900/30">
              <p className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">
                {getTranslation('subtotal', state.currentLanguage)}
              </p>
              <p className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-300">
                {formatCurrencySmart(totalSubtotal, state.currencyFormat)}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 border border-primary-100 dark:border-primary-900/30">
              <p className="text-[10px] sm:text-xs text-primary-600 dark:text-primary-400 font-bold uppercase tracking-wider mb-1">
                {getTranslation('total', state.currentLanguage)}
              </p>
              <p className="text-base sm:text-lg font-black text-primary-700 dark:text-primary-300">
                {formatCurrencySmart(totalSpend, state.currencyFormat)}
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 sm:px-6 py-3 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-transparent text-sm font-medium text-gray-600 dark:text-slate-400 focus:outline-none"
            >
              <option value="all">{getTranslation('allOrders', state.currentLanguage)}</option>
              <option value="today">{getTranslation('today', state.currentLanguage)}</option>
              <option value="date">{getTranslation('specificDate', state.currentLanguage)}</option>
            </select>
            {filterType === 'date' && (
              <input
                type="date"
                value={filterDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-transparent text-sm font-medium text-gray-600 dark:text-slate-400 focus:outline-none border-b border-gray-200 dark:border-slate-700 ml-2"
              />
            )}
          </div>
          <span className="text-xs font-medium text-gray-400 hidden sm:inline">
            {filteredOrders.length} {getTranslation('orders', state.currentLanguage)}
          </span>
        </div>


        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 pt-4 space-y-4 min-h-0">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-slate-500">
              <ShoppingCart className="h-12 w-12 text-gray-300 dark:text-slate-700 mb-4" />
              <p className="text-sm font-medium">{getTranslation('noOrdersFound', state.currentLanguage)}</p>
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
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{getTranslation('invoiceID', state.currentLanguage)}: {order.id?.slice(-8) || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 break-words">{formatDateTime(order.createdAt || order.date)}</p>
                    </div>
                    <div className="flex items-center justify-between sm:block sm:text-right">
                      <div>
                        <p className="text-base sm:text-lg font-semibold text-emerald-600" title={formatCurrency(breakdown.netTotal)}>{formatCurrencySmart(breakdown.netTotal, state.currencyFormat)}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mt-0.5">{getPaymentMethodLabel(order.paymentMethod, order.splitPaymentDetails)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleShareOrder(order)}
                        className="sm:mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary-100 dark:border-primary-900 bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors active:scale-95"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{getTranslation('shareBill', state.currentLanguage)}</span>
                        <span className="sm:hidden">{getTranslation('share', state.currentLanguage)}</span>
                      </button>


                    </div>
                  </div>
                  {(() => {
                    const paymentMethod = (order.paymentMethod || '').toString().toLowerCase().trim();
                    if (paymentMethod === 'split') {
                      const paymentDetails = order.splitPaymentDetails || {};
                      const cashAmount = Number(paymentDetails.cashAmount) || 0;
                      const onlineAmount = Number(paymentDetails.onlineAmount) || 0;
                      const creditAmount = Number(paymentDetails.creditAmount) || 0;
                      const dueAmount = Number(paymentDetails.dueAmount) || 0;

                      return (
                        <div className="px-4 sm:px-5 pb-3">
                          <p className="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 mb-2 font-bold uppercase tracking-wider">{getTranslation('paymentBreakdown', state.currentLanguage)}</p>
                          <div className={`grid ${creditAmount > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2 sm:gap-3`}>
                            {cashAmount > 0 && (
                              <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-xl p-2 sm:p-2.5 min-w-0">
                                <p className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 font-bold uppercase mb-0.5 truncate text-center">{getTranslation('cash', state.currentLanguage)}</p>
                                <p className="text-sm sm:text-base font-bold text-green-700 dark:text-green-300 whitespace-nowrap overflow-x-auto scrollbar-hide text-center" title={formatCurrency(cashAmount)}>
                                  {formatCurrencySmart(cashAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {onlineAmount > 0 && (
                              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl p-2 sm:p-2.5 min-w-0">
                                <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold uppercase mb-0.5 truncate text-center">{getTranslation('online', state.currentLanguage)}</p>
                                <p className="text-sm sm:text-base font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap overflow-x-auto scrollbar-hide text-center" title={formatCurrency(onlineAmount)}>
                                  {formatCurrencySmart(onlineAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {creditAmount > 0 && (
                              <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30 rounded-xl p-2 sm:p-2.5 min-w-0">
                                <p className="text-[10px] sm:text-xs text-purple-600 dark:text-purple-400 font-bold uppercase mb-0.5 truncate text-center">{getTranslation('creditUsed', state.currentLanguage) || 'Credit Used'}</p>
                                <p className="text-sm sm:text-base font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap overflow-x-auto scrollbar-hide text-center" title={formatCurrency(creditAmount)}>
                                  {formatCurrencySmart(creditAmount, state.currencyFormat)}
                                </p>
                              </div>
                            )}
                            {dueAmount > 0 && (
                              <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-2 sm:p-2.5 min-w-0">
                                <p className="text-[10px] sm:text-xs text-red-600 dark:text-red-400 font-bold uppercase mb-0.5 truncate text-center">{getTranslation('due', state.currentLanguage)}</p>
                                <div className="text-sm sm:text-base font-bold text-red-700 dark:text-red-300 flex items-center justify-center gap-1.5 truncate">
                                  {(order.allPaymentClear && dueAmount > 0) ? (
                                    <>
                                      <span className="line-through text-red-900/30 dark:text-red-100/30 text-[10px] sm:text-xs" title={formatCurrency(dueAmount)}>{formatCurrencySmart(dueAmount, state.currencyFormat)}</span>
                                      <span title={formatCurrency(0)}>{formatCurrencySmart(0, state.currencyFormat)}</span>
                                    </>
                                  ) : (
                                    <span className="whitespace-nowrap overflow-x-auto scrollbar-hide text-rose-700 dark:text-rose-300" title={formatCurrency(order.allPaymentClear ? 0 : dueAmount)}>
                                      {formatCurrencySmart(order.allPaymentClear ? 0 : dueAmount, state.currencyFormat)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {orderItems.length > 0 && (
                    <div className="px-4 sm:px-5 pb-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2 min-w-0">
                          <p className="text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 uppercase font-black tracking-widest mb-1 truncate">{getTranslation('subtotal', state.currentLanguage)}</p>
                          <p className="text-sm sm:text-base font-bold text-emerald-600 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(breakdown.subtotal)}>
                            {formatCurrencySmart(breakdown.subtotal, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2 min-w-0">
                          <p className="text-[10px] sm:text-xs text-rose-600 dark:text-rose-400 uppercase font-black tracking-widest mb-1 truncate">{getTranslation('disc', state.currentLanguage)} ({(breakdown.discountPercent || 0).toFixed(0)}%)</p>
                          <p className="text-sm sm:text-base font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap overflow-x-auto scrollbar-hide" title={`- ${formatCurrency(breakdown.discountAmount)}`}>
                            - {formatCurrencySmart(breakdown.discountAmount, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2 min-w-0">
                          <p className="text-[10px] sm:text-xs text-slate-900 dark:text-slate-100 uppercase font-black tracking-widest mb-1 truncate">{getTranslation('tax', state.currentLanguage)} ({(breakdown.taxPercent || 0).toFixed(0)}%)</p>
                          <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap overflow-x-auto scrollbar-hide font-black" title={`+ ${formatCurrency(breakdown.taxAmount)}`}>
                            + {formatCurrencySmart(breakdown.taxAmount, state.currencyFormat)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2 min-w-0">
                          <p className="text-[10px] sm:text-xs text-emerald-700 dark:text-emerald-300 uppercase font-black tracking-widest mb-1 truncate">{getTranslation('total', state.currentLanguage)}</p>
                          <p className="text-sm sm:text-base font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap overflow-x-auto scrollbar-hide" title={formatCurrency(breakdown.netTotal)}>
                            {formatCurrencySmart(breakdown.netTotal, state.currencyFormat)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-800 rounded-lg sm:rounded-xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-xs sm:text-sm">
                          <thead className="bg-gray-100 dark:bg-slate-700">
                            <tr>
                              <th className="px-3 sm:px-4 py-2 text-left font-bold text-gray-600 dark:text-slate-300 whitespace-nowrap">{getTranslation('itemHeader', state.currentLanguage)}</th>
                              <th className="px-3 sm:px-4 py-2 text-center font-bold text-gray-600 dark:text-slate-300 whitespace-nowrap">{getTranslation('qtyHeader', state.currentLanguage)}</th>
                              <th className="px-3 sm:px-4 py-2 text-right font-bold text-gray-600 dark:text-slate-300 whitespace-nowrap">{getTranslation('rateHeader', state.currentLanguage)}</th>
                              <th className="px-3 sm:px-4 py-2 text-right font-bold text-gray-600 dark:text-slate-300 whitespace-nowrap">{getTranslation('totalHeader', state.currentLanguage)}</th>
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
                                  <td className="px-3 sm:px-4 py-2 text-right text-gray-600 dark:text-slate-400 whitespace-nowrap" title={formatCurrency(rate)}>{formatCurrencySmart(rate, state.currencyFormat)}</td>
                                  <td className="px-3 sm:px-4 py-2 text-right font-bold text-gray-700 dark:text-slate-300 whitespace-nowrap" title={formatCurrency(lineTotal)}>{formatCurrencySmart(lineTotal, state.currencyFormat)}</td>
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
