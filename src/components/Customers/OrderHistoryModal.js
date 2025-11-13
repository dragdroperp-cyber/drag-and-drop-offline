import React, { useMemo, useState, useCallback } from 'react';
import { X, Receipt, ShoppingCart, Share2, Filter } from 'lucide-react';
import { sanitizeMobileNumber } from '../../utils/validation';
import { useApp } from '../../context/AppContext';

const formatCurrency = (value) => {
  const amount = Number(value || 0) || 0;
  return `₹${amount.toFixed(2)}`;
};

const formatDateTime = (value) => {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const options = {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    };
    return new Intl.DateTimeFormat('en-IN', options).format(date);
  } catch (error) {
    return value;
  }
};

const OrderHistoryModal = ({ customer, orders, onClose }) => {
  const { state } = useApp();
  const [filterType, setFilterType] = useState('all');
  const [filterDate, setFilterDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const customerOrders = useMemo(() => {
    if (!customer || !orders?.length) return [];

    const customerName = (customer.name || '').trim().toLowerCase();
    const customerId = customer.id;
    const customerMobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || '');

    return orders
      .filter((order) => {
        if (!order || order.isDeleted) return false;
        const orderCustomerId = order.customerId;
        const orderCustomerName = (order.customerName || '').trim().toLowerCase();
        const orderCustomerMobile = sanitizeMobileNumber(order.customerMobile || '');

        if (orderCustomerId && customerId && orderCustomerId === customerId) {
          return true;
        }

        if (orderCustomerName && customerName && orderCustomerName === customerName) {
          return true;
        }

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
    return `${year}-${month}-${day}`;
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
        return date.toLocaleDateString('en-IN');
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
      ? `+91 ${storePhoneSanitized}`
      : withNull(storePhoneRaw);
    const customerName = withNull(customer?.name || order.customerName);
    const customerPhoneSanitized = sanitizeMobileNumber(customer?.mobileNumber || customer?.phone || order.customerMobile || '');
    const customerPhoneDisplay = customerPhoneSanitized || 'null';

    const quantityWidth = 8;
    const rateWidth = 8;
    const amountWidth = 10;
    const headerLine = `${'Item'.padEnd(12, ' ')}${'Qty'.padStart(quantityWidth, ' ')}   ${'Rate'.padStart(rateWidth, ' ')}   ${'Amount'.padStart(amountWidth, ' ')}`;

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
      return `${name}${qtyCol}   ${rateCol}   ${totalCol}`;
    }).join('\n');

    const divider = '--------------------------------';
    const headerTitle = '             INVOICE';
    const storeLine = `Shop Name : ${storeName}`;
    const addressLine = `Address   : ${storeAddress}`;
    const phoneLine = `Phone     : ${storePhoneDisplay}`;
    const dateLine = `Date      : ${withNull(invoiceDate)}`;
    const paymentMode = (order.paymentMethod || 'null').toString().trim();
    const formattedPaymentMode = paymentMode.toLowerCase() === 'null'
      ? 'null'
      : paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();
    const discountAmount = Number.isFinite(breakdown.discountAmount)
      ? `₹${breakdown.discountAmount.toFixed(2)}`
      : '₹null';
    const subtotalAmount = Number.isFinite(breakdown.subtotal)
      ? `₹${breakdown.subtotal.toFixed(2)}`
      : '₹null';
    const netTotalAmount = Number.isFinite(breakdown.netTotal)
      ? `₹${breakdown.netTotal.toFixed(2)}`
      : '₹null';
    const taxPercentRaw = Number.isFinite(breakdown.taxPercent) ? breakdown.taxPercent : null;
    const taxPercentDisplay = taxPercentRaw === null
      ? 'null'
      : `${(taxPercentRaw % 1 === 0 ? taxPercentRaw.toFixed(0) : taxPercentRaw.toFixed(2))}%`;
    const taxAmountDisplay = Number.isFinite(breakdown.taxAmount)
      ? `₹${breakdown.taxAmount.toFixed(2)}`
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
      `Customer Name : ${customerName}`,
      `Customer Phone: ${customerPhoneDisplay}`,
      divider,
      headerLine,
      items || `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(rateWidth, ' ')}   ${'null'.padStart(amountWidth, ' ')}`,
      divider,
      `Subtotal     : ${subtotalAmount}`,
      `Discount     : ${discountAmount}`,
      `Tax (${taxPercentDisplay})     : ${taxAmountDisplay}`,
      divider,
      `Grand Total  : ${netTotalAmount}`,
      `Payment Mode : ${formattedPaymentMode}`,
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
    const targetNumber = sanitizedMobile.length === 10 ? `91${sanitizedMobile}` : sanitizedMobile;
    const waUrl = `https://wa.me/${targetNumber}?text=${encodedMessage}`;
    window.open(waUrl, '_blank');
  }, [buildWhatsAppMessage, customer, showToast]);

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[1050] px-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary-600" />
              Order History
            </h2>
            <p className="text-sm text-gray-500">
              {customer?.name || 'Customer'} • {filteredOrders.length} orders • Net paid {formatCurrency(totalSpend)}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                Subtotal {formatCurrency(totalSubtotal)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Discount {formatCurrency(roundAmount(totalDiscount))}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                Tax {formatCurrency(roundAmount(totalTax))}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                Total {formatCurrency(roundAmount(totalSpend))}
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
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
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
            aria-label="Close order history"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pt-3 pb-4 sm:hidden">
          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-gray-600">Filter Orders</label>
            <div className="flex items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="input-field text-sm"
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
                  className="input-field text-sm"
                />
              )}
            </div>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[70vh] px-6 pb-4 space-y-4">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <ShoppingCart className="h-12 w-12 text-gray-300 mb-4" />
              <p className="text-sm font-medium">No orders found for this selection.</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const orderItems = order.items || [];
              const breakdown = computeFinancialBreakdown(order);

              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-gray-200 bg-gray-50/40 hover:border-primary-200 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Invoice ID: {order.id?.slice(-8) || '—'}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(order.createdAt || order.date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-primary-600">{formatCurrency(breakdown.netTotal)}</p>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">{order.paymentMethod || 'cash'}</p>
                      <button
                        type="button"
                        onClick={() => handleShareOrder(order)}
                        className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary-100 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-100 transition"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share Bill
                      </button>
                    </div>
                  </div>
                  {orderItems.length > 0 && (
                    <div className="px-5 pb-4 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2.5">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Subtotal</p>
                          <p className="text-sm font-semibold text-gray-900">{formatCurrency(breakdown.subtotal)}</p>
                        </div>
                        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2.5">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Discount ({(breakdown.discountPercent || 0).toFixed(2)}%)</p>
                          <p className="text-sm font-semibold text-emerald-600">
                            - {formatCurrency(breakdown.discountAmount)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2.5">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Tax ({(breakdown.taxPercent || 0).toFixed(2)}%)</p>
                          <p className="text-sm font-semibold text-purple-600">
                            + {formatCurrency(breakdown.taxAmount)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2.5">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Net Total</p>
                          <p className="text-sm font-semibold text-primary-600">{formatCurrency(breakdown.netTotal)}</p>
                        </div>
                      </div>

                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                              <th className="px-4 py-2 text-center font-medium text-gray-600">Qty</th>
                              <th className="px-4 py-2 text-right font-medium text-gray-600">Rate</th>
                              <th className="px-4 py-2 text-right font-medium text-gray-600">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {orderItems.map((item, idx) => {
                              const rate = Number(item.sellingPrice ?? item.price ?? 0) || 0;
                              const qty = Number(item.quantity ?? 0) || 0;
                              const lineTotal = rate * qty;
                              return (
                                <tr key={idx}>
                                  <td className="px-4 py-2 text-gray-800">{item.name}</td>
                                  <td className="px-4 py-2 text-center text-gray-600">{qty} {item.unit || item.quantityUnit || ''}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(rate)}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-700">{formatCurrency(lineTotal)}</td>
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

