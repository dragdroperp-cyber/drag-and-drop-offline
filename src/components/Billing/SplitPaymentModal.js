import React, { useState } from 'react';
import { X, Wallet, CreditCard, Receipt } from 'lucide-react';
const SplitPaymentModal = ({ totalAmount, onClose, onSubmit, sellerUpiId }) => {
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
      entered = (parseFloat(cashAmount) || 0) + (parseFloat(onlineAmount) || 0);
    } else if (splitType === 'online_due') {
      entered = (parseFloat(onlineAmount) || 0) + (parseFloat(dueAmount) || 0);
    } else if (splitType === 'cash_due') {
      entered = (parseFloat(cashAmount) || 0) + (parseFloat(dueAmount) || 0);
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
    const sanitized = sanitizeNumberInput(value);
    setCashAmount(sanitized);
    const numValue = parseFloat(sanitized);
    // Only auto-fill if a valid number is entered
    if (!isNaN(numValue) && numValue >= 0 && sanitized !== '') {
      if (splitType === 'cash_online') {
        // Auto-fill online amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setOnlineAmount(remaining > 0 ? remaining.toFixed(2) : '');
      } else if (splitType === 'cash_due') {
        // Auto-fill due amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setDueAmount(remaining > 0 ? remaining.toFixed(2) : '');
      }
    } else if (sanitized === '') {
      // Clear the other field if cash is cleared
      if (splitType === 'cash_online') {
        setOnlineAmount('');
      } else if (splitType === 'cash_due') {
        setDueAmount('');
      }
    }
  };
  const handleOnlineAmountChange = (value) => {
    const sanitized = sanitizeNumberInput(value);
    setOnlineAmount(sanitized);
    const numValue = parseFloat(sanitized);
    // Only auto-fill if a valid number is entered
    if (!isNaN(numValue) && numValue >= 0 && sanitized !== '') {
      if (splitType === 'cash_online') {
        // Auto-fill cash amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setCashAmount(remaining > 0 ? remaining.toFixed(2) : '');
      } else if (splitType === 'online_due') {
        // Auto-fill due amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setDueAmount(remaining > 0 ? remaining.toFixed(2) : '');
      }
    } else if (sanitized === '') {
      // Clear the other field if online is cleared
      if (splitType === 'cash_online') {
        setCashAmount('');
      } else if (splitType === 'online_due') {
        setDueAmount('');
      }
    }
  };
  const handleDueAmountChange = (value) => {
    const sanitized = sanitizeNumberInput(value);
    setDueAmount(sanitized);
    const numValue = parseFloat(sanitized);
    // Only auto-fill if a valid number is entered
    if (!isNaN(numValue) && numValue >= 0 && sanitized !== '') {
      if (splitType === 'online_due') {
        // Auto-fill online amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setOnlineAmount(remaining > 0 ? remaining.toFixed(2) : '');
      } else if (splitType === 'cash_due') {
        // Auto-fill cash amount
        const remaining = Math.max(0, Math.min(totalAmount, totalAmount - numValue));
        setCashAmount(remaining > 0 ? remaining.toFixed(2) : '');
      }
    } else if (sanitized === '') {
      // Clear the other field if due is cleared
      if (splitType === 'online_due') {
        setOnlineAmount('');
      } else if (splitType === 'cash_due') {
        setCashAmount('');
      }
    }
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    let cash = 0;
    let online = 0;
    let due = 0;
    if (splitType === 'cash_online') {
      cash = parseFloat(cashAmount) || 0;
      online = parseFloat(onlineAmount) || 0;
    } else if (splitType === 'online_due') {
      online = parseFloat(onlineAmount) || 0;
      due = parseFloat(dueAmount) || 0;
    } else if (splitType === 'cash_due') {
      cash = parseFloat(cashAmount) || 0;
      due = parseFloat(dueAmount) || 0;
    }
    const total = cash + online + due;
    const remaining = totalAmount - total;
    if (Math.abs(remaining) > 0.01) {
      alert(`Total split amount (₹${total.toFixed(2)}) must equal bill total (₹${totalAmount.toFixed(2)}). Remaining: ₹${remaining.toFixed(2)}`);
      return;
    }
    if (splitType === 'cash_online' && online > 0 && !sellerUpiId) {
      alert('Please add your UPI ID in Settings before accepting online payments.');
      return;
    }
    if (splitType === 'online_due' && online > 0 && !sellerUpiId) {
      alert('Please add your UPI ID in Settings before accepting online payments.');
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25)] w-full max-w-md border border-slate-200/60 my-auto max-h-[95vh] flex flex-col">
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0 border-b border-slate-200/60">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Split Payment</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6">
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-200/60">
            <p className="text-sm text-slate-600 mb-1">Total Amount</p>
            <p className="text-2xl font-bold text-slate-900">₹{totalAmount.toFixed(2)}</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Split Type Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Payment Combination *
              </label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleSplitTypeChange('cash_online')}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 ${
                    splitType === 'cash_online'
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Wallet className={`h-5 w-5 ${splitType === 'cash_online' ? 'text-indigo-600' : 'text-slate-500'}`} />
                    <CreditCard className={`h-5 w-5 ${splitType === 'cash_online' ? 'text-indigo-600' : 'text-slate-500'}`} />
                  </div>
                  <span className="font-semibold">Cash + Online</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSplitTypeChange('online_due')}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 ${
                    splitType === 'online_due'
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CreditCard className={`h-5 w-5 ${splitType === 'online_due' ? 'text-indigo-600' : 'text-slate-500'}`} />
                    <Receipt className={`h-5 w-5 ${splitType === 'online_due' ? 'text-indigo-600' : 'text-slate-500'}`} />
                  </div>
                  <span className="font-semibold">Online + Due</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSplitTypeChange('cash_due')}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 ${
                    splitType === 'cash_due'
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Wallet className={`h-5 w-5 ${splitType === 'cash_due' ? 'text-indigo-600' : 'text-slate-500'}`} />
                    <Receipt className={`h-5 w-5 ${splitType === 'cash_due' ? 'text-indigo-600' : 'text-slate-500'}`} />
                  </div>
                  <span className="font-semibold">Cash + Due</span>
                </button>
              </div>
            </div>
            {/* Amount Inputs */}
            <div className="space-y-3">
              {splitType === 'cash_online' && (
                <>
                  <div>
                    <label htmlFor="cashAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Cash Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="cashAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={cashAmount}
                      onChange={(e) => handleCashAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter cash amount"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="onlineAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Online Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="onlineAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={onlineAmount}
                      onChange={(e) => handleOnlineAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter online amount"
                      required
                    />
                  </div>
                </>
              )}
              {splitType === 'online_due' && (
                <>
                  <div>
                    <label htmlFor="onlineAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Online Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="onlineAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={onlineAmount}
                      onChange={(e) => handleOnlineAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter online amount"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="dueAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Due Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="dueAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={dueAmount}
                      onChange={(e) => handleDueAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter due amount"
                      required
                    />
                  </div>
                </>
              )}
              {splitType === 'cash_due' && (
                <>
                  <div>
                    <label htmlFor="cashAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Cash Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="cashAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={cashAmount}
                      onChange={(e) => handleCashAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter cash amount"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="dueAmount" className="block text-sm font-medium text-slate-700 mb-2">
                      Due Amount (₹) *
                    </label>
                    <input
                      type="text"
                      id="dueAmount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={dueAmount}
                      onChange={(e) => handleDueAmountChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                      placeholder="Enter due amount"
                      required
                    />
                  </div>
                </>
              )}
            </div>
            {/* Remaining Amount Display */}
            {remaining !== 0 && (
              <div className={`p-3 rounded-lg ${
                Math.abs(remaining) < 0.01 
                  ? 'bg-green-50 border border-green-200' 
                  : 'bg-yellow-50 border border-yellow-200'
              }`}>
                <p className={`text-sm font-medium ${
                  Math.abs(remaining) < 0.01 
                    ? 'text-green-700' 
                    : 'text-yellow-700'
                }`}>
                  {Math.abs(remaining) < 0.01 
                    ? '✓ Amounts match total' 
                    : `Remaining: ₹${remaining.toFixed(2)}`}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-6 pb-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold shadow-[0_4px_12px_-2px_rgba(99,102,241,0.4)] hover:shadow-[0_6px_16px_-2px_rgba(99,102,241,0.5)] transition-all active:scale-[0.98]"
                disabled={Math.abs(remaining) > 0.01}
              >
                Confirm Split Payment
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
export default SplitPaymentModal;