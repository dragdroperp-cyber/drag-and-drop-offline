import React, { useState } from 'react';
import { X, AlertTriangle, Minus, RefreshCw } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp, isPlanExpired } from '../../context/AppContext';
import { canAddData, getLimitErrorMessage, DataCreationManager, getPlanLimits, hasActiveNonMiniPlan } from '../../utils/planUtils';
import { getTranslation } from '../../utils/translations';

const AddCustomerModal = ({
  onClose,
  onSubmit,
  existingCustomers = [],
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();

  // Last line of defense: close modal if plan is restricted
  React.useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        // Only show if the modal was actually open
        window.showToast('Access Restricted: A base subscription plan is required.', 'warning');
      }
    }
  }, [state, onClose]);
  // Load saved customer data from localStorage
  const loadSavedCustomerData = () => {
    try {
      const saved = localStorage.getItem('addCustomer_saved');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      localStorage.removeItem('addCustomer_saved');
    }
    return {
      name: '',
      mobileNumber: '',
      email: '',
      address: '',
      balanceDue: ''
    };
  };

  const [formData, setFormData] = useState(loadSavedCustomerData());
  const [duplicateError, setDuplicateError] = useState('');

  const [limitError, setLimitError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle closing animation
  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  // Handle minimize / save draft
  const handleMinimize = () => {
    try {
      const hasData = formData.name?.trim() ||
        formData.mobileNumber?.trim() ||
        formData.email?.trim() ||
        formData.address?.trim() ||
        (formData.balanceDue !== '' && formData.balanceDue !== 0);

      if (hasData) {
        localStorage.setItem('addCustomer_saved', JSON.stringify(formData));
      } else {
        localStorage.removeItem('addCustomer_saved');
      }
      handleCloseModal();
    } catch (error) {
      handleCloseModal();
    }
  };

  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;

    if (name === 'mobileNumber') {
      nextValue = sanitizeMobileNumber(value);
    } else if (name === 'balanceDue') {
      const cleanedValue = value.replace(/,/g, '');
      // Prevent '0' from being the initial input if the field was empty
      if (formData.balanceDue === '' && cleanedValue === '0') {
        nextValue = '';
      } else {
        nextValue = cleanedValue;
      }
    }

    setFormData(prev => ({
      ...prev,
      [name]: nextValue
    }));

    if (duplicateError && (name === 'mobileNumber' || name === 'email')) {
      setDuplicateError('');
    }

    if (planLimitError && onClearPlanLimitError) {
      onClearPlanLimitError();
    }
    // Clear limit error when user types
    if (limitError) {
      setLimitError('');
    }
  };


  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check distributed plan limit BEFORE validation
    const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
    const totalCustomers = activeCustomers.length;
    const canAdd = await canAddData(totalCustomers, 'customers', state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);

    if (!canAdd) {
      const limitMessage = getLimitErrorMessage('customers', state.aggregatedUsage);

      setLimitError(limitMessage);
      if (window.showToast) {
        window.showToast(limitMessage, 'error', 5000);
      }
      return;
    }

    // Clear limit error if we can add
    setLimitError('');

    if (!formData.name.trim()) {
      alert(getTranslation('pleaseEnterCustomerName', state.currentLanguage));
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    const mobile = sanitizeMobileNumber(formData.mobileNumber);
    const email = formData.email.trim().toLowerCase();

    if (!mobile) {
      const message = getTranslation('pleaseEnterMobileNumber', state.currentLanguage);
      if (window.showToast) {
        window.showToast(message, 'error');
      } else {
        alert(message);
      }
      return;
    }

    if (!isValidMobileNumber(mobile)) {
      const message = getTranslation('pleaseEnterValidMobile', state.currentLanguage);
      if (window.showToast) {
        window.showToast(message, 'error');
      } else {
        alert(message);
      }
      return;
    }

    if (mobile || email) {
      const matchedCustomer = existingCustomers.find(customer => {
        const existingMobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || '');
        const existingEmail = (customer.email || '').trim().toLowerCase();
        const mobileMatch = mobile && existingMobile && existingMobile === mobile;
        const emailMatch = email && existingEmail && existingEmail === email;
        return mobileMatch || emailMatch;
      });

      if (matchedCustomer) {
        const duplicateMessage = getTranslation('duplicateCustomerError', state.currentLanguage);
        setDuplicateError(duplicateMessage);
        if (window?.showToast) {
          window.showToast(duplicateMessage, 'warning', 6000);
        }
        setIsSubmitting(false);
        return;
      }
    }

    // Close modal immediately for instant feedback
    handleCloseModal();

    // Ensure dueAmount is set from balanceDue (database uses dueAmount)
    const dueAmount = parseFloat(formData.balanceDue.toString().replace(/,/g, '')) || 0;

    const customerData = {
      ...formData,
      mobileNumber: mobile,
      dueAmount: dueAmount, // MongoDB uses dueAmount field
      balanceDue: dueAmount // Keep for backward compatibility
    };

    try {
      // Use DataCreationManager for distributed limit checking and creation
      const dataManager = new DataCreationManager({ state, dispatch });
      const result = await dataManager.createCustomer(customerData);

      if (!result.success) {
        // If limit reached, we'll show a toast (Modal is already closed)
        if (window.showToast) {
          window.showToast(result.error, 'error', 5000);
        }
      } else {
        if (window.showToast) {
          // Clear saved data on successful save
          localStorage.removeItem('addCustomer_saved');
          window.showToast(getTranslation('customerAddedSuccess', state.currentLanguage), 'success');
        }
      }
    } catch (error) {
      console.error("Error submitting customer form:", error);
    } finally {
      setIsSubmitting(false);
    }
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
        aria-labelledby="add-customer-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-700">
          <h2 id="add-customer-title" className="text-2xl font-bold text-gray-800 dark:text-white">{getTranslation('addNewCustomer', state.currentLanguage)}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMinimize}
              className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700"
              aria-label="Save and close modal"
              title={getTranslation('minimizeDesc', state.currentLanguage) || "Save draft and close"}
            >
              <Minus className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('addCustomer_saved');
                handleCloseModal();
              }}
              data-modal-close
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              aria-label="Close add customer modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
        >
          {/* Real-time limit display */}
          {(() => {
            const activeCustomers = state.customers.filter(customer => !customer.isDeleted);
            const totalCustomers = activeCustomers.length;
            const { maxCustomers } = getPlanLimits(state.currentPlan, state.currentPlanDetails);
            const remaining = maxCustomers === Infinity ? Infinity : Math.max(0, maxCustomers - totalCustomers);

            if (remaining >= 15 || maxCustomers === Infinity) return null;

            return (
              <div className="text-sm font-medium text-center p-2 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 border border-red-100 dark:border-red-800">
                ({getTranslation('customerLimitLeft', state.currentLanguage)}: {remaining} left)
              </div>
            );
          })()}

          {(planLimitError || limitError) && (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-gradient-to-r from-red-50 via-red-100 to-red-50 dark:from-red-900/20 dark:via-red-900/30 dark:to-red-900/20 p-4 shadow-md">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">{getTranslation('limitFull', state.currentLanguage)}</p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400 leading-relaxed">
                    {limitError || planLimitError}
                  </p>
                </div>
              </div>
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
              {getTranslation('initialBalanceDue', state.currentLanguage)}
            </label>
            <input
              type="text"
              inputMode="decimal"
              id="balanceDue"
              name="balanceDue"
              value={formData.balanceDue}
              onChange={(e) => {
                const rawValue = e.target.value.replace(/,/g, '');
                if (rawValue === '' || /^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                  const parts = rawValue.split('.');
                  if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');

                  // Manually trigger change with formatted value
                  setFormData(prev => ({
                    ...prev,
                    balanceDue: parts.join('.')
                  }));
                }
              }}
              className="input-field"
              placeholder="0.00"
            />
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 pt-4 pb-1 bg-white dark:bg-slate-800 border-t dark:border-slate-700">

            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 flex items-center justify-center gap-2 py-3 sm:py-4 px-6 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95 ${isSubmitting ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  {getTranslation('adding', state.currentLanguage) || 'Adding...'}
                </>
              ) : (
                getTranslation('addCustomer', state.currentLanguage)
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCustomerModal;
