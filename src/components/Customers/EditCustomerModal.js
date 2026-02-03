import React, { useState } from 'react';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp, isPlanExpired } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const EditCustomerModal = ({ customer, onClose, onSubmit }) => {
  const { state } = useApp();

  React.useEffect(() => {
    if (isPlanExpired(state)) {
      if (onClose) onClose();
      if (window.showToast) {
        window.showToast('Access Restricted: A base subscription plan is required.', 'warning');
      }
    }
  }, [state, onClose]);

  const initialBalance = customer.balanceDue ?? customer.dueAmount ?? 0;
  const [formData, setFormData] = useState({
    name: customer.name || '',
    mobileNumber: sanitizeMobileNumber(customer.mobileNumber || customer.phone || ''),
    email: customer.email || '',
    address: customer.address || '',
    gstNumber: customer.gstNumber || '',
  });

  const isChanged =
    formData.name !== (customer.name || '') ||
    formData.mobileNumber !== sanitizeMobileNumber(customer.mobileNumber || customer.phone || '') ||
    formData.email !== (customer.email || '') ||
    formData.address !== (customer.address || '') ||
    formData.gstNumber !== (customer.gstNumber || '');

  const [isClosing, setIsClosing] = useState(false);
  const [errors, setErrors] = useState({});
  const { containerRef } = useFocusTrap();

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;

    if (name === 'mobileNumber') {
      // Strictly allow only digits
      if (value !== '' && !/^\d*$/.test(value)) return;
      nextValue = value;
    } else if (name === 'gstNumber') {
      nextValue = sanitizeGSTNumber(value);
    }

    setFormData(prev => ({ ...prev, [name]: nextValue }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

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

    const finalBalance = initialBalance;

    const customerData = {
      ...customer,
      ...formData,
      mobileNumber: mobile,
      dueAmount: finalBalance,
      balanceDue: finalBalance,
    };

    onSubmit(customerData);
    handleCloseModal();
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
        className="bg-white dark:bg-slate-900 !rounded-none md:!rounded-xl shadow-lg w-full md:max-w-2xl border border-gray-200 dark:border-slate-800 flex flex-col overflow-hidden fixed inset-0 md:relative md:inset-auto h-full md:h-auto m-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 uppercase tracking-tight">
            {getTranslation('editCustomer', state.currentLanguage)}
          </h2>
          <button onClick={handleCloseModal} className="p-1 hover:text-gray-900 dark:hover:text-white text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
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

              {/* GST Number */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{getTranslation('gstNumberOptional', state.currentLanguage)}</label>
                <input
                  type="text"
                  name="gstNumber"
                  value={formData.gstNumber || ''}
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
              disabled={!isChanged}
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-gray-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <RefreshCw className="h-4 w-4" />
              {getTranslation('updateCustomer', state.currentLanguage)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditCustomerModal;
