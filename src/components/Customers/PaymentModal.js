import React, { useState } from 'react';
import { X } from 'lucide-react';

const PaymentModal = ({ customer, onClose, onSubmit }) => {
  const [amount, setAmount] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const paymentAmount = parseFloat(amount);
    if (paymentAmount <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }
    onSubmit(paymentAmount);
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Record Payment</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-gray-600">Customer: <span className="font-semibold">{customer.name}</span></p>
          <p className="text-gray-600">Current Balance: <span className="font-semibold">₹{(customer.balanceDue || 0).toFixed(2)}</span></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-600 mb-1">
              Payment Amount (₹) *
            </label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0.01"
              className="input-field"
              placeholder="e.g., 50"
              required
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
            >
              Save Payment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentModal;




