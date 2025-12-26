import React, { useState } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle, IndianRupee, RotateCcw } from 'lucide-react';

const PaymentModal = ({ customer, onClose, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('receive'); // 'receive' or 'give'

  const currentBalance = customer.balanceDue || 0;
  const absBalance = Math.abs(currentBalance);

  // Quick payment suggestions
  const getQuickAmounts = () => {
    if (currentBalance <= 0) return []; // No balance to pay

    const amounts = [];
    if (currentBalance >= 100) amounts.push({ label: 'Half', amount: currentBalance / 2 });
    if (currentBalance >= 50) amounts.push({ label: 'Quarter', amount: currentBalance / 4 });
    amounts.push({ label: 'Full', amount: currentBalance });
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto transition-opacity">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-[0_25px_80px_-12px_rgba(0,0,0,0.3)] w-full max-w-lg border border-gray-200/50 dark:border-slate-700 my-auto max-h-[95vh] flex flex-col transition-all">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100 dark:border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Record Payment</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Manage customer balance</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* Customer Info Card */}
          <div className="mb-6 p-5 rounded-xl bg-gradient-to-br from-gray-50 to-white dark:from-slate-700/50 dark:to-slate-800 border border-gray-200/60 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-600 dark:text-slate-400">Customer</p>
              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${currentBalance > 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                currentBalance < 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'
                }`}>
                {currentBalance > 0 ? 'Due' : currentBalance < 0 ? 'Credit' : 'Clear'}
              </div>
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-white mb-4">{customer.name}</p>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-1">Current Balance</p>
                <p className={`text-2xl font-bold ${currentBalance > 0 ? 'text-red-600 dark:text-red-500' :
                  currentBalance < 0 ? 'text-green-600 dark:text-green-500' :
                    'text-gray-600 dark:text-slate-400'
                  }`}>
                  ₹{absBalance.toFixed(2)}
                  {currentBalance < 0 && <span className="text-sm ml-1">(Credit)</span>}
                </p>
              </div>
              {currentBalance !== 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-slate-500 mb-1">Status</p>
                  <p className={`text-sm font-medium ${currentBalance > 0 ? 'text-red-600 dark:text-red-500' : 'text-green-600 dark:text-green-500'
                    }`}>
                    {currentBalance > 0 ? 'Amount Due' : 'Advance Paid'}
                  </p>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Payment Type Selection */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
                What type of payment? *
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setPaymentType('receive')}
                  className={`flex flex-col items-center justify-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${paymentType === 'receive'
                    ? 'border-green-500 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 text-green-700 dark:text-green-400 shadow-lg'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                >
                  <ArrowDownCircle className={`h-7 w-7 ${paymentType === 'receive' ? 'text-green-600' : 'text-gray-400'}`} />
                  <div className="text-center">
                    <span className="font-semibold text-sm">Receive Payment</span>
                    <p className="text-xs text-gray-500 mt-1">Customer pays you</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('give')}
                  className={`flex flex-col items-center justify-center gap-3 p-5 rounded-xl border-2 transition-all duration-200 ${paymentType === 'give'
                    ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 text-orange-700 dark:text-orange-400 shadow-lg'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                >
                  <ArrowUpCircle className={`h-7 w-7 ${paymentType === 'give' ? 'text-orange-600' : 'text-gray-400 dark:text-slate-500'}`} />
                  <div className="text-center">
                    <span className="font-semibold text-sm">Give Payment</span>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">You pay/refund</p>
                  </div>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3 text-center">
                {paymentType === 'receive'
                  ? 'Customer is paying you - reduces their balance'
                  : 'You are paying/refunding the customer - increases their balance'}
              </p>
            </div>

            {/* Quick Amount Buttons */}
            {paymentType === 'receive' && currentBalance > 0 && getQuickAmounts().length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
                  Quick Pay Options
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {getQuickAmounts().map((option, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setAmount(option.amount.toFixed(2))}
                      className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium text-sm transition-colors border border-blue-200 dark:border-blue-800 hover:border-blue-300 dark:hover:border-blue-700"
                    >
                      {option.label}
                      <br />
                      ₹{option.amount.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Amount Input */}
            <div>
              <label htmlFor="amount" className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
                Payment Amount (₹) *
              </label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-slate-500" />
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step="0.01"
                  min="0.01"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-600 text-lg font-medium"
                  placeholder="Enter amount"
                  required
                />
              </div>
              {amount && (
                <p className="text-xs text-gray-500 mt-2">
                  {paymentType === 'receive' ? 'Will reduce' : 'Will increase'} balance by ₹{parseFloat(amount || 0).toFixed(2)}
                  {currentBalance !== 0 && paymentType === 'receive' && (
                    <span className="ml-2">
                      → New balance: ₹{(currentBalance - parseFloat(amount || 0)).toFixed(2)}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-6 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all active:scale-95 ${paymentType === 'receive'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl'
                  : 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow-lg hover:shadow-xl'
                  }`}
              >
                {paymentType === 'receive' ? 'Receive Payment' : 'Give Payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
