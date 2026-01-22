import React, { useState } from 'react';
import { X, AlertTriangle, Minus, RefreshCw, IndianRupee, Plus } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp, isPlanExpired } from '../../context/AppContext';
import { canAddData, getLimitErrorMessage, DataCreationManager, getPlanLimits } from '../../utils/planUtils';
import { getTranslation } from '../../utils/translations';

const AddCustomerModal = ({
  onClose,
  onSubmit,
  existingCustomers = [],
  planLimitError = '',
  onClearPlanLimitError
}) => {
  const { state, dispatch } = useApp();

  React.useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        window.showToast('Access Restricted: A base subscription plan is required.', 'warning');
      }
    }
  }, [state, onClose]);

  const loadSavedCustomerData = () => {
    try {
      const saved = localStorage.getItem('addCustomer_saved');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      localStorage.removeItem('addCustomer_saved');
    }
    return {
      name: '',
      mobileNumber: '',
      email: '',
      address: '',
      openingBalanceDue: '', // They owe us
      openingBalanceCredit: '', // Pre-paid/Advance by them
      gstNumber: ''
    };
  };

  const [formData, setFormData] = useState(loadSavedCustomerData());
  const [limitError, setLimitError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [duplicateWarning, setDuplicateWarning] = useState(null);



  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const { containerRef } = useFocusTrap();

  const handleBalanceChange = (e) => {
    const { name, value } = e.target;
    const raw = value.replace(/,/g, '');

    // Allow only numbers and decimals
    if (raw !== '' && !/^[0-9]*\.?[0-9]*$/.test(raw)) return;

    const parts = raw.split('.');
    if (parts[0].length > 0) parts[0] = Number(parts[0]).toLocaleString('en-IN');
    const formatted = parts.join('.');

    setFormData(prev => ({
      ...prev,
      // If filling one, clear the other
      openingBalanceDue: name === 'openingBalanceDue' ? formatted : '',
      openingBalanceCredit: name === 'openingBalanceCredit' ? formatted : ''
    }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;

    if (name === 'mobileNumber') {
      nextValue = sanitizeMobileNumber(value);
    } else if (name === 'gstNumber') {
      nextValue = sanitizeGSTNumber(value);
    }

    setFormData(prev => ({ ...prev, [name]: nextValue }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    // Clear warnings when user changes input
    if (limitError) setLimitError('');
  };

  const handleSubmit = async (e, forceCreate = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isSubmitting) return;

    const newErrors = {};
    if (!formData.name?.trim()) newErrors.name = getTranslation('pleaseEnterCustomerName', state.currentLanguage);

    const mobile = sanitizeMobileNumber(formData.mobileNumber);
    if (!mobile) newErrors.mobileNumber = getTranslation('pleaseEnterMobileNumber', state.currentLanguage);
    else if (!isValidMobileNumber(mobile)) newErrors.mobileNumber = getTranslation('pleaseEnterValidMobile', state.currentLanguage);

    if (formData.gstNumber && !isValidGSTNumber(formData.gstNumber)) {
      newErrors.gstNumber = getTranslation('invalidGSTNumber', state.currentLanguage) || 'Invalid GST Number';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (!forceCreate) {
      const activeCustomers = state.customers.filter(c => !c.isDeleted);
      const existing = activeCustomers.find(c => c.mobileNumber === mobile);
      if (existing) {
        // Check for exact name match (case-insensitive) - STRICT BLOCK
        if (existing.name.trim().toLowerCase() === formData.name.trim().toLowerCase()) {
          setDuplicateWarning({
            name: existing.name,
            mobile: existing.mobileNumber,
            isStrict: true
          });
          return;
        }

        // Only mobile match - WARNING (Allow Proceed)
        setDuplicateWarning({ name: existing.name, mobile: existing.mobileNumber, isStrict: false });
        return;
      }
    }

    setIsSubmitting(true);
    const activeCustomers = state.customers.filter(c => !c.isDeleted);
    const canAdd = await canAddData(activeCustomers.length, 'customers', state.aggregatedUsage, state.currentPlan, state.currentPlanDetails);

    if (!canAdd) {
      setLimitError(getLimitErrorMessage('customers', state.aggregatedUsage));
      setIsSubmitting(false);
      return;
    }

    const balanceDue = parseFloat(formData.openingBalanceDue?.toString().replace(/,/g, '')) || 0;
    const balanceCredit = parseFloat(formData.openingBalanceCredit?.toString().replace(/,/g, '')) || 0;

    // In our system: positive = they owe us (due), negative = they paid in advance (credit/advance)
    const finalBalance = balanceDue > 0 ? balanceDue : (balanceCredit > 0 ? -balanceCredit : 0);

    const customerData = {
      ...formData,
      mobileNumber: mobile,
      dueAmount: finalBalance,
      balanceDue: finalBalance
    };

    try {
      const dataManager = new DataCreationManager({ state, dispatch });
      const result = await dataManager.createCustomer(customerData);
      if (result.success) {
        localStorage.removeItem('addCustomer_saved');
        if (window.showToast) window.showToast(getTranslation('customerAddedSuccess', state.currentLanguage), 'success');
        handleCloseModal();
      } else {
        setLimitError(result.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/40 flex items-end md:items-center justify-center z-[200] transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fadeIn'}`}
      onClick={handleCloseModal}
    >
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translateY(0); } to { transform: translateY(100%); } }
      `}</style>
      <div
        ref={containerRef}
        key={isClosing ? 'closing' : 'opening'}
        style={{ animation: `${isClosing ? 'slideDown' : 'slideUp'} 0.3s ease-out forwards` }}
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:max-h-[85vh] m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
            {getTranslation('addNewCustomer', state.currentLanguage)}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (formData.name?.trim()) localStorage.setItem('addCustomer_saved', JSON.stringify(formData));
                handleCloseModal();
              }}
              className="p-1 text-indigo-600 hover:text-indigo-800 transition-colors"
              title="Save draft"
            >
              <Minus className="h-5 w-5" />
            </button>
            <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {duplicateWarning ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
            {duplicateWarning.isStrict ? (
              // STRICT BLOCKING UI
              <>
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                  <X className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Duplicate Customer Found</h3>
                <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-xs mx-auto">
                  A customer with the name <span className="font-bold text-gray-900 dark:text-white">{duplicateWarning.name}</span> and mobile <span className="font-bold text-gray-900 dark:text-white">{duplicateWarning.mobile}</span> already exists.
                  <br /><br />
                  <span className="font-medium text-red-600 dark:text-red-400">Please change the name to create a new record.</span>
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => setDuplicateWarning(null)}
                    className="w-full py-3.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-all"
                  >
                    Go Back & Change Name
                  </button>
                </div>
              </>
            ) : (
              // EXISTING WARNING UI (Allow Proceed)
              <>
                <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Customer Already Exists</h3>
                <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-xs mx-auto">
                  A customer with the mobile number <span className="font-bold text-gray-900 dark:text-white">{duplicateWarning.mobile}</span> already exists{duplicateWarning.name ? ` (${duplicateWarning.name})` : ''}.
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                  <button
                    onClick={() => handleSubmit(null, true)}
                    className="w-full py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl shadow-sm hover:opacity-90 transition-all"
                  >
                    Create New Customer
                  </button>
                  <button
                    onClick={() => setDuplicateWarning(null)}
                    className="w-full py-3.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {limitError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium leading-relaxed">{limitError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('customerNameLabel', state.currentLanguage)}</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.name ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                    placeholder={getTranslation('enterCustomerName', state.currentLanguage)}
                  />
                  {errors.name && (
                    <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                      <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                      {errors.name}
                    </p>
                  )}
                </div>

                {/* Mobile */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('mobileNumberLabel', state.currentLanguage)}</label>
                  <input
                    type="tel"
                    name="mobileNumber"
                    value={formData.mobileNumber}
                    onChange={handleChange}
                    maxLength={10}
                    className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.mobileNumber ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                    placeholder={getTranslation('enterMobileNumber', state.currentLanguage)}
                  />
                  {errors.mobileNumber && (
                    <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                      <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                      {errors.mobileNumber}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('emailOptionalLabel', state.currentLanguage)}</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                    placeholder="example@mail.com"
                  />
                </div>

                {/* Balance (Due Amount) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Opening Balance (Due)</label>
                  <p className="text-[10px] text-gray-500 italic px-0.5">Amount the CUSTOMER owes you</p>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      name="openingBalanceDue"
                      value={formData.openingBalanceDue}
                      onChange={handleBalanceChange}
                      className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-gray-300"
                      placeholder="Customer owes"
                    />
                  </div>
                </div>

                {/* Balance (Credit Amount) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Opening Balance (Credit)</label>
                  <p className="text-[10px] text-gray-500 italic px-0.5">Advance PAID by the customer</p>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      name="openingBalanceCredit"
                      value={formData.openingBalanceCredit}
                      onChange={handleBalanceChange}
                      className="block w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all placeholder:font-normal placeholder:text-gray-300"
                      placeholder="Advance paid"
                    />
                  </div>
                </div>

                {/* GST Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('gstNumberOptional', state.currentLanguage)}</label>
                  <input
                    type="text"
                    name="gstNumber"
                    value={formData.gstNumber}
                    onChange={handleChange}
                    className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.gstNumber ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
                    placeholder="GSTIN"
                  />
                  {errors.gstNumber && (
                    <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1">
                      <X className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5" />
                      {errors.gstNumber}
                    </p>
                  )}
                </div>

                {/* Address */}
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('addressOptionalLabel', state.currentLanguage)}</label>
                  <textarea
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-20"
                    placeholder="City, Area, Street..."
                  />
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 pb-8 md:pb-6">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
              >
                {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {getTranslation('addCustomer', state.currentLanguage)}
              </button>
            </div>
          </form>
        )}
      </div>
    </div >
  );
};

export default AddCustomerModal;
