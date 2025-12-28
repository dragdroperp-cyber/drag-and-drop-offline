import React, { useState } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, IndianRupee, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const PaymentModal = ({ customer, onClose, onSubmit }) => {
  const { state } = useApp();
  const [amount, setAmount] = useState('');

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

  // Quick payment suggestions
  const getQuickAmounts = () => {
    if (currentBalance <= 0) return []; // No balance to pay

    const amounts = [];
    if (currentBalance >= 100) amounts.push({ label: getTranslation('half', state.currentLanguage), amount: currentBalance / 2 });
    if (currentBalance >= 50) amounts.push({ label: getTranslation('quarter', state.currentLanguage), amount: currentBalance / 4 });
    amounts.push({ label: getTranslation('full', state.currentLanguage), amount: currentBalance });
    return amounts;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const paymentAmount = parseFloat(amount);
    if (paymentAmount <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }
    onSubmit(paymentAmount, paymentType);
  };

  return (
    <div
      className={`fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-0 sm:p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
        className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-3xl shadow-2xl w-full max-w-sm border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Minimal */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{getTranslation('recordPayment', state.currentLanguage)}</h2>
          <button
            onClick={handleCloseModal}
            className="p-1.5 bg-gray-50 dark:bg-slate-800 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Customer Balance - Clean Layout */}
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-1">{customer.name}{getTranslation('sBalance', state.currentLanguage)}</p>
            <div className={`text-3xl font-bold tracking-tight ${currentBalance > 0 ? 'text-rose-600 dark:text-rose-500' :
              currentBalance < 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-gray-700 dark:text-slate-200'
              }`}>
              ₹{absBalance.toFixed(2)}
              <span className="text-sm font-medium ml-2 text-gray-400 dark:text-slate-500 opacity-80">
                {currentBalance > 0 ? getTranslation('due', state.currentLanguage) : currentBalance < 0 ? getTranslation('credit', state.currentLanguage) : getTranslation('paid', state.currentLanguage)}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Payment Type Switcher - Minimal Pills */}
            <div className="flex p-1 bg-gray-100 dark:bg-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setPaymentType('receive')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${paymentType === 'receive'
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                  }`}
              >
                {getTranslation('receive', state.currentLanguage)}
              </button>
              <button
                type="button"
                onClick={() => setPaymentType('give')}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${paymentType === 'give'
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                  }`}
              >
                {getTranslation('give', state.currentLanguage)}
              </button>
            </div>

            {/* Quick Amounts - Minimal Chips */}
            {paymentType === 'receive' && currentBalance > 0 && (
              <div className="flex gap-2 justify-center">
                {getQuickAmounts().map((option, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setAmount(option.amount.toFixed(2))}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {/* Large Amount Input */}
            <div className="group relative">
              <div className="absolute left-0 top-0 bottom-0 flex items-center pl-4 pointer-events-none">
                <IndianRupee className="h-6 w-6 text-gray-400 dark:text-slate-500" />
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                min="0.01"
                autoFocus
                className="block w-full pl-12 pr-4 py-4 bg-gray-50 dark:bg-slate-800 border-2 border-transparent focus:border-indigo-500/20 focus:bg-white dark:focus:bg-slate-900 rounded-2xl text-3xl font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-slate-600 focus:outline-none transition-all text-center"
                placeholder="0"
                required
              />
            </div>

            {/* Submit Button - Full Width */}
            <button
              type="submit"
              className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg shadow-indigo-200 dark:shadow-none transition-all active:scale-[0.98] ${paymentType === 'receive'
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-orange-500 hover:bg-orange-600'
                }`}
            >
              {paymentType === 'receive' ? getTranslation('acceptPayment', state.currentLanguage) : getTranslation('give', state.currentLanguage)}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
