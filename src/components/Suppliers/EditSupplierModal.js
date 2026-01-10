import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useApp } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';

const EditSupplierModal = ({
  onClose,
  onSubmit,
  supplier,
  existingSuppliers = []
}) => {
  const { state } = useApp();

  const initialBalance = supplier.dueAmount ?? supplier.balanceDue ?? 0;
  const [formData, setFormData] = useState({
    id: supplier.id,
    _id: supplier._id,
    localId: supplier.localId,
    name: supplier.name || '',
    mobileNumber: supplier.mobileNumber || '',
    email: supplier.email || '',
    address: supplier.address || '',
    gstNumber: supplier.gstNumber || '',
    sellerId: supplier.sellerId
  });

  const [isClosing, setIsClosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const handleCloseModal = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 400);
  };

  const { containerRef } = useFocusTrap();



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
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const newErrors = {};
    if (!formData.name?.trim()) newErrors.name = 'Please enter supplier name';

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

    setIsSubmitting(true);

    // Preserve original balance
    const finalBalance = initialBalance;

    const supplierData = {
      ...formData,
      mobileNumber: mobile,
      dueAmount: finalBalance,
      balanceDue: finalBalance
    };

    try {
      if (onSubmit) {
        await onSubmit(supplierData);
      }
      if (window.showToast) window.showToast('Supplier updated successfully!', 'success');
      handleCloseModal();
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast('Failed to update supplier', 'error');
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
            Edit Supplier
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
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Supplier Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.name ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
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
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Mobile Number</label>
                <input
                  type="tel"
                  name="mobileNumber"
                  value={formData.mobileNumber}
                  onChange={handleChange}
                  maxLength={10}
                  className={`block w-full px-4 py-3 bg-white dark:bg-slate-900 border ${errors.mobileNumber ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200 dark:border-slate-700'} rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all`}
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
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                />
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
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">Address</label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="block w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-medium text-gray-900 dark:text-white focus:border-indigo-500 outline-none transition-all resize-none h-20"
                />
              </div>
            </div>
          </div>

          <div className="p-6 pt-0 pb-8 md:pb-6">
            <button
              type="submit"
              disabled={isSubmitting || JSON.stringify({
                name: formData.name,
                mobileNumber: formData.mobileNumber,
                email: formData.email,
                address: formData.address,
                gstNumber: formData.gstNumber,
              }) === JSON.stringify({
                name: supplier.name || '',
                mobileNumber: sanitizeMobileNumber(supplier.mobileNumber || ''),
                email: supplier.email || '',
                address: supplier.address || '',
                gstNumber: supplier.gstNumber || ''
              })}
              className="w-full py-3.5 rounded-lg font-bold text-sm text-white dark:text-slate-900 bg-slate-900 dark:bg-white hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update Supplier
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditSupplierModal;
