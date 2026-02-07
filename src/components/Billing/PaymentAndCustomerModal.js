import React, { useState, useEffect } from 'react';
import { X, User, Phone, Wallet, CreditCard, Printer, Download, ChevronDown, Clock, Split, ChevronRight, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SplitPaymentModal from './SplitPaymentModal';
import { sanitizeMobileNumber, isValidMobileNumber } from '../../utils/validation';
import { formatCurrency } from '../../utils/orderUtils';
import { getTranslation } from '../../utils/translations';

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
  onSendWhatsAppInvoiceChange,
  onCustomNameChange,
  onSelectedCustomerChange,
  onBillingMobileChange,
  onPaymentMethodChange
}) => {
  const { state } = useApp();
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
  const [showSelectCustomerPopup, setShowSelectCustomerPopup] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

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
    setCustomerNameError('');
    setMobileError('');
    setSplitPaymentError('');
    setUpiIdError('');

    if (billingMobile && billingMobile.trim()) {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (sanitizedMobile.length > 0) {
        if (!isBillingMobileValid || sanitizedMobile.length !== 10) {
          setMobileError(getTranslation('pleaseEnterMobile10', state.currentLanguage));
          return;
        }
        const mobileRegex = /^[6-9]\d{9}$/;
        if (!mobileRegex.test(sanitizedMobile)) {
          setMobileError(getTranslation('pleaseEnterMobileStart69', state.currentLanguage));
          return;
        }
      }
    }

    let customerName = '';
    if (customCustomerName && customCustomerName.trim()) {
      customerName = customCustomerName.trim();
    } else if (useCustomName) {
      customerName = (customCustomerName || '').trim();
    } else {
      const foundCustomer = customers.find(c => c.name === selectedCustomer || c.id === selectedCustomer);
      customerName = foundCustomer ? foundCustomer.name.trim() : (selectedCustomer || '').trim();
    }

    const isSplitPayment = splitPaymentDetails || paymentMethod === 'split';
    const effectivePaymentMethod = splitPaymentDetails ? 'split' : paymentMethod;

    if ((effectivePaymentMethod !== 'cash' && effectivePaymentMethod !== 'upi' && effectivePaymentMethod !== 'split') || isSplitPayment) {
      if (!customerName || customerName === '' || customerName === 'Walk-in Customer') {
        const message = isSplitPayment
          ? getTranslation('customerNameRequiredSplit', state.currentLanguage)
          : getTranslation('customerNameRequired', state.currentLanguage);
        setCustomerNameError(message);
        return;
      }
    }

    if (isSplitPayment) {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (!sanitizedMobile || sanitizedMobile.length !== 10) {
        setMobileError(getTranslation('mobileRequiredSplit', state.currentLanguage));
        return;
      }
    }

    if (effectivePaymentMethod === 'due' || effectivePaymentMethod === 'credit') {
      const sanitizedMobile = billingMobile.replace(/\D/g, '');
      if (!sanitizedMobile || sanitizedMobile.length !== 10) {
        setMobileError(getTranslation('mobileRequiredDue', state.currentLanguage));
        return;
      }
      if (!customerName || customerName === '' || customerName === 'Walk-in Customer') {
        setCustomerNameError(getTranslation('customerNameRequiredDue', state.currentLanguage));
        return;
      }
    }

    if (effectivePaymentMethod === 'upi' && !sellerUpiId) {
      setUpiIdError(getTranslation('addUpiSettings', state.currentLanguage));
      return;
    }

    if (isSplitPayment && !splitPaymentDetails) {
      setSplitPaymentError(getTranslation('configureSplitDetails', state.currentLanguage));
      return;
    }

    if (sendWhatsAppInvoice) {
      const sanitizedMobile = (billingMobile || '').replace(/\D/g, '');
      if (!sanitizedMobile || sanitizedMobile.length !== 10) {
        setMobileError(getTranslation('enterValidMobileWhatsApp', state.currentLanguage));
        return;
      }
    }

    onSubmit({
      useCustomName,
      customCustomerName,
      selectedCustomer,
      billingMobile,
      paymentMethod: effectivePaymentMethod,
      sendWhatsAppInvoice,
      splitPaymentDetails
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-[1300] flex items-end md:items-center justify-center animate-fadeIn" onClick={onClose}>
        <style>{`
          @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
        `}</style>
        <div
          className="bg-white dark:bg-slate-900 w-full md:max-w-xl !rounded-none md:!rounded-xl shadow-lg border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[85vh] m-0"
          onClick={e => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">{getTranslation('completePayment', state.currentLanguage)}</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{getTranslation('total', state.currentLanguage)}: {formatCurrency(total)}</p>
            </div>
            <button onClick={onClose} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0" noValidate>
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Customer Section */}
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <User className="h-3 w-3" />
                    {getTranslation('customerInformation', state.currentLanguage)}
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={useCustomName}
                        onChange={(e) => setUseCustomName(e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-8 h-4 rounded-full transition-colors ${useCustomName ? 'bg-slate-900' : 'bg-gray-200 dark:bg-slate-700'}`}></div>
                      <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${useCustomName ? 'translate-x-4' : ''}`}></div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">{getTranslation('customNameToggle', state.currentLanguage)}</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  {useCustomName ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('customerNameLabel', state.currentLanguage)}</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={customCustomerName}
                          onChange={(e) => {
                            setCustomCustomerName(e.target.value);
                            if (e.target.value.trim()) {
                              setUseCustomName(true);
                              setSelectedCustomer('');
                            }
                            if (customerNameError) setCustomerNameError('');
                          }}
                          placeholder={getTranslation('enterCustomerName', state.currentLanguage)}
                          className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${customerNameError ? 'border-red-500' : 'border-gray-200 dark:border-slate-700'} rounded-xl text-sm font-bold focus:border-slate-900 outline-none transition-all`}
                        />
                      </div>
                      {customerNameError && <p className="text-[10px] font-bold text-red-500 uppercase px-0.5">{customerNameError}</p>}
                    </div>
                  ) : (
                    <div className="space-y-1.5 relative">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('selectCustomerLabel', state.currentLanguage)}</label>
                      <button
                        type="button"
                        onClick={() => setShowSelectCustomerPopup(true)}
                        className={`flex items-center justify-between w-full px-4 py-3 bg-white dark:bg-slate-900 border ${customerNameError ? 'border-red-500' : 'border-gray-200 dark:border-slate-700'} rounded-xl text-sm font-bold focus:border-slate-900 outline-none transition-all text-left group`}
                      >
                        <span className={selectedCustomer ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
                          {selectedCustomer || getTranslation('selectCustomerLabel', state.currentLanguage)}
                        </span>
                        <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                      </button>
                      {customerNameError && <p className="text-[10px] font-bold text-red-500 uppercase px-0.5">{customerNameError}</p>}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5 flex items-center gap-2">
                      {getTranslation('mobileNumberLabel', state.currentLanguage)}
                      {!useCustomName && selectedCustomer && <span className="text-[10px] lowercase font-normal">({getTranslation('autoFilled', state.currentLanguage)})</span>}
                    </label>
                    <input
                      type="tel"
                      value={billingMobile}
                      onChange={(e) => {
                        handleBillingMobileChange(e.target.value);
                        if (mobileError) setMobileError('');
                      }}
                      placeholder="10-digit mobile"
                      disabled={!useCustomName && selectedCustomer}
                      className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${mobileError || (billingMobile && !isBillingMobileValid) ? 'border-red-500' : 'border-gray-200 dark:border-slate-700'} rounded-xl text-sm font-bold focus:border-slate-900 outline-none transition-all ${!useCustomName && selectedCustomer ? 'opacity-50 cursor-not-allowed' : ''}`}
                      maxLength={10}
                    />
                    {(mobileError || (billingMobile && !isBillingMobileValid)) && (
                      <p className="text-[10px] font-bold text-red-500 uppercase px-0.5">{mobileError || getTranslation('invalidMobile', state.currentLanguage)}</p>
                    )}
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer group w-fit">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={sendWhatsAppInvoice}
                      onChange={(e) => setSendWhatsAppInvoice(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-8 h-4 rounded-full transition-colors ${sendWhatsAppInvoice ? 'bg-green-600' : 'bg-gray-200 dark:bg-slate-700'}`}></div>
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${sendWhatsAppInvoice ? 'translate-x-4' : ''}`}></div>
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">{getTranslation('whatsappInvoice', state.currentLanguage)}</span>
                </label>
              </div>

              {/* Payment Section */}
              <div className="space-y-5 pt-8 border-t border-gray-100 dark:border-slate-800">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Wallet className="h-3 w-3" />
                  {getTranslation('paymentConfiguration', state.currentLanguage)}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('paymentMethodLabel', state.currentLanguage)}</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'cash', label: getTranslation('cash', state.currentLanguage), icon: Wallet },
                        { id: 'upi', label: getTranslation('online', state.currentLanguage), icon: CreditCard },
                        { id: 'due', label: getTranslation('due', state.currentLanguage), icon: Clock },
                        { id: 'split', label: getTranslation('split', state.currentLanguage), icon: Split }
                      ].map((method) => (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => handlePaymentMethodChange(method.id)}
                          className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${(splitPaymentDetails ? 'split' : paymentMethod) === method.id
                            ? 'border-slate-900 bg-slate-100 dark:bg-slate-900/20 text-slate-900 dark:text-slate-100'
                            : 'border-gray-100 dark:border-slate-800 text-gray-400 hover:border-gray-200 dark:hover:border-slate-700'
                            }`}
                        >
                          <method.icon className="h-4 w-4 mb-1.5" />
                          <span className="text-[10px] font-bold uppercase tracking-tight">{method.label}</span>
                        </button>
                      ))}
                    </div>
                    {upiIdError && <p className="text-[10px] font-bold text-red-500 uppercase px-0.5 mt-1">{upiIdError}</p>}
                    {splitPaymentError && <p className="text-[10px] font-bold text-red-500 uppercase px-0.5 mt-1">{splitPaymentError}</p>}
                  </div>

                  {splitPaymentDetails && !splitPaymentError && (
                    <div className="md:col-span-2 p-3 bg-slate-100 dark:bg-slate-900/10 border border-slate-200 dark:border-slate-800/20 rounded-lg">
                      <p className="text-[10px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-widest mb-2">{getTranslation('splitDetails', state.currentLanguage)}</p>
                      <div className="grid grid-cols-3 gap-4">
                        {splitPaymentDetails.cashAmount > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase">{getTranslation('cash', state.currentLanguage)}</p>
                            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{formatCurrency(splitPaymentDetails.cashAmount)}</p>
                          </div>
                        )}
                        {splitPaymentDetails.onlineAmount > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase">{getTranslation('online', state.currentLanguage)}</p>
                            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{formatCurrency(splitPaymentDetails.onlineAmount)}</p>
                          </div>
                        )}
                        {splitPaymentDetails.dueAmount > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase">{getTranslation('due', state.currentLanguage)}</p>
                            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{formatCurrency(splitPaymentDetails.dueAmount)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 pb-8 md:pb-6">
              <button
                type="submit"
                className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm action-button-write"
              >
                {getTranslation('generateBill', state.currentLanguage)}
              </button>
            </div>
          </form>
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

      {showCustomerModal && foundCustomers.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/40 z-[1400] flex items-center justify-center p-4 animate-fadeIn" onClick={continueAsNewCustomer}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">{getTranslation('customerFound', state.currentLanguage)}</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">{getTranslation('multipleRecordsMatch', state.currentLanguage)}</p>
            </div>

            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {foundCustomers.map((customer, index) => (
                <button
                  key={customer.id || index}
                  onClick={() => selectExistingCustomer(customer)}
                  className="w-full text-left p-4 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 hover:border-slate-900 transition-all group"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold text-gray-900 dark:text-white">{customer.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">{customer.mobileNumber || getTranslation('noPhoneNumber', state.currentLanguage)}</p>
                    </div>
                    {customer.dueAmount > 0 && (
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">{getTranslation('due', state.currentLanguage)}</p>
                        <p className="text-xs font-bold text-red-600 dark:text-red-400">{formatCurrency(customer.dueAmount)}</p>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="p-6 pt-0">
              <button
                onClick={continueAsNewCustomer}
                className="w-full py-3 rounded-lg font-bold text-xs text-gray-500 bg-gray-100 dark:bg-slate-800 uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-slate-700 transition-all font-bold"
              >
                {getTranslation('continueAsNewCustomer', state.currentLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSelectCustomerPopup && (
        <div className="fixed inset-0 bg-slate-900/60 z-[1500] flex items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fadeIn" onClick={() => setShowSelectCustomerPopup(false)}>
          <div className="bg-white dark:bg-slate-900 w-full h-full sm:h-auto sm:max-w-md sm:rounded-2xl rounded-none shadow-2xl overflow-hidden animate-slideUp border border-gray-100 dark:border-slate-800 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">{getTranslation('selectCustomerLabel', state.currentLanguage)}</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Total Customers: {customers.length}</p>
              </div>
              <button onClick={() => setShowSelectCustomerPopup(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={customerSearchQuery}
                  onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  placeholder="Search by name or mobile..."
                  className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold focus:border-slate-900 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar sm:max-h-[50vh]">
              {(() => {
                const filtered = customers.filter(c => {
                  const query = customerSearchQuery.toLowerCase();
                  return (c.name || '').toLowerCase().includes(query) ||
                    (c.mobileNumber || '').includes(query) ||
                    (c.phone || '').includes(query);
                });

                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                      <User className="h-10 w-10 text-gray-200 dark:text-slate-800 mb-3" />
                      <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">No customers found</p>
                    </div>
                  );
                }

                return filtered.map((customer) => {
                  const firstLetter = (customer.name || 'C').charAt(0).toUpperCase();
                  const isSelected = selectedCustomer === customer.name;

                  return (
                    <button
                      key={customer.id}
                      onClick={() => {
                        setSelectedCustomer(customer.name);
                        setUseCustomName(false);
                        setCustomCustomerName('');
                        if (customerNameError) setCustomerNameError('');
                        setShowSelectCustomerPopup(false);
                        setCustomerSearchQuery('');
                      }}
                      className={`w-full text-left p-4 sm:p-5 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all border-b border-gray-50 dark:border-slate-800 last:border-0 ${isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/20 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800/50' : ''}`}
                    >
                      {/* Avatar / Initials */}
                      <div className={`w-12 h-12 flex-shrink-0 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                        {firstLetter}
                      </div>

                      <div className="flex-1 min-w-0 py-0.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className={`font-bold text-base truncate transition-colors ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-900 dark:text-white'}`}>
                            {customer.name}
                          </p>
                          {isSelected && (
                            <div className="bg-indigo-600 rounded-full p-0.5">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-tight">
                            <Phone className="h-3.5 w-3.5 text-gray-400" />
                            {customer.mobileNumber || customer.phone || 'No Mobile'}
                          </span>

                          {customer.dueAmount > 0 && (
                            <span className="flex items-center gap-1.5 text-xs font-bold text-red-500 dark:text-red-400 uppercase tracking-tight bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-md border border-red-100 dark:border-red-900/30">
                              <Clock className="h-3.5 w-3.5" />
                              Due: {formatCurrency(customer.dueAmount)}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className={`h-5 w-5 flex-shrink-0 transition-transform ${isSelected ? 'text-indigo-400 translate-x-1' : 'text-gray-300'}`} />
                    </button>
                  );
                });
              })()}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900">
              <button
                onClick={() => {
                  setUseCustomName(true);
                  setSelectedCustomer('');
                  setCustomCustomerName('');
                  setShowSelectCustomerPopup(false);
                }}
                className="w-full py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                + Add New Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PaymentAndCustomerModal;
