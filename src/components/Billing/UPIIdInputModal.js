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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full shadow-2xl border dark:border-slate-700/60 overflow-hidden transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
              <Smartphone className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">Enter Your UPI ID</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">Required for online payments</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="upiId" className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                UPI ID *
              </label>
              <input
                type="text"
                id="upiId"
                value={upiId}
                onChange={handleChange}
                placeholder="e.g., myname@paytm, shop@ybl"
                className={`w-full px-4 py-3 rounded-xl border bg-white dark:bg-slate-800 text-slate-900 dark:text-white transition-all focus:outline-none focus:ring-2 ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-slate-200 dark:border-slate-700 focus:ring-indigo-500/20 focus:border-indigo-500'
                  }`}
                autoFocus
              />
              {error && (
                <div className="mt-2.5 flex items-center space-x-2 text-red-600 dark:text-red-400 text-sm font-medium animate-fadeIn">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}
              <p className="mt-2.5 text-xs text-gray-500 dark:text-slate-500 leading-relaxed">
                Your UPI ID will be saved and used for all future online payments.
              </p>
            </div>

            {/* Examples */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
              <p className="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-2">Examples:</p>
              <ul className="text-xs text-gray-600 dark:text-slate-400 space-y-1.5">
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-slate-400"></span> myname@paytm</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-slate-400"></span> shop@ybl</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-slate-400"></span> business@phonepe</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-slate-400"></span> store@googlepay</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-6">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-[0.98]"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all flex items-center justify-center active:scale-[0.98]"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Save & Continue
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default UPIIdInputModal;
