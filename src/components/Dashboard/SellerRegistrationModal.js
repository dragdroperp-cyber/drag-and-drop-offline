import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { updateSellerProfile } from '../../utils/api';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { indianCities } from '../../utils/indianCities';
import {
  X, LogOut, Store, Briefcase, MapPin, Phone, Building2, Navigation, CreditCard, FileText, User, ArrowRight,
  Users, Package, Wallet, TrendingUp, Truck, AlertTriangle, Clock, ChevronRight, Search, Menu, Bell, Loader2,
  MessageCircle, ChevronDown, Check
} from 'lucide-react';

const businessTypes = ['Retail', 'Wholesale', 'Service', 'Manufacturing', 'E-commerce', 'Other'];
const genders = ['Male', 'Female', 'Other', 'Prefer not to say'];
const indianStates = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

const logoSrc = `${process.env.PUBLIC_URL || ''}/assets/inventory-studio-logo-removebg.png`;

const InputWrapper = ({ label, error, children, icon: Icon, required }) => (
  <div className="space-y-1.5 mb-5 group">
    <div className="flex justify-between items-center px-0.5">
      <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.1em]">{label} {required && <span className="text-rose-500">*</span>}</label>
      {error && (
        <span className="text-[10px] text-rose-500 font-bold flex items-center gap-1 animate-pulse">
          <AlertTriangle size={10} />
          {error}
        </span>
      )}
    </div>
    <div className="relative">
      <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 ${error ? 'text-rose-500' : 'text-slate-400 group-focus-within:text-indigo-600'}`}>
        <Icon size={18} />
      </div>
      {React.cloneElement(children, {
        className: `block w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 transition-all duration-200 rounded-2xl text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium outline-none ${error
          ? 'border-rose-100 bg-rose-50/30'
          : 'border-transparent hover:bg-slate-100 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/5'
          }`
      })}
    </div>
  </div>
);

const CustomSelect = ({ label, value, onChange, options, placeholder, icon: Icon, required, error }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`space-y-1.5 mb-5 group relative ${isOpen ? 'z-[10002]' : 'z-10'}`} ref={containerRef}>
      <div className="flex justify-between items-center px-0.5">
        <label className="text-[11px] font-black text-slate-400 uppercase tracking-[0.1em]">{label} {required && <span className="text-rose-500">*</span>}</label>
        {error && (
          <span className="text-[10px] text-rose-500 font-bold flex items-center gap-1 animate-pulse">
            <AlertTriangle size={10} />
            {error}
          </span>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`group flex items-center w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 transition-all duration-200 rounded-2xl text-sm font-bold shadow-sm text-left outline-none ${error ? 'border-rose-100 bg-rose-50/30 text-rose-900' : (isOpen ? 'border-indigo-600 bg-white ring-4 ring-indigo-600/5 shadow-indigo-100/10' : 'border-transparent hover:bg-slate-100 text-slate-900')
            }`}
        >
          <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200 ${error ? 'text-rose-500' : (isOpen ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-900')}`}>
            <Icon size={18} strokeWidth={2.5} />
          </div>
          <span className={`truncate mr-4 ${value ? 'text-slate-900' : 'text-slate-400 font-medium'}`}>
            {value || placeholder}
          </span>
          <ChevronDown size={18} className={`ml-auto shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-600' : 'text-slate-400'}`} strokeWidth={2.5} />
        </button>

        {isOpen && (
          <div className="absolute z-[10003] top-full mt-2 w-full bg-white border border-slate-100 rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.15)] py-2 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300 overflow-hidden max-h-[300px] overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange({ target: { value: opt } });
                  setIsOpen(false);
                }}
                className={`w-full px-5 py-3.5 text-left text-sm font-bold transition-all flex items-center justify-between group/item ${value === opt ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50 hover:pl-6'
                  }`}
              >
                {opt}
                {value === opt && (
                  <div className="h-5 w-5 rounded-full bg-indigo-600 flex items-center justify-center animate-in zoom-in duration-300">
                    <Check size={12} className="text-white" strokeWidth={3} />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- PREVIEW DASHBOARD COMPONENTS ---

const STAT_THEMES = {
  primary: { background: 'rgba(47, 60, 126, 0.12)', color: '#2F3C7E', border: 'rgba(47, 60, 126, 0.28)' },
  teal: { background: 'rgba(45, 212, 191, 0.14)', color: '#0F766E', border: 'rgba(15, 118, 110, 0.24)' },
  amber: { background: 'rgba(244, 162, 89, 0.16)', color: '#C2410C', border: 'rgba(194, 65, 12, 0.24)' },
  rose: { background: 'rgba(251, 113, 133, 0.16)', color: '#BE123C', border: 'rgba(190, 18, 60, 0.24)' },
  sky: { background: 'rgba(56, 189, 248, 0.18)', color: '#0369A1', border: 'rgba(3, 105, 161, 0.24)' },
  emerald: { background: 'rgba(74, 222, 128, 0.14)', color: '#047857', border: 'rgba(4, 120, 87, 0.22)' },
  purple: { background: 'rgba(196, 181, 253, 0.2)', color: '#6D28D9', border: 'rgba(109, 40, 217, 0.24)' },
  slate: { background: 'rgba(148, 163, 184, 0.16)', color: '#1E293B', border: 'rgba(30, 41, 59, 0.2)' }
};

const PreviewStatCard = ({ name, value, icon: Icon, description, secondaryValue, themeKey }) => {
  const theme = STAT_THEMES[themeKey] || STAT_THEMES.slate;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-2.5" style={{ backgroundColor: theme.background, color: theme.color, borderColor: theme.border }}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 mb-1">{name}</p>
            <p className={`text-2xl font-semibold whitespace-nowrap ${name.includes('Sales') || name.includes('Profit') ? 'text-emerald-600' : 'text-slate-900'
              }`}>
              {value}
            </p>
            {secondaryValue && (
              <p className="text-xs font-medium text-slate-400 mt-1">
                Value: {secondaryValue}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="text-xs text-slate-500">{description}</div>
    </div>
  );
};

const PreviewDashboard = ({ mode = 'desktop' }) => {
  const isMobile = mode === 'mobile';

  // Hardcoded "Success" Data
  const stats = [
    { name: 'Total Customers', value: '1,248', icon: Users, description: 'Active Customers', theme: 'primary' },
    { name: 'Total Products', value: '856', icon: Package, description: 'Items in Inventory', theme: 'teal' },
    { name: 'Total Sales', value: '₹42.5L', icon: Wallet, description: 'Sales - Last 30 Days', theme: 'amber' },
    { name: 'Net Profit', value: '₹8.2L', icon: TrendingUp, description: 'Net Profit - Last 30 Days', theme: 'emerald' },
    { name: 'Balance Due', value: '₹1.4L', icon: CreditCard, description: 'Outstanding Payments', theme: 'rose' },
    { name: 'Purchase Orders', value: '12', icon: Truck, description: 'Last 30 Days', theme: 'slate', secondaryValue: '₹2.1L' }
  ];

  const displayStats = isMobile ? stats.slice(0, 4) : stats;

  const ContentArea = () => (
    <div className={`bg-slate-50 w-full h-full font-sans ${isMobile ? 'p-3' : 'p-6'} overflow-hidden flex flex-col`}>
      {/* Header Section */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 shrink-0">
        <h1 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-bold text-slate-900`}>Business Overview</h1>

        {/* Time Range Selector Mimic */}
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm w-fit">
          {['Today', '7d', '30d', 'Custom'].map((t, i) => (
            <span key={t} className={`px-3 py-1 text-xs font-medium rounded-full ${i === 2 ? 'bg-slate-900 text-white shadow' : 'text-slate-600'}`}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col gap-6">
        {/* Stats Grid */}
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-3 gap-6'} shrink-0`}>
          {displayStats.map((s, i) => (
            <PreviewStatCard key={i} themeKey={s.theme} {...s} />
          ))}
        </div>

        {/* Charts Section Mimic */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 flex-1">
          {/* Chart 1: Revenue */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="font-semibold text-slate-800">Revenue Analytics</h3>
              <span className="text-xs text-slate-400">Monthly</span>
            </div>
            <div className="flex-1 flex items-end justify-between gap-2 px-2 pb-2">
              {[40, 65, 45, 80, 55, 70, 45, 90, 60, 75, 50, 85].map((h, i) => (
                <div key={i} className="w-full bg-indigo-50 rounded-t-sm relative group h-full flex items-end">
                  <div className="w-full bg-indigo-500 rounded-t-sm transition-all duration-500" style={{ height: `${h}%` }}></div>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1 text-xs text-slate-400 px-2 shrink-0">
              <span>Jan</span><span>Dec</span>
            </div>
          </div>

          {/* Chart 2: Recent Activity / List */}
          {!isMobile && (
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
              <h3 className="font-semibold text-slate-800 mb-4 shrink-0">Recent Transactions</h3>
              <div className="space-y-3 overflow-hidden text-ellipsis">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i % 2 === 0 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {i % 2 === 0 ? 'S' : 'R'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Order #{2400 + i}</p>
                        <p className="text-xs text-slate-400">Just now</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-800">₹{1200 + i * 50}</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return <ContentArea />;
  }

  // DESKTOP LAYOUT WITH SIDEBAR (Matched to Sidebar.js)
  return (
    <div className="flex w-full h-full bg-slate-50">
      {/* Sidebar */}
      <div className="w-64 bg-white flex flex-col shrink-0 border-r border-slate-200 h-full">
        {/* Logo Area */}
        <div className="h-20 flex items-center px-5 border-b border-slate-100 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
              {/* Placeholder for Logo */}
              <div className="w-full h-full bg-slate-200"></div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Inventory Studio</p>
              <h1 className="text-sm font-bold text-slate-800">Inventory Studio</h1>
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <div className="px-3 space-y-1 flex-1 overflow-y-auto py-2">
          {[
            { icon: Store, label: 'Dashboard', active: true },
            { icon: Users, label: 'Customers' },
            { icon: Package, label: 'Products' },
            { icon: CreditCard, label: 'Billing' },
            { icon: Clock, label: 'Sales History' },
            { icon: ChevronRight, label: 'Refunds' },
            { icon: Truck, label: 'Purchase Orders' },
            { icon: Wallet, label: 'Financial' },
            { icon: TrendingUp, label: 'Reports' },
          ].map((item, i) => (
            <div key={i} className={`flex items-center px-4 py-2.5 rounded-xl transition-all ${item.active
              ? 'bg-gradient-to-r from-slate-900 to-slate-900 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-50'
              }`}>
              <item.icon className={`h-4 w-4 mr-3 ${item.active ? 'text-white' : 'text-slate-400'}`} />
              <span className="font-medium text-xs tracking-wide">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Settings Link at Bottom */}
        <div className="p-3 mt-auto">
          <div className="flex items-center px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-50 transition-all">
            <Menu className="h-4 w-4 mr-3 text-slate-400" /> {/* Settings Icon placeholder */}
            <span className="font-medium text-xs tracking-wide">Settings</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full overflow-hidden relative">
        <ContentArea />
      </div>
    </div>
  );
};

const SellerRegistrationModal = ({ isOpen, onClose }) => {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const currentUser = state.currentUser || {};
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
    gender: currentUser.gender || '',
    whatsappLink: currentUser.whatsappLink || ''
  }), [currentUser]);

  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState({ text: '', type: '' });
  const [showUpiInfo, setShowUpiInfo] = useState(false);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      shopName: currentUser.shopName || prev.shopName,
      businessType: currentUser.businessType || prev.businessType,
      shopAddress: currentUser.shopAddress || prev.shopAddress,
      phoneNumber: currentUser.phoneNumber || prev.phoneNumber,
      city: currentUser.city || prev.city,
      state: currentUser.state || prev.state,
      pincode: currentUser.pincode || prev.pincode,
      upiId: currentUser.upiId || prev.upiId,
      gstNumber: currentUser.gstNumber || prev.gstNumber,
      gender: currentUser.gender || prev.gender,
      whatsappLink: currentUser.whatsappLink || prev.whatsappLink
    }));
  }, [currentUser]);

  // Ensure the auto-fetched city is available in the dropdown
  const cityOptions = useMemo(() => {
    if (form.city && !indianCities.includes(form.city)) {
      return [...indianCities, form.city].sort();
    }
    return indianCities;
  }, [form.city]);

  const handleChange = (field) => (event) => {
    let value = event.target.value;
    if (field === 'phoneNumber') value = value.replace(/\D/g, '').slice(0, 10);
    if (field === 'gstNumber' && value) value = sanitizeGSTNumber(value);

    // Auto-fill location based on Pincode
    if (field === 'pincode') {
      value = value.replace(/\D/g, '').slice(0, 6);
      if (value.length === 6) {
        fetch(`https://api.postalpincode.in/pincode/${value}`)
          .then(res => res.json())
          .then(data => {
            if (data && data[0]?.Status === 'Success') {
              const { District, State } = data[0].PostOffice[0];
              setForm(prev => ({ ...prev, city: District, state: State }));
              setErrors(prev => ({ ...prev, city: '', state: '' }));
            }
          })
          .catch(console.error);
      }
    }

    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = () => {
    const nextErrors = {};
    const requiredFields = ['shopName', 'businessType', 'shopAddress', 'phoneNumber', 'city', 'state', 'pincode', 'upiId', 'gender'];
    requiredFields.forEach((field) => { if (!form[field] || !form[field].toString().trim()) nextErrors[field] = 'Required'; });
    if (form.shopAddress && form.shopAddress.trim().length < 5) nextErrors.shopAddress = 'Address must be at least 5 characters long';
    const sanitizedPhone = sanitizeMobileNumber(form.phoneNumber);
    if (!sanitizedPhone || !isValidMobileNumber(sanitizedPhone)) nextErrors.phoneNumber = 'Enter a valid 10-digit mobile number';
    const sanitizedPincode = (form.pincode || '').toString().replace(/\D/g, '');
    if (sanitizedPincode.length !== 6) nextErrors.pincode = 'Enter a valid 6-digit pincode';
    const upiPattern = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;
    if (!upiPattern.test(form.upiId.trim())) nextErrors.upiId = 'Enter a valid UPI ID (example: name@bank)';
    if (form.gstNumber && form.gstNumber.trim()) {
      const sanitizedGST = sanitizeGSTNumber(form.gstNumber);
      if (!isValidGSTNumber(sanitizedGST)) nextErrors.gstNumber = 'Enter a valid 15-character GSTIN';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('auth');
      const userId = state.currentUser?.email || state.currentUser?.uid || state.currentUser?._id;
      if (userId) {
        ['customers_', 'products_', 'transactions_', 'purchaseOrders_', 'activities_', 'settings_'].forEach(prefix => localStorage.removeItem(`${prefix}${userId}`));
      }
      Object.keys(localStorage).filter(key => key.startsWith('sync_') || key.startsWith('firebase')).forEach(key => localStorage.removeItem(key));
      dispatch({ type: ActionTypes.LOGOUT });
      onClose();
      navigate('/login');
      if (window.showToast) window.showToast('Logged out successfully.', 'info');
    } catch (error) {
      if (window.showToast) window.showToast('Error logging out.', 'error');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormMessage({ text: '', type: '' });
    if (isSubmitting) return;
    if (!validate()) {
      const msg = 'Please fix the highlighted fields.';
      setFormMessage({ text: msg, type: 'warning' });
      if (window.showToast) window.showToast(msg, 'warning');
      return;
    }
    setIsSubmitting(true);
    const sanitizedPhone = sanitizeMobileNumber(form.phoneNumber);
    const sanitizedPincode = (form.pincode || '').toString().replace(/\D/g, '').slice(0, 6);
    const sanitizedGST = form.gstNumber ? sanitizeGSTNumber(form.gstNumber) : null;
    const payload = { ...form, phoneNumber: sanitizedPhone, pincode: sanitizedPincode, gstNumber: sanitizedGST, shopName: form.shopName.trim(), businessType: form.businessType.trim(), shopAddress: form.shopAddress.trim(), city: form.city.trim(), state: form.state.trim(), upiId: form.upiId.trim(), gender: form.gender.trim() };
    try {
      const response = await updateSellerProfile(payload);
      if (!response.success) {
        // Handle backend validation errors with details
        if (response.error && typeof response.error === 'object' && response.error.details) {
          const backendErrors = {};
          response.error.details.forEach(detail => {
            if (detail.field) backendErrors[detail.field] = detail.message;
          });
          if (Object.keys(backendErrors).length > 0) {
            setErrors(prev => ({ ...prev, ...backendErrors }));
            const msg = 'Please fix the highlighted fields.';
            setFormMessage({ text: msg, type: 'warning' });
            if (window.showToast) window.showToast(msg, 'warning');
            return;
          }
        }
        const errorMsg = response.error || response.data?.message || 'Failed to complete registration';
        setFormMessage({ text: errorMsg, type: 'error' });
        throw new Error(errorMsg);
      }

      const updatedSeller = response.data?.data?.seller || response.data?.seller || {};
      dispatch({ type: ActionTypes.UPDATE_USER, payload: { ...currentUser, ...updatedSeller, profileCompleted: true } });
      if (payload.shopName) dispatch({ type: ActionTypes.SET_STORE_NAME, payload: payload.shopName });
      if (payload.upiId) dispatch({ type: ActionTypes.SET_UPI_ID, payload: payload.upiId });
      const successMsg = 'Profile completed successfully!';
      setFormMessage({ text: successMsg, type: 'success' });
      if (window.showToast) window.showToast(successMsg, 'success');
      onClose();
    } catch (error) {
      // Handle duplicate mobile number error specifically
      if (error.message && error.message.includes('mobile number is already registered')) {
        const msg = 'This mobile number is already in use.';
        setErrors(prev => ({ ...prev, phoneNumber: msg }));
        setFormMessage({ text: 'Mobile number already registered.', type: 'error' });
        if (window.showToast) window.showToast('Mobile number already registered.', 'error');
        return;
      }

      // Check if error object has details (from api.js throw)
      if (error.details && Array.isArray(error.details)) {
        const backendErrors = {};
        error.details.forEach(detail => {
          if (detail.field) backendErrors[detail.field] = detail.message;
        });
        if (Object.keys(backendErrors).length > 0) {
          setErrors(prev => ({ ...prev, ...backendErrors }));
          const msg = 'Please fix the highlighted fields.';
          setFormMessage({ text: msg, type: 'warning' });
          if (window.showToast) window.showToast(msg, 'warning');
          return;
        }
      }

      const errorMsg = error.message || 'Failed to save details.';
      setFormMessage({ text: errorMsg, type: 'error' });
      if (window.showToast) window.showToast(errorMsg, 'error');
    } finally { setIsSubmitting(false); }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col overflow-hidden font-sans m-0 p-0 animate-fadeIn">
      {/* Header - Fixed */}
      <div className="flex items-center justify-between p-6 sm:px-12 border-b border-slate-50 shrink-0">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 flex items-center justify-center overflow-hidden">
            <img src={logoSrc} alt="IS" className="h-full w-full object-contain" />
          </div>
          <span className="text-xl font-black text-slate-900 tracking-tight">Inventory Studio</span>
        </div>
        <button
          onClick={handleLogout}
          className="group flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all duration-300"
        >
          <LogOut size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Sign Out
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 py-12 sm:px-12">
          <div className="mb-12 text-center sm:text-left">
            <h1 className="text-4xl sm:text-5xl font-black text-slate-900 mb-2 tracking-tight">Complete Profile</h1>
            <p className="text-slate-500 font-medium text-lg">Please provide your business details to get started.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-16">
            {/* Business Info Section */}
            <div className="relative">
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Store size={20} strokeWidth={2.5} />
                </div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em]">Business Info</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <InputWrapper label="Shop Name" required error={errors.shopName} icon={Store}><input type="text" value={form.shopName} onChange={handleChange('shopName')} placeholder="e.g. Acme Superstore" maxLength={50} /></InputWrapper>
                <CustomSelect
                  label="Business Type"
                  required
                  error={errors.businessType}
                  icon={Briefcase}
                  value={form.businessType}
                  onChange={handleChange('businessType')}
                  options={businessTypes}
                  placeholder="Select Type"
                />
              </div>
            </div>

            {/* Location Section */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <MapPin size={20} strokeWidth={2.5} />
                </div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em]">Location Details</h3>
              </div>
              <div className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <InputWrapper label="Contact" required error={errors.phoneNumber} icon={Phone}><input type="tel" value={form.phoneNumber} onChange={handleChange('phoneNumber')} placeholder="9876543210" maxLength={10} /></InputWrapper>
                  <InputWrapper label="Pincode" required error={errors.pincode} icon={Navigation}><input type="text" value={form.pincode} onChange={handleChange('pincode')} placeholder="6-digit PIN" maxLength={6} /></InputWrapper>
                </div>
                <InputWrapper label="Address" required error={errors.shopAddress} icon={MapPin}><input type="text" value={form.shopAddress} onChange={handleChange('shopAddress')} placeholder="Street, Area, Landmark" maxLength={200} /></InputWrapper>

                {form.pincode && form.pincode.length === 6 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 animate-fadeIn">
                    <CustomSelect
                      label="City"
                      required
                      error={errors.city}
                      icon={Building2}
                      value={form.city}
                      onChange={handleChange('city')}
                      options={cityOptions}
                      placeholder="Select City"
                    />
                    <CustomSelect
                      label="State"
                      required
                      error={errors.state}
                      icon={Navigation}
                      value={form.state}
                      onChange={handleChange('state')}
                      options={indianStates}
                      placeholder="Select State"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Financials Section */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Wallet size={20} strokeWidth={2.5} />
                </div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em]">Legal & Payments</h3>
              </div>
              <div className="space-y-8">
                <div className="relative">
                  <div className="flex justify-between items-center mb-1">
                    <button
                      type="button"
                      onClick={() => setShowUpiInfo(!showUpiInfo)}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full transition-colors ml-auto flex items-center gap-1"
                    >
                      {showUpiInfo ? 'Close' : 'Why UPI?'}
                    </button>
                  </div>
                  {showUpiInfo && (
                    <div className="mb-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100 animate-in fade-in slide-in-from-top-2 duration-300">
                      <p className="text-xs font-bold text-indigo-900 leading-relaxed">
                        UPI is used to generate dynamic QR codes for you, which helps collect payments from customers directly into your bank account.
                      </p>
                    </div>
                  )}
                  <InputWrapper label="Merchant UPI ID" required error={errors.upiId} icon={CreditCard}><input type="text" value={form.upiId} onChange={handleChange('upiId')} placeholder="name@bank" maxLength={50} /></InputWrapper>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <CustomSelect
                    label="Gender"
                    required
                    error={errors.gender}
                    icon={User}
                    value={form.gender}
                    onChange={handleChange('gender')}
                    options={genders}
                    placeholder="Select Gender"
                  />
                  <InputWrapper label="GSTIN (Opt)" error={errors.gstNumber} icon={FileText}><input type="text" value={form.gstNumber} onChange={handleChange('gstNumber')} placeholder="15-digit GST" maxLength={15} /></InputWrapper>
                </div>
                <InputWrapper label="WhatsApp Group Link (Optional)" icon={MessageCircle}><input type="text" value={form.whatsappLink} onChange={handleChange('whatsappLink')} placeholder="https://chat.whatsapp.com/..." /></InputWrapper>
              </div>
            </div>

            {/* Submit Area */}
            <div className="pt-12 pb-24">
              <button
                type="submit"
                disabled={isSubmitting}
                className="group relative w-full sm:w-auto sm:min-w-[300px] py-5 px-12 rounded-2xl font-black text-base text-white bg-slate-900 hover:bg-slate-800 transition-all duration-300 active:scale-[0.98] shadow-2xl shadow-slate-900/20 flex items-center justify-center gap-4 disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden mx-auto"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span className="tracking-tight text-white/90 font-bold uppercase tracking-widest text-xs">Processing...</span>
                  </>
                ) : (
                  <>
                    <span className="tracking-tight text-lg">Activate Account</span>
                    <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              {formMessage.text && (
                <div className={`mt-8 p-4 rounded-xl text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300 max-w-md mx-auto ${formMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                  formMessage.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                    'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}>
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center text-white shrink-0 ${formMessage.type === 'success' ? 'bg-emerald-500' :
                    formMessage.type === 'warning' ? 'bg-amber-500' :
                      'bg-rose-500'
                    }`}>
                    {formMessage.type === 'success' ? '✓' : '!'}
                  </div>
                  {formMessage.text}
                </div>
              )}

              <p className="mt-12 text-[10px] text-slate-400 leading-relaxed text-center font-medium">
                By continuing, you agree to our <br />
                <Link to="/terms-conditions" className="text-blue-600 hover:text-blue-700 font-bold underline transition-all">Terms</Link> & <Link to="/privacy-policy" className="text-blue-600 hover:text-blue-700 font-bold underline transition-all">Privacy Policy</Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );

};

export default SellerRegistrationModal;
