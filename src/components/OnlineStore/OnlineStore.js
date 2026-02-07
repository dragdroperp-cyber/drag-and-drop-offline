import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, ActionTypes, isPlanExpired } from '../../context/AppContext';
import { getTranslation } from '../../utils/translations';
import { getOnlineStoreSettings, updateOnlineStoreSettings, getOnlineOrders, updateOnlineOrderStatus, verifyOnlineOrderDelivery, getOnlineDashboardStats, apiRequest } from '../../utils/api';
import { getItem, updateItem, getAllItems, STORES } from '../../utils/indexedDB';
import { addWatermarkToPDF } from '../../utils/pdfUtils';
import {
    Store,
    Truck,
    ShoppingBag,
    Settings,
    Info,
    ExternalLink,
    Copy,
    Upload,
    BarChart3,
    Globe,
    Palette,
    Layout,
    Save,
    CheckCircle,
    Clock,
    Search,
    Filter,
    ArrowRight,
    Rocket,
    Check,
    Loader2,
    X,
    Printer,
    Share2,
    Eye,
    Receipt,
    ChevronsLeft,
    ChevronsRight,
    ChevronLeft,
    ChevronRight,
    ShoppingCart,
    IndianRupee,
    FileSpreadsheet,
    FileJson,
    Download,
    Plus,
    Trash2,
    Scan,
    RefreshCw,
    Lock,
    AlertCircle
} from 'lucide-react';
import BarcodeScanner from '../BarcodeScanner/BarcodeScanner';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { calculateItemRateAndTotal, formatCurrency, formatCurrencySmart } from '../../utils/orderUtils';
import { sanitizeMobileNumber } from '../../utils/validation';
import { backgroundSyncWithBackend } from '../../utils/dataFetcher';

import { formatDate, formatDateTime } from '../../utils/dateUtils';

const PageLoader = () => (
    <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-slate-900 dark:text-white animate-spin" />
            <p className="text-slate-500 text-sm font-medium">Loading store...</p>
        </div>
    </div>
);

const OnlineStore = () => {
    const { state, dispatch } = useApp();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isLoading, setIsLoading] = useState(true);
    const [storeExists, setStoreExists] = useState(false);
    const [storeData, setStoreData] = useState(null);
    const [showSetup, setShowSetup] = useState(false);
    const [initialOrder, setInitialOrder] = useState(null);

    const handleDashboardOrderClick = (order) => {
        setInitialOrder(order);
        setActiveTab('orders');
    };

    const onlineOrders = React.useMemo(() => {
        if (!state.orders || !Array.isArray(state.orders)) return [];
        return state.orders.filter(order =>
            (order.orderSource === 'online' || order.source === 'online')
        ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }, [state.orders]);

    const dashboardStatsLocal = React.useMemo(() => {
        const stats = {
            totalOrders: onlineOrders.length,
            totalRevenue: onlineOrders.reduce((sum, order) =>
                order.orderStatus !== 'Cancelled' ? sum + (order.totalAmount || 0) : sum, 0
            ),
            pendingOrders: onlineOrders.filter(o => !['Delivered', 'Cancelled', 'Completed', 'refunded'].includes(o.orderStatus)).length,
            recentOrders: onlineOrders.slice(0, 5)
        };
        return stats;
    }, [onlineOrders]);

    useEffect(() => {
        fetchStoreSettings();
    }, []);

    const fetchStoreSettings = async () => {
        setIsLoading(true);
        try {
            const response = await getOnlineStoreSettings();
            if (response.success) {
                if (response.data.exists) {
                    setStoreExists(true);
                    setStoreData(response.data);
                } else {
                    setStoreExists(false);
                }
            }
        } catch (error) {
            console.error('Failed to fetch store settings', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSetupComplete = (newStoreData) => {
        setStoreData(newStoreData);
        setStoreExists(true);
        setShowSetup(false);
    };

    if (isLoading) {
        return <PageLoader />;
    }

    if (!storeExists && !showSetup) {
        return <SetupLanding onStartSetup={() => setShowSetup(true)} />;
    }

    if (!storeExists && showSetup) {
        return <StoreSetupWizard onComplete={handleSetupComplete} onCancel={() => setShowSetup(false)} />;
    }


    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard':
                return <StoreDashboard storeData={storeData} stats={dashboardStatsLocal} onOrderClick={handleDashboardOrderClick} />;
            case 'settings':
                return <StoreSettings storeData={storeData} onUpdate={setStoreData} />;
            case 'orders':
                return <StoreOrders initialOrder={initialOrder} onClearInitial={() => setInitialOrder(null)} />;
            case 'about':
                return <StoreAbout storeData={storeData} onUpdate={setStoreData} />;
            default:
                return <StoreDashboard storeData={storeData} stats={dashboardStatsLocal} onOrderClick={handleDashboardOrderClick} />;
        }
    };

    return (
        <div className="h-full bg-slate-50 dark:bg-slate-900 overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 md:p-6 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl">
                            <Store className="h-8 w-8 text-slate-900 dark:text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">Online Store</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-xs md:text-sm">Manage your digital storefront</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:gap-3">
                        <button
                            onClick={() => {
                                if (storeData?.storeSlug) {
                                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                                    const baseUrl = isLocal ? 'http://localhost:5173' : 'https://ecommercegrocerystudio-1.onrender.com';
                                    window.open(`${baseUrl}/${storeData.storeSlug}`, '_blank');
                                }
                            }}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 md:px-4 py-2 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-all duration-200 text-xs md:text-sm font-medium shadow-sm active:scale-95"
                        >
                            <ExternalLink className="h-3.5 w-3.5 md:h-4 md:w-4" />
                            Visit Store
                        </button>
                        <button
                            onClick={() => {
                                if (storeData?.storeSlug) {
                                    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                                    const baseUrl = isLocal ? 'http://localhost:5173' : 'https://ecommercegrocerystudio-1.onrender.com';
                                    const url = `${baseUrl}/${storeData.storeSlug}`;
                                    navigator.clipboard.writeText(url);
                                    if (window.showToast) window.showToast('Store link copied to clipboard!', 'success');
                                }
                            }}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 md:px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-xs md:text-sm font-medium active:scale-95 btn-shimmer"
                        >
                            <Copy className="h-3.5 w-3.5 md:h-4 md:w-4" />
                            Share Link
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="flex items-center gap-4 md:gap-6 mt-6 md:mt-8 overflow-x-auto no-scrollbar scroll-smooth">
                    <TabButton
                        id="dashboard"
                        label="Dashboard"
                        icon={BarChart3}
                        active={activeTab === 'dashboard'}
                        onClick={setActiveTab}
                    />
                    <TabButton
                        id="settings"
                        label="Store Settings"
                        icon={Settings}
                        active={activeTab === 'settings'}
                        onClick={setActiveTab}
                    />
                    <TabButton
                        id="orders"
                        label="Online Orders"
                        icon={ShoppingBag}
                        active={activeTab === 'orders'}
                        onClick={setActiveTab}
                    />
                    <TabButton
                        id="about"
                        label="About Store"
                        icon={Info}
                        active={activeTab === 'about'}
                        onClick={setActiveTab}
                    />
                </div>
            </div>

            {/* Main Content */}
            <div className="px-0 py-4 md:p-6">
                <div className="max-w-7xl mx-auto">
                    {isPlanExpired(state) && (
                        <div className="mx-4 md:mx-0 mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 shadow-sm animate-in slide-in-from-top-4 duration-500">
                            <div className="flex items-center gap-3 flex-1">
                                <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg shrink-0">
                                    <Lock className="h-5 w-5 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-red-900 dark:text-red-200">Online Store Locked</h3>
                                    <p className="text-xs text-red-700 dark:text-red-300 mt-1">Your shop is temporarily locked due to your expired plan. Please upgrade to unlock your online store.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    dispatch({ type: ActionTypes.SET_CURRENT_VIEW, payload: 'upgrade' });
                                    navigate('/upgrade');
                                }}
                                className="w-full md:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all duration-200 shadow-sm whitespace-nowrap flex items-center justify-center gap-2 active:scale-95"
                            >
                                <ArrowRight className="h-3.5 w-3.5" />
                                Upgrade to Unlock
                            </button>
                        </div>
                    )}
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

const SetupLanding = ({ onStartSetup }) => (
    <div className="min-h-full flex flex-col items-center justify-start bg-slate-50 dark:bg-slate-900 p-0 md:p-6 text-center relative overflow-y-auto overflow-x-hidden pt-4 pb-10 md:pt-8 md:pb-12">
        {/* Decorative Blobs */}
        <div className="absolute top-0 -left-10 w-72 h-72 bg-indigo-300 dark:bg-indigo-900/30 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-0 -right-10 w-72 h-72 bg-purple-300 dark:bg-purple-900/30 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-72 h-72 bg-pink-300 dark:bg-pink-900/30 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>

        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl p-8 md:p-10 rounded-none md:rounded-[2.5rem] shadow-none md:shadow-2xl max-w-2xl md:max-w-4xl w-full border-0 md:border border-white/20 dark:border-slate-700 relative z-10 animate-fadeInUp">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-3xl flex items-center justify-center mx-auto mb-6 md:mb-6 shadow-inner transform -rotate-3 hover:rotate-0 transition-transform duration-300">
                <Store className="h-10 w-10 md:h-12 md:w-12 text-slate-900 dark:text-white" />
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">
                Launch Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">Online Store</span>
            </h1>

            <p className="text-base md:text-lg text-slate-600 dark:text-slate-300 mb-6 md:mb-8 max-w-2xl mx-auto leading-relaxed">
                Take your business digital. Create a stunning storefront and start taking orders from customers anywhere, anytime.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8 text-left">
                {[
                    {
                        title: 'Easy Setup',
                        desc: 'No coding required. Just add details and go live.',
                        icon: Rocket,
                        color: 'bg-blue-100 text-blue-600'
                    },
                    {
                        title: 'Mobile Ready',
                        desc: 'Optimized for a perfect experience on phones.',
                        icon: Layout,
                        color: 'bg-purple-100 text-purple-600'
                    },
                    {
                        title: 'Real-time',
                        desc: 'Get instant notifications for every online order.',
                        icon: CheckCircle,
                        color: 'bg-green-100 text-green-600'
                    }
                ].map((item, i) => (
                    <div key={i} className="group p-4 md:p-5 bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-indigo-500 transition-all duration-300 hover:shadow-lg">
                        <div className={`w-10 h-10 rounded-xl ${item.color} dark:bg-opacity-20 flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform`}>
                            <item.icon className="h-5 w-5" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-1.5">{item.title}</h3>
                        <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">{item.desc}</p>
                    </div>
                ))}
            </div>

            <div className="flex justify-center">
                <button
                    onClick={onStartSetup}
                    className="group px-8 py-3.5 md:px-10 md:py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold transition-all duration-200 hover:bg-slate-800 dark:hover:bg-slate-100 flex items-center justify-center gap-2 active:scale-95 shadow-lg btn-shimmer"
                >
                    Get Started Now
                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </button>
            </div>
        </div>
    </div>
);

const StoreSetupWizard = ({ onComplete, onCancel }) => {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formData, setFormData] = useState({
        storeName: '',
        storeSlug: '',
        primaryColor: '#4F46E5',
        logoUrl: '',
        contactPhone: '',
        contactEmail: '',
        onlineOrderingEnabled: true,
        pickupEnabled: true,
        deliveryCharge: 0,
        minOrderAmount: 0,
        minFreeDeliveryAmount: 0,
        tagline: '',
        deliveryRange: 0
    });

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));

        // Clear error when user changes the field
        if (fieldErrors[name]) {
            setFieldErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[name];
                return newErrors;
            });
        }

        if (name === 'storeName' && !formData.storeSlug) {
            setFormData(prev => ({
                ...prev,
                storeSlug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
            }));
        }
    };

    const nextStep = () => setStep(s => s + 1);
    const prevStep = () => setStep(s => s - 1);

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        setIsSubmitting(true);
        try {
            const response = await updateOnlineStoreSettings(formData);
            if (response.success) {
                if (window.showToast) window.showToast('Online store created successfully!', 'success');
                onComplete(response.data);
            } else {
                const errorMsg = response.message || response.error || '';
                if (errorMsg.includes('Store URL is already taken')) {
                    setStep(1);
                    setFieldErrors({ storeSlug: 'This URL is already taken. Please choose another.' });
                }
                if (window.showToast) window.showToast(errorMsg || 'Failed to create store', 'error');
            }
        } catch (error) {
            console.error('Setup failed', error);
            const errorMsg = error.message || '';
            if (errorMsg.includes('Store URL is already taken')) {
                setStep(1);
                setFieldErrors({ storeSlug: 'This URL is already taken. Please choose another.' });
                if (window.showToast) window.showToast(errorMsg, 'error');
            } else {
                if (window.showToast) window.showToast('Something went wrong. Please try again.', 'error');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-full w-full flex items-start justify-center bg-slate-50 dark:bg-slate-900 p-0 md:p-6 overflow-y-auto overflow-x-hidden pt-2 md:pt-8">
            <div className="bg-white dark:bg-slate-800 p-6 md:px-10 md:pt-8 md:pb-6 rounded-none md:rounded-[2.5rem] shadow-none md:shadow-2xl md:max-w-2xl w-full border-0 md:border border-slate-200 dark:border-slate-700 min-h-full md:min-h-0 md:h-auto flex flex-col animate-fadeInUp">

                {/* Step Indicator */}
                <div className="flex items-center gap-3 mb-6">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex-1">
                            <div className={`h-1.5 rounded-full transition-all duration-500 overflow-hidden ${step >= s ? 'bg-slate-900 dark:bg-white' : 'bg-slate-100 dark:bg-slate-700'}`}>
                                <div
                                    className={`h-full bg-slate-900 dark:bg-white transition-all duration-500 ${step === s ? 'w-full animate-progress' : step > s ? 'w-full' : 'w-0'}`}
                                />
                            </div>
                            <p className={`text-[10px] uppercase tracking-widest font-black mt-2 ${step === s ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                                Step 0{s}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="mb-6">
                    <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {step === 1 ? 'Store Branding' : step === 2 ? 'Store Contact' : 'Delivery Settings'}
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
                        {step === 1 ? 'Choose how your store looks to customers' : step === 2 ? 'How can customers reach you?' : 'Set up your delivery and ordering rules'}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Store Name</label>
                                <input
                                    type="text"
                                    name="storeName"
                                    value={formData.storeName}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="e.g. Fresh Mart Grocery"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Tagline (Optional)</label>
                                <input
                                    type="text"
                                    name="tagline"
                                    value={formData.tagline}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="e.g. Freshness Delivered to Your Doorstep"
                                />
                            </div>
                            <div>
                                <label className={`block text-sm font-semibold mb-2 ${fieldErrors.storeSlug ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    Store URL Slug {fieldErrors.storeSlug && <span className="text-xs font-normal ml-1">(Already Taken)</span>}
                                </label>
                                <input
                                    type="text"
                                    name="storeSlug"
                                    value={formData.storeSlug}
                                    onChange={handleChange}
                                    className={`input-field font-mono text-sm ${fieldErrors.storeSlug ? 'border-red-500 ring-2 ring-red-500/20 bg-red-50/50 dark:bg-red-900/10' : ''}`}
                                    placeholder="fresh-mart"
                                />
                                {fieldErrors.storeSlug ? (
                                    <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 font-semibold">{fieldErrors.storeSlug}</p>
                                ) : (
                                    <p className="text-[10px] text-slate-500 mt-1">Visit at: ecommercegrocerystudio-1.onrender.com/{formData.storeSlug || '...'}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 text-xs">Logo URL (Optional)</label>
                                <input
                                    type="text"
                                    name="logoUrl"
                                    value={formData.logoUrl}
                                    onChange={handleChange}
                                    className="input-field text-xs"
                                    placeholder="https://..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Brand Theme Color</label>
                                <div className="flex gap-3 flex-wrap items-center">
                                    {['#4F46E5', '#3B82F6', '#06B6D4', '#10B981', '#14B8A6', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#8B5CF6', '#000000'].map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => setFormData(p => ({ ...p, primaryColor: color }))}
                                            className={`w-8 h-8 rounded-full border-2 transition-all ${formData.primaryColor.toLowerCase() === color.toLowerCase() ? 'border-indigo-600 dark:border-white scale-110 shadow-lg ring-2 ring-indigo-500 ring-offset-2' : 'border-transparent opacity-70 hover:opacity-100 hover:scale-105'}`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                    <div className="relative w-8 h-8 flex items-center justify-center rounded-full border border-slate-300 overflow-hidden ring-offset-2 focus-within:ring-2 focus-within:ring-indigo-500">
                                        <input
                                            type="color"
                                            value={formData.primaryColor}
                                            onChange={(e) => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                                            className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer border-0 p-0"
                                        />
                                        <Palette className="w-3.5 h-3.5 text-slate-500 pointer-events-none z-10 mix-blend-difference" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Support Phone Number</label>
                                <input
                                    type="tel"
                                    name="contactPhone"
                                    value={formData.contactPhone}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="+91 XXXXX XXXXX"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Support Email Address</label>
                                <input
                                    type="email"
                                    name="contactEmail"
                                    value={formData.contactEmail}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="hello@yourstore.com"
                                />
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl space-y-4 border border-slate-100 dark:border-slate-700">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">Enable Online Ordering</p>
                                        <p className="text-xs text-slate-500">Allow customers to buy products online</p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        name="onlineOrderingEnabled"
                                        checked={formData.onlineOrderingEnabled}
                                        onChange={handleChange}
                                        className="w-5 h-5 accent-indigo-600"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">Enable Store Pickup</p>
                                        <p className="text-xs text-slate-500">Customers can pick up from your shop</p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        name="pickupEnabled"
                                        checked={formData.pickupEnabled}
                                        onChange={handleChange}
                                        className="w-5 h-5 accent-indigo-600"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Flat Delivery Charge (₹)</label>
                                <input
                                    type="text"
                                    name="deliveryCharge"
                                    value={formData.deliveryCharge}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="0 (Free Delivery)"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Min. Order (₹)</label>
                                    <input
                                        type="text"
                                        name="minOrderAmount"
                                        value={formData.minOrderAmount}
                                        onChange={handleChange}
                                        className="input-field"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Free if Above (₹)</label>
                                    <input
                                        type="text"
                                        name="minFreeDeliveryAmount"
                                        value={formData.minFreeDeliveryAmount}
                                        onChange={handleChange}
                                        className="input-field"
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Max. Delivery Range (km)</label>
                                <input
                                    type="text"
                                    name="deliveryRange"
                                    value={formData.deliveryRange}
                                    onChange={handleChange}
                                    className="input-field"
                                    placeholder="0 (Unlimited)"
                                />
                            </div>
                            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800 flex gap-3">
                                <Info className="h-5 w-5 text-indigo-600 shrink-0" />
                                <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                                    You can always change these settings later from the "Store Settings" tab in your dashboard.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="pt-3 mt-auto border-t border-slate-100 dark:border-slate-700 flex gap-4">
                    {step === 1 ? (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 px-6 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-2xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all duration-200 active:scale-95"
                        >
                            Cancel
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={prevStep}
                            className="flex-1 px-6 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-2xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all duration-200 active:scale-95"
                        >
                            Back
                        </button>
                    )}

                    {step < 3 ? (
                        <button
                            type="button"
                            disabled={!formData.storeName || !formData.storeSlug}
                            onClick={nextStep}
                            className="flex-1 px-6 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white rounded-2xl font-black shadow-xl hover:shadow-2xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 btn-shimmer"
                        >
                            Continue
                            <ArrowRight className="h-5 w-5" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="flex-1 px-6 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white rounded-2xl font-black shadow-xl hover:shadow-2xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 active:scale-95 btn-shimmer"
                        >
                            {isSubmitting ? 'Launching...' : 'Launch Store'}
                            {!isSubmitting && <Rocket className="h-5 w-5" />}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const TabButton = ({ id, label, icon: Icon, active, onClick }) => (
    <button
        onClick={() => onClick(id)}
        className={`flex items-center gap-2 pb-4 border-b-2 text-sm font-medium transition-colors whitespace-nowrap ${active
            ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
    >
        <Icon className="h-4 w-4" />
        {label}
    </button>
);

const StoreDashboard = ({ storeData, stats, onOrderClick }) => {
    const { state } = useApp();
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 md:gap-6 divide-y md:divide-y-0 divide-slate-100 dark:divide-slate-700">
                <StatsCard title="Online Orders" value={stats?.totalOrders || 0} change="+0%" icon={ShoppingBag} color="green" />
                <StatsCard title="Pending Orders" value={stats?.pendingOrders || 0} change="+0%" icon={Clock} color="orange" />
                <StatsCard title="Online Revenue" value={formatCurrencySmart(stats?.totalRevenue || 0, state.currencyFormat)} change="+0%" icon={BarChart3} color="purple" />
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 md:rounded-2xl shadow-sm border-y md:border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Recent Orders</h3>
                    <button className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View All</button>
                </div>
                <div className="space-y-4">
                    {stats?.recentOrders && stats.recentOrders.length > 0 ? (
                        stats.recentOrders.map((order) => (
                            <div
                                key={order._id}
                                onClick={() => onOrderClick?.(order)}
                                className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600">
                                        <ShoppingBag className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-slate-900 dark:text-white">Order #{order._id.slice(-6).toUpperCase()}</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">{order.customerName || 'Customer'} • {new Date(order.createdAt).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-semibold text-slate-900 dark:text-white">{formatCurrencySmart(order.totalAmount, state.currencyFormat)}</p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${order.orderStatus === 'Pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                        order.orderStatus === 'Completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                            order.orderStatus === 'Cancelled' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                                                'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                        }`}>
                                        {order.orderStatus}
                                    </span>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
                            <ShoppingBag className="h-10 w-10 mb-2 opacity-50" />
                            <p className="text-sm">No online orders yet</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const StatsCard = ({ title, value, change, icon: Icon, color }) => {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
        green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
        purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-6 md:rounded-2xl shadow-sm border-y md:border border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
                    <Icon className="h-6 w-6" />
                </div>
                {/* <span className="flex items-center text-emerald-600 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">
                    {change}
                </span> */}
            </div>
            <h3 className="text-slate-500 dark:text-slate-400 text-sm font-medium">{title}</h3>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
        </div>
    );
};

const StoreSettings = ({ storeData, onUpdate }) => {
    const [formData, setFormData] = useState({
        storeName: storeData?.storeName || '',
        storeSlug: storeData?.storeSlug || '',
        primaryColor: storeData?.primaryColor || '#4F46E5',
        layoutTheme: storeData?.layoutTheme || 'Modern Grid',
        cardStyle: storeData?.cardStyle || 'shadow',
        bannerStyle: storeData?.bannerStyle || 'wide',
        buttonStyle: storeData?.buttonStyle || 'rounded',
        font: storeData?.font || 'Inter',
        onlineOrderingEnabled: storeData?.onlineOrderingEnabled ?? false,
        pickupEnabled: storeData?.pickupEnabled ?? false,
        contactEmail: storeData?.contactEmail || '',
        contactPhone: storeData?.contactPhone || '',
        deliveryCharge: storeData?.deliveryCharge || 0,
        deliveryRange: storeData?.deliveryRange || 0,
        minFreeDeliveryAmount: storeData?.minFreeDeliveryAmount || 0,
        minOrderAmount: storeData?.minOrderAmount || 0,
        bannerUrl: storeData?.bannerUrl || '',
        banners: storeData?.banners || [],
        logoUrl: storeData?.logoUrl || '',
        socialLinks: {
            instagram: storeData?.socialLinks?.instagram || '',
            facebook: storeData?.socialLinks?.facebook || '',
            twitter: storeData?.socialLinks?.twitter || '',
            youtube: storeData?.socialLinks?.youtube || ''
        }
    });
    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;

        if (['deliveryCharge', 'deliveryRange', 'minFreeDeliveryAmount', 'minOrderAmount'].includes(name)) {
            // Allow only numbers and a single decimal point
            if (value && !/^\d*\.?\d*$/.test(value)) {
                return;
            }
        }

        if (name.startsWith('social_')) {
            const platform = name.split('_')[1];
            setFormData(prev => ({
                ...prev,
                socialLinks: {
                    ...prev.socialLinks,
                    [platform]: value
                }
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                [name]: type === 'checkbox' ? checked : value
            }));
        }
    };

    const handleAddBanner = () => {
        setFormData(prev => ({
            ...prev,
            banners: [...prev.banners, { imageUrl: '', redirectUrl: '', active: true }]
        }));
    };

    const handleRemoveBanner = (index) => {
        setFormData(prev => ({
            ...prev,
            banners: prev.banners.filter((_, i) => i !== index)
        }));
    };

    const handleBannerChange = (index, field, value) => {
        setFormData(prev => {
            const newBanners = [...prev.banners];
            newBanners[index] = { ...newBanners[index], [field]: value };
            return { ...prev, banners: newBanners };
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await updateOnlineStoreSettings(formData);
            if (response.success) {
                // Update IndexedDB
                try {
                    await updateItem(STORES.settings, { ...response.data, id: response.data._id || 'store_settings', isSynced: true });
                } catch (dbError) {
                    console.error('Failed to update IndexedDB:', dbError);
                }

                if (window.showToast) window.showToast('Settings saved successfully', 'success');
                onUpdate(response.data);
            } else {
                if (window.showToast) window.showToast(response.message || 'Failed to save settings', 'error');
            }
        } catch (error) {
            console.error('Failed to save settings', error);
            if (window.showToast) window.showToast('Failed to save settings', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6">General Information</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Store Name</label>
                            <input
                                type="text"
                                name="storeName"
                                value={formData.storeName}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                placeholder="Enter store name"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6">Contact & Social</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contact Email</label>
                            <input
                                type="email"
                                name="contactEmail"
                                value={formData.contactEmail}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="support@store.com"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contact Phone</label>
                            <input
                                type="tel"
                                name="contactPhone"
                                value={formData.contactPhone}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="+91 98765 43210"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Delivery Charge (₹)</label>
                            <input
                                type="text"
                                name="deliveryCharge"
                                value={formData.deliveryCharge}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Delivery Range (km)</label>
                            <input
                                type="text"
                                name="deliveryRange"
                                value={formData.deliveryRange}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="0"
                            />
                        </div>
                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Free Delivery Above (₹)</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        name="minFreeDeliveryAmount"
                                        value={formData.minFreeDeliveryAmount}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="0 (Leave 0 to disable)"
                                    />
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Order amount required to qualify for free delivery.</p>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Minimum Order Amount (₹)</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        name="minOrderAmount"
                                        value={formData.minOrderAmount}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="0 (No minimum)"
                                    />
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Customers won't be able to checkout for less than this amount.</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-600 rounded-xl">
                            <input
                                type="checkbox"
                                id="pickupEnabled"
                                name="pickupEnabled"
                                checked={formData.pickupEnabled}
                                onChange={handleChange}
                                className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label htmlFor="pickupEnabled" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                                Enable Pickup Orders (Come & Pick)
                                <p className="text-xs text-slate-500 font-normal mt-0.5">Allow customers to place orders online and pick them up from the store.</p>
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Instagram URL</label>
                            <input
                                type="text"
                                name="social_instagram"
                                value={formData.socialLinks.instagram}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="https://instagram.com/..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Facebook URL</label>
                            <input
                                type="text"
                                name="social_facebook"
                                value={formData.socialLinks.facebook}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="https://facebook.com/..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Twitter/X URL</label>
                            <input
                                type="text"
                                name="social_twitter"
                                value={formData.socialLinks.twitter}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="https://twitter.com/..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">YouTube URL</label>
                            <input
                                type="text"
                                name="social_youtube"
                                value={formData.socialLinks.youtube}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="https://youtube.com/..."
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6">Appearance</h3>

                    {/* Colors & Fonts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Primary Color</label>
                            <div className="flex gap-3 flex-wrap items-center">
                                {['#4F46E5', '#3B82F6', '#06B6D4', '#10B981', '#14B8A6', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#8B5CF6', '#000000'].map((color) => {
                                    const isSelected = formData.primaryColor.toLowerCase() === color.toLowerCase();
                                    return (
                                        <button
                                            key={color}
                                            onClick={() => setFormData(prev => ({ ...prev, primaryColor: color }))}
                                            className={`w-8 h-8 rounded-full border-2 shadow-sm transition-transform flex items-center justify-center ${isSelected ? 'border-indigo-600 dark:border-white scale-110 ring-2 ring-offset-2 ring-indigo-500' : 'border-white dark:border-slate-800 hover:scale-110'}`}
                                            style={{ backgroundColor: color }}
                                        >
                                            {isSelected && <Check className="w-4 h-4 text-white drop-shadow-md" strokeWidth={3} />}
                                        </button>
                                    );
                                })}
                                <div className={`relative w-9 h-9 flex items-center justify-center rounded-full overflow-hidden transition-all ${!['#4f46e5', '#3b82f6', '#06b6d4', '#10b981', '#14b8a6', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#000000'].includes(formData.primaryColor.toLowerCase()) ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110 border-2 border-indigo-600' : 'border border-gray-300'}`}>
                                    <input
                                        type="color"
                                        value={formData.primaryColor}
                                        onChange={(e) => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                                        className="absolute -top-4 -left-4 w-16 h-16 cursor-pointer border-0 p-0"
                                        title="Custom Color"
                                    />
                                    <Palette className="w-4 h-4 text-slate-500 pointer-events-none z-10 mix-blend-difference text-white" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Font Family</label>
                            <select
                                name="font"
                                value={formData.font}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="Inter">Inter (Clean)</option>
                                <option value="Roboto">Roboto (Standard)</option>
                                <option value="Outfit">Outfit (Modern)</option>
                                <option value="Playfair Display">Playfair (Elegant)</option>
                                <option value="Merriweather">Merriweather (Serif)</option>
                            </select>
                        </div>
                    </div>

                    {/* Styling Options */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Layout Theme</label>
                            <select
                                name="layoutTheme"
                                value={formData.layoutTheme}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="Modern Grid">Modern Grid</option>
                                <option value="Classic List">Classic List</option>
                                <option value="Compact List">Compact List</option>
                                <option value="Masonry">Masonry</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Card Style</label>
                            <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
                                {['shadow', 'border', 'flat'].map((style) => (
                                    <button
                                        key={style}
                                        onClick={() => setFormData((prev) => ({ ...prev, cardStyle: style }))}
                                        className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all ${formData.cardStyle === style ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                                    >
                                        {style}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Button Shape</label>
                            <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
                                {['rounded', 'pill', 'square'].map((style) => (
                                    <button
                                        key={style}
                                        onClick={() => setFormData((prev) => ({ ...prev, buttonStyle: style }))}
                                        className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all ${formData.buttonStyle === style ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                                    >
                                        {style}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Banner Style</label>
                            <select
                                name="bannerStyle"
                                value={formData.bannerStyle}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="wide">Full Width</option>
                                <option value="boxed">Boxed (Contained)</option>
                                <option value="overlay">Overlay Text</option>
                                <option value="none">Hidden</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">Store Access</h3>
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl mb-4">
                        <div>
                            <p className="font-medium text-slate-800 dark:text-white">Online Ordering</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Allow customers to place orders</p>
                        </div>
                        <div className="relative inline-block w-12 mr-2 align-middle select-none">
                            <input
                                type="checkbox"
                                name="onlineOrderingEnabled"
                                id="toggle"
                                checked={formData.onlineOrderingEnabled}
                                onChange={handleChange}
                                className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer border-slate-300 checked:right-0 checked:border-green-400"
                            />
                            <label htmlFor="toggle" className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${formData.onlineOrderingEnabled ? 'bg-green-400' : 'bg-slate-300'}`}></label>
                        </div>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-70"
                    >
                        {isSaving ? <span className="animate-pulse">Saving...</span> : <><Save className="h-4 w-4" /> Save Changes</>}
                    </button>
                </div>

                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6">Store Banners</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        Add banners for your store's home page. You can add multiple banners with redirect links.
                    </p>

                    <div className="space-y-6">
                        {formData.banners.map((banner, index) => (
                            <div key={index} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 relative group transition-all hover:border-indigo-200 dark:hover:border-indigo-900">
                                <button
                                    onClick={() => handleRemoveBanner(index)}
                                    className="absolute -top-2 -right-2 p-1.5 bg-white dark:bg-slate-800 text-red-500 border border-slate-200 dark:border-slate-700 rounded-full shadow-sm opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all z-10"
                                    title="Remove Banner"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>

                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Banner Image URL</label>
                                        <input
                                            type="text"
                                            value={banner.imageUrl}
                                            onChange={(e) => handleBannerChange(index, 'imageUrl', e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                            placeholder="https://example.com/banner.jpg"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Redirect Link (Optional)</label>
                                        <input
                                            type="text"
                                            value={banner.redirectUrl}
                                            onChange={(e) => handleBannerChange(index, 'redirectUrl', e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                                            placeholder="e.g. /products/category/grocery"
                                        />
                                    </div>

                                    {banner.imageUrl && (
                                        <div className="mt-2 aspect-[3/1] bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">
                                            <img src={banner.imageUrl} alt={`Banner ${index + 1}`} className="w-full h-full object-cover" onError={(e) => e.target.style.display = 'none'} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={handleAddBanner}
                            className="w-full py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 rounded-xl font-medium hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500 transition-colors flex items-center justify-center gap-2"
                        >
                            <Plus className="h-4 w-4" />
                            Add New Banner
                        </button>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">Store Logo</h4>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Logo Image URL</label>
                            <input
                                type="text"
                                name="logoUrl"
                                value={formData.logoUrl}
                                onChange={handleChange}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs"
                                placeholder="https://..."
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
};

const StoreAbout = ({ storeData, onUpdate }) => {
    const [formData, setFormData] = useState({
        tagline: storeData?.tagline || '',
        aboutStory: storeData?.aboutStory || ''
    });
    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await updateOnlineStoreSettings(formData);
            if (response.success) {
                if (window.showToast) window.showToast('Description saved', 'success');
                onUpdate(response.data);
            }
        } catch (error) {
            if (window.showToast) window.showToast('Failed to save', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">About Your Store</h3>
                <p className="text-slate-500 dark:text-slate-400 mb-6">
                    Tell your customers about who you are, how you started, and what defines your brand. This information will appear on your online store's "About Us" page.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tagline (Optional)</label>
                        <input
                            type="text"
                            name="tagline"
                            value={formData.tagline}
                            onChange={handleChange}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. Freshness delivered daily"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Story & Description</label>
                        <textarea
                            rows={8}
                            name="aboutStory"
                            value={formData.aboutStory}
                            onChange={handleChange}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            placeholder="Write your story here..."
                        />
                    </div>

                    <div className="pt-4 flex justify-end">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-6 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white rounded-xl font-medium shadow-lg dark:shadow-none transition-all transform active:scale-95 flex items-center gap-2 disabled:opacity-70"
                        >
                            {isSaving ? 'Saving...' : <><Save className="h-5 w-5" /> Save Description</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StoreOrders = ({ initialOrder, onClearInitial }) => {
    const { state, dispatch } = useApp();

    // Direct data consumption for instant UI updates
    const onlineOrders = React.useMemo(() => {
        if (!state.orders || !Array.isArray(state.orders)) return [];
        return state.orders.filter(order =>
            (order.orderSource === 'online' || order.source === 'online') || order.source === 'online'
        ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }, [state.orders]);

    const ordersList = onlineOrders; // Alias for backward compatibility within this component
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Effect to handle initial order from dashboard
    useEffect(() => {
        if (initialOrder) {
            setSelectedOrder(initialOrder);
            onClearInitial?.();
        }
    }, [initialOrder]);
    const [updatingStatus, setUpdatingStatus] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');

    // Derived: Always get the absolute latest version of the selected order from the synced list
    const latestOrder = React.useMemo(() => {
        if (!selectedOrder) return null;
        const order = ordersList.find(o => o._id === selectedOrder._id || o.id === selectedOrder.id) || selectedOrder;

        // Derived pricing logic for consistency across all states
        const actualItemsSum = order.items?.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0) || 0;
        const dlvCharge = order.deliveryCharge !== undefined && order.deliveryCharge !== null ? order.deliveryCharge : Math.max(0, (order.totalAmount || 0) - actualItemsSum);
        const derivedSubtotal = (order.totalAmount || 0) - dlvCharge;

        return { ...order, derivedSubtotal, derivedDeliveryCharge: dlvCharge };
    }, [ordersList, selectedOrder]);

    // Print State
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [orderToPrint, setOrderToPrint] = useState(null);
    const [selectedPrintFormat, setSelectedPrintFormat] = useState('a4');

    // QR Scanner State
    const [showScanner, setShowScanner] = useState(false);
    const [showSuccessPopup, setShowSuccessPopup] = useState(false);
    const [lastVerifiedOrder, setLastVerifiedOrder] = useState(null);

    // Helper: Safe text drawing for PDF (handles Hindi/UTF-8)
    const safeDrawText = (doc, text, x, y, options = {}) => {
        if (!text) return;
        let displayText = text.toString();
        const maxWidth = options.maxWidth || 0;

        // Truncate if maxWidth is provided
        if (maxWidth > 0) {
            const currentFont = doc.getFont().fontName;
            const currentSize = doc.getFontSize();
            doc.setFont(options.font || 'helvetica', options.fontStyle || 'normal');
            doc.setFontSize(options.fontSize || 10);

            if (doc.getTextWidth(displayText) > maxWidth) {
                while (displayText.length > 0 && doc.getTextWidth(displayText + '...') > maxWidth) {
                    displayText = displayText.slice(0, -1);
                }
                displayText += '...';
            }
            // Restore font/size if needed (jsPDF state)
            doc.setFont(currentFont);
            doc.setFontSize(currentSize);
        }

        const isHindi = /[\u0900-\u097F\u20B9]/.test(displayText);
        if (isHindi) {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const fontSize = options.fontSize || 10;
                ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                const metrics = ctx.measureText(displayText);
                const fontScale = 2; // High resolution
                canvas.width = metrics.width * fontScale + 10;
                canvas.height = fontSize * fontScale * 1.5;
                ctx.scale(fontScale, fontScale);
                ctx.fillStyle = options.color || '#000000';
                ctx.font = `${fontSize}px "Noto Sans Devanagari", "Inter", sans-serif`;
                ctx.fillText(displayText, 0, fontSize);

                const dataUrl = canvas.toDataURL('image/png');
                const w = metrics.width / 3.78;
                const h = (fontSize * 1.5) / 3.78;

                let drawX = x;
                if (options.align === 'right') drawX -= w;
                else if (options.align === 'center') drawX -= w / 2;

                doc.addImage(dataUrl, 'PNG', drawX, y - (fontSize / 2.5), w, h);
            } catch (e) {
                doc.text(displayText, x, y, options);
            }
        } else {
            doc.text(displayText, x, y, options);
        }
    };

    // --- Thermal Bill Generation (Matches Billing.js/SalesOrderHistory) ---
    const generateThermalBill = async (size, invoiceNumber, billData) => {
        const width = size === '58mm' ? 58 : 80;
        const margin = 2; // small margin for thermal
        const centerX = width / 2;
        const items = billData.items || [];

        // Settings (Use state.currentUser as sellerSettings source in History)
        const settings = state.currentUser?.billSettings || {};
        const accentHex = settings.accentColor || '#2f3c7e';
        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 47, g: 60, b: 126 };
        };
        const rgb = hexToRgb(accentHex);

        const storeName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
        const address = state.currentUser?.shopAddress || state.storeAddress || '';
        const phone = state.currentUser?.phoneNumber || state.currentUser?.phone || state.storePhone || '';
        const gstin = state.currentUser?.gstNumber || state.storeGstin || '';

        // Strict priority: Invoice Number > formatted ID. Avoid showing raw MongoDB IDs (24 char hex).
        let displayInvNo = invoiceNumber || billData.invoiceNumber || billData.invoiceNo || billData.billNumber;

        // CRITICAL: If the resolved invoice number is a Mongo ID (24 hex chars), reject it and force fallback.
        if (displayInvNo && /^[0-9a-fA-F]{24}$/.test(String(displayInvNo))) {
            displayInvNo = null;
        }

        if (!displayInvNo) {
            // Fallbacks if no invoice number
            if (billData.id && String(billData.id).startsWith('ord-')) {
                displayInvNo = billData.id;
            } else if (billData.id && !/^[0-9a-fA-F]{24}$/.test(String(billData.id))) {
                // Use ID only if it's NOT a Mongo ID
                displayInvNo = billData.id;
            } else {
                // If all we have is a Mongo ID, try to show a cleaner date-based fallback or nothing
                displayInvNo = `INV-${new Date(billData.date || Date.now()).getTime().toString().slice(-6)}`;
            }
        }
        const billNo = displayInvNo;

        // Date formatting
        const dateObj = billData.date ? new Date(billData.date) : new Date();
        const dateStr = dateObj.toLocaleDateString('en-IN');

        const itemsTotal = items.reduce((acc, item) => {
            const { total } = calculateItemRateAndTotal(item);
            return acc + total;
        }, 0);
        const discountAmount = billData.discountAmount || billData.discount || 0;
        const grandTotal = billData.totalAmount || billData.total || (itemsTotal - discountAmount);

        // Fallback: Infer delivery charge if missing
        let deliveryCharge = billData.deliveryCharge || 0;
        if (!deliveryCharge && grandTotal > (itemsTotal - discountAmount + 1)) {
            deliveryCharge = grandTotal - (itemsTotal - discountAmount);
        }

        const sellerUpiIdValue = billData.upiId || state.currentUser?.upiId;

        // Helper: Draw Content
        const drawContent = async (pdf) => {
            let y = 5;

            const drawDashedLine = (yPos) => {
                pdf.setLineDash([1, 1], 0);
                pdf.setDrawColor(0);
                pdf.line(margin, yPos, width - margin, yPos);
                pdf.setLineDash([], 0);
            };

            // HEADER
            // HEADER - Logo logic
            /* Logo Removed
            const logoUrl = state.storeLogo || state.currentUser?.logoUrl || settings.logoUrl;
            if (logoUrl) {
                // ... logo code removed ...
            }
            */

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(0, 0, 0);
            pdf.text("TAX INVOICE", centerX, y, { align: 'center' });
            y += 5;

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(size === '58mm' ? 10 : 12);
            pdf.setTextColor(rgb.r, rgb.g, rgb.b);

            const storeNameLines = pdf.splitTextToSize(storeName, width - 4);
            pdf.text(storeNameLines, centerX, y, { align: 'center' });
            y += (storeNameLines.length * 4) + 1;

            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);

            if (address) {
                const addrLines = pdf.splitTextToSize(address, width - 4);
                pdf.text(addrLines, centerX, y, { align: 'center' });
                y += (addrLines.length * 3.5);
            }

            if (phone) {
                pdf.text(`Contact: ${phone}`, centerX, y, { align: 'center' });
                y += 3.5;
            }

            if (gstin) {
                pdf.text(`GSTIN: ${gstin}`, centerX, y, { align: 'center' });
                y += 4;
            }

            y += 2;
            const metaY = y;
            pdf.setFontSize(8);
            pdf.setTextColor(150, 0, 0);
            pdf.text("Inv No", margin, metaY);
            const invLabelWidth = pdf.getTextWidth("Inv No ");

            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'bold');

            let displayBillNo = billNo;

            if (size === '58mm') {
                pdf.text(displayBillNo, margin, metaY + 3.5);
                y += 4;
            } else {
                pdf.text(displayBillNo, margin + invLabelWidth, metaY);
            }

            const dateValWidth = pdf.getTextWidth(dateStr);
            pdf.text(dateStr, width - margin, metaY, { align: 'right' });
            pdf.setTextColor(150, 0, 0);
            const dateLabelWidth = pdf.getTextWidth("Date ");
            pdf.text("Date ", width - margin - dateValWidth - dateLabelWidth, metaY);

            pdf.setTextColor(0, 0, 0);
            y += 5;

            // Customer Info
            const displayCustomerName = billData.customerName || 'Walk-in Customer';
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Customer name: ${displayCustomerName}`, margin, y);
            y += 4;

            if (billData.customerMobile) {
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.text(`Mobile no.: ${billData.customerMobile}`, margin, y);
                y += 4;
            }

            drawDashedLine(y);
            y += 3;

            // TABLE HEADER
            pdf.setFontSize(size === '58mm' ? 7 : 8);
            pdf.setFont('helvetica', 'bold');

            const cols = size === '58mm' ? [
                { name: "Sl.No.", x: margin, align: 'left' },
                { name: "Item Name", x: margin + 8, align: 'left' },
                { name: "QTY.", x: width - margin - 22, align: 'right' },
                { name: "Price", x: width - margin - 12, align: 'right' },
                { name: "Amount", x: width - margin, align: 'right' }
            ] : [
                { name: "Sl.No.", x: margin, align: 'left' },
                { name: "Item Name", x: margin + 10, align: 'left' },
                { name: "QTY.", x: width - margin - 28, align: 'right' }, // Was 35, moved right to ~50
                { name: "Price", x: width - margin - 15, align: 'right' }, // Was 18, moved right to ~63
                { name: "Amount", x: width - margin, align: 'right' }
            ];

            cols.forEach(c => pdf.text(c.name, c.x, y, { align: c.align }));
            y += 2;
            drawDashedLine(y);
            y += 3;

            // TABLE BODY
            pdf.setFont('helvetica', 'bold');
            let totalQty = 0;
            items.forEach((item, index) => {
                const { rate, total, qty, unit } = calculateItemRateAndTotal(item);
                totalQty += qty;

                pdf.text(String(index + 1), cols[0].x, y);
                const maxItemWidth = size === '58mm' ? 22 : 32; // Reduced/Optimized for 80mm to prevent overlap
                const nameLines = pdf.splitTextToSize(item.name || 'Item', maxItemWidth);
                pdf.text(nameLines, cols[1].x, y);

                pdf.text(qty.toFixed(2), cols[2].x, y, { align: 'right' });
                pdf.text(rate.toFixed(2), cols[3].x, y, { align: 'right' });
                pdf.text(total.toFixed(2), cols[4].x, y, { align: 'right' });

                y += (nameLines.length * 3.5);
            });

            drawDashedLine(y);
            y += 3;

            // TOTALS
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Total Item(s): ${items.length}`, margin, y);
            const qtyText = `Qty.: ${totalQty.toFixed(2)}`;
            const qtyX = width / 2;
            pdf.text(qtyText, qtyX, y, { align: 'center' });
            pdf.text(Number(itemsTotal).toFixed(2), width - margin, y, { align: 'right' });

            y += 3;
            drawDashedLine(y);
            y += 4;

            // GST Details
            const gstSummary = {};
            items.forEach(item => {
                const gst = item.gstPercent || 0;
                if (gst > 0) {
                    const { total } = calculateItemRateAndTotal(item);
                    if (!gstSummary[gst]) gstSummary[gst] = { taxable: 0, tax: 0 };
                    const isInclusive = item.isGstInclusive !== false;
                    let taxAmt = 0;
                    let taxable = 0;
                    if (isInclusive) {
                        taxable = total / (1 + gst / 100);
                        taxAmt = total - taxable;
                    } else {
                        taxable = total;
                        taxAmt = total * (gst / 100);
                    }
                    gstSummary[gst].taxable += taxable;
                    gstSummary[gst].tax += taxAmt;
                }
            });

            if (Object.keys(gstSummary).length > 0) {
                pdf.setFontSize(size === '58mm' ? 6 : 7);
                pdf.setFont('helvetica', 'normal');
                const gCols = size === '58mm' ? [
                    { n: "Tax %", x: margin },
                    { n: "Taxable", x: margin + 11 },
                    { n: "CGST", x: margin + 30 },
                    { n: "SGST", x: margin + 38 },
                    { n: "GST", x: width - margin - 5, align: 'center' }
                ] : [
                    { n: "Tax %", x: margin },
                    { n: "Taxable Val", x: margin + 12 },
                    { n: "CGST", x: margin + 32 },
                    { n: "SGST", x: margin + 46 },
                    { n: "GST", x: width - margin - 12, align: 'center' }
                ];

                gCols.forEach(c => pdf.text(c.n, c.x, y, { align: c.align || 'left' }));
                y += 3;
                Object.keys(gstSummary).forEach(rate => {
                    const row = gstSummary[rate];
                    const halfTax = row.tax / 2;
                    pdf.text(Number(rate).toFixed(2), gCols[0].x, y);
                    pdf.text(row.taxable.toFixed(2), gCols[1].x + 2, y, { align: 'center' });
                    pdf.text(halfTax.toFixed(2), gCols[2].x, y);
                    pdf.text(halfTax.toFixed(2), gCols[3].x, y);
                    pdf.text(row.tax.toFixed(2), gCols[4].x, y, { align: 'center' });
                    y += 3;
                });
                drawDashedLine(y);
                y += 4;
            }

            // Delivery Charge
            if (deliveryCharge > 0) {
                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'normal');
                pdf.text("Delivery Charge", margin, y);
                pdf.text(Number(deliveryCharge).toFixed(2), width - margin, y, { align: 'right' });
                y += 4;
            }

            // FINAL BIG TOTAL
            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            y += 2;
            pdf.text("Total", margin, y);
            pdf.text(Number(grandTotal).toFixed(2), width - margin, y, { align: 'right' });
            y += 6;
            drawDashedLine(y);
            y += 4;

            // FOOTER
            if (settings.showFooter !== false) {
                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'bold');
                pdf.text("Terms and Conditions", centerX, y, { align: 'center' });
                y += 4;

                pdf.setFontSize(7);
                pdf.setFont('helvetica', 'normal');
                const termsText = settings.termsAndConditions || "";
                if (termsText) {
                    const splitTerms = pdf.splitTextToSize(termsText, width - 4);
                    splitTerms.forEach(l => { pdf.text(l, centerX, y, { align: 'center' }); y += 3; });
                }
                y += 2;

                const footerMsg = settings.footerMessage || "Thank you, visit again";
                const splitFooter = pdf.splitTextToSize(footerMsg, width - 4);
                pdf.setFont('helvetica', 'bold');
                splitFooter.forEach(l => { pdf.text(l, centerX, y, { align: 'center' }); y += 3; });
                y += 3;

                pdf.setFontSize(8);
                pdf.setFont('helvetica', 'bold');
                pdf.text("Thank You", centerX, y, { align: 'center' });
                y += 4;
            }

            // QR CODE
            if (Number(grandTotal) > 0 && sellerUpiIdValue) {
                try {
                    const upiUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${Number(grandTotal).toFixed(2)}&cu=INR&tn=Bill%20Payment`;
                    const qrResult = await QRCode.toDataURL(upiUrl, { margin: 1, width: 120 });
                    if (qrResult) {
                        const qrSize = size === '58mm' ? 25 : 30;
                        pdf.addImage(qrResult, 'PNG', centerX - (qrSize / 2), y, qrSize, qrSize);
                        y += qrSize + 4;
                    }
                } catch (e) { }
            }

            // Powered By Branding
            try {
                const publicUrl = process.env.PUBLIC_URL || '';
                const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
                const gsLogoRes = await fetch(gsLogo).catch(() => null);
                if (gsLogoRes && gsLogoRes.ok) {
                    const blob = await gsLogoRes.blob();
                    const base64 = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => r(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    y += 2;
                    pdf.setFontSize(6);
                    pdf.setTextColor(160, 160, 160);
                    pdf.setFont('helvetica', 'normal');
                    pdf.text('Powered by ', centerX - 5, y + 3, { align: 'right' });
                    pdf.addImage(base64, 'PNG', centerX - 4.2, y + 0.2, 3.5, 3.5);
                    pdf.setFont('helvetica', 'bold');
                    pdf.text('Inventory Studio', centerX + 0.5, y + 3, { align: 'left' });
                    y += 6;
                }
            } catch (e) { }

            return y + 2;
        };

        const tempPdf = new jsPDF('p', 'mm', [width, 1000]);
        const finalHeight = await drawContent(tempPdf);
        const pdf = new jsPDF('p', 'mm', [width, finalHeight]);
        await drawContent(pdf);

        // Watermark
        const sellerLogoUrl = state.storeLogo || state.currentUser?.logoUrl || settings.logoUrl;
        // await addWatermarkToPDF(pdf, sellerLogoUrl || undefined);

        pdf.save(`Receipt-${displayInvNo}.pdf`);
    };

    // --- A4 Bill Generation (Matches Billing.js/SalesOrderHistory) ---
    const generateA4Bill = async (billData) => {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;

        const settings = state.currentUser?.billSettings || {};
        const accentHex = settings.colors?.accent || settings.accentColor || '#2f3c7e';
        const hexToRgb = (hex) => {
            const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return res ? [parseInt(res[1], 16), parseInt(res[2], 16), parseInt(res[3], 16)] : [47, 60, 126];
        };
        const accentColor = hexToRgb(accentHex);

        const COLORS = {
            accent: accentColor,
            text: [30, 41, 59],
            slate400: [148, 163, 184],
            slate50: [248, 250, 252],
            border: [241, 245, 249],
            white: [255, 255, 255]
        };

        // 1. Header Bar
        pdf.setFillColor(0, 0, 0); // Black top bar
        pdf.rect(0, 0, pageWidth, 2, 'F');
        let y = 10;

        // 2. Header
        const logoOffset = 0;
        /* Logo Removed
        const logoShow = settings.showLogo !== false;
        if (logoShow) {
            // ... logo code removed ...
        }
        */

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(22);
        pdf.setTextColor(...COLORS.accent);
        const storeName = state.storeName || state.currentUser?.shopName || 'Grocery Store';
        safeDrawText(pdf, storeName.toUpperCase(), margin + logoOffset, y + 6, { fontSize: 22, color: `rgb(${COLORS.accent.join(',')})` });

        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.slate400);
        pdf.text('PREMIUM RETAIL PARTNER', margin + logoOffset, y + 11);

        pdf.setFillColor(...COLORS.slate50);
        pdf.roundedRect(pageWidth - margin - 45, y, 45, 10, 2, 2, 'F');
        pdf.setFontSize(13);
        pdf.setTextColor(...COLORS.text);
        pdf.text('TAX INVOICE', pageWidth - margin - 22.5, y + 6.5, { align: 'center' });

        y += 20;

        // Shop Address
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(1);
        pdf.line(margin, y, margin, y + 15);
        pdf.setFontSize(9);
        pdf.setTextColor(71, 85, 105);

        const mainAddr = state.currentUser?.shopAddress || state.storeAddress || '';
        if (mainAddr) pdf.text(mainAddr, margin + 4, y + 3);

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 116, 139);

        const addr2 = [state.currentUser?.city, state.currentUser?.state, state.currentUser?.pincode].filter(Boolean).join(' - ');
        if (addr2) pdf.text(addr2, margin + 4, y + 7);

        const phone = state.currentUser?.phoneNumber || state.currentUser?.phone || state.storePhone || '';
        if (phone) pdf.text(`Phone: ${phone}`, margin + 4, y + 11);

        const gstin = state.currentUser?.gstNumber || state.storeGstin || '';
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLORS.text);
        if (gstin) pdf.text(`GSTIN: ${gstin}`, margin + 4, y + 15);

        // Bill Info
        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.slate400);
        const labelX = pageWidth - margin - 25;
        pdf.text('Invoice No', labelX, y + 15, { align: 'right' });
        pdf.text('Date', labelX, y + 20, { align: 'right' });
        pdf.text('Payment', labelX, y + 25, { align: 'right' });

        pdf.setTextColor(...COLORS.text);
        let displayInvNo = billData.invoiceNumber || billData.invoiceNo || billData.billNumber;

        if (!displayInvNo) {
            if (billData.id && String(billData.id).startsWith('ord-')) {
                displayInvNo = billData.id;
            } else if (billData.id && !/^[0-9a-fA-F]{24}$/.test(String(billData.id))) {
                displayInvNo = billData.id;
            } else {
                displayInvNo = `INV-${new Date(billData.date || Date.now()).getTime().toString().slice(-6)}`;
            }
        }

        pdf.text(String(displayInvNo), pageWidth - margin, y + 15, { align: 'right' });
        const dateStr = billData.date ? new Date(billData.date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
        pdf.text(dateStr, pageWidth - margin, y + 20, { align: 'right' });
        const pMethod = (billData.paymentMethod || 'PAID').toUpperCase();
        pdf.text(pMethod, pageWidth - margin, y + 25, { align: 'right' });

        if (pMethod === 'SPLIT' && billData.splitPaymentDetails) {
            const parts = [];
            if (billData.splitPaymentDetails.cashAmount > 0) parts.push(`Cash: ${Number(billData.splitPaymentDetails.cashAmount).toFixed(2)}`);
            if (billData.splitPaymentDetails.onlineAmount > 0) parts.push(`Online: ${Number(billData.splitPaymentDetails.onlineAmount).toFixed(2)}`);
            if (billData.splitPaymentDetails.dueAmount > 0) parts.push(`Due: ${Number(billData.splitPaymentDetails.dueAmount).toFixed(2)}`);

            if (parts.length > 0) {
                pdf.setFontSize(7);
                pdf.setTextColor(...COLORS.slate400);
                pdf.text(parts.join(', '), pageWidth - margin, y + 29, { align: 'right' });
            }
        }

        y += 35;

        // 3. Bill To
        pdf.setDrawColor(...COLORS.border);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 6;
        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.slate400);
        pdf.text('BILL TO', margin, y);
        pdf.text('PLACE OF SUPPLY', pageWidth - margin, y, { align: 'right' });
        y += 5;
        pdf.setFontSize(10);
        pdf.setTextColor(...COLORS.text);
        safeDrawText(pdf, (billData.customerName || 'Walk-in Customer').toUpperCase(), margin, y, { fontSize: 10 });
        pdf.text('LOCAL (WITHIN STATE)', pageWidth - margin, y, { align: 'right' });
        y += 8;
        pdf.line(margin, y, pageWidth - margin, y);
        y += 10;

        // 4. Table Header
        pdf.setFillColor(0, 0, 0); // Black header
        pdf.roundedRect(margin, y, pageWidth - margin * 2, 10, 2, 2, 'F');
        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.white);
        pdf.text('#', margin + 4, y + 6.5);
        pdf.text('ITEM DESCRIPTION', margin + 12, y + 6.5);
        pdf.text('QTY', margin + 100, y + 6.5, { align: 'center' });
        pdf.text('RATE', margin + 130, y + 6.5, { align: 'right' });
        pdf.text('GST %', margin + 155, y + 6.5, { align: 'right' });
        pdf.text('AMOUNT', pageWidth - margin - 4, y + 6.5, { align: 'right' });
        y += 10;

        // Items
        const items = billData.items || [];
        let totalTaxable = 0;
        let totalGst = 0;

        items.forEach((item, idx) => {
            const rowH = 12;
            if (y + rowH > pageHeight - 60) { pdf.addPage(); y = 20; }
            if (idx % 2 === 1) { pdf.setFillColor(...COLORS.slate50); pdf.rect(margin, y, pageWidth - margin * 2, rowH, 'F'); }

            const { rate, total, qty, unit } = calculateItemRateAndTotal(item);

            pdf.setTextColor(...COLORS.slate400);
            pdf.text(String(idx + 1), margin + 4, y + 7.5);

            pdf.setTextColor(...COLORS.text);
            pdf.setFont('helvetica', 'bold');
            safeDrawText(pdf, item.name || 'Item', margin + 12, y + 6, { fontSize: 9 });

            pdf.setFontSize(7);
            pdf.setTextColor(...COLORS.slate400);
            pdf.setFont('helvetica', 'normal');
            pdf.text(`HSN: ${item.hsnCode || '1001'} • CGST+SGST`, margin + 12, y + 10);

            pdf.setFontSize(9);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`${qty} ${unit}`, margin + 100, y + 7.5, { align: 'center' });
            pdf.text(rate.toFixed(2), margin + 130, y + 7.5, { align: 'right' });
            pdf.text(`${item.gstPercent || 0}%`, margin + 155, y + 7.5, { align: 'right' });
            pdf.text(total.toFixed(2), pageWidth - margin - 4, y + 7.5, { align: 'right' });

            // Tax Calc
            const gst = item.gstPercent || 0;
            const isInclusive = item.isGstInclusive !== false;
            let taxable, lineGst;
            if (isInclusive) {
                taxable = total / (1 + gst / 100);
                lineGst = total - taxable;
            } else {
                taxable = total;
                lineGst = total * (gst / 100);
            }
            totalTaxable += taxable;
            totalGst += lineGst;

            y += rowH;
        });

        // 5. Totals & Footer
        y += 10;
        pdf.setDrawColor(...COLORS.border);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 10;

        const discountAmount = billData.discountAmount || billData.discount || 0;
        const itemsTotal = items.reduce((acc, i) => acc + calculateItemRateAndTotal(i).total, 0);
        const grandTotal = billData.totalAmount || billData.total || (itemsTotal - discountAmount);

        // Fallback: Infer delivery charge if missing
        let deliveryCharge = billData.deliveryCharge || 0;
        if (!deliveryCharge && grandTotal > (itemsTotal - discountAmount + 1)) {
            deliveryCharge = grandTotal - (itemsTotal - discountAmount);
        }

        const footerY = y;

        // Left Side: Terms
        const leftColW = 100;
        if (settings.showFooter !== false) {
            pdf.setFontSize(8);
            pdf.setTextColor(...COLORS.slate400);
            pdf.setFont('helvetica', 'bold');
            pdf.text('TERMS & CONDITIONS', margin, y);
            y += 4;

            pdf.setFillColor(...COLORS.slate50);
            pdf.setDrawColor(...COLORS.border);
            const terms = settings.termsAndConditions || "1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.";
            const termsLines = pdf.splitTextToSize(terms, leftColW - 10);
            const termsH = (termsLines.length * 4) + 8;
            pdf.roundedRect(margin, y, leftColW, termsH, 3, 3, 'FD');

            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(7);
            pdf.setTextColor(100, 116, 139);
            pdf.text(termsLines, margin + 5, y + 5);
            y += termsH + 10;
        }

        // QR Code
        const sellerUpiIdValue = billData.upiId || state.currentUser?.upiId;
        if (grandTotal > 0 && sellerUpiIdValue && sellerUpiIdValue.includes('@')) {
            try {
                const qrUrl = `upi://pay?pa=${sellerUpiIdValue}&am=${grandTotal.toFixed(2)}&cu=INR&tn=Bill%20Payment`;
                const qrImg = await QRCode.toDataURL(qrUrl, { margin: 1, width: 100 });
                pdf.addImage(qrImg, 'PNG', margin, y, 20, 20);
                pdf.setFontSize(7);
                pdf.setTextColor(...COLORS.slate400);
                pdf.setFont('helvetica', 'bold');
                pdf.text('SCAN TO PAY', margin + 25, y + 8);
            } catch (e) { }
        }

        // Right Side: Totals
        y = footerY;
        const rightColX = pageWidth - margin - 60;
        const valX = pageWidth - margin;

        pdf.setFontSize(9);
        pdf.setTextColor(...COLORS.slate400);
        pdf.setFont('helvetica', 'bold');
        pdf.text('SUB TOTAL', rightColX, y);
        pdf.setTextColor(...COLORS.text);
        pdf.text(`Rs. ${itemsTotal.toFixed(2)}`, valX, y, { align: 'right' });

        y += 6;
        pdf.setTextColor(...COLORS.slate400);
        pdf.text('TAX (GST)', rightColX, y);
        pdf.setTextColor(...COLORS.text);
        pdf.text(`Rs. ${totalGst.toFixed(2)}`, valX, y, { align: 'right' });

        if (discountAmount > 0) {
            y += 6;
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('DISCOUNT', rightColX, y);
            pdf.setTextColor(220, 38, 38);
            pdf.text(`- Rs. ${discountAmount.toFixed(2)}`, valX, y, { align: 'right' });
        }

        if (deliveryCharge > 0) {
            y += 6;
            pdf.setTextColor(...COLORS.slate400);
            pdf.text('DELIVERY CHARGE', rightColX, y);
            pdf.setTextColor(...COLORS.text);
            pdf.text(`Rs. ${Number(deliveryCharge).toFixed(2)}`, valX, y, { align: 'right' });
        }

        y += 10;
        pdf.setDrawColor(30, 41, 59);
        pdf.setLineWidth(0.8);
        pdf.line(rightColX, y - 4, valX, y - 4);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(30, 41, 59);
        pdf.text('GRAND TOTAL', rightColX, y + 4);
        pdf.setTextColor(30, 41, 59);
        pdf.text(`Rs. ${grandTotal.toFixed(2)}`, valX, y + 4, { align: 'right' });

        y += 30;
        pdf.setDrawColor(...COLORS.border);
        pdf.setLineWidth(0.2);
        pdf.setLineDash([1, 1], 0);
        pdf.line(valX - 50, y, valX, y);
        pdf.setLineDash([], 0);

        pdf.setFontSize(8);
        pdf.setTextColor(...COLORS.text);
        pdf.setFont('helvetica', 'bold');
        pdf.text('AUTHORIZED SIGNATORY', valX - 25, y + 5, { align: 'center' });

        // 6. Watermark
        const sellerLogoUrl = state.storeLogo || state.currentUser?.logoUrl || settings.logoUrl;
        // await addWatermarkToPDF(pdf, sellerLogoUrl || undefined);

        // 7. Powered By Branding
        try {
            const publicUrl = process.env.PUBLIC_URL || '';
            const gsLogo = `${publicUrl}/assets/inventory-studio-logo-removebg.png`;
            const gsLogoRes = await fetch(gsLogo).catch(() => null);
            if (gsLogoRes && gsLogoRes.ok) {
                const blob = await gsLogoRes.blob();
                const base64 = await new Promise(r => {
                    const reader = new FileReader();
                    reader.onloadend = () => r(reader.result);
                    reader.readAsDataURL(blob);
                });
                const gsY = pageHeight - 7;
                pdf.setFontSize(6);
                pdf.setTextColor(160, 160, 160);
                pdf.setFont('helvetica', 'normal');
                pdf.text('Powered by ', pageWidth / 2 - 5, gsY, { align: 'right' });
                pdf.addImage(base64, 'PNG', pageWidth / 2 - 4.2, gsY - 2.8, 3.5, 3.5);
                pdf.setFont('helvetica', 'bold');
                pdf.text('Inventory Studio', pageWidth / 2 + 0.5, gsY, { align: 'left' });
            }
        } catch (e) { }

        pdf.save(`Invoice-${billData.invoiceNumber || billData.id}.pdf`);
    };

    const initiatePrint = (order) => {
        setOrderToPrint(order);
        setShowPrintModal(true);
    };

    const executePrint = async (format) => {
        const order = orderToPrint;
        if (!order) return;

        try {
            // Map order data to standard bill format
            const billData = {
                ...order,
                // Ensure internal ID is preserved
                id: order.id || order._id,
                // Prioritize explicit invoice number, else fallback
                invoiceNumber: order.invoiceNumber || order.invoiceNo || order.billNumber,
                customerName: order.customerName,
                customerMobile: order.customerMobile,
                items: order.items,
                // Ensure total is numeric
                totalAmount: order.totalAmount || order.total,
                date: order.createdAt || order.date,
                upiId: order.upiId || state.currentUser?.upiId,
                paymentMethod: order.paymentMethod,
                splitPaymentDetails: order.splitPaymentDetails
            };

            // Fix empty invoice number or mongo ID issues by generating a short fallback if needed
            if (!billData.invoiceNumber || /^[0-9a-fA-F]{24}$/.test(String(billData.invoiceNumber))) {
                billData.invoiceNumber = (billData.id || '').toString().slice(-6).toUpperCase();
            }

            if (format === 'a4') {
                await generateA4Bill(billData);
            } else {
                await generateThermalBill(format, billData.invoiceNumber, billData);
            }
            setShowPrintModal(false);
            setOrderToPrint(null);
        } catch (e) {
            console.error(e);
            if (window.showToast) window.showToast("Print failed", "error");
        }
    };

    const handleShareInvoice = (order) => {
        if (!order) return;
        const customerMobile = sanitizeMobileNumber(order.customerMobile || order.customerPhone || '');
        if (!customerMobile) {
            if (window.showToast) window.showToast('No customer mobile found', 'warning');
            return;
        }

        const identifier = order.invoiceNumber || order.id || order._id;
        const billUrl = `${window.location.origin}/view-bill/${identifier}`;
        let messageText = `Hi ${order.customerName || 'Customer'},\nYour bill is ready. View it here:\n${billUrl}`;
        const waUrl = `https://wa.me/91${customerMobile}?text=${encodeURIComponent(messageText)}`;
        window.open(waUrl, '_blank');
    };
    const filteredOrders = React.useMemo(() => {
        return ordersList.filter(order => {
            const matchesSearch =
                order._id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                order.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                order.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'All' || order.orderStatus === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [ordersList, searchQuery, statusFilter]);

    const handleScan = async (decodedText) => {
        if (!selectedOrder) return;

        const orderId = selectedOrder._id || selectedOrder.id;
        const scannedVal = decodedText.trim();

        try {
            if (window.showToast) window.showToast('Verifying delivery with server...', 'info');

            // Server-side verification
            const res = await verifyOnlineOrderDelivery(orderId, scannedVal);

            if (res && res.success) {
                const serverOrder = res.data;

                // 2. Prepare normalized order for UI update
                // Find original order to preserve populated fields (customer info etc)
                const originalOrder = onlineOrders.find(o => o._id === orderId || o.id === orderId) || selectedOrder;

                const normalizedOrder = {
                    ...originalOrder,
                    ...serverOrder,
                    orderStatus: 'Delivered', // Force it exactly as backend would
                    _id: serverOrder._id || orderId,
                    id: serverOrder._id || orderId,
                    isSynced: true,
                    syncedAt: new Date().toISOString()
                };

                // 3. Update Global Context FIRST for instant UI feedback
                dispatch({
                    type: ActionTypes.UPDATE_ORDER,
                    payload: normalizedOrder
                });

                // 4. Update IndexedDB for persistent storage
                await updateItem(STORES.orders, normalizedOrder, true);

                // 5. Update Local Component State
                setSelectedOrder(normalizedOrder);
                setLastVerifiedOrder(normalizedOrder);
                setShowScanner(false);

                // 6. Show success popup
                setTimeout(() => {
                    setShowSuccessPopup(true);
                }, 400);

                // 7. Trigger a slightly delayed background sync to ensure absolute alignment
                // We delay it slightly so the local status change is "seen" by the UI first
                setTimeout(() => {
                    backgroundSyncWithBackend(dispatch, ActionTypes, { forceFullSync: false });
                }, 2000);
            } else {
                if (window.showToast) window.showToast(res.message || 'Invalid QR Code', 'error');
                console.warn('Backend verification failed:', res);
            }
        } catch (error) {
            console.error('Delivery verification failed:', error);
            if (window.showToast) window.showToast('Verification error. Please try again.', 'error');
        }
    };

    const handleStatusUpdate = async (orderId, newStatus) => {
        setUpdatingStatus(orderId);
        try {
            const response = await updateOnlineOrderStatus(orderId, newStatus);
            if (response.success) {
                if (window.showToast) window.showToast(`Order status updated to ${newStatus}`, 'success');

                // Update local selectedOrder state for modal UI
                if (selectedOrder && (selectedOrder._id === orderId || selectedOrder.id === orderId)) {
                    setSelectedOrder({ ...selectedOrder, orderStatus: newStatus });
                }

                // IMPORTANT: Update global state instantly for the table UI
                // Find the original order in ordersList to ensure we have all fields
                const originalOrder = ordersList.find(o => o._id === orderId || o.id === orderId);
                let updatedOrderPayload = {
                    ...originalOrder,
                    orderStatus: newStatus,
                    id: originalOrder._id || originalOrder.id
                };

                // Generate Invoice Number if Delivered/Completed
                if (newStatus === 'Delivered' || newStatus === 'Completed') {
                    if (originalOrder && !originalOrder.invoiceNumber && originalOrder.customerMobile) {
                        try {
                            const res = await apiRequest('/public/verify-bill', {
                                method: 'POST',
                                body: {
                                    invoiceNo: orderId,
                                    mobileNumber: originalOrder.customerMobile
                                }
                            });
                            if (res && res.success && res.order && res.order.invoiceNumber) {
                                updatedOrderPayload.invoiceNumber = res.order.invoiceNumber;
                                if (selectedOrder && (selectedOrder._id === orderId || selectedOrder.id === orderId)) {
                                    setSelectedOrder(prev => ({ ...prev, invoiceNumber: res.order.invoiceNumber }));
                                }
                            }
                        } catch (e) {
                            console.error("Failed to generate invoice number", e);
                        }
                    }
                }

                if (originalOrder) {
                    dispatch({
                        type: ActionTypes.UPDATE_ORDER,
                        payload: updatedOrderPayload
                    });

                    // INSTANT STOCK REFLECTION: If cancelling, restore stock locally immediately
                    if (newStatus === 'Cancelled' && originalOrder.orderStatus !== 'Cancelled') {
                        const restoreStockLocally = async () => {
                            try {
                                const items = originalOrder.items || [];
                                const allProducts = await getAllItems(STORES.products);
                                const allBatches = await getAllItems(STORES.productBatches);

                                for (const item of items) {
                                    const rawProductId = item.productId || item._id;
                                    const productIdStr = typeof rawProductId === 'object' ? rawProductId.toString() : String(rawProductId);
                                    const restoredQty = Number(item.quantity) || 0;

                                    // 1. Find Product (robust match)
                                    const product = allProducts.find(p =>
                                        String(p.id) === productIdStr ||
                                        String(p._id) === productIdStr ||
                                        (p.localId && String(p.localId) === productIdStr)
                                    );

                                    if (product) {
                                        // Update Product Stock
                                        const updatedProduct = {
                                            ...product,
                                            stock: (Number(product.stock) || 0) + restoredQty,
                                            quantity: (Number(product.quantity) || 0) + restoredQty,
                                            isSynced: false
                                        };

                                        // Update IndexedDB
                                        await updateItem(STORES.products, updatedProduct);

                                        // Update Context (for UI)
                                        dispatch({
                                            type: ActionTypes.UPDATE_PRODUCT,
                                            payload: updatedProduct
                                        });

                                        // 2. Find and Update Batches
                                        const productBatches = allBatches.filter(b => {
                                            const bProdId = b.productId;
                                            const bProdIdStr = typeof bProdId === 'object' ? bProdId.toString() : String(bProdId);
                                            // Check against both item product ID and the found product's actual ID
                                            const pId = product.id ? String(product.id) : '';
                                            const pIdMongo = product._id ? String(product._id) : '';

                                            return (bProdIdStr === productIdStr || bProdIdStr === pId || bProdIdStr === pIdMongo) && !b.isDeleted;
                                        }).sort((a, b) => {
                                            // Sort by expiry desc, then createdAt desc
                                            const dateA = a.expiry ? new Date(a.expiry) : new Date(0);
                                            const dateB = b.expiry ? new Date(b.expiry) : new Date(0);
                                            if (dateB - dateA !== 0) return dateB - dateA;
                                            return new Date(b.createdAt) - new Date(a.createdAt);
                                        });

                                        if (productBatches.length > 0) {
                                            const targetBatch = productBatches[0];
                                            const updatedBatch = {
                                                ...targetBatch,
                                                quantity: (Number(targetBatch.quantity) || 0) + restoredQty,
                                                isSynced: false
                                            };

                                            await updateItem(STORES.productBatches, updatedBatch);
                                            dispatch({
                                                type: ActionTypes.UPDATE_PRODUCT_BATCH,
                                                payload: updatedBatch
                                            });
                                        }
                                    } else {
                                        console.warn(`Product not found locally for ID: ${productIdStr}`);
                                    }
                                }
                                if (window.showToast) window.showToast('Stock restored instantly', 'success');
                            } catch (err) {
                                console.error('Error restoring local stock:', err);
                            }
                        };
                        restoreStockLocally();
                    }
                }

                setTimeout(() => setSelectedOrder(null), 500);
            }
        } catch (error) {
            console.error('Failed to update status', error);
            if (window.showToast) window.showToast('Failed to update status', 'error');
        } finally {
            setUpdatingStatus(null);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Pending': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
            case 'Processing': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
            case 'Out for Delivery': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400';
            case 'Delivered': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
            case 'Completed': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
            case 'Cancelled': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
            default: return 'bg-slate-100 text-slate-700';
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 md:rounded-2xl shadow-sm border-y md:border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Online Orders</h3>
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search orders..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>
            </div>

            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[10px] md:text-xs uppercase font-medium">
                            <th className="p-3 md:p-4 rounded-tl-lg">ID</th>
                            <th className="p-3 md:p-4">Customer</th>
                            <th className="p-3 md:p-4 hidden sm:table-cell">Items</th>
                            <th className="p-3 md:p-4">Total</th>
                            <th className="p-3 md:p-4">Status</th>
                            <th className="p-3 md:p-4 hidden lg:table-cell">Date</th>
                            <th className="p-3 md:p-4 rounded-tr-lg text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {filteredOrders.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="p-8 text-center text-slate-500 dark:text-slate-400">
                                    No orders found
                                </td>
                            </tr>
                        ) : (
                            filteredOrders.map((order) => (
                                <tr
                                    key={order._id}
                                    onClick={() => setSelectedOrder(order)}
                                    className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer group"
                                >
                                    <td className="p-3 md:p-4 font-medium text-indigo-600 dark:text-indigo-400 text-xs md:text-sm">
                                        {order.invoiceNumber || `#${order._id.slice(-6).toUpperCase()}`}
                                    </td>
                                    <td className="p-3 md:p-4 text-slate-800 dark:text-slate-200 font-medium text-xs md:text-sm">{order.customerName || 'Unknown'}</td>
                                    <td className="p-3 md:p-4 text-slate-600 dark:text-slate-400 text-xs md:text-sm hidden sm:table-cell">{order.items?.length || 0} items</td>
                                    <td className="p-3 md:p-4 text-slate-800 dark:text-slate-200 font-semibold text-xs md:text-sm">{formatCurrencySmart(order.totalAmount, state.currencyFormat)}</td>
                                    <td className="p-3 md:p-4">
                                        <span className={`px-2 md:px-2.5 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-semibold ${getStatusColor(order.orderStatus)}`}>
                                            {order.orderStatus}
                                        </span>
                                    </td>
                                    <td className="p-3 md:p-4 text-slate-500 dark:text-slate-400 text-xs hidden lg:table-cell">
                                        <div className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {new Date(order.createdAt).toLocaleDateString()}
                                        </div>
                                    </td>
                                    <td className="p-3 md:p-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors"
                                                title="View Details"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); initiatePrint(order); }}
                                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded-lg text-slate-500 hover:text-blue-600 transition-colors"
                                                title="Print Bill"
                                            >
                                                <Printer className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleShareInvoice(order); }}
                                                disabled={!order.customerMobile && !order.customerPhone}
                                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded-lg text-slate-500 hover:text-green-600 disabled:opacity-30 transition-colors"
                                                title="Share on WhatsApp"
                                            >
                                                <Share2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile View: Card Layout */}
            <div className="block md:hidden">
                {filteredOrders.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                        No orders found
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-700">
                        {filteredOrders.map((order) => (
                            <div
                                key={order._id}
                                onClick={() => setSelectedOrder(order)}
                                className="p-4 active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                                        {order.invoiceNumber || `#${order._id.slice(-6).toUpperCase()}`}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusColor(order.orderStatus)}`}>
                                        {order.orderStatus}
                                    </span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div className="space-y-1">
                                        <p className="text-slate-900 dark:text-white font-semibold text-base">{order.customerName || 'Unknown'}</p>
                                        <p className="text-slate-500 dark:text-slate-400 text-xs flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {new Date(order.createdAt).toLocaleDateString()} • {order.items?.length || 0} items
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-slate-900 dark:text-white font-bold text-lg mb-1">{formatCurrencySmart(order.totalAmount, state.currencyFormat)}</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); initiatePrint(order); }}
                                                className="p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg"
                                            >
                                                <Printer className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleShareInvoice(order); }}
                                                disabled={!order.customerMobile && !order.customerPhone}
                                                className="p-1.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg disabled:opacity-30"
                                            >
                                                <Share2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Order Status Modal */}
            {/* Order Status Modal - Responsive & Wider */}
            {latestOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-800 w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-5xl sm:rounded-3xl rounded-none shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 relative">
                        {/* Modal Header */}
                        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center shrink-0 bg-white dark:bg-slate-800 z-10">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Order Details</h3>
                                <p className="text-sm text-slate-500">#{latestOrder._id.slice(-6).toUpperCase()} • {formatDateTime(latestOrder.createdAt)}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleShareInvoice(latestOrder)}
                                    className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-slate-500 hover:text-green-600 rounded-lg transition-all hidden sm:flex"
                                    title="Share"
                                >
                                    <Share2 className="h-5 w-5" />
                                </button>
                                <button
                                    onClick={() => initiatePrint(latestOrder)}
                                    className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-500 hover:text-blue-600 rounded-lg transition-all hidden sm:flex"
                                    title="Print"
                                >
                                    <Printer className="h-5 w-5" />
                                </button>
                                <button
                                    onClick={() => setSelectedOrder(null)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                                >
                                    <X className="h-6 w-6 text-slate-400" />
                                </button>
                            </div>
                        </div>

                        {/* Modal Content - Grid Layout */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Left Column: Info & Items */}
                                <div className="lg:col-span-2 space-y-6">
                                    {/* Customer & Order Info Card */}
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2">Customer Details</p>
                                                <div className="space-y-1">
                                                    <p className="font-bold text-lg text-slate-900 dark:text-white">{latestOrder.customerName || 'Walk-in'}</p>
                                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                                        <span className="opacity-70">📞</span>
                                                        {latestOrder.customerMobile || latestOrder.customerPhone || 'No contact info'}
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-snug flex items-start gap-2">
                                                        <span className="opacity-70 mt-0.5">📍</span>
                                                        {latestOrder.deliveryAddress || latestOrder.address || 'No delivery address'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="md:text-right flex flex-col md:items-end justify-center">
                                                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Total Amount</p>
                                                <p className="font-black text-3xl text-slate-900 dark:text-white">{formatCurrencySmart(latestOrder.totalAmount, state.currencyFormat)}</p>
                                                <div className={`mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${getStatusColor(latestOrder.orderStatus)}`}>
                                                    {latestOrder.orderStatus}
                                                </div>
                                                <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${(latestOrder.deliveryType || '').toLowerCase() === 'pickup' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                                    {(latestOrder.deliveryType || '').toLowerCase() === 'pickup' ? <Store className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                                                    {(latestOrder.deliveryType || '').toLowerCase() === 'pickup' ? 'Store Pickup' : 'Home Delivery'}
                                                </div>
                                            </div>
                                        </div>
                                        {latestOrder.orderNotes && (
                                            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">Note from Customer</p>
                                                <p className="text-sm text-slate-700 dark:text-slate-300 italic">"{latestOrder.orderNotes}"</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Items List */}
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">Ordered Items ({latestOrder.items?.length || 0})</h4>
                                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                                            <table className="w-full text-left">
                                                <thead className="bg-slate-50 dark:bg-slate-700/50 text-[10px] md:text-xs uppercase text-slate-500 font-medium">
                                                    <tr>
                                                        <th className="p-3 pl-4">Item Name</th>
                                                        <th className="p-3 text-center">Qty</th>
                                                        <th className="p-3 text-right hidden sm:table-cell">Rate</th>
                                                        <th className="p-3 pr-4 text-right">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {latestOrder.items?.map((item, idx) => {
                                                        const { rate, total, qty } = calculateItemRateAndTotal(item);
                                                        return (
                                                            <tr key={idx} className="text-xs md:text-sm hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                                                <td className="p-3 pl-4 font-medium text-slate-700 dark:text-slate-200">
                                                                    {item.name || item.productName}
                                                                </td>
                                                                <td className="p-3 text-center text-slate-500">
                                                                    {qty}
                                                                </td>
                                                                <td className="p-3 text-right text-slate-500 hidden sm:table-cell">
                                                                    {formatCurrencySmart(rate, state.currencyFormat)}
                                                                </td>
                                                                <td className="p-3 pr-4 text-right font-bold text-slate-900 dark:text-white">
                                                                    {formatCurrencySmart(total, state.currencyFormat)}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Pricing Summary Breakdown */}
                                        <div className="mt-4 px-4 py-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-700 space-y-2">
                                            <div className="flex justify-between text-xs md:text-sm">
                                                <span className="text-slate-500 font-medium">Items Subtotal</span>
                                                <span className="text-slate-700 dark:text-slate-300 font-bold">{formatCurrencySmart(latestOrder.derivedSubtotal, state.currencyFormat)}</span>
                                            </div>
                                            <div className="flex justify-between text-xs md:text-sm">
                                                <span className="text-slate-500 font-medium">Delivery Fee</span>
                                                <span className={`font-bold ${latestOrder.derivedDeliveryCharge === 0 ? 'text-green-600' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {latestOrder.derivedDeliveryCharge === 0 ? 'FREE' : formatCurrencySmart(latestOrder.derivedDeliveryCharge, state.currencyFormat)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                                                <span className="text-slate-900 dark:text-white font-bold">Total Bill</span>
                                                <span className="text-indigo-600 dark:text-indigo-400 font-black text-base">{formatCurrencySmart(latestOrder.totalAmount, state.currencyFormat)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Actions */}
                                <div className="space-y-6">
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 sticky top-0">
                                        <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                                            <Settings className="h-4 w-4" />
                                            Update Status
                                        </h4>
                                        <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
                                            {['Pending', 'Processing', 'Out for Delivery', 'Delivered', 'Cancelled'].map((status) => {
                                                const statusHierarchy = ['Pending', 'Processing', 'Out for Delivery', 'Delivered', 'Completed'];
                                                const currentIndex = statusHierarchy.indexOf(latestOrder.orderStatus);
                                                const targetIndex = statusHierarchy.indexOf(status);

                                                // 1. Prevent selecting same status
                                                const isSameStatus = latestOrder.orderStatus === status;

                                                // 2. Prevent reversing order status (only for standard flow)
                                                const isReversing = currentIndex !== -1 && targetIndex !== -1 && targetIndex < currentIndex;

                                                // 3. Prevent changing from terminal states
                                                const isTerminal = ['Delivered', 'Completed', 'Cancelled'].includes(latestOrder.orderStatus);

                                                const isDisabled = updatingStatus === latestOrder._id || isSameStatus || isReversing || isTerminal;

                                                return (
                                                    <button
                                                        key={status}
                                                        disabled={isDisabled}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (status === 'Delivered' && latestOrder.orderStatus !== 'Delivered') {
                                                                setShowScanner(true);
                                                            } else {
                                                                handleStatusUpdate(latestOrder._id, status);
                                                            }
                                                        }}
                                                        className={`relative flex items-center p-3 rounded-xl border-2 transition-all text-left ${latestOrder.orderStatus === status
                                                            ? 'border-indigo-600 bg-white dark:bg-slate-800 shadow-sm z-10'
                                                            : 'border-transparent bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400'
                                                            } active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                                                    >
                                                        <span className={`w-2.5 h-2.5 rounded-full mr-3 ${getStatusColor(status).split(' ')[0]}`}></span>
                                                        <span className={`text-sm font-medium ${latestOrder.orderStatus === status ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                                            {status}
                                                        </span>
                                                        {latestOrder.orderStatus === status && (
                                                            <div className="ml-auto bg-indigo-100 dark:bg-indigo-900/50 p-1 rounded-full">
                                                                <Check className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                                            <button
                                                onClick={() => initiatePrint(latestOrder)}
                                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors font-bold text-xs md:text-sm"
                                            >
                                                <Printer className="h-4 w-4" />
                                                Print Bill
                                            </button>
                                            <button
                                                onClick={() => handleShareInvoice(latestOrder)}
                                                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors font-bold text-xs md:text-sm"
                                            >
                                                <Share2 className="h-4 w-4" />
                                                Share Invoice
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Loading Overlay */}
                        {updatingStatus === selectedOrder._id && (
                            <div className="absolute inset-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-[2px] flex items-center justify-center z-50">
                                <div className="flex flex-col items-center gap-3 p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 animate-in zoom-in duration-300">
                                    <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
                                    <p className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-widest">Updating...</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Print Options Modal */}
            {showPrintModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Select Print Format</h3>
                            <button onClick={() => setShowPrintModal(false)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full">
                                <X className="h-5 w-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <button onClick={() => executePrint('58mm')} className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 group transition-all text-left">
                                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-800"><Receipt className="h-5 w-5 text-slate-600 dark:text-slate-300 group-hover:text-blue-600" /></div>
                                <div><p className="font-semibold text-slate-900 dark:text-white">Thermal (58mm)</p><p className="text-xs text-slate-500">Small receipts</p></div>
                            </button>
                            <button onClick={() => executePrint('80mm')} className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 group transition-all text-left">
                                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-800"><Receipt className="h-5 w-5 text-slate-600 dark:text-slate-300 group-hover:text-blue-600" /></div>
                                <div><p className="font-semibold text-slate-900 dark:text-white">Thermal (80mm)</p><p className="text-xs text-slate-500">Standard receipts</p></div>
                            </button>
                            <button onClick={() => executePrint('a4')} className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 group transition-all text-left">
                                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-800"><Layout className="h-5 w-5 text-slate-600 dark:text-slate-300 group-hover:text-blue-600" /></div>
                                <div><p className="font-semibold text-slate-900 dark:text-white">A4 (Laser)</p><p className="text-xs text-slate-500">Full page invoice</p></div>
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Verification Scanner Modal */}
            {showScanner && (
                <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-4">
                    <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-50">
                        <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                            <p className="text-white font-bold text-sm tracking-widest uppercase">Verify Delivery</p>
                        </div>
                        <button
                            onClick={() => setShowScanner(false)}
                            className="p-3 bg-white/10 backdrop-blur-md text-white hover:bg-white/20 rounded-full transition-all border border-white/20"
                        >
                            <X className="h-6 w-6" />
                        </button>
                    </div>

                    <div className="w-full max-w-lg aspect-square relative rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-2 border-white/10">
                        <BarcodeScanner
                            onScan={handleScan}
                            onClose={() => setShowScanner(false)}
                            inline={true}
                        />

                        {/* Interactive UI Overlays for Scanner */}
                        <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40"></div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-white/40 rounded-2xl flex items-center justify-center">
                            <div className="w-4 h-4 border-t-4 border-l-4 border-indigo-500 absolute top-0 left-0 rounded-tl-lg"></div>
                            <div className="w-4 h-4 border-t-4 border-r-4 border-indigo-500 absolute top-0 right-0 rounded-tr-lg"></div>
                            <div className="w-4 h-4 border-b-4 border-l-4 border-indigo-500 absolute bottom-0 left-0 rounded-bl-lg"></div>
                            <div className="w-4 h-4 border-b-4 border-r-4 border-indigo-500 absolute bottom-0 right-0 rounded-br-lg"></div>
                        </div>
                    </div>

                    <div className="mt-8 text-center max-w-xs space-y-4">
                        <div>
                            <p className="text-white/60 text-xs font-medium uppercase tracking-[0.2em] mb-1">Order ID</p>
                            <p className="text-white font-mono font-bold text-lg">#{latestOrder?._id?.slice(-8).toUpperCase() || selectedOrder?._id?.slice(-8).toUpperCase()}</p>
                        </div>

                        <p className="text-white/80 text-sm leading-relaxed">
                            Scan the <span className="text-indigo-400 font-bold uppercase">Customer Order QR</span> code to verify and confirm delivery.
                        </p>

                        <div className="pt-4 text-center">
                            <p className="text-white/40 text-[10px] mt-2 italic">Ensure the QR code is clearly visible</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Delivery Popup */}
            {showSuccessPopup && lastVerifiedOrder && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowSuccessPopup(false)}></div>
                    <div className="relative bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100 dark:border-slate-700 text-center animate-in zoom-in duration-300">
                        <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-10 w-10" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Order Delivered!</h3>
                        <p className="text-slate-500 dark:text-slate-400 mb-6">
                            Order <span className="font-mono font-bold text-slate-900 dark:text-white">#{lastVerifiedOrder._id?.slice(-8).toUpperCase()}</span> has been successfully verified and marked as delivered.
                        </p>
                        <button
                            onClick={() => setShowSuccessPopup(false)}
                            className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg"
                        >
                            Back to Orders
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OnlineStore;
