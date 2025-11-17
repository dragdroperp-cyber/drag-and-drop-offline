import React, { useState } from 'react';
import { X, Smartphone, CheckCircle, AlertCircle } from 'lucide-react';

const UPIIdInputModal = ({ onSave, onCancel }) => {
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
      <div className="bg-white rounded-lg max-w-md w-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Smartphone className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Enter Your UPI ID</h3>
              <p className="text-sm text-gray-500">Required for online payments</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="upiId" className="block text-sm font-medium text-gray-700 mb-2">
                UPI ID *
              </label>
              <input
                type="text"
                id="upiId"
                value={upiId}
                onChange={handleChange}
                placeholder="e.g., myname@paytm, shop@ybl"
                className={`w-full px-4 py-3 rounded-lg border ${
                  error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
                } focus:outline-none focus:ring-2 transition-all`}
                autoFocus
              />
              {error && (
                <div className="mt-2 flex items-center space-x-1 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Your UPI ID will be saved and used for all future online payments.
              </p>
            </div>

            {/* Examples */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">Examples:</p>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>• myname@paytm</li>
                <li>• shop@ybl</li>
                <li>• business@phonepe</li>
                <li>• store@googlepay</li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center"
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

