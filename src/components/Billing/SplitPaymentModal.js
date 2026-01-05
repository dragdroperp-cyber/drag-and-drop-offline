import React, { useState } from 'react';
import { X, Wallet, CreditCard, Receipt } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatCurrencySmart } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';
const SplitPaymentModal = ({ totalAmount, onClose, onSubmit, sellerUpiId }) => {
  const { state } = useApp();
  const [splitType, setSplitType] = useState('cash_online'); // 'cash_online', 'online_due', 'cash_due'
  const [cashAmount, setCashAmount] = useState('');
  const [onlineAmount, setOnlineAmount] = useState('');
  const [dueAmount, setDueAmount] = useState('');
  const handleSplitTypeChange = (type) => {
    setSplitType(type);
    // Reset amounts when changing split type
    setCashAmount('');
    setOnlineAmount('');
    setDueAmount('');
  };
  const calculateRemainingAmount = () => {
    let entered = 0;
    if (splitType === 'cash_online') {
      entered = (parseFloat(cashAmount.toString().replace(/,/g, '')) || 0) + (parseFloat(onlineAmount.toString().replace(/,/g, '')) || 0);
    } else if (splitType === 'online_due') {
      entered = (parseFloat(onlineAmount.toString().replace(/,/g, '')) || 0) + (parseFloat(dueAmount.toString().replace(/,/g, '')) || 0);
    } else if (splitType === 'cash_due') {
      entered = (parseFloat(cashAmount.toString().replace(/,/g, '')) || 0) + (parseFloat(dueAmount.toString().replace(/,/g, '')) || 0);
    }
    return totalAmount - entered;
  };
  // Helper function to validate and sanitize number input
  const sanitizeNumberInput = (value) => {
    // Remove any non-numeric characters except decimal point
    let sanitized = value.replace(/[^0-9.]/g, '');
    // Ensure only one decimal point
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      sanitized = parts[0] + '.' + parts.slice(1).join('');
    }
    // Limit decimal places to 2
    if (parts.length === 2 && parts[1].length > 2) {
      sanitized = parts[0] + '.' + parts[1].substring(0, 2);
    }
    return sanitized;
  };
  const handleCashAmountChange = (value) => {
    // Strip commas to get raw number string
    const rawValue = value.replace(/,/g, '');

    // Basic validation: only digits and one dot
    if (rawValue !== '' && !/^[0-9]*\.?[0-9]*$/.test(rawValue)) return;

    // Limit decimal places to 2
    if (rawValue.includes('.') && rawValue.split('.')[1].length > 2) return;

    // Format for display
    let formattedDisplay = rawValue;
    if (rawValue !== '') {
      const parts = rawValue.split('.');
      if (parts[0].length > 0) {
        parts[0] = Number(parts[0]).toLocaleString('en-IN');
      }
      formattedDisplay = parts.join('.');
    }

    setCashAmount(formattedDisplay);

    const numValue = parseFloat(rawValue);
    // Only auto-fill if a valid number is entered
    if (!isNaN(numValue) && numValue >= 0 && rawValue !== '') {
      if (splitType === 'cash_online') {
        // Auto-fill online amount
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setOnlineAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      } else if (splitType === 'cash_due') {
        // Auto-fill due amount
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setDueAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      }
    } else if (rawValue === '') {
      // Clear the other field if cash is cleared
      if (splitType === 'cash_online') {
        setOnlineAmount('');
      } else if (splitType === 'cash_due') {
        setDueAmount('');
      }
    }
  };
  const handleOnlineAmountChange = (value) => {
    const rawValue = value.replace(/,/g, '');
    if (rawValue !== '' && !/^[0-9]*\.?[0-9]*$/.test(rawValue)) return;
    if (rawValue.includes('.') && rawValue.split('.')[1].length > 2) return;

    let formattedDisplay = rawValue;
    if (rawValue !== '') {
      const parts = rawValue.split('.');
      if (parts[0].length > 0) {
        parts[0] = Number(parts[0]).toLocaleString('en-IN');
      }
      formattedDisplay = parts.join('.');
    }
    setOnlineAmount(formattedDisplay);

    const numValue = parseFloat(rawValue);
    if (!isNaN(numValue) && numValue >= 0 && rawValue !== '') {
      if (splitType === 'cash_online') {
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setCashAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      } else if (splitType === 'online_due') {
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setDueAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      }
    } else if (rawValue === '') {
      if (splitType === 'cash_online') {
        setCashAmount('');
      } else if (splitType === 'online_due') {
        setDueAmount('');
      }
    }
  };
  const handleDueAmountChange = (value) => {
    const rawValue = value.replace(/,/g, '');
    if (rawValue !== '' && !/^[0-9]*\.?[0-9]*$/.test(rawValue)) return;
    if (rawValue.includes('.') && rawValue.split('.')[1].length > 2) return;

    let formattedDisplay = rawValue;
    if (rawValue !== '') {
      const parts = rawValue.split('.');
      if (parts[0].length > 0) {
        parts[0] = Number(parts[0]).toLocaleString('en-IN');
      }
      formattedDisplay = parts.join('.');
    }
    setDueAmount(formattedDisplay);

    const numValue = parseFloat(rawValue);
    if (!isNaN(numValue) && numValue >= 0 && rawValue !== '') {
      if (splitType === 'online_due') {
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setOnlineAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      } else if (splitType === 'cash_due') {
        const remaining = Math.max(0, mathRound(totalAmount - numValue));
        setCashAmount(remaining > 0 ? remaining.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
      }
    } else if (rawValue === '') {
      if (splitType === 'online_due') {
        setOnlineAmount('');
      } else if (splitType === 'cash_due') {
        setCashAmount('');
      }
    }
  };

  const mathRound = (num) => Math.round(num * 100) / 100;
  const handleSubmit = (e) => {
    e.preventDefault();
    let cash = 0;
    let online = 0;
    let due = 0;
    if (splitType === 'cash_online') {
      cash = parseFloat(cashAmount.toString().replace(/,/g, '')) || 0;
      online = parseFloat(onlineAmount.toString().replace(/,/g, '')) || 0;
    } else if (splitType === 'online_due') {
      online = parseFloat(onlineAmount.toString().replace(/,/g, '')) || 0;
      due = parseFloat(dueAmount.toString().replace(/,/g, '')) || 0;
    } else if (splitType === 'cash_due') {
      cash = parseFloat(cashAmount.toString().replace(/,/g, '')) || 0;
      due = parseFloat(dueAmount.toString().replace(/,/g, '')) || 0;
    }
    const total = cash + online + due;
    const remaining = totalAmount - total;
    if (Math.abs(remaining) > 0.01) {
      const msg = getTranslation('splitAmountMismatch', state.currentLanguage)
        .replace('{total}', formatCurrencySmart(total, state.currencyFormat))
        .replace('{totalAmount}', formatCurrencySmart(totalAmount, state.currencyFormat))
        .replace('{remaining}', formatCurrencySmart(remaining, state.currencyFormat));
      alert(msg);
      return;
    }
    if ((splitType === 'cash_online' || splitType === 'online_due') && online > 0 && !sellerUpiId) {
      alert(getTranslation('addUpiSettings', state.currentLanguage));
      return;
    }
    onSubmit({
      splitType,
      cashAmount: cash,
      onlineAmount: online,
      dueAmount: due
    });
  };
  const remaining = calculateRemainingAmount();
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-[1301] flex items-end md:items-center justify-center animate-fadeIn" onClick={onClose}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        className="bg-white dark:bg-slate-900 w-full md:max-w-2xl !rounded-none md:!rounded-xl shadow-lg border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">{getTranslation('splitPayment', state.currentLanguage)}</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{getTranslation('billTotal', state.currentLanguage)}: {formatCurrencySmart(totalAmount, state.currencyFormat)}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* Combination Picker */}
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Wallet className="h-3 w-3" />
                {getTranslation('selectCombination', state.currentLanguage)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: 'cash_online', label: `${getTranslation('cash', state.currentLanguage)} + ${getTranslation('online', state.currentLanguage)}`, icons: [Wallet, CreditCard] },
                  { id: 'online_due', label: `${getTranslation('online', state.currentLanguage)} + ${getTranslation('due', state.currentLanguage)}`, icons: [CreditCard, Receipt] },
                  { id: 'cash_due', label: `${getTranslation('cash', state.currentLanguage)} + ${getTranslation('due', state.currentLanguage)}`, icons: [Wallet, Receipt] }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSplitTypeChange(item.id)}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${splitType === item.id
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100'
                      : 'border-gray-100 dark:border-slate-800 text-gray-400 hover:border-gray-200 dark:hover:border-slate-700'
                      }`}
                  >
                    <div className="flex gap-1 mb-2">
                      {item.icons.map((Icon, idx) => (
                        <Icon key={idx} className="h-4 w-4" />
                      ))}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {splitType === 'cash_online' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('cash', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={cashAmount}
                      onChange={(e) => handleCashAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('online', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={onlineAmount}
                      onChange={(e) => handleOnlineAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </>
              )}

              {splitType === 'online_due' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('online', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={onlineAmount}
                      onChange={(e) => handleOnlineAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('due', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={dueAmount}
                      onChange={(e) => handleDueAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </>
              )}

              {splitType === 'cash_due' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('cash', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={cashAmount}
                      onChange={(e) => handleCashAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('due', state.currentLanguage)} {getTranslation('amount', state.currentLanguage)} (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={dueAmount}
                      onChange={(e) => handleDueAmountChange(e.target.value)}
                      className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Status Indicator */}
            <div className={`p-4 rounded-lg flex items-center justify-between ${Math.abs(remaining) < 0.01 ? 'bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/20' : 'bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20'}`}>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{getTranslation('status', state.currentLanguage)}</p>
                <p className={`text-xs font-bold ${Math.abs(remaining) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>
                  {Math.abs(remaining) < 0.01 ? `✓ ${getTranslation('balanced', state.currentLanguage)}` : getTranslation('unbalanced', state.currentLanguage)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{getTranslation('difference', state.currentLanguage)}</p>
                <p className={`text-xs font-bold ${Math.abs(remaining) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>
                  {formatCurrencySmart(remaining, state.currencyFormat)}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 pt-0 pb-8 md:pb-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 rounded-lg font-bold text-sm text-gray-500 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
            >
              {getTranslation('cancel', state.currentLanguage)}
            </button>
            <button
              type="submit"
              disabled={Math.abs(remaining) > 0.01}
              className={`flex-[2] py-3.5 rounded-lg font-bold text-sm text-white transition-all active:scale-[0.98] shadow-sm ${Math.abs(remaining) > 0.01
                ? 'bg-gray-300 dark:bg-slate-800 cursor-not-allowed text-gray-500'
                : 'bg-gray-900 dark:bg-indigo-600 hover:opacity-90'
                }`}
            >
              {getTranslation('confirmSplit', state.currentLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default SplitPaymentModal;
