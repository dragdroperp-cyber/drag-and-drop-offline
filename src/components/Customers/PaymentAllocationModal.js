import React, { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { formatCurrency } from '../../utils/orderUtils';

const PaymentAllocationModal = ({
    customer,
    paymentAmount,
    pendingOrders,
    onClose,
    onConfirm
}) => {
    const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());

    const getOrderDue = (order) => {
        if (order.paymentMethod === 'split' && order.splitPaymentDetails) {
            return Number(order.splitPaymentDetails.dueAmount || 0);
        }
        if (order.paymentMethod === 'due' || order.paymentMethod === 'credit') {
            return Number(order.totalAmount || order.total || 0);
        }
        return 0;
    };

    const toggleOrder = (orderId) => {
        const newSelected = new Set(selectedOrderIds);
        if (newSelected.has(orderId)) {
            newSelected.delete(orderId);
        } else {
            newSelected.add(orderId);
        }
        setSelectedOrderIds(newSelected);
    };

    // Calculate allocations based on selection order (insertion order in Set)
    const { allocationMap, totalAllocated, remainingBalance, totalDuesRemaining } = useMemo(() => {
        const map = {};
        let remaining = paymentAmount;

        // Set iteration preserves insertion order
        selectedOrderIds.forEach(id => {
            const order = pendingOrders.find(o => o.id === id);
            if (!order) return;
            const due = getOrderDue(order);

            // Allocate as much as possible to this order
            let alloc = Math.min(due, remaining);
            // Fix float precision
            alloc = Math.floor(alloc * 100) / 100;

            if (alloc > 0.005) { // Threshold for essentially zero
                map[id] = alloc;
                remaining -= alloc;
            }
        });

        remaining = Math.max(0, parseFloat(remaining.toFixed(2)));
        const total = parseFloat((paymentAmount - remaining).toFixed(2));

        // Calculate total dues still left across all orders
        let duesLeft = 0;
        pendingOrders.forEach(order => {
            const dueTotal = getOrderDue(order);
            const allocatedToThis = map[order.id] || 0;
            duesLeft += Math.max(0, dueTotal - allocatedToThis);
        });

        return {
            allocationMap: map,
            totalAllocated: total,
            remainingBalance: remaining,
            totalDuesRemaining: duesLeft
        };
    }, [selectedOrderIds, paymentAmount, pendingOrders]);

    const canConfirm = remainingBalance < 0.01 || totalDuesRemaining < 0.01;

    return (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[200] animate-fadeIn p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800">
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">Allocate Payment</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-400 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Info Banner */}
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <div className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-700/50">
                        <h4 className="text-slate-900 dark:text-white font-bold text-base">{customer.name}</h4>
                        <p className="text-slate-500 dark:text-slate-400 text-xs">{customer.mobileNumber || customer.phone || ''}</p>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Total Payment:</span>
                            <span className="font-bold text-slate-900 dark:text-white text-xl">{formatCurrency(paymentAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Allocated to Orders:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(totalAllocated)}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-sm mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/50">
                            <span className="text-slate-500 dark:text-slate-400 font-medium">Remaining to Account:</span>
                            <span className="font-bold text-slate-900 dark:text-white">
                                {formatCurrency(remainingBalance)}
                            </span>
                        </div>
                    </div>
                </div>


                {/* Order List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 dark:bg-slate-900/50">
                    {pendingOrders.length === 0 ? (
                        <p className="text-center text-gray-500 py-4">No pending orders found.</p>
                    ) : (
                        pendingOrders.map(order => {
                            const due = getOrderDue(order);
                            const isSelected = selectedOrderIds.has(order.id);
                            const allocated = allocationMap[order.id] || 0;

                            // Disable item if not selected and no money left to allocate
                            // But allow deselection logic via click even if fully used elsewhere? 
                            // Toggle logic handles deselect.
                            // We only block selecting NEW ones if remaining is 0.
                            const isItemDisabled = !isSelected && remainingBalance <= 0.01;

                            const isPartial = allocated > 0 && allocated < due;

                            return (
                                <div
                                    key={order.id}
                                    onClick={() => !isItemDisabled && toggleOrder(order.id)}
                                    className={`p-3 border rounded-xl cursor-pointer flex flex-col gap-2 transition-all select-none
                         ${isSelected
                                            ? 'bg-blue-50/50 border-blue-500 dark:bg-blue-900/20 dark:border-blue-500/50'
                                            : 'bg-white border-gray-200 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300'}
                         ${isItemDisabled ? 'opacity-50 cursor-not-allowed grayscale' : ''}
                      `}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0
                               ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900'}
                            `}>
                                                {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900 dark:text-white">
                                                    Invoice #{order.id ? order.id.toString().slice(-6) : '-'}
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                                    {new Date(order.createdAt || order.date).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-sm text-gray-900 dark:text-white">{formatCurrency(due)}</p>
                                            <p className="text-[10px] font-bold text-red-500 uppercase">Due</p>
                                        </div>
                                    </div>

                                    {isSelected && (
                                        <div className="flex items-center justify-between pt-2 border-t border-dashed border-blue-200 dark:border-blue-800/50">
                                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Paying:</span>
                                            <div className="text-right">
                                                <span className={`text-sm font-bold ${isPartial ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                    {formatCurrency(allocated)}
                                                </span>
                                                {isPartial && (
                                                    <span className="text-[10px] text-gray-500 block">
                                                        Remaining: {formatCurrency(due - allocated)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <button
                        disabled={!canConfirm}
                        onClick={() => onConfirm(allocationMap)}
                        className={`w-full py-3.5 rounded-xl font-bold transition-all active:scale-[0.98] 
                            ${!canConfirm
                                ? 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-600 cursor-not-allowed'
                                : 'bg-gray-900 dark:bg-white text-white dark:text-slate-900 shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20'}
                        `}
                    >
                        {!canConfirm && totalDuesRemaining > 0
                            ? 'Allocate Dues to Continue'
                            : (selectedOrderIds.size > 0
                                ? `Confirm & Pay ${formatCurrency(totalAllocated)}`
                                : 'Skip Order Allocation')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentAllocationModal;
