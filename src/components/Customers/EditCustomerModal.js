import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const EditCustomerModal = ({ customer, onClose, onSubmit }) => {
  const { state } = useApp();
  const [formData, setFormData] = useState({
    name: customer.name || '',
    mobileNumber: sanitizeMobileNumber(customer.mobileNumber || customer.phone || ''),
    email: customer.email || '',
    address: customer.address || '',
    balanceDue: customer.balanceDue ?? customer.dueAmount ?? 0,
  });
  const [error, setError] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();

  const handleChange = (event) => {
    const { name, value } = event.target;
    setError('');

    setFormData((previous) => {
      let nextValue = value;
      if (name === 'balanceDue') {
        if (value === '') {
          nextValue = '';
        } else {
          nextValue = parseFloat(value) || 0;
        }
      } else if (name === 'mobileNumber') {
        nextValue = sanitizeMobileNumber(value);
      }
      return { ...previous, [name]: nextValue };
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!formData.name.trim()) {
      const message = getTranslation('pleaseEnterCustomerName', state.currentLanguage);
      setError(message);
      if (window.showToast) {
        window.showToast(message, 'error');
      }
      return;
    }

    const mobile = sanitizeMobileNumber(formData.mobileNumber);
    if (!mobile) {
      const message = getTranslation('pleaseEnterMobileNumber', state.currentLanguage);
      setError(message);
      if (window.showToast) {
        window.showToast(message, 'error');
      }
      return;
    }

    if (!isValidMobileNumber(mobile)) {
      const message = getTranslation('pleaseEnterValidMobile', state.currentLanguage);
      setError(message);
      if (window.showToast) {
        window.showToast(message, 'error');
      }
      return;
    }

    const dueAmount = parseFloat(formData.balanceDue) || 0;

    const customerData = {
      ...customer,
      ...formData,
      mobileNumber: mobile,
      dueAmount,
      balanceDue: dueAmount,
    };

    onSubmit(customerData);
  };

  return (

    <div
      className={`fixed inset-0 bg-gray-900 bg-opacity-50 flex items-end sm:items-center justify-center z-50 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        @keyframes slideDown {
            from { transform: translateY(0); }
            to { transform: translateY(100%); }
        }
      `}</style>
      <div
        ref={containerRef}
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.4s ease-out forwards` }}
        className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-2xl w-full max-w-md h-auto max-h-[95vh] sm:h-auto sm:max-h-[90vh] mx-auto p-0 flex flex-col transition-colors relative overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-customer-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-700">
          <h2 id="edit-customer-title" className="text-2xl font-bold text-gray-800 dark:text-white">{getTranslation('editCustomer', state.currentLanguage)}</h2>
          <button
            onClick={handleCloseModal}
            data-modal-close
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close edit customer modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3 text-sm text-red-700 dark:text-red-400">
              <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              {getTranslation('customerNameLabel', state.currentLanguage)}
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="input-field"
              placeholder={getTranslation('enterCustomerName', state.currentLanguage)}
              required
            />
          </div>

          <div>
            <label htmlFor="mobileNumber" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              {getTranslation('mobileNumberLabel', state.currentLanguage)}
            </label>
            <input
              type="tel"
              id="mobileNumber"
              name="mobileNumber"
              value={formData.mobileNumber}
              onChange={handleChange}
              className="input-field"
              maxLength={10}
              placeholder={getTranslation('enterMobileNumber', state.currentLanguage)}
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              {getTranslation('emailOptionalLabel', state.currentLanguage)}
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="input-field"
              placeholder={getTranslation('enterEmailAddress', state.currentLanguage)}
            />
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              {getTranslation('addressOptionalLabel', state.currentLanguage)}
            </label>
            <textarea
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows={3}
              className="input-field"
              placeholder={getTranslation('enterAddress', state.currentLanguage)}
            />
          </div>

          <div>
            <label htmlFor="balanceDue" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              {getTranslation('balanceDue', state.currentLanguage)}
            </label>
            <input
              type="number"
              id="balanceDue"
              name="balanceDue"
              value={formData.balanceDue}
              onChange={handleChange}
              step="0.01"
              className="input-field"
              placeholder="0.00"
            />
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 pt-4 pb-1 bg-white dark:bg-slate-800 border-t dark:border-slate-700">
            <button type="button" onClick={handleCloseModal} className="btn-secondary">
              {getTranslation('cancel', state.currentLanguage)}
            </button>
            <button type="submit" className="btn-primary">
              {getTranslation('updateCustomer', state.currentLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditCustomerModal;
