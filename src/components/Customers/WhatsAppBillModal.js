import React, { useState, useMemo } from 'react';
import { X, MessageCircle, FileText, Calendar, CheckSquare, Square } from 'lucide-react';
import { formatDate, formatDateTime } from '../../utils/dateUtils';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

import { formatCurrency, calculateItemRateAndTotal } from '../../utils/orderUtils';

const WhatsAppBillModal = ({ customer, orders, onClose }) => {
    const { state } = useApp();
    // Filter orders for this customer (handling various potential ID fields)
    const customerOrders = useMemo(() => {
        if (!customer || !orders) return [];
        const cId = customer.id || customer._id;

        // Sort orders by date descending
        return orders
            .filter(o => {
                // Match by id or string comparison if types differ
                return (o.customerId && String(o.customerId) === String(cId)) ||
                    (o.customer?.id && String(o.customer.id) === String(cId)) ||
                    (o.customer?._id && String(o.customer._id) === String(cId));
            })
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }, [customer, orders]);

    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
    const [includeDetails, setIncludeDetails] = useState(true);

    // Check all potential fields for balance, including inside splitPaymentDetails
    const getBalance = (o) => {
        // 1. Direct balanceDue field
        if (o.balanceDue !== undefined && o.balanceDue !== null) return parseFloat(o.balanceDue);

        // 2. Direct dueAmount field
        if (o.dueAmount !== undefined && o.dueAmount !== null) return parseFloat(o.dueAmount);

        // 3. Nested dueAmount inside splitPaymentDetails (as per user example)
        if (o.splitPaymentDetails && o.splitPaymentDetails.dueAmount !== undefined) {
            return parseFloat(o.splitPaymentDetails.dueAmount);
        }

        return 0;
    };

    // Quick filters
    const pendingOrders = customerOrders.filter(o => {
        const balanceDue = getBalance(o);
        const status = (o.status || '').toLowerCase();
        const method = (o.paymentMethod || '').toLowerCase();
        const pStatus = (o.paymentStatus || '').toLowerCase();

        // 1. If it has a clear positive balance, it's definitely pending
        if (balanceDue > 0.01) return true;

        // 2. If it's marked as due but balance is exactly 0, it might be settled OR legacy missing field
        const isMarkedDue = status.includes('due') || method.includes('due') || pStatus.includes('due') || status === 'unpaid';

        // If it's a legacy order (no balance field) but marked as due, assume full total is pending
        const hasNoBalanceField = o.balanceDue === undefined && o.dueAmount === undefined && !(o.splitPaymentDetails && o.splitPaymentDetails.dueAmount !== undefined);

        if (isMarkedDue && hasNoBalanceField) return true;

        return false;
    });
    const activeOrders = pendingOrders.length > 0 ? pendingOrders : [];

    const toggleOrder = (orderId) => {
        const next = new Set(selectedOrderIds);
        if (next.has(orderId)) {
            next.delete(orderId);
        } else {
            next.add(orderId);
        }
        setSelectedOrderIds(next);
    };

    const toggleAll = () => {
        if (selectedOrderIds.size === activeOrders.length) {
            setSelectedOrderIds(new Set());
        } else {
            setSelectedOrderIds(new Set(activeOrders.map(o => o.id || o._id)));
        }
    };

    const handleSend = () => {
        // Construct Message
        const storeName = localStorage.getItem('storeName') || getTranslation('our store', state.currentLanguage);
        const greeting = getTranslation('greetingDear', state.currentLanguage).replace('{name}', customer.name);
        const fromMsg = getTranslation('greetingsFrom', state.currentLanguage);
        let message = `${greeting}\n\n${fromMsg} *${storeName}*.\n\n`;

        const selectedOrdersList = customerOrders.filter(o => selectedOrderIds.has(o.id || o._id));

        if (selectedOrdersList.length > 0) {
            message += `${getTranslation('pendingBillDetails', state.currentLanguage)}\n`;
            let totalSelectedDue = 0;

            selectedOrdersList.forEach((order, index) => {
                const date = formatDate(order.createdAt || Date.now());
                const total = order.totalAmount ?? order.total ?? 0;
                const status = (order.status || '').toLowerCase();
                const method = (order.paymentMethod || '').toLowerCase();
                const pStatus = (order.paymentStatus || '').toLowerCase();

                // Use robust balance check
                const balance = getBalance(order);
                const hasNoBalanceField = order.balanceDue === undefined && order.dueAmount === undefined && !(order.splitPaymentDetails && order.splitPaymentDetails.dueAmount !== undefined);

                // If legacy due order with no balance field, assume full total is due
                const isMarkedDue = status.includes('due') || method.includes('due') || pStatus.includes('due') || status === 'unpaid';
                const due = (balance > 0) ? balance : ((isMarkedDue && hasNoBalanceField) ? total : 0);
                totalSelectedDue += due;

                message += `\n*${getTranslation('billHash', state.currentLanguage)}${index + 1} (${date})*`;
                if (includeDetails && order.items && order.items.length > 0) {
                    message += `\n${getTranslation('items', state.currentLanguage)}:`;
                    order.items.forEach(i => {
                        const { rate, total: amount, qty, unit } = calculateItemRateAndTotal(i);
                        message += `\n  • ${i.name}: ${qty} ${unit} x ${formatCurrency(rate)}/unit = ${formatCurrency(amount)}`;
                    });
                }

                if (due < total && due > 0) {
                    message += `\n${getTranslation('total', state.currentLanguage)}: ${formatCurrency(total)} | *${getTranslation('due', state.currentLanguage)}: ${formatCurrency(due)}*\n`;
                } else {
                    message += `\n*${getTranslation('due', state.currentLanguage)}: ${formatCurrency(due)}*\n`;
                }
            });

            message += `\n*${getTranslation('totalPendingAmount', state.currentLanguage)}: ${formatCurrency(totalSelectedDue)}*`;
        } else {
            // Fallback if no specific bill selected but user wants to send reminder
            const balance = Math.abs(customer.balanceDue || customer.dueAmount || 0);
            if ((customer.balanceDue || 0) > 0) {
                message += `${getTranslation('totalPendingBalance', state.currentLanguage)} ${formatCurrency(balance)}.`;
            } else {
                message += getTranslation('thankYouForBusiness', state.currentLanguage);
            }
        }

        message += `\n\n${getTranslation('kindlyPaySoon', state.currentLanguage)}`;

        const phone = (customer.mobileNumber || customer.phone || '').replace(/\D/g, '').slice(-10);
        const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;

        window.open(url, '_blank');
        onClose();
    };

    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            onClose();
            setIsClosing(false);
        }, 400);
    };

    return (
        <div
            className={`fixed inset-0 bg-gray-900 bg-opacity-50 flex items-end md:items-center justify-center z-[60] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={handleClose}
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
                className="bg-white dark:bg-slate-800 !rounded-none md:!rounded-xl shadow-2xl w-full md:max-w-lg !h-full md:!h-auto md:max-h-[90vh] flex flex-col transition-colors fixed inset-0 md:relative md:inset-auto overflow-hidden m-0"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-700">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            {getTranslation('sendBillReminder', state.currentLanguage)}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                            {getTranslation('selectBillsToInclude', state.currentLanguage)}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar space-y-4">

                    {/* Options */}
                    <div className="flex items-center gap-4 mb-2">
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeDetails}
                                onChange={(e) => setIncludeDetails(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-4 h-4"
                            />
                            <span>{getTranslation('includeItemDetails', state.currentLanguage)}</span>
                        </label>
                        <div className="flex-1"></div>
                        {activeOrders.length > 0 && (
                            <button
                                onClick={toggleAll}
                                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                            >
                                {selectedOrderIds.size === activeOrders.length ? getTranslation('deselectAll', state.currentLanguage) : getTranslation('selectAll', state.currentLanguage)}
                            </button>
                        )}
                    </div>

                    {/* Orders List */}
                    <div className="space-y-3">
                        {activeOrders.length > 0 ? (
                            activeOrders.map(order => {
                                const isSelected = selectedOrderIds.has(order.id || order._id);
                                return (
                                    <div
                                        key={order.id || order._id}
                                        onClick={() => toggleOrder(order.id || order._id)}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all ${isSelected
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500'
                                            : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`mt-1 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
                                                {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-semibold text-gray-900 dark:text-white">
                                                        {getTranslation('billHash', state.currentLanguage)}{String(order.id || order._id).slice(-6).toUpperCase()}
                                                    </span>
                                                    <span className="font-bold text-gray-900 dark:text-white">
                                                        {(() => {
                                                            const total = order.totalAmount ?? order.total ?? 0;
                                                            const status = (order.status || '').toLowerCase();
                                                            const method = (order.paymentMethod || '').toLowerCase();
                                                            const pStatus = (order.paymentStatus || '').toLowerCase();
                                                            const balance = getBalance(order);
                                                            const hasNoBalanceField = order.balanceDue === undefined && order.dueAmount === undefined && !(order.splitPaymentDetails && order.splitPaymentDetails.dueAmount !== undefined);
                                                            const isMarkedDue = status.includes('due') || method.includes('due') || pStatus.includes('due') || status === 'unpaid';
                                                            const due = (balance > 0) ? balance : ((isMarkedDue && hasNoBalanceField) ? total : 0);

                                                            return (
                                                                <div className="text-right">
                                                                    {due < total && (
                                                                        <div className="text-xs text-gray-400 line-through">{getTranslation('total', state.currentLanguage)}: {formatCurrency(total)}</div>
                                                                    )}
                                                                    <div className={`text-sm ${due > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600'}`}>
                                                                        {getTranslation('due', state.currentLanguage)}: {formatCurrency(due)}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                                                    {formatDateTime(order.createdAt || Date.now())}
                                                </div>


                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>{getTranslation('noRecentBillsFound', state.currentLanguage)}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 flex justify-end gap-3 pt-4 pb-4 px-6 bg-white dark:bg-slate-800 border-t dark:border-slate-700">
                    <button
                        onClick={handleClose}
                        className="px-5 py-3 rounded-xl font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 border border-transparent transition-colors"
                    >
                        {getTranslation('cancel', state.currentLanguage)}
                    </button>
                    <button
                        onClick={handleSend}
                        className="flex-1 sm:flex-none px-6 py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                    >
                        <MessageCircle className="w-5 h-5" />
                        {getTranslation('sendReminder', state.currentLanguage)} {selectedOrderIds.size > 0 ? `(${selectedOrderIds.size})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppBillModal;
