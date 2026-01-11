import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { X, Receipt, ShoppingCart, Share2, Filter } from 'lucide-react';
import { useApp, isPlanExpired, ActionTypes } from '../../context/AppContext';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDateTime, formatDate } from '../../utils/dateUtils';
import { getTranslation } from '../../utils/translations';

const SupplierOrderHistoryModal = ({ supplier, orders, onClose }) => {
    const { state } = useApp();
    const [filterType, setFilterType] = useState('all');
    const [filterDate, setFilterDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split('T')[0];
    });
    const [isClosing, setIsClosing] = useState(false);

    const handleCloseModal = () => {
        setIsClosing(true);
        setTimeout(() => {
            onClose();
            setIsClosing(false);
        }, 400);
    };

    const supplierOrders = useMemo(() => {
        if (!supplier || !orders?.length) return [];

        const supplierName = (supplier.name || '').trim().toLowerCase();

        return orders
            .filter((order) => {
                if (!order || order.isDeleted) return false;

                // Match by supplier name
                const orderSupplierName = (order.supplierName || '').trim().toLowerCase();
                return orderSupplierName === supplierName;
            })
            .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));
    }, [supplier, orders]);

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
        const raw = order.date || order.createdAt || order.updatedAt;
        return toLocalDateKey(raw);
    }, [toLocalDateKey]);

    const filteredOrders = useMemo(() => {
        if (filterType === 'all') return supplierOrders;

        const todayIso = toLocalDateKey(Date.now());

        if (filterType === 'today') {
            return supplierOrders.filter((order) => extractOrderDate(order) === todayIso);
        }

        if (filterType === 'date' && filterDate) {
            return supplierOrders.filter((order) => extractOrderDate(order) === filterDate);
        }

        return supplierOrders;
    }, [supplierOrders, extractOrderDate, filterType, filterDate, toLocalDateKey]);

    const totals = filteredOrders.reduce((acc, order) => {
        acc.totalSpend += Number(order.total || 0);
        return acc;
    }, { totalSpend: 0 });

    const { totalSpend } = totals;

    const showToast = useCallback((message, type = 'info', duration = 4000) => {
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(message, type, duration);
        }
    }, []);

    const buildWhatsAppMessage = useCallback((order) => {
        if (!order) return '';
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

        // Vendor info
        const vendorName = withNull(order.supplierName);

        const quantityWidth = 8;
        const rateWidth = 8;
        const amountWidth = 10;
        const headerLine = `${(getTranslation('itemHeader', state.currentLanguage) || 'Item').padEnd(12, ' ')}${(getTranslation('qtyHeader', state.currentLanguage) || 'Qty').padStart(quantityWidth, ' ')}   ${(getTranslation('rateHeader', state.currentLanguage) || 'Rate').padStart(rateWidth, ' ')}   ${(getTranslation('amount', state.currentLanguage) || 'Amount').padStart(amountWidth, ' ')} `;

        const items = (order.items || []).map((item) => {
            const qty = Number(item.quantity ?? 0) || 0;
            const rate = Number(item.price ?? 0) || 0;
            const total = qty * rate;
            const qtyDisplay = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
            const rateDisplay = rate.toFixed(2);
            const totalDisplay = total.toFixed(2);
            const name = (item.productName || item.name || 'null').slice(0, 12).padEnd(12, ' ');
            const qtyCol = qtyDisplay.padStart(quantityWidth, ' ');
            const rateCol = rateDisplay.padStart(rateWidth, ' ');
            const totalCol = totalDisplay.padStart(amountWidth, ' ');
            return `${name}${qtyCol}   ${rateCol}   ${totalCol} `;
        }).join('\n');

        const divider = '--------------------------------';
        const headerTitle = `             PURCHASE ORDER`; // Or localized
        const storeLine = `${getTranslation('shopNameLabel', state.currentLanguage) || 'Shop Name'}: ${storeName} `;
        const dateLine = `${getTranslation('date', state.currentLanguage) || 'Date'}: ${withNull(invoiceDate)} `;
        const totalAmount = Number.isFinite(order.total)
            ? `${formatCurrency(order.total)} `
            : '₹null';

        const lines = [
            headerTitle,
            '',
            divider,
            storeLine,
            dateLine,
            divider,
            `Supplier: ${vendorName}`,
            divider,
            headerLine,
            items || `${'null'.padEnd(12, ' ')}${'null'.padStart(quantityWidth, ' ')}   ${'null'.padStart(rateWidth, ' ')}   ${'null'.padStart(amountWidth, ' ')} `,
            divider,
            `${getTranslation('total', state.currentLanguage)}: ${totalAmount} `,
            divider
        ];

        return lines.join('\n');
    }, [state]);

    const handleShareOrder = useCallback((order) => {
        const message = buildWhatsAppMessage(order);
        if (!message) {
            showToast(getTranslation('invoiceShareError', state.currentLanguage), 'error');
            return;
        }

        // Suppliers usually have mobile numbers in Supplier object, not on the order itself (VendorOrder schema doesn't have mobile)
        // But we have `supplier` prop.
        const supplierMobileRaw = supplier?.mobileNumber || supplier?.phone || '';

        // We can't easily sanitize here if we don't have validation util, but standard window.open works.
        // Assuming utility is imported or we just strip non-digits.
        const sanitizedMobile = supplierMobileRaw.replace(/\D/g, '').slice(-10);

        if (!sanitizedMobile) {
            // Just open whatsapp with text, let user pick contact
            const encodedMessage = encodeURIComponent(message);
            const waUrl = `https://wa.me/?text=${encodedMessage}`;
            window.open(waUrl, '_blank');
            return;
        }

        const encodedMessage = encodeURIComponent(message);
        const targetNumber = `91${sanitizedMobile}`;
        const waUrl = `https://wa.me/${targetNumber}?text=${encodedMessage}`;
        window.open(waUrl, '_blank');
    }, [buildWhatsAppMessage, supplier, showToast]);

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
                className="bg-white dark:bg-slate-800 !rounded-none md:!rounded-2xl shadow-2xl w-full md:max-w-3xl !h-full md:h-auto md:max-h-[85vh] flex flex-col overflow-hidden transition-all fixed inset-0 md:relative md:inset-auto m-0"
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
                                    Purchase Order History
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-slate-400">
                                    {supplier?.name}
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

                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/30">
                            <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">
                                Purchase Orders
                            </p>
                            <p className="text-base sm:text-lg font-black text-blue-700 dark:text-blue-300">
                                {filteredOrders.length}
                            </p>
                        </div>
                        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 border border-primary-100 dark:border-primary-900/30">
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
                            <option value="all">All Purchase Orders</option>
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
                        {filteredOrders.length} Purchase Orders
                    </span>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 pb-4 pt-4 space-y-4 min-h-0">
                    {filteredOrders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-slate-500">
                            <ShoppingCart className="h-12 w-12 text-gray-300 dark:text-slate-700 mb-4" />
                            <p className="text-sm font-medium">No purchase orders found</p>
                        </div>
                    ) : (
                        filteredOrders.map((order) => {
                            const orderItems = order.items || [];
                            const total = order.total || 0;

                            return (
                                <div
                                    key={order.id}
                                    className="rounded-lg sm:rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-700/40 hover:border-primary-200 dark:hover:border-primary-800 transition-colors"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 sm:px-5 py-4">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">PO: {order.id?.slice(-8) || '—'}</p>
                                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 break-words">{formatDateTime(order.createdAt || order.date)}</p>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1 ${order.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                                order.status === 'cancelled' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                                }`}>
                                                {order.status || 'pending'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between sm:block sm:text-right">
                                            <div>
                                                <p className="text-base sm:text-lg font-semibold text-emerald-600" title={formatCurrency(total)}>{formatCurrencySmart(total, state.currencyFormat)}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleShareOrder(order)}
                                                className="sm:mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary-100 dark:border-primary-900 bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors active:scale-95"
                                            >
                                                <Share2 className="h-3.5 w-3.5" />
                                                <span className="hidden sm:inline">Share Order</span>
                                                <span className="sm:hidden">{getTranslation('share', state.currentLanguage)}</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Full Details Section */}
                                    <div className="px-4 sm:px-5 pb-3">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700">
                                            <div>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Paid Amount</p>
                                                <p className="text-sm font-bold text-green-600 dark:text-green-400">{formatCurrencySmart(order.amountPaid || 0, state.currencyFormat)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Balance Due</p>
                                                <p className={`text-sm font-bold ${(order.balanceDue || 0) > 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                                    {formatCurrencySmart(order.balanceDue || 0, state.currencyFormat)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Pay Method</p>
                                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 capitalize">{order.paymentMethod || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-wider">Pay Status</p>
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide ${(order.paymentStatus === 'paid' || (order.balanceDue || 0) <= 0) ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                                                        order.paymentStatus === 'partial' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' :
                                                            'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                                    }`}>
                                                    {order.paymentStatus || ((order.balanceDue || 0) <= 0 ? 'Paid' : 'Unpaid')}
                                                </span>
                                            </div>
                                        </div>
                                        {order.notes && (
                                            <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg border border-yellow-100 dark:border-yellow-900/30">
                                                <p className="text-[10px] text-yellow-800 dark:text-yellow-500 uppercase font-bold tracking-wider mb-1">Notes</p>
                                                <p className="text-sm text-gray-700 dark:text-gray-300 italic">"{order.notes}"</p>
                                            </div>
                                        )}
                                    </div>

                                    {orderItems.length > 0 && (
                                        <div className="px-4 sm:px-5 pb-4 space-y-3">
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
                                                            const qty = Number(item.quantity) || 0;
                                                            const rate = Number(item.price) || 0;
                                                            const lineTotal = Number(item.subtotal || (qty * rate)) || 0;

                                                            return (
                                                                <tr key={idx}>
                                                                    <td className="px-3 sm:px-4 py-2 text-gray-800 dark:text-slate-200 break-words max-w-[120px] sm:max-w-none">{item.productName || item.name}</td>
                                                                    <td className="px-3 sm:px-4 py-2 text-center text-gray-600 dark:text-slate-400 whitespace-nowrap">{qty} {item.unit || 'pcs'}</td>
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

export default SupplierOrderHistoryModal;
