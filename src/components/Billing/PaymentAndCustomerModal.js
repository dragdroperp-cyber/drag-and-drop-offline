import React, { useState, useEffect } from 'react';
import { X, User, Phone, Wallet, CreditCard, Receipt } from 'lucide-react';
import SplitPaymentModal from './SplitPaymentModal';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
const PaymentAndCustomerModal = ({ 
  billItems, 
  total, 
  onClose, 
  onSubmit, 
  sellerUpiId,
  customers,
  useCustomName: initialUseCustomName,
  customCustomerName: initialCustomCustomerName,
  selectedCustomer: initialSelectedCustomer,
  billingMobile: initialBillingMobile,
  paymentMethod: initialPaymentMethod,
  sendWhatsAppInvoice: initialSendWhatsAppInvoice,
  onCustomNameChange,
  onSelectedCustomerChange,
  onBillingMobileChange,
  onPaymentMethodChange,
  onSendWhatsAppInvoiceChange
}) => {
  const [useCustomName, setUseCustomName] = useState(initialUseCustomName || false);
  const [customCustomerName, setCustomCustomerName] = useState(initialCustomCustomerName || '');
  const [selectedCustomer, setSelectedCustomer] = useState(initialSelectedCustomer || '');
  const [billingMobile, setBillingMobile] = useState(initialBillingMobile || '');
  const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod || 'cash');
  const [sendWhatsAppInvoice, setSendWhatsAppInvoice] = useState(initialSendWhatsAppInvoice || false);
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [splitPaymentDetails, setSplitPaymentDetails] = useState(null);
  const [isBillingMobileValid, setIsBillingMobileValid] = useState(true);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [foundCustomers, setFoundCustomers] = useState([]);
  const [customerNameError, setCustomerNameError] = useState('');
  const [mobileError, setMobileError] = useState('');
  const [splitPaymentError, setSplitPaymentError] = useState('');
  const [upiIdError, setUpiIdError] = useState('');
  useEffect(() => {
    if (onCustomNameChange) onCustomNameChange(useCustomName);
    if (onSelectedCustomerChange) onSelectedCustomerChange(selectedCustomer);
    if (onBillingMobileChange) onBillingMobileChange(billingMobile);
    if (onPaymentMethodChange) onPaymentMethodChange(paymentMethod);
    if (onSendWhatsAppInvoiceChange) onSendWhatsAppInvoiceChange(sendWhatsAppInvoice);
  }, [useCustomName, selectedCustomer, billingMobile, paymentMethod, sendWhatsAppInvoice]);
  // Auto-fill mobile number when customer is selected
  useEffect(() => {
    if (!useCustomName && selectedCustomer) {
      const customer = customers.find(c => c.id === selectedCustomer || c.name === selectedCustomer);
      if (customer) {
        const mobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || customer.phoneNumber || '');
        const normalized = mobile.length > 10 ? mobile.slice(-10) : mobile;
        if (normalized) {
          setBillingMobile(normalized);
          setIsBillingMobileValid(isValidMobileNumber(normalized));
          if (onBillingMobileChange) onBillingMobileChange(normalized);
        }
      }
    } else if (!useCustomName && !selectedCustomer) {
      // Clear mobile when no customer is selected
      setBillingMobile('');
      setIsBillingMobileValid(true);
      if (onBillingMobileChange) onBillingMobileChange('');
    }
  }, [selectedCustomer, useCustomName, customers]);
  const handleBillingMobileChange = (value) => {
    // Don't allow changes if customer is selected (not using custom name)
    if (!useCustomName && selectedCustomer) {
      return;
    }
    const sanitized = sanitizeMobileNumber(value);
    setBillingMobile(sanitized);
    if (sanitized.length === 0) {
      setIsBillingMobileValid(true);
      setShowCustomerModal(false);
      setFoundCustomers([]);
      // Reset to select customer mode when mobile is cleared
      setUseCustomName(false);
      setSelectedCustomer('');
      setCustomCustomerName('');
    } else {
      const isValid = isValidMobileNumber(sanitized);
      setIsBillingMobileValid(isValid);
      // Check if 10 digits and search for existing customers
      if (sanitized.length === 10 && isValidMobileNumber(sanitized)) {
        const matchingCustomers = customers.filter(customer => {
          const customerMobile = sanitizeMobileNumber(
            customer.mobileNumber || customer.phone || customer.phoneNumber || ''
          );
          return customerMobile === sanitized && customerMobile.length === 10;
        });
        if (matchingCustomers.length > 0) {
          // Existing customers found - show modal to select or continue as new
          setFoundCustomers(matchingCustomers);
          setShowCustomerModal(true);
          // Don't auto-enable custom name yet - wait for user to click "New Customer"
          setUseCustomName(false);
        } else {
          // No customers found - automatically enable customer name input
          setShowCustomerModal(false);
          setFoundCustomers([]);
          setUseCustomName(true);
          setSelectedCustomer('');
          // Clear custom name if it was from a previous selection
          if (!customCustomerName || customCustomerName.trim() === '') {
            setCustomCustomerName('');
          }
        }
      } else {
        setShowCustomerModal(false);
        setFoundCustomers([]);
      }
    }
    if (onBillingMobileChange) onBillingMobileChange(sanitized);
  };
  const selectExistingCustomer = (customer) => {
    if (customer) {
      setCustomCustomerName(customer.name);
      const mobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || customer.phoneNumber || '');
      setBillingMobile(mobile);
      setIsBillingMobileValid(true);
      setUseCustomName(true);
      setShowCustomerModal(false);
      setFoundCustomers([]);
      if (onBillingMobileChange) onBillingMobileChange(mobile);
    }
  };
  const continueAsNewCustomer = () => {
    setShowCustomerModal(false);
    setFoundCustomers([]);
    // Enable customer name input for new customer
    setUseCustomName(true);
    setSelectedCustomer('');
    // Clear custom name if it was from a previous selection
    if (!customCustomerName || customCustomerName.trim() === '') {
      setCustomCustomerName('');
    }
  };
  const handlePaymentMethodChange = (method) => {
    // Clear all validation errors when payment method changes
    setCustomerNameError('');
    setMobileError('');
    setSplitPaymentError('');
    setUpiIdError('');
    if (method === 'split') {
      setShowSplitPayment(true);
      // Keep payment method as 'split' so dropdown shows correct value
      setPaymentMethod('split');
    } else {
      setPaymentMethod(method);
      setSplitPaymentDetails(null);
      if (onPaymentMethodChange) onPaymentMethodChange(method);
    }
  };
  const handleSplitPaymentSubmit = (splitDetails) => {
    // Clear split payment error when submitting
    setSplitPaymentError('');
    const cash = parseFloat(splitDetails.cashAmount) || 0;
    const online = parseFloat(splitDetails.onlineAmount) || 0;
    const due = parseFloat(splitDetails.dueAmount) || 0;
    // Count how many fields have values > 0
    const nonZeroCount = [cash, online, due].filter(amount => amount > 0).length;
    // If only one field has a value > 0, change payment method to that method
    if (nonZeroCount === 1) {
      let newPaymentMethod = 'split';
      if (cash > 0 && online === 0 && due === 0) {
        newPaymentMethod = 'cash';
      } else if (online > 0 && cash === 0 && due === 0) {
        newPaymentMethod = 'upi';
      } else if (due > 0 && cash === 0 && online === 0) {
        newPaymentMethod = 'due';
      }
      // Clear split payment details since we're switching to a single payment method
      setSplitPaymentDetails(null);
      setPaymentMethod(newPaymentMethod);
      if (onPaymentMethodChange) onPaymentMethodChange(newPaymentMethod);
    } else {
      // Multiple fields have values, keep as split payment
      setSplitPaymentDetails(splitDetails);
      setPaymentMethod('split');
      if (onPaymentMethodChange) onPaymentMethodChange('split');
    }
    setShowSplitPayment(false);
  };
  const handleSplitPaymentClose = () => {
    setShowSplitPayment(false);
    // If split payment modal is closed without submitting, clear split details and reset to cash
    if (!splitPaymentDetails) {
      setPaymentMethod('cash');
      if (onPaymentMethodChange) onPaymentMethodChange('cash');
    }
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    // Clear all previous errors
    setCustomerNameError('');
    setMobileError('');
    setSplitPaymentError('');
    setUpiIdError('');
    // Validate mobile number format if mobile is entered (for all payment methods)
    if (billingMobile && billingMobile.trim()) {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (sanitizedMobile.length > 0) {
        // If mobile is entered, it must be valid
        if (!isBillingMobileValid || sanitizedMobile.length !== 10) {
          setMobileError('Please enter a valid 10-digit mobile number');
          return;
        }
        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(sanitizedMobile)) {
          setMobileError('Please enter a valid 10-digit mobile number starting with 6-9');
          return;
        }
      }
    }
    // Validate customer name - check both customCustomerName and selectedCustomer
    // Prioritize customCustomerName if it exists (even if useCustomName is false, it might have been set when selecting existing customer)
    let customerName = '';
    if (customCustomerName && customCustomerName.trim()) {
      customerName = customCustomerName.trim();
    } else if (useCustomName) {
      customerName = (customCustomerName || '').trim();
    } else {
      // Try to find customer by name or ID
      const foundCustomer = customers.find(c => c.name === selectedCustomer || c.id === selectedCustomer);
      customerName = foundCustomer ? foundCustomer.name.trim() : (selectedCustomer || '').trim();
    }
    // Validate customer name for split payments and other non-cash/upi methods
    // Check splitPaymentDetails first to handle state sync issues
    const isSplitPayment = splitPaymentDetails || paymentMethod === 'split';
    const effectivePaymentMethod = splitPaymentDetails ? 'split' : paymentMethod;
    if ((effectivePaymentMethod !== 'cash' && effectivePaymentMethod !== 'upi' && effectivePaymentMethod !== 'split') || isSplitPayment) {
      if (!customerName || customerName === '' || customerName === 'Walk-in Customer') {
        const message = isSplitPayment 
          ? 'Customer name is required for split payment'
          : 'Customer name is required';
        setCustomerNameError(message);
        return;
      }
    }
    // Validate mobile for split payments (additional check)
    if (isSplitPayment) {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (!sanitizedMobile || sanitizedMobile.length !== 10) {
        setMobileError('Please enter a valid 10-digit mobile number for split payment');
        return;
      }
      const mobileRegex = /^[6-9]\d{9}$/;
      if (!mobileRegex.test(sanitizedMobile)) {
        setMobileError('Please enter a valid 10-digit mobile number starting with 6-9');
        return;
      }
    }
    // Validate mobile for due payments (additional check)
    if (effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit') {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (!sanitizedMobile || sanitizedMobile.length !== 10) {
        setMobileError('Please enter a valid 10-digit mobile number for due payment');
        return;
      }
      // Also validate customer name for due payments
      if (!customerName || customerName === '' || customerName === 'Walk-in Customer') {
        setCustomerNameError('Customer name is required for due payment');
        return;
      }
    }
    // Validate UPI ID for online payments
    if (effectivePaymentMethod === 'upi' && !sellerUpiId) {
      setUpiIdError('Please add your UPI ID in Settings before accepting online payments');
      return;
    }
    // Validate split payment details
    if (isSplitPayment && !splitPaymentDetails) {
      setSplitPaymentError('Please configure split payment details');
      return;
    }
    onSubmit({
      useCustomName,
      customCustomerName,
      selectedCustomer,
      billingMobile,
      paymentMethod: effectivePaymentMethod, // Use effective payment method
      sendWhatsAppInvoice,
      splitPaymentDetails
    });
  };
  // Get customer name for display - use same logic as validation
  const getCustomerNameForDisplay = () => {
    if (customCustomerName && customCustomerName.trim()) {
      return customCustomerName.trim();
    } else if (useCustomName) {
      return (customCustomerName || '').trim();
    } else {
      const foundCustomer = customers.find(c => c.name === selectedCustomer || c.id === selectedCustomer);
      return foundCustomer ? foundCustomer.name.trim() : (selectedCustomer || '').trim();
    }
  };
  const customerNameProvided = getCustomerNameForDisplay();
  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.25)] w-full max-w-md border border-slate-200/60 my-auto max-h-[95vh] flex flex-col">
          {/* Fixed Header */}
          <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0 border-b border-slate-200/60">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Complete Payment</h2>
              <p className="text-sm text-slate-500 mt-1">Total: ₹{total.toFixed(2)}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Scrollable Content */}
          <div className="overflow-y-auto flex-1 p-6">
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Customer Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Customer Details
                </h3>
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id="customName"
                    checked={useCustomName}
                    onChange={(e) => setUseCustomName(e.target.checked)}
                    className="h-4 w-4 rounded"
                    style={{ accentColor: 'var(--brand-primary)' }}
                  />
                  <label htmlFor="customName" className="cursor-pointer text-slate-700">
                    Use custom name
                  </label>
                </div>
                {useCustomName ? (
                  <div>
                    <label htmlFor="customerName" className="block text-sm font-medium text-slate-700 mb-2">
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      id="customerName"
                      value={customCustomerName}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCustomCustomerName(value);
                        // When user starts typing in custom name field, switch to custom name mode
                        if (value.trim()) {
                          setUseCustomName(true);
                          setSelectedCustomer(''); // Clear dropdown selection
                        }
                        // Clear error when user starts typing
                        if (customerNameError) setCustomerNameError('');
                      }}
                      placeholder="Enter customer name"
                      className={`w-full px-4 py-3 rounded-xl border bg-white focus:outline-none focus:ring-2 transition-all text-slate-900 placeholder:text-slate-400 ${
                        customerNameError 
                          ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' 
                          : 'border-slate-200/80 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                    />
                    {customerNameError && (
                      <p className="text-xs mt-1.5 text-red-600">
                        {customerNameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="selectCustomer" className="block text-sm font-medium text-slate-700 mb-2">
                      Select Customer
                    </label>
                    <select
                      id="selectCustomer"
                      value={selectedCustomer}
                      onChange={(e) => {
                        const selectedValue = e.target.value;
                        setSelectedCustomer(selectedValue);
                        // When selecting from dropdown, switch to dropdown mode and clear custom name
                        if (selectedValue) {
                          setUseCustomName(false);
                          setCustomCustomerName(''); // Clear custom name when selecting from dropdown
                        }
                        // Clear error when user selects a customer
                        if (customerNameError) setCustomerNameError('');
                      }}
                      className={`w-full px-4 py-3 rounded-xl border bg-white focus:outline-none focus:ring-2 transition-all text-slate-900 ${
                        customerNameError 
                          ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' 
                          : 'border-slate-200/80 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                    >
                      <option value="">Select customer</option>
                      {customers.map(customer => {
                        const mobileNumber = customer.mobileNumber || customer.phone || '';
                        return (
                          <option key={customer.id} value={customer.name}>
                            {customer.name} {mobileNumber ? `(${mobileNumber})` : ''} {(customer.balanceDue || customer.dueAmount) ? `- ₹${(customer.dueAmount || customer.balanceDue || 0).toFixed(2)} due` : ''}
                          </option>
                        );
                      })}
                    </select>
                    {customerNameError && (
                      <p className="text-xs mt-1.5 text-red-600">
                        {customerNameError}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label htmlFor="mobile" className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Mobile Number
                    {!useCustomName && selectedCustomer && (
                      <span className="text-xs text-slate-500 font-normal">(Auto-filled from customer)</span>
                    )}
                  </label>
                  <input
                    type="tel"
                    id="mobile"
                    value={billingMobile}
                    onChange={(e) => {
                      handleBillingMobileChange(e.target.value);
                      // Clear error when user starts typing
                      if (mobileError) setMobileError('');
                    }}
                    placeholder="Enter mobile number"
                    disabled={!useCustomName && selectedCustomer}
                    className={`w-full px-4 py-3 rounded-xl border bg-white focus:outline-none focus:ring-2 transition-all text-slate-900 placeholder:text-slate-400 ${
                      !useCustomName && selectedCustomer ? 'bg-slate-50 cursor-not-allowed opacity-75' : ''
                    } ${
                      mobileError || (billingMobile && !isBillingMobileValid)
                        ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500' 
                        : 'border-slate-200/80 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                    maxLength={10}
                  />
                  {(mobileError || (billingMobile && !isBillingMobileValid)) && (
                    <p className="text-xs mt-1.5 text-red-600">
                      {mobileError || 'Invalid mobile number'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id="sendWhatsApp"
                    checked={sendWhatsAppInvoice}
                    onChange={(e) => setSendWhatsAppInvoice(e.target.checked)}
                    className="h-4 w-4 rounded"
                    style={{ accentColor: 'var(--brand-primary)' }}
                  />
                  <label htmlFor="sendWhatsApp" className="cursor-pointer text-slate-700">
                    Send WhatsApp invoice
                  </label>
                </div>
              </div>
              {/* Payment Method */}
              <div className="space-y-4 pt-4 border-t border-slate-200/60">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Payment Method
                </h3>
                <div>
                  <select
                    value={splitPaymentDetails ? 'split' : paymentMethod}
                    onChange={(e) => handlePaymentMethodChange(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl border bg-white focus:outline-none focus:ring-2 transition-all text-slate-900 ${
                      splitPaymentError || upiIdError
                        ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500'
                        : 'border-slate-200/80 focus:ring-indigo-500/20 focus:border-indigo-500'
                    }`}
                  >
                    <option value="cash">Cash</option>
                    <option value="upi">Online Payment</option>
                    <option value="due">Due (Credit)</option>
                    <option value="split">Split Payment</option>
                  </select>
                  {upiIdError && (
                    <p className="text-xs mt-1.5 text-red-600">
                      {upiIdError}
                    </p>
                  )}
                  {splitPaymentError && (
                    <p className="text-xs mt-1.5 text-red-600">
                      {splitPaymentError}
                    </p>
                  )}
                </div>
                {splitPaymentDetails && !splitPaymentError && (
                  <div className="mt-3 p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                    <p className="text-xs font-medium text-indigo-800">
                      Split Payment: {splitPaymentDetails.cashAmount > 0 && `Cash: ₹${splitPaymentDetails.cashAmount.toFixed(2)} `}
                      {splitPaymentDetails.onlineAmount > 0 && `Online: ₹${splitPaymentDetails.onlineAmount.toFixed(2)} `}
                      {splitPaymentDetails.dueAmount > 0 && `Due: ₹${splitPaymentDetails.dueAmount.toFixed(2)}`}
                    </p>
                  </div>
                )}
              </div>
              {/* Action Buttons */}
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
                  Generate Bill
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      {showSplitPayment && (
        <SplitPaymentModal
          totalAmount={total}
          sellerUpiId={sellerUpiId}
          onClose={handleSplitPaymentClose}
          onSubmit={handleSplitPaymentSubmit}
        />
      )}
      {/* Customer Found Modal */}
      {showCustomerModal && foundCustomers.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={continueAsNewCustomer}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px -12px rgba(0, 0, 0, 0.25)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: '#111827'
            }}>
              Customer Found
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#6b7280',
              marginBottom: '20px'
            }}>
              We found {foundCustomers.length} customer(s) with this mobile number. Select one or continue as new customer.
            </p>
            <div style={{ marginBottom: '20px' }}>
              {foundCustomers.map((customer, index) => {
                const mobile = sanitizeMobileNumber(customer.mobileNumber || customer.phone || customer.phoneNumber || '');
                const dueAmount = customer.dueAmount || customer.balanceDue || 0;
                return (
                  <button
                    key={customer.id || customer._id || index}
                    type="button"
                    onClick={() => selectExistingCustomer(customer)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '16px',
                      marginBottom: '12px',
                      backgroundColor: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = '#f3f4f6';
                      e.target.style.borderColor = '#3b82f6';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = '#f9fafb';
                      e.target.style.borderColor = '#e5e7eb';
                    }}
                  >
                    <div style={{
                      fontWeight: '600',
                      fontSize: '16px',
                      color: '#111827',
                      marginBottom: '8px'
                    }}>
                      {customer.name}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: '#6b7280',
                      marginBottom: '4px'
                    }}>
                      📱 Mobile: {mobile}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: dueAmount > 0 ? '#ea580c' : '#6b7280',
                      fontWeight: '500'
                    }}>
                      Due Amount: ₹{dueAmount.toFixed(2)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center'
            }}>
              <button
                type="button"
                onClick={continueAsNewCustomer}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '14px'
                }}
              >
                Continue as New Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default PaymentAndCustomerModal;