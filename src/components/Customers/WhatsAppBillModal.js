import React, { useState, useMemo } from 'react';
import { X, MessageCircle, FileText, Calendar, CheckSquare, Square } from 'lucide-react';
import { formatDate, formatDateTime } from '../../utils/dateUtils';

const WhatsAppBillModal = ({ customer, orders, onClose }) => {
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
        // Normalize fields for comparison
        const status = (o.status || '').toLowerCase();
        const method = (o.paymentMethod || '').toLowerCase();
        const pStatus = (o.paymentStatus || '').toLowerCase();

        console.log(`[WhatsAppModal] Checking Order ${o.id}: Status=${status}, Method=${method}, Balance=${balanceDue}`);

        // 1. "Due" status or method -> Always show
        if (status.includes('due') || method.includes('due') || pStatus.includes('due') || status === 'unpaid') return true;

        // 2. "Split" status/method -> Show if positive balance
        if (status.includes('split') || method.includes('split') || pStatus.includes('split')) {
            // Use small epsilon for float comparison, but essentially > 0
            // Also explicitly check if splitPaymentDetails has a dueAmount > 0
            if (balanceDue > 0.01) return true;
        }

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
        const storeName = localStorage.getItem('storeName') || 'our store';
        let message = `Hello ${customer.name}, greetings from ${storeName}.\n\n`;

        const selectedOrdersList = customerOrders.filter(o => selectedOrderIds.has(o.id || o._id));

        if (selectedOrdersList.length > 0) {
            message += `Here are the details of your pending bill(s):\n`;
            let totalSelectedDue = 0;

            selectedOrdersList.forEach((order, index) => {
                const date = formatDate(order.createdAt || Date.now());
                const total = order.totalAmount || 0;
                // Use robust balance check
                const balance = getBalance(order);
                const due = (balance > 0) ? balance : total;
                totalSelectedDue += due;

                message += `\n*Bill #${index + 1} (${date})*`;
                if (includeDetails && order.items && order.items.length > 0) {
                    message += `\nItems:`;
                    order.items.forEach(i => {
                        const qty = i.quantity || 1;
                        // Use strict Number conversion and handle potential string values
                        const rate = Number(i.sellingPrice || i.price || 0);
                        const amount = qty * rate;
                        message += `\n  • ${i.name}: ${qty} x ₹${rate.toFixed(2)}/unit = ₹${amount.toFixed(2)}`;
                    });
                }

                if (due < total && due > 0) {
                    message += `\nTotal: ₹${total.toFixed(2)} | *Due: ₹${due.toFixed(2)}*\n`;
                } else {
                    message += `\n*Due Amount: ₹${due.toFixed(2)}*\n`;
                }
            });

            message += `\n*Total Pending Amount: ₹${totalSelectedDue.toFixed(2)}*`;
        } else {
            // Fallback if no specific bill selected but user wants to send reminder
            const balance = Math.abs(customer.balanceDue || customer.dueAmount || 0).toFixed(2);
            if ((customer.balanceDue || 0) > 0) {
                message += `You have a total pending balance of ₹${balance}.`;
            } else {
                message += `Thank you for your business!`;
            }
        }

        message += `\n\nKindly pay at your earliest convenience. Thank you!`;

        const phone = (customer.mobileNumber || customer.phone || '').replace(/\D/g, '').slice(-10);
        const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;

        window.open(url, '_blank');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <MessageCircle className="w-6 h-6 text-green-500" />
                            Send Bill Reminder
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                            Select bills to include in the WhatsApp message
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">

                    {/* Options */}
                    <div className="flex items-center gap-4 mb-4">
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeDetails}
                                onChange={(e) => setIncludeDetails(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                            />
                            <span>Include Item Details</span>
                        </label>
                        <div className="flex-1"></div>
                        {activeOrders.length > 0 && (
                            <button
                                onClick={toggleAll}
                                className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                            >
                                {selectedOrderIds.size === activeOrders.length ? 'Deselect All' : 'Select All'}
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
                                                        Bill #{String(order.id || order._id).slice(-6).toUpperCase()}
                                                    </span>
                                                    <span className="font-bold text-gray-900 dark:text-white">
                                                        {(() => {
                                                            const total = order.totalAmount || 0;
                                                            const balance = getBalance(order);
                                                            const due = (balance > 0) ? balance : total;

                                                            // Always show Due explicitly
                                                            return (
                                                                <div className="text-right">
                                                                    {due < total && (
                                                                        <div className="text-xs text-gray-400 line-through">Total: ₹{total.toFixed(2)}</div>
                                                                    )}
                                                                    <div className={`text-sm ${due > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600'}`}>
                                                                        Due: ₹{due.toFixed(2)}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                                                    {formatDateTime(order.createdAt || Date.now())}
                                                </div>

                                                {/* Item Preview */}
                                                <div className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2">
                                                    {(order.items || []).map(i => `${i.name} (${i.quantity})`).join(', ')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>No recent bills found for this customer.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-3 bg-gray-50 dark:bg-slate-800/50 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl font-medium text-gray-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSend}
                        className="px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
                    >
                        <MessageCircle className="w-5 h-5" />
                        Send Reminder {selectedOrderIds.size > 0 ? `(${selectedOrderIds.size})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppBillModal;
