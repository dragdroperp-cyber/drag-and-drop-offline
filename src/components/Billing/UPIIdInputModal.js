import React, { useState } from 'react';
import { X, Smartphone, CheckCircle, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const UPIIdInputModal = ({ onSave, onCancel }) => {
  const { state } = useApp();
  const [upiId, setUpiId] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const validateUPIId = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'Please enter your UPI ID.';
    }
    // UPI ID format: username@bankname (e.g., myname@paytm, shop@ybl)
    const upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}[a-zA-Z0-9]{0,}$/;
    if (!upiRegex.test(trimmed)) {
      return 'Please enter a valid UPI ID (e.g., myname@paytm, shop@ybl).';
    }
    return null;
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setUpiId(value);
    setError('');
  };

  const [isClosing, setIsClosing] = useState(false);

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onCancel();
      setIsClosing(false);
    }, 400);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateUPIId(upiId);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(upiId.trim());
    } catch (err) {
      setError(err.message || 'Failed to save UPI ID. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[250] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
        className="bg-white dark:bg-black !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-md border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[90vh] m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
              <Smartphone className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">Enter Your UPI ID</h2>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Required for online payments</p>
            </div>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="upiId" className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">
                UPI ID *
              </label>
              <input
                type="text"
                id="upiId"
                value={upiId}
                onChange={handleChange}
                placeholder="e.g., myname@paytm, shop@ybl"
                className={`block w-full px-4 py-3 bg-white dark:bg-black border ${error ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-white/10'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                autoFocus
              />
              {error && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-red-500 font-bold px-1 animate-fadeIn">
                  <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 rounded-lg">
                <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                  Your UPI ID will be saved and used for all future online payments. Please ensure it's correct to receive payments from customers.
                </p>
              </div>
            </div>

            {/* Examples */}
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-gray-100 dark:border-white/10">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Examples:</p>
              <div className="grid grid-cols-1 gap-2">
                {['myname@paytm', 'shop@ybl', 'business@phonepe', 'store@googlepay'].map((ex) => (
                  <div key={ex} className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 font-medium">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700"></div>
                    {ex}
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2 pb-2">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 py-3 px-4 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/20 transition-all active:scale-[0.98]"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-3 px-4 bg-gray-900 dark:bg-indigo-600 rounded-lg text-sm font-bold text-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
                disabled={isSaving}
              >
                {isSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Save & Continue
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default UPIIdInputModal;
