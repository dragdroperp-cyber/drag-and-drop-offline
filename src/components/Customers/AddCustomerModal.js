import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp } from '../../context/AppContext';
import { canAddData, getLimitErrorMessage, DataCreationManager, getPlanLimits } from '../../utils/planUtils';

const AddCustomerModal = ({
  onClose,
  onSubmit,
  existingCustomers = [],
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();
  const [formData, setFormData] = useState({
    name: '',
    mobileNumber: '',
    email: '',
    address: '',
    balanceDue: ''
  });
  const [duplicateError, setDuplicateError] = useState('');
  const [limitError, setLimitError] = useState('');

  // Focus trap for accessibility
  const { containerRef } = useFocusTrap();

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue =
      name === 'mobileNumber' ? sanitizeMobileNumber(value) : value;

    if (name === 'balanceDue') {
      if (formData.balanceDue === '' && value === '0') {
        nextValue = '';
      }
    }
    setFormData(prev => ({
      ...prev,
      [name]: name === 'balanceDue'
        ? nextValue === ''
          ? ''
          : parseFloat(nextValue) || 0
        : nextValue
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
    const canAdd = await canAddData(totalCustomers, 'customers', state.aggregatedUsage);

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
      alert('Please enter customer name');
      return;
    }

    const mobile = sanitizeMobileNumber(formData.mobileNumber);
    const email = formData.email.trim().toLowerCase();

    if (!mobile) {
      const message = 'Please enter customer mobile number';
      if (window.showToast) {
        window.showToast(message, 'error');
      } else {
        alert(message);
      }
      return;
    }

    if (!isValidMobileNumber(mobile)) {
      const message = 'Please enter a valid 10-digit mobile number starting with 6-9.';
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
        const duplicateMessage = `Duplicate customer detected\n\n${matchedCustomer.name} नाम का एक ग्राहक पहले से मौजूद है${mobile ? ` (मोबाइल: ${mobile})` : ''}${email ? ` (ईमेल: ${formData.email.trim()})` : ''}. कृपया नया विवरण दर्ज करें।`;
        setDuplicateError(duplicateMessage);
        if (window?.showToast) {
          window.showToast(duplicateMessage, 'warning', 6000);
        }
        return;
      }
    }

    // Close modal immediately for instant feedback
    onClose();

    // Ensure dueAmount is set from balanceDue (database uses dueAmount)
    const dueAmount = parseFloat(formData.balanceDue) || 0;

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
          window.showToast('Customer added successfully!', 'success');
        }
      }
    } catch (error) {
      console.error("Error submitting customer form:", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-end sm:items-center justify-center z-50">
      <div
        ref={containerRef}
        className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-2xl w-full max-w-md h-full sm:h-auto sm:max-h-[90vh] mx-auto p-0 flex flex-col transition-colors"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-customer-title"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-700">
          <h2 id="add-customer-title" className="text-2xl font-bold text-gray-800 dark:text-white">Add New Customer</h2>
          <button
            onClick={onClose}
            data-modal-close
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close add customer modal"
          >
            <X className="h-5 w-5" />
          </button>
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
            const canAdd = totalCustomers < maxCustomers;

            return (
              <div className={`rounded-lg border p-3 ${canAdd ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium ${canAdd ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'}`}>
                    Customer Limit:
                  </span>
                  <span className={`font-semibold ${canAdd ? 'text-blue-900 dark:text-blue-100' : 'text-red-900 dark:text-red-100'}`}>
                    {totalCustomers} / {maxCustomers === Infinity ? '∞' : maxCustomers}
                    {!canAdd && ' (Full)'}
                  </span>
                </div>
                {maxCustomers !== Infinity && (
                  <div className="mt-2 w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${canAdd ? 'bg-blue-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, (totalCustomers / maxCustomers) * 100)}%` }}
                    />
                  </div>
                )}
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
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">Limit Full</p>
                  <p className="mt-1 text-xs text-red-700 dark:text-red-400 leading-relaxed">
                    {limitError || planLimitError}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              Customer Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="input-field"
              placeholder="Enter customer name"
              required
            />
          </div>

          <div>
            <label htmlFor="mobileNumber" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              Mobile Number *
            </label>
            <input
              type="tel"
              id="mobileNumber"
              name="mobileNumber"
              value={formData.mobileNumber}
              onChange={handleChange}
              className="input-field"
              maxLength={10}
              placeholder="Enter mobile number"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              Email (Optional)
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="input-field"
              placeholder="Enter email address"
            />
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              Address (Optional)
            </label>
            <textarea
              id="address"
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows={3}
              className="input-field"
              placeholder="Enter address"
            />
          </div>

          <div>
            <label htmlFor="balanceDue" className="block text-sm font-medium text-gray-600 dark:text-slate-300 mb-1">
              Initial Balance Due (₹)
            </label>
            <input
              type="number"
              id="balanceDue"
              name="balanceDue"
              value={formData.balanceDue}
              onChange={handleChange}
              step="0.01"
              min="0"
              className="input-field"
              placeholder="0.00"
            />
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 pt-4 pb-1 bg-white dark:bg-slate-800 border-t dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
            >
              Save Customer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCustomerModal;
