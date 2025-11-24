import React, { useState } from 'react';
import { X, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

const PaymentModal = ({ customer, onClose, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [paymentType, setPaymentType] = useState('theyGive'); // 'theyGive' or 'youGive'

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25)] w-full max-w-md border border-slate-200/60 my-auto max-h-[95vh] flex flex-col">
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0 border-b border-slate-200/60">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Record Payment</h2>
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
            <p className="text-sm text-slate-600 mb-1">Customer</p>
            <p className="text-lg font-semibold text-slate-900">{customer.name}</p>
            <div className="mt-3 pt-3 border-t border-slate-200/60">
              <p className="text-sm text-slate-600 mb-1">Current Balance</p>
              <p className={`text-2xl font-bold ${(customer.balanceDue || 0) >= 0 ? 'text-slate-900' : 'text-green-600'}`}>
                ₹{(customer.balanceDue || 0).toFixed(2)}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Payment Type Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Payment Type *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentType('theyGive')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                    paymentType === 'theyGive'
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <ArrowDownCircle className={`h-6 w-6 ${paymentType === 'theyGive' ? 'text-indigo-600' : 'text-slate-500'}`} />
                  <span className="font-semibold text-sm">They give</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('youGive')}
                  className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                    paymentType === 'youGive'
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-50 text-indigo-700 shadow-[0_4px_12px_-2px_rgba(99,102,241,0.2)]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <ArrowUpCircle className={`h-6 w-6 ${paymentType === 'youGive' ? 'text-indigo-600' : 'text-slate-500'}`} />
                  <span className="font-semibold text-sm">You give</span>
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-3 text-center">
                {paymentType === 'theyGive' 
                  ? 'Customer is paying you (reduces balance)' 
                  : 'You are paying/refunding customer (increases balance)'}
              </p>
            </div>

            {/* Amount Input */}
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-slate-700 mb-2">
                Payment Amount (₹) *
              </label>
              <input
                type="number"
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                min="0.01"
                className="w-full px-4 py-3 rounded-xl border border-slate-200/80 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 placeholder:text-slate-400"
                placeholder="Enter amount"
                required
              />
            </div>

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
              >
                Save Payment
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;




