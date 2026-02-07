import React, { useMemo, useState, useCallback } from 'react';
import { X, History, ArrowUpRight, ArrowDownLeft, Calendar, Filter, Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { formatDateTime } from '../../utils/dateUtils';
import { getTranslation } from '../../utils/translations';
import { ActionTypes } from '../../context/AppContext';

const SupplierTransactionHistoryModal = ({ supplier, transactions, onClose }) => {
    const { state, dispatch } = useApp();
    const [filterType, setFilterType] = useState('all');
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 400);
    };



    const allTransactions = useMemo(() => {
        if (!supplier) return [];

        const sId = supplier.id?.toString();
        const sMongoId = supplier._id?.toString();
        const sLocalId = supplier.localId?.toString();

        const filtered = (transactions || [])
            .filter(t => {
                const tSupplierId = t.supplierId?.toString();
                return (tSupplierId === sId || (sMongoId && tSupplierId === sMongoId) || (sLocalId && tSupplierId === sLocalId)) && !t.isDeleted;
            });

        const currentDue = Number(supplier.dueAmount || supplier.balanceDue || 0);
        let trackedDues = 0;
        let trackedPayments = 0;

        const hasExistingOpeningBalance = filtered.some(t => t.type === 'opening_balance');

        filtered.forEach(t => {
            const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'remove_due', 'refund', 'purchase_return', 'return', 'cancel_purchase', 'debit_note', 'credit_note', 'settlement'].includes(t.type);
            const isCredit = ['due', 'add_due', 'opening_balance', 'purchase_order', 'credit_usage'].includes(t.type);
            if (isPayment) trackedPayments += Math.abs(Number(t.amount || 0));
            else if (isCredit) trackedDues += Math.abs(Number(t.amount || 0));
        });

        const openingBalanceAmount = parseFloat((currentDue - trackedDues + trackedPayments).toFixed(2));
        const result = [...filtered];

        if (openingBalanceAmount !== 0 && !hasExistingOpeningBalance) {
            // result.push({
            //     id: 'opening-balance',
            //     type: openingBalanceAmount > 0 ? 'opening_balance' : 'payment', // Positive = We owe.
            //     amount: Math.abs(openingBalanceAmount),
            //     date: supplier.createdAt || new Date(0).toISOString(),
            //     description: openingBalanceAmount > 0 ? 'Opening Balance (Payable)' : 'Opening Advance',
            //     isOpeningBalance: true
            // });
        }

        return result.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    }, [supplier, transactions]);

    const filteredTransactions = useMemo(() => {
        if (filterType === 'all') return allTransactions;
        return allTransactions.filter(t => {
            if (filterType === 'payment') {
                return ['payment', 'cash', 'online', 'upi', 'card', 'remove_due', 'refund', 'purchase_return', 'return', 'cancel_purchase', 'debit_note', 'credit_note', 'settlement'].includes(t.type);
            }
            if (filterType === 'credit') {
                return ['due', 'add_due', 'purchase_order'].includes(t.type);
            }
            return t.type === filterType;
        });
    }, [allTransactions, filterType]);

    const totals = useMemo(() => {
        return allTransactions.reduce((acc, t) => {
            const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'remove_due', 'cancel_purchase', 'debit_note', 'credit_note', 'settlement'].includes(t.type);
            const isRefund = t.type === 'refund' || t.type === 'purchase_return' || t.type === 'return';
            const isCredit = ['due', 'add_due', 'opening_balance', 'purchase_order', 'credit_usage'].includes(t.type);
            const isPureBill = ['purchase_order'].includes(t.type);

            if (isPayment) {
                acc.payments += Math.abs(Number(t.amount || 0));
            } else if (isRefund) {
                acc.refunds += Math.abs(Number(t.amount || 0));
            } else if (isCredit) {
                acc.credits += Math.abs(Number(t.amount || 0));
            }

            if (isPureBill) {
                acc.totalBilled += Math.abs(Number(t.amount || 0));
            }

            return acc;
        }, { payments: 0, credits: 0, totalBilled: 0, refunds: 0 });
    }, [allTransactions]);

    // Net Paid = Payments + Refunds (Both reduce the debt)
    const netPaid = totals.payments + totals.refunds;
    const currentDue = totals.credits - netPaid;

    return (
        <div
            className={`fixed inset-0 bg-gray-900/60 flex items-end md:items-center justify-center z-[1050] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={handleClose}
        >
            <style>{`
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
            `}</style>
            <div
                key={isClosing ? 'closing' : 'opening'}
                style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
                className="bg-white dark:bg-slate-800 !rounded-none md:!rounded-2xl shadow-2xl w-full md:max-w-4xl !h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden transition-all fixed inset-0 md:relative md:inset-auto m-0"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                <History className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Supplier History
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-slate-400">
                                    {supplier?.name}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleClose}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl text-gray-400 transition-colors"
                        >
                            <X className="h-6 w-6" />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-100 dark:border-emerald-900/30">
                            <p className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">Total Paid</p>
                            <p className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-300">
                                {formatCurrencySmart(totals.payments, state.currencyFormat)}
                            </p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 border border-blue-100 dark:border-blue-900/30">
                            <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">Total Refunded</p>
                            <p className="text-base sm:text-lg font-black text-blue-700 dark:text-blue-300">
                                {formatCurrencySmart(totals.refunds, state.currencyFormat)}
                            </p>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-100 dark:border-amber-900/30">
                            <p className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider mb-1">Total Billed</p>
                            <p className="text-base sm:text-lg font-black text-amber-700 dark:text-amber-300">
                                {formatCurrencySmart(totals.totalBilled, state.currencyFormat)}
                            </p>
                        </div>
                        <div className={`rounded-xl p-3 border ${currentDue > 0
                            ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-900/30'
                            : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/30'
                            }`}>
                            <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 ${currentDue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                                }`}>Current Due</p>
                            <p className={`text-base sm:text-lg font-black ${currentDue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                                }`}>
                                {formatCurrencySmart(Math.abs(currentDue), state.currencyFormat)}
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
                            <option value="all">All Transactions</option>
                            <option value="payment">Payments Only</option>
                            <option value="credit">Bills/Dues Only</option>
                        </select>
                    </div>
                    <span className="text-xs font-medium text-gray-400">
                        {filteredTransactions.length} Transactions
                    </span>
                </div>

                {/* Transactions List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                    {filteredTransactions.length > 0 ? (
                        filteredTransactions.map((t) => {
                            const isPayment = ['payment', 'cash', 'online', 'upi', 'card'].includes(t.type);
                            const isRefund = t.type === 'refund';
                            const isCancel = t.type === 'cancel_purchase';

                            let typeLabel = isPayment ? 'Payment to Supplier' : 'Purchase/Due Added';
                            if (t.type === 'add_due') typeLabel = 'Manual Balance Increase';
                            if (t.type === 'opening_balance') typeLabel = 'Opening Balance';
                            if (t.type === 'purchase_order') typeLabel = 'Purchase Order';
                            if (isCancel) typeLabel = 'Cancelled Purchase Order';
                            if (isRefund) typeLabel = 'Refund Received';
                            if (t.type === 'payment' && t.description?.includes('Manual')) typeLabel = 'Manual Balance Decrease';

                            return (
                                <div
                                    key={t.id || t._id}
                                    className="bg-white dark:bg-slate-700/30 border border-gray-100 dark:border-slate-700 rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isPayment || isRefund
                                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                                            }`}>
                                            {isPayment || isRefund ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white">
                                                {typeLabel}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                                                <Calendar className="h-3 w-3" />
                                                <span>{formatDateTime(t.date || t.createdAt)}</span>
                                            </div>
                                            {(t.note || t.description) && (
                                                <p className="text-xs text-gray-400 mt-1 italic">"{t.note || t.description}"</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        {Math.abs(Number(t.amount || 0)) < 0.001 ? (
                                            <p className="text-lg font-black text-gray-400 dark:text-gray-500">
                                                {formatCurrencySmart(t.amount, state.currencyFormat)}
                                            </p>
                                        ) : (
                                            <p className={`text-lg font-black ${(isPayment || isRefund) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                {isPayment ? '-' : (isRefund ? '+' : (isCancel ? '' : '+'))}{formatCurrencySmart(t.amount, state.currencyFormat)}
                                            </p>
                                        )}
                                        {(t.previousBalance !== undefined || t.currentBalance !== undefined) && (
                                            <div className="mt-1 flex flex-col items-end opacity-70">
                                                <div className="flex items-center gap-1 text-[9px] text-gray-500 dark:text-slate-400 font-medium">
                                                    <span>Previous:</span>
                                                    <span>{formatCurrencySmart(t.previousBalance || 0, state.currencyFormat)}</span>
                                                </div>
                                                <div className="flex items-center gap-1 text-[9px] text-gray-900 dark:text-white font-bold">
                                                    <span>New:</span>
                                                    <span>{formatCurrencySmart(t.currentBalance || 0, state.currencyFormat)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-gray-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                                <History className="h-8 w-8 text-gray-300 dark:text-slate-600" />
                            </div>
                            <p className="text-gray-500 dark:text-slate-400">No transactions found for this period.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SupplierTransactionHistoryModal;
