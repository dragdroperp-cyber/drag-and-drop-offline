import React, { useState } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, IndianRupee } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getTranslation } from '../../utils/translations';
import { formatCurrency } from '../../utils/orderUtils';

const PaymentModal = ({ customer, onClose, onSubmit }) => {
  const { state } = useApp();
  const { containerRef } = useFocusTrap();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [paymentType, setPaymentType] = useState('receive'); // 'receive' or 'give'
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const currentBalance = customer.balanceDue || 0;
  const absBalance = Math.abs(currentBalance);

  const customerOrders = (state.orders || []).filter(o => {
    const cId = customer.id || customer._id;
    return o.customerId === cId || (o.customerId && o.customerId.toString() === cId?.toString());
  });

  const dueOrdersStats = customerOrders.reduce((acc, order) => {
    let due = 0;
    if (order.paymentMethod === 'split' && order.splitPaymentDetails) {
      due = Number(order.splitPaymentDetails.dueAmount || 0);
    } else if (order.paymentMethod === 'due' || order.paymentMethod === 'credit') {
      due = Number(order.totalAmount || order.total || 0);
    }

    if (due > 0.1 && !order.allPaymentClear) {
      acc.count++;
      acc.total += due;
    }
    return acc;
  }, { count: 0, total: 0 });

  const handleSubmit = (e) => {
    e.preventDefault();
    const paymentAmount = parseFloat(amount.toString().replace(/,/g, ''));
    if (!paymentAmount || paymentAmount <= 0) {
      setError(getTranslation('enterValidAmount', state.currentLanguage));
      return;
    }
    onSubmit(paymentAmount, paymentType, description);
  };

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
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
            {getTranslation('recordPayment', state.currentLanguage)}
          </h2>
          <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Balance Ribbon */}
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-100 dark:border-slate-800">
                <span className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {customer.name}'s Balance
                </span>
                <span className={`text-base font-black ${currentBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(absBalance)} {currentBalance > 0 ? '(Due)' : '(Credit)'}
                </span>
              </div>

              {dueOrdersStats.count > 0 && (
                <div className="flex items-center justify-between px-3 py-2 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg border border-orange-100/50 dark:border-orange-900/20">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-widest leading-none mb-1">
                      Orders with Dues
                    </span>
                    <span className="text-xs font-black text-orange-700 dark:text-orange-300">
                      {dueOrdersStats.count} {dueOrdersStats.count === 1 ? 'Invoice' : 'Invoices'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-widest leading-none mb-1 block">
                      Total Invoice Due
                    </span>
                    <span className="text-sm font-black text-orange-800 dark:text-orange-200">
                      {formatCurrency(dueOrdersStats.total)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Payment Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Payment Action</label>
                <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPaymentType('receive')}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${paymentType === 'receive'
                      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {getTranslation('receive', state.currentLanguage)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('give')}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${paymentType === 'give'
                      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {getTranslation('give', state.currentLanguage)}
                  </button>
                </div>
              </div>

              {/* Amount Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Amount</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
                    <IndianRupee className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      const rawValue = value.replace(/,/g, '');
                      if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                        const parts = rawValue.split('.');
                        if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
                        setAmount(parts.join('.'));
                        setError('');
                      }
                    }}
                    autoFocus
                    className={`block w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-900 border ${error ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-lg font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                    placeholder="0.00"
                  />
                </div>
                {error && (
                  <p className="text-[10px] text-red-500 font-bold px-1 animate-fadeIn flex items-center gap-1">
                    <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                    {error}
                  </p>
                )}
                {paymentType === 'receive' && currentBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmount(currentBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
                      setError('');
                    }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700"
                  >
                    Pay Total: {formatCurrency(currentBalance)}
                  </button>
                )}
              </div>

              {/* Description - Full Width on desktop */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('description', state.currentLanguage)}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Leave a short note..."
                  className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-20"
                />
              </div>
            </div>
          </div>

          <div className="p-6 pt-0 pb-8 md:pb-6">
            <button
              type="submit"
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm"
            >
              {paymentType === 'receive' ? getTranslation('acceptPayment', state.currentLanguage) : getTranslation('give', state.currentLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentModal;
