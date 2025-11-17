import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';

const AddCustomerModal = ({
  onClose,
  onSubmit,
  existingCustomers = [],
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const [formData, setFormData] = useState({
    name: '',
    mobileNumber: '',
    email: '',
    address: '',
      balanceDue: ''
  });
  const [duplicateError, setDuplicateError] = useState('');

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
  };

  const handleSubmit = (e) => {
    e.preventDefault();
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
    
    // Ensure dueAmount is set from balanceDue (database uses dueAmount)
    const dueAmount = parseFloat(formData.balanceDue) || 0;
    
    const customerData = {
      ...formData,
      mobileNumber: mobile,
      dueAmount: dueAmount, // MongoDB uses dueAmount field
      balanceDue: dueAmount // Keep for backward compatibility
    };
    
    console.log('AddCustomerModal - Submitting customer data:', customerData);
    console.log('dueAmount:', customerData.dueAmount, 'balanceDue:', customerData.balanceDue);
    
    onSubmit(customerData);
  };


  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 px-3 sm:px-0">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] mx-auto p-0 flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-2xl font-bold text-gray-800">Add New Customer</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
        >
          {planLimitError && (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-100 to-amber-50 p-4 shadow-md">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-700">Plan limit reached</p>
                  <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                    {planLimitError}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-600 mb-1">
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
            <label htmlFor="mobileNumber" className="block text-sm font-medium text-gray-600 mb-1">
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
            <label htmlFor="email" className="block text-sm font-medium text-gray-600 mb-1">
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
            <label htmlFor="address" className="block text-sm font-medium text-gray-600 mb-1">
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
            <label htmlFor="balanceDue" className="block text-sm font-medium text-gray-600 mb-1">
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

          <div className="sticky bottom-0 flex justify-end gap-3 pt-4 pb-1 bg-white">
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
              Save Customer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCustomerModal;
