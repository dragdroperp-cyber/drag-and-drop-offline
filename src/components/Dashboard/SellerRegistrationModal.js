import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes } from '../../context/AppContext';
import { updateSellerProfile } from '../../utils/api';
import { sanitizeMobileNumber, isValidMobileNumber, sanitizeGSTNumber, isValidGSTNumber } from '../../utils/validation';
import { indianCities } from '../../utils/indianCities';
import {
  X, LogOut, Store, Briefcase, MapPin, Phone, Building2, Navigation, CreditCard, FileText, User, ArrowRight,
  Users, Package, Wallet, TrendingUp, Truck, AlertTriangle, Clock, ChevronRight, Search, Menu, Bell, Loader2,
  MessageCircle
} from 'lucide-react';

const businessTypes = ['Retail', 'Wholesale', 'Service', 'Manufacturing', 'E-commerce', 'Other'];
const genders = ['Male', 'Female', 'Other', 'Prefer not to say'];
const indianStates = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

const InputWrapper = ({ label, error, children, icon: Icon, required }) => (
  <div className="space-y-1.5 mb-4">
    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider px-0.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <div className="relative">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <Icon className="h-4 w-4" />
      </div>
      {React.cloneElement(children, {
        className: `block w-full pl-11 pr-4 py-3 bg-white border ${error ? 'border-red-500 ring-4 ring-red-500/10' : 'border-gray-200'} rounded-lg text-sm font-medium text-slate-900 focus:border-indigo-500 outline-none transition-all placeholder:text-gray-400`
      })}
    </div>
    {error && (
      <p className="text-[10px] text-red-500 font-bold px-1 flex items-center gap-1 mt-1">
        <div className="h-3 w-3 bg-red-500 text-white rounded-full p-0.5 flex items-center justify-center text-[8px]">!</div>
        {error}
      </p>
    )}
  </div>
);

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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Drag & Drop</p>
              <h1 className="text-sm font-bold text-slate-800">Grocery Studio</h1>
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
    if (isSubmitting) return;
    if (!validate()) { if (window.showToast) window.showToast('Please fix the highlighted fields.', 'warning'); return; }
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
            if (window.showToast) window.showToast('Please fix the highlighted fields.', 'warning');
            return;
          }
        }
        throw new Error(response.error || response.data?.message || 'Failed to complete registration');
      }

      const updatedSeller = response.data?.data?.seller || response.data?.seller || {};
      dispatch({ type: ActionTypes.UPDATE_USER, payload: { ...currentUser, ...updatedSeller, profileCompleted: true } });
      if (payload.shopName) dispatch({ type: ActionTypes.SET_STORE_NAME, payload: payload.shopName });
      if (payload.upiId) dispatch({ type: ActionTypes.SET_UPI_ID, payload: payload.upiId });
      if (window.showToast) window.showToast('Profile completed successfully!', 'success');
      onClose();
    } catch (error) {
      // Handle duplicate mobile number error specifically
      if (error.message && error.message.includes('mobile number is already registered')) {
        setErrors(prev => ({ ...prev, phoneNumber: 'This mobile number is already in use.' }));
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
          if (window.showToast) window.showToast('Please fix the highlighted fields.', 'warning');
          return;
        }
      }

      if (window.showToast) window.showToast(error.message || 'Failed to save details.', 'error');
    } finally { setIsSubmitting(false); }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white flex h-screen w-screen overflow-hidden font-sans m-0 p-0">
      {/* LEFT PANEL: DECORATIVE HERO */}
      <div className="hidden lg:block lg:w-1/2 xl:w-7/12 bg-slate-900 relative overflow-hidden h-screen flex flex-col items-center justify-center">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/30 blur-3xl"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/30 blur-3xl"></div>

        <div className="relative z-10 w-full max-w-[450px] mx-auto mb-8 mt-12 transform transition-transform duration-700 hover:scale-[1.01]">
          {/* Desktop Monitor Frame */}
          <div className="relative mx-auto w-full z-10 animate-float-slow">
            {/* Monitor Head */}
            <div className="relative bg-[#1a1a1a] rounded-xl p-[2.5%] shadow-2xl ring-1 ring-white/10 border-b-[6px] border-[#222]">
              {/* Screen with Dashboard */}
              <div className="bg-slate-50 aspect-[16/9] rounded overflow-hidden relative font-sans w-full">
                {/* Sizing: scale down full 1280px dashboard to fit monitor width */}
                <div className="absolute top-0 left-0 w-[1280px] h-[720px] origin-top-left transform scale-[0.28] sm:scale-[0.31] md:scale-[0.33] lg:scale-[0.30] xl:scale-[0.33]">
                  <PreviewDashboard mode="desktop" />
                </div>
              </div>
              {/* Brand Logo / Chin */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-1.5 opacity-50">
                <div className="w-4 h-4 rounded-full bg-[#333]"></div>
              </div>
            </div>

            {/* Monitor Stand */}
            <div className="relative mx-auto mt-[-2px]">
              {/* Neck */}
              <div className="w-[18%] h-12 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] mx-auto z-0 relative"></div>
              {/* Base */}
              <div className="w-[32%] h-2.5 bg-[#151515] mx-auto rounded-t-lg shadow-lg relative z-10"></div>
            </div>
          </div>

          {/* Mobile Frame - Positioned next to monitor */}
          <div className="absolute -bottom-2 -right-8 z-30 w-[22%] min-w-[90px] animate-float-slow" style={{ animationDelay: '1.2s' }}>
            <div className="bg-[#121212] rounded-[1.5rem] p-[5%] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] ring-1 ring-white/10 border-[2px] border-[#222]">
              <div className="bg-slate-50 aspect-[9/19.5] rounded-[1rem] overflow-hidden relative font-sans w-full bg-white">
                {/* Mobile Screen Scaled */}
                <div className="absolute top-0 left-0 w-[375px] h-[812px] origin-top-left transform scale-[0.18] sm:scale-[0.20] md:scale-[0.22] lg:scale-[0.20] xl:scale-[0.22]">
                  <PreviewDashboard mode="mobile" />
                </div>
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[40%] h-[15px] bg-[#121212] rounded-b-lg z-50"></div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-center px-12 mt-4">
          <h2 className="text-3xl font-bold mb-3 text-white">Grow Your Business</h2>
          <p className="text-blue-100/90 text-lg">Manage inventory, billing, and customers in one place.</p>
        </div>
      </div>

      {/* RIGHT PANEL: FORM */}
      <div className="w-full lg:w-1/2 xl:w-5/12 h-screen overflow-y-auto custom-scrollbar bg-white px-6 py-8 sm:px-12 sm:py-12 flex flex-col">
        <div className="flex items-center justify-between mb-8 flex-none">
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors"><LogOut className="h-4 w-4" /><span>Log Out</span></button>
          <span className="text-xs font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full">Step 1 of 1</span>
        </div>
        <div className="mb-8 flex-none">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Complete Profile</h1>
          <p className="text-slate-500">Secure your shop details with us.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 max-w-lg space-y-8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><Store className="h-4 w-4 text-blue-600" /> Business Info</h3>
            <div className="space-y-4">
              <InputWrapper label="Shop Name" required error={errors.shopName} icon={Store}><input type="text" value={form.shopName} onChange={handleChange('shopName')} placeholder="Apex Electronics" maxLength={50} /></InputWrapper>
              <InputWrapper label="Business Type" required error={errors.businessType} icon={Briefcase}>
                <select value={form.businessType} onChange={handleChange('businessType')} className="appearance-none cursor-pointer"><option value="">Select Business Type</option>{businessTypes.map((type) => (<option key={type} value={type}>{type}</option>))}</select>
              </InputWrapper>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><MapPin className="h-4 w-4 text-blue-600" /> Location Details</h3>
            <div className="space-y-4">
              <InputWrapper label="Phone Number" required error={errors.phoneNumber} icon={Phone}><input type="tel" value={form.phoneNumber} onChange={handleChange('phoneNumber')} placeholder="9876543210" maxLength={10} /></InputWrapper>
              <InputWrapper label="Shop Address" required error={errors.shopAddress} icon={MapPin}><input type="text" value={form.shopAddress} onChange={handleChange('shopAddress')} placeholder="Street address, Landmark" maxLength={200} /></InputWrapper>

              {/* Dynamic Pincode/Location Section */}
              <div className={`grid ${form.pincode && form.pincode.length === 6 ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                <InputWrapper label="Pincode" required error={errors.pincode} icon={MapPin}><input type="text" value={form.pincode} onChange={handleChange('pincode')} placeholder="Pincode" maxLength={6} /></InputWrapper>
                {form.pincode && form.pincode.length === 6 && (
                  <InputWrapper label="City" required error={errors.city} icon={Building2}>
                    <select value={form.city} onChange={handleChange('city')} className="appearance-none cursor-pointer">
                      <option value="">Select City</option>
                      {cityOptions.map((city) => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                  </InputWrapper>
                )}
              </div>
              {/* Conditionally reveal State */}
              {form.pincode && form.pincode.length === 6 && (
                <InputWrapper label="State" required error={errors.state} icon={Navigation}>
                  <select value={form.state} onChange={handleChange('state')} className="appearance-none cursor-pointer"><option value="">Select State</option>{indianStates.map((state) => (<option key={state} value={state}>{state}</option>))}</select>
                </InputWrapper>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2"><CreditCard className="h-4 w-4 text-blue-600" /> Legal & Payment</h3>
            <div className="space-y-4">
              <InputWrapper label="UPI ID" required error={errors.upiId} icon={CreditCard}><input type="text" value={form.upiId} onChange={handleChange('upiId')} placeholder="name@bank" maxLength={50} /></InputWrapper>
              <div className="grid grid-cols-2 gap-4">
                <InputWrapper label="Gender" required error={errors.gender} icon={User}>
                  <select value={form.gender} onChange={handleChange('gender')} className="appearance-none cursor-pointer"><option value="">Select Gender</option>{genders.map((option) => (<option key={option} value={option}>{option}</option>))}</select>
                </InputWrapper>
                <InputWrapper label="GST (Optional)" error={errors.gstNumber} icon={FileText}><input type="text" value={form.gstNumber} onChange={handleChange('gstNumber')} placeholder="GSTIN" maxLength={15} /></InputWrapper>
              </div>
              <InputWrapper label="WhatsApp Group Link (Optional)" icon={MessageCircle}><input type="text" value={form.whatsappLink} onChange={handleChange('whatsappLink')} placeholder="https://chat.whatsapp.com/..." /></InputWrapper>
            </div>
          </div>
          <div className="pt-2 pb-10">
            <button type="submit" disabled={isSubmitting} className="w-full py-3.5 rounded-lg font-bold text-sm text-white bg-slate-900 hover:opacity-90 transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Complete Registration
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

    </div>,
    document.body
  );
};

export default SellerRegistrationModal;
