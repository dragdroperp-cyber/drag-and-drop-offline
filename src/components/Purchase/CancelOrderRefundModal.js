import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, RefreshCw, AlertCircle, IndianRupee } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatCurrencySmart, formatCurrencyCompact } from '../../utils/orderUtils';

const CancelOrderRefundModal = ({
    isOpen,
    onClose,
    onConfirm,
    order,
    currencyFormat
}) => {
    const [refundAmount, setRefundAmount] = useState(order?.amountPaid || '');
    const [isClosing, setIsClosing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const { containerRef } = useFocusTrap();

    // Initialize refund amount when order changes
    useEffect(() => {
        if (order) {
            setRefundAmount(order.amountPaid || '');
        }
    }, [order]);

    const handleCloseModal = () => {
        setIsClosing(true);
        setTimeout(() => {
            onClose();
            setIsClosing(false);
        }, 400); // Match animation duration
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        const amount = parseFloat(refundAmount || 0);
        const paid = parseFloat(order?.amountPaid || 0);

        if (amount > paid) {
            setError(`Refund cannot exceed paid amount (${formatCurrencyCompact(paid)})`);
            return;
        }

        setIsSubmitting(true);
        // Simulate short delay or just call confirm
        try {
            await onConfirm(amount);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSubmitting(false);
            handleCloseModal(); // Close on success
        }
    };

    const handleAmountChange = (e) => {
        const val = e.target.value;
        setError('');

        if (val === '') {
            setRefundAmount('');
            return;
        }

        const numVal = parseFloat(val);
        const maxVal = parseFloat(order?.amountPaid || 0);

        // Strict input protection as requested
        if (numVal > maxVal) {
            setRefundAmount(maxVal);
            setError(`Max refundable amount is ${formatCurrencyCompact(maxVal)}`);
        } else {
            setRefundAmount(val);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[200] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
            onClick={handleCloseModal}
        >
            <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
            <div
                ref={containerRef}
                key={isClosing ? 'closing' : 'opening'}
                style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
                className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-md border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-auto md:max-h-[85vh] m-0"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-500">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
                                Cancel & Refund
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Order #{order?.id?.toString().slice(-6)}</p>
                        </div>
                    </div>
                    <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">

                        {/* Warning / Explanation Ribbon */}
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-xl">
                            <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed font-medium">
                                This order will be cancelled. Any refund amount entered below will be recorded as a transaction, and the supplier's due balance will be adjusted accordingly.
                            </p>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Total Order Value</span>
                                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatCurrencySmart(order?.total || 0, currencyFormat)}</span>
                            </div>
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg border border-emerald-100 dark:border-emerald-900/20">
                                <span className="text-[10px] font-bold text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wider block mb-1">Amount Paid</span>
                                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{formatCurrencySmart(order?.amountPaid || 0, currencyFormat)}</span>
                            </div>
                        </div>

                        {/* Refund Input */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Refund Amount Received</label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                                    <span className="font-bold">{currencyFormat === 'INR' ? '₹' : '$'}</span>
                                </div>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    value={refundAmount}
                                    onChange={handleAmountChange}
                                    className={`block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border ${error ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                                    placeholder="0.00"
                                />
                            </div>
                            {error ? (
                                <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {error}
                                </p>
                            ) : (
                                <div className="flex justify-between px-1">
                                    <p className="text-[10px] text-gray-400 italic">Enter amount returned by supplier</p>
                                    <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Max: {formatCurrencyCompact(order?.amountPaid || 0)}</p>
                                </div>
                            )}
                        </div>

                    </div>

                    {/* Footer Actions */}
                    <div className="p-6 pt-0 pb-8 md:pb-6 flex gap-3">
                        <button
                            type="button"
                            onClick={handleCloseModal}
                            disabled={isSubmitting}
                            className="flex-1 py-3.5 rounded-lg font-bold text-sm text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
                        >
                            Close
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-[2] py-3.5 rounded-lg font-bold text-sm text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <span>Confirm Cancel & Refund</span>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CancelOrderRefundModal;
