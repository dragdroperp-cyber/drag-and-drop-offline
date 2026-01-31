import React, { useMemo, useState, useCallback } from 'react';
import { X, History, ArrowUpRight, ArrowDownLeft, Calendar, Filter, Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { formatDateTime, formatDate } from '../../utils/dateUtils';
import { getTranslation } from '../../utils/translations';

const TransactionHistoryModal = ({ customer, transactions, onClose }) => {
    const { state, dispatch } = useApp();
    const [filterType, setFilterType] = useState('all');
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(onClose, 400);
    };

    // Auto-correct customer balance if it is out of sync with transactions
    // This handles the case where the stored balanceDue doesn't match the history
    React.useEffect(() => {
        if (!customer || !transactions) return;

        const cId = customer.id?.toString();
        const cMongoId = customer._id?.toString();

        // Get all transactions for this customer
        const customerTransactions = (transactions || [])
            .filter(t => {
                const tCustomerId = t.customerId?.toString();
                return (tCustomerId === cId || (cMongoId && tCustomerId === cMongoId)) && !t.isDeleted;
            });

        // Only correct if we have an explicit opening balance (which serves as the anchor)
        const hasExistingOpeningBalance = customerTransactions.some(t => t.type === 'opening_balance');

        if (hasExistingOpeningBalance) {
            const currentDue = Number(customer.dueAmount || customer.balanceDue || 0);
            let trackedDues = 0;
            let trackedPayments = 0;

            customerTransactions.forEach(t => {
                const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
                const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);
                if (isPayment) trackedPayments += Number(t.amount || 0);
                else if (isCredit) trackedDues += Number(t.amount || 0);
            });

            // "discrepancy" represents the difference between the Stored Balance and the Calculated Balance
            // If correct, Current Due = Dues - Payments (assuming Opening Balance is included in Dues/Payments)
            // Wait, standard formula: Balance = Sum(Dues) - Sum(Payments)
            // If currentDue is -65, and (Dues-Payments) is -5.
            // Discrepancy = -65 - (-5) = -60.
            const calculatedBalance = parseFloat((trackedDues - trackedPayments).toFixed(2));
            const diff = Math.abs(currentDue - calculatedBalance);

            if (diff > 0.05) { // Allow tiny float margin
                // console.log("Auto-correcting customer balance", customer.id, currentDue, "->", calculatedBalance);
                const updatedCustomer = {
                    ...customer,
                    dueAmount: calculatedBalance,
                    balanceDue: calculatedBalance,
                    isSynced: false // Mark for sync
                };
                dispatch({
                    type: 'UPDATE_CUSTOMER',
                    payload: updatedCustomer
                });
            }
        }
    }, [customer, transactions, dispatch]);

    const allTransactions = useMemo(() => {
        if (!customer) return [];

        const cId = customer.id?.toString();
        const cMongoId = customer._id?.toString();

        const filtered = (transactions || [])
            .filter(t => {
                const tCustomerId = t.customerId?.toString();
                return (tCustomerId === cId || (cMongoId && tCustomerId === cMongoId)) && !t.isDeleted;
            });

        const currentDue = Number(customer.dueAmount || customer.balanceDue || 0);
        let trackedDues = 0;
        let trackedPayments = 0;

        // Check if there's already an explicit opening balance transaction
        const hasExistingOpeningBalance = filtered.some(t => t.type === 'opening_balance');

        filtered.forEach(t => {
            const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
            const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);
            if (isPayment) trackedPayments += Number(t.amount || 0);
            else if (isCredit) trackedDues += Number(t.amount || 0);
        });

        const openingBalanceAmount = parseFloat((currentDue - trackedDues + trackedPayments).toFixed(2));

        const result = [...filtered];

        // Only add synthetic opening balance if there isn't one already AND the math requires it
        if (openingBalanceAmount !== 0 && !hasExistingOpeningBalance) {
            result.push({
                id: 'opening-balance',
                type: openingBalanceAmount > 0 ? 'credit' : 'payment',
                amount: Math.abs(openingBalanceAmount),
                date: customer.createdAt || new Date(0).toISOString(),
                description: openingBalanceAmount > 0 ? 'Opening Balance' : 'Opening Advance',
                isOpeningBalance: true
            });
        }

        return result.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    }, [customer, transactions]);

    const filteredTransactions = useMemo(() => {
        if (filterType === 'all') return allTransactions;
        return allTransactions.filter(t => {
            if (filterType === 'payment') {
                return ['payment', 'cash', 'online', 'upi', 'card'].includes(t.type);
            }
            if (filterType === 'credit') {
                return ['credit', 'due', 'add_due', 'credit_usage'].includes(t.type);
            }
            return t.type === filterType;
        });
    }, [allTransactions, filterType]);

    const totals = useMemo(() => {
        return allTransactions.reduce((acc, t) => {
            const isPayment = ['payment', 'cash', 'online', 'upi', 'card', 'refund', 'remove_due'].includes(t.type);
            const isCredit = ['credit', 'due', 'add_due', 'credit_usage', 'opening_balance', 'settlement'].includes(t.type);

            if (isPayment) {
                acc.payments += Number(t.amount || 0);
            } else if (isCredit) {
                acc.credits += Number(t.amount || 0);
            }
            return acc;
        }, { payments: 0, credits: 0 });
    }, [allTransactions]);

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
                className="bg-white dark:bg-slate-800 !rounded-none md:!rounded-2xl shadow-2xl w-full md:max-w-3xl !h-full md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden transition-all fixed inset-0 md:relative md:inset-auto m-0"
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
                                    {getTranslation('transactionHistory', state.currentLanguage)}
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-slate-400">
                                    {customer?.name}
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

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-100 dark:border-emerald-900/30">
                            <p className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">Total Payments</p>
                            <p className="text-base sm:text-lg font-black text-emerald-700 dark:text-emerald-300">
                                {formatCurrencySmart(totals.payments, state.currencyFormat)}
                            </p>
                        </div>
                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-100 dark:border-amber-900/30">
                            <p className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider mb-1">Total Due</p>
                            <p className="text-base sm:text-lg font-black text-amber-700 dark:text-amber-300">
                                {formatCurrencySmart(totals.credits, state.currencyFormat)}
                            </p>
                        </div>
                        <div className={`col-span-2 sm:col-span-1 rounded-xl p-3 border ${(totals.payments - totals.credits) >= 0
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/30'
                            : 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-900/30'
                            }`}>
                            <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 ${(totals.payments - totals.credits) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                }`}>Net Balance</p>
                            <p className={`text-base sm:text-lg font-black ${(totals.payments - totals.credits) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                                }`}>
                                {formatCurrencySmart(totals.payments - totals.credits, state.currencyFormat)}
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
                            <option value="credit">Dues Only</option>
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

                            let typeLabel = isPayment ? 'Payment Received' : 'Due/Credit Added';
                            if (t.type === 'add_due') typeLabel = 'Balance Increase';
                            if (t.type === 'credit_usage') typeLabel = 'Credit Offset';
                            if (t.type === 'opening_balance') typeLabel = 'Opening Balance';
                            if (t.type === 'settlement') typeLabel = 'Settlement';
                            if (t.type === 'refund') typeLabel = 'Refund Given';
                            if (t.type === 'remove_due') typeLabel = 'Due Removed';
                            if (t.type === 'due' && t.orderId) typeLabel = 'Sales Order Due';
                            if (t.isOpeningBalance) typeLabel = 'Opening Balance';
                            if (t.type === 'payment' && t.description?.includes('Manual')) typeLabel = 'Balance Decrease';

                            return (
                                <div
                                    key={t.id || t._id}
                                    className="bg-white dark:bg-slate-700/30 border border-gray-100 dark:border-slate-700 rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isPayment
                                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                                            }`}>
                                            {isPayment ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white">
                                                {typeLabel}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                                                <Calendar className="h-3 w-3" />
                                                <span>{formatDateTime(t.date || t.createdAt)}</span>
                                                {(t.paymentMethod || t.method) && (
                                                    <>
                                                        <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                        <span className="capitalize">{t.paymentMethod || t.method}</span>
                                                    </>
                                                )}
                                            </div>
                                            {(t.note || t.description) && (
                                                <p className="text-xs text-gray-400 mt-1 italic">"{t.note || t.description}"</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        {Number(t.amount || 0) < 0.001 ? (
                                            <p className="text-lg font-black text-gray-400 dark:text-gray-500">
                                                {formatCurrencySmart(t.amount, state.currencyFormat)}
                                            </p>
                                        ) : (
                                            <p className={`text-lg font-black ${isPayment ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                {isPayment ? '+' : '-'}{formatCurrencySmart(t.amount, state.currencyFormat)}
                                            </p>
                                        )}
                                        {t.orderId && (
                                            <p className="text-[10px] text-gray-400 font-medium">Order: #{t.orderId.slice(-6).toUpperCase()}</p>
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

export default TransactionHistoryModal;
