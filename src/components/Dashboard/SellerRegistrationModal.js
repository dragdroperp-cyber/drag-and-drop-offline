import React, { useState, useMemo, useEffect } from 'react';
import { useApp, ActionTypes } from '../../context/AppContext';
import { updateSellerProfile } from '../../utils/api';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { X } from 'lucide-react';

const businessTypes = [
  'Retail',
  'Wholesale',
  'Service',
  'Manufacturing',
  'E-commerce',
  'Other'
];

const genders = [
  'Male',
  'Female',
  'Other',
  'Prefer not to say'
];

const SellerRegistrationModal = ({ isOpen, onClose }) => {
  const { state, dispatch } = useApp();
  const currentUser = state.currentUser || {};
  const canClose = currentUser?.profileCompleted === true;

  const initialForm = useMemo(() => ({
    shopName: currentUser.shopName || '',
    businessType: currentUser.businessType || '',
    shopAddress: currentUser.shopAddress || '',
    phoneNumber: currentUser.phoneNumber || '',
    city: currentUser.city || '',
    state: currentUser.state || '',
    pincode: currentUser.pincode || '',
    upiId: currentUser.upiId || '',
    gstNumber: currentUser.gstNumber || '',
    gender: currentUser.gender || ''
  }), [
    currentUser.shopName,
    currentUser.businessType,
    currentUser.shopAddress,
    currentUser.phoneNumber,
    currentUser.city,
    currentUser.state,
    currentUser.pincode,
    currentUser.upiId,
    currentUser.gstNumber,
    currentUser.gender
  ]);

  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field) => (event) => {
    let value = event.target.value;
    
    // Sanitize GST number input (convert to uppercase, remove spaces)
    if (field === 'gstNumber' && value) {
      value = sanitizeGSTNumber(value);
    }
    
    setForm((prev) => ({
      ...prev,
      [field]: value
    }));
    setErrors((prev) => ({
      ...prev,
      [field]: ''
    }));
  };

  const validate = () => {
    const nextErrors = {};

    const requiredFields = [
      'shopName',
      'businessType',
      'shopAddress',
      'phoneNumber',
      'city',
      'state',
      'pincode',
      'upiId',
      'gender'
    ];

    requiredFields.forEach((field) => {
      if (!form[field] || !form[field].toString().trim()) {
        nextErrors[field] = 'Required';
      }
    });

    const sanitizedPhone = sanitizeMobileNumber(form.phoneNumber);
    if (!sanitizedPhone || !isValidMobileNumber(sanitizedPhone)) {
      nextErrors.phoneNumber = 'Enter a valid 10-digit mobile number';
    }

    const sanitizedPincode = (form.pincode || '').toString().replace(/\D/g, '');
    if (sanitizedPincode.length !== 6) {
      nextErrors.pincode = 'Enter a valid 6-digit pincode';
    }

    const upiPattern = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;
    if (!upiPattern.test(form.upiId.trim())) {
      nextErrors.upiId = 'Enter a valid UPI ID (example: name@bank)';
    }

    // Validate GST number if provided (optional field)
    if (form.gstNumber && form.gstNumber.trim()) {
      const sanitizedGST = sanitizeGSTNumber(form.gstNumber);
      if (!isValidGSTNumber(sanitizedGST)) {
        nextErrors.gstNumber = 'Enter a valid 15-character GSTIN (e.g., 27ABCDE1234F1Z5)';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!validate()) {
      if (window.showToast) {
        window.showToast('Please fix the highlighted fields.', 'warning');
      }
      return;
    }

    setIsSubmitting(true);

    const sanitizedPhone = sanitizeMobileNumber(form.phoneNumber);
    const sanitizedPincode = (form.pincode || '').toString().replace(/\D/g, '').slice(0, 6);
    const sanitizedGST = form.gstNumber ? sanitizeGSTNumber(form.gstNumber) : null;

    const payload = {
      shopName: form.shopName.trim(),
      businessType: form.businessType.trim(),
      shopAddress: form.shopAddress.trim(),
      phoneNumber: sanitizedPhone,
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: sanitizedPincode,
      upiId: form.upiId.trim(),
      gstNumber: sanitizedGST || null,
      gender: form.gender.trim()
    };

    try {
      console.log('📤 Submitting registration form with payload:', payload);
      
      const response = await updateSellerProfile(payload);
      
      console.log('📥 Registration response:', response);
      
      if (!response.success) {
        const errorMsg = response.error || response.data?.message || 'Failed to complete registration';
        console.error('❌ Registration failed:', errorMsg);
        throw new Error(errorMsg);
      }

      // Handle nested response structure
      const updatedSeller = response.data?.data?.seller || response.data?.seller || {};
      console.log('✅ Registration successful, updated seller:', updatedSeller);

      dispatch({
        type: ActionTypes.UPDATE_USER,
        payload: {
          ...currentUser,
          ...updatedSeller,
          profileCompleted: true
        }
      });

      if (payload.shopName) {
        dispatch({ type: ActionTypes.SET_STORE_NAME, payload: payload.shopName });
      }
      if (payload.upiId) {
        dispatch({ type: ActionTypes.SET_UPI_ID, payload: payload.upiId });
      }

      if (window.showToast) {
        window.showToast('Profile completed successfully!', 'success');
      }

      // Close modal after successful submission
      onClose();
    } catch (error) {
      console.error('❌ Seller registration error:', error);
      const errorMessage = error.message || 'Failed to save registration details.';
      
      if (window.showToast) {
        window.showToast(errorMessage, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    // Prevent closing by clicking outside if profile is not completed
    if (!canClose && e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl p-8 relative max-h-[90vh] overflow-y-auto">
        {canClose && (
          <button
            onClick={onClose}
            className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        )}

        <div className="mb-6">
          <p className="text-sm font-semibold text-sky-600 uppercase tracking-[0.3em]">
            Complete Your Profile
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">
            Welcome! Let's set up your business
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            We need a few business details to unlock all features.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Shop Name *
              </label>
              <input
                type="text"
                value={form.shopName}
                onChange={handleChange('shopName')}
                className={`input-field ${errors.shopName ? 'border-red-400' : ''}`}
                placeholder="Eg. ABC Store"
              />
              {errors.shopName && <p className="mt-1 text-xs text-red-500">{errors.shopName}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Business Type *
              </label>
              <select
                value={form.businessType}
                onChange={handleChange('businessType')}
                className={`input-field ${errors.businessType ? 'border-red-400' : ''}`}
              >
                <option value="">Select business type</option>
                {businessTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.businessType && <p className="mt-1 text-xs text-red-500">{errors.businessType}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Shop Address *
              </label>
              <textarea
                value={form.shopAddress}
                onChange={handleChange('shopAddress')}
                className={`input-field h-20 resize-none ${errors.shopAddress ? 'border-red-400' : ''}`}
                placeholder="Street, locality, landmark"
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
              {errors.shopAddress && <p className="mt-1 text-xs text-red-500">{errors.shopAddress}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone Number *
              </label>
              <input
                type="tel"
                value={form.phoneNumber}
                onChange={handleChange('phoneNumber')}
                className={`input-field ${errors.phoneNumber ? 'border-red-400' : ''}`}
                placeholder="10-digit mobile number"
              />
              {errors.phoneNumber && <p className="mt-1 text-xs text-red-500">{errors.phoneNumber}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                City *
              </label>
              <input
                type="text"
                value={form.city}
                onChange={handleChange('city')}
                className={`input-field ${errors.city ? 'border-red-400' : ''}`}
                placeholder="City"
              />
              {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                State *
              </label>
              <input
                type="text"
                value={form.state}
                onChange={handleChange('state')}
                className={`input-field ${errors.state ? 'border-red-400' : ''}`}
                placeholder="State"
              />
              {errors.state && <p className="mt-1 text-xs text-red-500">{errors.state}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Pincode *
              </label>
              <input
                type="text"
                value={form.pincode}
                onChange={handleChange('pincode')}
                className={`input-field ${errors.pincode ? 'border-red-400' : ''}`}
                placeholder="6-digit pincode"
              />
              {errors.pincode && <p className="mt-1 text-xs text-red-500">{errors.pincode}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                UPI ID *
              </label>
              <input
                type="text"
                value={form.upiId}
                onChange={handleChange('upiId')}
                className={`input-field ${errors.upiId ? 'border-red-400' : ''}`}
                placeholder="yourname@bank"
              />
              {errors.upiId && <p className="mt-1 text-xs text-red-500">{errors.upiId}</p>}
              <p className="mt-1.5 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5">
                <span className="font-medium text-blue-700">💡 Why we need your UPI ID:</span> We generate dynamic QR codes for you to accept customer payments directly to your UPI account.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                GST Number <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={form.gstNumber}
                onChange={handleChange('gstNumber')}
                className={`input-field ${errors.gstNumber ? 'border-red-400' : ''}`}
                placeholder="GSTIN (e.g., 27ABCDE1234F1Z5)"
              />
              {errors.gstNumber && <p className="mt-1 text-xs text-red-500">{errors.gstNumber}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Gender *
              </label>
              <select
                value={form.gender}
                onChange={handleChange('gender')}
                className={`input-field ${errors.gender ? 'border-red-400' : ''}`}
              >
                <option value="">Select gender</option>
                {genders.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.gender && <p className="mt-1 text-xs text-red-500">{errors.gender}</p>}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-sky-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SellerRegistrationModal;

