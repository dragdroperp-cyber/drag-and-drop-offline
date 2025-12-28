import React, { useState, useEffect, useCallback } from 'react';
import { useApp, ActionTypes, isPlanExpired } from '../../context/AppContext';
import { updateSellerProfile } from '../../utils/api';
import { STORES, getItem, updateItem } from '../../utils/indexedDB';
import { signOut } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber, debugGSTValidation } from '../../utils/validation';
import { APP_VERSION, APP_NAME } from '../../utils/version';
import { usePWAUpdate } from '../../hooks/usePWAUpdate';
import {
  Save,
  Bell,
  AlertTriangle,
  RefreshCw,
  LogOut,
  X,
  WifiOff,
  Store,
  CreditCard,
  User,
  MapPin,
  Phone,
  Mail,
  Building2,
  Edit,
  Shield,
  CheckCircle,
  AlertCircle,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Database,
  Info,
  Languages
} from 'lucide-react';

// Business types for dropdown
const businessTypes = [
  'Retail',
  'Wholesale',
  'Service',
  'Manufacturing',
  'E-commerce',
  'Other'
];

// Gender options
const genderOptions = [
  'Male',
  'Female',
  'Other',
  'Prefer not to say'
];

// Indian states for address updates
const indianStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union Territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

// Main Settings Component
const Settings = () => {
  const { state, dispatch, logoutWithDataProtection } = useApp();
  const currentUser = state.currentUser || {};

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
            <div className="flex items-center space-x-3">
              <SettingsIcon className="h-8 w-8 text-blue-600 dark:text-indigo-400" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
                <p className="text-gray-600 dark:text-slate-400 mt-1">Manage your business settings and preferences</p>
              </div>
            </div>
          </div>

          {/* Settings Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Business Profile */}
            <BusinessProfileSection user={currentUser} />

            {/* Notification Preferences */}
            <NotificationSection />

            {/* App Preferences */}
            <AppPreferencesSection />

            {/* Account Security */}
            <AccountSection user={currentUser} />

            {/* App Version */}
            <AppVersionSection />
          </div>
        </div>
      </div>
    </div>
  );
};

// Business Profile Section
const BusinessProfileSection = ({ user }) => {
  const { state, dispatch } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    shopName: user.shopName || '',
    businessType: user.businessType || '',
    shopAddress: user.shopAddress || '',
    phoneNumber: user.phoneNumber || '',
    city: user.city || '',
    state: user.state || '',
    pincode: user.pincode || '',
    upiId: user.upiId || '',
    gstNumber: user.gstNumber || '',
    gender: user.gender || ''
  });
  const [errors, setErrors] = useState({});

  const handleChange = (field) => (event) => {
    setForm(prev => ({
      ...prev,
      [field]: event.target.value
    }));
    setErrors(prev => ({
      ...prev,
      [field]: ''
    }));
  };

  const validate = () => {
    const nextErrors = {};
    const requiredFields = ['shopName', 'businessType', 'shopAddress', 'phoneNumber', 'city', 'state', 'pincode', 'upiId', 'gender'];

    requiredFields.forEach(field => {
      if (!form[field] || !form[field].toString().trim()) {
        nextErrors[field] = 'Required';
      }
    });

    // Phone validation
    if (form.phoneNumber && !/^[6-9]\d{9}$/.test(form.phoneNumber.replace(/\D/g, ''))) {
      nextErrors.phoneNumber = 'Enter a valid 10-digit mobile number';
    }

    // Pincode validation
    if (form.pincode && !/^\d{6}$/.test(form.pincode.replace(/\D/g, ''))) {
      nextErrors.pincode = 'Enter a valid 6-digit pincode';
    }

    // UPI validation
    if (form.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(form.upiId.trim())) {
      nextErrors.upiId = 'Enter a valid UPI ID (example: name@bank)';
    }

    // GST validation

    if (form.gstNumber) {

      const isValid = isValidGSTNumber(form.gstNumber);

      debugGSTValidation(form.gstNumber); // Debug the validation
      if (!isValid) {
        nextErrors.gstNumber = 'Enter a valid GST number (15 characters: 27ABCDE1234F1Z5)';

      } else {

      }
    } else {

    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to update your business profile.', 'warning', 8000);
      }
      return;
    }
    if (!validate()) {
      if (window.showToast) window.showToast('Please fix the highlighted fields', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        shopName: form.shopName.trim(),
        businessType: form.businessType.trim(),
        shopAddress: form.shopAddress.trim(),
        phoneNumber: form.phoneNumber.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.replace(/\D/g, '').slice(0, 6),
        upiId: form.upiId.trim(),
        gstNumber: form.gstNumber ? sanitizeGSTNumber(form.gstNumber) : null,
        gender: form.gender.trim()
      };

      const response = await updateSellerProfile(payload);

      if (response.success) {
        // Update local state
        dispatch({
          type: ActionTypes.UPDATE_USER,
          payload: { ...user, ...payload }
        });

        if (payload.shopName) {
          dispatch({ type: ActionTypes.SET_STORE_NAME, payload: payload.shopName });
        }
        if (payload.upiId) {
          dispatch({ type: ActionTypes.SET_UPI_ID, payload: payload.upiId });
        }

        setIsEditing(false);
        if (window.showToast) window.showToast('Business profile updated successfully!', 'success');
      } else {
        throw new Error(response.error || 'Failed to update profile');
      }
    } catch (error) {

      if (window.showToast) window.showToast(error.message || 'Failed to update profile', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Store className="h-6 w-6 text-blue-600 dark:text-indigo-400" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Business Profile</h2>
        </div>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center space-x-2 text-blue-600 dark:text-indigo-400 hover:text-blue-700 dark:hover:text-indigo-300 transition-colors"
          >
            <Edit className="h-4 w-4" />
            <span>Edit</span>
          </button>
        ) : (
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setIsEditing(false);
                setForm({
                  shopName: user.shopName || '',
                  businessType: user.businessType || '',
                  shopAddress: user.shopAddress || '',
                  phoneNumber: user.phoneNumber || '',
                  city: user.city || '',
                  state: user.state || '',
                  pincode: user.pincode || '',
                  upiId: user.upiId || '',
                  gstNumber: user.gstNumber || '',
                  gender: user.gender || ''
                });
                setErrors({});
              }}
              className="px-3 py-1 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center space-x-2 px-3 py-1 bg-blue-600 dark:bg-indigo-600 text-white text-sm rounded-lg hover:bg-blue-700 dark:hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Shop Name</label>
            {isEditing ? (
              <input
                type="text"
                value={form.shopName}
                onChange={handleChange('shopName')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.shopName ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="Your shop name"
              />
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.shopName || 'Not set'}</p>
            )}
            {errors.shopName && <p className="mt-1 text-xs text-red-500">{errors.shopName}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Business Type</label>
            {isEditing ? (
              <select
                value={form.businessType}
                onChange={handleChange('businessType')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white ${errors.businessType ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Select type</option>
                {businessTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.businessType || 'Not set'}</p>
            )}
            {errors.businessType && <p className="mt-1 text-xs text-red-500">{errors.businessType}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Shop Address</label>
          {isEditing ? (
            <textarea
              value={form.shopAddress}
              onChange={handleChange('shopAddress')}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.shopAddress ? 'border-red-400' : 'border-gray-300'}`}
              rows={3}
              placeholder="Street, locality, landmark"
            />
          ) : (
            <p className="text-gray-900 dark:text-slate-100 py-2">{user.shopAddress || 'Not set'}</p>
          )}
          {errors.shopAddress && <p className="mt-1 text-xs text-red-500">{errors.shopAddress}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Phone</label>
            {isEditing ? (
              <input
                type="tel"
                value={form.phoneNumber}
                onChange={handleChange('phoneNumber')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.phoneNumber ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="10-digit number"
              />
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.phoneNumber || 'Not set'}</p>
            )}
            {errors.phoneNumber && <p className="mt-1 text-xs text-red-500">{errors.phoneNumber}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">City</label>
            {isEditing ? (
              <input
                type="text"
                value={form.city}
                onChange={handleChange('city')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.city ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="City"
              />
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.city || 'Not set'}</p>
            )}
            {errors.city && <p className="mt-1 text-xs text-red-500">{errors.city}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">State</label>
            {isEditing ? (
              <select
                value={form.state}
                onChange={handleChange('state')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white ${errors.state ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Select state</option>
                {indianStates.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.state || 'Not set'}</p>
            )}
            {errors.state && <p className="mt-1 text-xs text-red-500">{errors.state}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Pincode</label>
            {isEditing ? (
              <input
                type="text"
                value={form.pincode}
                onChange={handleChange('pincode')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.pincode ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="6-digit pincode"
              />
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.pincode || 'Not set'}</p>
            )}
            {errors.pincode && <p className="mt-1 text-xs text-red-500">{errors.pincode}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">UPI ID</label>
            {isEditing ? (
              <input
                type="text"
                value={form.upiId}
                onChange={handleChange('upiId')}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.upiId ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="yourname@bank"
              />
            ) : (
              <p className="text-gray-900 dark:text-slate-100 py-2">{user.upiId || 'Not set'}</p>
            )}
            {errors.upiId && <p className="mt-1 text-xs text-red-500">{errors.upiId}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">GST Number <span className="text-gray-400 text-xs">(Optional)</span></label>
          {isEditing ? (
            <input
              type="text"
              value={form.gstNumber}
              onChange={handleChange('gstNumber')}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400 ${errors.gstNumber ? 'border-red-400' : 'border-gray-300'}`}
              placeholder="GSTIN (e.g., 27ABCDE1234F1Z5)"
            />
          ) : (
            <p className="text-gray-900 dark:text-slate-100 py-2">{user.gstNumber || 'Not set'}</p>
          )}
          {errors.gstNumber && <p className="mt-1 text-xs text-red-500">{errors.gstNumber}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Gender</label>
          {isEditing ? (
            <select
              value={form.gender}
              onChange={handleChange('gender')}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white ${errors.gender ? 'border-red-400' : 'border-gray-300'}`}
            >
              <option value="">Select gender</option>
              {genderOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : (
            <p className="text-gray-900 dark:text-slate-100 py-2">{user.gender || 'Not set'}</p>
          )}
          {errors.gender && <p className="mt-1 text-xs text-red-500">{errors.gender}</p>}
        </div>
      </div>
    </div>
  );
};

// Notification Section
const NotificationSection = () => {
  const { state, dispatch } = useApp();
  const [settings, setSettings] = useState({
    lowStockThreshold: state.lowStockThreshold || 10,
    expiryDaysThreshold: state.expiryDaysThreshold || 7
  });

  const handleSave = async () => {
    if (isPlanExpired(state)) {
      if (window.showToast) {
        window.showToast('Your plan has expired. Please upgrade your plan to change alert settings.', 'warning', 8000);
      }
      return;
    }
    try {
      // Save to IndexedDB
      const record = {
        id: `settings_${state.currentUser?._id || state.currentUser?.sellerId}`,
        sellerId: state.currentUser?._id || state.currentUser?.sellerId,
        ...settings,
        updatedAt: new Date().toISOString()
      };

      await updateItem(STORES.settings, record);

      // Update context
      dispatch({ type: ActionTypes.SET_LOW_STOCK_THRESHOLD, payload: settings.lowStockThreshold });
      dispatch({ type: ActionTypes.SET_EXPIRY_DAYS_THRESHOLD, payload: settings.expiryDaysThreshold });

      if (window.showToast) window.showToast('Notification settings saved!', 'success');
    } catch (error) {

      if (window.showToast) window.showToast('Failed to save settings', 'error');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
      <div className="flex items-center space-x-3 mb-6">
        <Bell className="h-6 w-6 text-green-600 dark:text-emerald-400" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Notifications & Alerts</h2>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Low Stock Alert Threshold
          </label>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              min="1"
              max="1000"
              value={settings.lowStockThreshold}
              onChange={(e) => setSettings(prev => ({ ...prev, lowStockThreshold: parseInt(e.target.value) || 10 }))}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            />
            <span className="text-sm text-gray-600 dark:text-slate-400">units remaining</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Get notified when products fall below this quantity</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Expiry Alert Threshold
          </label>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              min="1"
              max="365"
              value={settings.expiryDaysThreshold}
              onChange={(e) => setSettings(prev => ({ ...prev, expiryDaysThreshold: parseInt(e.target.value) || 7 }))}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            />
            <span className="text-sm text-gray-600 dark:text-slate-400">days before expiry</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Get notified when products are about to expire</p>
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2"
        >
          <Save className="h-4 w-4" />
          <span>Save Notification Settings</span>
        </button>
      </div>
    </div>
  );
};

// App Preferences Section
const AppPreferencesSection = () => {
  const { state, dispatch, toggleDarkMode } = useApp();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
      <div className="flex items-center space-x-3 mb-6">
        <SettingsIcon className="h-6 w-6 text-purple-600 dark:text-violet-400" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">App Preferences</h2>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Voice Assistant</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">Enable voice commands for hands-free operation</p>
          </div>
          <button
            onClick={() => dispatch({
              type: ActionTypes.SET_VOICE_ASSISTANT_ENABLED,
              payload: !state.voiceAssistantEnabled
            })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${state.voiceAssistantEnabled ? 'bg-purple-600' : 'bg-gray-200 dark:bg-slate-700'
              }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${state.voiceAssistantEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Dark Mode</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">Switch to dark theme</p>
          </div>
          <button
            onClick={toggleDarkMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${state.darkMode ? 'bg-purple-600' : 'bg-gray-200 dark:bg-slate-700'
              }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${state.darkMode ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Language</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">Choose your preferred language</p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                const newLang = 'en';
                // Update localStorage
                const currentSettings = JSON.parse(localStorage.getItem('settings') || '{}');
                currentSettings.currentLanguage = newLang;
                localStorage.setItem('settings', JSON.stringify(currentSettings));

                // Dispatch action
                dispatch({ type: ActionTypes.SET_LANGUAGE, payload: newLang });

                if (window.showToast) window.showToast('Language set to English', 'success');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${state.currentLanguage === 'en'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600'
                }`}
            >
              English
            </button>
            <button
              onClick={() => {
                const newLang = 'hi';
                // Update localStorage
                const currentSettings = JSON.parse(localStorage.getItem('settings') || '{}');
                currentSettings.currentLanguage = newLang;
                localStorage.setItem('settings', JSON.stringify(currentSettings));

                // Dispatch action
                dispatch({ type: ActionTypes.SET_LANGUAGE, payload: newLang });

                if (window.showToast) window.showToast('भाषा हिंदी सेट की गई', 'success');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${state.currentLanguage === 'hi'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600'
                }`}
            >
              हिंदी (Hindi)
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Currency Display Format</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">Choose how amounts are displayed</p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                const newFormat = 'plain';
                // Update localStorage
                const currentSettings = JSON.parse(localStorage.getItem('settings') || '{}');
                currentSettings.currencyFormat = newFormat;
                localStorage.setItem('settings', JSON.stringify(currentSettings));

                // Dispatch action to update state
                dispatch({ type: ActionTypes.SET_CURRENCY_FORMAT, payload: newFormat });

                // Force re-render by updating a dummy state
                window.dispatchEvent(new Event('currencyFormatChanged'));

                if (window.showToast) window.showToast('Currency format updated to Plain', 'success');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${state.currencyFormat === 'plain'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600'
                }`}
            >
              Plain (₹1,000.00)
            </button>
            <button
              onClick={() => {
                const newFormat = 'compact';
                // Update localStorage
                const currentSettings = JSON.parse(localStorage.getItem('settings') || '{}');
                currentSettings.currencyFormat = newFormat;
                localStorage.setItem('settings', JSON.stringify(currentSettings));

                // Dispatch action to update state
                dispatch({ type: ActionTypes.SET_CURRENCY_FORMAT, payload: newFormat });

                // Force re-render by updating a dummy state
                window.dispatchEvent(new Event('currencyFormatChanged'));

                if (window.showToast) window.showToast('Currency format updated to K Format', 'success');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${state.currencyFormat === 'compact'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600'
                }`}
            >
              K Format (₹1K)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

// Account Security Section
const AccountSection = ({ user }) => {
  const { dispatch, logoutWithDataProtection } = useApp();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [unsyncedDataInfo, setUnsyncedDataInfo] = useState(null);
  const [isCheckingSync, setIsCheckingSync] = useState(false);

  const handleLogoutClick = async () => {
    setIsCheckingSync(true);

    // Check for unsynced data
    const result = await logoutWithDataProtection();

    setIsCheckingSync(false);

    if (result.success) {
      // No unsynced data, proceed with logout
      await performLogout();
    } else if (result.hasUnsyncedData) {
      // Log technical details to console for developers
      console.warn('⚠️ Logout blocked - Unsynced data detected');
      console.log('📊 Unsynced data breakdown:', result.unsyncedData);
      console.log('🔍 Sync block reason:', result.syncBlockReason);
      console.log('💬 User message:', result.syncBlockMessage);
      if (result.technicalDetails) {
        console.log('🛠️ Technical details:', result.technicalDetails);
      }

      // Show detailed unsynced data modal
      setUnsyncedDataInfo(result);
      setShowLogoutModal(false); // Close confirmation modal
    }
  };

  const performLogout = async () => {
    try {
      console.log('🚪 Starting complete logout and cleanup...');

      // Step 1: Clear ALL localStorage (complete wipe)
      console.log('🗑️ Clearing all localStorage...');
      localStorage.clear();

      // Step 2: Delete entire IndexedDB database
      console.log('🗑️ Deleting IndexedDB database...');
      try {
        // Close any open connections first
        const dbName = 'ERP_DB';
        const deleteRequest = indexedDB.deleteDatabase(dbName);

        await new Promise((resolve, reject) => {
          deleteRequest.onsuccess = () => {
            console.log('✅ IndexedDB deleted successfully');
            resolve();
          };
          deleteRequest.onerror = (event) => {
            console.error('❌ Error deleting IndexedDB:', event);
            resolve(); // Continue even if delete fails
          };
          deleteRequest.onblocked = () => {
            console.warn('⚠️ IndexedDB delete blocked - may have open connections');
            // Force close and retry after a short delay
            setTimeout(() => resolve(), 500);
          };
        });
      } catch (dbError) {
        console.error('❌ IndexedDB deletion error:', dbError);
        // Continue with logout even if DB deletion fails
      }

      // Step 3: Sign out from Firebase
      console.log('🔐 Signing out from Firebase...');
      await signOut(auth);

      // Step 4: Dispatch logout action to clear app state
      console.log('📤 Dispatching logout action...');
      dispatch({ type: ActionTypes.LOGOUT });

      // Step 5: Show success message
      if (window.showToast) {
        window.showToast('Logged out successfully. All local data cleared.', 'info');
      }

      // Step 6: Redirect to login page
      console.log('🔄 Redirecting to login...');
      window.location.href = '/login';

    } catch (error) {
      console.error('❌ Error during logout:', error);
      if (window.showToast) {
        window.showToast('Error logging out', 'error');
      }
    }
  };

  const handleForceLogout = async () => {
    // User confirmed they want to logout despite unsynced data
    setUnsyncedDataInfo(null);
    await performLogout();
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
        <div className="flex items-center space-x-3 mb-6">
          <Shield className="h-6 w-6 text-red-600 dark:text-red-500" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Account & Security</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-transparent dark:border-slate-600">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Email</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">{user.email || 'Not set'}</p>
            </div>
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-emerald-500" />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-transparent dark:border-slate-600">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Account Status</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">Active seller account</p>
            </div>
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-emerald-500" />
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-slate-700">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-800 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-slate-700">
            <div className="text-center mb-6">
              <AlertTriangle className="h-12 w-12 text-red-600 dark:text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Confirm Logout</h3>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Are you sure you want to logout? You'll need to sign in again to access your account.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                disabled={isCheckingSync}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleLogoutClick}
                disabled={isCheckingSync}
                className="flex-1 px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCheckingSync ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Checking...</span>
                  </>
                ) : (
                  'Logout'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsynced Data Warning Modal */}
      {unsyncedDataInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-red-200 dark:border-red-900/50">
            {/* Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 dark:from-red-700 dark:to-red-800 p-6 text-white">
              <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="h-8 w-8" />
                <h3 className="text-2xl font-bold">Warning: Unsynced Data</h3>
              </div>
              <p className="text-red-100 text-sm">
                You have {unsyncedDataInfo.totalUnsynced} unsaved {unsyncedDataInfo.totalUnsynced === 1 ? 'item' : 'items'} that will be lost if you logout now
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Unsynced Items Breakdown */}
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <Database className="h-5 w-5 text-red-600 dark:text-red-500" />
                  Unsynced Data Breakdown
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(unsyncedDataInfo.unsyncedData || {}).map(([key, count]) => {
                    if (count === 0) return null;
                    const labels = {
                      products: 'Products',
                      customers: 'Customers',
                      orders: 'Orders',
                      transactions: 'Transactions',
                      purchaseOrders: 'Purchase Orders',
                      productBatches: 'Product Batches',
                      expenses: 'Expenses'
                    };
                    return (
                      <div key={key} className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-3">
                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">{count}</div>
                        <div className="text-xs text-red-700 dark:text-red-300">{labels[key] || key}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sync Issue Reason */}
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg p-4">
                <h4 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-2 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Why isn't my data syncing?
                </h4>
                <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-3">
                  {unsyncedDataInfo.syncBlockMessage}
                </p>
              </div>

              {/* Recommendations */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 dark:text-blue-200 mb-2 flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Recommended Actions
                </h4>
                <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
                  {unsyncedDataInfo.syncBlockReason === 'offline' && (
                    <>
                      <li>Check your internet connection</li>
                      <li>Wait for connection to restore</li>
                      <li>Try refreshing the page once online</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'syncing' && (
                    <>
                      <li>Wait for the current sync to complete</li>
                      <li>Check the sync status indicator</li>
                      <li>Try logging out again in a few moments</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'plan_expired' && (
                    <>
                      <li>Upgrade your subscription plan to enable sync</li>
                      <li>Go to Settings → Upgrade Plan</li>
                      <li>Once upgraded, data will automatically sync</li>
                      <li>Contact support if you need assistance with renewal</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'auth_error' && (
                    <>
                      <li>Refresh the page to restore your session</li>
                      <li>If issue persists, logout and login again</li>
                      <li>Clear browser cache and cookies if needed</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'sync_error' && (
                    <>
                      <li>Check browser console for detailed error messages</li>
                      <li>Refresh the page to retry sync</li>
                      <li>Verify server is accessible</li>
                      <li>Contact support with error details if issue persists</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'sync_failed' && (
                    <>
                      <li>Refresh the page to retry sync</li>
                      <li>Check if the server is accessible</li>
                      <li>Contact support if the issue persists</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'error' && (
                    <>
                      <li>Refresh the page</li>
                      <li>Check browser console for errors</li>
                      <li>Contact support if needed</li>
                    </>
                  )}
                  {unsyncedDataInfo.syncBlockReason === 'unknown' && (
                    <>
                      <li>Refresh the page</li>
                      <li>Check your internet connection</li>
                      <li>Wait a few moments and try again</li>
                      <li>Contact support if the issue persists</li>
                    </>
                  )}
                </ul>
              </div>

              {/* Warning Message */}
              <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
                <p className="text-sm text-red-900 dark:text-red-200 font-semibold mb-2">
                  ⚠️ Data Loss Warning
                </p>
                <p className="text-sm text-red-800 dark:text-red-300">
                  If you force logout now, all unsynced data will be permanently lost and cannot be recovered. We strongly recommend waiting for the sync to complete or resolving the sync issue first.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="p-6 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700 flex gap-3">
              <button
                onClick={() => setUnsyncedDataInfo(null)}
                className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors font-semibold"
              >
                Cancel Logout
              </button>
              <button
                onClick={handleForceLogout}
                className="flex-1 px-4 py-3 bg-red-600 dark:bg-red-700 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-800 transition-colors font-semibold flex items-center justify-center gap-2"
              >
                <AlertTriangle className="h-4 w-4" />
                Force Logout Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// App Version Section
const AppVersionSection = () => {
  const { updateAvailable, update } = usePWAUpdate();
  const [swStatus, setSwStatus] = useState('Checking...');

  useEffect(() => {
    // Check service worker status
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        const controller = navigator.serviceWorker.controller;
        const waiting = registration.waiting;
        const installing = registration.installing;

        let status = 'Active';
        if (waiting) status += ' (Update waiting)';
        if (installing) status += ' (Installing...)';
        if (!controller) status = 'Not controlled';

        setSwStatus(status);
      }).catch(() => {
        setSwStatus('Error');
      });
    } else {
      setSwStatus('Not supported');
    }
  }, []);

  const checkForUpdates = async () => {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        setSwStatus('Update check completed');
        setTimeout(() => window.location.reload(), 1000);
      } catch (error) {
        setSwStatus('Update check failed');
      }
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 transition-colors duration-300">
      <div className="text-center">
        <div className="flex items-center justify-center space-x-2 mb-2">
          <Store className="h-5 w-5 text-blue-600 dark:text-indigo-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{APP_NAME}</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400">Version {APP_VERSION}</p>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Service Worker: {swStatus}</p>

        {updateAvailable && (
          <button
            onClick={update}
            className="mt-3 px-4 py-2 bg-blue-600 dark:bg-indigo-600 text-white text-sm rounded-lg hover:bg-blue-700 dark:hover:bg-indigo-700 transition-colors shadow-lg shadow-blue-500/20"
          >
            Update Available - Click to Update
          </button>
        )}

        <button
          onClick={checkForUpdates}
          className="mt-2 px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 text-xs rounded hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors border border-transparent dark:border-slate-600"
        >
          Check for Updates
        </button>

        <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">© 2024 Grocery ERP. All rights reserved.</p>
      </div>
    </div>
  );
};

export default Settings;